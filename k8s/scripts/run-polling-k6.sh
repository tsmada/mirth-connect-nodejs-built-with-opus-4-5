#!/usr/bin/env bash
# =============================================================================
# Polling Coordination k6 Load Tests — Orchestrator
# =============================================================================
# Runs k6 load tests targeting polling coordination:
#   - coordination: Seeds files under load, verifies exclusive processing
#   - failover: Seeds files continuously while killing the lease-holder pod
#
# Usage:
#   ./run-polling-k6.sh                        # Default: coordination test
#   ./run-polling-k6.sh --test coordination    # Coordination test only
#   ./run-polling-k6.sh --test failover        # Failover test only
#   ./run-polling-k6.sh --test both            # Both tests
#   ./run-polling-k6.sh --quick                # Quick mode (shorter durations)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/.."
DV_DIR="$K8S_DIR/deep-validation"

TEST_TYPE="coordination"
QUICK_MODE=false

for arg in "$@"; do
  case "$arg" in
    --test) shift; TEST_TYPE="${1:-coordination}"; shift || true ;;
    --test=*) TEST_TYPE="${arg#*=}" ;;
    --quick) QUICK_MODE=true ;;
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

NAMESPACE="mirth-k6"
MIRTH_NS="mirth-cluster"

echo ""
echo "================================================================"
echo "  POLLING COORDINATION k6 LOAD TESTS"
echo "  Test: $TEST_TYPE"
echo "================================================================"
echo ""

# ── Prerequisites ──────────────────────────────────────────
log_step "Verifying cluster is ready..."
kubectl wait -n "$MIRTH_NS" --for=condition=ready pod -l app=node-mirth --timeout=60s 2>/dev/null || {
  log_error "Mirth pods not ready in $MIRTH_NS. Deploy cluster overlay first."
  exit 1
}
POD_COUNT=$(kubectl get pods -n "$MIRTH_NS" -l app=node-mirth --no-headers 2>/dev/null | wc -l | tr -d ' ')
log_ok "Cluster ready ($POD_COUNT pods)"

# ── Clean State ────────────────────────────────────────────
log_step "Truncating DV_POLL_AUDIT and D_POLLING_LEASES..."
kubectl exec -n mirth-infra statefulset/mysql -- \
  mysql -umirth -pmirth mirthdb -e "TRUNCATE TABLE DV_POLL_AUDIT; TRUNCATE TABLE D_POLLING_LEASES;" 2>/dev/null || {
  log_warn "Could not truncate tables (may not exist yet)"
}

log_step "Cleaning SFTP directories..."
kubectl exec -n mirth-infra deployment/sftp -- \
  sh -c 'rm -f /home/nodeuser/input/* /home/nodeuser/output/* 2>/dev/null' || true

# ── Apply k6 manifests ────────────────────────────────────
log_step "Applying k6 namespace and scripts..."
kubectl apply -f "$K8S_DIR/k6/namespace.yaml"
kubectl apply -f "$K8S_DIR/k6/configmap-polling.yaml"

