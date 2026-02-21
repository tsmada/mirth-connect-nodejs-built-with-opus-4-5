#!/usr/bin/env bash
# Send deterministic test messages to Content Validation channels.
#
# Usage: send-test-messages.sh [mirth-host]
#   mirth-host: Hostname/IP where Mirth channel listeners are available
#               (default: localhost). Do NOT include protocol prefix.
#
# Examples:
#   send-test-messages.sh                                           # localhost
#   send-test-messages.sh node-mirth.mirth-standalone.svc.cluster.local  # In-cluster
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MSG_DIR="$SCRIPT_DIR/../messages"

MIRTH_HOST="${1:-localhost}"
# Remove protocol prefix if present
MIRTH_HOST="${MIRTH_HOST#http://}"
MIRTH_HOST="${MIRTH_HOST#https://}"

# Detect HTTP client
if command -v curl &>/dev/null; then
  HTTP_CMD="curl"
elif command -v wget &>/dev/null; then
  HTTP_CMD="wget"
else
  echo "ERROR: Neither curl nor wget found" >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

send_message() {
  local port="$1" path="$2" file="$3" content_type="${4:-text/plain}" label="$5"
  local url="http://${MIRTH_HOST}:${port}${path}"

  if [[ ! -f "$file" ]]; then
    echo "  [SKIP] $label -- message file not found: $file"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  if [[ "$HTTP_CMD" == "curl" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" \
      -H "Content-Type: $content_type" --data-binary @"$file" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
      echo "  [OK]   $label -> $url (HTTP $HTTP_CODE)"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      echo "  [FAIL] $label -> $url (HTTP $HTTP_CODE)"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    if wget -q -O /dev/null --post-file="$file" --header="Content-Type: $content_type" "$url" 2>/dev/null; then
      echo "  [OK]   $label -> $url"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      echo "  [FAIL] $label -> $url"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  fi
}

echo "=== Sending CV Test Messages (host: $MIRTH_HOST) ==="
echo ""

# CV01: HL7 ADT (should be accepted by filter)
echo "-- CV01: HL7 Filter + Transformer --"
send_message 8120 "/cv01" "$MSG_DIR/cv01-adt-a01.hl7" "text/plain" "CV01 ADT A01 (accepted)"

# CV01: HL7 ORU (should be filtered/rejected)
send_message 8120 "/cv01" "$MSG_DIR/cv01-non-adt.hl7" "text/plain" "CV01 Non-ADT (filtered)"

echo ""

# CV02: JSON patient
echo "-- CV02: JSON Response Transformer --"
send_message 8121 "/cv02" "$MSG_DIR/cv02-patient.json" "application/json" "CV02 Patient JSON"

echo ""

# CV03: Multi-destination with SKIP_D2 flag
echo "-- CV03: Multi-Destination with DestinationSet --"
send_message 8122 "/cv03" "$MSG_DIR/cv03-multi-dest.json" "application/json" "CV03 Multi-Dest (skip D2)"

echo ""

# CV04: Postprocessor
echo "-- CV04: Postprocessor --"
send_message 8123 "/cv04" "$MSG_DIR/cv04-postprocessor.json" "application/json" "CV04 Postprocessor"

echo ""

# CV05: Filter rejection
echo "-- CV05: Source Filter Rejection --"
send_message 8124 "/cv05" "$MSG_DIR/cv05-reject.json" "application/json" "CV05 Reject"

echo ""

# CV06: HL7 ORU with OBX segments
echo "-- CV06: E4X Deep Transformation --"
send_message 8125 "/cv06" "$MSG_DIR/cv06-lab-oru.hl7" "text/plain" "CV06 Lab ORU"

echo ""
echo "=== Waiting 5s for pipeline completion ==="
sleep 5

echo ""
echo "=== Send Summary ==="
echo "  Sent OK:   $PASS_COUNT"
echo "  Failed:    $FAIL_COUNT"
echo "  Total:     $((PASS_COUNT + FAIL_COUNT))"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo ""
  echo "WARNING: $FAIL_COUNT message(s) failed to send."
  exit 1
fi

echo "Done."
