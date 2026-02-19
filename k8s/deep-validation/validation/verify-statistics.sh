#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Statistics Verification
# =============================================================================
# Compares D_MS (statistics counters) against actual D_MM (metadata) row counts.
# Discrepancies indicate statistics tracking bugs in the engine.
#
# Exit 0 = all match, Exit 1 = mismatches found
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD="${MYSQL_POD:-}"
DB_NAME="${DB_NAME:-mirthdb}"

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

mysql_query() {
  kubectl exec -n "$MYSQL_NAMESPACE" "$MYSQL_POD" -- \
    mysql -u mirth -pmirth "$DB_NAME" -N -e "$1" 2>/dev/null
}

echo "=== Statistics Verification ==="
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

FAILURES=0
CHANNELS_CHECKED=0

# ── Resolve local channel IDs ─────────────────────────────────────────────
echo "[1/3] Resolving DV channel local IDs..."
declare -A LOCAL_IDS

for ch_id in "${DV_CHANNELS[@]}"; do
  local_id=$(mysql_query "SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = '$ch_id'" | tr -d '[:space:]')
  if [[ -n "$local_id" ]]; then
    LOCAL_IDS["$ch_id"]="$local_id"
  fi
done

if [[ ${#LOCAL_IDS[@]} -eq 0 ]]; then
  echo "  No DV channels found. Skipping."
  echo "=== RESULT: SKIP ==="
  exit 0
fi
echo "  Found ${#LOCAL_IDS[@]} channels"
echo ""

# ── Check: Statistics vs actual counts ─────────────────────────────────────
echo "[2/3] Comparing D_MS statistics vs D_MM actual counts..."
echo ""
printf "  %-44s %8s %8s %8s %8s %8s %8s %s\n" \
  "CHANNEL" "S_RECV" "A_RECV" "S_SENT" "A_SENT" "S_ERR" "A_ERR" "RESULT"
printf "  %-44s %8s %8s %8s %8s %8s %8s %s\n" \
  "--------------------------------------------" "--------" "--------" "--------" "--------" "--------" "--------" "------"

for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"

  # D_MS statistics (SUM across all SERVER_IDs, METADATA_ID=0 = source connector)
  stat_row=$(mysql_query "SELECT COALESCE(SUM(RECEIVED),0), COALESCE(SUM(SENT),0), COALESCE(SUM(ERROR),0) FROM D_MS${local_id} WHERE METADATA_ID = 0")
  stat_received=$(echo "$stat_row" | awk '{print $1}')
  stat_sent=$(echo "$stat_row" | awk '{print $2}')
  stat_error=$(echo "$stat_row" | awk '{print $3}')

  # D_MM actual counts (METADATA_ID=0 = source connector row)
  actual_total=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE METADATA_ID = 0" | tr -d '[:space:]')
  actual_sent=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE METADATA_ID = 0 AND STATUS = 'S'" | tr -d '[:space:]')
  actual_error=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE METADATA_ID = 0 AND STATUS = 'E'" | tr -d '[:space:]')

  # Compare
  result="PASS"
  if [[ "$stat_received" != "$actual_total" ]] || [[ "$stat_sent" != "$actual_sent" ]] || [[ "$stat_error" != "$actual_error" ]]; then
    result="FAIL"
    FAILURES=$((FAILURES + 1))
  fi

  # Truncate channel ID for display
  ch_short="${ch_id:0:44}"
  printf "  %-44s %8s %8s %8s %8s %8s %8s %s\n" \
    "$ch_short" "$stat_received" "$actual_total" "$stat_sent" "$actual_sent" "$stat_error" "$actual_error" "$result"

  CHANNELS_CHECKED=$((CHANNELS_CHECKED + 1))
done
echo ""

# ── DV08 Error rate check ─────────────────────────────────────────────────
echo "[3/3] Checking DV08 error injection rate..."

DV08_ID="dv000008-0008-0008-0008-000000000008"
if [[ -n "${LOCAL_IDS[$DV08_ID]:-}" ]]; then
  local_id="${LOCAL_IDS[$DV08_ID]}"
  dv08_total=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE METADATA_ID = 0" | tr -d '[:space:]')
  dv08_errors=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE METADATA_ID = 0 AND STATUS = 'E'" | tr -d '[:space:]')
  dv08_total=${dv08_total:-0}
  dv08_errors=${dv08_errors:-0}

  if [[ "$dv08_total" -gt 0 ]]; then
    # Calculate error rate as integer percentage (bash can't do float)
    error_pct=$((dv08_errors * 100 / dv08_total))
    echo "  DV08 total: $dv08_total, errors: $dv08_errors, error rate: ~${error_pct}%"
    # Expected ~10% error rate (dv08FailRate=0.1). Accept 5-20% range.
    if [[ "$error_pct" -lt 5 ]] || [[ "$error_pct" -gt 20 ]]; then
      echo "  WARNING: Error rate ${error_pct}% outside expected 5-20% range"
    else
      echo "  OK: Error rate within expected range (5-20%)"
    fi
  else
    echo "  SKIP: No DV08 messages processed yet"
  fi
else
  echo "  SKIP: DV08 not deployed"
fi
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "=== Statistics Verification Summary ==="
echo "  Channels checked: $CHANNELS_CHECKED"
echo "  Mismatches:       $FAILURES"
echo ""

if [[ "$FAILURES" -gt 0 ]]; then
  echo "=== RESULT: FAIL ($FAILURES channels with statistics mismatches) ==="
  exit 1
else
  echo "=== RESULT: PASS ==="
  exit 0
fi
