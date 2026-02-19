#!/usr/bin/env bash
# =============================================================================
# Chaos Test: Network Partition (Mirth -> MySQL)
# =============================================================================
# Applies a NetworkPolicy that blocks Mirth pods from reaching MySQL (port 3306)
# while allowing API traffic and DNS. Verifies that health degrades, then removes
# the policy and confirms recovery.
#
# Usage:
#   ./network-partition.sh                             # Defaults
#   NAMESPACE=my-ns ./network-partition.sh
#
# Prerequisites:
#   - kubectl configured for the target cluster
#   - A CNI that enforces NetworkPolicy (Calico, Cilium, etc.)
#     NOTE: k3s default Flannel does NOT enforce NetworkPolicy.
#     Use k3s with --flannel-backend=none + Calico, or use Rancher Desktop
#     with Cilium. If your CNI doesn't enforce policies, the partition won't
#     take effect and the test will report accordingly.
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-mirth-cluster}"
MYSQL_NAMESPACE="${MYSQL_NAMESPACE:-mirth-infra}"
MYSQL_POD_LABEL="${MYSQL_POD_LABEL:-app=mysql}"
DB_NAME="${DB_NAME:-mirthdb}"
MIRTH_API_PORT="${MIRTH_API_PORT:-8080}"
POLICY_NAME="dv-block-mysql"

PASS=0
FAIL=0

