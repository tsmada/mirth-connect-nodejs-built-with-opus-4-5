#!/usr/bin/env bash
# =============================================================================
# Chaos Orchestrator: Run All Chaos Scenarios Sequentially
# =============================================================================
# Runs each chaos test in sequence with verification between tests, collects
# outputs into a timestamped report directory, and prints a summary.
#
# Usage:
#   ./chaos-orchestrator.sh                            # Run all tests
#   ./chaos-orchestrator.sh --skip-memory              # Skip memory pressure test
#   ./chaos-orchestrator.sh --report-dir /tmp/chaos    # Custom report location
#   ./chaos-orchestrator.sh --skip-memory --report-dir ./my-reports
#
# Prerequisites:
#   - All chaos scripts in the same directory as this script
#   - kubectl configured for the target cluster
#   - verify-recovery.sh and verify-all.sh in ../scripts/ (if available)
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MIRTH_API_PORT="${MIRTH_API_PORT:-8080}"

# Parse arguments
SKIP_MEMORY=0
REPORT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-memory)
      SKIP_MEMORY=1
      shift
      ;;
    --report-dir)
      REPORT_DIR="$2"
      shift 2
      ;;
    --report-dir=*)
      REPORT_DIR="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--skip-memory] [--report-dir <path>]"
      echo ""
      echo "Options:"
      echo "  --skip-memory    Skip the memory pressure test (can OOM and destabilize)"
      echo "  --report-dir     Custom output location for reports (default: ./reports/chaos-<timestamp>)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Resolve script directory (where chaos scripts live)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

# Set up report directory
TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
if [[ -z "$REPORT_DIR" ]]; then
  REPORT_DIR="${PARENT_DIR}/reports/chaos-${TIMESTAMP}"
fi
mkdir -p "$REPORT_DIR"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
header() { echo ""; echo "$(ts) ================================================================"; echo "$(ts)   $1"; echo "$(ts) ================================================================"; }

# Track results
declare -A RESULTS
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0

run_scenario() {
  local name="$1"
  local script="$2"
  local output_file="${REPORT_DIR}/${name}.log"

  header "SCENARIO: $name"

  if [[ ! -x "$script" ]]; then
    echo "$(ts) ERROR: Script not found or not executable: $script"
    RESULTS["$name"]="ERROR"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    return
  fi

  echo "$(ts) Running: $script"
  echo "$(ts) Output:  $output_file"
  echo ""

  # Run the scenario, capturing output
  set +e
  NAMESPACE="$NAMESPACE" MYSQL_NAMESPACE="$MYSQL_NAMESPACE" \
    "$script" 2>&1 | tee "$output_file"
  EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [[ "$EXIT_CODE" -eq 0 ]]; then
    RESULTS["$name"]="PASS"
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    RESULTS["$name"]="FAIL"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi

  echo ""
  echo "$(ts) Scenario '$name' completed with exit code: $EXIT_CODE"

  # Inter-scenario recovery check
  echo "$(ts) Running inter-scenario health check..."
  sleep 5
  verify_health
}

verify_health() {
  local mirth_pod
  mirth_pod=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o name --field-selector=status.phase=Running 2>/dev/null | head -1)

  if [[ -z "$mirth_pod" ]]; then
    echo "$(ts) WARNING: No running Mirth pod found for health check"
    return
  fi

  local health
  health=$(kubectl exec -n "$NAMESPACE" "$mirth_pod" -- \
    wget -q -S -O /dev/null --timeout=5 "http://localhost:${MIRTH_API_PORT}/api/health" 2>&1 || true)

  if echo "$health" | grep -q "200 OK"; then
    echo "$(ts) Inter-scenario health: OK"
  else
    echo "$(ts) WARNING: Inter-scenario health check not 200 -- waiting 30s before next scenario"
    sleep 30
  fi
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

header "CHAOS ORCHESTRATOR STARTING"

echo "$(ts) Namespace:       $NAMESPACE"
echo "$(ts) MySQL Namespace: $MYSQL_NAMESPACE"
echo "$(ts) Report Dir:      $REPORT_DIR"
echo "$(ts) Skip Memory:     $SKIP_MEMORY"
echo "$(ts) Timestamp:       $TIMESTAMP"
echo ""

