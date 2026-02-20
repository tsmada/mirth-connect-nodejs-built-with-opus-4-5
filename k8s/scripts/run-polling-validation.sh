#!/usr/bin/env bash
# =============================================================================
# Polling Coordination Validation — End-to-End Orchestrator
# =============================================================================
# Orchestrates the full polling validation suite:
#   1. Build image + deploy base infra (with SFTP)
#   2. Deploy appropriate overlay (cluster, takeover, or both)
#   3. Create DV_POLL_AUDIT table
#   4. Deploy polling channels (PC01-PC04)
#   5. Run validation scenarios
#   6. Aggregate results
#
# Usage:
#   ./run-polling-validation.sh                        # Default: cluster mode
#   ./run-polling-validation.sh --mode standalone      # Cluster standalone
#   ./run-polling-validation.sh --mode takeover        # Takeover mode
#   ./run-polling-validation.sh --mode both            # All scenarios
#   ./run-polling-validation.sh --skip-deploy          # Skip infra deployment
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/.."
PROJECT_DIR="$K8S_DIR/.."
DV_DIR="$K8S_DIR/deep-validation"
SCENARIOS_DIR="$PROJECT_DIR/validation/scenarios"

MODE="standalone"
SKIP_DEPLOY=false

for arg in "$@"; do
  case "$arg" in
    --mode) shift; MODE="${1:-standalone}"; shift || true ;;
    --mode=*) MODE="${arg#*=}" ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
  esac
done

# ── Colors ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_step()  { echo -e "${CYAN}[STEP]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

TOTAL_PASS=0
TOTAL_FAIL=0

echo ""
echo "================================================================"
echo "  POLLING COORDINATION VALIDATION"
echo "  Mode: $MODE"
echo "================================================================"
echo ""

# ── Step 1: Deploy Infrastructure ──────────────────────────
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  log_step "Deploying base infrastructure (including SFTP)..."
  kubectl apply -k "$K8S_DIR/base/" 2>/dev/null || {
    log_warn "Base infra already applied or partially failed (usually OK)"
  }

  log_step "Waiting for SFTP to be ready..."
  kubectl wait -n mirth-infra --for=condition=ready pod -l app=sftp --timeout=60s 2>/dev/null || {
    log_warn "SFTP wait timed out (may already be running)"
  }

  log_step "Waiting for MySQL to be ready..."
  kubectl wait -n mirth-infra --for=condition=ready pod -l app=mysql --timeout=120s 2>/dev/null || {
    log_warn "MySQL wait timed out (may already be running)"
  }
  log_ok "Base infrastructure ready"
fi

# ── Step 2: Create DV_POLL_AUDIT table ─────────────────────
log_step "Setting up DV_POLL_AUDIT table..."
kubectl exec -n mirth-infra statefulset/mysql -- \
  mysql -umirth -pmirth mirthdb < "$DV_DIR/sql/setup-polling.sql" 2>/dev/null || {
  # If piping fails, try inline
  kubectl exec -n mirth-infra statefulset/mysql -- \
    mysql -umirth -pmirth mirthdb -e "$(cat "$DV_DIR/sql/setup-polling.sql")" 2>/dev/null || {
    log_warn "Could not execute setup-polling.sql via pipe; trying kubectl cp"
    kubectl cp "$DV_DIR/sql/setup-polling.sql" mirth-infra/mysql-0:/tmp/setup-polling.sql
    kubectl exec -n mirth-infra statefulset/mysql -- \
      mysql -umirth -pmirth mirthdb -e "source /tmp/setup-polling.sql"
  }
}
log_ok "DV_POLL_AUDIT table ready"

# ── Step 3: Clean SFTP directories ────────────────────────
log_step "Cleaning SFTP input/output directories..."
kubectl exec -n mirth-infra deployment/sftp -- \
  sh -c 'rm -f /home/nodeuser/input/* /home/nodeuser/output/* 2>/dev/null' || true
log_ok "SFTP directories cleaned"

