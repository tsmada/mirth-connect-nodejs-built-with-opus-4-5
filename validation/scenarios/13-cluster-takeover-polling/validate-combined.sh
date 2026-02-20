#!/usr/bin/env bash
# Combined Cluster + Takeover Polling Validation
#
# Tests the interaction of BOTH guards simultaneously: TakeoverPollingGuard blocks
# by default, then after explicit enable, PollingLeaseManager ensures only one of
# N replicas actually polls. This is the most restrictive mode — both guards must
# be satisfied before a polling source connector starts.
#
# Interaction matrix:
#   takeover guard BLOCKED + lease N/A  => NO polling
#   takeover guard ENABLED + lease HELD => ONE instance polls
#   takeover guard ENABLED + pod dies   => Lease failover to surviving instance
#
# Prerequisites:
#   - cluster-takeover overlay deployed (MIRTH_MODE=takeover + MIRTH_CLUSTER_ENABLED=true)
#   - 2+ replicas running
#   - PC01 (File poller) channel deployed and STARTED
#   - SFTP pod running in mirth-infra
#   - DV_POLL_AUDIT table exists in MySQL
#
# Usage:
#   ./validate-combined.sh
#   MIRTH_NS=mirth-cluster-takeover ./validate-combined.sh
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

MIRTH_NS="${MIRTH_NS:-mirth-cluster-takeover}"
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
echo "  COMBINED CLUSTER + TAKEOVER POLLING VALIDATION"
echo "  Scenario 13.1 — Both guards active simultaneously"
echo "================================================================"
echo ""

# ── Phase 1: Setup Verification ───────────────────────────
log_step "Phase 1: Setup verification"

# Verify replicas (need at least 2)
REPLICA_COUNT=$(kubectl get pods -n "$MIRTH_NS" -l app=node-mirth --no-headers 2>/dev/null | grep -c "Running" || echo "0")
if [[ "$REPLICA_COUNT" -ge 2 ]]; then
  log_ok "Cluster has $REPLICA_COUNT running replicas (>= 2 required)"
else
  log_fail "Cluster has $REPLICA_COUNT running replicas (need >= 2)"
  echo "  Pods:"
  kubectl get pods -n "$MIRTH_NS" -l app=node-mirth 2>/dev/null
fi

# Verify takeover mode
POD_NAME=$(get_pod 2>/dev/null || echo "")
if [[ -n "$POD_NAME" ]]; then
  MIRTH_MODE=$(kubectl exec -n "$MIRTH_NS" "$POD_NAME" -- printenv MIRTH_MODE 2>/dev/null || echo "unknown")
  CLUSTER_ENABLED=$(kubectl exec -n "$MIRTH_NS" "$POD_NAME" -- printenv MIRTH_CLUSTER_ENABLED 2>/dev/null || echo "unknown")
  if [[ "$MIRTH_MODE" == "takeover" ]]; then
    log_ok "MIRTH_MODE=takeover confirmed"
  else
    log_warn "MIRTH_MODE=$MIRTH_MODE (expected 'takeover')"
  fi
  if [[ "$CLUSTER_ENABLED" == "true" ]]; then
    log_ok "MIRTH_CLUSTER_ENABLED=true confirmed"
  else
    log_warn "MIRTH_CLUSTER_ENABLED=$CLUSTER_ENABLED (expected 'true')"
  fi
else
  log_fail "No Mirth pod found in namespace $MIRTH_NS"
  exit 1
fi

# Truncate tables
log_step "Truncating DV_POLL_AUDIT and D_POLLING_LEASES..."
mysql_exec "TRUNCATE TABLE DV_POLL_AUDIT;" 2>/dev/null || log_warn "Could not truncate DV_POLL_AUDIT"
mysql_exec "DELETE FROM D_POLLING_LEASES;" 2>/dev/null || log_warn "Could not clear D_POLLING_LEASES"

# Clear SFTP directories
kubectl exec -n mirth-infra deployment/sftp -- sh -c 'rm -f /home/nodeuser/input/*.hl7 /home/nodeuser/output/*.hl7' 2>/dev/null || true

echo ""

# ── Phase 2: Both Guards Block ─────────────────────────────
log_step "Phase 2: Both guards block polling (takeover guard + no lease)"

CR=$'\r'
for i in $(seq 1 5); do
  FILENAME="both-blocked-$(printf '%03d' "$i")-$(date +%s%N).hl7"
  HL7_CONTENT="MSH|^~\\&|TEST|FACILITY|RECV|DEST|$(date +%Y%m%d%H%M%S)||ADT^A01|BBL$(printf '%03d' "$i")|P|2.5.1${CR}EVN|A01|$(date +%Y%m%d%H%M%S)${CR}PID|||PAT$(printf '%03d' "$i")^^^HOSP||BOTH^BLOCKED||19880101|M"
  seed_file "$FILENAME" "$HL7_CONTENT"
