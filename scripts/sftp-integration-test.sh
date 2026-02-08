#!/bin/bash

# SFTP Integration Test
# Tests the full SFTP ORM→ORU lab transform pipeline
#
# Prerequisites:
#   npm run sftp:up          # Start SFTP server on port 2222
#   PORT=8081 npm run dev    # Start Node.js Mirth
#
# Usage:
#   npm run sftp:test                    # Run with Node.js Mirth only
#   npm run sftp:test -- --with-java     # Compare both engines
#   npm run sftp:test -- --upload-only   # Just upload test file, skip validation
#   npm run sftp:test -- --cleanup       # Remove test files from SFTP

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VALIDATION_DIR="$PROJECT_ROOT/validation"
SCENARIO_DIR="$VALIDATION_DIR/scenarios/07-deep-validation/7.8-sftp-orm-to-oru"

SFTP_HOST="localhost"
SFTP_PORT="2222"
NODE_API="http://localhost:8081"
JAVA_API="https://localhost:8443"

WITH_JAVA=false
UPLOAD_ONLY=false
CLEANUP=false
TIMEOUT=30

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --with-java)    WITH_JAVA=true; shift ;;
        --upload-only)  UPLOAD_ONLY=true; shift ;;
        --cleanup)      CLEANUP=true; shift ;;
        --timeout)      TIMEOUT="$2"; shift 2 ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--with-java] [--upload-only] [--cleanup] [--timeout N]"
            exit 1
            ;;
    esac
done

echo "======================================"
echo "SFTP ORM→ORU Integration Test"
echo "======================================"
echo ""

# --- Cleanup mode ---
if [ "$CLEANUP" = true ]; then
    echo "Cleaning up SFTP test files..."
    for USER in javauser nodeuser; do
        PASS="${USER/user/pass}"
        if command -v sshpass &> /dev/null; then
            sshpass -p "$PASS" sftp -o StrictHostKeyChecking=no -P "$SFTP_PORT" "${USER}@${SFTP_HOST}" <<EOF 2>/dev/null || true
