#!/usr/bin/env bash
# Interactive verification of secrets resolution through the channel pipeline.
#
# This script:
#   1. Checks the secrets provider status via REST API
#   2. Sends an HTTP request to the Secrets Validation Channel on port 8090
#   3. Parses the JSON response and validates each expected value
#   4. Tests the preload API
#   5. Tests individual key lookup via API
#
# Prerequisites:
#   - Node.js Mirth running with secrets (./start-with-secrets.sh)
#   - Channel deployed (./deploy-channel.sh)
#
# Usage:
#   ./verify-secrets.sh                    # Default endpoints
#   MIRTH_URL=http://host:8081 ./verify-secrets.sh
set -euo pipefail

BASE_URL="${MIRTH_URL:-http://localhost:8081}"
CHANNEL_PORT=8090
PASS_COUNT=0
FAIL_COUNT=0

green() { printf "\033[32m%s\033[0m" "$1"; }
red()   { printf "\033[31m%s\033[0m" "$1"; }
bold()  { printf "\033[1m%s\033[0m" "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
echo ""
bold "=== Step 1: Check Secrets Provider Status ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────

STATUS_RESPONSE=$(curl -s "$BASE_URL/api/secrets/status" -u admin:admin)
echo "$STATUS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STATUS_RESPONSE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
bold "=== Step 2: Send Test Message to Channel ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────

echo "Sending POST to http://localhost:$CHANNEL_PORT/ ..."
RESPONSE=$(curl -s -X POST "http://localhost:$CHANNEL_PORT/" \
  -H "Content-Type: text/plain" \
  -d "test message for secrets validation" \
  --max-time 10) || {
    echo ""
    red "ERROR: Could not connect to channel on port $CHANNEL_PORT"; echo ""
    echo "Make sure:"
    echo "  1. Node.js Mirth is running (./start-with-secrets.sh)"
    echo "  2. Channel is deployed (./deploy-channel.sh)"
    echo "  3. Port $CHANNEL_PORT is not blocked"
    exit 1
  }

echo ""
echo "Raw response:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
bold "=== Step 3: Verify Expected Values ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────

echo "$RESPONSE" | python3 << 'PYEOF'
import json, sys

response_text = sys.stdin.read().strip()

try:
    r = json.loads(response_text)
except json.JSONDecodeError:
    print('  ERROR: Response is not valid JSON')
    print('  Response was:', response_text[:500])
    sys.exit(1)

cfg = r.get('cfg', {})
sec = r.get('secrets', {})

passed = 0
failed = 0

def check(scope, key, expected, desc):
    global passed, failed
    data = cfg if scope == 'cfg' else sec
    actual = data.get(key, 'MISSING_FROM_RESPONSE')
    ok = actual == expected
    if ok:
        passed += 1
        status = '\033[32mPASS\033[0m'
    else:
        failed += 1
        status = '\033[31mFAIL\033[0m'
    print(f'  [{status}] ${scope}("{key}") = "{actual}"')
    if not ok:
        print(f'         Expected: "{expected}"')
    print(f'         ({desc})')
    print()

print('\033[1m--- $cfg() results ---\033[0m')
print()
check('cfg', 'DB_CONNECTION_STRING', 'mysql://testuser:s3cret@db.example.com:3306/mydb', 'from .env.secrets file via PropertiesFileProvider')
check('cfg', 'API_TOKEN', 'env-override-token-789', 'env var overrides file (EnvProvider has higher priority)')
check('cfg', 'WEBHOOK_URL', 'https://hooks.example.com/notify', 'from .env.secrets file')
check('cfg', 'ENV_ONLY_SECRET', 'only-in-env-not-in-file', 'env-only, not in file')
check('cfg', 'PREFIXED_SECRET', 'via-mirth-cfg-prefix', 'MIRTH_CFG_ prefix strategy (EnvProvider strategy 2)')
check('cfg', 'TOTALLY_MISSING_KEY', 'NOT_FOUND', 'key not in any provider -> returns undefined')
check('cfg', 'EMPTY_SECRET', 'EMPTY_STRING', 'empty string is valid, not undefined')

print(f'  \033[1m{passed}/7 $cfg() tests passed\033[0m')
print()

cfg_passed = passed
cfg_failed = failed
passed = 0
failed = 0

print('\033[1m--- $secrets() results ---\033[0m')
print()
check('secrets', 'DB_CONNECTION_STRING', 'mysql://testuser:s3cret@db.example.com:3306/mydb', 'direct from provider chain')
check('secrets', 'API_TOKEN', 'env-override-token-789', 'env provider wins over file')
check('secrets', 'TOTALLY_MISSING_KEY', 'NOT_FOUND', 'key not in any provider')

print(f'  \033[1m{passed}/3 $secrets() tests passed\033[0m')
print()

total_passed = cfg_passed + passed
total_failed = cfg_failed + failed
total = total_passed + total_failed

if total_failed == 0:
    print(f'\033[32m\033[1m=== ALL {total_passed}/{total} TESTS PASSED ===\033[0m')
else:
    print(f'\033[31m\033[1m=== {total_failed}/{total} TESTS FAILED ===\033[0m')
    print(f'    {total_passed} passed, {total_failed} failed')

sys.exit(0 if total_failed == 0 else 1)
PYEOF

echo ""

# ─────────────────────────────────────────────────────────────────────────────
bold "=== Step 4: Test Preload API ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────

echo "POST /api/secrets/preload with [\"DB_CONNECTION_STRING\", \"NEW_RUNTIME_KEY\"]"
PRELOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/api/secrets/preload" \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"keys": ["DB_CONNECTION_STRING", "NEW_RUNTIME_KEY"]}')
echo "$PRELOAD_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$PRELOAD_RESPONSE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
bold "=== Step 5: Verify Individual Key via API ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────

echo "GET /api/secrets/DB_CONNECTION_STRING?showValue=true"
KEY_RESPONSE=$(curl -s "$BASE_URL/api/secrets/DB_CONNECTION_STRING?showValue=true" -u admin:admin)
echo "$KEY_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$KEY_RESPONSE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
bold "=== Step 6: Verify Missing Key via API ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────

echo "GET /api/secrets/TOTALLY_MISSING_KEY (expect 404)"
MISSING_RESPONSE=$(curl -s -w "\nHTTP %{http_code}" "$BASE_URL/api/secrets/TOTALLY_MISSING_KEY" -u admin:admin)
echo "$MISSING_RESPONSE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
bold "=== Done ==="; echo ""
# ─────────────────────────────────────────────────────────────────────────────
echo "To re-test: curl -s -X POST http://localhost:$CHANNEL_PORT/ -d 'test' | python3 -m json.tool"
echo "To clean up: ./cleanup.sh"
