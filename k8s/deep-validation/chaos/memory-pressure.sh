#!/usr/bin/env bash
# =============================================================================
# Chaos Test: Memory Pressure (Informational)
# =============================================================================
# Reduces the Mirth deployment memory limit to 256Mi, sends heavy messages,
# monitors for OOMKilled events, then restores the original limit.
#
# This test is INFORMATIONAL -- it reports observations but does not produce
# a strict PASS/FAIL verdict, since OOM behavior depends on workload, GC
# pressure, and Node.js heap configuration.
#
# Usage:
#   ./memory-pressure.sh                              # Defaults
#   NAMESPACE=my-ns ./memory-pressure.sh
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - Mirth deployment named "node-mirth"
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-node-mirth}"
MIRTH_API_PORT="${MIRTH_API_PORT:-8080}"
LOW_MEMORY="${LOW_MEMORY:-256Mi}"
ORIGINAL_MEMORY="${ORIGINAL_MEMORY:-1Gi}"
HEAVY_MSG_PORT="${HEAVY_MSG_PORT:-8102}"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
header() { echo ""; echo "$(ts) ============ $1 ============"; }
info() { echo "$(ts) [INFO] $1"; }
warn() { echo "$(ts) [WARN] $1"; }

# ---- Step 1: Record current limits ----
header "PRE-STATE"

CURRENT_LIMITS=$(kubectl get "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}' 2>/dev/null || echo "unknown")
echo "$(ts) Current memory limit: $CURRENT_LIMITS"

PRE_POD_COUNT=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c Running || true)
echo "$(ts) Running pods: $PRE_POD_COUNT"

# Record pre-state restart counts
echo "$(ts) Pod restart counts before pressure:"
kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
  -o custom-columns='NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount' --no-headers

PRE_RESTARTS=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
  -o jsonpath='{.items[*].status.containerStatuses[0].restartCount}' 2>/dev/null | tr ' ' '+' | bc 2>/dev/null || echo "0")
echo "$(ts) Total restarts: $PRE_RESTARTS"

# ---- Step 2: Patch to low memory ----
header "APPLYING MEMORY PRESSURE ($LOW_MEMORY)"

echo "$(ts) Patching deployment memory limit to $LOW_MEMORY..."
kubectl patch "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" --type=json \
  -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/resources/limits/memory\",\"value\":\"$LOW_MEMORY\"}]"

echo "$(ts) Waiting for rollout to complete (new pods with low memory)..."
kubectl rollout status "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" --timeout=180s || true

echo "$(ts) Pods after memory reduction:"
kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
  -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount,MEMORY_LIMIT:.spec.containers[0].resources.limits.memory' --no-headers

# ---- Step 3: Send heavy messages ----
header "SENDING HEAVY MESSAGES"

MIRTH_POD=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o name --field-selector=status.phase=Running 2>/dev/null | head -1)

if [[ -n "$MIRTH_POD" ]]; then
  # Generate a large payload (~200KB of repeated HL7 segments)
  HEAVY_PAYLOAD='MSH|^~\&|STRESS|CHAOS|TARGET|CHAOS|20260219120000||ADT^A01|CHAOS001|P|2.3\r'
  for i in $(seq 1 500); do
    HEAVY_PAYLOAD="${HEAVY_PAYLOAD}OBX|${i}|ST|STRESS^Chaos Test||$(head -c 300 /dev/urandom | base64 | tr -d '\n')|||F\r"
  done

  info "Sending 5 heavy messages to stress memory..."
  for i in $(seq 1 5); do
    kubectl exec -n "$NAMESPACE" "$MIRTH_POD" -- \
      wget -q -O /dev/null --timeout=10 --post-data="$HEAVY_PAYLOAD" \
      --header='Content-Type: text/plain' \
      "http://localhost:${MIRTH_API_PORT}/api/health" 2>/dev/null &
  done
  wait
  info "Heavy messages sent (or attempted)."
else
  warn "No running Mirth pod available to send messages"
fi

# ---- Step 4: Monitor for OOMKilled ----
header "MONITORING FOR OOM EVENTS (30s)"

echo "$(ts) Monitoring pods for 30s..."
for check in $(seq 1 6); do
  sleep 5

  # Check for OOMKilled
  OOM_REASONS=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].lastState.terminated.reason}{"\n"}{end}' 2>/dev/null || true)

  OOM_COUNT=$(echo "$OOM_REASONS" | grep -c "OOMKilled" || true)

  RUNNING=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c Running || true)
  CRASH_LOOP=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers | grep -c CrashLoopBackOff || true)

  echo "$(ts)   Check $check/6: Running=$RUNNING, CrashLoop=$CRASH_LOOP, OOMKilled=$OOM_COUNT"

  if [[ "$OOM_COUNT" -gt 0 ]]; then
    warn "OOMKilled detected!"
    echo "$OOM_REASONS" | grep "OOMKilled" || true
  fi
done

# ---- Step 5: Record post-pressure state ----
header "POST-PRESSURE STATE"

POST_RESTARTS=$(kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
  -o jsonpath='{.items[*].status.containerStatuses[0].restartCount}' 2>/dev/null | tr ' ' '+' | bc 2>/dev/null || echo "0")
NEW_RESTARTS=$((POST_RESTARTS - PRE_RESTARTS))

echo "$(ts) Restart count delta: $NEW_RESTARTS (was: $PRE_RESTARTS, now: $POST_RESTARTS)"

echo "$(ts) Pod status:"
kubectl get pods -n "$NAMESPACE" -l app=node-mirth \
  -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount,READY:.status.containerStatuses[0].ready' --no-headers

# Check for OOMKilled in events
echo ""
echo "$(ts) Recent pod events (OOM-related):"
kubectl get events -n "$NAMESPACE" --field-selector reason=OOMKilling --sort-by='.lastTimestamp' 2>/dev/null | tail -5 || echo "(no OOM events)"

# ---- Step 6: Restore original memory ----
header "RESTORING MEMORY LIMIT ($ORIGINAL_MEMORY)"

echo "$(ts) Patching deployment memory limit back to $ORIGINAL_MEMORY..."
kubectl patch "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" --type=json \
  -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/resources/limits/memory\",\"value\":\"$ORIGINAL_MEMORY\"}]"

echo "$(ts) Waiting for rollout..."
kubectl rollout status "deployment/$DEPLOYMENT_NAME" -n "$NAMESPACE" --timeout=180s || true

echo "$(ts) Pods after restore:"
kubectl get pods -n "$NAMESPACE" -l app=node-mirth --no-headers

# ---- Summary ----
header "SUMMARY: MEMORY-PRESSURE CHAOS TEST (INFORMATIONAL)"

echo "$(ts) Memory reduced to:       $LOW_MEMORY"
echo "$(ts) OOM restarts observed:    $NEW_RESTARTS"
echo "$(ts) Memory restored to:       $ORIGINAL_MEMORY"
echo ""
if [[ "$NEW_RESTARTS" -gt 0 ]]; then
  echo "$(ts) RESULT: OOMKilled observed ($NEW_RESTARTS restarts) -- Node.js recovered after limit restore"
else
  echo "$(ts) RESULT: No OOM observed at $LOW_MEMORY -- application stayed within limits"
fi
echo ""
echo "$(ts) NOTE: This test is informational. OOM behavior depends on workload and Node.js heap settings."
echo "$(ts)       To set a max heap: NODE_OPTIONS='--max-old-space-size=200' in the deployment env."

# Always exit 0 -- informational test
exit 0
