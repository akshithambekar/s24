#!/bin/bash
# tunnel.sh - Port forward both Trading API (3001) and OpenClaw Gateway (18789)
# Usage: ./scripts/tunnel.sh [instance-id] [region]
#
# Prerequisites:
#   - AWS CLI v2 installed and configured
#   - SSM Session Manager Plugin installed

set -euo pipefail

INSTANCE_ID="${1:-i-0be15780adbd4dde5}"
REGION="${2:-us-east-1}"

echo "============================================"
echo "s24 SSM Tunnel (Trading API + OpenClaw)"
echo "============================================"

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "ERROR: AWS CLI not installed"; exit 1; }
command -v session-manager-plugin >/dev/null 2>&1 || { echo "ERROR: SSM Session Manager Plugin not installed"; exit 1; }

# Cleanup on exit
PIDS=()
cleanup() {
  echo ""
  echo "Shutting down tunnels..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

# Start Trading API tunnel (port 3001)
echo "Starting Trading API tunnel on localhost:3001..."
aws ssm start-session \
  --target "$INSTANCE_ID" \
  --region "$REGION" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3001"],"localPortNumber":["3001"]}' &
PIDS+=($!)

# Start OpenClaw Gateway tunnel (port 18789)
echo "Starting OpenClaw Gateway tunnel on localhost:18789..."
aws ssm start-session \
  --target "$INSTANCE_ID" \
  --region "$REGION" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["18789"],"localPortNumber":["18789"]}' &
PIDS+=($!)

echo ""
echo "Both tunnels starting. Press Ctrl+C to disconnect."
echo "  Trading API:      http://localhost:3001"
echo "  OpenClaw Gateway: http://localhost:18789"
echo "============================================"

# Wait for both background processes
wait
