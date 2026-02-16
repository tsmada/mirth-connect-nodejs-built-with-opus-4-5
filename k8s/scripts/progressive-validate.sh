#!/usr/bin/env bash
# Progressive Migration Validation Pipeline
#
# Orchestrates a 5-stage validation of the Java → Node.js migration path:
#   Stage 0: Setup (base infra + Java Mirth)
#   Stage 1: Java Mirth baseline
#   Stage 2: Shadow mode (read-only observer → promote → cutover)
#   Stage 3: Takeover mode (Node.js on Java's database)
#   Stage 4: Standalone mode (fresh database)
#   Stage 5: Comparison report
#
# Usage:
#   ./progressive-validate.sh              # All stages
#   ./progressive-validate.sh --stage 2    # Single stage
#   ./progressive-validate.sh --skip-setup # Skip Stage 0
#
# Prerequisites:
#   - Rancher Desktop / k3s running
#   - node-mirth:latest image built (or use --skip-setup to skip build)
#   - Node.js + npx available (for TypeScript runner)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
K8S_DIR="$SCRIPT_DIR/.."
VALIDATION_DIR="$PROJECT_ROOT/validation"

# Report output directory
REPORT_DIR="${REPORT_DIR:-$PROJECT_ROOT/validation/reports/progressive-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$REPORT_DIR"

# Parse arguments
STAGE=""
SKIP_SETUP=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --skip-setup) SKIP_SETUP=true; shift ;;
    --report-dir) REPORT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Track port-forward PIDs for cleanup
PF_PIDS=()

