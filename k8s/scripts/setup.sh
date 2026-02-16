#!/usr/bin/env bash
# Build Node.js Mirth image and deploy base infrastructure to Rancher Desktop k3s.
# Usage: setup.sh [--no-cache]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
K8S_DIR="$SCRIPT_DIR/.."

echo "=== Mirth K8s Platform Setup ==="

# Verify kubectl is available and cluster is reachable
if ! kubectl cluster-info &>/dev/null; then
  echo "ERROR: Cannot reach Kubernetes cluster. Is Rancher Desktop running?" >&2
  exit 1
fi

# Step 1: Build Node.js Mirth image
echo ""
echo "[1/4] Building Node.js Mirth image..."
CACHE_ARG=""
if [[ "${1:-}" == "--no-cache" ]]; then
  CACHE_ARG="--no-cache"
fi
"$SCRIPT_DIR/build-image.sh" $CACHE_ARG

# Step 2: Deploy base infrastructure
echo ""
echo "[2/4] Deploying base infrastructure..."
kubectl apply -k "$K8S_DIR/base/"

# Step 3: Wait for MySQL
echo ""
echo "[3/4] Waiting for MySQL..."
"$SCRIPT_DIR/wait-for-ready.sh" mirth-infra app=mysql 120

# Step 4: Wait for Java Mirth
echo ""
echo "[4/4] Waiting for Java Mirth..."
"$SCRIPT_DIR/wait-for-ready.sh" mirth-infra app=java-mirth 180

echo ""
echo "=== Setup Complete ==="
echo ""
kubectl get pods -n mirth-infra
echo ""
echo "Next steps:"
echo "  kubectl apply -k k8s/overlays/standalone/   # Deploy standalone Node.js Mirth"
echo "  kubectl apply -k k8s/overlays/takeover/     # Deploy takeover mode"
echo "  ./k8s/scripts/port-forward.sh               # Expose infra services locally"
