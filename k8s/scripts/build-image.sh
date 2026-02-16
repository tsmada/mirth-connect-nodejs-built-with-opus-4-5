#!/usr/bin/env bash
# Build Mirth Connect container images.
# Uses nerdctl (Rancher Desktop) with docker fallback.
# Usage: build-image.sh [--no-cache] [--node-only] [--java-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CACHE_FLAG=""
BUILD_NODE=true
BUILD_JAVA=true

for arg in "$@"; do
  case "$arg" in
    --no-cache)   CACHE_FLAG="--no-cache" ;;
    --node-only)  BUILD_JAVA=false ;;
    --java-only)  BUILD_NODE=false ;;
  esac
done

# Detect container runtime (nerdctl for Rancher Desktop, docker fallback)
# Use k8s.io namespace so images are visible to k3s pods (imagePullPolicy: Never)
if command -v nerdctl &>/dev/null; then
  BUILD_CMD="nerdctl --namespace k8s.io build"
elif command -v docker &>/dev/null; then
  BUILD_CMD="docker build"
else
  echo "ERROR: Neither nerdctl nor docker found" >&2
  exit 1
fi

if [ "$BUILD_NODE" = true ]; then
  echo "Building node-mirth:latest..."
  $BUILD_CMD $CACHE_FLAG -t node-mirth:latest -f "$SCRIPT_DIR/../Dockerfile" "$PROJECT_ROOT"
  echo "Image built: node-mirth:latest"
fi

if [ "$BUILD_JAVA" = true ]; then
  echo ""
  echo "Building java-mirth:latest (ARM64-native)..."
  $BUILD_CMD $CACHE_FLAG -t java-mirth:latest -f "$SCRIPT_DIR/../Dockerfile.java-mirth" "$PROJECT_ROOT"
  echo "Image built: java-mirth:latest"
fi
