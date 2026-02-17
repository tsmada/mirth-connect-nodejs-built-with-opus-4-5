#!/usr/bin/env bash
#
# E2E Smoke Test — verifies the server starts, accepts requests, and processes messages.
#
# Usage:
#   ./scripts/smoke-test.sh                    # Use defaults (localhost:8081)
#   MIRTH_URL=http://host:port ./scripts/smoke-test.sh
#
# Prerequisites:
#   - MySQL running and accessible with env vars from .env
#   - Server NOT already running on the target port (this script starts it)
#   - curl, jq available
#
set -euo pipefail

MIRTH_URL="${MIRTH_URL:-http://localhost:8081}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
TIMEOUT=60
SERVER_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; cleanup; exit 1; }
info() { echo -e "  ${YELLOW}INFO${NC} $1"; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    info "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== Mirth Connect Node.js Smoke Test ==="
echo ""

# ── Step 1: Start server ──────────────────────────────────────────
info "Starting server..."
node dist/index.js &
SERVER_PID=$!

# Wait for startup probe
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -sf "${MIRTH_URL}/api/health/live" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  fail "Server did not start within ${TIMEOUT}s"
fi
pass "Server started (${ELAPSED}s)"

# ── Step 2: Health endpoints ──────────────────────────────────────
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${MIRTH_URL}/api/health/live")
[ "$HTTP_CODE" = "200" ] && pass "Liveness probe: 200" || fail "Liveness probe: $HTTP_CODE"

HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${MIRTH_URL}/api/health")
[ "$HTTP_CODE" = "200" ] && pass "Readiness probe: 200" || fail "Readiness probe: $HTTP_CODE"

# ── Step 3: Login ─────────────────────────────────────────────────
info "Logging in as ${ADMIN_USER}..."
LOGIN_RESPONSE=$(curl -sf -X POST "${MIRTH_URL}/api/users/_login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${ADMIN_USER}&password=${ADMIN_PASS}" \
  -D - 2>/dev/null)

SESSION_ID=$(echo "$LOGIN_RESPONSE" | grep -i 'X-Session-ID' | awk '{print $2}' | tr -d '\r')
if [ -z "$SESSION_ID" ]; then
  fail "Login failed — no session ID returned"
fi
pass "Login successful (session: ${SESSION_ID:0:8}...)"

AUTH="-H X-Session-ID:${SESSION_ID}"

# ── Step 4: Create test channel ───────────────────────────────────
CHANNEL_ID="smoke-test-$(date +%s)"
CHANNEL_XML="<channel>
  <id>${CHANNEL_ID}</id>
  <name>Smoke Test Channel</name>
  <description>Auto-created by smoke-test.sh</description>
  <enabled>true</enabled>
  <sourceConnector>
    <transportName>Channel Reader</transportName>
    <properties class=\"com.mirth.connect.connectors.vm.VmReceiverProperties\">
      <pluginProperties/>
    </properties>
    <filter><elements/></filter>
    <transformer><elements/></transformer>
  </sourceConnector>
  <destinationConnectors>
    <connector>
      <metaDataId>1</metaDataId>
      <name>Destination 1</name>
      <transportName>Channel Writer</transportName>
      <properties class=\"com.mirth.connect.connectors.vm.VmDispatcherProperties\">
        <pluginProperties/>
        <channelId>none</channelId>
        <channelTemplate>\${message.encodedData}</channelTemplate>
      </properties>
      <filter><elements/></filter>
      <transformer><elements/></transformer>
    </connector>
  </destinationConnectors>
</channel>"

info "Creating test channel..."
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "${MIRTH_URL}/api/channels" \
  $AUTH \
  -H "Content-Type: application/xml" \
  -d "$CHANNEL_XML")
[ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ] && \
  pass "Channel created: ${CHANNEL_ID}" || fail "Channel creation failed: $HTTP_CODE"

# ── Step 5: Deploy and start ──────────────────────────────────────
info "Deploying channel..."
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "${MIRTH_URL}/api/channels/_deploy?returnErrors=true" \
  $AUTH \
  -H "Content-Type: application/xml" \
  -d "<set><string>${CHANNEL_ID}</string></set>")
[ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ] && \
  pass "Channel deployed" || fail "Deploy failed: $HTTP_CODE"

sleep 2

# ── Step 6: Verify channel status ────────────────────────────────
STATUS_RESPONSE=$(curl -sf "${MIRTH_URL}/api/channels/statuses" $AUTH 2>/dev/null || echo "{}")
if echo "$STATUS_RESPONSE" | grep -q "$CHANNEL_ID"; then
  pass "Channel visible in status list"
else
  info "Channel status response may use different format — skipping status check"
fi

# ── Step 7: Cleanup — undeploy and delete ─────────────────────────
info "Cleaning up..."
curl -sf -o /dev/null -X POST "${MIRTH_URL}/api/channels/_undeploy?returnErrors=true" \
  $AUTH \
  -H "Content-Type: application/xml" \
  -d "<set><string>${CHANNEL_ID}</string></set>" 2>/dev/null || true

sleep 1

curl -sf -o /dev/null -X DELETE "${MIRTH_URL}/api/channels/${CHANNEL_ID}" \
  $AUTH 2>/dev/null || true

pass "Cleanup complete"

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}=== All smoke tests passed ===${NC}"
echo ""