done

log_step "Seeded 5 files. Waiting 15s (both guards should block)..."
sleep 15

AUDIT_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
if [[ "$AUDIT_COUNT" -eq 0 ]]; then
  log_ok "0 messages processed — takeover guard blocks before lease check"
else
  log_fail "Expected 0 messages (both blocked), found $AUDIT_COUNT"
fi

LEASE_COUNT=$(mysql_exec "SELECT COUNT(*) FROM D_POLLING_LEASES WHERE CHANNEL_ID='${PC01_CHANNEL_ID}';" 2>/dev/null || echo "0")
if [[ "$LEASE_COUNT" -eq 0 ]]; then
  log_ok "No lease acquired (takeover guard prevents lease acquisition)"
else
  log_warn "Lease row exists ($LEASE_COUNT) even though takeover guard should block first"
fi

echo ""

# ── Phase 3: Enable Polling + Lease Acquisition ────────────
log_step "Phase 3: Enable polling — takeover guard passes, lease manager activates"

ENABLE_RESPONSE=$(api_call POST "/api/system/cluster/polling/enable" "{\"channelId\":\"${PC01_CHANNEL_ID}\"}")
log_step "Enable response: $ENABLE_RESPONSE"

log_step "Waiting 15s for lease acquisition and file processing..."
sleep 15

# Verify exactly 1 lease
LEASE_COUNT=$(mysql_exec "SELECT COUNT(*) FROM D_POLLING_LEASES WHERE CHANNEL_ID='${PC01_CHANNEL_ID}';" 2>/dev/null || echo "0")
if [[ "$LEASE_COUNT" -eq 1 ]]; then
  log_ok "Exactly 1 lease row in D_POLLING_LEASES (exclusive)"
else
  log_fail "Expected 1 lease row, found $LEASE_COUNT"
fi

# Identify lease holder
LEASE_HOLDER=$(mysql_exec "SELECT SERVER_ID FROM D_POLLING_LEASES WHERE CHANNEL_ID='${PC01_CHANNEL_ID}' LIMIT 1;" 2>/dev/null || echo "")
if [[ -n "$LEASE_HOLDER" ]]; then
  log_ok "Lease acquired by SERVER_ID: $LEASE_HOLDER"
else
  log_fail "No lease holder found"
fi

# Verify only 1 of 2 instances holds it
ALL_PODS=$(kubectl get pods -n "$MIRTH_NS" -l app=node-mirth --no-headers -o custom-columns=":metadata.name" 2>/dev/null)
POD_COUNT=$(echo "$ALL_PODS" | wc -l | tr -d ' ')
log_step "Cluster has $POD_COUNT pods. Lease held by: $LEASE_HOLDER"

# Check messages processed
AUDIT_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
if [[ "$AUDIT_COUNT" -ge 5 ]]; then
  log_ok "$AUDIT_COUNT messages processed after enabling"
else
  log_fail "Expected >= 5 messages after enabling, found $AUDIT_COUNT"
fi

echo ""

# ── Phase 4: Exclusive Processing ──────────────────────────
log_step "Phase 4: Exclusive processing — all from single server"

# Seed 10 more files
for i in $(seq 6 15); do
  FILENAME="exclusive-$(printf '%03d' "$i")-$(date +%s%N).hl7"
  HL7_CONTENT="MSH|^~\\&|TEST|FACILITY|RECV|DEST|$(date +%Y%m%d%H%M%S)||ADT^A01|EXC$(printf '%03d' "$i")|P|2.5.1${CR}EVN|A01|$(date +%Y%m%d%H%M%S)${CR}PID|||PAT$(printf '%03d' "$i")^^^HOSP||EXCL^PROCESS||19750420|M"
  seed_file "$FILENAME" "$HL7_CONTENT"
done

log_step "Seeded 10 more files. Waiting 15s for processing..."
sleep 15

