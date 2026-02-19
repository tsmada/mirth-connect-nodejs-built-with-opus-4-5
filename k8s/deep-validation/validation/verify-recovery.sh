#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Post-Chaos Recovery Verification
# =============================================================================
# Run after chaos engineering to verify the system recovered:
#   - All messages in terminal state (no stuck PROCESSED=0)
#   - No STATUS='R' or 'P' older than 60 seconds
#   - Health endpoint returns 200
#   - D_SERVERS shows expected pod count as ONLINE
#
# Exit 0 = recovered, Exit 1 = recovery issues found
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD="${MYSQL_POD:-}"
DB_NAME="${DB_NAME:-mirthdb}"
API_URL="${API_URL:-http://localhost:8080}"
EXPECTED_PODS="${EXPECTED_PODS:-3}"

DV_CHANNELS=(
  "dv000001-0001-0001-0001-000000000001"
  "dv000002-0002-0002-0002-000000000002"
  "dv000003-0003-0003-0003-000000000003"
  "dv000004-0004-0004-0004-000000000004"
  "dv000005-0005-0005-0005-000000000005"
  "dv000006-0006-0006-0006-000000000006"
  "dv000007-0007-0007-0007-000000000007"
  "dv000008-0008-0008-0008-000000000008"
  "dv000009-0009-0009-0009-000000000009"
  "dv000010-0010-0010-0010-000000000010"
  "dv000011-0011-0011-0011-000000000011"
  "dv000012-0012-0012-0012-000000000012"
)

# ── Auto-detect MySQL pod ──────────────────────────────────────────────────
if [[ -z "$MYSQL_POD" ]]; then
  MYSQL_POD=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l app=mysql \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -z "$MYSQL_POD" ]]; then
    echo "ERROR: Could not find MySQL pod in namespace $MYSQL_NAMESPACE" >&2
    exit 1
  fi
fi

mysql_query() {
  kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
    mysql -u mirth -pmirth "$DB_NAME" -N -e "$1" 2>/dev/null
}

echo "=== Post-Chaos Recovery Verification ==="
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Namespace: $NAMESPACE"
echo "  Expected pods: $EXPECTED_PODS"
echo ""

FAILURES=0

# ── Check 1: Health endpoints ──────────────────────────────────────────────
echo "[1/4] Checking health endpoints..."

# Check each pod's health via kubectl port-forward is impractical from here.
# Instead, check via the API URL (assumes port-forward is active) or in-cluster.
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/health" 2>/dev/null || echo "000")

if [[ "$HEALTH_CODE" == "200" ]]; then
  echo "  PASS: Health endpoint returned 200"
else
  echo "  FAIL: Health endpoint returned $HEALTH_CODE"
  FAILURES=$((FAILURES + 1))
fi

# Check ready pods via kubectl
READY_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
  --field-selector=status.phase=Running \
  -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | wc -w | tr -d ' ')

if [[ "$READY_PODS" -ge "$EXPECTED_PODS" ]]; then
  echo "  PASS: $READY_PODS/$EXPECTED_PODS pods running"
else
  echo "  FAIL: Only $READY_PODS/$EXPECTED_PODS pods running"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# ── Check 2: D_SERVERS status ─────────────────────────────────────────────
echo "[2/4] Checking D_SERVERS registry..."

ONLINE_COUNT=$(mysql_query "SELECT COUNT(*) FROM D_SERVERS WHERE STATUS = 'ONLINE'" 2>/dev/null | tr -d '[:space:]')
ONLINE_COUNT=${ONLINE_COUNT:-0}

if [[ "$ONLINE_COUNT" -ge "$EXPECTED_PODS" ]]; then
  echo "  PASS: $ONLINE_COUNT servers ONLINE (expected $EXPECTED_PODS)"
else
  echo "  WARNING: $ONLINE_COUNT servers ONLINE (expected $EXPECTED_PODS)"
  # Show all server statuses
  mysql_query "SELECT SERVER_ID, STATUS, LAST_HEARTBEAT FROM D_SERVERS ORDER BY STATUS" 2>/dev/null | while read -r sid status hb; do
    echo "    $sid: $status (heartbeat: $hb)"
  done
fi
echo ""

# ── Check 3: Terminal state messages ───────────────────────────────────────
echo "[3/4] Checking all messages are in terminal state..."

declare -A LOCAL_IDS
for ch_id in "${DV_CHANNELS[@]}"; do
  local_id=$(mysql_query "SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = '$ch_id'" | tr -d '[:space:]')
  if [[ -n "$local_id" ]]; then
    LOCAL_IDS["$ch_id"]="$local_id"
  fi
done

TOTAL_STUCK=0
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  stuck=$(mysql_query "SELECT COUNT(*) FROM D_M${local_id} WHERE PROCESSED = 0" | tr -d '[:space:]')
  stuck=${stuck:-0}
  TOTAL_STUCK=$((TOTAL_STUCK + stuck))
done

if [[ "$TOTAL_STUCK" -eq 0 ]]; then
  echo "  PASS: No stuck messages (PROCESSED=0)"
else
  echo "  FAIL: $TOTAL_STUCK messages still have PROCESSED=0"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# ── Check 4: No stale pending connectors ───────────────────────────────────
echo "[4/4] Checking for stale pending connectors (>60s old)..."

STALE_TOTAL=0
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  # Check for R or P status connectors with RECEIVED_DATE older than 60 seconds
  stale=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE STATUS IN ('R','P') AND RECEIVED_DATE < DATE_SUB(NOW(), INTERVAL 60 SECOND)" | tr -d '[:space:]')
  stale=${stale:-0}

  if [[ "$stale" -gt 0 ]]; then
    echo "  FAIL: $ch_id (local $local_id) has $stale stale pending connectors"
    STALE_TOTAL=$((STALE_TOTAL + stale))
  fi
done

if [[ "$STALE_TOTAL" -eq 0 ]]; then
  echo "  PASS: No stale pending connectors (>60s)"
else
  echo "  FAIL: $STALE_TOTAL stale pending connectors"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "=== Recovery Verification Summary ==="
echo "  Health endpoint:  $([ "$HEALTH_CODE" == "200" ] && echo "OK" || echo "FAIL ($HEALTH_CODE)")"
echo "  Running pods:     $READY_PODS/$EXPECTED_PODS"
echo "  Online servers:   $ONLINE_COUNT/$EXPECTED_PODS"
echo "  Stuck messages:   $TOTAL_STUCK"
echo "  Stale pending:    $STALE_TOTAL"
echo ""

if [[ "$FAILURES" -gt 0 ]]; then
  echo "=== RESULT: FAIL ($FAILURES recovery checks failed) ==="
  exit 1
else
  echo "=== RESULT: PASS (system recovered) ==="
  exit 0
fi
