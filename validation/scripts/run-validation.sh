#!/bin/bash

# Mirth Connect Validation Suite - Run Script
# This script executes validation scenarios

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$VALIDATION_DIR/.." && pwd)"

echo "======================================"
echo "Mirth Connect Validation Suite"
echo "======================================"

# Parse arguments
PRIORITY=""
VERBOSE=""
SCENARIO=""
STOP_ON_FAILURE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --priority)
            PRIORITY="--priority $2"
            shift 2
            ;;
        --scenario)
            SCENARIO="--scenario $2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE="--verbose"
            shift
            ;;
        --stop-on-failure)
            STOP_ON_FAILURE="--stop-on-failure"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--priority N] [--scenario ID] [--verbose] [--stop-on-failure]"
            exit 1
            ;;
    esac
done

# Check if services are running
echo ""
echo "Checking services..."

# Check Java Mirth
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/server/status 2>/dev/null | grep -q "200"; then
    echo "WARNING: Java Mirth does not appear to be running at localhost:8080"
    echo "Start it with: npm run docker:up"
fi

# Check Node.js Mirth
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/api/server/status 2>/dev/null | grep -q "200"; then
    echo "WARNING: Node.js Mirth does not appear to be running at localhost:8081"
    echo "Start it with: PORT=8081 npm run dev"
fi

# Run validation
echo ""
echo "Running validation..."
cd "$VALIDATION_DIR"

npx ts-node runners/ValidationRunner.ts $PRIORITY $SCENARIO $VERBOSE $STOP_ON_FAILURE

EXIT_CODE=$?

echo ""
echo "Validation complete. Exit code: $EXIT_CODE"

# Show report location
LATEST_REPORT=$(ls -t "$VALIDATION_DIR/reports/"validation-*.json 2>/dev/null | head -1)
if [ -n "$LATEST_REPORT" ]; then
    echo "Report saved to: $LATEST_REPORT"
fi

exit $EXIT_CODE
