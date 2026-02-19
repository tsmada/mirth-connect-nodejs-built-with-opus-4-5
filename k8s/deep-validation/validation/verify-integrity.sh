#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: Data Integrity Verification
# =============================================================================
# Structural integrity checks:
#   - No duplicate MESSAGE_IDs in D_M tables
#   - No orphaned D_MC rows (no matching D_MM row)
#   - SERVER_ID distribution in D_M tables
#   - DV09-DV12 chain results: all hop_count = 4
#   - Route determinism: no patient in multiple dv_route_* tables
#   - Custom metadata persistence: D_MCM exists for DV06
#
# Exit 0 = all pass, Exit 1 = integrity violations found
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

echo "=== Data Integrity Verification ==="
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

FAILURES=0

# ── Resolve local channel IDs ─────────────────────────────────────────────
echo "[1/6] Resolving DV channel local IDs..."
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

# ── Check 1: Duplicate MESSAGE_IDs ────────────────────────────────────────
echo "[2/6] Checking for duplicate MESSAGE_IDs..."

DUP_TOTAL=0
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  dups=$(mysql_query "SELECT COUNT(*) FROM (SELECT MESSAGE_ID FROM D_M${local_id} GROUP BY MESSAGE_ID HAVING COUNT(*) > 1) dup" | tr -d '[:space:]')
  dups=${dups:-0}

  if [[ "$dups" -gt 0 ]]; then
    echo "  FAIL: $ch_id (local $local_id) has $dups duplicate MESSAGE_IDs"
    DUP_TOTAL=$((DUP_TOTAL + dups))
    FAILURES=$((FAILURES + 1))
  fi
done

if [[ "$DUP_TOTAL" -eq 0 ]]; then
  echo "  PASS: No duplicate MESSAGE_IDs"
else
  echo "  FAIL: $DUP_TOTAL total duplicates found"
fi
echo ""

# ── Check 2: Orphaned D_MC rows ───────────────────────────────────────────
echo "[3/6] Checking for orphaned D_MC rows..."

ORPHAN_TOTAL=0
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  orphans=$(mysql_query "SELECT COUNT(*) FROM D_MC${local_id} mc LEFT JOIN D_MM${local_id} mm ON mc.MESSAGE_ID = mm.MESSAGE_ID AND mc.METADATA_ID = mm.METADATA_ID WHERE mm.MESSAGE_ID IS NULL" | tr -d '[:space:]')
  orphans=${orphans:-0}

  if [[ "$orphans" -gt 0 ]]; then
    echo "  FAIL: $ch_id (local $local_id) has $orphans orphaned D_MC rows"
    ORPHAN_TOTAL=$((ORPHAN_TOTAL + orphans))
    FAILURES=$((FAILURES + 1))
  fi
done

if [[ "$ORPHAN_TOTAL" -eq 0 ]]; then
  echo "  PASS: No orphaned content rows"
else
  echo "  FAIL: $ORPHAN_TOTAL total orphaned rows"
fi
echo ""

# ── Check 3: SERVER_ID distribution ────────────────────────────────────────
echo "[4/6] Checking SERVER_ID distribution..."

# Pick a channel with messages to show distribution
SAMPLE_CH=""
for ch_id in "${!LOCAL_IDS[@]}"; do
  local_id="${LOCAL_IDS[$ch_id]}"
  count=$(mysql_query "SELECT COUNT(*) FROM D_M${local_id}" | tr -d '[:space:]')
  if [[ "${count:-0}" -gt 0 ]]; then
    SAMPLE_CH="$ch_id"
    break
  fi
done

if [[ -n "$SAMPLE_CH" ]]; then
  local_id="${LOCAL_IDS[$SAMPLE_CH]}"
  echo "  Distribution for $SAMPLE_CH (local $local_id):"
  mysql_query "SELECT SERVER_ID, COUNT(*) AS msg_count FROM D_M${local_id} GROUP BY SERVER_ID ORDER BY msg_count DESC" | while read -r sid count; do
    echo "    $sid: $count messages"
  done

  # Count unique server IDs across all channels
  ALL_SIDS=""
  for ch_id in "${!LOCAL_IDS[@]}"; do
    local_id="${LOCAL_IDS[$ch_id]}"
    sids=$(mysql_query "SELECT DISTINCT SERVER_ID FROM D_M${local_id}" 2>/dev/null || true)
    ALL_SIDS="$ALL_SIDS $sids"
  done
  UNIQUE_SIDS=$(echo "$ALL_SIDS" | tr ' ' '\n' | sort -u | grep -c '[^[:space:]]' || echo "0")
  echo "  Total unique SERVER_IDs across all channels: $UNIQUE_SIDS"
else
  echo "  SKIP: No messages in any channel yet"
fi
echo ""

# ── Check 4: VM Chain results (DV09-DV12) ─────────────────────────────────
echo "[5/6] Checking VM chain results (dv_chain_results)..."

CHAIN_TOTAL=$(mysql_query "SELECT COUNT(*) FROM dv_chain_results" 2>/dev/null | tr -d '[:space:]')
CHAIN_TOTAL=${CHAIN_TOTAL:-0}

if [[ "$CHAIN_TOTAL" -eq 0 ]]; then
  echo "  SKIP: No chain results yet"
