#!/usr/bin/env bash
# Build the Node.js Mirth Connect container image.
# Uses nerdctl (Rancher Desktop) with docker fallback.
# Usage: build-image.sh [--no-cache]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CACHE_FLAG=""
if [[ "${1:-}" == "--no-cache" ]]; then
  CACHE_FLAG="--no-cache"
fi

echo "Building node-mirth:latest..."

# Try nerdctl first (Rancher Desktop native), fall back to docker
if command -v nerdctl &>/dev/null; then
  nerdctl build $CACHE_FLAG -t node-mirth:latest -f "$SCRIPT_DIR/../Dockerfile" "$PROJECT_ROOT"
elif command -v docker &>/dev/null; then
  docker build $CACHE_FLAG -t node-mirth:latest -f "$SCRIPT_DIR/../Dockerfile" "$PROJECT_ROOT"
else
  echo "ERROR: Neither nerdctl nor docker found" >&2
  exit 1
fi

echo "Image built: node-mirth:latest"
