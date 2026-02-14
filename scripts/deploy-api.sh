#!/bin/bash
# deploy-api.sh - Installs a lightweight status/control API on the OpenClaw EC2 instance
# This creates a Node.js Express server that exposes endpoints for the UI
# Run via SSM: push this to the instance, then execute

set -euo pipefail

echo "Installing Solana Autopilot Status API..."

# Create the API directory
mkdir -p /home/ubuntu/autopilot-api

# Write package.json
cat > /home/ubuntu/autopilot-api/package.json << 'PKGJSON'
{
  "name": "solana-autopilot-api",
  "version": "1.0.0",
  "description": "Status and control API for Solana Autopilot on OpenClaw",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "@aws-sdk/client-secrets-manager": "^3.700.0",
    "@aws-sdk/client-cloudwatch": "^3.700.0"
  }
}
PKGJSON

# Write the API server
cat > /home/ubuntu/autopilot-api/server.js << 'SERVERJS'
const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

const PORT = process.env.API_PORT || 3001;
const REGION = process.env.AWS_REGION || 'us-east-1';

const smClient = new SecretsManagerClient({ region: REGION });
const cwClient = new CloudWatchClient({ region: REGION });

let dbPool = null;

// ==================== Database Connection ====================
async function getDbPool() {
  if (dbPool) return dbPool;

  const secretResp = await smClient.send(new GetSecretValueCommand({
    SecretId: 'solana-autopilot-infra/db-credentials'
  }));
  const creds = JSON.parse(secretResp.SecretString);

  dbPool = new Pool({
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    user: creds.username,
    password: creds.password,
    max: 5,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  return dbPool;
}

// ==================== Health & Status ====================

// GET /api/deploy/status - Full system health
app.get('/api/deploy/status', async (req, res) => {
  try {
    const checks = {};

    // OpenClaw gateway status
    try {
      const { stdout } = await execAsync('ss -tlnp | grep 18789');
      checks.openclaw_gateway = { status: 'healthy', details: stdout.trim() };
    } catch {
      checks.openclaw_gateway = { status: 'unhealthy', details: 'Port 18789 not listening' };
    }

    // RDS connectivity
    try {
      const pool = await getDbPool();
      const result = await pool.query('SELECT NOW() as time, count(*) as table_count FROM pg_tables WHERE schemaname = $1', ['public']);
      checks.database = {
        status: 'healthy',
        server_time: result.rows[0].time,
        table_count: parseInt(result.rows[0].table_count)
      };
    } catch (err) {
      checks.database = { status: 'unhealthy', error: err.message };
    }

    // Bedrock model config
    try {
      const configPaths = [
        path.join(process.env.HOME, '.openclaw/openclaw.json'),
        path.join(process.env.HOME, '.clawdbot/clawdbot.json')
      ];
      let config = null;
      for (const p of configPaths) {
        if (fs.existsSync(p)) {
          config = JSON.parse(fs.readFileSync(p, 'utf-8'));
          break;
        }
      }
      if (config) {
        const providers = config.models?.providers || {};
        const bedrockProvider = Object.values(providers).find(p => p.api?.includes('bedrock'));
        const modelId = bedrockProvider?.models?.[0]?.id || 'unknown';
        checks.bedrock_model = { status: 'configured', model_id: modelId };
      }
    } catch (err) {
      checks.bedrock_model = { status: 'unknown', error: err.message };
    }

    // Trading config (kill switch status)
    try {
      const secretResp = await smClient.send(new GetSecretValueCommand({
        SecretId: 'solana-autopilot-infra/trading-config'
      }));
      const tradingConfig = JSON.parse(secretResp.SecretString);
      checks.trading = {
        paper_mode: tradingConfig.paper_mode,
        kill_switch_active: tradingConfig.kill_switch_active,
        max_position_size_usd: tradingConfig.max_position_size_usd,
        max_daily_loss_usd: tradingConfig.max_daily_loss_usd
      };
    } catch (err) {
      checks.trading = { status: 'unknown', error: err.message };
    }

    // System resources
    try {
      const { stdout: memOut } = await execAsync("free -m | grep Mem | awk '{print $2,$3,$4}'");
      const [total, used, free] = memOut.trim().split(' ').map(Number);
      const { stdout: cpuOut } = await execAsync("uptime | awk -F'load average:' '{print $2}'");
      checks.system = {
        memory_mb: { total, used, free },
        load_average: cpuOut.trim()
      };
    } catch (err) {
      checks.system = { error: err.message };
    }

    const overallHealthy = checks.openclaw_gateway?.status === 'healthy' && checks.database?.status === 'healthy';

    res.json({
      status: overallHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==================== Restart ====================

// POST /api/deploy/restart - Restart OpenClaw gateway
app.post('/api/deploy/restart', async (req, res) => {
  try {
    await execAsync('XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart openclaw-gateway 2>/dev/null || XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart clawdbot-gateway');
    // Wait for gateway to come back
    await new Promise(resolve => setTimeout(resolve, 3000));

    const { stdout } = await execAsync('ss -tlnp | grep 18789 || echo "NOT_LISTENING"');
    const isListening = !stdout.includes('NOT_LISTENING');

    res.json({
      status: isListening ? 'restarted' : 'restart_failed',
      port_listening: isListening,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==================== Logs ====================

// GET /api/deploy/logs?lines=50 - Recent gateway logs
app.get('/api/deploy/logs', async (req, res) => {
  const lines = parseInt(req.query.lines) || 50;
  try {
    const { stdout } = await execAsync(
      `XDG_RUNTIME_DIR=/run/user/1000 journalctl --user -u openclaw-gateway -n ${lines} --no-pager 2>/dev/null || XDG_RUNTIME_DIR=/run/user/1000 journalctl --user -u clawdbot-gateway -n ${lines} --no-pager`
    );
    res.json({
      logs: stdout.split('\n'),
      line_count: stdout.split('\n').length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==================== Kill Switch ====================

// POST /api/deploy/kill-switch { active: true/false, reason: "..." }
app.post('/api/deploy/kill-switch', async (req, res) => {
  const { active, reason } = req.body;
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active (boolean) is required' });
  }

  try {
    // Update Secrets Manager trading config
    const secretResp = await smClient.send(new GetSecretValueCommand({
      SecretId: 'solana-autopilot-infra/trading-config'
    }));
    const tradingConfig = JSON.parse(secretResp.SecretString);
    tradingConfig.kill_switch_active = active;

    await smClient.send(new PutSecretValueCommand({
      SecretId: 'solana-autopilot-infra/trading-config',
      SecretString: JSON.stringify(tradingConfig)
    }));

    // Log the event to database
    try {
      const pool = await getDbPool();
      await pool.query(
        'INSERT INTO kill_switch_events (action, triggered_by, reason) VALUES ($1, $2, $3)',
        [active ? 'ACTIVATE' : 'DEACTIVATE', 'api', reason || null]
      );
    } catch (dbErr) {
      console.error('Failed to log kill switch event:', dbErr.message);
    }

    // Emit CloudWatch metric
    try {
      await cwClient.send(new PutMetricDataCommand({
        Namespace: 'SolanaAutopilot',
        MetricData: [{
          MetricName: 'KillSwitchActivated',
          Value: active ? 1 : 0,
          Unit: 'Count',
          Timestamp: new Date()
        }]
      }));
    } catch (cwErr) {
      console.error('Failed to emit CloudWatch metric:', cwErr.message);
    }

    res.json({
      kill_switch_active: active,
      reason: reason || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// GET /api/deploy/kill-switch - Get kill switch status
app.get('/api/deploy/kill-switch', async (req, res) => {
  try {
    const secretResp = await smClient.send(new GetSecretValueCommand({
      SecretId: 'solana-autopilot-infra/trading-config'
    }));
    const tradingConfig = JSON.parse(secretResp.SecretString);

    // Get recent events from DB
    let recentEvents = [];
    try {
      const pool = await getDbPool();
      const result = await pool.query(
        'SELECT action, triggered_by, reason, created_at FROM kill_switch_events ORDER BY created_at DESC LIMIT 5'
      );
      recentEvents = result.rows;
    } catch {}

    res.json({
      kill_switch_active: tradingConfig.kill_switch_active,
      recent_events: recentEvents,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==================== Portfolio Summary ====================

// GET /api/portfolio/summary - Current portfolio state
app.get('/api/portfolio/summary', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [positionsRes, snapshotRes, recentOrdersRes] = await Promise.all([
      pool.query("SELECT * FROM positions WHERE side != 'FLAT' ORDER BY pair"),
      pool.query('SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 1'),
      pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10')
    ]);

    res.json({
      positions: positionsRes.rows,
      latest_snapshot: snapshotRes.rows[0] || null,
      recent_orders: recentOrdersRes.rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==================== Start Server ====================

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Solana Autopilot API running on http://127.0.0.1:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /api/deploy/status');
  console.log('  POST /api/deploy/restart');
  console.log('  GET  /api/deploy/logs?lines=50');
  console.log('  GET  /api/deploy/kill-switch');
  console.log('  POST /api/deploy/kill-switch');
  console.log('  GET  /api/portfolio/summary');
});
SERVERJS

# Install dependencies
cd /home/ubuntu/autopilot-api
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm install --production 2>&1

# Create systemd service
mkdir -p /home/ubuntu/.config/systemd/user

cat > /home/ubuntu/.config/systemd/user/autopilot-api.service << 'SVCEOF'
[Unit]
Description=Solana Autopilot Status API
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/autopilot-api
ExecStart=/home/ubuntu/.nvm/versions/node/v22.*/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=API_PORT=3001
Environment=AWS_REGION=us-east-1

[Install]
WantedBy=default.target
SVCEOF

# Enable and start
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user daemon-reload
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user enable autopilot-api
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user start autopilot-api

sleep 2
echo "API Status:"
ss -tlnp | grep 3001 || echo "API NOT LISTENING"
echo "Done!"
