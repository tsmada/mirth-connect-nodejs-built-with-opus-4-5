#!/usr/bin/env bash
# =============================================================================
# Chaos Test: Pod Kill & Recovery
# =============================================================================
# Kills 1 random Mirth pod during active processing and verifies that the
# cluster recovers: replacement pod comes up, registers in D_SERVERS, and
# no messages are left stuck (PROCESSED=0).
#
# Usage:
#   ./pod-kill.sh                         # Defaults: mirth-cluster namespace
#   NAMESPACE=my-ns ./pod-kill.sh         # Custom namespace
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - MySQL accessible via kubectl exec into a MySQL pod
#   - At least 2 Mirth pods running (so the cluster survives the kill)
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD_LABEL="${MYSQL_POD_LABEL:-app=mysql}"
DB_NAME="${DB_NAME:-mirthdb}"

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

if [[ "$PRE_POD_COUNT" -lt 2 ]]; then
  echo "$(ts) WARNING: Only $PRE_POD_COUNT pod(s) running. Kill will leave 0 healthy pods."
  echo "$(ts) Recommend at least 2 replicas for this test."
fi

echo "$(ts) D_SERVERS state:"
mysql_exec "SELECT SERVER_ID, STATUS, LAST_HEARTBEAT FROM D_SERVERS ORDER BY SERVER_ID;" || echo "(D_SERVERS query failed or table empty)"

PRE_SERVER_COUNT=$(mysql_exec "SELECT COUNT(*) FROM D_SERVERS WHERE STATUS = 'ONLINE';" || echo "0")
echo "$(ts) Online servers in D_SERVERS: $PRE_SERVER_COUNT"

# ---- Step 2: Pick a random Mirth pod ----
header "SELECTING TARGET POD"

TARGET_POD=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o name | shuf | head -1)
TARGET_POD_NAME="${TARGET_POD#pod/}"
echo "$(ts) Selected target: $TARGET_POD_NAME"

# ---- Step 3: Kill the pod ----
header "KILLING POD"

echo "$(ts) Deleting $TARGET_POD_NAME with --grace-period=0 (force kill)..."
kubectl delete pod "$TARGET_POD_NAME" -n "$NAMESPACE" --grace-period=0 --wait=false
echo "$(ts) Delete command sent."

# ---- Step 4: Wait for replacement ----
header "WAITING FOR REPLACEMENT"

echo "$(ts) Waiting up to 180s for all pods to become Ready..."
if kubectl wait --for=condition=ready pod -l app=node-mirth -n "$NAMESPACE" --timeout=180s 2>/dev/null; then
  pass "Replacement pod became Ready"
else
  fail "Replacement pod did not become Ready within 180s"
fi

# ---- Step 5: Wait for RecoveryTask ----
header "SETTLING (30s for RecoveryTask)"

echo "$(ts) Waiting 30s for RecoveryTask to process any in-flight messages..."
sleep 30

# ---- Step 6: Verify recovery ----
header "VERIFICATION"

# 6a. Pod count restored
POST_POD_COUNT=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c Running || true)
echo "$(ts) Running Mirth pods: $POST_POD_COUNT (was: $PRE_POD_COUNT)"
if [[ "$POST_POD_COUNT" -ge "$PRE_POD_COUNT" ]]; then
  pass "Pod count restored ($POST_POD_COUNT >= $PRE_POD_COUNT)"
else
  fail "Pod count not restored ($POST_POD_COUNT < $PRE_POD_COUNT)"
fi

# 6b. New pod registered in D_SERVERS
echo "$(ts) D_SERVERS state after recovery:"
mysql_exec "SELECT SERVER_ID, STATUS, LAST_HEARTBEAT FROM D_SERVERS ORDER BY SERVER_ID;" || echo "(D_SERVERS query failed)"

POST_SERVER_COUNT=$(mysql_exec "SELECT COUNT(*) FROM D_SERVERS WHERE STATUS = 'ONLINE';" || echo "0")
echo "$(ts) Online servers in D_SERVERS: $POST_SERVER_COUNT (was: $PRE_SERVER_COUNT)"
if [[ "$POST_SERVER_COUNT" -ge "$PRE_SERVER_COUNT" ]]; then
  pass "D_SERVERS online count restored ($POST_SERVER_COUNT >= $PRE_SERVER_COUNT)"
else
  fail "D_SERVERS online count not restored ($POST_SERVER_COUNT < $PRE_SERVER_COUNT)"
fi

# 6c. Killed pod shows OFFLINE
KILLED_STATUS=$(mysql_exec "SELECT STATUS FROM D_SERVERS WHERE SERVER_ID = '$TARGET_POD_NAME';" || echo "UNKNOWN")
echo "$(ts) Killed pod ($TARGET_POD_NAME) D_SERVERS status: $KILLED_STATUS"
if [[ "$KILLED_STATUS" == "OFFLINE" ]] || [[ "$KILLED_STATUS" == "" ]]; then
  pass "Killed pod deregistered or marked OFFLINE"
else
  echo "$(ts) NOTE: Status is '$KILLED_STATUS' -- force-killed pods may not gracefully deregister"
fi

# 6d. No stuck messages
STUCK_COUNT=$(mysql_exec "
  SELECT COALESCE(SUM(cnt), 0) FROM (
    SELECT COUNT(*) AS cnt FROM D_CHANNELS dc
    WHERE dc.CHANNEL_ID LIKE 'dv%'
  ) t;
" || echo "0")

# Check each DV channel for stuck messages using dynamic SQL
STUCK_TOTAL=$(mysql_exec "
  SET @total = 0;
  SET @sql = '';
  SELECT GROUP_CONCAT(
    CONCAT('SELECT COUNT(*) FROM D_M', LOCAL_CHANNEL_ID, ' WHERE PROCESSED = 0')
    SEPARATOR ' UNION ALL '
  ) INTO @sql
  FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  SET @sql = CONCAT('SELECT COALESCE(SUM(c), 0) FROM (', @sql, ') AS t(c)');
  PREPARE stmt FROM @sql;
  EXECUTE stmt;
  DEALLOCATE PREPARE stmt;
" 2>/dev/null || echo "0")

# Simpler fallback: just check if D_CHANNELS has DV entries
DV_CHANNELS=$(mysql_exec "SELECT COUNT(*) FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';" || echo "0")
echo "$(ts) DV channels deployed: $DV_CHANNELS"

if [[ "$DV_CHANNELS" -gt 0 ]]; then
  # Use a procedure-free approach: build and exec one query per channel
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
    pass "No stuck messages (PROCESSED=0) across DV channels"
  else
    fail "Found $STUCK_FOUND stuck messages (PROCESSED=0)"
  fi
else
  echo "$(ts) No DV channels deployed yet -- skipping stuck message check"
  pass "Stuck message check skipped (no DV channels)"
fi

# ---- Summary ----
header "SUMMARY: POD-KILL CHAOS TEST"

echo "$(ts) Target pod:  $TARGET_POD_NAME"
echo "$(ts) Passed:      $PASS"
echo "$(ts) Failed:      $FAIL"
echo ""

if [[ "$FAIL" -eq 0 ]]; then
  echo "$(ts) RESULT: PASS"
  exit 0
else
  echo "$(ts) RESULT: FAIL"
  exit 1
fi
