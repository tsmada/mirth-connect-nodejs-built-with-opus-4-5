#!/usr/bin/env bash
# End-to-end PDF attachment stress test with HPA monitoring.
#
# This script:
#   1. Verifies metrics-server is running (required for HPA)
#   2. Applies/updates the cluster overlay (with HPA)
#   3. Waits for Mirth pods to be ready
#   4. Shows baseline HPA + pod status
#   5. Runs the k6 PDF attachment load test
#   6. Monitors HPA scaling events during the test
#   7. Reports final pod count and scaling history
#
# Usage:
#   ./k8s/scripts/run-pdf-stress-test.sh              # Full run
#   ./k8s/scripts/run-pdf-stress-test.sh --skip-deploy # Skip infra, just run k6
#   ./k8s/scripts/run-pdf-stress-test.sh --quick       # Quick smoke test (2.5 min)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/.."
PROJECT_DIR="$K8S_DIR/.."

SKIP_DEPLOY=false
QUICK_MODE=false

for arg in "$@"; do
  case "$arg" in
    --skip-deploy) SKIP_DEPLOY=true ;;
    --quick) QUICK_MODE=true ;;
  esac
done

# ── Colors ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_step()  { echo -e "${CYAN}[STEP]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "================================================================"
echo "  PDF ATTACHMENT STRESS TEST — 10MB Payloads + HPA Autoscaling"
echo "================================================================"
echo ""

# ── Step 1: Verify Cluster Prerequisites ─────────────────
log_step "Verifying cluster prerequisites..."

# Check kubectl connectivity
if ! kubectl cluster-info &>/dev/null; then
  log_error "Cannot connect to Kubernetes cluster. Is Rancher Desktop running?"
  exit 1
fi
log_ok "kubectl connected"

# Check metrics-server (required for HPA)
if kubectl get deployment metrics-server -n kube-system &>/dev/null; then
  log_ok "metrics-server is deployed"
else
  log_warn "metrics-server not found in kube-system."
  log_step "Checking for alternative metrics API..."
  if kubectl get apiservice v1beta1.metrics.k8s.io &>/dev/null; then
    log_ok "Metrics API is available (via alternative provider)"
  else
    log_warn "Metrics API not available. HPA will not function."
    log_step "Attempting to install metrics-server for k3s..."
    # k3s/Rancher Desktop often has metrics-server as an add-on
    kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml 2>/dev/null || true
    # For k3s with self-signed certs, patch to allow insecure TLS
    kubectl patch deployment metrics-server -n kube-system \
      --type='json' \
      -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]' 2>/dev/null || true
    echo "Waiting 30s for metrics-server to start..."
    sleep 30
    if kubectl top nodes &>/dev/null; then
      log_ok "metrics-server installed and working"
    else
      log_warn "metrics-server may still be starting. HPA may take a few minutes to activate."
    fi
  fi
fi

# ── Step 2: Deploy / Update Infrastructure ───────────────
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  log_step "Deploying base infrastructure..."
  kubectl apply -k "$K8S_DIR/base/" 2>/dev/null || {
    log_warn "Base infra already applied or partially failed (usually OK)"
  }

  log_step "Applying cluster overlay with HPA..."
  kubectl apply -k "$K8S_DIR/overlays/cluster/"
  log_ok "Cluster overlay applied"

  log_step "Waiting for MySQL to be ready..."
  kubectl wait -n mirth-infra --for=condition=ready pod -l app=mysql --timeout=120s 2>/dev/null || {
    log_warn "MySQL wait timed out (may already be running)"
  }

  log_step "Waiting for Mirth pods to be ready..."
  kubectl wait -n mirth-cluster --for=condition=ready pod -l app=node-mirth --timeout=180s 2>/dev/null || {
    log_error "Mirth pods did not become ready within 180s"
    kubectl get pods -n mirth-cluster -l app=node-mirth
    exit 1
  }
  log_ok "All Mirth pods ready"
else
  log_step "Skipping deploy (--skip-deploy)"
  # Still apply HPA in case it's new
  kubectl apply -f "$K8S_DIR/overlays/cluster/node-mirth-hpa.yaml" 2>/dev/null || true
fi

# ── Step 3: Show Baseline Status ─────────────────────────
echo ""
log_step "Baseline status:"
echo ""
echo "--- Pods ---"
kubectl get pods -n mirth-cluster -l app=node-mirth -o wide 2>/dev/null
echo ""
echo "--- HPA ---"
kubectl get hpa -n mirth-cluster 2>/dev/null || echo "  (no HPA)"
echo ""
echo "--- Resource Usage ---"
kubectl top pods -n mirth-cluster -l app=node-mirth 2>/dev/null || echo "  (metrics not yet available)"
echo ""

# ── Step 4: Start HPA Monitor (background) ──────────────
HPA_LOG=$(mktemp /tmp/hpa-monitor-XXXXXX.log)
log_step "Starting HPA monitor (logging to $HPA_LOG)..."

