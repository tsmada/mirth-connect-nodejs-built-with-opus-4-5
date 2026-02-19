#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Channel Deployment
# =============================================================================
# Uploads code template libraries, DV channels, and deploys them.
# Follows the EXACT same pattern as deploy-kitchen-sink.sh.
#
# Usage: deploy-channels.sh [api-url]
#   api-url: Mirth REST API base URL (default: http://localhost:8080)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

API_URL="${1:-http://localhost:8080}"
API_URL="${API_URL%/}"

CURL_INSECURE=""
if [[ "$API_URL" == https://* ]]; then
  CURL_INSECURE="--insecure"
fi

echo "=== Deploying Deep Validation Channels to $API_URL ==="
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ── Step 1: Login ──────────────────────────────────────────────────────────
echo "[1/5] Logging in as admin..."

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
    echo "  Using Java Mirth session (JSESSIONID)"
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
      echo "  Using Java Mirth session (form-encoded fallback)"
    fi
  fi
fi

if [[ -z "$SESSION_ID" ]]; then
  echo "ERROR: Login failed. Could not extract session." >&2
  exit 1
fi
echo "  Session: ${SESSION_ID:0:20}... (mode: $AUTH_MODE)"

if [[ "$AUTH_MODE" == "java" ]]; then
  AUTH_HEADER="Cookie: $SESSION_ID"
else
  AUTH_HEADER="X-Session-ID: $SESSION_ID"
fi

auth_curl() {
  curl -s -f $CURL_INSECURE "$@" \
    -H "$AUTH_HEADER" \
    -H "X-Requested-With: XMLHttpRequest"
}

# ── Step 2: Upload code template libraries ─────────────────────────────────
echo ""
echo "[2/5] Uploading code template libraries..."

TPL_DIR="$DV_ROOT/code-templates"
TPL_COUNT=0
for tpl in "$TPL_DIR/"*.xml; do
  [[ -f "$tpl" ]] || continue
  name=$(basename "$tpl" .xml)
  echo "  -> $name"

  CONTENT=$(cat "$tpl")
  WRAPPED="<list>${CONTENT}</list>"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $CURL_INSECURE -X PUT \
    "$API_URL/api/codeTemplateLibraries" \
    -H "Content-Type: application/xml" \
    -H "$AUTH_HEADER" \
    -H "X-Requested-With: XMLHttpRequest" \
    -d "$WRAPPED")

  if [[ "$HTTP_CODE" -ge 400 ]]; then
    echo "  WARNING: Upload returned HTTP $HTTP_CODE for $name"
  fi
  TPL_COUNT=$((TPL_COUNT + 1))
done
echo "  Uploaded $TPL_COUNT code template libraries"

# ── Step 3: Upload channels ────────────────────────────────────────────────
echo ""
echo "[3/5] Uploading channels..."

CH_DIR="$DV_ROOT/channels"
CHANNEL_IDS=()
CH_COUNT=0
for ch in "$CH_DIR/"*.xml; do
  [[ -f "$ch" ]] || continue
  name=$(basename "$ch" .xml)

  CH_ID=$(grep -o '<id>[^<]*</id>' "$ch" | head -1 | sed 's/<[^>]*>//g')
  if [[ -z "$CH_ID" ]]; then
    echo "  WARNING: Could not extract channel ID from $name, skipping"
    continue
  fi

  echo "  -> $name ($CH_ID)"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $CURL_INSECURE -X POST \
    "$API_URL/api/channels" \
    -H "Content-Type: application/xml" \
    -H "$AUTH_HEADER" \
    -H "X-Requested-With: XMLHttpRequest" \
    -d @"$ch")

  if [[ "$HTTP_CODE" -ge 400 ]]; then
    echo "  WARNING: Upload returned HTTP $HTTP_CODE for $name"
  fi

  CHANNEL_IDS+=("$CH_ID")
  CH_COUNT=$((CH_COUNT + 1))
done

echo "  Uploaded $CH_COUNT channels"

if [[ ${#CHANNEL_IDS[@]} -eq 0 ]]; then
  echo "ERROR: No channels uploaded. Nothing to deploy." >&2
  exit 1
fi

# ── Step 4: Deploy all channels ────────────────────────────────────────────
echo ""
echo "[4/5] Deploying ${#CHANNEL_IDS[@]} channels..."

DEPLOY_XML="<set>"
for id in "${CHANNEL_IDS[@]}"; do
  DEPLOY_XML+="<string>${id}</string>"
done
DEPLOY_XML+="</set>"

DEPLOY_RESULT=$(curl -s -w "\n%{http_code}" $CURL_INSECURE -X POST \
  "$API_URL/api/channels/_deploy?returnErrors=true" \
  -H "Content-Type: application/xml" \
  -H "$AUTH_HEADER" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d "$DEPLOY_XML")

DEPLOY_HTTP=$(echo "$DEPLOY_RESULT" | tail -1)
if [[ "$DEPLOY_HTTP" -ge 400 ]]; then
  echo "  WARNING: Deploy returned HTTP $DEPLOY_HTTP"
  echo "  Response: $(echo "$DEPLOY_RESULT" | sed '$d')"
fi

# ── Step 5: Wait for STARTED state ────────────────────────────────────────
echo ""
echo "[5/5] Waiting for channels to reach STARTED state (timeout: 180s)..."

TIMEOUT=180
ELAPSED=0
TARGET=${#CHANNEL_IDS[@]}

while [[ $ELAPSED -lt $TIMEOUT ]]; do
  STATUSES=$(curl -s $CURL_INSECURE "$API_URL/api/channels/statuses" \
    -H "$AUTH_HEADER" \
    -H "X-Requested-With: XMLHttpRequest" \
    -H "Accept: application/json" 2>/dev/null || echo "{}")

  STARTED=$(echo "$STATUSES" | grep -o '"STARTED"' | wc -l | tr -d ' ')

  echo "  Channels: $STARTED/$TARGET STARTED (${ELAPSED}s elapsed)"

  if [[ "$STARTED" -ge "$TARGET" ]]; then
    echo ""
    echo "All $TARGET channels reached STARTED state."
    break
  fi

  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [[ $ELAPSED -ge $TIMEOUT ]]; then
  echo ""
  echo "WARNING: Timeout after ${TIMEOUT}s. Only $STARTED/$TARGET channels STARTED." >&2
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=== Deep Validation Deployment Complete ==="
echo "  Code template libraries: $TPL_COUNT"
echo "  Channels deployed:       $CH_COUNT"
echo "  API URL:                 $API_URL"
echo ""
echo "DV channel listener ports:"
echo "  DV01 MLLP (ADT Enrichment):       6670"
echo "  DV02 HTTP (JSON Gateway):          8090"
echo "  DV03 HTTP (Content Router):        8091"
echo "  DV06 MLLP (Batch Processor):       6672"
echo "  DV07 HTTP (Heavy Transformer):     8093"
echo "  DV08 MLLP (Error Injection):       6673"
echo "  DV09 MLLP (VM Chain Entry):        6674"
