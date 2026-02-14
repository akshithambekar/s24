#!/bin/bash
# connect.sh - Port forward to the OpenClaw dashboard and open it in your browser
# Usage: ./scripts/connect.sh [instance-id] [region]
#
# Prerequisites:
#   - AWS CLI v2 installed and configured
#   - SSM Session Manager Plugin installed
#     macOS: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html

set -euo pipefail

STACK_NAME="${1:-openclaw-bedrock}"
REGION="${2:-us-east-1}"

echo "============================================"
echo "OpenClaw Dashboard Connect"
echo "============================================"

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "ERROR: AWS CLI not installed"; exit 1; }
command -v session-manager-plugin >/dev/null 2>&1 || { echo "ERROR: SSM Session Manager Plugin not installed. Install from: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"; exit 1; }

# Get instance ID from CloudFormation
echo "Fetching instance ID from stack '$STACK_NAME'..."
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text 2>/dev/null)

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "ERROR: Could not find instance ID. Is the stack '$STACK_NAME' deployed in $REGION?"
  exit 1
fi

echo "Instance: $INSTANCE_ID"

# Get access URL (includes token)
ACCESS_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`Step3AccessURL`].OutputValue' \
  --output text 2>/dev/null)

echo ""
echo "Starting port forward on localhost:18789..."
echo ""
echo "Once you see 'Waiting for connections', open this URL:"
echo ""
echo "  $ACCESS_URL"
echo ""
echo "Press Ctrl+C to disconnect."
echo "============================================"
echo ""

# Open browser automatically after a short delay (background)
if [ -n "$ACCESS_URL" ]; then
  (sleep 3 && open "$ACCESS_URL" 2>/dev/null || xdg-open "$ACCESS_URL" 2>/dev/null || true) &
fi

# Start port forwarding (blocks until Ctrl+C)
aws ssm start-session \
  --target "$INSTANCE_ID" \
  --region "$REGION" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["18789"],"localPortNumber":["18789"]}'
