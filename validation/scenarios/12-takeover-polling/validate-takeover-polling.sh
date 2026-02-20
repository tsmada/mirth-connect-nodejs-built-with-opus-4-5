#!/usr/bin/env bash
# Takeover Mode Polling Guard Validation
#
# Tests that the TakeoverPollingGuard blocks polling source connectors by default
# in takeover mode, and that explicit enable/disable via API works correctly.
# This prevents competition between Java Mirth's pollers and Node.js pollers
# when both engines share the same database.
#
# Prerequisites:
#   - mirth-takeover overlay deployed (MIRTH_MODE=takeover)
#   - PC01 (File poller) channel deployed and STARTED
#   - SFTP pod running in mirth-infra
#   - DV_POLL_AUDIT table exists in MySQL
#
# Usage:
#   ./validate-takeover-polling.sh
#   MIRTH_NS=mirth-takeover MIRTH_PORT=8080 ./validate-takeover-polling.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/../../.."

# ── Colors ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

log_step()  { echo -e "${CYAN}[STEP]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[PASS]${NC} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail()  { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

MIRTH_NS="${MIRTH_NS:-mirth-takeover}"
MIRTH_PORT="${MIRTH_PORT:-8080}"
SEED_PORT="${SEED_PORT:-8120}"

PC01_CHANNEL_ID="pc000001-0001-0001-0001-000000000001"

# Get a pod name for API calls
get_pod() {
  kubectl get pods -n "$MIRTH_NS" -l app=node-mirth --no-headers -o custom-columns=":metadata.name" | head -1
}

# Execute mysql command
mysql_exec() {
  kubectl exec -n mirth-infra statefulset/mysql -- mysql -umirth -pmirth mirthdb -N -s -e "$1"
}

# API call via kubectl exec inside a Mirth pod
api_call() {
  local method="$1" path="$2" body="${3:-}"
  local pod
  pod=$(get_pod)
  if [[ -n "$body" ]]; then
    kubectl exec -n "$MIRTH_NS" "$pod" -- curl -s -X "$method" \
      "http://localhost:${MIRTH_PORT}${path}" \
      -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null
  else
    kubectl exec -n "$MIRTH_NS" "$pod" -- curl -s -X "$method" \
      "http://localhost:${MIRTH_PORT}${path}" 2>/dev/null
  fi
}

# Seed a file into the SFTP input directory
seed_file() {
  local fileName="$1" content="$2"
  local pod
  pod=$(get_pod)
  kubectl exec -n "$MIRTH_NS" "$pod" -- curl -s -X POST \
    "http://localhost:${SEED_PORT}/seed" \
    -H "Content-Type: application/json" \
    -d "{\"fileName\":\"${fileName}\",\"content\":\"${content}\"}" 2>/dev/null
}

echo ""
echo "================================================================"
echo "  TAKEOVER MODE POLLING GUARD VALIDATION"
echo "  Scenario 12.1 — TakeoverPollingGuard enable/disable"
echo "================================================================"
echo ""

# ── Phase 1: Setup Verification ───────────────────────────
log_step "Phase 1: Setup verification"

# Verify takeover deployment
POD_NAME=$(get_pod 2>/dev/null || echo "")
if [[ -n "$POD_NAME" ]]; then
  log_ok "Takeover Mirth pod running: $POD_NAME"
else
  log_fail "No Mirth pod found in namespace $MIRTH_NS"
  exit 1
fi

# Verify takeover mode
MIRTH_MODE=$(kubectl exec -n "$MIRTH_NS" "$POD_NAME" -- printenv MIRTH_MODE 2>/dev/null || echo "unknown")
if [[ "$MIRTH_MODE" == "takeover" ]]; then
  log_ok "MIRTH_MODE=takeover confirmed"
else
  log_warn "MIRTH_MODE=$MIRTH_MODE (expected 'takeover')"
fi

# Verify DV_POLL_AUDIT table
AUDIT_TABLE_EXISTS=$(mysql_exec "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='mirthdb' AND table_name='DV_POLL_AUDIT';" 2>/dev/null || echo "0")
if [[ "$AUDIT_TABLE_EXISTS" -ge 1 ]]; then
  log_ok "DV_POLL_AUDIT table exists"
else
  log_fail "DV_POLL_AUDIT table not found"
fi

# Truncate for clean test
log_step "Truncating DV_POLL_AUDIT..."
mysql_exec "TRUNCATE TABLE DV_POLL_AUDIT;" 2>/dev/null || log_warn "Could not truncate DV_POLL_AUDIT"

# Clear SFTP directories
kubectl exec -n mirth-infra deployment/sftp -- sh -c 'rm -f /home/nodeuser/input/*.hl7 /home/nodeuser/output/*.hl7' 2>/dev/null || true

echo ""

# ── Phase 2: Blocked by Default ───────────────────────────
log_step "Phase 2: Polling blocked by default in takeover mode"

CR=$'\r'
for i in $(seq 1 5); do
  FILENAME="blocked-$(printf '%03d' "$i")-$(date +%s%N).hl7"
  HL7_CONTENT="MSH|^~\\&|TEST|FACILITY|RECV|DEST|$(date +%Y%m%d%H%M%S)||ADT^A01|BLK$(printf '%03d' "$i")|P|2.5.1${CR}EVN|A01|$(date +%Y%m%d%H%M%S)${CR}PID|||PAT$(printf '%03d' "$i")^^^HOSP||BLOCKED^TEST||19850601|M"
  seed_file "$FILENAME" "$HL7_CONTENT"
done

log_step "Seeded 5 files. Waiting 15s (should NOT be processed)..."
sleep 15

AUDIT_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
if [[ "$AUDIT_COUNT" -eq 0 ]]; then
  log_ok "0 messages processed — takeover guard is blocking polling (correct)"
else
  log_fail "Expected 0 messages (blocked), but found $AUDIT_COUNT in DV_POLL_AUDIT"
fi

# Verify files still in input dir
INPUT_COUNT=$(kubectl exec -n mirth-infra deployment/sftp -- sh -c 'ls /home/nodeuser/input/*.hl7 2>/dev/null | wc -l' 2>/dev/null || echo "0")
if [[ "$INPUT_COUNT" -ge 5 ]]; then
  log_ok "All $INPUT_COUNT files remain in input directory (not consumed)"
else
  log_fail "Expected >= 5 files in input, found $INPUT_COUNT"
fi

echo ""

# ── Phase 3: Enable Polling via API ────────────────────────
log_step "Phase 3: Enable polling for PC01 via API"

ENABLE_RESPONSE=$(api_call POST "/api/system/cluster/polling/enable" "{\"channelId\":\"${PC01_CHANNEL_ID}\"}")
log_step "Enable response: $ENABLE_RESPONSE"

log_step "Waiting 15s for files to be processed after enabling..."
sleep 15

AUDIT_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
if [[ "$AUDIT_COUNT" -ge 5 ]]; then
  log_ok "$AUDIT_COUNT messages processed after enabling polling"
else
  log_fail "Expected >= 5 messages after enabling, found $AUDIT_COUNT"
fi

# Verify input directory emptied
INPUT_COUNT=$(kubectl exec -n mirth-infra deployment/sftp -- sh -c 'ls /home/nodeuser/input/*.hl7 2>/dev/null | wc -l' 2>/dev/null || echo "0")
if [[ "$INPUT_COUNT" -eq 0 ]]; then
  log_ok "Input directory emptied after enabling polling"
else
  log_warn "Input directory still has $INPUT_COUNT files"
fi

echo ""

# ── Phase 4: Disable Polling via API ───────────────────────
log_step "Phase 4: Disable polling for PC01 via API"

PRE_DISABLE_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")

DISABLE_RESPONSE=$(api_call POST "/api/system/cluster/polling/disable" "{\"channelId\":\"${PC01_CHANNEL_ID}\"}")
log_step "Disable response: $DISABLE_RESPONSE"

# Seed 5 more files
for i in $(seq 6 10); do
  FILENAME="disabled-$(printf '%03d' "$i")-$(date +%s%N).hl7"
  HL7_CONTENT="MSH|^~\\&|TEST|FACILITY|RECV|DEST|$(date +%Y%m%d%H%M%S)||ADT^A01|DIS$(printf '%03d' "$i")|P|2.5.1${CR}EVN|A01|$(date +%Y%m%d%H%M%S)${CR}PID|||PAT$(printf '%03d' "$i")^^^HOSP||DISABLED^TEST||19950315|F"
  seed_file "$FILENAME" "$HL7_CONTENT"
done

log_step "Seeded 5 more files. Waiting 15s (should NOT be processed)..."
sleep 15

POST_DISABLE_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
NEW_MESSAGES=$((POST_DISABLE_COUNT - PRE_DISABLE_COUNT))

if [[ "$NEW_MESSAGES" -eq 0 ]]; then
  log_ok "0 new messages after disabling polling (guard re-engaged)"
else
  log_fail "Expected 0 new messages after disabling, found $NEW_MESSAGES"
fi

# Verify new files still in input
INPUT_COUNT=$(kubectl exec -n mirth-infra deployment/sftp -- sh -c 'ls /home/nodeuser/input/*.hl7 2>/dev/null | wc -l' 2>/dev/null || echo "0")
if [[ "$INPUT_COUNT" -ge 5 ]]; then
  log_ok "$INPUT_COUNT files remain in input directory (polling disabled)"
else
  log_fail "Expected >= 5 files in input after disabling, found $INPUT_COUNT"
fi

echo ""

# ── Phase 5: Summary ──────────────────────────────────────
echo ""
echo "================================================================"
echo "  TAKEOVER MODE POLLING GUARD — RESULTS"
echo "================================================================"
echo ""
echo -e "  ${GREEN}PASSED:${NC} $PASS_COUNT"
echo -e "  ${RED}FAILED:${NC} $FAIL_COUNT"
echo ""

if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "  ${GREEN}VERDICT: ALL CHECKS PASSED${NC}"
  exit 0
else
  echo -e "  ${RED}VERDICT: $FAIL_COUNT CHECK(S) FAILED${NC}"
  exit 1
fi
