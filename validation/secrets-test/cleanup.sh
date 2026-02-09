#!/usr/bin/env bash
# Undeploy and delete the Secrets Validation Channel.
#
# Usage:
#   ./cleanup.sh
#   MIRTH_URL=http://host:8081 ./cleanup.sh
set -euo pipefail

BASE_URL="${MIRTH_URL:-http://localhost:8081}"

echo "=== Cleaning up Secrets Validation Channel ==="

# Find the channel by name
CHANNEL_ID=$(curl -s "$BASE_URL/api/channels/idsAndNames" -u admin:admin | \
  python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    result = next((k for k, v in d.items() if v == 'Secrets Validation Channel'), '')
    print(result)
except:
    print('')
" 2>/dev/null)

if [ -z "$CHANNEL_ID" ]; then
  echo "Channel 'Secrets Validation Channel' not found — nothing to clean up."
  exit 0
fi

echo "Found channel: $CHANNEL_ID"

# 1. Undeploy
echo "1. Undeploying..."
curl -s -X POST "$BASE_URL/api/channels/_undeploy?returnErrors=true" \
  -u admin:admin \
  -H "Content-Type: application/xml" \
  -d "<set><string>$CHANNEL_ID</string></set>" > /dev/null 2>&1 || true

sleep 1

# 2. Delete
echo "2. Deleting channel..."
DELETE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE_URL/api/channels/$CHANNEL_ID" -u admin:admin)

if [ "$DELETE_CODE" -ge 200 ] && [ "$DELETE_CODE" -lt 300 ]; then
  echo "   Deleted successfully (HTTP $DELETE_CODE)"
else
  echo "   Delete returned HTTP $DELETE_CODE (may have already been deleted)"
fi

echo ""
echo "=== Cleanup complete ==="