(
  while true; do
    TIMESTAMP=$(date '+%H:%M:%S')
    REPLICAS=$(kubectl get hpa node-mirth-hpa -n mirth-cluster -o jsonpath='{.status.currentReplicas}' 2>/dev/null || echo "?")
    DESIRED=$(kubectl get hpa node-mirth-hpa -n mirth-cluster -o jsonpath='{.status.desiredReplicas}' 2>/dev/null || echo "?")
    CPU=$(kubectl get hpa node-mirth-hpa -n mirth-cluster -o jsonpath='{.status.currentMetrics[?(@.resource.name=="cpu")].resource.current.averageUtilization}' 2>/dev/null || echo "?")
    MEM=$(kubectl get hpa node-mirth-hpa -n mirth-cluster -o jsonpath='{.status.currentMetrics[?(@.resource.name=="memory")].resource.current.averageUtilization}' 2>/dev/null || echo "?")
    echo "$TIMESTAMP | replicas=$REPLICAS desired=$DESIRED cpu=${CPU}% mem=${MEM}%" >> "$HPA_LOG"
    sleep 10
  done
) &
HPA_MONITOR_PID=$!

# Cleanup monitor on exit
trap "kill $HPA_MONITOR_PID 2>/dev/null; rm -f $HPA_LOG" EXIT

# ── Step 5: Run the k6 Test ──────────────────────────────
echo ""
log_step "Launching k6 PDF attachment load test..."

if [[ "$QUICK_MODE" == "true" ]]; then
  log_warn "Quick mode — overriding durations to ~2.5 minutes"
fi

# Apply ConfigMap and Job
kubectl apply -f "$K8S_DIR/k6/namespace.yaml"
kubectl apply -f "$K8S_DIR/k6/configmap-pdf.yaml"

# Delete previous run
JOB_NAME="k6-pdf-attachment-load"
NAMESPACE="mirth-k6"
kubectl delete job "$JOB_NAME" -n "$NAMESPACE" --timeout=30s 2>/dev/null || true
sleep 3

if [[ "$QUICK_MODE" == "true" ]]; then
  # Apply job with shorter durations via env var override
  cat "$K8S_DIR/k6/job-pdf-attachment-load.yaml" | \
    sed 's/name: RAMP_DURATION/name: RAMP_DURATION/' | \
    sed '/RAMP_DURATION/{n;s/value: "30s"/value: "10s"/;}' | \
    sed '/HOLD_DURATION/{n;s/value: "120s"/value: "30s"/;}' | \
    sed '/PEAK_DURATION/{n;s/value: "120s"/value: "30s"/;}' | \
    kubectl apply -f -
else
  kubectl apply -f "$K8S_DIR/k6/job-pdf-attachment-load.yaml"
fi

# Wait for k6 pod
log_step "Waiting for k6 pod to start (may take ~30s for 10MB blob generation)..."
TIMEOUT=120
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
  log_error "k6 pod did not appear within ${TIMEOUT}s"
  kubectl get pods -n "$NAMESPACE" 2>/dev/null
  exit 1
fi

log_ok "k6 pod started: $POD_NAME"
echo ""
echo "──────────────── k6 output ────────────────────────────"

# Stream k6 output
kubectl logs -n "$NAMESPACE" "$POD_NAME" --follow 2>/dev/null || true

echo "──────────────── end k6 output ────────────────────────"

# ── Step 6: Post-Test Analysis ───────────────────────────
echo ""
log_step "Post-test analysis..."

# Stop HPA monitor
kill $HPA_MONITOR_PID 2>/dev/null || true

echo ""
echo "--- Final Pod Status ---"
kubectl get pods -n mirth-cluster -l app=node-mirth -o wide 2>/dev/null
echo ""
echo "--- Final HPA Status ---"
kubectl get hpa -n mirth-cluster 2>/dev/null || echo "  (no HPA)"
echo ""
echo "--- Final Resource Usage ---"
kubectl top pods -n mirth-cluster -l app=node-mirth 2>/dev/null || echo "  (metrics unavailable)"
echo ""

# Show HPA scaling history
echo "--- HPA Scaling Timeline ---"
if [[ -f "$HPA_LOG" ]]; then
  cat "$HPA_LOG"
else
  echo "  (no HPA log)"
fi
echo ""

# Show HPA events
echo "--- HPA Events ---"
kubectl describe hpa node-mirth-hpa -n mirth-cluster 2>/dev/null | grep -A 20 "Events:" || echo "  (no events)"
echo ""

# Check Job result
JOB_STATUS=$(kubectl get job "$JOB_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)
JOB_FAILED=$(kubectl get job "$JOB_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null)

echo ""
echo "================================================================"
if [[ "$JOB_STATUS" == "True" ]]; then
  echo -e "  ${GREEN}RESULT: PDF ATTACHMENT STRESS TEST PASSED${NC}"
elif [[ "$JOB_FAILED" == "True" ]]; then
  echo -e "  ${RED}RESULT: PDF ATTACHMENT STRESS TEST FAILED${NC}"
else
  echo -e "  ${YELLOW}RESULT: STATUS UNKNOWN${NC}"
  kubectl get job "$JOB_NAME" -n "$NAMESPACE"
fi
echo "================================================================"
echo ""