else
  INCOMPLETE_CHAINS=$(mysql_query "SELECT COUNT(*) FROM dv_chain_results WHERE hop_count < 4" | tr -d '[:space:]')
  INCOMPLETE_CHAINS=${INCOMPLETE_CHAINS:-0}

  if [[ "$INCOMPLETE_CHAINS" -gt 0 ]]; then
    echo "  FAIL: $INCOMPLETE_CHAINS/$CHAIN_TOTAL chain results have hop_count < 4"
    mysql_query "SELECT chain_id, hop_count FROM dv_chain_results WHERE hop_count < 4 LIMIT 5" | while read -r cid hops; do
      echo "    chain=$cid hop_count=$hops"
    done
    FAILURES=$((FAILURES + 1))
  else
    echo "  PASS: All $CHAIN_TOTAL chain results have hop_count = 4"
  fi
fi
echo ""

# ── Check 5: Route determinism (DV03-DV05) ────────────────────────────────
echo "[5.5/6] Checking route determinism..."

# A patient should only appear in one route table
ROUTE_A_NAMES=$(mysql_query "SELECT DISTINCT patient_name FROM dv_route_a" 2>/dev/null || true)
ROUTE_B_NAMES=$(mysql_query "SELECT DISTINCT patient_name FROM dv_route_b" 2>/dev/null || true)
ROUTE_C_NAMES=$(mysql_query "SELECT DISTINCT patient_name FROM dv_route_c" 2>/dev/null || true)

# Check for overlap using SQL (more reliable than bash set operations)
OVERLAP_AB=$(mysql_query "SELECT COUNT(*) FROM dv_route_a a INNER JOIN dv_route_b b ON a.patient_name = b.patient_name" 2>/dev/null | tr -d '[:space:]')
OVERLAP_AC=$(mysql_query "SELECT COUNT(*) FROM dv_route_a a INNER JOIN dv_route_c c ON a.patient_name = c.patient_name" 2>/dev/null | tr -d '[:space:]')
OVERLAP_BC=$(mysql_query "SELECT COUNT(*) FROM dv_route_b b INNER JOIN dv_route_c c ON b.patient_name = c.patient_name" 2>/dev/null | tr -d '[:space:]')
OVERLAP_AB=${OVERLAP_AB:-0}
OVERLAP_AC=${OVERLAP_AC:-0}
OVERLAP_BC=${OVERLAP_BC:-0}

TOTAL_OVERLAP=$((OVERLAP_AB + OVERLAP_AC + OVERLAP_BC))
if [[ "$TOTAL_OVERLAP" -gt 0 ]]; then
  echo "  FAIL: Patients appear in multiple route tables"
  echo "    Route A-B overlap: $OVERLAP_AB"
  echo "    Route A-C overlap: $OVERLAP_AC"
  echo "    Route B-C overlap: $OVERLAP_BC"
  FAILURES=$((FAILURES + 1))
else
  ROUTE_TOTAL=$(mysql_query "SELECT (SELECT COUNT(*) FROM dv_route_a) + (SELECT COUNT(*) FROM dv_route_b) + (SELECT COUNT(*) FROM dv_route_c)" 2>/dev/null | tr -d '[:space:]')
  ROUTE_TOTAL=${ROUTE_TOTAL:-0}
  if [[ "$ROUTE_TOTAL" -eq 0 ]]; then
    echo "  SKIP: No routed messages yet"
  else
    echo "  PASS: No cross-route patient overlap ($ROUTE_TOTAL total routed messages)"
  fi
fi
echo ""

# ── Check 6: Custom metadata (DV06) ───────────────────────────────────────
echo "[6/6] Checking DV06 custom metadata (D_MCM)..."

DV06_ID="dv000006-0006-0006-0006-000000000006"
if [[ -n "${LOCAL_IDS[$DV06_ID]:-}" ]]; then
  local_id="${LOCAL_IDS[$DV06_ID]}"
  msg_count=$(mysql_query "SELECT COUNT(*) FROM D_M${local_id}" | tr -d '[:space:]')
  mcm_count=$(mysql_query "SELECT COUNT(*) FROM D_MCM${local_id}" 2>/dev/null | tr -d '[:space:]')
  mcm_count=${mcm_count:-0}
  msg_count=${msg_count:-0}

  if [[ "$msg_count" -eq 0 ]]; then
    echo "  SKIP: No DV06 messages processed yet"
  elif [[ "$mcm_count" -eq 0 ]]; then
    echo "  FAIL: DV06 has $msg_count messages but no D_MCM rows"
    FAILURES=$((FAILURES + 1))
  else
    echo "  PASS: DV06 has $mcm_count custom metadata rows for $msg_count messages"
  fi
else
  echo "  SKIP: DV06 not deployed"
fi
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "=== Data Integrity Summary ==="
echo "  Duplicate MESSAGE_IDs: $DUP_TOTAL"
echo "  Orphaned D_MC rows:    $ORPHAN_TOTAL"
echo "  Incomplete chains:     ${INCOMPLETE_CHAINS:-N/A}"
echo "  Route overlaps:        $TOTAL_OVERLAP"
echo ""

if [[ "$FAILURES" -gt 0 ]]; then
  echo "=== RESULT: FAIL ($FAILURES integrity violations) ==="
  exit 1
else
  echo "=== RESULT: PASS ==="
  exit 0
fi
