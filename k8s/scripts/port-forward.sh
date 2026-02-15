#!/usr/bin/env bash
# Port-forward infrastructure services from mirth-infra namespace for local access.
# All forwards run in background; SIGINT (Ctrl+C) kills all.
#
# Usage: port-forward.sh [--namespace <ns>]
#
# Forwarded services:
#   MySQL      localhost:3306
#   MailHog    localhost:8025 (SMTP web UI)
#   ActiveMQ   localhost:8161 (web console)
#   Orthanc    localhost:8042 (DICOM web UI)
#   SFTP       localhost:2222
set -euo pipefail

NAMESPACE="${1:-mirth-infra}"
if [[ "$1" == "--namespace" ]] 2>/dev/null; then
  NAMESPACE="${2:-mirth-infra}"
fi

PIDS=()

cleanup() {
  echo ""
  echo "Stopping all port-forwards..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  echo "Done."
  exit 0
}

trap cleanup SIGINT SIGTERM

echo "=== Port-Forwarding Infrastructure Services (namespace: $NAMESPACE) ==="
echo "Press Ctrl+C to stop all."
echo ""

# MySQL 3306
echo "  MySQL         localhost:3306 -> mysql:3306"
kubectl port-forward -n "$NAMESPACE" svc/mysql 3306:3306 &>/dev/null &
PIDS+=($!)

# MailHog SMTP web UI 8025
echo "  MailHog       localhost:8025 -> mailhog:8025"
kubectl port-forward -n "$NAMESPACE" svc/mailhog 8025:8025 &>/dev/null &
PIDS+=($!)

# ActiveMQ web console 8161
echo "  ActiveMQ      localhost:8161 -> activemq:8161"
kubectl port-forward -n "$NAMESPACE" svc/activemq 8161:8161 &>/dev/null &
PIDS+=($!)

# Orthanc DICOM web UI 8042
echo "  Orthanc       localhost:8042 -> orthanc:8042"
kubectl port-forward -n "$NAMESPACE" svc/orthanc 8042:8042 &>/dev/null &
PIDS+=($!)

# SFTP 2222 -> 22
echo "  SFTP          localhost:2222 -> sftp:22"
kubectl port-forward -n "$NAMESPACE" svc/sftp 2222:22 &>/dev/null &
PIDS+=($!)

echo ""
echo "All port-forwards active. Waiting..."

# Wait for any child to exit (indicates port-forward failure)
wait -n 2>/dev/null || true

# If we get here without trap, a port-forward died
echo "WARNING: A port-forward process exited unexpectedly."
cleanup
