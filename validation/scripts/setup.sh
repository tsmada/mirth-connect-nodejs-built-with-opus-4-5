#!/bin/bash

# Mirth Connect Validation Suite - Setup Script
# This script initializes the test environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VALIDATION_DIR="$PROJECT_ROOT/validation"

echo "======================================"
echo "Mirth Connect Validation Setup"
echo "======================================"

# Check prerequisites
echo ""
echo "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is not installed"
    exit 1
fi

echo "Prerequisites OK"

# Install validation dependencies
echo ""
echo "Installing validation dependencies..."
cd "$VALIDATION_DIR"
npm install

# Start Docker services
echo ""
echo "Starting Docker services..."
cd "$PROJECT_ROOT"
npm run docker:up

# Wait for MySQL to be ready
echo ""
echo "Waiting for MySQL to be ready..."
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if docker exec -i $(docker ps -qf "name=mirth-db") mysqladmin ping -h localhost -u mirth -pmirth &> /dev/null; then
        echo "MySQL is ready"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "Waiting for MySQL... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "ERROR: MySQL did not become ready in time"
    exit 1
fi

# Wait for Java Mirth to be ready
echo ""
echo "Waiting for Java Mirth to be ready..."
MAX_ATTEMPTS=60
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/server/status 2>/dev/null | grep -q "200"; then
        echo "Java Mirth is ready"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "Waiting for Java Mirth... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
    sleep 5
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "WARNING: Java Mirth did not become ready in time"
    echo "You may need to wait longer or check the logs with: npm run docker:logs"
fi

# Build Node.js project
echo ""
echo "Building Node.js Mirth..."
cd "$PROJECT_ROOT"
npm install
npm run build

echo ""
echo "======================================"
echo "Setup Complete"
echo "======================================"
echo ""
echo "To run validation:"
echo "  1. In one terminal: PORT=8081 npm run dev"
echo "  2. In another terminal: cd validation && npm run validate"
echo ""
