#!/usr/bin/env bash
# Content Validation Suite: End-to-End Orchestrator
#
# Deploys 6 CV channels, sends deterministic test messages, queries D_MC tables
# to verify that actual transformed content at every pipeline stage matches
# expectations. ~37 checks across 6 channels.
#
# Usage: run-content-validation.sh [options]
#
# Options:
#   --namespace <ns>       Kubernetes namespace (default: mirth-standalone)
#   --api-url <url>        Mirth REST API base URL (default: http://localhost:8080)
#   --mirth-host <host>    Hostname for channel listeners (default: localhost)
#   --local                Use local mysql client instead of kubectl exec
#   --db-host <host>       MySQL host for --local mode (default: 127.0.0.1)
#   --db-port <port>       MySQL port for --local mode (default: 3306)
#   --skip-deploy          Skip channel deployment (channels already deployed)
#   --skip-send            Skip message sending (messages already sent)
#   --generate-baselines   Generate baseline files instead of verifying
#
# Examples:
#   run-content-validation.sh                                          # Full k8s run
#   run-content-validation.sh --local --api-url http://localhost:8081   # Local dev
#   run-content-validation.sh --skip-deploy --skip-send                # Re-verify only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
NAMESPACE="mirth-standalone"
API_URL="http://localhost:8080"
MIRTH_HOST="localhost"
LOCAL_MODE=false
SKIP_DEPLOY=false
SKIP_SEND=false

# Collect flags to forward to verify-content.sh
VERIFY_FLAGS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)     NAMESPACE="$2"; shift 2 ;;
    --api-url)       API_URL="$2"; shift 2 ;;
    --mirth-host)    MIRTH_HOST="$2"; shift 2 ;;
    --local)         LOCAL_MODE=true; VERIFY_FLAGS+=(--local); shift ;;
    --db-host)       VERIFY_FLAGS+=(--db-host "$2"); shift 2 ;;
    --db-port)       VERIFY_FLAGS+=(--db-port "$2"); shift 2 ;;
    --db-user)       VERIFY_FLAGS+=(--db-user "$2"); shift 2 ;;
    --db-pass)       VERIFY_FLAGS+=(--db-pass "$2"); shift 2 ;;
    --db-name)       VERIFY_FLAGS+=(--db-name "$2"); shift 2 ;;
    --skip-deploy)   SKIP_DEPLOY=true; shift ;;
    --skip-send)     SKIP_SEND=true; shift ;;
    --generate-baselines) VERIFY_FLAGS+=(--generate-baselines); shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Always forward namespace
VERIFY_FLAGS+=(--namespace "$NAMESPACE")

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         Content Validation Suite                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Namespace:  %-45s ║\n" "$NAMESPACE"
printf "║  API URL:    %-45s ║\n" "$API_URL"
printf "║  Mirth Host: %-45s ║\n" "$MIRTH_HOST"
printf "║  Local Mode: %-45s ║\n" "$LOCAL_MODE"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# -- Phase 1: Prerequisites ------------------------------------------------
echo "=== Phase 1: Prerequisites ==="

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required but not found" >&2
  exit 1
fi
echo "  [OK] curl available"

if [[ "$LOCAL_MODE" == "false" ]]; then
  if ! command -v kubectl &>/dev/null; then
    echo "ERROR: kubectl required for non-local mode" >&2
    exit 1
  fi
  echo "  [OK] kubectl available"

  # Verify namespace exists
  if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    echo "ERROR: Namespace '$NAMESPACE' does not exist" >&2
    exit 1
  fi
  echo "  [OK] Namespace '$NAMESPACE' exists"

  # Verify MySQL pod ready
  MYSQL_POD=$(kubectl get pods -n "$NAMESPACE" -l app=mysql -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -z "$MYSQL_POD" ]]; then
    echo "ERROR: No MySQL pod found in namespace '$NAMESPACE'" >&2
    exit 1
  fi
  echo "  [OK] MySQL pod: $MYSQL_POD"
fi

# Verify Mirth healthy
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/health/live" 2>/dev/null || echo "000")
if [[ "$HEALTH_CODE" == "200" ]]; then
  echo "  [OK] Mirth healthy at $API_URL"
else
  echo "ERROR: Mirth health check failed (HTTP $HEALTH_CODE) at $API_URL/api/health/live" >&2
  echo "  Ensure port-forward is active or API URL is correct." >&2
  exit 1
fi

echo ""

# -- Phase 2: Deploy CV Channels ------------------------------------------
if [[ "$SKIP_DEPLOY" == "true" ]]; then
  echo "=== Phase 2: Deploy CV Channels (SKIPPED) ==="
else
  echo "=== Phase 2: Deploy CV Channels ==="
  "$SCRIPT_DIR/deploy-cv-channels.sh" "$API_URL"
fi
echo ""

# -- Phase 3: Send Test Messages -------------------------------------------
if [[ "$SKIP_SEND" == "true" ]]; then
  echo "=== Phase 3: Send Test Messages (SKIPPED) ==="
else
  echo "=== Phase 3: Send Test Messages ==="
  "$SCRIPT_DIR/send-test-messages.sh" "$MIRTH_HOST"
fi
echo ""

# -- Phase 4-6: Verify Content --------------------------------------------
echo "=== Phase 4-6: Verify Persisted Content ==="
"$SCRIPT_DIR/verify-content.sh" "${VERIFY_FLAGS[@]}"

EXIT_CODE=$?

echo ""
echo "=== Content Validation Complete ==="

exit $EXIT_CODE
