#!/bin/bash
# attach-iam-policy.sh - Attach the Solana Autopilot IAM policy to the OpenClaw EC2 role
# Run after solana-autopilot-infra stack is created
# Usage: ./scripts/attach-iam-policy.sh [openclaw-stack-name] [autopilot-stack-name] [region]

set -euo pipefail

OPENCLAW_STACK="${1:-openclaw-bedrock}"
AUTOPILOT_STACK="${2:-solana-autopilot-infra}"
REGION="${3:-us-east-1}"

echo "Attaching Autopilot IAM policy to OpenClaw EC2 role..."

# Get the OpenClaw IAM role name
ROLE_NAME=$(aws cloudformation describe-stack-resources \
  --stack-name "$OPENCLAW_STACK" \
  --region "$REGION" \
  --query 'StackResources[?LogicalResourceId==`OpenClawInstanceRole`].PhysicalResourceId' \
  --output text)

echo "  OpenClaw role: $ROLE_NAME"

# Get the Autopilot policy ARN
POLICY_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$AUTOPILOT_STACK" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AutopilotPolicyArn`].OutputValue' \
  --output text)

echo "  Policy ARN: $POLICY_ARN"

# Attach the policy
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "$POLICY_ARN"

echo "  Policy attached successfully!"
echo ""
echo "The OpenClaw EC2 instance now has access to:"
echo "  - Secrets Manager (DB creds, Solana RPC, trading config)"
echo "  - CloudWatch custom metrics (SolanaAutopilot namespace)"
echo "  - CloudWatch Logs (/solana-autopilot/*)"
