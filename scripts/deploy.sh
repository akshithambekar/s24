#!/bin/bash
# deploy.sh - End-to-end deploy script for OpenClaw on AWS with Bedrock
# Usage: ./scripts/deploy.sh [stack-name] [region]

set -euo pipefail

STACK_NAME="${1:-openclaw-bedrock}"
REGION="${2:-us-east-1}"
PARAMS_FILE="infra/openclaw-stack-params.json"
TEMPLATE_URL="https://sharefile-jiade.s3.cn-northwest-1.amazonaws.com.cn/clawdbot-bedrock.yaml"

echo "============================================"
echo "OpenClaw AWS Deployment"
echo "Stack:  $STACK_NAME"
echo "Region: $REGION"
echo "============================================"

# Check prerequisites
echo "[1/5] Checking prerequisites..."
command -v aws >/dev/null 2>&1 || { echo "ERROR: AWS CLI not installed"; exit 1; }
command -v session-manager-plugin >/dev/null 2>&1 || { echo "WARNING: SSM plugin not installed (needed for access later)"; }

# Verify AWS credentials
aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || { echo "ERROR: AWS credentials not configured"; exit 1; }
echo "  AWS identity: $(aws sts get-caller-identity --query 'Arn' --output text --region "$REGION")"

# Check if stack already exists
EXISTING=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NONE")
if [ "$EXISTING" != "NONE" ]; then
  echo "  Stack '$STACK_NAME' already exists with status: $EXISTING"
  if [[ "$EXISTING" == *"COMPLETE"* ]] && [[ "$EXISTING" != "DELETE_COMPLETE" ]]; then
    echo "  Use 'aws cloudformation delete-stack' to remove it first, or choose a different stack name."
    exit 1
  fi
fi

# Deploy stack
echo "[2/5] Deploying CloudFormation stack..."
aws cloudformation create-stack \
  --stack-name "$STACK_NAME" \
  --template-url "$TEMPLATE_URL" \
  --parameters file://"$PARAMS_FILE" \
  --capabilities CAPABILITY_IAM \
  --region "$REGION"

echo "  Stack creation initiated. Waiting for completion (~8 minutes)..."

# Wait for completion
echo "[3/5] Waiting for stack to complete..."
aws cloudformation wait stack-create-complete \
  --stack-name "$STACK_NAME" \
  --region "$REGION"

echo "  Stack creation complete!"

# Get outputs
echo "[4/5] Retrieving stack outputs..."
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text)

ACCESS_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`Step3AccessURL`].OutputValue' \
  --output text)

MODEL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`BedrockModel`].OutputValue' \
  --output text)

echo "  Instance ID: $INSTANCE_ID"
echo "  Model:       $MODEL"
echo "  Access URL:  $ACCESS_URL"

# Print access instructions
echo ""
echo "[5/5] Access Instructions"
echo "============================================"
echo ""
echo "1. Start port forwarding (keep this terminal open):"
echo ""
echo "   aws ssm start-session \\"
echo "     --target $INSTANCE_ID \\"
echo "     --region $REGION \\"
echo "     --document-name AWS-StartPortForwardingSession \\"
echo "     --parameters '{\"portNumber\":[\"18789\"],\"localPortNumber\":[\"18789\"]}'"
echo ""
echo "2. Open in browser:"
echo "   $ACCESS_URL"
echo ""
echo "============================================"
echo "Deployment complete!"
