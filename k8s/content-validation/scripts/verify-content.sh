#!/usr/bin/env bash
# Content Validation Suite: Verify persisted content in D_MC tables.
#
# Queries the MySQL database to verify that each CV channel persisted
# the correct content types, status codes, and content values.
#
# Usage:
#   verify-content.sh [options]
#
# Options:
#   --namespace <ns>   Kubernetes namespace (default: mirth-standalone)
#   --local            Use local mysql client instead of kubectl exec
#   --db-host <host>   MySQL host for --local mode (default: 127.0.0.1)
#   --db-port <port>   MySQL port for --local mode (default: 3306)
#   --db-user <user>   MySQL user (default: mirth)
#   --db-pass <pass>   MySQL password (default: mirth)
#   --db-name <name>   MySQL database (default: mirthdb)
#   --generate-baselines  Write content to baselines/ instead of verifying
#
# Examples:
#   verify-content.sh --namespace mirth-standalone
#   verify-content.sh --local --db-port 3307
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE_DIR="$SCRIPT_DIR/../baselines"

# Defaults
NAMESPACE="mirth-standalone"
LOCAL_MODE=false
DB_HOST="127.0.0.1"
DB_PORT="3306"
DB_USER="mirth"
DB_PASS="mirth"
DB_NAME="mirthdb"
GENERATE_BASELINES=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --local) LOCAL_MODE=true; shift ;;
    --db-host) DB_HOST="$2"; shift 2 ;;
    --db-port) DB_PORT="$2"; shift 2 ;;
    --db-user) DB_USER="$2"; shift 2 ;;
    --db-pass) DB_PASS="$2"; shift 2 ;;
    --db-name) DB_NAME="$2"; shift 2 ;;
    --generate-baselines) GENERATE_BASELINES=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Counters
PASS=0
FAIL=0
SKIP=0

# Content type constants
CT_RAW=1
CT_PROCESSED_RAW=2
CT_TRANSFORMED=3
CT_ENCODED=4
CT_SENT=5
CT_RESPONSE=6
CT_RESPONSE_TRANSFORMED=7
CT_PROCESSED_RESPONSE=8
CT_CONNECTOR_MAP=9
CT_CHANNEL_MAP=10
CT_RESPONSE_MAP=11
CT_PROCESSING_ERROR=12
CT_POSTPROCESSOR_ERROR=13
CT_RESPONSE_ERROR=14
CT_SOURCE_MAP=15

