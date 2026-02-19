#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Master Orchestrator
# =============================================================================
# Runs the full deep validation pipeline sequentially:
#   1. Setup (SQL tables, global maps)
#   2. Deploy channels
#   3. Correctness validation (k6)
#   4. Sustained load (k6, 30 min)
#   5. Spike test (k6)
#   6. Chaos engineering
#   7. Soak test (k6, 30 min or 2 hours with --full-soak)
#   8. Final verification
#   9. Report generation
#
# Usage: run-deep-validation.sh [options]
#   --full-soak       Run 2-hour soak test instead of 30-minute
#   --stage <name>    Run only a specific stage
#   --report-dir <d>  Custom report directory
#   --api-url <url>   Mirth API URL (default: http://localhost:8080)
#   --namespace <ns>  K8s namespace (default: mirth-cluster)
#   --skip-deploy     Skip channel deployment (channels already deployed)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VALIDATION_DIR="$DV_ROOT/validation"
CHAOS_DIR="$DV_ROOT/chaos"

# Defaults
FULL_SOAK=false
STAGE=""
REPORT_DIR="$DV_ROOT/reports"
API_URL="http://localhost:8080"
NAMESPACE="mirth-cluster"
SKIP_DEPLOY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full-soak)
      FULL_SOAK=true
      shift
      ;;
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --report-dir)
      REPORT_DIR="$2"
      shift 2
      ;;
    --api-url)
      API_URL="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --skip-deploy)
      SKIP_DEPLOY=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

export NAMESPACE
export REPORT_DIR
export API_URL

mkdir -p "$REPORT_DIR"

# Track timing
declare -A STAGE_TIMES
OVERALL_START=$(date +%s)

log_stage() {
  local name="$1"
  local status="$2"
  local start="$3"
  local end=$(date +%s)
  local duration=$((end - start))
  STAGE_TIMES["$name"]="${duration}s ($status)"
  echo ""
  echo "  Stage '$name': $status in ${duration}s"
  echo ""
}

should_run() {
  local name="$1"
  if [[ -z "$STAGE" ]] || [[ "$STAGE" == "$name" ]]; then
    return 0
  fi
  return 1
}

# Helper: wait for k6 job to complete
wait_for_k6_job() {
  local job_name="$1"
  local timeout_minutes="${2:-60}"

  echo "  Waiting for k6 job '$job_name' to complete (timeout: ${timeout_minutes}m)..."
  if kubectl wait job -n "$NAMESPACE" "$job_name" \
    --for=condition=complete --timeout="${timeout_minutes}m" 2>/dev/null; then
    echo "  Job '$job_name' completed successfully"
    return 0
  else
    echo "  WARNING: Job '$job_name' did not complete within timeout"
    return 1
  fi
}

echo "============================================================"
echo " Deep Validation Suite - Full Run"
echo "============================================================"
echo "  Timestamp:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  API URL:     $API_URL"
echo "  Namespace:   $NAMESPACE"
echo "  Report Dir:  $REPORT_DIR"
echo "  Full Soak:   $FULL_SOAK"
echo "  Stage:       ${STAGE:-all}"
echo "============================================================"
echo ""

# ==========================================================================
# Stage 1: Setup
# ==========================================================================
if should_run "setup"; then
  echo "================================================================"
  echo " Stage 1: Setup"
  echo "================================================================"
  STAGE_START=$(date +%s)

  "$SCRIPT_DIR/setup.sh" "$API_URL"

  log_stage "setup" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 2: Deploy Channels
# ==========================================================================
if should_run "deploy"; then
  echo "================================================================"
  echo " Stage 2: Deploy Channels"
  echo "================================================================"
  STAGE_START=$(date +%s)

  if [[ "$SKIP_DEPLOY" == "true" ]]; then
    echo "  Skipped (--skip-deploy)"
    log_stage "deploy" "SKIPPED" "$STAGE_START"
  else
    "$SCRIPT_DIR/deploy-channels.sh" "$API_URL"
    log_stage "deploy" "DONE" "$STAGE_START"
  fi
fi

# Quick sanity check after deploy
if should_run "deploy" || should_run "correctness"; then
  echo "  Running quick message check before load tests..."
  "$VALIDATION_DIR/verify-messages.sh" || true
  echo ""
fi

# ==========================================================================
# Stage 3: Correctness Validation
# ==========================================================================
if should_run "correctness"; then
  echo "================================================================"
  echo " Stage 3: Correctness Validation"
  echo "================================================================"
  STAGE_START=$(date +%s)

  # Apply k6 correctness job
  if [[ -f "$DV_ROOT/k6/job-correctness.yaml" ]]; then
    kubectl apply -n "$NAMESPACE" -f "$DV_ROOT/k6/job-correctness.yaml" 2>/dev/null || true
    wait_for_k6_job "dv-k6-correctness" 10
  else
    echo "  WARNING: k6/job-correctness.yaml not found, skipping"
  fi

  # Verify results
  echo "  Running verification after correctness test..."
  "$VALIDATION_DIR/verify-messages.sh" || true

  log_stage "correctness" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 4: Sustained Load
