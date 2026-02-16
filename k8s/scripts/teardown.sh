#!/usr/bin/env bash
# Delete all Mirth-related namespaces.
# Keeps the Rancher Desktop k3s cluster itself intact.
# Usage: teardown.sh [--force]
set -euo pipefail

FORCE="${1:-}"

NAMESPACES=("mirth-k6" "mirth-benchmark" "mirth-cluster" "mirth-shadow" "mirth-takeover" "mirth-standalone" "mirth-infra")

echo "=== Tearing Down Mirth K8s Platform ==="

if [[ "$FORCE" != "--force" ]]; then
  echo "This will delete the following namespaces (if they exist):"
  for ns in "${NAMESPACES[@]}"; do
    if kubectl get namespace "$ns" &>/dev/null; then
      echo "  - $ns (EXISTS)"
    else
      echo "  - $ns (not found, skip)"
    fi
  done
  echo ""
  read -r -p "Proceed? [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

for ns in "${NAMESPACES[@]}"; do
  if kubectl get namespace "$ns" &>/dev/null; then
    echo "Deleting namespace: $ns"
    kubectl delete namespace "$ns" --timeout=60s || echo "  WARNING: Timeout deleting $ns (resources may still be terminating)"
  else
    echo "Skipping namespace: $ns (not found)"
  fi
done

echo "=== Teardown Complete ==="
