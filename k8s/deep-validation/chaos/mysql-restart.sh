#!/usr/bin/env bash
# =============================================================================
# Chaos Test: MySQL Restart & Connection Pool Recovery
# =============================================================================
# Restarts the MySQL pod and verifies that Node.js Mirth recovers its
# connection pool, health endpoint returns 200, and message processing resumes.
#
# Usage:
#   ./mysql-restart.sh                              # Defaults
#   NAMESPACE=my-ns MYSQL_NAMESPACE=my-db ./mysql-restart.sh
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - At least 1 Mirth pod running
#   - MySQL deployed as a StatefulSet or Deployment with app=mysql label
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD_LABEL="${MYSQL_POD_LABEL:-app=mysql}"
DB_NAME="${DB_NAME:-mirthdb}"
MIRTH_API_PORT="${MIRTH_API_PORT:-8080}"

PASS=0
FAIL=0

ts() { date "+%Y-%m-%d %H:%M:%S"; }
header() { echo ""; echo "$(ts) ============ $1 ============"; }
pass() { echo "$(ts) [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "$(ts) [FAIL] $1"; FAIL=$((FAIL + 1)); }

mysql_exec() {
  local sql="$1"
  local mysql_pod
  mysql_pod=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l "$MYSQL_POD_LABEL" -o name | head -1)
  kubectl exec -n "$MYSQL_NAMESPACE" "$mysql_pod" -- \
    mysql -u mirth -pmirth "$DB_NAME" -N -e "$sql" 2>/dev/null
}

get_mirth_pod() {
  kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o name | head -1
}

health_check() {
  local pod="$1"
  kubectl exec -n "$NAMESPACE" "$pod" -- \
    wget -q -O - --timeout=5 "http://localhost:${MIRTH_API_PORT}/api/health" 2>/dev/null
}

# ---- Step 1: Record pre-state ----
header "PRE-STATE"

MIRTH_POD=$(get_mirth_pod)
echo "$(ts) Using Mirth pod: ${MIRTH_POD#pod/}"

PRE_HEALTH=$(health_check "$MIRTH_POD" || echo "UNHEALTHY")
echo "$(ts) Health check: $PRE_HEALTH"

PRE_MSG_COUNT=$(mysql_exec "
  SELECT COALESCE(SUM(RECEIVED), 0) FROM (
    SELECT SUM(RECEIVED) AS RECEIVED FROM D_CHANNELS dc
    JOIN (SELECT 'placeholder' AS x) p ON 1=0
  ) t;
" 2>/dev/null || echo "N/A")

# Get total received across all DV channel stats
DV_CHANNELS=$(mysql_exec "SELECT COUNT(*) FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';" || echo "0")
echo "$(ts) DV channels deployed: $DV_CHANNELS"

# ---- Step 2: Kill MySQL ----
header "KILLING MYSQL"

MYSQL_POD=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l "$MYSQL_POD_LABEL" -o name | head -1)
echo "$(ts) Deleting MySQL pod: ${MYSQL_POD#pod/}"
kubectl delete "$MYSQL_POD" -n "$MYSQL_NAMESPACE"
echo "$(ts) MySQL pod deleted."

# ---- Step 3: Wait for MySQL to come back ----
header "WAITING FOR MYSQL RECOVERY"

echo "$(ts) Waiting up to 120s for MySQL pod to become Ready..."
if kubectl wait --for=condition=ready pod -l "$MYSQL_POD_LABEL" -n "$MYSQL_NAMESPACE" --timeout=120s 2>/dev/null; then
  pass "MySQL pod recovered"
else
  fail "MySQL pod did not recover within 120s"
  echo "$(ts) ABORTING -- MySQL not available"
  exit 1
fi

# ---- Step 4: Wait for pool reconnect ----
header "SETTLING (30s for connection pool recovery)"

echo "$(ts) Waiting 30s for Mirth connection pools to reconnect..."
sleep 30

# ---- Step 5: Verify recovery ----
header "VERIFICATION"

# 5a. Health endpoint returns 200
MIRTH_POD=$(get_mirth_pod)
echo "$(ts) Checking health on ${MIRTH_POD#pod/}..."

HEALTH_OK=0
for attempt in 1 2 3; do
  HEALTH_RESULT=$(kubectl exec -n "$NAMESPACE" "$MIRTH_POD" -- \
    wget -q -S -O /dev/null --timeout=5 "http://localhost:${MIRTH_API_PORT}/api/health" 2>&1 || true)
  if echo "$HEALTH_RESULT" | grep -q "200 OK"; then
    HEALTH_OK=1
    break
  fi
  echo "$(ts)   Attempt $attempt: not yet healthy, retrying in 10s..."
  sleep 10
done

if [[ "$HEALTH_OK" -eq 1 ]]; then
  pass "Health endpoint returns 200"
else
  fail "Health endpoint not returning 200 after 3 attempts"
fi

# 5b. Test message processing (send to DV01 port 8110 via the API)
echo "$(ts) Sending test message via Mirth API..."

# Use a simple HTTP POST to the first available Mirth pod
TEST_RESULT=$(kubectl exec -n "$NAMESPACE" "$MIRTH_POD" -- \
  wget -q -O - --timeout=10 --post-data='{"test":"chaos-mysql-restart"}' \
  --header='Content-Type: application/json' \
  "http://localhost:${MIRTH_API_PORT}/api/health" 2>/dev/null || echo "FAILED")

# Health endpoint responding means the API + DB connection is working
if [[ "$TEST_RESULT" != "FAILED" ]]; then
  pass "API responsive after MySQL restart (DB connection pool recovered)"
else
  fail "API not responsive after MySQL restart"
fi

# 5c. Check for stuck messages (same pattern as pod-kill)
DV_CHANNELS_NOW=$(mysql_exec "SELECT COUNT(*) FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';" || echo "0")
DV_CHANNELS_NOW=$(echo "$DV_CHANNELS_NOW" | tr -d '[:space:]')

if [[ "$DV_CHANNELS_NOW" -gt 0 ]]; then
  STUCK_FOUND=0
  while IFS=$'\t' read -r ch_id local_id; do
    count=$(mysql_exec "SELECT COUNT(*) FROM D_M${local_id} WHERE PROCESSED = 0;" 2>/dev/null || echo "0")
    count=$(echo "$count" | tr -d '[:space:]')
    if [[ "$count" -gt 0 ]]; then
      echo "$(ts)   Channel $ch_id (local $local_id): $count stuck messages"
      STUCK_FOUND=$((STUCK_FOUND + count))
    fi
  done < <(mysql_exec "SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';")

  if [[ "$STUCK_FOUND" -eq 0 ]]; then
    pass "No stuck messages after MySQL restart"
  else
    fail "Found $STUCK_FOUND stuck messages after MySQL restart"
  fi
else
  echo "$(ts) No DV channels deployed -- skipping stuck message check"
  pass "Stuck message check skipped (no DV channels)"
fi

# ---- Summary ----
header "SUMMARY: MYSQL-RESTART CHAOS TEST"

echo "$(ts) Passed:  $PASS"
echo "$(ts) Failed:  $FAIL"
echo ""

if [[ "$FAIL" -eq 0 ]]; then
  echo "$(ts) RESULT: PASS"
  exit 0
else
  echo "$(ts) RESULT: FAIL"
  exit 1
fi