# ---------------------------------------------------------------------------
# MySQL query helper
# ---------------------------------------------------------------------------
mysql_query() {
  local query="$1"
  if [[ "$LOCAL_MODE" == "true" ]]; then
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "$query" 2>/dev/null
  else
    local mysql_pod
    mysql_pod=$(kubectl get pods -n "$NAMESPACE" -l app=mysql -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [[ -z "$mysql_pod" ]]; then
      echo "ERROR: Could not find MySQL pod in namespace $NAMESPACE" >&2
      return 1
    fi
    kubectl exec -n "$NAMESPACE" "$mysql_pod" -- \
      mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "$query" 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# Comparison helpers
# ---------------------------------------------------------------------------
compare_contains() {
  local actual="$1" expected_substr="$2"
  echo "$actual" | grep -qF "$expected_substr"
}

compare_not_contains() {
  local actual="$1" unexpected_substr="$2"
  ! echo "$actual" | grep -qF "$unexpected_substr"
}

compare_present() {
  local actual="$1"
  [[ -n "$actual" ]]
}

compare_absent() {
  local actual="$1"
  [[ -z "$actual" ]]
}

# ---------------------------------------------------------------------------
# Test reporting
# ---------------------------------------------------------------------------
GAP=0
GAPS=()

check() {
  local id="$1" description="$2" result="$3" detail="${4:-}"
  local padded
  padded=$(printf "%-55s" "[$id] $description")
  if [[ "$result" == "PASS" ]]; then
    echo "  $padded PASS"
    PASS=$((PASS + 1))
  elif [[ "$result" == "SKIP" ]]; then
    echo "  $padded SKIP"
    SKIP=$((SKIP + 1))
  elif [[ "$result" == "GAP" ]]; then
    echo "  $padded GAP"
    GAP=$((GAP + 1))
    GAPS+=("$id: $detail")
  else
    echo "  $padded FAIL"
    FAIL=$((FAIL + 1))
    if [[ -n "$detail" ]]; then
      echo "        -> $detail"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Content query helpers
# ---------------------------------------------------------------------------
get_content() {
  local local_id="$1" msg_id="$2" meta_id="$3" content_type="$4"
  mysql_query "SELECT CONTENT FROM D_MC${local_id} WHERE MESSAGE_ID = ${msg_id} AND METADATA_ID = ${meta_id} AND CONTENT_TYPE = ${content_type} LIMIT 1"
}

get_status() {
  local local_id="$1" msg_id="$2" meta_id="$3"
  mysql_query "SELECT STATUS FROM D_MM${local_id} WHERE MESSAGE_ID = ${msg_id} AND METADATA_ID = ${meta_id} LIMIT 1" | tr -d '[:space:]'
}

get_first_msg_id() {
  local local_id="$1"
  mysql_query "SELECT MIN(ID) FROM D_M${local_id}" | tr -d '[:space:]'
}

get_second_msg_id() {
  local local_id="$1"
  mysql_query "SELECT ID FROM D_M${local_id} ORDER BY ID LIMIT 1 OFFSET 1" | tr -d '[:space:]'
}

has_dest_row() {
  local local_id="$1" msg_id="$2" meta_id="$3"
  local count
  count=$(mysql_query "SELECT COUNT(*) FROM D_MM${local_id} WHERE MESSAGE_ID = ${msg_id} AND METADATA_ID = ${meta_id}" | tr -d '[:space:]')
  [[ "$count" -gt 0 ]]
}

# ============================================================================
# Phase 1: Resolve table names
# ============================================================================
echo "=== Content Validation: Verifying Persisted Content ==="
echo ""
echo "-- Phase 1: Resolving channel table names --"

CV_CHANNELS=("cv000001-0001-0001-0001-000000000001"
             "cv000002-0002-0002-0002-000000000002"
             "cv000003-0003-0003-0003-000000000003"
             "cv000004-0004-0004-0004-000000000004"
             "cv000005-0005-0005-0005-000000000005"
             "cv000006-0006-0006-0006-000000000006")

# Table suffix: channel UUID with hyphens replaced by underscores
# e.g., cv000001-0001-0001-0001-000000000001 → cv000001_0001_0001_0001_000000000001
# Tables: D_M{suffix}, D_MM{suffix}, D_MC{suffix}, etc.
TABLE_SUFFIXES=()

idx=0
for ch_id in "${CV_CHANNELS[@]}"; do
  suffix="${ch_id//-/_}"
  # Verify the table actually exists
  table_check=$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'D_M${suffix}'" | tr -d '[:space:]')
  if [[ "$table_check" != "1" ]]; then
    echo "  WARNING: Channel $ch_id table D_M${suffix} not found"
    TABLE_SUFFIXES[$idx]=""
  else
    TABLE_SUFFIXES[$idx]="$suffix"
    short="${ch_id:0:8}"
    echo "  $short -> table suffix = $suffix"
  fi
  idx=$((idx + 1))
done

echo ""

# Helper to get table suffix by CV number (1-based)
cv_local() {
  local cv_num="$1"
  echo "${TABLE_SUFFIXES[$((cv_num - 1))]:-}"
}

# ============================================================================
# Phase 2: CV01 - HL7 Filter + Transformer
# ============================================================================
echo "-- Phase 2: CV01 - HL7 Filter + Transformer --"

LID=$(cv_local 1)
if [[ -z "$LID" ]]; then
  echo "  SKIP: CV01 not deployed"
  SKIP=$((SKIP + 12))
else
  # First message: ADT A01 (accepted)
  MSG1=$(get_first_msg_id "$LID")
  if [[ -z "$MSG1" || "$MSG1" == "NULL" ]]; then
    echo "  SKIP: No messages found for CV01"
    SKIP=$((SKIP + 12))
  else
    # Source RAW
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_RAW")
    if compare_contains "$CONTENT" "CV_SENDER"; then
      check "CV01-01" "Source RAW contains MSH header" "PASS"
    else
      check "CV01-01" "Source RAW contains MSH header" "FAIL"
    fi

    # Source PROCESSED_RAW
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_PROCESSED_RAW")
    if compare_contains "$CONTENT" "CV_SENDER"; then
      check "CV01-02" "Source PROCESSED_RAW present" "PASS"
    else
      check "CV01-02" "Source PROCESSED_RAW present" "FAIL"
    fi

    # Source TRANSFORMED
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_TRANSFORMED")
    if compare_present "$CONTENT"; then
      check "CV01-03" "Source TRANSFORMED present" "PASS"
    else
      check "CV01-03" "Source TRANSFORMED present" "FAIL"
    fi

    # Source ENCODED
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_ENCODED")
    if compare_present "$CONTENT"; then
      check "CV01-04" "Source ENCODED present" "PASS"
    else
      check "CV01-04" "Source ENCODED present" "FAIL"
    fi

    # Source CHANNEL_MAP ($c() variables stored in CT=10)
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_CHANNEL_MAP")
    if compare_contains "$CONTENT" "preprocessorRan" && \
       compare_contains "$CONTENT" "patientId" && \
       compare_contains "$CONTENT" "patientName" && \
       compare_contains "$CONTENT" "patientGender"; then
      check "CV01-05" "Source CHANNEL_MAP has expected keys" "PASS"
    else
      check "CV01-05" "Source CHANNEL_MAP has expected keys" "FAIL"
    fi

    # Source status = T (TRANSFORMED)
    STATUS=$(get_status "$LID" "$MSG1" 0)
    if [[ "$STATUS" == "T" ]]; then
      check "CV01-06" "Source status = T (TRANSFORMED)" "PASS"
    else
      check "CV01-06" "Source status = T (TRANSFORMED)" "FAIL"
    fi

    # Dest 1 ENCODED
    CONTENT=$(get_content "$LID" "$MSG1" 1 "$CT_ENCODED")
    if compare_present "$CONTENT"; then
      check "CV01-07" "Dest 1 ENCODED present" "PASS"
    else
      check "CV01-07" "Dest 1 ENCODED present" "FAIL"
    fi

    # Dest 1 SENT
    CONTENT=$(get_content "$LID" "$MSG1" 1 "$CT_SENT")
    if compare_present "$CONTENT"; then
      check "CV01-08" "Dest 1 SENT present" "PASS"
    else
      check "CV01-08" "Dest 1 SENT present" "FAIL"
    fi

    # Dest 1 status = S
    STATUS=$(get_status "$LID" "$MSG1" 1)
    if [[ "$STATUS" == "S" ]]; then
      check "CV01-09" "Dest 1 status = S (SENT)" "PASS"
    else
      check "CV01-09" "Dest 1 status = S (SENT)" "FAIL"
    fi

    # Second message: non-ADT (filtered)
    MSG2=$(get_second_msg_id "$LID")
    if [[ -z "$MSG2" || "$MSG2" == "NULL" ]]; then
      echo "  SKIP: Second message not found for CV01"
      SKIP=$((SKIP + 3))
    else
      # Source status = F
      STATUS=$(get_status "$LID" "$MSG2" 0)
      if [[ "$STATUS" == "F" ]]; then
        check "CV01-10" "Filtered msg source status = F" "PASS"
      else
        check "CV01-10" "Filtered msg source status = F" "FAIL"
      fi

      # No TRANSFORMED for filtered
      CONTENT=$(get_content "$LID" "$MSG2" 0 "$CT_TRANSFORMED")
      if compare_absent "$CONTENT"; then
        check "CV01-11" "Filtered msg: no TRANSFORMED content" "PASS"
      else
        check "CV01-11" "Filtered msg: no TRANSFORMED content" "FAIL"
      fi

      # No ENCODED for filtered
      CONTENT=$(get_content "$LID" "$MSG2" 0 "$CT_ENCODED")
      if compare_absent "$CONTENT"; then
        check "CV01-12" "Filtered msg: no ENCODED content" "PASS"
      else
        check "CV01-12" "Filtered msg: no ENCODED content" "FAIL"
      fi
    fi
  fi
fi

echo ""

# ============================================================================
# Phase 3: CV02 - JSON Response Transformer
# ============================================================================
echo "-- Phase 3: CV02 - JSON Response Transformer --"

LID=$(cv_local 2)
if [[ -z "$LID" ]]; then
  echo "  SKIP: CV02 not deployed"
  SKIP=$((SKIP + 5))
else
  MSG1=$(get_first_msg_id "$LID")
  if [[ -z "$MSG1" || "$MSG1" == "NULL" ]]; then
    echo "  SKIP: No messages found for CV02"
    SKIP=$((SKIP + 5))
  else
    # Source TRANSFORMED contains XML patient with CV_PAT_002
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_TRANSFORMED")
    if compare_contains "$CONTENT" "CV_PAT_002"; then
      check "CV02-01" "Source TRANSFORMED contains CV_PAT_002" "PASS"
    else
      check "CV02-01" "Source TRANSFORMED contains CV_PAT_002" "FAIL"
    fi

    # Source CHANNEL_MAP contains parsedId ($c() in CT=10)
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_CHANNEL_MAP")
    if compare_contains "$CONTENT" "parsedId"; then
      check "CV02-02" "Source CHANNEL_MAP contains parsedId" "PASS"
    else
      check "CV02-02" "Source CHANNEL_MAP contains parsedId" "FAIL"
    fi

    # Dest 1 RESPONSE present
    CONTENT=$(get_content "$LID" "$MSG1" 1 "$CT_RESPONSE")
    if compare_present "$CONTENT"; then
      check "CV02-03" "Dest 1 RESPONSE present" "PASS"
    else
      check "CV02-03" "Dest 1 RESPONSE present" "FAIL"
    fi

    # Dest 1 RESPONSE_TRANSFORMED present
    CONTENT=$(get_content "$LID" "$MSG1" 1 "$CT_RESPONSE_TRANSFORMED")
    if compare_present "$CONTENT"; then
      check "CV02-04" "Dest 1 RESPONSE_TRANSFORMED present" "PASS"
    else
      check "CV02-04" "Dest 1 RESPONSE_TRANSFORMED present" "FAIL"
    fi

    # Source or dest CHANNEL_MAP contains responseReceived ($c() in CT=10)
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_CHANNEL_MAP")
    CONTENT_D1=$(get_content "$LID" "$MSG1" 1 "$CT_CHANNEL_MAP")
    if compare_contains "$CONTENT" "responseReceived" || compare_contains "$CONTENT_D1" "responseReceived"; then
      check "CV02-05" "CHANNEL_MAP contains responseReceived" "PASS"
    else
      check "CV02-05" "CHANNEL_MAP contains responseReceived" "FAIL"
    fi
  fi
fi

echo ""

# ============================================================================
# Phase 4: CV03 - Multi-Destination with DestinationSet
# ============================================================================
echo "-- Phase 4: CV03 - Multi-Destination with DestinationSet --"

LID=$(cv_local 3)
if [[ -z "$LID" ]]; then
  echo "  SKIP: CV03 not deployed"
  SKIP=$((SKIP + 6))
else
  MSG1=$(get_first_msg_id "$LID")
  if [[ -z "$MSG1" || "$MSG1" == "NULL" ]]; then
    echo "  SKIP: No messages found for CV03"
    SKIP=$((SKIP + 6))
  else
    # Dest 1 (metaDataId=1) status = S
    STATUS=$(get_status "$LID" "$MSG1" 1)
    if [[ "$STATUS" == "S" ]]; then
      check "CV03-01" "Dest 1 status = S (SENT)" "PASS"
    else
      check "CV03-01" "Dest 1 status = S (SENT)" "FAIL"
    fi

    # Dest 2 (metaDataId=2) status = F (removed by destinationSet)
    STATUS=$(get_status "$LID" "$MSG1" 2)
    if [[ "$STATUS" == "F" ]]; then
      check "CV03-02" "Dest 2 status = F (filtered by destinationSet)" "PASS"
    else
      check "CV03-02" "Dest 2 status = F (filtered by destinationSet)" "FAIL"
    fi

    # Dest 3 (metaDataId=3) status = S
    STATUS=$(get_status "$LID" "$MSG1" 3)
    if [[ "$STATUS" == "S" ]]; then
      check "CV03-03" "Dest 3 status = S (SENT)" "PASS"
    else
      check "CV03-03" "Dest 3 status = S (SENT)" "FAIL"
    fi

    # Dest 2 has NO SENT content
    CONTENT=$(get_content "$LID" "$MSG1" 2 "$CT_SENT")
    if compare_absent "$CONTENT"; then
      check "CV03-04" "Dest 2 has NO SENT content" "PASS"
    else
      check "CV03-04" "Dest 2 has NO SENT content" "FAIL"
    fi

    # Dest 1 ENCODED present
    CONTENT=$(get_content "$LID" "$MSG1" 1 "$CT_ENCODED")
    if compare_present "$CONTENT"; then
      check "CV03-05" "Dest 1 ENCODED present" "PASS"
    else
      check "CV03-05" "Dest 1 ENCODED present" "FAIL"
    fi

    # Dest 3 ENCODED present
    CONTENT=$(get_content "$LID" "$MSG1" 3 "$CT_ENCODED")
    if compare_present "$CONTENT"; then
      check "CV03-06" "Dest 3 ENCODED present" "PASS"
    else
      check "CV03-06" "Dest 3 ENCODED present" "FAIL"
    fi
  fi
fi

echo ""

# ============================================================================
# Phase 5: CV04 - Postprocessor
# ============================================================================
echo "-- Phase 5: CV04 - Postprocessor --"

LID=$(cv_local 4)
if [[ -z "$LID" ]]; then
  echo "  SKIP: CV04 not deployed"
  SKIP=$((SKIP + 3))
else
  MSG1=$(get_first_msg_id "$LID")
  if [[ -z "$MSG1" || "$MSG1" == "NULL" ]]; then
    echo "  SKIP: No messages found for CV04"
    SKIP=$((SKIP + 3))
  else
    # Source PROCESSED_RESPONSE contains postprocessor_ok
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_PROCESSED_RESPONSE")
    if compare_contains "$CONTENT" "postprocessor_ok"; then
      check "CV04-01" "Source PROCESSED_RESPONSE has postprocessor_ok" "PASS"
    else
      check "CV04-01" "Source PROCESSED_RESPONSE has postprocessor_ok" "FAIL"
    fi

    # Source CHANNEL_MAP contains d1StatusMessage ($c() in CT=10)
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_CHANNEL_MAP")
    if compare_contains "$CONTENT" "d1StatusMessage"; then
      check "CV04-02" "Source CHANNEL_MAP contains d1StatusMessage" "PASS"
    else
      check "CV04-02" "Source CHANNEL_MAP contains d1StatusMessage" "FAIL"
    fi

    # Dest 1 status = S
    STATUS=$(get_status "$LID" "$MSG1" 1)
    if [[ "$STATUS" == "S" ]]; then
      check "CV04-03" "Dest 1 status = S (SENT)" "PASS"
    else
      check "CV04-03" "Dest 1 status = S (SENT)" "FAIL"
    fi
  fi
fi

echo ""

# ============================================================================
# Phase 6: CV05 - Source Filter Rejection
# ============================================================================
echo "-- Phase 6: CV05 - Source Filter Rejection --"

LID=$(cv_local 5)
if [[ -z "$LID" ]]; then
  echo "  SKIP: CV05 not deployed"
  SKIP=$((SKIP + 5))
else
  MSG1=$(get_first_msg_id "$LID")
  if [[ -z "$MSG1" || "$MSG1" == "NULL" ]]; then
    echo "  SKIP: No messages found for CV05"
    SKIP=$((SKIP + 5))
  else
    # Source status = F
    STATUS=$(get_status "$LID" "$MSG1" 0)
    if [[ "$STATUS" == "F" ]]; then
      check "CV05-01" "Source status = F (FILTERED)" "PASS"
    else
      check "CV05-01" "Source status = F (FILTERED)" "FAIL"
    fi

    # Source RAW present
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_RAW")
    if compare_present "$CONTENT"; then
      check "CV05-02" "Source RAW present" "PASS"
    else
      check "CV05-02" "Source RAW present" "FAIL"
    fi

    # Source TRANSFORMED absent
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_TRANSFORMED")
    if compare_absent "$CONTENT"; then
      check "CV05-03" "Source TRANSFORMED absent" "PASS"
    else
      check "CV05-03" "Source TRANSFORMED absent" "FAIL"
    fi

    # Source ENCODED absent
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_ENCODED")
    if compare_absent "$CONTENT"; then
      check "CV05-04" "Source ENCODED absent" "PASS"
    else
      check "CV05-04" "Source ENCODED absent" "FAIL"
    fi

    # No destination row in D_MM (metaDataId=1 should not exist)
    if has_dest_row "$LID" "$MSG1" 1; then
      check "CV05-05" "No destination row for filtered source" "FAIL"
    else
      check "CV05-05" "No destination row for filtered source" "PASS"
    fi
  fi
fi

echo ""

# ============================================================================
# Phase 7: CV06 - E4X Deep Transformation
# ============================================================================
echo "-- Phase 7: CV06 - E4X Deep Transformation --"

LID=$(cv_local 6)
if [[ -z "$LID" ]]; then
  echo "  SKIP: CV06 not deployed"
  SKIP=$((SKIP + 6))
else
  MSG1=$(get_first_msg_id "$LID")
  if [[ -z "$MSG1" || "$MSG1" == "NULL" ]]; then
    echo "  SKIP: No messages found for CV06"
    SKIP=$((SKIP + 6))
  else
    # Source TRANSFORMED does NOT contain NTE (deleted by transformer)
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_TRANSFORMED")
    if compare_not_contains "$CONTENT" "NTE"; then
      check "CV06-01" "TRANSFORMED does not contain NTE (deleted)" "PASS"
    else
      check "CV06-01" "TRANSFORMED does not contain NTE (deleted)" "FAIL"
    fi

    # Source TRANSFORMED contains ZCV (custom segment added)
    if compare_contains "$CONTENT" "ZCV"; then
      check "CV06-02" "TRANSFORMED contains ZCV (custom segment)" "PASS"
    else
      check "CV06-02" "TRANSFORMED contains ZCV (custom segment)" "FAIL"
    fi

    # Source TRANSFORMED contains CV06_VALIDATION
    if compare_contains "$CONTENT" "CV06_VALIDATION"; then
      check "CV06-03" "TRANSFORMED contains CV06_VALIDATION" "PASS"
    else
      check "CV06-03" "TRANSFORMED contains CV06_VALIDATION" "FAIL"
    fi

    # Source CHANNEL_MAP contains obxCount ($c() in CT=10)
    CONTENT=$(get_content "$LID" "$MSG1" 0 "$CT_CHANNEL_MAP")
    if compare_contains "$CONTENT" "obxCount"; then
      check "CV06-04" "Source CHANNEL_MAP contains obxCount" "PASS"
    else
      check "CV06-04" "Source CHANNEL_MAP contains obxCount" "FAIL"
    fi

    # Source CHANNEL_MAP contains obxValues with expected data
    if compare_contains "$CONTENT" "obxValues"; then
      check "CV06-05" "Source CHANNEL_MAP contains obxValues" "PASS"
    else
      check "CV06-05" "Source CHANNEL_MAP contains obxValues" "FAIL"
    fi

    # Dest 1 status = S
    STATUS=$(get_status "$LID" "$MSG1" 1)
    if [[ "$STATUS" == "S" ]]; then
      check "CV06-06" "Dest 1 status = S (SENT)" "PASS"
    else
      check "CV06-06" "Dest 1 status = S (SENT)" "FAIL"
    fi
  fi
fi

echo ""

# ============================================================================
# Summary
# ============================================================================
TOTAL=$((PASS + FAIL + SKIP + GAP))
echo "============================================================"
echo "  Content Validation Summary"
echo "============================================================"
echo "  Passed:  $PASS/$TOTAL"
echo "  Failed:  $FAIL/$TOTAL"
echo "  Gaps:    $GAP/$TOTAL"
echo "  Skipped: $SKIP/$TOTAL"
echo "============================================================"

if [[ $GAP -gt 0 ]]; then
  echo ""
  echo "  Discovered Pipeline Gaps:"
  for gap_desc in "${GAPS[@]}"; do
    echo "    - $gap_desc"
  done
fi

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL ($FAIL check(s) failed)"
  exit 1
elif [[ $GAP -gt 0 ]]; then
  echo ""
  echo "RESULT: PASS with $GAP pipeline gap(s) discovered"
  exit 0
elif [[ $SKIP -gt 0 ]]; then
  echo ""
  echo "RESULT: PARTIAL ($SKIP check(s) skipped)"
  exit 0
else
  echo ""
  echo "RESULT: PASS (all $PASS checks passed)"
  exit 0
fi