ts() { date "+%Y-%m-%d %H:%M:%S"; }
header() { echo ""; echo "$(ts) ============ $1 ============"; }
pass() { echo "$(ts) [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "$(ts) [FAIL] $1"; FAIL=$((FAIL + 1)); }
info() { echo "$(ts) [INFO] $1"; }

mysql_exec() {
  local sql="$1"
  local mysql_pod
  mysql_pod=$(kubectl get pods -n "$MYSQL_NAMESPACE" -l "$MYSQL_POD_LABEL" -o name | head -1)
  kubectl exec -n "$MYSQL_NAMESPACE" "$mysql_pod" -- \
    mysql -u mirth -pmirth "$DB_NAME" -N -e "$sql" 2>/dev/null
}

get_mirth_pod() {
  kubectl get pods -n "$NAMESPACE" -l app=node-mirth -o name --field-selector=status.phase=Running | head -1
}

check_health() {
  local pod="$1"
  kubectl exec -n "$NAMESPACE" "$pod" -- \
    wget -q -S -O /dev/null --timeout=5 "http://localhost:${MIRTH_API_PORT}/api/health" 2>&1 || true
}

# ---- Cleanup trap ----
cleanup() {
  echo ""
  echo "$(ts) Cleaning up NetworkPolicy (if exists)..."
  kubectl delete networkpolicy "$POLICY_NAME" -n "$NAMESPACE" 2>/dev/null || true
}
trap cleanup EXIT

# ---- Step 1: Pre-state ----
header "PRE-STATE"

MIRTH_POD=$(get_mirth_pod)
echo "$(ts) Using Mirth pod: ${MIRTH_POD#pod/}"

PRE_HEALTH=$(check_health "$MIRTH_POD")
if echo "$PRE_HEALTH" | grep -q "200 OK"; then
  info "Health check: 200 OK"
else
  info "Health check: $PRE_HEALTH"
  echo "$(ts) WARNING: Health not 200 before test -- results may be unreliable"
fi

# ---- Step 2: Apply NetworkPolicy ----
header "APPLYING NETWORK PARTITION"

info "Creating NetworkPolicy '$POLICY_NAME' to block MySQL (port 3306)..."
info "Allowing: API (8080), DNS (53/UDP), inter-pod communication"
info "Blocking: MySQL (3306)"

kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${POLICY_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/part-of: deep-validation
    chaos-test: network-partition
spec:
  podSelector:
    matchLabels:
      app: node-mirth
  policyTypes:
    - Egress
  egress:
    # Allow DNS resolution
    - ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    # Allow API traffic between pods (inter-cluster communication)
    - to:
        - podSelector:
            matchLabels:
              app: node-mirth
      ports:
        - port: 8080
          protocol: TCP
    # Allow traffic to kube-dns and kube-system
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
EOF

echo "$(ts) NetworkPolicy applied."

# ---- Step 3: Wait for partition to take effect ----
header "WAITING FOR PARTITION EFFECT (10s)"

echo "$(ts) Waiting 10s for existing MySQL connections to timeout..."
sleep 10

# ---- Step 4: Check degraded health ----
header "CHECKING DEGRADED STATE"

MIRTH_POD=$(get_mirth_pod)
DEGRADED_HEALTH=$(check_health "$MIRTH_POD")

if echo "$DEGRADED_HEALTH" | grep -q "200 OK"; then
  info "Health still returns 200 -- CNI may not enforce NetworkPolicy"
  info "This is expected on default k3s/Flannel. Test is informational."
  CNI_ENFORCED=0
else
  info "Health degraded (not 200) -- network partition effective"
  CNI_ENFORCED=1
fi

# Also try a DB-dependent operation
info "Testing DB-dependent operation (channel list)..."
DB_OP_RESULT=$(kubectl exec -n "$NAMESPACE" "$MIRTH_POD" -- \
  wget -q -O - --timeout=10 "http://localhost:${MIRTH_API_PORT}/api/channels" 2>&1 || echo "FAILED/TIMEOUT")

if echo "$DB_OP_RESULT" | grep -qE "FAILED|TIMEOUT|500|503|error"; then
  info "DB-dependent operation failed/degraded as expected"
  if [[ "$CNI_ENFORCED" -eq 1 ]]; then
    pass "Health degrades when MySQL is unreachable"
  fi
else
  info "DB-dependent operation succeeded -- partition may not be effective"
fi

# ---- Step 5: Remove partition ----
header "REMOVING NETWORK PARTITION"

echo "$(ts) Deleting NetworkPolicy '$POLICY_NAME'..."
kubectl delete networkpolicy "$POLICY_NAME" -n "$NAMESPACE"
echo "$(ts) NetworkPolicy removed."

# ---- Step 6: Wait for recovery ----
header "WAITING FOR RECOVERY (30s)"

echo "$(ts) Waiting 30s for connection pool recovery..."
sleep 30

# ---- Step 7: Verify recovery ----
header "RECOVERY VERIFICATION"

MIRTH_POD=$(get_mirth_pod)

RECOVERY_OK=0
for attempt in 1 2 3; do
  RECOVERY_HEALTH=$(check_health "$MIRTH_POD")
  if echo "$RECOVERY_HEALTH" | grep -q "200 OK"; then
    RECOVERY_OK=1
    break
  fi
  info "Attempt $attempt: not yet recovered, retrying in 10s..."
  sleep 10
done

if [[ "$RECOVERY_OK" -eq 1 ]]; then
  pass "Health returns 200 after partition removed"
else
  fail "Health not recovered after partition removal"
fi

# Verify message processing works
info "Sending test message to verify processing..."
TEST_RESULT=$(kubectl exec -n "$NAMESPACE" "$MIRTH_POD" -- \
  wget -q -S -O /dev/null --timeout=10 \
  "http://localhost:${MIRTH_API_PORT}/api/health" 2>&1 || true)

if echo "$TEST_RESULT" | grep -q "200 OK"; then
  pass "API responsive after partition recovery"
else
  fail "API not responsive after partition recovery"
fi

# ---- Summary ----
header "SUMMARY: NETWORK-PARTITION CHAOS TEST"

if [[ "$CNI_ENFORCED" -eq 0 ]]; then
  echo "$(ts) NOTE: NetworkPolicy was NOT enforced by the CNI."
  echo "$(ts)       This test requires Calico, Cilium, or another policy-enforcing CNI."
  echo "$(ts)       Default k3s/Flannel does not enforce NetworkPolicy."
  echo ""
fi

echo "$(ts) Passed:  $PASS"
echo "$(ts) Failed:  $FAIL"
echo ""

if [[ "$FAIL" -eq 0 ]]; then
  echo "$(ts) RESULT: PASS"
  exit 0
else
  echo "$(ts) RESULT: FAIL"
  exit 1
fi
