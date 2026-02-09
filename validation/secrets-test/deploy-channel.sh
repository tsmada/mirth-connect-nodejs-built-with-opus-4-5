#!/usr/bin/env bash
# Deploy the secrets validation channel to the Node.js Mirth engine.
#
# Usage:
#   ./deploy-channel.sh                    # Default: http://localhost:8081
#   MIRTH_URL=http://host:port ./deploy-channel.sh
set -euo pipefail

BASE_URL="${MIRTH_URL:-http://localhost:8081}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANNEL_FILE="$SCRIPT_DIR/Secrets-Validation-Channel.xml"

echo "=== Deploying Secrets Validation Channel ==="
echo "Target: $BASE_URL"
echo ""

# 1. Create the channel via POST (XML body)
echo "1. Creating channel..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/channels" \
  -u admin:admin \
  -H "Content-Type: application/xml" \
  -d @"$CHANNEL_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "   Channel created (HTTP $HTTP_CODE)"
  # The response body should be the channel ID or confirmation
  echo "   Response: $BODY"
else
  echo "   WARNING: HTTP $HTTP_CODE — channel may already exist"
  echo "   Response: $BODY"
  echo ""
  echo "   Attempting to find existing channel..."
  CHANNEL_ID=$(curl -s "$BASE_URL/api/channels/idsAndNames" -u admin:admin | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(next((k for k,v in d.items() if v=='Secrets Validation Channel'), ''))" 2>/dev/null || true)
  if [ -n "$CHANNEL_ID" ]; then
    echo "   Found existing channel: $CHANNEL_ID"
  else
    echo "   ERROR: Could not create or find channel. Check server logs."
    exit 1
  fi
fi

# 2. Find the channel ID
echo ""
echo "2. Looking up channel ID..."
CHANNEL_ID=$(curl -s "$BASE_URL/api/channels/idsAndNames" -u admin:admin | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(next((k for k,v in d.items() if v=='Secrets Validation Channel'), ''))")

if [ -z "$CHANNEL_ID" ]; then
  echo "   ERROR: Channel not found after creation. Check server logs."
  exit 1
fi
echo "   Channel ID: $CHANNEL_ID"

# 3. Deploy the channel
echo ""
echo "3. Deploying channel..."
DEPLOY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/channels/_deploy?returnErrors=true" \
  -u admin:admin \
  -H "Content-Type: application/xml" \
  -d "<set><string>$CHANNEL_ID</string></set>")

DEPLOY_CODE=$(echo "$DEPLOY_RESPONSE" | tail -1)
DEPLOY_BODY=$(echo "$DEPLOY_RESPONSE" | sed '$d')
echo "   Deploy response: HTTP $DEPLOY_CODE"
if [ -n "$DEPLOY_BODY" ]; then
  echo "   $DEPLOY_BODY"
fi

# 4. Wait for channel to start
echo ""
echo "4. Waiting for channel to start (3s)..."
sleep 3

# 5. Verify channel status
echo ""
echo "5. Checking channel status..."
curl -s "$BASE_URL/api/channels/statuses" -u admin:admin | \
  python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        for ch in data:
            name = ch.get('name', 'unknown')
            state = ch.get('state', 'unknown')
            cid = ch.get('channelId', 'unknown')
            if 'Secrets' in name:
                print(f'   {name}: {state} ({cid})')
    elif isinstance(data, dict):
        for cid, info in data.items():
            name = info.get('name', cid) if isinstance(info, dict) else cid
            state = info.get('state', '?') if isinstance(info, dict) else info
            print(f'   {name}: {state}')
except:
    print('   (Could not parse status response)')
" 2>/dev/null || echo "   (Status check failed — channel may still be starting)"

echo ""
echo "=== Channel deployed. Run ./verify-secrets.sh to test ==="
echo ""
echo "Quick test:"
echo "  curl -s -X POST http://localhost:8090/ -d 'hello' | python3 -m json.tool"