# ==========================================================================
if should_run "sustained"; then
  echo "================================================================"
  echo " Stage 4: Sustained Load (30 minutes)"
  echo "================================================================"
  STAGE_START=$(date +%s)

  if [[ -f "$DV_ROOT/k6/job-sustained-load.yaml" ]]; then
    kubectl apply -n "$NAMESPACE" -f "$DV_ROOT/k6/job-sustained-load.yaml" 2>/dev/null || true
    wait_for_k6_job "dv-k6-sustained-load" 35
  else
    echo "  WARNING: k6/job-sustained-load.yaml not found, skipping"
  fi

  # Verify clean state after sustained load
  echo "  Running verification after sustained load..."
  "$VALIDATION_DIR/verify-messages.sh" || true

  log_stage "sustained" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 5: Spike Test
# ==========================================================================
if should_run "spike"; then
  echo "================================================================"
  echo " Stage 5: Spike Test"
  echo "================================================================"
  STAGE_START=$(date +%s)

  if [[ -f "$DV_ROOT/k6/job-spike-test.yaml" ]]; then
    kubectl apply -n "$NAMESPACE" -f "$DV_ROOT/k6/job-spike-test.yaml" 2>/dev/null || true
    wait_for_k6_job "dv-k6-spike-test" 15
  else
    echo "  WARNING: k6/job-spike-test.yaml not found, skipping"
  fi

  # Verify recovery after spike
  echo "  Running verification after spike test..."
  "$VALIDATION_DIR/verify-messages.sh" || true

  log_stage "spike" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 6: Chaos Engineering
# ==========================================================================
if should_run "chaos"; then
  echo "================================================================"
  echo " Stage 6: Chaos Engineering"
  echo "================================================================"
  STAGE_START=$(date +%s)

  CHAOS_LOG="$REPORT_DIR/chaos-$(date -u +%Y%m%d-%H%M%S).log"

  if [[ -f "$CHAOS_DIR/chaos-orchestrator.sh" ]]; then
    "$CHAOS_DIR/chaos-orchestrator.sh" 2>&1 | tee "$CHAOS_LOG" || true
  else
    echo "  WARNING: chaos/chaos-orchestrator.sh not found, skipping"
  fi

  # Verify recovery after chaos
  echo "  Running recovery verification after chaos..."
  "$VALIDATION_DIR/verify-recovery.sh" || true

  log_stage "chaos" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 7: Soak Test
# ==========================================================================
if should_run "soak"; then
  echo "================================================================"
  if [[ "$FULL_SOAK" == "true" ]]; then
    echo " Stage 7: Soak Test (2 hours)"
    SOAK_TIMEOUT=130
  else
    echo " Stage 7: Soak Test (30 minutes)"
    SOAK_TIMEOUT=35
  fi
  echo "================================================================"
  STAGE_START=$(date +%s)

  if [[ -f "$DV_ROOT/k6/job-soak-test.yaml" ]]; then
    kubectl apply -n "$NAMESPACE" -f "$DV_ROOT/k6/job-soak-test.yaml" 2>/dev/null || true
    wait_for_k6_job "dv-k6-soak-test" "$SOAK_TIMEOUT"
  else
    echo "  WARNING: k6/job-soak-test.yaml not found, skipping"
  fi

  # Verify after soak
  echo "  Running verification after soak test..."
  "$VALIDATION_DIR/verify-messages.sh" || true

  log_stage "soak" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 8: Final Verification
# ==========================================================================
if should_run "verify"; then
  echo "================================================================"
  echo " Stage 8: Final Verification"
  echo "================================================================"
  STAGE_START=$(date +%s)

  "$VALIDATION_DIR/verify-all.sh" || true

  log_stage "verify" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Stage 9: Report Generation
# ==========================================================================
if should_run "report"; then
  echo "================================================================"
  echo " Stage 9: Report Generation"
  echo "================================================================"
  STAGE_START=$(date +%s)

  REPORT_ARGS=""
  if [[ -n "${CHAOS_LOG:-}" ]] && [[ -f "${CHAOS_LOG:-}" ]]; then
    REPORT_ARGS="--chaos-log $CHAOS_LOG"
  fi

  "$VALIDATION_DIR/generate-report.sh" $REPORT_ARGS || true

  log_stage "report" "DONE" "$STAGE_START"
fi

# ==========================================================================
# Summary
# ==========================================================================
OVERALL_END=$(date +%s)
OVERALL_DURATION=$((OVERALL_END - OVERALL_START))

echo ""
echo "============================================================"
echo " Deep Validation Complete"
echo "============================================================"
echo ""
printf "  %-20s %s\n" "STAGE" "DURATION (STATUS)"
printf "  %-20s %s\n" "--------------------" "-------------------"
for stage_name in setup deploy correctness sustained spike chaos soak verify report; do
  if [[ -n "${STAGE_TIMES[$stage_name]:-}" ]]; then
    printf "  %-20s %s\n" "$stage_name" "${STAGE_TIMES[$stage_name]}"
  fi
done
echo ""
printf "  %-20s %s\n" "TOTAL" "${OVERALL_DURATION}s"
echo ""
echo "  Reports: $REPORT_DIR/"
echo "============================================================"
