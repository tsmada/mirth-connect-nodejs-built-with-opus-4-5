#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Teardown
# =============================================================================
# Cleans up DV channels and data:
#   1. Undeploy DV channels via API
#   2. Delete DV channels via API
#   3. Run SQL teardown.sql (drop landing tables)
#   4. Clean up k6 jobs
#
# Usage: teardown.sh [api-url]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

API_URL="${1:-http://localhost:8080}"
API_URL="${API_URL%/}"
NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD="${MYSQL_POD:-}"
DB_NAME="${DB_NAME:-mirthdb}"

DV_CHANNEL_IDS=(
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

echo "=== Deep Validation Teardown ==="
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ── Step 1: Login ──────────────────────────────────────────────────────────
echo "[1/4] Logging in..."

CURL_INSECURE=""
if [[ "$API_URL" == https://* ]]; then
  CURL_INSECURE="--insecure"
fi

LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" $CURL_INSECURE -X POST \
  "$API_URL/api/users/_login" \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d '{"username":"admin","password":"admin"}' \
  -D /dev/stderr 2>&1)

SESSION_ID=$(echo "$LOGIN_RESPONSE" | { grep -i "^x-session-id:" || true; } | head -1 | awk '{print $2}' | tr -d '\r\n')
AUTH_MODE="node"

if [[ -z "$SESSION_ID" ]]; then
  JSESSIONID=$(echo "$LOGIN_RESPONSE" | { grep -i "^set-cookie:" || true; } | { grep -o "JSESSIONID=[^;]*" || true; } | head -1)
  if [[ -n "$JSESSIONID" ]]; then
    SESSION_ID="$JSESSIONID"
    AUTH_MODE="java"
  else
    LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" $CURL_INSECURE -X POST \
      "$API_URL/api/users/_login" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "username=admin&password=admin" \
      -D /dev/stderr 2>&1)
    JSESSIONID=$(echo "$LOGIN_RESPONSE" | { grep -i "^set-cookie:" || true; } | { grep -o "JSESSIONID=[^;]*" || true; } | head -1)
    if [[ -n "$JSESSIONID" ]]; then
      SESSION_ID="$JSESSIONID"
      AUTH_MODE="java"
    fi
  fi
fi

if [[ "$AUTH_MODE" == "java" ]]; then
  AUTH_HEADER="Cookie: $SESSION_ID"
else
  AUTH_HEADER="X-Session-ID: $SESSION_ID"
fi

LOGGED_IN=true
if [[ -z "$SESSION_ID" ]]; then
  echo "  WARNING: Could not login. Will skip API-based cleanup."
  LOGGED_IN=false
else
  echo "  Logged in (mode: $AUTH_MODE)"
fi
echo ""

# ── Step 2: Undeploy DV channels ──────────────────────────────────────────
echo "[2/4] Undeploying DV channels..."

if [[ "$LOGGED_IN" == "true" ]]; then
  UNDEPLOY_XML="<set>"
  for id in "${DV_CHANNEL_IDS[@]}"; do
    UNDEPLOY_XML+="<string>${id}</string>"
  done
  UNDEPLOY_XML+="</set>"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $CURL_INSECURE -X POST \
    "$API_URL/api/channels/_undeploy?returnErrors=true" \
    -H "Content-Type: application/xml" \
    -H "$AUTH_HEADER" \
    -H "X-Requested-With: XMLHttpRequest" \
    -d "$UNDEPLOY_XML" 2>/dev/null || echo "000")

  echo "  Undeploy response: HTTP $HTTP_CODE"
else
  echo "  Skipped (not logged in)"
fi
echo ""

# ── Step 3: Delete DV channels ────────────────────────────────────────────
echo "[3/4] Deleting DV channels..."

if [[ "$LOGGED_IN" == "true" ]]; then
  DELETED=0
  for id in "${DV_CHANNEL_IDS[@]}"; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $CURL_INSECURE -X DELETE \
      "$API_URL/api/channels/$id" \
      -H "$AUTH_HEADER" \
      -H "X-Requested-With: XMLHttpRequest" 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" -ge 200 ]] && [[ "$HTTP_CODE" -lt 300 ]]; then
      DELETED=$((DELETED + 1))
    elif [[ "$HTTP_CODE" == "404" ]]; then
      : # Channel doesn't exist, OK
    else
      echo "  WARNING: Delete $id returned HTTP $HTTP_CODE"
    fi
  done
  echo "  Deleted $DELETED channels"
else
  echo "  Skipped (not logged in)"
fi
echo ""

# ── Step 4: SQL teardown + k6 cleanup ─────────────────────────────────────
echo "[4/4] Cleaning up database tables and k6 jobs..."

# Auto-detect MySQL pod
if [[ -z "$MYSQL_POD" ]]; then
  MYSQL_POD=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l app=mysql \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
fi

if [[ -n "$MYSQL_POD" ]]; then
  SQL_FILE="$DV_ROOT/sql/teardown.sql"
  if [[ -f "$SQL_FILE" ]]; then
    kubectl cp "$SQL_FILE" "$MYSQL_NAMESPACE/$MYSQL_POD:/tmp/dv-teardown.sql"
    kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
      mysql -u mirth -pmirth "$DB_NAME" -e "SOURCE /tmp/dv-teardown.sql" 2>/dev/null
    echo "  SQL teardown complete"
  else
    echo "  WARNING: teardown.sql not found at $SQL_FILE"
  fi
else
  echo "  WARNING: MySQL pod not found, skipping SQL teardown"
fi

# Clean up k6 jobs
K6_JOBS=$(kubectl get jobs -n "${NAMESPACE}" -l suite=deep-validation \
  -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
if [[ -n "$K6_JOBS" ]]; then
  for job in $K6_JOBS; do
    kubectl delete job -n "${NAMESPACE}" "$job" --ignore-not-found 2>/dev/null || true
  done
  echo "  Cleaned up k6 jobs"
else
  echo "  No k6 jobs to clean up"
fi

echo ""
echo "=== Teardown Complete ==="