UNIQUE_SERVERS=$(mysql_exec "SELECT COUNT(DISTINCT SERVER_ID) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
if [[ "$UNIQUE_SERVERS" -eq 1 ]]; then
  PROCESSING_SERVER=$(mysql_exec "SELECT DISTINCT SERVER_ID FROM DV_POLL_AUDIT LIMIT 1;" 2>/dev/null || echo "unknown")
  log_ok "All messages from single server: $PROCESSING_SERVER"
else
  log_fail "Messages from $UNIQUE_SERVERS different servers (expected 1 — exclusivity broken)"
  mysql_exec "SELECT SERVER_ID, COUNT(*) AS cnt FROM DV_POLL_AUDIT GROUP BY SERVER_ID;" 2>/dev/null || true
fi

if [[ -n "$LEASE_HOLDER" && "$PROCESSING_SERVER" == "$LEASE_HOLDER" ]]; then
  log_ok "Processing server matches lease holder"
else
  log_fail "Processing server ($PROCESSING_SERVER) != lease holder ($LEASE_HOLDER)"
fi

echo ""

# ── Phase 5: Failover After Enable ─────────────────────────
log_step "Phase 5: Lease failover with takeover guard enabled"

PRE_FAILOVER_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")

# Identify and kill lease holder pod
HOLDER_POD=""
for pod in $ALL_PODS; do
  if [[ "$pod" == "$LEASE_HOLDER" ]]; then
    HOLDER_POD="$pod"
    break
  fi
done

# Fallback: check MIRTH_SERVER_ID env var
if [[ -z "$HOLDER_POD" ]]; then
  for pod in $ALL_PODS; do
    POD_SID=$(kubectl exec -n "$MIRTH_NS" "$pod" -- printenv MIRTH_SERVER_ID 2>/dev/null || \
      kubectl exec -n "$MIRTH_NS" "$pod" -- printenv HOSTNAME 2>/dev/null || echo "")
    if [[ "$POD_SID" == "$LEASE_HOLDER" ]]; then
      HOLDER_POD="$pod"
      break
    fi
  done
fi

if [[ -z "$HOLDER_POD" ]]; then
  log_warn "Could not identify lease holder pod. Using first pod for kill test."
  HOLDER_POD=$(echo "$ALL_PODS" | head -1)
fi

log_step "Force-deleting lease holder pod: $HOLDER_POD"
kubectl delete pod "$HOLDER_POD" -n "$MIRTH_NS" --force --grace-period=0 2>/dev/null || true

log_step "Waiting up to 45s for new lease holder..."
NEW_HOLDER=""
ELAPSED=0
while [[ $ELAPSED -lt 45 ]]; do
  NEW_ROW=$(mysql_exec "SELECT SERVER_ID FROM D_POLLING_LEASES WHERE CHANNEL_ID='${PC01_CHANNEL_ID}' LIMIT 1;" 2>/dev/null || echo "")
  if [[ -n "$NEW_ROW" && "$NEW_ROW" != "$LEASE_HOLDER" ]]; then
    NEW_HOLDER="$NEW_ROW"
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done

if [[ -n "$NEW_HOLDER" ]]; then
  log_ok "New lease holder after failover: $NEW_HOLDER (was: $LEASE_HOLDER)"
else
  log_fail "No new lease holder appeared within 45s"
fi

# Seed 5 more files and verify new holder processes them
log_step "Seeding 5 more files for new holder..."
for i in $(seq 16 20); do
  FILENAME="failover-$(printf '%03d' "$i")-$(date +%s%N).hl7"
  HL7_CONTENT="MSH|^~\\&|TEST|FACILITY|RECV|DEST|$(date +%Y%m%d%H%M%S)||ADT^A01|FO$(printf '%03d' "$i")|P|2.5.1${CR}EVN|A01|$(date +%Y%m%d%H%M%S)${CR}PID|||PAT$(printf '%03d' "$i")^^^HOSP||FAILOVER^TEST||20000101|F"
  seed_file "$FILENAME" "$HL7_CONTENT"
done

log_step "Waiting 15s for processing..."
sleep 15

POST_FAILOVER_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT;" 2>/dev/null || echo "0")
NEW_MESSAGES=$((POST_FAILOVER_COUNT - PRE_FAILOVER_COUNT))

if [[ "$NEW_MESSAGES" -ge 5 ]]; then
  log_ok "New holder processed $NEW_MESSAGES messages after failover"
else
  log_fail "Expected >= 5 new messages after failover, got $NEW_MESSAGES"
fi

# Verify new messages from new holder
if [[ -n "$NEW_HOLDER" ]]; then
  NEW_HOLDER_COUNT=$(mysql_exec "SELECT COUNT(*) FROM DV_POLL_AUDIT WHERE SERVER_ID='${NEW_HOLDER}';" 2>/dev/null || echo "0")
  if [[ "$NEW_HOLDER_COUNT" -ge 5 ]]; then
    log_ok "Post-failover messages from new holder ($NEW_HOLDER)"
  else
    log_fail "Expected >= 5 messages from new holder, got $NEW_HOLDER_COUNT"
  fi
fi

echo ""

# ── Phase 6: Summary ──────────────────────────────────────
echo ""
echo "================================================================"
echo "  COMBINED CLUSTER + TAKEOVER POLLING — RESULTS"
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
