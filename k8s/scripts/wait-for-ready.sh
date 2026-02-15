#!/usr/bin/env bash
# Wait for pods in a namespace to become ready.
# Usage: wait-for-ready.sh <namespace> [label] [timeout-seconds]
#
# Examples:
#   wait-for-ready.sh mirth-infra                      # All pods, 120s
#   wait-for-ready.sh mirth-infra app=mysql 60          # MySQL pod, 60s
#   wait-for-ready.sh mirth-standalone app=node-mirth   # Node Mirth, 120s
set -euo pipefail

NAMESPACE="${1:?Usage: wait-for-ready.sh <namespace> [label] [timeout]}"
LABEL="${2:-}"
TIMEOUT="${3:-120}"

echo "Waiting for pods in namespace '$NAMESPACE'${LABEL:+ with label '$LABEL'} (timeout: ${TIMEOUT}s)..."

LABEL_SELECTOR=""
if [[ -n "$LABEL" ]]; then
  LABEL_SELECTOR="-l $LABEL"
fi

# First verify the namespace exists
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
  echo "ERROR: Namespace '$NAMESPACE' does not exist" >&2
  exit 1
fi

# Wait for at least one pod to appear
ELAPSED=0
while [[ $ELAPSED -lt $TIMEOUT ]]; do
  POD_COUNT=$(kubectl get pods -n "$NAMESPACE" $LABEL_SELECTOR --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$POD_COUNT" -gt 0 ]]; then
    break
  fi
  echo "  No pods found yet... ($ELAPSED s)"
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [[ "$POD_COUNT" -eq 0 ]]; then
  echo "ERROR: No pods appeared within ${TIMEOUT}s" >&2
  exit 1
fi

# Wait for all matching pods to be ready
# shellcheck disable=SC2086
kubectl wait -n "$NAMESPACE" --for=condition=ready pod $LABEL_SELECTOR --timeout="${TIMEOUT}s"

echo "All pods ready in '$NAMESPACE'${LABEL:+ (label: $LABEL)}"
kubectl get pods -n "$NAMESPACE" $LABEL_SELECTOR