cleanup() {
  echo ""
  echo "Cleaning up port-forwards..."
  if [[ ${#PF_PIDS[@]} -gt 0 ]]; then
    for pid in "${PF_PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi
  PF_PIDS=()
}
trap cleanup EXIT

# Helper: kill all tracked port-forwards
kill_port_forwards() {
  if [[ ${#PF_PIDS[@]} -gt 0 ]]; then
    for pid in "${PF_PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi
  PF_PIDS=()
  sleep 1
}

# Helper: port-forward and track PID
port_forward() {
  local ns="$1" resource="$2" mapping="$3"
  kubectl port-forward -n "$ns" "$resource" "$mapping" &>/dev/null &
  PF_PIDS+=($!)
}

# Helper: wait for a local port to accept connections
wait_for_port() {
  local port="$1" timeout="${2:-30}" elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if nc -z localhost "$port" 2>/dev/null; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "WARNING: Port $port not ready after ${timeout}s"
  return 1
}

# Helper: dump pod logs on failure
dump_logs() {
  local ns="$1" label="${2:-app=node-mirth}"
  echo "--- Pod logs ($ns, $label) ---"
  kubectl logs -n "$ns" -l "$label" --tail=50 2>/dev/null || echo "(no logs)"
  echo "---"
}

# Helper: run the TypeScript runner for a given target
run_runner() {
  local target="$1"
  local api_url="${2:-http://localhost:8080}"
  local mllp_port="${3:-6670}"
  local http_port="${4:-8090}"
  local output_file="$REPORT_DIR/stage-${target}.json"

  echo "  Running ProgressiveMigrationRunner --target $target"
  cd "$VALIDATION_DIR"
  npx ts-node runners/ProgressiveMigrationRunner.ts \
    --target "$target" \
    --output "$output_file" \
    --api-url "$api_url" \
    --mllp-port "$mllp_port" \
    --http-port "$http_port" || {
      echo "  WARNING: Runner returned non-zero for $target"
      return 1
    }
  echo "  Result saved: $output_file"
  cd "$PROJECT_ROOT"
}

should_run() {
  [[ -z "$STAGE" || "$STAGE" == "$1" ]]
}

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Progressive Migration Validation Pipeline               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Report directory: $REPORT_DIR"
echo ""

# ── Stage 0: Setup ─────────────────────────────────────────────────────────
if should_run 0 && [[ "$SKIP_SETUP" == "false" ]]; then
  echo "━━━ Stage 0: Setup (build image + deploy base infra) ━━━"
  "$SCRIPT_DIR/setup.sh"
  echo "Stage 0 complete."
  echo ""
fi

# ── Stage 1: Java Mirth Baseline ──────────────────────────────────────────
if should_run 1; then
  echo "━━━ Stage 1: Java Mirth Baseline ━━━"

  # Ensure Java Mirth is running
  echo "  Verifying Java Mirth is ready..."
  "$SCRIPT_DIR/wait-for-ready.sh" mirth-infra app=java-mirth 180 || {
    echo "  ERROR: Java Mirth not ready"
    dump_logs mirth-infra app=java-mirth
    if [[ -n "$STAGE" ]]; then exit 1; fi
  }

  # Get the Java Mirth pod name
  JAVA_POD=$(kubectl get pods -n mirth-infra -l app=java-mirth -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [[ -z "$JAVA_POD" ]]; then
    echo "  ERROR: Cannot find Java Mirth pod"
    if [[ -n "$STAGE" ]]; then exit 1; fi
  else
    # Port-forward: API (HTTPS), MLLP, and HTTP ports
    port_forward mirth-infra "pod/$JAVA_POD" "9443:8443"
    port_forward mirth-infra "pod/$JAVA_POD" "6670:6670"
    port_forward mirth-infra "pod/$JAVA_POD" "6671:6671"
    port_forward mirth-infra "pod/$JAVA_POD" "8090:8090"
    port_forward mirth-infra "pod/$JAVA_POD" "8095:8095"

    wait_for_port 9443 30

    # Deploy kitchen sink channels to Java Mirth
    echo "  Deploying kitchen sink channels..."
    "$SCRIPT_DIR/deploy-kitchen-sink.sh" "https://localhost:9443" || {
      echo "  WARNING: Kitchen sink deploy had errors (may be pre-existing channels)"
    }

    # Run validation
    run_runner java "https://localhost:9443" 6670 8090 || true

    kill_port_forwards
  fi

  echo "Stage 1 complete."
  echo ""
fi

# ── Stage 2: Shadow Mode ──────────────────────────────────────────────────
if should_run 2; then
  echo "━━━ Stage 2: Shadow Mode ━━━"

  # Deploy shadow overlay
  echo "  Deploying shadow mode overlay..."
  kubectl apply -k "$K8S_DIR/overlays/shadow/" 2>/dev/null || true

  "$SCRIPT_DIR/wait-for-ready.sh" mirth-shadow app=node-mirth 180 || {
    echo "  ERROR: Shadow mode Node.js Mirth not ready"
    dump_logs mirth-shadow
    kubectl delete -k "$K8S_DIR/overlays/shadow/" 2>/dev/null || true
    if [[ -n "$STAGE" ]]; then exit 1; fi
  }

  # Get the Node Mirth pod name
  NODE_POD=$(kubectl get pods -n mirth-shadow -l app=node-mirth -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [[ -n "$NODE_POD" ]]; then
    port_forward mirth-shadow "pod/$NODE_POD" "8080:8080"
    port_forward mirth-shadow "pod/$NODE_POD" "6670:6670"
    port_forward mirth-shadow "pod/$NODE_POD" "6671:6671"
    port_forward mirth-shadow "pod/$NODE_POD" "8090:8090"
    port_forward mirth-shadow "pod/$NODE_POD" "8095:8095"

    wait_for_port 8080 30

    run_runner shadow "http://localhost:8080" 6670 8090 || true

    kill_port_forwards
  fi

  # Cleanup
  echo "  Cleaning up shadow overlay..."
  kubectl delete -k "$K8S_DIR/overlays/shadow/" 2>/dev/null || true

  echo "Stage 2 complete."
  echo ""
fi

# ── Stage 3: Takeover Mode ────────────────────────────────────────────────
if should_run 3; then
  echo "━━━ Stage 3: Takeover Mode ━━━"

  # Stop Java Mirth so Node.js can take over
  echo "  Scaling down Java Mirth..."
  kubectl scale deployment java-mirth -n mirth-infra --replicas=0 2>/dev/null || true
  sleep 5

  # Deploy takeover overlay
  echo "  Deploying takeover mode overlay..."
  kubectl apply -k "$K8S_DIR/overlays/takeover/" 2>/dev/null || true

  "$SCRIPT_DIR/wait-for-ready.sh" mirth-takeover app=node-mirth 180 || {
    echo "  ERROR: Takeover mode Node.js Mirth not ready"
    dump_logs mirth-takeover
    kubectl delete -k "$K8S_DIR/overlays/takeover/" 2>/dev/null || true
    kubectl scale deployment java-mirth -n mirth-infra --replicas=1 2>/dev/null || true
    if [[ -n "$STAGE" ]]; then exit 1; fi
  }

  NODE_POD=$(kubectl get pods -n mirth-takeover -l app=node-mirth -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [[ -n "$NODE_POD" ]]; then
    port_forward mirth-takeover "pod/$NODE_POD" "8080:8080"
    port_forward mirth-takeover "pod/$NODE_POD" "6670:6670"
    port_forward mirth-takeover "pod/$NODE_POD" "6671:6671"
    port_forward mirth-takeover "pod/$NODE_POD" "8090:8090"
    port_forward mirth-takeover "pod/$NODE_POD" "8095:8095"

    wait_for_port 8080 30

    run_runner takeover "http://localhost:8080" 6670 8090 || true

    kill_port_forwards
  fi

  # Cleanup: remove takeover, restore Java Mirth
  echo "  Cleaning up takeover overlay..."
  kubectl delete -k "$K8S_DIR/overlays/takeover/" 2>/dev/null || true
  echo "  Restoring Java Mirth..."
  kubectl scale deployment java-mirth -n mirth-infra --replicas=1 2>/dev/null || true

  echo "Stage 3 complete."
  echo ""
fi

# ── Stage 4: Standalone Mode ──────────────────────────────────────────────
if should_run 4; then
  echo "━━━ Stage 4: Standalone Mode ━━━"

  # Deploy standalone overlay (has its own MySQL)
  echo "  Deploying standalone mode overlay..."
  kubectl apply -k "$K8S_DIR/overlays/standalone/" 2>/dev/null || true

  # Wait for standalone MySQL first
  "$SCRIPT_DIR/wait-for-ready.sh" mirth-standalone app=mysql 120 || {
    echo "  ERROR: Standalone MySQL not ready"
    kubectl delete -k "$K8S_DIR/overlays/standalone/" 2>/dev/null || true
    if [[ -n "$STAGE" ]]; then exit 1; fi
  }

  "$SCRIPT_DIR/wait-for-ready.sh" mirth-standalone app=node-mirth 180 || {
    echo "  ERROR: Standalone Node.js Mirth not ready"
    dump_logs mirth-standalone
    kubectl delete -k "$K8S_DIR/overlays/standalone/" 2>/dev/null || true
    if [[ -n "$STAGE" ]]; then exit 1; fi
  }

  NODE_POD=$(kubectl get pods -n mirth-standalone -l app=node-mirth -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [[ -n "$NODE_POD" ]]; then
    port_forward mirth-standalone "pod/$NODE_POD" "8080:8080"
    port_forward mirth-standalone "pod/$NODE_POD" "6670:6670"
    port_forward mirth-standalone "pod/$NODE_POD" "6671:6671"
    port_forward mirth-standalone "pod/$NODE_POD" "8090:8090"
    port_forward mirth-standalone "pod/$NODE_POD" "8095:8095"

    wait_for_port 8080 30

    # Standalone needs channels deployed fresh
    echo "  Deploying kitchen sink channels to standalone..."
    "$SCRIPT_DIR/deploy-kitchen-sink.sh" "http://localhost:8080" || {
      echo "  WARNING: Kitchen sink deploy had errors"
    }

    run_runner standalone "http://localhost:8080" 6670 8090 || true

    kill_port_forwards
  fi

  # Cleanup
  echo "  Cleaning up standalone overlay..."
  kubectl delete -k "$K8S_DIR/overlays/standalone/" 2>/dev/null || true

  echo "Stage 4 complete."
  echo ""
fi

# ── Stage 5: Comparison Report ────────────────────────────────────────────
if should_run 5; then
  echo "━━━ Stage 5: Comparison Report ━━━"

  STAGE_FILES=$(ls "$REPORT_DIR"/stage-*.json 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$STAGE_FILES" -eq 0 ]]; then
    echo "  No stage result files found in $REPORT_DIR"
    echo "  Run stages 1-4 first."
    exit 1
  fi

  cd "$VALIDATION_DIR"
  npx ts-node runners/ProgressiveMigrationRunner.ts \
    --compare \
    --report-dir "$REPORT_DIR"
  cd "$PROJECT_ROOT"

  echo ""
  echo "Stage 5 complete."
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Pipeline finished. Reports in:                             ║"
echo "║  $REPORT_DIR"
echo "╚══════════════════════════════════════════════════════════════╝"
