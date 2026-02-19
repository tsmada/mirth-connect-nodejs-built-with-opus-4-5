#!/usr/bin/env bash
# =============================================================================
# Chaos Test: Scale Down Under Load (3 -> 1 -> 3)
# =============================================================================
# Scales the Mirth deployment from 3 replicas down to 1 during active
# processing, verifies graceful drain (no stuck messages, terminated pods
# deregister as OFFLINE), then scales back up.
#
# Usage:
#   ./scale-down-under-load.sh                         # Defaults
#   NAMESPACE=my-ns ./scale-down-under-load.sh
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - Mirth deployment named "node-mirth" with 3 replicas
#   - MySQL accessible via kubectl exec
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD_LABEL="${MYSQL_POD_LABEL:-app=mysql}"
DB_NAME="${DB_NAME:-mirthdb}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-node-mirth}"
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

# ---- Step 1: Record pre-state ----
header "PRE-STATE"

PRE_POD_COUNT=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c Running || true)
echo "$(ts) Running Mirth pods: $PRE_POD_COUNT"

PRE_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o jsonpath='{.items[*].metadata.name}')
echo "$(ts) Pod names: $PRE_PODS"

echo "$(ts) D_SERVERS state:"
mysql_exec "SELECT SERVER_ID, STATUS, LAST_HEARTBEAT FROM D_SERVERS ORDER BY SERVER_ID;" || echo "(D_SERVERS query failed or table empty)"

PRE_ONLINE=$(mysql_exec "SELECT COUNT(*) FROM D_SERVERS WHERE STATUS = 'ONLINE';" || echo "0")
echo "$(ts) Online servers: $PRE_ONLINE"

# ---- Step 2: Scale down to 1 ----
header "SCALING DOWN (${PRE_POD_COUNT} -> 1)"

echo "$(ts) Scaling deployment/$DEPLOYMENT_NAME to 1 replica..."
kubectl scale "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" --replicas=1

# ---- Step 3: Wait for terminating pods to finish ----
header "WAITING FOR GRACEFUL DRAIN (60s)"

echo "$(ts) Waiting up to 60s for terminated pods to drain..."
ELAPSED=0
while [[ $ELAPSED -lt 60 ]]; do
  TERMINATING=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers 2>/dev/null | grep -c Terminating || true)
  RUNNING=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers 2>/dev/null | grep -c Running || true)
  echo "$(ts)   Running: $RUNNING, Terminating: $TERMINATING"
  if [[ "$TERMINATING" -eq 0 ]] && [[ "$RUNNING" -le 1 ]]; then
    echo "$(ts) All terminated pods drained."
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

# Extra settling time for D_SERVERS updates
echo "$(ts) Settling 15s for D_SERVERS deregistration..."
sleep 15

# ---- Step 4: Verify scale-down ----
header "SCALE-DOWN VERIFICATION"

# 4a. Check pod count
POST_SCALE_DOWN=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c Running || true)
echo "$(ts) Running pods after scale-down: $POST_SCALE_DOWN"
if [[ "$POST_SCALE_DOWN" -eq 1 ]]; then
  pass "Scaled down to 1 pod"
else
  fail "Expected 1 pod, got $POST_SCALE_DOWN"
fi

# 4b. Terminated pods show OFFLINE in D_SERVERS
echo "$(ts) D_SERVERS state after scale-down:"
mysql_exec "SELECT SERVER_ID, STATUS, LAST_HEARTBEAT FROM D_SERVERS ORDER BY SERVER_ID;" || echo "(query failed)"

SURVIVING_POD=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
echo "$(ts) Surviving pod: $SURVIVING_POD"

OFFLINE_COUNT=$(mysql_exec "SELECT COUNT(*) FROM D_SERVERS WHERE STATUS = 'OFFLINE';" || echo "0")
OFFLINE_COUNT=$(echo "$OFFLINE_COUNT" | tr -d '[:space:]')
echo "$(ts) OFFLINE entries in D_SERVERS: $OFFLINE_COUNT"

# We expect at least (PRE_POD_COUNT - 1) pods to be OFFLINE
EXPECTED_OFFLINE=$((PRE_POD_COUNT - 1))
if [[ "$OFFLINE_COUNT" -ge "$EXPECTED_OFFLINE" ]]; then
  pass "Terminated pods marked OFFLINE in D_SERVERS ($OFFLINE_COUNT >= $EXPECTED_OFFLINE)"
else
  fail "Expected >= $EXPECTED_OFFLINE OFFLINE entries, got $OFFLINE_COUNT"
fi

# 4c. No stuck messages
DV_CHANNELS=$(mysql_exec "SELECT COUNT(*) FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';" || echo "0")
DV_CHANNELS=$(echo "$DV_CHANNELS" | tr -d '[:space:]')

if [[ "$DV_CHANNELS" -gt 0 ]]; then
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
    pass "No stuck messages after scale-down"
  else
    fail "Found $STUCK_FOUND stuck messages after scale-down"
  fi
else
  pass "Stuck message check skipped (no DV channels)"
fi

# 4d. Remaining pod healthy
if [[ -n "$SURVIVING_POD" ]]; then
  HEALTH=$(kubectl exec -n "$NAMESPACE" "pod/$SURVIVING_POD" -- \
    wget -q -S -O /dev/null --timeout=5 "http://localhost:${MIRTH_API_PORT}/api/health" 2>&1 || true)
  if echo "$HEALTH" | grep -q "200 OK"; then
    pass "Surviving pod health check returns 200"
  else
    fail "Surviving pod health check failed"
  fi
else
  fail "No surviving pod found"
fi

# ---- Step 5: Scale back up ----
header "SCALING BACK UP (1 -> $PRE_POD_COUNT)"

echo "$(ts) Scaling deployment/$DEPLOYMENT_NAME to $PRE_POD_COUNT replicas..."
kubectl scale "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" --replicas="$PRE_POD_COUNT"

echo "$(ts) Waiting up to 180s for all pods to become Ready..."
if kubectl wait --for=condition=ready pod -l app=node-mirth -n "$NAMESPACE" --timeout=180s 2>/dev/null; then
  pass "All pods Ready after scale-up"
else
  fail "Not all pods Ready within 180s"
fi

# Extra settling for D_SERVERS registration
echo "$(ts) Settling 15s for D_SERVERS registration..."
sleep 15

POST_ONLINE=$(mysql_exec "SELECT COUNT(*) FROM D_SERVERS WHERE STATUS = 'ONLINE';" || echo "0")
POST_ONLINE=$(echo "$POST_ONLINE" | tr -d '[:space:]')
echo "$(ts) Online servers in D_SERVERS: $POST_ONLINE (was: $PRE_ONLINE)"

FINAL_POD_COUNT=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c Running || true)
echo "$(ts) Final running pods: $FINAL_POD_COUNT"

if [[ "$FINAL_POD_COUNT" -ge "$PRE_POD_COUNT" ]]; then
  pass "Pod count restored to $FINAL_POD_COUNT"
else
  fail "Pod count not restored ($FINAL_POD_COUNT < $PRE_POD_COUNT)"
fi

# ---- Summary ----
header "SUMMARY: SCALE-DOWN-UNDER-LOAD CHAOS TEST"

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
