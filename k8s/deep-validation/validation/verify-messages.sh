#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Message Verification
# =============================================================================
# Checks that no messages are stuck or pending across DV channels.
# Verifies end-to-end processing completeness.
#
# Exit 0 = all pass, Exit 1 = one or more checks failed
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD="${MYSQL_POD:-}"
DB_NAME="${DB_NAME:-mirthdb}"

# DV channel UUIDs
DV_CHANNELS=(
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

# ── Auto-detect MySQL pod ──────────────────────────────────────────────────
if [[ -z "$MYSQL_POD" ]]; then
  MYSQL_POD=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l app=mysql \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -z "$MYSQL_POD" ]]; then
    echo "ERROR: Could not find MySQL pod in namespace $MYSQL_NAMESPACE" >&2
    exit 1
  fi
fi

# ── Helper: run MySQL query via kubectl ────────────────────────────────────
mysql_query() {
  kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
    mysql -u mirth -pmirth "$DB_NAME" -N -e "$1" 2>/dev/null
}

echo "=== Message Verification ==="
echo "  Namespace: $NAMESPACE"
echo "  MySQL Pod: $MYSQL_POD ($MYSQL_NAMESPACE)"
echo "  Database:  $DB_NAME"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

FAILURES=0
CHANNELS_CHECKED=0

# ── Resolve local channel IDs ─────────────────────────────────────────────
echo "[1/4] Resolving DV channel local IDs..."
declare -A LOCAL_IDS

for ch_id in "${DV_CHANNELS[@]}"; do
  local_id=$(mysql_query "SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = '$ch_id'" | tr -d '[:space:]')
  if [[ -n "$local_id" ]]; then
    LOCAL_IDS["$ch_id"]="$local_id"
    echo "  $ch_id -> local $local_id"
  fi
done

if [[ ${#LOCAL_IDS[@]} -eq 0 ]]; then
  echo "  WARNING: No DV channels found in D_CHANNELS. Are channels deployed?"
  echo ""
  echo "=== RESULT: SKIP (no channels) ==="
  exit 0
fi
echo "  Found ${#LOCAL_IDS[@]}/${#DV_CHANNELS[@]} DV channels"
echo ""

# ── Check 1: Stuck messages (PROCESSED=0) ─────────────────────────────────
echo "[2/4] Checking for stuck messages (PROCESSED=0)..."

TOTAL_STUCK=0
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  stuck=$(mysql_query "SELECT COUNT(*) FROM D_M${local_id} WHERE PROCESSED = 0" | tr -d '[:space:]')
  stuck=${stuck:-0}

  if [[ "$stuck" -gt 0 ]]; then
    echo "  FAIL: $ch_id (local $local_id) has $stuck stuck messages"
    TOTAL_STUCK=$((TOTAL_STUCK + stuck))
    FAILURES=$((FAILURES + 1))
  else
    echo "  OK:   $ch_id (local $local_id)"
  fi
  CHANNELS_CHECKED=$((CHANNELS_CHECKED + 1))
done

if [[ "$TOTAL_STUCK" -eq 0 ]]; then
  echo "  PASS: No stuck messages across $CHANNELS_CHECKED channels"
else
  echo "  FAIL: $TOTAL_STUCK total stuck messages"
fi
echo ""

# ── Check 2: Pending connectors (STATUS IN R,P) ──────────────────────────
echo "[3/4] Checking for pending connectors (STATUS IN R,P)..."

TOTAL_PENDING=0
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  pending=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE STATUS IN ('R','P')" | tr -d '[:space:]')
  pending=${pending:-0}

  if [[ "$pending" -gt 0 ]]; then
    echo "  FAIL: $ch_id (local $local_id) has $pending pending connectors"
    # Show breakdown by status and metadata_id
    mysql_query "SELECT METADATA_ID, STATUS, COUNT(*) FROM D_MM${local_id} WHERE STATUS IN ('R','P') GROUP BY METADATA_ID, STATUS" | while read -r line; do
      echo "         $line"
    done
    TOTAL_PENDING=$((TOTAL_PENDING + pending))
    FAILURES=$((FAILURES + 1))
  fi
done

if [[ "$TOTAL_PENDING" -eq 0 ]]; then
  echo "  PASS: No pending connectors"
else
  echo "  FAIL: $TOTAL_PENDING total pending connectors"
fi
echo ""

# ── Check 3: Enrichment completeness (DV01) ───────────────────────────────
echo "[4/4] Checking DV01 enrichment completeness..."

INCOMPLETE=$(mysql_query "SELECT COUNT(*) FROM dv_enriched_messages WHERE mrn IS NULL OR event_desc IS NULL OR mrn = '' OR event_desc = ''" | tr -d '[:space:]')
INCOMPLETE=${INCOMPLETE:-0}
TOTAL_ENRICHED=$(mysql_query "SELECT COUNT(*) FROM dv_enriched_messages" | tr -d '[:space:]')
TOTAL_ENRICHED=${TOTAL_ENRICHED:-0}

if [[ "$TOTAL_ENRICHED" -eq 0 ]]; then
  echo "  SKIP: No enriched messages yet"
elif [[ "$INCOMPLETE" -gt 0 ]]; then
  echo "  FAIL: $INCOMPLETE/$TOTAL_ENRICHED messages missing enrichment data"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS: All $TOTAL_ENRICHED messages fully enriched"
fi
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "=== Message Verification Summary ==="
echo "  Channels checked: $CHANNELS_CHECKED"
echo "  Stuck messages:   $TOTAL_STUCK"
echo "  Pending conns:    $TOTAL_PENDING"
echo "  Enrichment gaps:  $INCOMPLETE"
echo ""

if [[ "$FAILURES" -gt 0 ]]; then
  echo "=== RESULT: FAIL ($FAILURES checks failed) ==="
  exit 1
else
  echo "=== RESULT: PASS ==="
  exit 0
fi