# Record initial cluster state
echo "$(ts) Initial cluster state:" | tee "${REPORT_DIR}/initial-state.log"
kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o wide 2>&1 | tee -a "${REPORT_DIR}/initial-state.log"

# ---- Scenario 1: Pod Kill ----
run_scenario "pod-kill" "${SCRIPT_DIR}/pod-kill.sh"

# ---- Scenario 2: MySQL Restart ----
run_scenario "mysql-restart" "${SCRIPT_DIR}/mysql-restart.sh"

# ---- Scenario 3: Scale Down Under Load ----
run_scenario "scale-down-under-load" "${SCRIPT_DIR}/scale-down-under-load.sh"

# ---- Scenario 4: Memory Pressure (Optional) ----
if [[ "$SKIP_MEMORY" -eq 1 ]]; then
  echo ""
  echo "$(ts) SKIPPING memory-pressure (--skip-memory flag)"
  RESULTS["memory-pressure"]="SKIP"
  TOTAL_SKIP=$((TOTAL_SKIP + 1))
else
  run_scenario "memory-pressure" "${SCRIPT_DIR}/memory-pressure.sh"
  # Memory test always exits 0 (informational) -- mark accordingly
  RESULTS["memory-pressure"]="INFO"
fi

# ---- Scenario 5: Network Partition ----
run_scenario "network-partition" "${SCRIPT_DIR}/network-partition.sh"

# ---- Final Verification ----
header "FINAL VERIFICATION"

echo "$(ts) Final cluster state:" | tee "${REPORT_DIR}/final-state.log"
kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o wide 2>&1 | tee -a "${REPORT_DIR}/final-state.log"

# Check if verify-all.sh exists in parent scripts dir
VERIFY_ALL="${PARENT_DIR}/scripts/verify-all.sh"
if [[ -x "$VERIFY_ALL" ]]; then
  echo "$(ts) Running verify-all.sh..."
  NAMESPACE="$NAMESPACE" MYSQL_NAMESPACE="$MYSQL_NAMESPACE" \
    "$VERIFY_ALL" 2>&1 | tee "${REPORT_DIR}/verify-all.log" || true
else
  echo "$(ts) verify-all.sh not found at $VERIFY_ALL -- skipping master verification"
fi

# =============================================================================
# SUMMARY
# =============================================================================

header "CHAOS ORCHESTRATOR SUMMARY"

echo "$(ts) Report directory: $REPORT_DIR"
echo ""
echo "$(ts) Scenario Results:"
echo "$(ts) +--------------------------+--------+"

# Print results in execution order
for scenario in pod-kill mysql-restart scale-down-under-load memory-pressure network-partition; do
  result="${RESULTS[$scenario]:-N/A}"
  printf "$(ts) | %-24s | %-6s |\n" "$scenario" "$result"
done

echo "$(ts) +--------------------------+--------+"
echo ""
echo "$(ts) Totals: PASS=$TOTAL_PASS  FAIL=$TOTAL_FAIL  SKIP=$TOTAL_SKIP"
echo ""

# Write machine-readable summary
cat > "${REPORT_DIR}/summary.json" <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "namespace": "${NAMESPACE}",
  "results": {
    "pod-kill": "${RESULTS[pod-kill]:-N/A}",
    "mysql-restart": "${RESULTS[mysql-restart]:-N/A}",
    "scale-down-under-load": "${RESULTS[scale-down-under-load]:-N/A}",
    "memory-pressure": "${RESULTS[memory-pressure]:-N/A}",
    "network-partition": "${RESULTS[network-partition]:-N/A}"
  },
  "totals": {
    "pass": ${TOTAL_PASS},
    "fail": ${TOTAL_FAIL},
    "skip": ${TOTAL_SKIP}
  }
}
EOF

echo "$(ts) Summary written to: ${REPORT_DIR}/summary.json"

# Report files listing
echo ""
echo "$(ts) Report files:"
ls -la "$REPORT_DIR"

if [[ "$TOTAL_FAIL" -gt 0 ]]; then
  echo ""
  echo "$(ts) OVERALL RESULT: FAIL ($TOTAL_FAIL scenario(s) failed)"
  exit 1
else
  echo ""
  echo "$(ts) OVERALL RESULT: PASS (all scenarios passed)"
  exit 0
fi
