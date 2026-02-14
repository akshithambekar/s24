#!/bin/bash
# health-check.sh - Run on the EC2 instance to diagnose OpenClaw health
# Usage: Run via SSM session on the OpenClaw EC2 instance

set -uo pipefail

echo "=== OpenClaw Health Check ==="
echo "Date: $(date)"
echo ""

# 1. Instance metadata
echo "1. Instance Info:"
TOKEN_IMDS=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN_IMDS" http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null)
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN_IMDS" http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null)
INSTANCE_TYPE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN_IMDS" http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null)
echo "  Region:        $REGION"
echo "  Instance ID:   $INSTANCE_ID"
echo "  Instance Type: $INSTANCE_TYPE"
echo ""

# 2. Service status
echo "2. OpenClaw Gateway Service:"
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status openclaw-gateway --no-pager 2>&1 | head -10 || echo "  Service not found (may use clawdbot-gateway)"
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status clawdbot-gateway --no-pager 2>&1 | head -10 || true
echo ""

# 3. Process check
echo "3. Running Processes:"
ps aux | grep -E "(openclaw|clawdbot)" | grep -v grep || echo "  No openclaw/clawdbot processes found"
echo ""

# 4. Port check
echo "4. Port 18789 Listening:"
ss -tlnp | grep 18789 || echo "  Port 18789 is NOT listening"
echo ""

# 5. Configuration
echo "5. Configuration File:"
CONFIG_FILE=""
if [ -f "$HOME/.openclaw/openclaw.json" ]; then
  CONFIG_FILE="$HOME/.openclaw/openclaw.json"
elif [ -f "$HOME/.clawdbot/clawdbot.json" ]; then
  CONFIG_FILE="$HOME/.clawdbot/clawdbot.json"
fi

if [ -n "$CONFIG_FILE" ]; then
  echo "  File: $CONFIG_FILE"
  python3 -m json.tool "$CONFIG_FILE" 2>/dev/null | grep -A 3 '"id"' || echo "  Could not parse config"
else
  echo "  No config file found"
fi
echo ""

# 6. Gateway token
echo "6. Gateway Token:"
if [ -f "$HOME/.openclaw/gateway_token.txt" ]; then
  echo "  Token file: $HOME/.openclaw/gateway_token.txt"
  echo "  Token: $(cat "$HOME/.openclaw/gateway_token.txt")"
elif [ -f "$HOME/.clawdbot/gateway_token.txt" ]; then
  echo "  Token file: $HOME/.clawdbot/gateway_token.txt"
  echo "  Token: $(cat "$HOME/.clawdbot/gateway_token.txt")"
else
  echo "  No token file found"
fi
echo ""

# 7. Bedrock test
echo "7. Bedrock Connectivity Test:"
aws bedrock-runtime invoke-model \
  --model-id us.anthropic.claude-opus-4-6-v1 \
  --content-type "application/json" \
  --body "$(echo '{"anthropic_version":"bedrock-2023-05-31","max_tokens":10,"messages":[{"role":"user","content":[{"type":"text","text":"test"}]}]}' | base64)" \
  --region "$REGION" \
  /tmp/health-check-test.json 2>&1 && echo "  Bedrock OK" || echo "  Bedrock FAILED (may need model access enabled)"
echo ""

# 8. Setup status
echo "8. Setup Status:"
if [ -f "$HOME/.openclaw/setup_status.txt" ]; then
  cat "$HOME/.openclaw/setup_status.txt"
elif [ -f "$HOME/.clawdbot/setup_status.txt" ]; then
  cat "$HOME/.clawdbot/setup_status.txt"
else
  echo "  No setup status file found"
fi
echo ""

# 9. Disk and memory
echo "9. System Resources:"
echo "  Disk:"
df -h / | tail -1 | awk '{print "    Used: "$3" / "$2" ("$5" full)"}'
echo "  Memory:"
free -h | grep Mem | awk '{print "    Used: "$3" / "$2}'
echo "  CPU Load:"
uptime | awk -F'load average:' '{print "   "$2}'
echo ""

echo "=== Health Check Complete ==="
