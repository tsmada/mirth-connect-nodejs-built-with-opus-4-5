#!/usr/bin/env bash
# Upload Kitchen Sink code template libraries + channels to a Node.js Mirth instance,
# deploy all channels, and wait for STARTED state.
#
# Usage: deploy-kitchen-sink.sh [api-url]
#   api-url: Mirth REST API base URL (default: http://localhost:8080)
#
# Examples:
#   deploy-kitchen-sink.sh                                  # Default localhost:8080
#   deploy-kitchen-sink.sh http://localhost:8081             # Local dev server
#   deploy-kitchen-sink.sh http://node-mirth.mirth-standalone:8080  # In-cluster
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
KS_DIR="$PROJECT_ROOT/validation/scenarios/09-kitchen-sink"

API_URL="${1:-http://localhost:8080}"

# Remove trailing slash
API_URL="${API_URL%/}"

echo "=== Deploying Kitchen Sink to $API_URL ==="

# ── Step 1: Login ────────────────────────────────────────────────────
echo ""
echo "[1/5] Logging in as admin..."

LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL/api/users/_login" \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d '{"username":"admin","password":"admin"}' \
  -D /dev/stderr 2>&1)

# Extract session ID from response headers
SESSION_ID=$(echo "$LOGIN_RESPONSE" | grep -i "^x-session-id:" | head -1 | awk '{print $2}' | tr -d '\r\n')

if [[ -z "$SESSION_ID" ]]; then
  echo "ERROR: Login failed. Could not extract X-Session-ID." >&2
  echo "Response: $LOGIN_RESPONSE" >&2
  exit 1
fi
echo "  Session: ${SESSION_ID:0:20}..."

# Helper: authenticated curl
auth_curl() {
  curl -s -f "$@" \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-Requested-With: XMLHttpRequest"
}

# ── Step 2: Upload code template libraries ───────────────────────────
echo ""
echo "[2/5] Uploading code template libraries..."

TPL_COUNT=0
for tpl in "$KS_DIR/code-templates/"*.xml; do
  [[ -f "$tpl" ]] || continue
  name=$(basename "$tpl" .xml)
  echo "  -> $name"

  # The PUT /api/codeTemplateLibraries expects <list>...</list> wrapping
  CONTENT=$(cat "$tpl")
  WRAPPED="<list>${CONTENT}</list>"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "$API_URL/api/codeTemplateLibraries" \
    -H "Content-Type: application/xml" \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-Requested-With: XMLHttpRequest" \
    -d "$WRAPPED")

  if [[ "$HTTP_CODE" -ge 400 ]]; then
    echo "  WARNING: Upload returned HTTP $HTTP_CODE for $name"
  fi
  TPL_COUNT=$((TPL_COUNT + 1))
done
echo "  Uploaded $TPL_COUNT code template libraries"

# ── Step 3: Upload channels ──────────────────────────────────────────
echo ""
echo "[3/5] Uploading channels..."

CHANNEL_IDS=()
CH_COUNT=0
for ch in "$KS_DIR/channels/"*.xml; do
  [[ -f "$ch" ]] || continue
  name=$(basename "$ch" .xml)

  # Extract channel ID from XML (more reliable than API return)
  CH_ID=$(grep -o '<id>[^<]*</id>' "$ch" | head -1 | sed 's/<[^>]*>//g')
  if [[ -z "$CH_ID" ]]; then
    echo "  WARNING: Could not extract channel ID from $name, skipping"
    continue
  fi

  echo "  -> $name ($CH_ID)"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/api/channels" \
    -H "Content-Type: application/xml" \
    -H "X-Session-ID: $SESSION_ID" \
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

# ── Step 4: Deploy all channels ──────────────────────────────────────
echo ""
echo "[4/5] Deploying ${#CHANNEL_IDS[@]} channels..."

# Build XML set of channel IDs
DEPLOY_XML="<set>"
for id in "${CHANNEL_IDS[@]}"; do
  DEPLOY_XML+="<string>${id}</string>"
done
DEPLOY_XML+="</set>"

DEPLOY_RESULT=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL/api/channels/_deploy?returnErrors=true" \
  -H "Content-Type: application/xml" \
  -H "X-Session-ID: $SESSION_ID" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d "$DEPLOY_XML")

DEPLOY_HTTP=$(echo "$DEPLOY_RESULT" | tail -1)
if [[ "$DEPLOY_HTTP" -ge 400 ]]; then
  echo "  WARNING: Deploy returned HTTP $DEPLOY_HTTP"
  echo "  Response: $(echo "$DEPLOY_RESULT" | head -n -1)"
fi

# ── Step 5: Wait for STARTED state ───────────────────────────────────
echo ""
echo "[5/5] Waiting for channels to reach STARTED state (timeout: 120s)..."

TIMEOUT=120
ELAPSED=0
TARGET=${#CHANNEL_IDS[@]}

while [[ $ELAPSED -lt $TIMEOUT ]]; do
  # Fetch channel statuses as JSON
  STATUSES=$(curl -s "$API_URL/api/channels/statuses" \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-Requested-With: XMLHttpRequest" \
    -H "Accept: application/json" 2>/dev/null || echo "{}")

  # Count STARTED channels (robust grep-based parsing)
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
  echo "Check channel statuses: curl -s $API_URL/api/channels/statuses -H 'X-Session-ID: $SESSION_ID'" >&2
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "=== Kitchen Sink Deployment Complete ==="
echo "  Code template libraries: $TPL_COUNT"
echo "  Channels deployed:       $CH_COUNT"
echo "  API URL:                 $API_URL"
echo ""
echo "Key listener ports:"
echo "  MLLP ADT:     6670"
echo "  MLLP E4X:     6671"
echo "  MLLP Batch:   6672"
echo "  HTTP Gateway:  8090"
echo "  HTTP JSON:     8095"
echo "  HTTP API:      8097"
echo "  DICOM SCP:     11112"