# ── Run Tests ──────────────────────────────────────────────
run_k6_job() {
  local job_name="$1"
  local job_file="$2"
  local timeout="${3:-600}"

  log_step "Starting k6 job: $job_name..."

  # Delete previous run
  kubectl delete job "$job_name" -n "$NAMESPACE" --timeout=30s 2>/dev/null || true
  sleep 3

  kubectl apply -f "$job_file"

  # Wait for k6 pod
  log_step "Waiting for k6 pod to start..."
  local elapsed=0
  local pod_name=""
  while [[ $elapsed -lt 120 ]]; do
    pod_name=$(kubectl get pods -n "$NAMESPACE" -l "job-name=$job_name" \
      --no-headers -o custom-columns=":metadata.name" 2>/dev/null | head -1)
    if [[ -n "$pod_name" ]]; then
      local phase
      phase=$(kubectl get pod "$pod_name" -n "$NAMESPACE" \
        -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
      if [[ "$phase" != "Pending" ]]; then
        break
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  if [[ -z "$pod_name" ]]; then
    log_error "k6 pod did not appear within 120s"
    return 1
  fi

  log_ok "k6 pod started: $pod_name"
  echo ""
  echo "──────────────── k6 output ────────────────────────────"

  # Stream k6 output
  kubectl logs -n "$NAMESPACE" "$pod_name" --follow 2>/dev/null || true

  echo "──────────────── end k6 output ────────────────────────"

  # Check job status
  local job_status
  job_status=$(kubectl get job "$job_name" -n "$NAMESPACE" \
    -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)
  if [[ "$job_status" == "True" ]]; then
    log_ok "k6 job completed: $job_name"
    return 0
  else
    log_error "k6 job failed: $job_name"
    return 1
  fi
}

run_coordination_test() {
  run_k6_job "k6-polling-coordination" "$K8S_DIR/k6/job-polling-coordination.yaml" 600

  # Post-test SQL verification
  echo ""
  log_step "Running SQL verification..."
  bash "$DV_DIR/validation/verify-polling.sh"
}

run_failover_test() {
  # Start the k6 job
  kubectl delete job "k6-polling-failover" -n "$NAMESPACE" --timeout=30s 2>/dev/null || true
  sleep 3
  kubectl apply -f "$K8S_DIR/k6/job-polling-failover.yaml"

  # Wait for k6 pod to start
  log_step "Waiting for k6 failover pod..."
  sleep 15
  local k6_pod
  k6_pod=$(kubectl get pods -n "$NAMESPACE" -l "job-name=k6-polling-failover" \
    --no-headers -o custom-columns=":metadata.name" 2>/dev/null | head -1)

  if [[ -z "$k6_pod" ]]; then
    log_error "k6 failover pod did not appear"
    return 1
  fi
  log_ok "k6 failover pod started: $k6_pod"

  # Wait 60s into the test, then kill the lease holder
  log_step "Waiting 60s before killing lease holder pod..."
  sleep 60

  # Find lease holder
  local holder_pod
  holder_pod=$(kubectl exec -n mirth-infra statefulset/mysql -- \
    mysql -umirth -pmirth mirthdb -N -s -e \
    "SELECT SERVER_ID FROM D_POLLING_LEASES LIMIT 1;" 2>/dev/null)

  if [[ -n "$holder_pod" ]]; then
    log_step "Killing lease holder pod: $holder_pod"
    kubectl delete pod "$holder_pod" -n "$MIRTH_NS" --grace-period=0 --force 2>/dev/null || {
      log_warn "Could not force-delete pod (may have been restarted)"
    }
    log_ok "Lease holder pod killed"
  else
    log_warn "No lease holder found — skipping pod kill"
  fi

  # Wait for k6 to complete
  log_step "Waiting for k6 failover test to complete..."
  kubectl wait --for=condition=complete job/k6-polling-failover -n "$NAMESPACE" --timeout=300s 2>/dev/null || {
    log_warn "k6 job did not complete cleanly"
  }

  # Show k6 output
  echo ""
  echo "──────────────── k6 failover output ────────────────────"
  kubectl logs -n "$NAMESPACE" "$k6_pod" 2>/dev/null || true
  echo "──────────────── end k6 failover output ────────────────"

  # Post-test SQL verification
  echo ""
  log_step "Running SQL verification after failover..."
  bash "$DV_DIR/validation/verify-polling.sh"
}

case "$TEST_TYPE" in
  coordination)
    run_coordination_test
    ;;
  failover)
    run_failover_test
    ;;
  both)
    run_coordination_test
    echo ""
    echo "────────────────────────────────────────────────────"
    echo ""
    # Reset state between tests
    kubectl exec -n mirth-infra statefulset/mysql -- \
      mysql -umirth -pmirth mirthdb -e "TRUNCATE TABLE DV_POLL_AUDIT;" 2>/dev/null || true
    kubectl exec -n mirth-infra deployment/sftp -- \
      sh -c 'rm -f /home/nodeuser/input/* /home/nodeuser/output/* 2>/dev/null' || true
    run_failover_test
    ;;
  *)
    log_error "Unknown test type: $TEST_TYPE (use: coordination, failover, both)"
    exit 1
    ;;
esac

echo ""
echo "================================================================"
echo -e "  ${GREEN}POLLING k6 TESTS COMPLETE${NC}"
echo "================================================================"
echo ""
