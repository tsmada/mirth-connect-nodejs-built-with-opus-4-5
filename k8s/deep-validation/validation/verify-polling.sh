#!/usr/bin/env bash
# =============================================================================
# Polling Coordination: SQL Verification Script
# =============================================================================
# Standalone script that checks DV_POLL_AUDIT and D_POLLING_LEASES for:
#   1. No duplicate file processing
#   2. Lease uniqueness per channel
#   3. Lease holder matches processor
#   4. Summary statistics
#
# Usage:
#   ./verify-polling.sh                    # Check all
#   ./verify-polling.sh --expected-files 20 # Verify exact file count
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
EXPECTED_FILES="${1:---expected-files}"
EXPECTED_COUNT="${2:-0}"

# Parse args
for i in "$@"; do
  case "$i" in
    --expected-files) shift; EXPECTED_COUNT="${1:-0}"; shift || true ;;
    --expected-files=*) EXPECTED_COUNT="${i#*=}" ;;
  esac
done

log_ok()   { echo -e "${GREEN}[PASS]${NC} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
log_step() { echo -e "${CYAN}[CHECK]${NC} $1"; }
log_info() { echo -e "  $1"; }

mysql_exec() {
  kubectl exec -n mirth-infra statefulset/mysql -- \
    mysql -umirth -pmirth mirthdb -N -s -e "$1" 2>/dev/null
}

echo ""
echo "================================================================"
echo "  POLLING COORDINATION — SQL VERIFICATION"
echo "================================================================"
echo ""

# ── Check 1: No duplicate file processing ─────────────────
log_step "Checking for duplicate file processing..."
DUPES=$(mysql_exec "SELECT COUNT(*) FROM (SELECT FILE_NAME FROM DV_POLL_AUDIT GROUP BY FILE_NAME HAVING COUNT(*) > 1) AS d;")

if [[ "$DUPES" == "0" ]]; then
  log_ok "No duplicate file processing detected"
else
  log_fail "DUPLICATE PROCESSING: $DUPES files processed more than once"
  mysql_exec "SELECT FILE_NAME, COUNT(*) AS cnt, GROUP_CONCAT(DISTINCT SERVER_ID) AS servers FROM DV_POLL_AUDIT GROUP BY FILE_NAME HAVING COUNT(*) > 1 LIMIT 10;" | while read -r line; do
    log_info "  $line"
  done
fi

# ── Check 2: Lease uniqueness per channel ──────────────────
log_step "Checking lease uniqueness per channel..."
LEASE_COUNT=$(mysql_exec "SELECT COUNT(*) FROM D_POLLING_LEASES;")
CHANNEL_COUNT=$(mysql_exec "SELECT COUNT(DISTINCT CHANNEL_ID) FROM D_POLLING_LEASES;")

if [[ "$LEASE_COUNT" == "$CHANNEL_COUNT" ]]; then
  log_ok "Exactly 1 lease per channel ($LEASE_COUNT leases for $CHANNEL_COUNT channels)"
else
  log_fail "Lease count ($LEASE_COUNT) != channel count ($CHANNEL_COUNT)"
fi

# ── Check 3: Lease holder matches processor ────────────────
log_step "Checking lease holder matches audit trail processor..."
MISMATCHES=$(mysql_exec "SELECT COUNT(*) FROM (SELECT l.SERVER_ID AS lh, a.SERVER_ID AS pr FROM D_POLLING_LEASES l JOIN DV_POLL_AUDIT a ON l.CHANNEL_ID = a.CHANNEL_ID WHERE l.SERVER_ID != a.SERVER_ID GROUP BY l.SERVER_ID, a.SERVER_ID) AS m;")

if [[ "$MISMATCHES" == "0" ]]; then
  log_ok "Lease holder matches processor in all audit rows"
else
  log_fail "Lease-processor mismatch: $MISMATCHES groups"
fi

# ── Check 4: Expected file count (optional) ────────────────
if [[ "$EXPECTED_COUNT" -gt 0 ]]; then
  log_step "Checking expected file count ($EXPECTED_COUNT)..."
  ACTUAL=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;")
  if [[ "$ACTUAL" == "$EXPECTED_COUNT" ]]; then
    log_ok "File count matches: $ACTUAL / $EXPECTED_COUNT"
  else
    log_fail "File count mismatch: $ACTUAL actual vs $EXPECTED_COUNT expected"
  fi
fi

# ── Summary ────────────────────────────────────────────────
echo ""
log_step "Summary statistics:"
TOTAL=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;")
UNIQUE_FILES=$(mysql_exec "SELECT COUNT(DISTINCT FILE_NAME) FROM DV_POLL_AUDIT;")
SERVERS=$(mysql_exec "SELECT COUNT(DISTINCT SERVER_ID) FROM DV_POLL_AUDIT;")
log_info "Total processed:    $TOTAL"
log_info "Unique files:       $UNIQUE_FILES"
log_info "Distinct servers:   $SERVERS"

LEASES=$(mysql_exec "SELECT CHANNEL_ID, SERVER_ID, RENEWED_AT, EXPIRES_AT FROM D_POLLING_LEASES;" 2>/dev/null || echo "(none)")
log_info "Active leases:"
echo "$LEASES" | while read -r line; do
  log_info "  $line"
done

echo ""
echo "================================================================"
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "  ${GREEN}RESULT: ALL $PASS_COUNT CHECKS PASSED${NC}"
else
  echo -e "  ${RED}RESULT: $FAIL_COUNT FAILED, $PASS_COUNT PASSED${NC}"
fi
echo "================================================================"
echo ""

exit "$FAIL_COUNT"
