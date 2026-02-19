#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Master Verification
# =============================================================================
# Runs all verification checks and produces a JSON summary report.
# Individual check failures do not stop subsequent checks.
#
# Output: JSON report to reports/ directory + summary table to stdout
# Exit 0 = all pass, Exit 1 = any check failed
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$DV_ROOT/reports}"

mkdir -p "$REPORT_DIR"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REPORT_FILE="$REPORT_DIR/verification-$(date -u +%Y%m%d-%H%M%S).json"

echo "=== Master Verification ==="
echo "  Timestamp: $TIMESTAMP"
echo "  Report:    $REPORT_FILE"
echo ""

# ── Run each check, capture exit code and output ───────────────────────────

run_check() {
  local name="$1"
  local script="$2"
  local start_time end_time duration exit_code output

  echo "--- Running: $name ---"
  start_time=$(date +%s)

  # Run the check and capture output + exit code
  set +e
  output=$("$script" 2>&1)
  exit_code=$?
  set -e

  end_time=$(date +%s)
  duration=$((end_time - start_time))

  echo "$output"
  echo ""
  echo "  Duration: ${duration}s, Exit: $exit_code"
  echo ""

  # Return results via global variables (bash doesn't have proper return values)
  _CHECK_EXIT=$exit_code
  _CHECK_DURATION=$duration
  _CHECK_OUTPUT="$output"
}

# Messages check
MSG_STATUS="PASS"
MSG_DETAILS=""
MSG_DURATION=0
run_check "Message Verification" "$SCRIPT_DIR/verify-messages.sh"
MSG_EXIT=$_CHECK_EXIT
MSG_DURATION=$_CHECK_DURATION
if [[ $MSG_EXIT -ne 0 ]]; then
  MSG_STATUS="FAIL"
fi
MSG_DETAILS=$(echo "$_CHECK_OUTPUT" | tail -5 | tr '\n' ' ')

# Statistics check
STAT_STATUS="PASS"
STAT_DETAILS=""
STAT_DURATION=0
run_check "Statistics Verification" "$SCRIPT_DIR/verify-statistics.sh"
STAT_EXIT=$_CHECK_EXIT
STAT_DURATION=$_CHECK_DURATION
if [[ $STAT_EXIT -ne 0 ]]; then
  STAT_STATUS="FAIL"
fi
STAT_DETAILS=$(echo "$_CHECK_OUTPUT" | tail -5 | tr '\n' ' ')

# Integrity check
INT_STATUS="PASS"
INT_DETAILS=""
INT_DURATION=0
run_check "Integrity Verification" "$SCRIPT_DIR/verify-integrity.sh"
INT_EXIT=$_CHECK_EXIT
INT_DURATION=$_CHECK_DURATION
if [[ $INT_EXIT -ne 0 ]]; then
  INT_STATUS="FAIL"
fi
INT_DETAILS=$(echo "$_CHECK_OUTPUT" | tail -5 | tr '\n' ' ')

# ── Determine overall result ──────────────────────────────────────────────
OVERALL="PASS"
if [[ "$MSG_STATUS" == "FAIL" ]] || [[ "$STAT_STATUS" == "FAIL" ]] || [[ "$INT_STATUS" == "FAIL" ]]; then
  OVERALL="FAIL"
fi

# ── Write JSON report ─────────────────────────────────────────────────────

# Escape strings for JSON (basic: replace quotes and newlines)
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/ }"
  echo "$s"
}

cat > "$REPORT_FILE" << JSONEOF
{
  "timestamp": "$TIMESTAMP",
  "results": {
    "messages": {
      "status": "$MSG_STATUS",
      "duration_seconds": $MSG_DURATION,
      "details": "$(json_escape "$MSG_DETAILS")"
    },
    "statistics": {
      "status": "$STAT_STATUS",
      "duration_seconds": $STAT_DURATION,
      "details": "$(json_escape "$STAT_DETAILS")"
    },
    "integrity": {
      "status": "$INT_STATUS",
      "duration_seconds": $INT_DURATION,
      "details": "$(json_escape "$INT_DETAILS")"
    }
  },
  "overall": "$OVERALL"
}
JSONEOF

echo "=== Verification Report Written ==="
echo "  File: $REPORT_FILE"
echo ""

# ── Summary table ──────────────────────────────────────────────────────────
echo "=== Verification Summary ==="
echo ""
printf "  %-20s %-8s %8s\n" "CHECK" "STATUS" "DURATION"
printf "  %-20s %-8s %8s\n" "--------------------" "--------" "--------"
printf "  %-20s %-8s %7ds\n" "Messages" "$MSG_STATUS" "$MSG_DURATION"
printf "  %-20s %-8s %7ds\n" "Statistics" "$STAT_STATUS" "$STAT_DURATION"
printf "  %-20s %-8s %7ds\n" "Integrity" "$INT_STATUS" "$INT_DURATION"
echo ""
printf "  %-20s %-8s\n" "OVERALL" "$OVERALL"
echo ""

if [[ "$OVERALL" == "FAIL" ]]; then
  echo "=== RESULT: FAIL ==="
  exit 1
else
  echo "=== RESULT: PASS ==="
  exit 0
fi
