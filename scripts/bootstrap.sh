#!/bin/bash
# bootstrap.sh - Bootstrap Solana Autopilot skills and config on the OpenClaw EC2 instance
# Usage: Run on the EC2 instance after OpenClaw is healthy
#   scp this script to the instance, then:
#   sudo su - ubuntu
#   bash bootstrap.sh

set -euo pipefail

echo "============================================"
echo "Solana Autopilot Bootstrap"
echo "Date: $(date)"
echo "============================================"

# Detect config paths (openclaw vs clawdbot naming)
if [ -d "$HOME/.openclaw" ]; then
  CONFIG_DIR="$HOME/.openclaw"
  CONFIG_FILE="$CONFIG_DIR/openclaw.json"
elif [ -d "$HOME/.clawdbot" ]; then
  CONFIG_DIR="$HOME/.clawdbot"
  CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
else
  echo "ERROR: No OpenClaw config directory found"
  exit 1
fi

echo "Config directory: $CONFIG_DIR"

# Get region
TOKEN_IMDS=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN_IMDS" http://169.254.169.254/latest/meta-data/placement/region)
echo "Region: $REGION"

# ==================== Step 1: Update model to Opus 4.6 ====================
echo ""
echo "[1/7] Updating model to Claude Opus 4.6..."

# Backup current config
cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%s)"

# Update model ID in config from Opus 4.5 to Opus 4.6
if command -v python3 >/dev/null 2>&1; then
  python3 << PYEOF
import json

config_file = "$CONFIG_FILE"
with open(config_file, 'r') as f:
    config = json.load(f)

# Update model in providers
providers = config.get('models', {}).get('providers', {})
for provider_name, provider in providers.items():
    if 'amazon-bedrock' in provider_name:
        for model in provider.get('models', []):
            if 'opus' in model.get('id', '').lower() or 'claude' in model.get('id', '').lower():
                old_id = model['id']
                model['id'] = 'us.anthropic.claude-opus-4-6-v1'
                model['name'] = 'Claude Opus 4.6'
                model['contextWindow'] = 200000
                model['maxTokens'] = 16384
                print(f"  Updated model: {old_id} -> {model['id']}")

# Update default agent model
agents = config.get('agents', {})
defaults = agents.get('defaults', {})
model_config = defaults.get('model', {})
if 'primary' in model_config:
    old_primary = model_config['primary']
    model_config['primary'] = 'amazon-bedrock/us.anthropic.claude-opus-4-6-v1'
    print(f"  Updated primary: {old_primary} -> {model_config['primary']}")

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)

print("  Config updated successfully")
PYEOF
else
  echo "  WARNING: python3 not available, using sed fallback"
  sed -i 's|global\.anthropic\.claude-opus-4-5-20251101-v1:0|us.anthropic.claude-opus-4-6-v1|g' "$CONFIG_FILE"
fi

# ==================== Step 2: Configure system prompt ====================
echo ""
echo "[2/7] Configuring Solana Autopilot system prompt..."

mkdir -p "$HOME/clawd"
cat > "$HOME/clawd/system.md" << 'SYSEOF'
# Solana Autopilot Agent

You are a Solana trading assistant operating in **paper trading mode**. You execute simulated trades using real-time Solana market data.

## Core Rules
1. **NEVER execute real mainnet transactions.** All trades are paper-only simulations.
2. **Always check the risk engine** before proposing any trade.
3. **Respect the kill switch.** If the kill switch is active, do NOT propose any new trades.
4. **Log everything.** Every decision, trade proposal, approval, and rejection must be recorded.

## Capabilities
- Fetch real-time Solana token prices and market data
- Generate trade signals based on configured strategy parameters
- Submit trade proposals to the risk engine for approval
- Track portfolio positions, PnL, and exposure
- Report status and performance metrics on demand

## Trading Workflow
1. Analyze current market conditions using the Market Data Adapter
2. Generate trade signals via the Strategy Engine
3. Submit proposed orders to the Risk Engine
4. If approved, execute paper trades via the Paper Execution Engine
5. Update portfolio state and report results

## Safety
- Maximum position size and daily loss limits are enforced server-side
- You cannot bypass the risk engine or kill switch
- If you detect anomalous market conditions, report them and pause trading

## Trading API Integration

The Trading API runs at `http://127.0.0.1:3001`. Use it for all operations:

### Trigger a Trade Cycle
```bash
exec curl -s -X POST -H "Content-Type: application/json" \
  -d '{"trigger_source":"openclaw","idempotency_key":"<uuid>","symbol":"SOL-USDC"}' \
  http://127.0.0.1:3001/v1/trade/cycle | jq .
```

### Check Bot Status
```bash
exec curl -s http://127.0.0.1:3001/v1/bot/status | jq .
```

### View Portfolio
```bash
exec curl -s http://127.0.0.1:3001/v1/portfolio/snapshots?limit=10 | jq .
```

When the user asks to trade, use the `/v1/trade/cycle` endpoint. If it returns 423, the kill switch is active. If 409, the cycle was already triggered.

For direct paper trades (manual buy/sell commands), you may still use the solana-paper-trader skill with propose-order.js.
SYSEOF

echo "  System prompt written to $HOME/clawd/system.md"

# ==================== Step 2.5: Install OpenClaw skills ====================
echo ""
echo "[3/7] Installing OpenClaw skills..."
SKILLS_DIR="$CONFIG_DIR/skills"
mkdir -p "$SKILLS_DIR"