rm /home/$USER/input/*.hl7
rm /home/$USER/output/*.hl7
bye
EOF
            echo "  Cleaned /home/$USER/{input,output}"
        else
            echo "  sshpass not installed — clean manually or use docker exec"
            CONTAINER_ID=$(docker compose -f "$VALIDATION_DIR/docker-compose.yml" ps -q sftp-server 2>/dev/null)
            if [ -n "$CONTAINER_ID" ]; then
                docker exec "$CONTAINER_ID" sh -c "rm -f /home/$USER/input/*.hl7 /home/$USER/output/*.hl7" 2>/dev/null || true
                echo "  Cleaned via docker exec"
            fi
        fi
    done
    echo "Done."
    exit 0
fi

# --- Prerequisite checks ---
echo "Checking prerequisites..."

# Check SFTP server
CONTAINER_ID=$(docker compose -f "$VALIDATION_DIR/docker-compose.yml" ps -q sftp-server 2>/dev/null)
if [ -z "$CONTAINER_ID" ]; then
    echo "ERROR: SFTP server is not running."
    echo "  Start it with: npm run sftp:up"
    exit 1
fi
echo "  SFTP server: running"

# Check Node.js Mirth
if curl -s -o /dev/null -w "%{http_code}" "$NODE_API/api/server/status" 2>/dev/null | grep -q "200"; then
    echo "  Node.js Mirth: running"
else
    echo "ERROR: Node.js Mirth is not running at $NODE_API"
    echo "  Start it with: PORT=8081 npm run dev"
    exit 1
fi

# Optionally check Java Mirth
if [ "$WITH_JAVA" = true ]; then
    if curl -sk -o /dev/null -w "%{http_code}" "$JAVA_API/api/server/status" 2>/dev/null | grep -q "200"; then
        echo "  Java Mirth:    running"
    else
        echo "WARNING: Java Mirth is not running at $JAVA_API (--with-java requested)"
        echo "  Start it with: npm run docker:up"
        WITH_JAVA=false
    fi
fi

echo ""

# --- Upload test message ---
echo "Step 1: Upload ORM test message to SFTP..."

INPUT_FILE="$SCENARIO_DIR/orm-lab-order.hl7"
if [ ! -f "$INPUT_FILE" ]; then
    echo "ERROR: Test message not found: $INPUT_FILE"
    exit 1
fi

TIMESTAMP=$(date +%s)
TEST_FILENAME="test-${TIMESTAMP}.hl7"

# Upload to nodeuser via docker exec (avoids sshpass dependency)
docker exec "$CONTAINER_ID" sh -c "mkdir -p /home/nodeuser/input /home/nodeuser/output"
docker cp "$INPUT_FILE" "$CONTAINER_ID:/home/nodeuser/input/${TEST_FILENAME}"
docker exec "$CONTAINER_ID" chown nodeuser:users "/home/nodeuser/input/${TEST_FILENAME}" 2>/dev/null || true
echo "  Uploaded: /home/nodeuser/input/${TEST_FILENAME}"

if [ "$WITH_JAVA" = true ]; then
    docker exec "$CONTAINER_ID" sh -c "mkdir -p /home/javauser/input /home/javauser/output"
    docker cp "$INPUT_FILE" "$CONTAINER_ID:/home/javauser/input/${TEST_FILENAME}"
    docker exec "$CONTAINER_ID" chown javauser:users "/home/javauser/input/${TEST_FILENAME}" 2>/dev/null || true
    echo "  Uploaded: /home/javauser/input/${TEST_FILENAME}"
fi

if [ "$UPLOAD_ONLY" = true ]; then
    echo ""
    echo "Upload complete (--upload-only mode)."
    echo "Check output with:"
    echo "  docker exec $CONTAINER_ID ls -la /home/nodeuser/output/"
    exit 0
fi

echo ""

# --- Wait for output ---
echo "Step 2: Waiting for ORU output (timeout: ${TIMEOUT}s)..."

ELAPSED=0
NODE_OUTPUT=""
while [ $ELAPSED -lt $TIMEOUT ]; do
    NODE_OUTPUT=$(docker exec "$CONTAINER_ID" sh -c "ls /home/nodeuser/output/result.hl7 2>/dev/null" || true)
    if [ -n "$NODE_OUTPUT" ]; then
        break
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    if [ $((ELAPSED % 5)) -eq 0 ]; then
        echo "  Waiting... (${ELAPSED}s)"
    fi
done

echo ""

if [ -z "$NODE_OUTPUT" ]; then
    echo "TIMEOUT: No output file found after ${TIMEOUT}s"
    echo ""
    echo "Debugging:"
    echo "  Input dir:  $(docker exec "$CONTAINER_ID" ls -la /home/nodeuser/input/ 2>/dev/null)"
    echo "  Output dir: $(docker exec "$CONTAINER_ID" ls -la /home/nodeuser/output/ 2>/dev/null)"
    echo ""
    echo "  Possible causes:"
    echo "  1. Channel not deployed — deploy the SFTP channel via API or mirth-cli"
    echo "  2. SFTP connector config mismatch — check channel XML placeholders"
    echo "  3. Transformer error — check Node.js Mirth logs"
    exit 1
fi

# --- Validate output ---
echo "Step 3: Validating ORU output..."
echo ""

# Extract output content
OUTPUT_CONTENT=$(docker exec "$CONTAINER_ID" cat /home/nodeuser/output/result.hl7 2>/dev/null)

# Check key ORU segments
PASSED=0
FAILED=0

check_segment() {
    local label="$1"
    local pattern="$2"
    if echo "$OUTPUT_CONTENT" | grep -q "$pattern"; then
        echo "  PASS: $label"
        PASSED=$((PASSED + 1))
    else
        echo "  FAIL: $label (expected: $pattern)"
        FAILED=$((FAILED + 1))
    fi
}

echo "--- ORU Message Validation ---"
check_segment "MSH message type is ORU^R01"  "ORU^R01^ORU_R01"
check_segment "MSH sender is LAB_SYS"        "LAB_SYS|LAB_A"
check_segment "MSH receiver is ORDER_SYS"    "ORDER_SYS|CLINIC_A"
check_segment "PID patient DOE^JANE"          "DOE^JANE"
check_segment "PV1 segment preserved"         "^PV1|"
check_segment "ORC order control is RE"       "|RE|"
check_segment "OBR result status F"           "|F"
check_segment "OBX Glucose result"            "2345-7^Glucose||95"
check_segment "OBX BUN result"                "3094-0^BUN||15"
check_segment "OBX Creatinine result"         "2160-0^Creatinine||1.0"
check_segment "OBX WBC result"                "6690-2^WBC||7.5"
check_segment "OBX RBC result"                "789-8^RBC||4.8"
check_segment "OBX Hemoglobin result"         "718-7^Hemoglobin||14.2"

echo ""
echo "--- Raw Output Preview ---"
echo "$OUTPUT_CONTENT" | head -20
echo ""

# --- Cleanup ---
echo "Step 4: Cleanup..."
docker exec "$CONTAINER_ID" sh -c "rm -f /home/nodeuser/input/${TEST_FILENAME} /home/nodeuser/output/result.hl7" 2>/dev/null || true
if [ "$WITH_JAVA" = true ]; then
    docker exec "$CONTAINER_ID" sh -c "rm -f /home/javauser/input/${TEST_FILENAME} /home/javauser/output/result.hl7" 2>/dev/null || true
fi
echo "  Cleaned up test files"

# --- Summary ---
echo ""
echo "======================================"
echo "Results: $PASSED passed, $FAILED failed (of $((PASSED + FAILED)) checks)"
echo "======================================"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
