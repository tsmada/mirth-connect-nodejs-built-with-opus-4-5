#!/usr/bin/env bash
# Side-by-side benchmark: Java Mirth 3.9.1 vs Node.js Mirth
# Deploys benchmark infrastructure, channels, and runs k6 load tests.
#
# Prerequisites:
#   - Rancher Desktop k3s running
#   - mirth-infra deployed (Java Mirth + MySQL via ./k8s/scripts/setup.sh)
#   - node-mirth:latest image built (./k8s/scripts/build-image.sh)
#
# Usage:
#   ./k8s/scripts/run-benchmark.sh              # Full run (deploy + test)
#   ./k8s/scripts/run-benchmark.sh --skip-deploy # Re-run k6 only (infra already up)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
K8S_DIR="$PROJECT_DIR/k8s"

SKIP_DEPLOY="${1:-}"
JAVA_API_PORT=8443
NODEJS_API_PORT=8080

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[benchmark]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

cleanup_port_forwards() {
  log "Cleaning up port-forwards..."
  kill $PF_JAVA_PID 2>/dev/null || true
  kill $PF_NODE_PID 2>/dev/null || true
}

# ── Step 1: Verify Prerequisites ───────────────────────
step1_verify() {
  log "Step 1: Verifying prerequisites..."

  if ! kubectl cluster-info &>/dev/null; then
    err "kubectl not connected to cluster. Is Rancher Desktop running?"
    exit 1
  fi
  ok "kubectl connected"

  if ! kubectl get namespace mirth-infra &>/dev/null; then
    err "mirth-infra namespace not found. Run: ./k8s/scripts/setup.sh"
    exit 1
  fi
  ok "mirth-infra namespace exists"

  # Check Java Mirth is running
  if ! kubectl get deployment java-mirth -n mirth-infra &>/dev/null; then
    err "Java Mirth deployment not found in mirth-infra"
    exit 1
  fi

  JAVA_READY=$(kubectl get deployment java-mirth -n mirth-infra -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  if [[ "$JAVA_READY" != "1" ]]; then
    warn "Java Mirth not ready (readyReplicas=$JAVA_READY). Waiting..."
    kubectl wait --for=condition=available deployment/java-mirth -n mirth-infra --timeout=300s || {
      err "Java Mirth did not become ready within 300s"
      exit 1
    }
  fi
  ok "Java Mirth running in mirth-infra"

  # Check MySQL in mirth-infra
  if ! kubectl get statefulset mysql -n mirth-infra &>/dev/null; then
    err "MySQL not found in mirth-infra"
    exit 1
  fi
  ok "MySQL running in mirth-infra"

  # Check node-mirth image exists
  if ! docker image inspect node-mirth:latest &>/dev/null 2>&1; then
    # Try nerdctl for containerd
    if ! nerdctl image inspect node-mirth:latest &>/dev/null 2>&1; then
      warn "node-mirth:latest image not found. Build it with: ./k8s/scripts/build-image.sh"
      warn "Continuing anyway (image may already be in containerd)..."
    fi
  fi
  ok "Prerequisites verified"
}

# ── Step 2: Deploy Benchmark Overlay ───────────────────
step2_deploy() {
  log "Step 2: Deploying benchmark overlay..."

  # Patch Java Mirth with benchmark ports using strategic merge patch
  log "  Patching Java Mirth with benchmark ports..."
  kubectl patch deployment java-mirth -n mirth-infra --type strategic \
    --patch-file "$K8S_DIR/overlays/benchmark/java-mirth-deployment-patch.yaml"
  kubectl patch service java-mirth -n mirth-infra --type strategic \
    --patch-file "$K8S_DIR/overlays/benchmark/java-mirth-service-patch.yaml"
  ok "Java Mirth patched with benchmark ports (7090-7092)"

  # Wait for Java Mirth to restart with new ports
  kubectl rollout status deployment/java-mirth -n mirth-infra --timeout=180s
  ok "Java Mirth restarted with benchmark ports"

  # Deploy benchmark namespace + Node.js Mirth + MySQL
  log "  Deploying mirth-benchmark namespace..."
  kubectl apply -k "$K8S_DIR/overlays/benchmark/"
  ok "Benchmark overlay applied"

  # Wait for pods to exist before using kubectl wait (StatefulSet pods take time to schedule)
  log "  Waiting for benchmark MySQL pod to be created..."
  local retries=0
  while ! kubectl get pod -l app=mysql -n mirth-benchmark -o name 2>/dev/null | grep -q pod; do
    retries=$((retries + 1))
    if [[ $retries -gt 30 ]]; then
      err "MySQL pod not created after 60s"
      exit 1
    fi
    sleep 2
  done
  kubectl wait --for=condition=ready pod -l app=mysql -n mirth-benchmark --timeout=120s
  ok "Benchmark MySQL ready"

  # Wait for Node.js Mirth pod to exist
  log "  Waiting for Node.js Mirth pod to be created..."
  retries=0
  while ! kubectl get pod -l app=node-mirth -n mirth-benchmark -o name 2>/dev/null | grep -q pod; do
    retries=$((retries + 1))
    if [[ $retries -gt 30 ]]; then
      err "Node.js Mirth pod not created after 60s"
      exit 1
    fi
    sleep 2
  done
  kubectl wait --for=condition=ready pod -l app=node-mirth -n mirth-benchmark --timeout=180s
  ok "Node.js Mirth ready in mirth-benchmark"
}

# ── Step 3: Port-Forward ──────────────────────────────
PF_JAVA_PID=""
PF_NODE_PID=""

step3_port_forward() {
  log "Step 3: Setting up port-forwards for channel deployment..."

  # Forward Java Mirth API
  kubectl port-forward -n mirth-infra svc/java-mirth $JAVA_API_PORT:$JAVA_API_PORT &>/dev/null &
  PF_JAVA_PID=$!

  # Forward Node.js Mirth API
  kubectl port-forward -n mirth-benchmark svc/node-mirth $NODEJS_API_PORT:$NODEJS_API_PORT &>/dev/null &
  PF_NODE_PID=$!

  # Wait for port-forwards to establish
  sleep 3

  # Verify connectivity
  if curl -sk "https://localhost:$JAVA_API_PORT/api/server/version" &>/dev/null; then
    ok "Java Mirth API accessible at https://localhost:$JAVA_API_PORT"
  else
    warn "Java Mirth API not responding on localhost:$JAVA_API_PORT (may need more time)"
  fi

  if curl -s "http://localhost:$NODEJS_API_PORT/api/health" &>/dev/null; then
    ok "Node.js Mirth API accessible at http://localhost:$NODEJS_API_PORT"
  else
    warn "Node.js Mirth API not responding on localhost:$NODEJS_API_PORT (may need more time)"
  fi
}

# ── Step 4: Deploy Benchmark Channels ─────────────────
# AUTH_ARGS is a bash array set per-engine by deploy_channels_to_engine
# Using arrays avoids word-splitting issues (zsh doesn't split unquoted vars)
AUTH_ARGS=()

deploy_channel() {
  local api_url="$1"
  local channel_file="$2"
  local port="$3"
  local channel_name="$4"
  local extra_curl_opts="${5:-}"

  # Substitute port placeholder
  local channel_xml
  channel_xml=$(sed "s/PORT_PLACEHOLDER/$port/g" "$channel_file")

  # Import channel
  log "    Importing $channel_name (port $port)..."
  local import_result
  import_result=$(curl -s $extra_curl_opts -X POST "$api_url/api/channels" \
    -H "Content-Type: application/xml" \
    "${AUTH_ARGS[@]}" \
    -d "$channel_xml" 2>&1) || true

  if [[ -n "$import_result" ]] && [[ "$import_result" != *"error"* ]] && [[ "$import_result" != *"Error"* ]] && [[ "$import_result" != *"Unauthorized"* ]]; then
    ok "    Imported $channel_name"
  else
    warn "    Import response for $channel_name: $import_result"
  fi
}

login_nodejs() {
  local api_url="$1"

  local login_result
  login_result=$(curl -s -X POST "$api_url/api/users/_login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' -i 2>&1)

  # Extract X-Session-ID header (anchor to line start to avoid matching CORS headers)
  local session_id
  session_id=$(echo "$login_result" | grep -i "^x-session-id:" | head -1 | awk '{print $2}' | tr -d '\r\n')

  if [[ -z "$session_id" ]]; then
    err "    Node.js session extraction failed"
    err "    Response headers:"
    echo "$login_result" | head -15 >&2
    return 1
  fi

  # Set globals using array (safe across bash/zsh)
  AUTH_ARGS=(-H "X-Session-ID: $session_id")
  SESSION_PREVIEW="${session_id:0:8}"
}

login_java() {
  local api_url="$1"

  local login_result
  login_result=$(curl -sk -X POST "$api_url/api/users/_login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "X-Requested-With: XMLHttpRequest" \
    -d "username=admin&password=admin" -i 2>&1)

  # Check for success
  if ! echo "$login_result" | grep -q "SUCCESS"; then
    err "    Java login failed"
    err "    Response:"
    echo "$login_result" | head -15 >&2
    return 1
  fi

  # Extract JSESSIONID cookie
  local jsession
  jsession=$(echo "$login_result" | grep -i "set-cookie" | grep -o "JSESSIONID=[^;]*" | head -1 | tr -d '\r\n')

  if [[ -z "$jsession" ]]; then
    err "    Java session extraction failed"
    return 1
  fi

  # Set globals using array (safe across bash/zsh)
  AUTH_ARGS=(-b "$jsession")
  SESSION_PREVIEW="${jsession:12:8}"
}

verify_auth() {
  local api_url="$1"
  local engine_name="$2"
  local extra_curl_opts="${3:-}"

  # Make a test API call to verify auth works
  local status_code
  status_code=$(curl -s -o /dev/null -w "%{http_code}" $extra_curl_opts \
    "$api_url/api/channels" "${AUTH_ARGS[@]}" 2>/dev/null) || true

  if [[ "$status_code" == "200" ]]; then
    return 0
  else
    err "    Auth verification failed for $engine_name (HTTP $status_code)"
    return 1
  fi
}

deploy_channels_to_engine() {
  local api_url="$1"
  local engine_name="$2"
  local engine_type="$3"
  local echo_port="$4"
  local json_port="$5"
  local hl7_port="$6"
  local extra_curl_opts="${7:-}"

  log "  Deploying channels to $engine_name..."

  # Login (different auth per engine)
  # Call directly (not in subshell) so AUTH_ARGS global is visible
  AUTH_ARGS=()
  SESSION_PREVIEW=""
  if [[ "$engine_type" == "nodejs" ]]; then
    login_nodejs "$api_url" || {
      err "  Failed to login to $engine_name"
      return 1
    }
  else
    login_java "$api_url" || {
      err "  Failed to login to $engine_name"
      return 1
    }
  fi
  ok "  Logged in to $engine_name (session: ${SESSION_PREVIEW}...)"

  # Verify auth works before deploying channels
  if ! verify_auth "$api_url" "$engine_name" "$extra_curl_opts"; then
    err "  Auth verification failed — retrying login..."
    sleep 2
    if [[ "$engine_type" == "nodejs" ]]; then
      login_nodejs "$api_url" || { err "  Retry login failed"; return 1; }
    else
      login_java "$api_url" || { err "  Retry login failed"; return 1; }
    fi
    if ! verify_auth "$api_url" "$engine_name" "$extra_curl_opts"; then
      err "  Auth verification failed after retry for $engine_name"
      return 1
    fi
    ok "  Auth verified on retry"
  fi

  # Deploy each channel
  local channels_dir="$K8S_DIR/benchmark-channels"
  deploy_channel "$api_url" "$channels_dir/http-echo.xml" "$echo_port" "HTTP Echo" "$extra_curl_opts"
  deploy_channel "$api_url" "$channels_dir/json-transform.xml" "$json_port" "JSON Transform" "$extra_curl_opts"
  deploy_channel "$api_url" "$channels_dir/hl7-http.xml" "$hl7_port" "HL7 via HTTP" "$extra_curl_opts"

  # Deploy all channels
  log "    Deploying all channels..."
  curl -s $extra_curl_opts -X POST "$api_url/api/channels/_deploy" \
    -H "Content-Type: application/xml" \
    "${AUTH_ARGS[@]}" \
    -d "<set/>" &>/dev/null || true
  ok "  Channels deployed on $engine_name"
}

step4_deploy_channels() {
  log "Step 4: Deploying benchmark channels..."

  # Deploy to Node.js Mirth
  deploy_channels_to_engine "http://localhost:$NODEJS_API_PORT" "Node.js Mirth" "nodejs" 7080 7081 7082

  # Deploy to Java Mirth
  deploy_channels_to_engine "https://localhost:$JAVA_API_PORT" "Java Mirth" "java" 7090 7091 7092 "-k"
}

# ── Step 5: Wait for Channels ─────────────────────────
wait_for_channel_port() {
  local host="$1"
  local port="$2"
  local name="$3"
  local timeout="${4:-60}"
  local extra_curl_opts="${5:-}"

  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if curl -s $extra_curl_opts --connect-timeout 2 "http://${host}:${port}/bench-echo" -d '{"test":true}' -H "Content-Type: application/json" &>/dev/null; then
      ok "  $name port $port is responding (${elapsed}s)"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
    if (( elapsed % 15 == 0 )); then
      log "  Still waiting for $name port $port... (${elapsed}s / ${timeout}s)"
    fi
  done
  warn "  $name port $port not responding after ${timeout}s"
  return 1
}

step5_wait_channels() {
  log "Step 5: Waiting for channels to start..."

  # Port-forward message ports temporarily for health checks
  kubectl port-forward -n mirth-benchmark svc/node-mirth 7080:7080 &>/dev/null &
  local PF_NODE_MSG=$!
  kubectl port-forward -n mirth-infra svc/java-mirth 7090:7090 &>/dev/null &
  local PF_JAVA_MSG=$!
  sleep 2

  # Node.js channels start fast
  wait_for_channel_port "localhost" 7080 "Node.js" 30 || true

  # Java Mirth channels need more time for classloading
  wait_for_channel_port "localhost" 7090 "Java" 90 || true

  # Clean up temp port-forwards
  kill $PF_NODE_MSG 2>/dev/null || true
  kill $PF_JAVA_MSG 2>/dev/null || true
  ok "  Channel readiness check complete"
}

# ── Step 6: Run k6 Benchmarks ─────────────────────────
step6_run_k6() {
  log "Step 6: Running k6 benchmark suite..."

  # Ensure mirth-k6 namespace exists
  kubectl create namespace mirth-k6 2>/dev/null || true

  # Delete any previous benchmark job
  kubectl delete job k6-benchmark -n mirth-k6 2>/dev/null || true

  # Apply k6 ConfigMap (contains all scripts)
  kubectl apply -f "$K8S_DIR/k6/configmap.yaml"
  ok "k6 scripts ConfigMap applied"

  # Apply benchmark Job
  kubectl apply -f "$K8S_DIR/k6/job-benchmark.yaml"
  ok "k6 benchmark Job started"

  # Wait for completion and stream logs
  log "Streaming k6 output (this takes ~15 minutes for all 3 phases)..."
  echo ""

  # Wait for pod to be created
  sleep 5

  # Stream logs (follow until job completes)
  kubectl logs -n mirth-k6 -l job-name=k6-benchmark -f --tail=-1 2>/dev/null || {
    warn "Log streaming interrupted. Check logs with:"
    warn "  kubectl logs -n mirth-k6 -l job-name=k6-benchmark"
  }
}

# ── Step 7: Report ────────────────────────────────────
step7_report() {
  log "Step 7: Benchmark report"
  echo ""

  # Wait briefly for Job controller to update status conditions
  kubectl wait --for=condition=complete job/k6-benchmark -n mirth-k6 --timeout=30s 2>/dev/null || true

  # Check job status
  local status
  status=$(kubectl get job k6-benchmark -n mirth-k6 -o jsonpath='{.status.conditions[0].type}' 2>/dev/null || echo "Unknown")

  if [[ "$status" == "Complete" ]]; then
    ok "Benchmark suite completed successfully!"
  elif [[ "$status" == "Failed" ]]; then
    err "Benchmark suite failed. Check logs:"
    err "  kubectl logs -n mirth-k6 -l job-name=k6-benchmark"
  else
    warn "Benchmark status: $status"
    warn "Check progress: kubectl logs -n mirth-k6 -l job-name=k6-benchmark -f"
  fi

  echo ""
  log "To re-run benchmarks without redeploying: $0 --skip-deploy"
  log "To tear down: kubectl delete namespace mirth-benchmark"
  log "To fully teardown: ./k8s/scripts/teardown.sh"
}

# ── Main ──────────────────────────────────────────────
main() {
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  Side-by-Side Benchmark: Java vs Node.js Mirth  ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║  Both engines running natively on ARM64.         ║"
  echo "║  Java: Temurin JDK 11 | Node.js: v20 Alpine     ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""

  step1_verify

  if [[ "$SKIP_DEPLOY" == "--skip-deploy" ]]; then
    log "Skipping deployment (--skip-deploy)"
  else
    step2_deploy
    step3_port_forward
    trap cleanup_port_forwards EXIT
    step4_deploy_channels
    step5_wait_channels
    cleanup_port_forwards
    trap - EXIT
  fi

  step6_run_k6
  step7_report
}

main "$@"