# ── Step 4: Run Scenarios ──────────────────────────────────
run_scenario() {
  local name="$1"
  local script="$2"
  local ns="$3"

  echo ""
  echo "────────────────────────────────────────────────────"
  echo "  Scenario: $name"
  echo "────────────────────────────────────────────────────"
  echo ""

  if [[ ! -f "$script" ]]; then
    log_error "Script not found: $script"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    return
  fi

  MIRTH_NS="$ns" bash "$script"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
    log_ok "Scenario passed: $name"
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    log_error "Scenario failed: $name (exit code $rc)"
  fi
}

case "$MODE" in
  standalone)
    if [[ "$SKIP_DEPLOY" == "false" ]]; then
      log_step "Deploying cluster overlay..."
      kubectl apply -k "$K8S_DIR/overlays/cluster/"
      log_step "Waiting for Mirth pods..."
      kubectl wait -n mirth-cluster --for=condition=ready pod -l app=node-mirth --timeout=180s
    fi
    run_scenario "Cluster Polling Lease Exclusivity" \
      "$SCENARIOS_DIR/11-cluster-polling/validate-cluster-polling.sh" \
      "mirth-cluster"
    ;;

  takeover)
    if [[ "$SKIP_DEPLOY" == "false" ]]; then
      log_step "Deploying takeover overlay..."
      kubectl apply -k "$K8S_DIR/overlays/takeover/"
      log_step "Waiting for Mirth pod..."
      kubectl wait -n mirth-takeover --for=condition=ready pod -l app=node-mirth --timeout=180s
    fi
    run_scenario "Takeover Mode Polling Guard" \
      "$SCENARIOS_DIR/12-takeover-polling/validate-takeover-polling.sh" \
      "mirth-takeover"
    ;;

  both)
    # Run all three scenarios
    if [[ "$SKIP_DEPLOY" == "false" ]]; then
      log_step "Deploying cluster overlay..."
      kubectl apply -k "$K8S_DIR/overlays/cluster/" 2>/dev/null || true
      kubectl wait -n mirth-cluster --for=condition=ready pod -l app=node-mirth --timeout=180s 2>/dev/null || true
    fi
    run_scenario "Cluster Polling Lease Exclusivity" \
      "$SCENARIOS_DIR/11-cluster-polling/validate-cluster-polling.sh" \
      "mirth-cluster"

    if [[ "$SKIP_DEPLOY" == "false" ]]; then
      log_step "Deploying takeover overlay..."
      kubectl apply -k "$K8S_DIR/overlays/takeover/" 2>/dev/null || true
      kubectl wait -n mirth-takeover --for=condition=ready pod -l app=node-mirth --timeout=180s 2>/dev/null || true
    fi
    run_scenario "Takeover Mode Polling Guard" \
      "$SCENARIOS_DIR/12-takeover-polling/validate-takeover-polling.sh" \
      "mirth-takeover"

    if [[ "$SKIP_DEPLOY" == "false" ]]; then
      log_step "Deploying cluster-takeover overlay..."
      kubectl apply -k "$K8S_DIR/overlays/cluster-takeover/" 2>/dev/null || true
      kubectl wait -n mirth-cluster-takeover --for=condition=ready pod -l app=node-mirth --timeout=180s 2>/dev/null || true
    fi
    run_scenario "Combined Cluster + Takeover Polling" \
      "$SCENARIOS_DIR/13-cluster-takeover-polling/validate-combined.sh" \
      "mirth-cluster-takeover"
    ;;

  *)
    log_error "Unknown mode: $MODE (use: standalone, takeover, both)"
    exit 1
    ;;
esac

# ── Step 5: Final Summary ──────────────────────────────────
echo ""
echo "================================================================"
if [[ "$TOTAL_FAIL" -eq 0 ]]; then
  echo -e "  ${GREEN}POLLING VALIDATION RESULT: ALL $TOTAL_PASS SCENARIOS PASSED${NC}"
else
  echo -e "  ${RED}POLLING VALIDATION RESULT: $TOTAL_FAIL FAILED, $TOTAL_PASS PASSED${NC}"
fi
echo "================================================================"
echo ""

exit "$TOTAL_FAIL"
