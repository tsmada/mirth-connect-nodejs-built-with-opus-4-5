#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Environment Setup
# =============================================================================
# Prepares the database and runtime for deep validation:
#   1. Check prerequisites (kubectl, MySQL pod accessible)
#   2. Run SQL setup.sql via kubectl exec
#   3. Set global map values (dv08FailRate=0.1) via API
#   4. Verify DV tables created
#
# Usage: setup.sh [api-url]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

API_URL="${1:-http://localhost:8080}"
API_URL="${API_URL%/}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD="${MYSQL_POD:-}"
DB_NAME="${DB_NAME:-mirthdb}"

echo "=== Deep Validation Setup ==="
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  API URL:   $API_URL"
echo ""

# ── Step 1: Check prerequisites ───────────────────────────────────────────
echo "[1/4] Checking prerequisites..."

if ! command -v kubectl &>/dev/null; then
  echo "  ERROR: kubectl not found in PATH" >&2
  exit 1
fi
echo "  kubectl: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -1)"

if ! command -v curl &>/dev/null; then
  echo "  ERROR: curl not found in PATH" >&2
  exit 1
fi
echo "  curl: $(curl --version | head -1)"

# Auto-detect MySQL pod
if [[ -z "$MYSQL_POD" ]]; then
  MYSQL_POD=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l app=mysql \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -z "$MYSQL_POD" ]]; then
    echo "  ERROR: Could not find MySQL pod in namespace $MYSQL_NAMESPACE" >&2
    echo "  Ensure the base infrastructure is deployed: kubectl apply -k k8s/base/" >&2
    exit 1
  fi
fi
echo "  MySQL pod: $MYSQL_POD ($MYSQL_NAMESPACE)"

# Test MySQL connectivity
if ! kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
  mysql -u mirth -pmirth "$DB_NAME" -e "SELECT 1" &>/dev/null; then
  echo "  ERROR: Cannot connect to MySQL" >&2
  exit 1
fi
echo "  MySQL connectivity: OK"
echo ""

# ── Step 2: Run SQL setup ─────────────────────────────────────────────────
echo "[2/4] Running SQL setup (creating landing tables)..."

SQL_FILE="$DV_ROOT/sql/setup.sql"
if [[ ! -f "$SQL_FILE" ]]; then
  echo "  ERROR: setup.sql not found at $SQL_FILE" >&2
  exit 1
fi

# Copy SQL file to pod and execute
kubectl cp "$SQL_FILE" "$MYSQL_NAMESPACE/$MYSQL_POD:/tmp/dv-setup.sql"
kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
  mysql -u mirth -pmirth "$DB_NAME" -e "SOURCE /tmp/dv-setup.sql" 2>/dev/null

echo "  SQL setup complete"
echo ""

# ── Step 3: Set global map values ─────────────────────────────────────────
echo "[3/4] Setting global map values..."

# Login to the API
CURL_INSECURE=""
if [[ "$API_URL" == https://* ]]; then
  CURL_INSECURE="--insecure"
fi

# Try Node.js login first (JSON + X-Session-ID header)
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

if [[ -z "$SESSION_ID" ]]; then
  echo "  WARNING: Could not login to API. Global map values not set."
  echo "  Channels will use default values."
else
  if [[ "$AUTH_MODE" == "java" ]]; then
    AUTH_HEADER="Cookie: $SESSION_ID"
  else
    AUTH_HEADER="X-Session-ID: $SESSION_ID"
  fi

  # Set dv08FailRate in global map via configuration endpoint
  # The global map is accessible in scripts via $g('dv08FailRate')
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $CURL_INSECURE -X PUT \
    "$API_URL/api/extensions/globalmapviewer/maps/globalMap/dv08FailRate" \
    -H "Content-Type: text/plain" \
    -H "$AUTH_HEADER" \
    -H "X-Requested-With: XMLHttpRequest" \
    -d "0.1" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" -ge 200 ]] && [[ "$HTTP_CODE" -lt 300 ]]; then
    echo "  Set dv08FailRate=0.1 via global map API"
  else
    echo "  WARNING: Could not set global map via API (HTTP $HTTP_CODE)"
    echo "  Setting via database instead..."
    kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
      mysql -u mirth -pmirth "$DB_NAME" -e \
      "INSERT INTO D_GLOBAL_MAP (MAP_KEY, MAP_VALUE) VALUES ('dv08FailRate', '0.1') ON DUPLICATE KEY UPDATE MAP_VALUE = '0.1'" 2>/dev/null || true
    echo "  Set dv08FailRate=0.1 via D_GLOBAL_MAP table"
  fi
fi
echo ""

# ── Step 4: Verify tables created ─────────────────────────────────────────
echo "[4/4] Verifying DV landing tables..."

TABLES_EXPECTED=(
  "dv_enriched_messages"
  "dv_route_a"
  "dv_route_b"
  "dv_route_c"
  "dv_batch_results"
  "dv_chain_results"
)

TABLES_FOUND=0
for tbl in "${TABLES_EXPECTED[@]}"; do
  exists=$(kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
    mysql -u mirth -pmirth "$DB_NAME" -N -e \
    "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$tbl'" 2>/dev/null | tr -d '[:space:]')
  if [[ "$exists" == "1" ]]; then
    echo "  OK: $tbl"
    TABLES_FOUND=$((TABLES_FOUND + 1))
  else
    echo "  MISSING: $tbl"
  fi
done

echo ""
echo "=== Setup Complete ==="
echo "  Tables: $TABLES_FOUND/${#TABLES_EXPECTED[@]} created"
echo ""
echo "Next: Run deploy-channels.sh to upload and deploy DV channels"

if [[ "$TABLES_FOUND" -ne ${#TABLES_EXPECTED[@]} ]]; then
  exit 1
fi
