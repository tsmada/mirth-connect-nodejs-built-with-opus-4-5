#!/usr/bin/env bash
# Start Node.js Mirth with secrets providers enabled for interactive testing.
#
# This script configures:
#   - EnvProvider (priority 1): reads process.env directly
#   - PropertiesFileProvider (priority 2): reads .env.secrets file
#
# It also sets env vars that intentionally overlap with .env.secrets
# to verify priority ordering (env should win over file).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --- Secrets Provider Config ---
export MIRTH_SECRETS_PROVIDERS="env,props"
export MIRTH_CONFIG_FILE="$SCRIPT_DIR/.env.secrets"
export MIRTH_SECRETS_CFG_KEYS="DB_CONNECTION_STRING,API_TOKEN,WEBHOOK_URL,ENCRYPTION_KEY,SERVICE_ACCOUNT,EMPTY_SECRET,ENV_ONLY_SECRET,MISSING_KEY"
export MIRTH_SECRETS_CACHE_TTL=60

# --- Env-only secrets (test EnvProvider priority) ---
export API_TOKEN="env-override-token-789"          # Overrides .env.secrets value
export ENV_ONLY_SECRET="only-in-env-not-in-file"   # Only in env, not in file
export MIRTH_CFG_PREFIXED_SECRET="via-mirth-cfg-prefix"  # MIRTH_CFG_ prefix strategy

# --- Operational mode (takeover against existing Java Mirth DB) ---
export MIRTH_MODE=takeover

# --- Standard server config ---
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-3306}"
export DB_USER="${DB_USER:-mirth}"
export DB_PASSWORD="${DB_PASSWORD:-mirth}"
export DB_NAME="${DB_NAME:-mirthdb}"
export PORT="${PORT:-8081}"

echo "=== Secrets Test Configuration ==="
echo "Mode:          $MIRTH_MODE (takeover)"
echo "Providers:     $MIRTH_SECRETS_PROVIDERS"
echo "Config file:   $MIRTH_CONFIG_FILE"
echo "Preload keys:  $MIRTH_SECRETS_CFG_KEYS"
echo "Cache TTL:     ${MIRTH_SECRETS_CACHE_TTL}s"
echo "API_TOKEN:     env-override-token-789 (overrides file value sk-test-abc123def456)"
echo "ENV_ONLY:      only-in-env-not-in-file"
echo "PREFIXED:      MIRTH_CFG_PREFIXED_SECRET = via-mirth-cfg-prefix"
echo "=================================="

cd "$PROJECT_DIR"
node dist/index.js
