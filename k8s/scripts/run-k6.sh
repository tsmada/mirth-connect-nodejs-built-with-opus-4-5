#!/usr/bin/env bash
# Launch a k6 load test Job by name and tail its logs until completion.
#
# Usage: run-k6.sh <test-name>
#   test-name: "api-load", "mllp-load", or "pdf-attachment-load"
#
# Examples:
#   run-k6.sh api-load              # Run API load test
#   run-k6.sh mllp-load             # Run MLLP load test
#   run-k6.sh pdf-attachment-load   # Run PDF attachment stress test (~10MB payloads)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/.."

TEST_NAME="${1:?Usage: run-k6.sh <test-name> (api-load, mllp-load, or pdf-attachment-load)}"
NAMESPACE="mirth-k6"
JOB_NAME="k6-${TEST_NAME}"

# Validate test name
case "$TEST_NAME" in
  api-load|mllp-load|pdf-attachment-load)
    ;;
  *)
    echo "ERROR: Unknown test name '$TEST_NAME'." >&2
    echo "  Valid options: api-load, mllp-load, pdf-attachment-load" >&2
    exit 1
    ;;
esac

echo "=== Running k6 Test: $TEST_NAME ==="

# Ensure namespace exists
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
  echo "Creating namespace: $NAMESPACE"
  kubectl create namespace "$NAMESPACE"
fi

# Delete previous Job run if it exists (Jobs are immutable)
if kubectl get job "$JOB_NAME" -n "$NAMESPACE" &>/dev/null; then
  echo "Deleting previous Job: $JOB_NAME"
  kubectl delete job "$JOB_NAME" -n "$NAMESPACE" --timeout=30s
  # Wait for pod cleanup
  sleep 3
fi

# Ensure k6 namespace and ConfigMap are applied
echo "Applying k6 namespace and scripts ConfigMap..."
kubectl apply -f "$K8S_DIR/k6/namespace.yaml"

# Apply the appropriate ConfigMap based on test type
if [[ "$TEST_NAME" == "pdf-attachment-load" ]]; then
  kubectl apply -f "$K8S_DIR/k6/configmap-pdf.yaml"
else
  kubectl apply -f "$K8S_DIR/k6/configmap.yaml"
fi

# Apply the k6 Job manifest
JOB_MANIFEST="$K8S_DIR/k6/job-${TEST_NAME}.yaml"
if [[ ! -f "$JOB_MANIFEST" ]]; then
  echo "ERROR: Job manifest not found at $JOB_MANIFEST" >&2
  echo "Available manifests in k8s/k6/:" >&2
  ls "$K8S_DIR/k6/job-"*.yaml 2>/dev/null || echo "  (none found)"
  exit 1
fi

echo "Applying Job manifest: $JOB_MANIFEST"
kubectl apply -f "$JOB_MANIFEST"

# PDF test needs more time to generate the 10MB blob during k6 init
if [[ "$TEST_NAME" == "pdf-attachment-load" ]]; then
  TIMEOUT=120
  echo "Waiting for k6 pod to start (extended timeout for PDF blob generation)..."
else
  TIMEOUT=60
  echo "Waiting for k6 pod to start..."
fi

ELAPSED=0
POD_NAME=""
while [[ $ELAPSED -lt $TIMEOUT ]]; do
  POD_NAME=$(kubectl get pods -n "$NAMESPACE" -l "job-name=$JOB_NAME" \
    --no-headers -o custom-columns=":metadata.name" 2>/dev/null | head -1)

  if [[ -n "$POD_NAME" ]]; then
    POD_PHASE=$(kubectl get pod "$POD_NAME" -n "$NAMESPACE" \
      -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
    if [[ "$POD_PHASE" != "Pending" ]]; then
      break
    fi
  fi

  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [[ -z "$POD_NAME" ]]; then
  echo "ERROR: k6 pod did not appear within ${TIMEOUT}s" >&2
  kubectl get pods -n "$NAMESPACE" 2>/dev/null
  exit 1
fi

echo "Pod: $POD_NAME (phase: $POD_PHASE)"
echo ""

# For PDF test, show HPA status if available
if [[ "$TEST_NAME" == "pdf-attachment-load" ]]; then
  echo "--- HPA Status (pre-test) ---"
  kubectl get hpa -n mirth-cluster 2>/dev/null || echo "  (no HPA configured)"
  echo ""
fi

echo "--- k6 output ---"

# Tail logs until the pod completes
kubectl logs -n "$NAMESPACE" "$POD_NAME" --follow 2>/dev/null || true

# Wait for Job completion and report status
echo ""
echo "--- Test complete ---"

# For PDF test, show HPA status after test
if [[ "$TEST_NAME" == "pdf-attachment-load" ]]; then
  echo ""
  echo "--- HPA Status (post-test) ---"
  kubectl get hpa -n mirth-cluster 2>/dev/null || echo "  (no HPA configured)"
  echo ""
  echo "--- Mirth Pod Status ---"
  kubectl get pods -n mirth-cluster -l app=node-mirth -o wide 2>/dev/null || true
  echo ""
fi

# Check Job status
JOB_STATUS=$(kubectl get job "$JOB_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)
JOB_FAILED=$(kubectl get job "$JOB_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null)

if [[ "$JOB_STATUS" == "True" ]]; then
  echo "RESULT: $TEST_NAME PASSED"
  exit 0
elif [[ "$JOB_FAILED" == "True" ]]; then
  echo "RESULT: $TEST_NAME FAILED"
  exit 1
else
  # Job may still be running or in unknown state
  echo "RESULT: $TEST_NAME status unknown. Checking..."
  kubectl get job "$JOB_NAME" -n "$NAMESPACE"
  exit 1
fi