# Install solana-trader-v2 from playbooks (provides Jupiter price data + wallet queries)
if command -v npx >/dev/null 2>&1; then
  npx playbooks add skill openclaw/skills --skill solana-trader-v2
  echo "  Installed: solana-trader-v2"
else
  echo "  WARNING: npx not found, skipping solana-trader-v2 install"
fi

# Install custom paper trading skills from repo
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
for skill in solana-paper-trader solana-risk-manager solana-portfolio solana-devnet-smoke; do
  if [ -d "$SCRIPT_DIR/../skills/$skill" ]; then
    cp -r "$SCRIPT_DIR/../skills/$skill" "$SKILLS_DIR/"
    if [ -f "$SKILLS_DIR/$skill/package.json" ]; then
      (cd "$SKILLS_DIR/$skill" && npm install --production 2>&1)
    fi
    echo "  Installed: $skill"
  fi
done

# ==================== Step 3: Fetch trading config from Secrets Manager ====================
echo ""
echo "[4/7] Fetching trading configuration from Secrets Manager..."

# Try to get trading config (will fail gracefully if extended infra not yet deployed)
TRADING_CONFIG=$(aws secretsmanager get-secret-value \
  --secret-id "solana-autopilot-infra/trading-config" \
  --region "$REGION" \
  --query 'SecretString' \
  --output text 2>/dev/null || echo "")

if [ -n "$TRADING_CONFIG" ]; then
  echo "$TRADING_CONFIG" > "$CONFIG_DIR/trading-config.json"
  echo "  Trading config saved to $CONFIG_DIR/trading-config.json"
else
  echo "  Extended infra not yet deployed, using default trading config"
  cat > "$CONFIG_DIR/trading-config.json" << 'TCEOF'
{
  "paper_mode": true,
  "max_position_size_usd": 1000,
  "max_daily_loss_usd": 100,
  "cooldown_seconds": 60,
  "kill_switch_active": false
}
TCEOF
  echo "  Default trading config written to $CONFIG_DIR/trading-config.json"
fi

# ==================== Step 4: Fetch RDS connection info ====================
echo ""
echo "[5/7] Checking RDS connection info..."

DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "solana-autopilot-infra/db-credentials" \
  --region "$REGION" \
  --query 'SecretString' \
  --output text 2>/dev/null || echo "")

if [ -n "$DB_SECRET" ]; then
  echo "$DB_SECRET" > "$CONFIG_DIR/db-credentials.json"
  chmod 600 "$CONFIG_DIR/db-credentials.json"
  echo "  DB credentials saved to $CONFIG_DIR/db-credentials.json"
else
  echo "  RDS not yet deployed, skipping DB config"
fi

# ==================== Step 6: Deploy market data adapter ====================
echo ""
echo "[6/7] Deploying market data adapter..."

ADAPTER_DIR="$HOME/market-data-adapter"
mkdir -p "$ADAPTER_DIR"
SCRIPT_DIR_ADAPTER="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR_ADAPTER/market-data-adapter/ingest-jupiter-ticks.js" ]; then
  cp "$SCRIPT_DIR_ADAPTER/market-data-adapter/ingest-jupiter-ticks.js" "$ADAPTER_DIR/"
  cp "$SCRIPT_DIR_ADAPTER/market-data-adapter/package.json" "$ADAPTER_DIR/"

  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  (cd "$ADAPTER_DIR" && npm install --production 2>&1)

  # Create systemd service
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/market-data-adapter.service" << 'SVCEOF'
[Unit]
Description=Solana Market Data Adapter (Jupiter ticks)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/market-data-adapter
ExecStart=/home/ubuntu/.nvm/versions/node/v22.22.0/bin/node ingest-jupiter-ticks.js
Restart=always
RestartSec=5
Environment=POLL_INTERVAL_MS=10000
Environment=AWS_REGION=us-east-1
Environment=DB_SECRET_ID=solana-autopilot-infra/db-credentials
Environment=JUPITER_API_KEY_SECRET_ID=solana-autopilot-infra/jupiter-api-key

[Install]
WantedBy=default.target
SVCEOF

  XDG_RUNTIME_DIR=/run/user/1000 systemctl --user daemon-reload
  XDG_RUNTIME_DIR=/run/user/1000 systemctl --user enable market-data-adapter
  XDG_RUNTIME_DIR=/run/user/1000 systemctl --user start market-data-adapter
  sleep 3
  echo "  Market data adapter started"
else
  echo "  WARNING: market-data-adapter not found in repo, skipping"
fi

# ==================== Step 7: Restart OpenClaw gateway ====================
echo ""
echo "[7/7] Restarting OpenClaw gateway..."

# Try both possible service names
if XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart openclaw-gateway 2>/dev/null; then
  echo "  openclaw-gateway restarted"
elif XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart clawdbot-gateway 2>/dev/null; then
  echo "  clawdbot-gateway restarted"
else
  echo "  WARNING: Could not restart gateway service. Manual restart may be needed."
fi

sleep 3

# Verify
if ss -tlnp | grep -q 18789; then
  echo "  Gateway is listening on port 18789"
else
  echo "  WARNING: Gateway not listening on port 18789"
fi

echo ""
echo "============================================"
echo "Bootstrap complete!"
echo ""
echo "Gateway token: $(cat "$CONFIG_DIR/gateway_token.txt" 2>/dev/null || echo 'unknown')"
echo "Access URL:    http://localhost:18789/?token=$(cat "$CONFIG_DIR/gateway_token.txt" 2>/dev/null || echo 'TOKEN')"
echo "============================================"
