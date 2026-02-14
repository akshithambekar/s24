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
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

const PORT = process.env.API_PORT || 3001;
const REGION = process.env.AWS_REGION || 'us-east-1';
const DB_SECRET_ID = process.env.DB_SECRET_ID || 'solana-autopilot-infra/db-credentials';
const TRADING_CONFIG_SECRET_ID = process.env.TRADING_CONFIG_SECRET_ID || 'solana-autopilot-infra/trading-config';
const DEFAULT_SYMBOL = process.env.DEFAULT_SYMBOL || 'SOL-USDC';
const MARKET_DATA_STALE_SECONDS = parseInt(process.env.MARKET_DATA_STALE_SECONDS || '30', 10);
const MARKET_DATA_AUTO_KILL_SECONDS = parseInt(process.env.MARKET_DATA_AUTO_KILL_SECONDS || '120', 10);

const RISK_POLICY = {
  startingBalanceSol: 10,
  maxSingleOrderSol: 1,
  maxOpenExposureSol: 3,
  maxOpenPositions: 3,
  maxDrawdownSol: 1,
  maxLossPerTradeSol: 0.3,
  maxDailyLossSol: 0.5,
  cooldownSeconds: 60,
  maxTradesPerHour: 10,
  maxTradesPerDay: 50,
  minConfidence: 0.7,
  minPriceMovePct5m: 2,
  anomalyWarnMovePct60s: 5,
  anomalyAutoKillMovePct60s: 10,
  anomalyWindowSeconds: 60,
  anomalyAutoKillEnabled: true,
  simulatedSlippagePct: 0.003,
  simulatedFeePct: 0.001
};

const schedulerState = {
  enabled: false,
  intervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '60000', 10),
  lastTriggeredAt: null,
  lastResult: null,
  cycleCount: 0,
  timer: null
};

const STRATEGY_CONFIG = {
  enabled: true,
  symbol: DEFAULT_SYMBOL,
  defaultOrderSizeSol: 0.25,
  minConfidence: RISK_POLICY.minConfidence,
  minPriceMovePct5m: RISK_POLICY.minPriceMovePct5m,
  cooldownSeconds: RISK_POLICY.cooldownSeconds
};

const smClient = new SecretsManagerClient({ region: REGION });
const cwClient = new CloudWatchClient({ region: REGION });

let dbPool = null;

// ==================== Database Connection ====================
async function getDbPool() {
  if (dbPool) return dbPool;

  const secretResp = await smClient.send(new GetSecretValueCommand({
    SecretId: DB_SECRET_ID
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

function nowIso() {
  return new Date().toISOString();
}

function sendApiError(res, statusCode, code, message, details = {}) {
  return res.status(statusCode).json({
    error: {
      code,
      message,
      details
    }
  });
}

function isTickStale(eventAt) {
  if (!eventAt) return true;
  const ageMs = Date.now() - new Date(eventAt).getTime();
  return ageMs > (MARKET_DATA_STALE_SECONDS * 1000);
}

function isTickAutoKillStale(eventAt) {
  if (!eventAt) return false;
  const ageMs = Date.now() - new Date(eventAt).getTime();
  return ageMs > (MARKET_DATA_AUTO_KILL_SECONDS * 1000);
}

function parsePositiveNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function readFromAnyKey(input, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return input[key];
    }
  }
  return undefined;
}

function sanitizeRiskPolicyPatch(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  const numericFields = [
    ['startingBalanceSol', ['startingBalanceSol', 'starting_balance_sol'], 'positive'],
    ['maxSingleOrderSol', ['maxSingleOrderSol', 'max_single_order_sol'], 'positive'],
    ['maxOpenExposureSol', ['maxOpenExposureSol', 'max_open_exposure_sol'], 'positive'],
    ['maxOpenPositions', ['maxOpenPositions', 'max_open_positions'], 'positive_int'],
    ['maxDrawdownSol', ['maxDrawdownSol', 'max_drawdown_sol'], 'positive'],
    ['maxLossPerTradeSol', ['maxLossPerTradeSol', 'max_loss_per_trade_sol'], 'positive'],
    ['maxDailyLossSol', ['maxDailyLossSol', 'max_daily_loss_sol'], 'positive'],
    ['cooldownSeconds', ['cooldownSeconds', 'cooldown_seconds'], 'positive_int'],
    ['maxTradesPerHour', ['maxTradesPerHour', 'max_trades_per_hour'], 'positive_int'],
    ['maxTradesPerDay', ['maxTradesPerDay', 'max_trades_per_day'], 'positive_int'],
    ['minConfidence', ['minConfidence', 'min_confidence'], 'unit_interval'],
    ['minPriceMovePct5m', ['minPriceMovePct5m', 'min_price_move_pct_5m', 'min_price_move_pct5m'], 'non_negative'],
    ['anomalyWarnMovePct60s', ['anomalyWarnMovePct60s', 'anomaly_warn_move_pct_60s'], 'non_negative'],
    ['anomalyAutoKillMovePct60s', ['anomalyAutoKillMovePct60s', 'anomaly_auto_kill_move_pct_60s'], 'non_negative'],
    ['anomalyWindowSeconds', ['anomalyWindowSeconds', 'anomaly_window_seconds'], 'positive_int'],
    ['simulatedSlippagePct', ['simulatedSlippagePct', 'simulated_slippage_pct'], 'non_negative'],
    ['simulatedFeePct', ['simulatedFeePct', 'simulated_fee_pct'], 'non_negative']
  ];

  for (const [target, keys, kind] of numericFields) {
    const raw = readFromAnyKey(input, keys);
    if (raw === undefined) continue;
    let parsed = null;
    if (kind === 'positive') parsed = parsePositiveNumber(raw, null);
    if (kind === 'non_negative') parsed = parseNonNegativeNumber(raw, null);
    if (kind === 'positive_int') {
      const n = parsePositiveNumber(raw, null);
      parsed = n === null ? null : Math.max(1, Math.floor(n));
    }
    if (kind === 'unit_interval') {
      const n = parseNonNegativeNumber(raw, null);
      parsed = (n !== null && n <= 1) ? n : null;
    }
    if (parsed !== null) out[target] = parsed;
  }

  const anomalyAutoKillEnabledRaw = readFromAnyKey(input, ['anomalyAutoKillEnabled', 'anomaly_auto_kill_enabled']);
  const anomalyAutoKillEnabled = parseBoolean(anomalyAutoKillEnabledRaw, null);
  if (anomalyAutoKillEnabled !== null) out.anomalyAutoKillEnabled = anomalyAutoKillEnabled;

  return out;
}

function sanitizeStrategyConfigPatch(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};

  const boolFields = [
    ['enabled', ['enabled']],
    ['anomalyDetectionEnabled', ['anomalyDetectionEnabled', 'anomaly_detection_enabled']]
  ];
  for (const [target, keys] of boolFields) {
    const raw = readFromAnyKey(input, keys);
    const value = parseBoolean(raw, null);
    if (value !== null) out[target] = value;
  }

  const symbol = readFromAnyKey(input, ['symbol', 'default_symbol']);
  if (typeof symbol === 'string' && symbol.trim().length > 0) {
    out.symbol = symbol.trim().toUpperCase();
  }

  const numericFields = [
    ['defaultOrderSizeSol', ['defaultOrderSizeSol', 'default_order_size_sol'], 'positive'],
    ['minConfidence', ['minConfidence', 'min_confidence'], 'unit_interval'],
    ['minPriceMovePct5m', ['minPriceMovePct5m', 'min_price_move_pct_5m'], 'non_negative'],
    ['cooldownSeconds', ['cooldownSeconds', 'cooldown_seconds'], 'positive_int']
  ];

  for (const [target, keys, kind] of numericFields) {
    const raw = readFromAnyKey(input, keys);
    if (raw === undefined) continue;
    let parsed = null;
    if (kind === 'positive') parsed = parsePositiveNumber(raw, null);
    if (kind === 'non_negative') parsed = parseNonNegativeNumber(raw, null);
    if (kind === 'positive_int') {
      const n = parsePositiveNumber(raw, null);
      parsed = n === null ? null : Math.max(1, Math.floor(n));
    }
    if (kind === 'unit_interval') {
      const n = parseNonNegativeNumber(raw, null);
      parsed = (n !== null && n <= 1) ? n : null;
    }
    if (parsed !== null) out[target] = parsed;
  }

  return out;
}

function buildEffectiveRiskPolicy(tradingConfig) {
  const patch = sanitizeRiskPolicyPatch(tradingConfig?.risk_policy || {});
  const merged = { ...RISK_POLICY, ...patch };
  if (merged.anomalyAutoKillMovePct60s < merged.anomalyWarnMovePct60s) {
    merged.anomalyAutoKillMovePct60s = merged.anomalyWarnMovePct60s;
  }
  return merged;
}

function buildEffectiveStrategyConfig(tradingConfig, riskPolicy) {
  const baseline = {
    ...STRATEGY_CONFIG,
    minConfidence: riskPolicy.minConfidence,
    minPriceMovePct5m: riskPolicy.minPriceMovePct5m,
    cooldownSeconds: riskPolicy.cooldownSeconds
  };
  const patch = sanitizeStrategyConfigPatch(tradingConfig?.strategy_config || {});
  return { ...baseline, ...patch };
}

function buildOverridesFromEffective(effectiveConfig, baselineConfig) {
  const out = {};
  for (const [key, value] of Object.entries(effectiveConfig || {})) {
    const baselineValue = baselineConfig?.[key];
    if (typeof value === 'number' && typeof baselineValue === 'number') {
      if (Math.abs(value - baselineValue) > 1e-12) {
        out[key] = value;
      }
      continue;
    }
    if (value !== baselineValue) {
      out[key] = value;
    }
  }
  return out;
}

function parseLimit(rawLimit, defaultValue = 50, maxValue = 200) {
  const value = Number.parseInt(rawLimit ?? `${defaultValue}`, 10);
  if (!Number.isInteger(value) || value <= 0) return defaultValue;
  return Math.min(value, maxValue);
}

function encodeCursor(timestampValue, idValue) {
  if (!timestampValue || !idValue) return null;
  const payload = JSON.stringify({
    t: new Date(timestampValue).toISOString(),
    id: String(idValue)
  });
  return Buffer.from(payload, 'utf8').toString('base64');
}

function decodeCursor(cursorValue) {
  if (!cursorValue) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursorValue, 'base64').toString('utf8'));
    if (!decoded?.t || !decoded?.id) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function getTradingConfig() {
  const secretResp = await smClient.send(new GetSecretValueCommand({
    SecretId: TRADING_CONFIG_SECRET_ID
  }));
  return JSON.parse(secretResp.SecretString);
}

async function setTradingConfig(config) {
  await smClient.send(new PutSecretValueCommand({
    SecretId: TRADING_CONFIG_SECRET_ID,
    SecretString: JSON.stringify(config)
  }));
}

async function getLatestTick(pool, symbol) {
  const result = await pool.query(
    `SELECT symbol, bid_price, ask_price, mid_price, spread_bps, event_at
     FROM market_ticks
     WHERE symbol = $1
     ORDER BY event_at DESC
     LIMIT 1`,
    [symbol]
  );
  return result.rows[0] || null;
}

async function getLastCycleAt(pool, symbol) {
  const result = await pool.query(
    `SELECT created_at
     FROM orders
     WHERE symbol = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol]
  );
  return result.rows[0]?.created_at || null;
}

async function getLatestSnapshot(pool) {
  const result = await pool.query(
    `SELECT snapshot_id, nav, cash, realized_pnl, unrealized_pnl, captured_at
     FROM portfolio_snapshots
     ORDER BY captured_at DESC
     LIMIT 1`
  );
  return result.rows[0] || null;
}

async function getDayStartSnapshot(pool) {
  const result = await pool.query(
    `SELECT nav, captured_at
     FROM portfolio_snapshots
     WHERE captured_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
     ORDER BY captured_at ASC
     LIMIT 1`
  );
  return result.rows[0] || null;
}

async function getExposureState(pool, symbol) {
  const [positionsRes, currentPositionRes] = await Promise.all([
    pool.query(
      `SELECT symbol, qty
       FROM positions
       WHERE ABS(qty) > 1e-12`
    ),
    pool.query(
      `SELECT symbol, qty
       FROM positions
       WHERE symbol = $1
       LIMIT 1`,
      [symbol]
    )
  ]);

  const totalExposureSol = positionsRes.rows.reduce((sum, row) => sum + Math.abs(Number(row.qty || 0)), 0);
  const openPositionsCount = positionsRes.rows.length;
  const currentQty = Number(currentPositionRes.rows[0]?.qty || 0);

  return {
    totalExposureSol,
    openPositionsCount,
    currentQty
  };
}

async function getTradeFrequencyState(pool) {
  const [hourRes, dayRes, lastTradeRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::INT AS count
       FROM orders
       WHERE status = 'executed'
         AND created_at >= NOW() - INTERVAL '1 hour'`
    ),
    pool.query(
      `SELECT COUNT(*)::INT AS count
       FROM orders
       WHERE status = 'executed'
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`
    ),
    pool.query(
      `SELECT created_at
       FROM orders
       WHERE status = 'executed'
       ORDER BY created_at DESC
       LIMIT 1`
    )
  ]);

  return {
    tradesLastHour: hourRes.rows[0]?.count || 0,
    tradesToday: dayRes.rows[0]?.count || 0,
    lastTradeAt: lastTradeRes.rows[0]?.created_at || null
  };
}

function getPortfolioStateFromSnapshot(snapshot, riskPolicy = RISK_POLICY) {
  if (!snapshot) {
    return {
      navSol: riskPolicy.startingBalanceSol,
      cashSol: riskPolicy.startingBalanceSol,
      realizedPnlSol: 0,
      unrealizedPnlSol: 0
    };
  }
  return {
    navSol: Number(snapshot.nav || riskPolicy.startingBalanceSol),
    cashSol: Number(snapshot.cash || 0),
    realizedPnlSol: Number(snapshot.realized_pnl || 0),
    unrealizedPnlSol: Number(snapshot.unrealized_pnl || 0)
  };
}

function estimateTradeCostSol(qtySol, riskPolicy = RISK_POLICY) {
  return qtySol * (riskPolicy.simulatedSlippagePct + riskPolicy.simulatedFeePct);
}

function normalizeSide(side) {
  if (!side) return null;
  const normalized = String(side).trim().toLowerCase();
  if (normalized === 'buy' || normalized === 'sell') return normalized;
  return null;
}

async function maybeActivateKillSwitch(pool, reason, actor = 'system') {
  const tradingConfig = await getTradingConfig();
  if (tradingConfig.kill_switch_active) {
    return {
      activated: false,
      alreadyActive: true
    };
  }
  tradingConfig.kill_switch_active = true;
  await setTradingConfig(tradingConfig);
  await pool.query(
    `INSERT INTO kill_switch_events (enabled, actor, reason)
     VALUES ($1, $2, $3)`,
    [true, actor, reason]
  );
  return {
    activated: true,
    alreadyActive: false
  };
}

async function detectRecentPriceAnomaly(pool, symbol, riskPolicy) {
  const windowSeconds = Math.max(1, Math.floor(riskPolicy.anomalyWindowSeconds));
  const result = await pool.query(
    `SELECT mid_price, event_at
     FROM market_ticks
     WHERE symbol = $1
       AND event_at >= NOW() - make_interval(secs => $2::int)
     ORDER BY event_at ASC`,
    [symbol, windowSeconds]
  );

  if (result.rows.length < 2) {
    return {
      detected: false,
      severity: 'none',
      price_move_pct: 0,
      baseline_mid_price: null,
      latest_mid_price: null,
      baseline_at: null,
      latest_at: null,
      window_seconds: windowSeconds,
      samples: result.rows.length
    };
  }

  const baseline = result.rows[0];
  const latest = result.rows[result.rows.length - 1];
  const baselinePrice = Number(baseline.mid_price || 0);
  const latestPrice = Number(latest.mid_price || 0);
  if (!Number.isFinite(baselinePrice) || baselinePrice <= 0 || !Number.isFinite(latestPrice) || latestPrice <= 0) {
    return {
      detected: false,
      severity: 'none',
      price_move_pct: 0,
      baseline_mid_price: baselinePrice,
      latest_mid_price: latestPrice,
      baseline_at: baseline.event_at,
      latest_at: latest.event_at,
      window_seconds: windowSeconds,
      samples: result.rows.length
    };
  }

  const movePct = Math.abs(((latestPrice - baselinePrice) / baselinePrice) * 100);
  const severity =
    movePct >= riskPolicy.anomalyAutoKillMovePct60s ? 'extreme' :
    movePct >= riskPolicy.anomalyWarnMovePct60s ? 'warning' :
    'none';

  return {
    detected: severity !== 'none',
    severity,
    price_move_pct: movePct,
    baseline_mid_price: baselinePrice,
    latest_mid_price: latestPrice,
    baseline_at: baseline.event_at,
    latest_at: latest.event_at,
    window_seconds: windowSeconds,
    samples: result.rows.length
  };
}

function buildAnomalyDetails(symbol, anomaly) {
  return {
    symbol,
    severity: anomaly.severity,
    price_move_pct: anomaly.price_move_pct,
    window_seconds: anomaly.window_seconds,
    baseline_mid_price: anomaly.baseline_mid_price,
    latest_mid_price: anomaly.latest_mid_price,
    baseline_at: anomaly.baseline_at ? new Date(anomaly.baseline_at).toISOString() : null,
    latest_at: anomaly.latest_at ? new Date(anomaly.latest_at).toISOString() : null,
    samples: anomaly.samples
  };
}

async function insertAnomalyWarningForOrder(pool, orderId, symbol, anomaly) {
  if (!orderId || !anomaly?.detected) {
    return false;
  }
  const rule = anomaly.severity === 'extreme'
    ? 'ANOMALOUS_PRICE_MOVE_EXTREME'
    : 'ANOMALOUS_PRICE_MOVE_WARNING';
  await pool.query(
    `INSERT INTO risk_events (order_id, action, rule, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [orderId, 'warned', rule, JSON.stringify(buildAnomalyDetails(symbol, anomaly))]
  );
  return true;
}

async function getLatestOrderIdForSymbol(pool, symbol) {
  const result = await pool.query(
    `SELECT order_id
     FROM orders
     WHERE symbol = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol]
  );
  return result.rows[0]?.order_id || null;
}

async function insertAnomalyWarningUsingLatestOrder(pool, symbol, anomaly) {
  const orderId = await getLatestOrderIdForSymbol(pool, symbol);
  if (!orderId) {
    return {
      logged: false,
      order_id: null,
      reason: 'no_order_context'
    };
  }
  await insertAnomalyWarningForOrder(pool, orderId, symbol, anomaly);
  return {
    logged: true,
    order_id: orderId,
    reason: null
  };
}

async function evaluateAnomalyForSymbol(pool, symbol, riskPolicy, options = {}) {
  const autoKill = parseBoolean(options.autoKill, true);
  const logWarning = parseBoolean(options.logWarning, true);
  const actor = typeof options.actor === 'string' && options.actor.trim().length > 0
    ? options.actor.trim()
    : 'risk-engine';

  const anomaly = await detectRecentPriceAnomaly(pool, symbol, riskPolicy);

  let warningLog = {
    logged: false,
    order_id: null,
    reason: null
  };
  if (logWarning && anomaly.detected) {
    warningLog = await insertAnomalyWarningUsingLatestOrder(pool, symbol, anomaly);
  }

  let killSwitch = {
    attempted: false,
    activated: false,
    alreadyActive: false
  };
  if (autoKill && riskPolicy.anomalyAutoKillEnabled && anomaly.severity === 'extreme') {
    const killReason = `Auto activation: ${symbol} moved ${anomaly.price_move_pct.toFixed(4)}% within ${anomaly.window_seconds}s`;
    const activationResult = await maybeActivateKillSwitch(pool, killReason, actor);
    killSwitch = {
      attempted: true,
      ...activationResult
    };
  }

  return {
    anomaly,
    warning_log: warningLog,
    kill_switch: killSwitch
  };
}

async function ensureIdempotencyTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_idempotency_keys (
      request_key TEXT PRIMARY KEY,
      response_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getStoredIdempotentResponse(pool, requestKey) {
  const result = await pool.query(
    'SELECT response_json FROM api_idempotency_keys WHERE request_key = $1',
    [requestKey]
  );
  const payload = result.rows[0]?.response_json || null;
  return payload;
}

async function reserveIdempotencyKey(pool, requestKey) {
  const result = await pool.query(
    'INSERT INTO api_idempotency_keys (request_key) VALUES ($1) ON CONFLICT DO NOTHING',
    [requestKey]
  );
  return result.rowCount === 1;
}

async function storeIdempotentResponse(pool, requestKey, responsePayload) {
  await pool.query(
    'UPDATE api_idempotency_keys SET response_json = $2::jsonb WHERE request_key = $1',
    [requestKey, JSON.stringify(responsePayload)]
  );
}

async function releaseUnstoredIdempotencyKey(pool, requestKey) {
  await pool.query(
    'DELETE FROM api_idempotency_keys WHERE request_key = $1 AND response_json IS NULL',
    [requestKey]
  );
}

async function logRiskEventWithOrder(pool, { cycleId, symbol, side, confidence, strategyPayload, status, riskReason, action, rule, details, qtySol, limitPrice }) {
  const signalInsert = await pool.query(
    `INSERT INTO signals (cycle_id, symbol, side, confidence, strategy_payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING signal_id`,
    [cycleId, symbol, side, confidence, JSON.stringify(strategyPayload || {})]
  );
  const signalId = signalInsert.rows[0].signal_id;

  const orderInsert = await pool.query(
    `INSERT INTO orders (cycle_id, signal_id, symbol, side, qty, limit_price, status, risk_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING order_id, created_at`,
    [cycleId, signalId, symbol, side, qtySol, limitPrice, status, riskReason]
  );
  const orderId = orderInsert.rows[0].order_id;

  await pool.query(
    `INSERT INTO risk_events (order_id, action, rule, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [orderId, action, rule, JSON.stringify(details || {})]
  );

  return {
    signalId,
    orderId,
    orderCreatedAt: orderInsert.rows[0].created_at
  };
}

// Echo request ID for easier tracing across OpenClaw/UI/API logs.
app.use((req, res, next) => {
  const requestId = req.header('X-Request-Id');
  if (requestId) {
    res.set('X-Request-Id', requestId);
  }
  next();
});

// ==================== Health & Status ====================

// ==================== Trading API v1 ====================

app.get('/v1/health', async (req, res) => {
  const checks = {
    db: 'unhealthy',
    market_data: 'unknown'
  };

  try {
    const pool = await getDbPool();
    await pool.query('SELECT 1');
    checks.db = 'ok';

    const latestTick = await getLatestTick(pool, DEFAULT_SYMBOL);
    if (!latestTick) {
      checks.market_data = 'missing';
    } else if (isTickAutoKillStale(latestTick.event_at)) {
      checks.market_data = 'stale_auto_kill_threshold';
    } else if (isTickStale(latestTick.event_at)) {
      checks.market_data = 'stale';
    } else {
      checks.market_data = 'ok';
    }

    const overallStatus = checks.market_data === 'ok' ? 'ok' : 'degraded';
    return res.json({
      status: overallStatus,
      service: 'trading-api',
      time: nowIso(),
      dependencies: checks
    });
  } catch (err) {
    return res.status(503).json({
      status: 'degraded',
      service: 'trading-api',
      time: nowIso(),
      dependencies: checks,
      error: err.message
    });
  }
});

app.get('/v1/bot/status', async (req, res) => {
  const symbol = req.query.symbol || DEFAULT_SYMBOL;

  try {
    const [pool, tradingConfig] = await Promise.all([
      getDbPool(),
      getTradingConfig()
    ]);
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const strategyConfig = buildEffectiveStrategyConfig(tradingConfig, riskPolicy);
    const anomalyEnabled = strategyConfig.anomalyDetectionEnabled !== false;

    const [latestTick, lastCycleAt, latestSnapshot, anomaly] = await Promise.all([
      getLatestTick(pool, symbol),
      getLastCycleAt(pool, symbol),
      getLatestSnapshot(pool),
      anomalyEnabled ? detectRecentPriceAnomaly(pool, symbol, riskPolicy) : Promise.resolve(null)
    ]);

    const portfolio = getPortfolioStateFromSnapshot(latestSnapshot, riskPolicy);
    const drawdown = Math.max(0, riskPolicy.startingBalanceSol - portfolio.navSol);
    const killSwitch = Boolean(tradingConfig.kill_switch_active);
    return res.json({
      mode: tradingConfig.paper_mode ? 'paper_mode' : 'unknown',
      state: killSwitch ? 'paused' : 'running',
      kill_switch: killSwitch,
      last_cycle_at: lastCycleAt ? new Date(lastCycleAt).toISOString() : null,
      last_tick_at: latestTick?.event_at ? new Date(latestTick.event_at).toISOString() : null,
      market_data_stale: isTickStale(latestTick?.event_at),
      portfolio_nav_sol: portfolio.navSol,
      drawdown_sol: drawdown,
      anomaly_detection: {
        enabled: anomalyEnabled,
        state: anomaly
      }
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to read bot status', { reason: err.message });
  }
});

app.post('/v1/trade/cycle', async (req, res) => {
  const triggerSource = req.body?.trigger_source || 'openclaw';
  const idempotencyKey = req.body?.idempotency_key || null;
  const symbol = req.body?.symbol || DEFAULT_SYMBOL;
  const proposal = req.body?.proposal ?? null;
  const forceNoTrade = parseBoolean(req.body?.force_no_trade, false);

  let reservedKey = false;
  let pool = null;

  const rejectCycle = async (statusCode, code, message, details = {}) => {
    if (pool && idempotencyKey && reservedKey) {
      try {
        await releaseUnstoredIdempotencyKey(pool, idempotencyKey);
        reservedKey = false;
      } catch (cleanupErr) {
        console.error('Failed to cleanup idempotency key:', cleanupErr.message);
      }
    }
    return sendApiError(res, statusCode, code, message, details);
  };

  if (idempotencyKey !== null && typeof idempotencyKey !== 'string') {
    return sendApiError(res, 400, 'BAD_REQUEST', 'idempotency_key must be a string', {});
  }
  if (typeof symbol !== 'string' || symbol.length === 0) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'symbol is required', {});
  }
  if (proposal !== null && typeof proposal !== 'object') {
    return sendApiError(res, 400, 'BAD_REQUEST', 'proposal must be an object when provided', {});
  }

  try {
    pool = await getDbPool();

    if (idempotencyKey) {
      await ensureIdempotencyTable(pool);

      const existingPayload = await getStoredIdempotentResponse(pool, idempotencyKey);
      if (existingPayload) {
        return res.status(200).json(existingPayload);
      }

      reservedKey = await reserveIdempotencyKey(pool, idempotencyKey);
      if (!reservedKey) {
        return sendApiError(res, 409, 'CONFLICT', 'Duplicate idempotency_key is still in progress', {
          idempotency_key: idempotencyKey
        });
      }
    }

    const tradingConfig = await getTradingConfig();
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const strategyConfig = buildEffectiveStrategyConfig(tradingConfig, riskPolicy);
    const anomalyDetectionEnabled = strategyConfig.anomalyDetectionEnabled !== false;
    if (tradingConfig.kill_switch_active) {
      return rejectCycle(423, 'KILL_SWITCH_ACTIVE', 'Kill switch is active. New cycles are blocked.', {});
    }

    const latestTick = await getLatestTick(pool, symbol);
    if (latestTick && isTickAutoKillStale(latestTick.event_at)) {
      await maybeActivateKillSwitch(
        pool,
        `Auto activation: market data stale for more than ${MARKET_DATA_AUTO_KILL_SECONDS} seconds`,
        'risk-engine'
      );
      return rejectCycle(423, 'KILL_SWITCH_ACTIVE', 'Kill switch auto-activated due to prolonged stale market data', {
        symbol,
        last_tick_at: new Date(latestTick.event_at).toISOString(),
        auto_kill_after_seconds: MARKET_DATA_AUTO_KILL_SECONDS
      });
    }

    if (!latestTick || isTickStale(latestTick.event_at)) {
      return rejectCycle(409, 'STALE_MARKET_DATA', 'Latest market tick is missing or stale', {
        symbol,
        stale_after_seconds: MARKET_DATA_STALE_SECONDS,
        last_tick_at: latestTick?.event_at ? new Date(latestTick.event_at).toISOString() : null
      });
    }

    let anomalyCheck = null;
    if (anomalyDetectionEnabled) {
      anomalyCheck = await evaluateAnomalyForSymbol(pool, symbol, riskPolicy, {
        autoKill: true,
        logWarning: false,
        actor: 'risk-engine'
      });
      if (anomalyCheck.kill_switch.attempted && (anomalyCheck.kill_switch.activated || anomalyCheck.kill_switch.alreadyActive)) {
        return rejectCycle(423, 'KILL_SWITCH_ACTIVE', 'Kill switch auto-activated by anomaly detection', {
          symbol,
          anomaly: anomalyCheck.anomaly,
          auto_kill_enabled: riskPolicy.anomalyAutoKillEnabled,
          auto_kill_threshold_pct_60s: riskPolicy.anomalyAutoKillMovePct60s
        });
      }
    }

    const cycleId = randomUUID();
    const strategyPayload = {
      trigger_source: triggerSource,
      proposal: proposal || {},
      forced_no_trade: forceNoTrade,
      anomaly_context: anomalyCheck?.anomaly || null
    };

    if (!proposal || forceNoTrade) {
      const responsePayload = {
        cycle_id: cycleId,
        accepted: true,
        queued_at: nowIso(),
        symbol,
        trigger_source: triggerSource,
        anomaly: anomalyCheck?.anomaly || null
      };
      if (idempotencyKey) {
        await storeIdempotentResponse(pool, idempotencyKey, responsePayload);
      }
      return res.status(202).json(responsePayload);
    }

    const side = normalizeSide(proposal.side);
    const qtySol = parsePositiveNumber(proposal.qty_sol, null);
    const confidence = parseNonNegativeNumber(proposal.confidence, null);
    const priceMovementPct5m = parseNonNegativeNumber(proposal.price_movement_5m_pct, null);
    const expectedLossSol = parseNonNegativeNumber(proposal.expected_loss_sol, null);

    if (!side || qtySol === null || confidence === null || priceMovementPct5m === null) {
      return rejectCycle(400, 'BAD_REQUEST', 'proposal requires side, qty_sol, confidence, and price_movement_5m_pct', {});
    }

    const [snapshot, dayStartSnapshot, exposureState, frequencyState] = await Promise.all([
      getLatestSnapshot(pool),
      getDayStartSnapshot(pool),
      getExposureState(pool, symbol),
      getTradeFrequencyState(pool)
    ]);

    const portfolio = getPortfolioStateFromSnapshot(snapshot, riskPolicy);
    const dayStartNavSol = dayStartSnapshot ? Number(dayStartSnapshot.nav || portfolio.navSol) : portfolio.navSol;
    const dailyLossSol = Math.max(0, dayStartNavSol - portfolio.navSol);
    const drawdownSol = Math.max(0, riskPolicy.startingBalanceSol - portfolio.navSol);
    const tradeCostSol = estimateTradeCostSol(qtySol, riskPolicy);
    const projectedTradeLossSol = expectedLossSol ?? tradeCostSol;

    if (drawdownSol >= riskPolicy.maxDrawdownSol || portfolio.navSol <= (riskPolicy.startingBalanceSol - riskPolicy.maxDrawdownSol)) {
      await maybeActivateKillSwitch(
        pool,
        `Auto activation: drawdown ${drawdownSol.toFixed(6)} SOL reached threshold ${riskPolicy.maxDrawdownSol} SOL`,
        'risk-engine'
      );
      return rejectCycle(423, 'KILL_SWITCH_ACTIVE', 'Kill switch auto-activated by drawdown rule', {
        nav_sol: portfolio.navSol,
        drawdown_sol: drawdownSol,
        max_drawdown_sol: riskPolicy.maxDrawdownSol
      });
    }

    const projectedQty = side === 'buy'
      ? (exposureState.currentQty + qtySol)
      : (exposureState.currentQty - qtySol);

    const projectedTotalExposureSol =
      exposureState.totalExposureSol
      - Math.abs(exposureState.currentQty)
      + Math.abs(projectedQty);

    let projectedOpenPositions = exposureState.openPositionsCount;
    if (Math.abs(exposureState.currentQty) <= 1e-12 && Math.abs(projectedQty) > 1e-12) {
      projectedOpenPositions += 1;
    } else if (Math.abs(exposureState.currentQty) > 1e-12 && Math.abs(projectedQty) <= 1e-12) {
      projectedOpenPositions -= 1;
    }

    const secondsSinceLastTrade = frequencyState.lastTradeAt
      ? (Date.now() - new Date(frequencyState.lastTradeAt).getTime()) / 1000
      : null;

    const blockedRule = (() => {
      if (qtySol > riskPolicy.maxSingleOrderSol) {
        return {
          rule: 'MAX_SINGLE_ORDER_SIZE',
          message: 'Order size exceeds max single order size',
          details: { limit_sol: riskPolicy.maxSingleOrderSol, requested_sol: qtySol }
        };
      }
      if (projectedTotalExposureSol > riskPolicy.maxOpenExposureSol) {
        return {
          rule: 'MAX_TOTAL_OPEN_EXPOSURE',
          message: 'Projected exposure exceeds allowed open exposure',
          details: { limit_sol: riskPolicy.maxOpenExposureSol, projected_sol: projectedTotalExposureSol }
        };
      }
      if (projectedOpenPositions > riskPolicy.maxOpenPositions) {
        return {
          rule: 'MAX_OPEN_POSITIONS',
          message: 'Projected number of open positions exceeds allowed maximum',
          details: { limit: riskPolicy.maxOpenPositions, projected: projectedOpenPositions }
        };
      }
      if (projectedTradeLossSol > riskPolicy.maxLossPerTradeSol) {
        return {
          rule: 'MAX_LOSS_PER_TRADE',
          message: 'Estimated loss for this trade exceeds per-trade limit',
          details: { limit_sol: riskPolicy.maxLossPerTradeSol, projected_loss_sol: projectedTradeLossSol }
        };
      }
      if ((dailyLossSol + projectedTradeLossSol) > riskPolicy.maxDailyLossSol) {
        return {
          rule: 'MAX_DAILY_LOSS',
          message: 'Daily loss limit would be breached by this trade',
          details: { limit_sol: riskPolicy.maxDailyLossSol, current_daily_loss_sol: dailyLossSol, projected_daily_loss_sol: dailyLossSol + projectedTradeLossSol }
        };
      }
      if (secondsSinceLastTrade !== null && secondsSinceLastTrade < riskPolicy.cooldownSeconds) {
        return {
          rule: 'COOLDOWN_SECONDS',
          message: 'Trade cooldown period is active',
          details: { cooldown_seconds: riskPolicy.cooldownSeconds, seconds_since_last_trade: secondsSinceLastTrade }
        };
      }
      if (frequencyState.tradesLastHour >= riskPolicy.maxTradesPerHour) {
        return {
          rule: 'MAX_TRADES_PER_HOUR',
          message: 'Hourly trade cap reached',
          details: { limit: riskPolicy.maxTradesPerHour, current: frequencyState.tradesLastHour }
        };
      }
      if (frequencyState.tradesToday >= riskPolicy.maxTradesPerDay) {
        return {
          rule: 'MAX_TRADES_PER_DAY',
          message: 'Daily trade cap reached',
          details: { limit: riskPolicy.maxTradesPerDay, current: frequencyState.tradesToday }
        };
      }
      if (confidence < riskPolicy.minConfidence) {
        return {
          rule: 'MIN_CONFIDENCE',
          message: 'Signal confidence below threshold',
          details: { min_confidence: riskPolicy.minConfidence, received: confidence }
        };
      }
      if (Math.abs(priceMovementPct5m) < riskPolicy.minPriceMovePct5m) {
        return {
          rule: 'MIN_PRICE_MOVEMENT_5M',
          message: 'Signal price movement below threshold',
          details: { min_pct: riskPolicy.minPriceMovePct5m, received_pct: priceMovementPct5m }
        };
      }
      return null;
    })();

    const tickMid = Number(latestTick.mid_price);

    if (blockedRule) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const audit = await logRiskEventWithOrder(client, {
          cycleId,
          symbol,
          side,
          confidence,
          strategyPayload,
          status: 'rejected',
          riskReason: blockedRule.rule,
          action: 'blocked',
          rule: blockedRule.rule,
          details: blockedRule.details,
          qtySol,
          limitPrice: tickMid
        });
        if (anomalyCheck?.anomaly?.detected) {
          await insertAnomalyWarningForOrder(client, audit.orderId, symbol, anomalyCheck.anomaly);
        }
        await client.query('COMMIT');

        return rejectCycle(409, 'RISK_BLOCKED', blockedRule.message, {
          ...blockedRule.details,
          cycle_id: cycleId,
          order_id: audit.orderId,
          anomaly: anomalyCheck?.anomaly || null
        });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    const fillPrice = side === 'buy' ? Number(latestTick.ask_price) : Number(latestTick.bid_price);
    const feeSol = qtySol * riskPolicy.simulatedFeePct;
    const slippageBps = Math.round(riskPolicy.simulatedSlippagePct * 10000);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const audit = await logRiskEventWithOrder(client, {
        cycleId,
        symbol,
        side,
        confidence,
        strategyPayload,
        status: 'approved',
        riskReason: null,
        action: 'allowed',
        rule: 'ALL_CHECKS_PASSED',
        details: {
          confidence,
          price_movement_5m_pct: priceMovementPct5m
        },
        qtySol,
        limitPrice: tickMid
      });
      if (anomalyCheck?.anomaly?.detected) {
        await insertAnomalyWarningForOrder(client, audit.orderId, symbol, anomalyCheck.anomaly);
      }

      const fillInsert = await client.query(
        `INSERT INTO fills (order_id, symbol, side, qty, fill_price, fee, slippage_bps, filled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING fill_id, filled_at`,
        [audit.orderId, symbol, side, qtySol, fillPrice, feeSol, slippageBps]
      );

      await client.query(
        `UPDATE orders
         SET status = 'executed'
         WHERE order_id = $1`,
        [audit.orderId]
      );

      const currentPositionRes = await client.query(
        `SELECT symbol, qty, avg_entry_price
         FROM positions
         WHERE symbol = $1
         FOR UPDATE`,
        [symbol]
      );

      const currentQty = Number(currentPositionRes.rows[0]?.qty || 0);
      const currentAvg = Number(currentPositionRes.rows[0]?.avg_entry_price || fillPrice);
      const newQty = side === 'buy' ? currentQty + qtySol : currentQty - qtySol;

      let newAvg = currentAvg;
      if (Math.abs(newQty) <= 1e-12) {
        newAvg = fillPrice;
      } else if (side === 'buy' && newQty > 0) {
        const weightedNotional = (currentQty * currentAvg) + (qtySol * fillPrice);
        newAvg = weightedNotional / newQty;
      }

      const markPrice = tickMid;
      const unrealizedPnl = (markPrice - newAvg) * newQty;

      await client.query(
        `INSERT INTO positions (symbol, qty, avg_entry_price, mark_price, unrealized_pnl, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (symbol)
         DO UPDATE SET
           qty = EXCLUDED.qty,
           avg_entry_price = EXCLUDED.avg_entry_price,
           mark_price = EXCLUDED.mark_price,
           unrealized_pnl = EXCLUDED.unrealized_pnl,
           updated_at = NOW()`,
        [symbol, newQty, newAvg, markPrice, unrealizedPnl]
      );

      const newNavSol = Math.max(0, portfolio.navSol - tradeCostSol);
      const newRealizedPnlSol = portfolio.realizedPnlSol - tradeCostSol;
      const newCashSol = Math.max(0, newNavSol - projectedTotalExposureSol);

      await client.query(
        `INSERT INTO portfolio_snapshots (nav, cash, realized_pnl, unrealized_pnl, captured_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [newNavSol, newCashSol, newRealizedPnlSol, portfolio.unrealizedPnlSol]
      );

      await client.query('COMMIT');

      const responsePayload = {
        cycle_id: cycleId,
        accepted: true,
        queued_at: nowIso(),
        symbol,
        trigger_source: triggerSource,
        order_id: audit.orderId,
        fill_id: fillInsert.rows[0].fill_id,
        status: 'executed',
        anomaly: anomalyCheck?.anomaly || null
      };

      if (idempotencyKey) {
        await storeIdempotentResponse(pool, idempotencyKey, responsePayload);
      }
      return res.status(202).json(responsePayload);
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    if (pool && idempotencyKey && reservedKey) {
      try {
        await releaseUnstoredIdempotencyKey(pool, idempotencyKey);
      } catch (cleanupErr) {
        console.error('Failed to cleanup idempotency key:', cleanupErr.message);
      }
    }
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to trigger trade cycle', { reason: err.message });
  }
});

app.get('/v1/orders', async (req, res) => {
  try {
    const pool = await getDbPool();
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = decodeCursor(req.query.cursor);
    const params = [];
    const where = ['1=1'];

    if (req.query.symbol) {
      params.push(req.query.symbol);
      where.push(`symbol = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`status = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      where.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`created_at <= $${params.length}::timestamptz`);
    }
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(created_at, order_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(limit + 1);
    const query = `
      SELECT order_id, cycle_id, signal_id, symbol, side, qty, limit_price, status, risk_reason, created_at
      FROM orders
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, order_id DESC
      LIMIT $${params.length}
    `;
    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].order_id) : null;
    return res.json({ items, next_cursor: nextCursor });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch orders', { reason: err.message });
  }
});

app.get('/v1/fills', async (req, res) => {
  try {
    const pool = await getDbPool();
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = decodeCursor(req.query.cursor);
    const params = [];
    const where = ['1=1'];

    if (req.query.symbol) {
      params.push(req.query.symbol);
      where.push(`symbol = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      where.push(`filled_at >= $${params.length}::timestamptz`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`filled_at <= $${params.length}::timestamptz`);
    }
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(filled_at, fill_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(limit + 1);
    const query = `
      SELECT fill_id, order_id, symbol, side, qty, fill_price, fee, slippage_bps, filled_at
      FROM fills
      WHERE ${where.join(' AND ')}
      ORDER BY filled_at DESC, fill_id DESC
      LIMIT $${params.length}
    `;
    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1].filled_at, items[items.length - 1].fill_id) : null;
    return res.json({ items, next_cursor: nextCursor });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch fills', { reason: err.message });
  }
});

app.get('/v1/positions', async (req, res) => {
  try {
    const pool = await getDbPool();
    const params = [];
    let query = `
      SELECT symbol, qty, avg_entry_price, mark_price, unrealized_pnl, updated_at
      FROM positions
    `;

    if (req.query.symbol) {
      params.push(req.query.symbol);
      query += ` WHERE symbol = $1`;
    }

    query += ' ORDER BY symbol ASC';
    const result = await pool.query(query, params);
    return res.json({ items: result.rows });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch positions', { reason: err.message });
  }
});

app.get('/v1/portfolio/snapshots', async (req, res) => {
  try {
    const pool = await getDbPool();
    const limit = parseLimit(req.query.limit, 200, 500);
    const cursor = decodeCursor(req.query.cursor);
    const params = [];
    const where = ['1=1'];

    if (req.query.from) {
      params.push(req.query.from);
      where.push(`captured_at >= $${params.length}::timestamptz`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`captured_at <= $${params.length}::timestamptz`);
    }
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(captured_at, snapshot_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(limit + 1);
    const query = `
      SELECT snapshot_id, nav, cash, realized_pnl, unrealized_pnl, captured_at
      FROM portfolio_snapshots
      WHERE ${where.join(' AND ')}
      ORDER BY captured_at DESC, snapshot_id DESC
      LIMIT $${params.length}
    `;
    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1].captured_at, items[items.length - 1].snapshot_id) : null;
    return res.json({ items, next_cursor: nextCursor });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch portfolio snapshots', { reason: err.message });
  }
});

app.get('/v1/risk/events', async (req, res) => {
  try {
    const pool = await getDbPool();
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = decodeCursor(req.query.cursor);
    const params = [];
    const where = ['1=1'];

    if (req.query.from) {
      params.push(req.query.from);
      where.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`created_at <= $${params.length}::timestamptz`);
    }
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(created_at, risk_event_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(limit + 1);
    const query = `
      SELECT risk_event_id, order_id, action, rule, details, created_at
      FROM risk_events
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, risk_event_id DESC
      LIMIT $${params.length}
    `;
    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].risk_event_id) : null;
    return res.json({ items, next_cursor: nextCursor });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch risk events', { reason: err.message });
  }
});

app.get('/v1/risk/policy', async (req, res) => {
  try {
    const tradingConfig = await getTradingConfig();
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const overrides = sanitizeRiskPolicyPatch(tradingConfig?.risk_policy || {});
    return res.json({
      risk_policy: riskPolicy,
      overrides,
      defaults: RISK_POLICY
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch risk policy', { reason: err.message });
  }
});

app.put('/v1/risk/policy', async (req, res) => {
  const payload = req.body?.risk_policy !== undefined ? req.body.risk_policy : req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'risk policy payload must be a JSON object', {});
  }

  const patch = sanitizeRiskPolicyPatch(payload);
  if (Object.keys(patch).length === 0) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'No valid risk policy fields were provided', {});
  }

  try {
    const tradingConfig = await getTradingConfig();
    const currentOverrides = sanitizeRiskPolicyPatch(tradingConfig?.risk_policy || {});
    const mergedOverrides = {
      ...currentOverrides,
      ...patch
    };

    const effectiveRiskPolicy = buildEffectiveRiskPolicy({
      ...tradingConfig,
      risk_policy: mergedOverrides
    });
    const normalizedOverrides = buildOverridesFromEffective(effectiveRiskPolicy, RISK_POLICY);
    tradingConfig.risk_policy = normalizedOverrides;
    await setTradingConfig(tradingConfig);

    return res.json({
      risk_policy: effectiveRiskPolicy,
      overrides: normalizedOverrides,
      updated_at: nowIso()
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to update risk policy', { reason: err.message });
  }
});

app.get('/v1/strategy/config', async (req, res) => {
  try {
    const tradingConfig = await getTradingConfig();
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const strategyConfig = buildEffectiveStrategyConfig(tradingConfig, riskPolicy);
    const baselineStrategyConfig = buildEffectiveStrategyConfig({ strategy_config: {} }, riskPolicy);
    const overrides = sanitizeStrategyConfigPatch(tradingConfig?.strategy_config || {});
    return res.json({
      strategy_config: strategyConfig,
      overrides,
      defaults: baselineStrategyConfig
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch strategy config', { reason: err.message });
  }
});

app.put('/v1/strategy/config', async (req, res) => {
  const payload = req.body?.strategy_config !== undefined ? req.body.strategy_config : req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'strategy config payload must be a JSON object', {});
  }

  const patch = sanitizeStrategyConfigPatch(payload);
  if (Object.keys(patch).length === 0) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'No valid strategy config fields were provided', {});
  }

  try {
    const tradingConfig = await getTradingConfig();
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const baselineStrategyConfig = buildEffectiveStrategyConfig({ strategy_config: {} }, riskPolicy);
    const currentOverrides = sanitizeStrategyConfigPatch(tradingConfig?.strategy_config || {});
    const mergedOverrides = {
      ...currentOverrides,
      ...patch
    };

    const effectiveStrategyConfig = buildEffectiveStrategyConfig({
      ...tradingConfig,
      strategy_config: mergedOverrides
    }, riskPolicy);
    const normalizedOverrides = buildOverridesFromEffective(effectiveStrategyConfig, baselineStrategyConfig);
    tradingConfig.strategy_config = normalizedOverrides;
    await setTradingConfig(tradingConfig);

    return res.json({
      strategy_config: effectiveStrategyConfig,
      overrides: normalizedOverrides,
      updated_at: nowIso()
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to update strategy config', { reason: err.message });
  }
});

app.get('/v1/risk/anomaly-detection', async (req, res) => {
  const symbol = req.query.symbol || DEFAULT_SYMBOL;
  if (typeof symbol !== 'string' || symbol.trim().length === 0) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'symbol is required', {});
  }

  try {
    const [pool, tradingConfig] = await Promise.all([
      getDbPool(),
      getTradingConfig()
    ]);
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const strategyConfig = buildEffectiveStrategyConfig(tradingConfig, riskPolicy);
    const enabled = strategyConfig.anomalyDetectionEnabled !== false;
    const anomaly = enabled
      ? await detectRecentPriceAnomaly(pool, symbol, riskPolicy)
      : null;

    return res.json({
      symbol,
      enabled,
      anomaly,
      policy: {
        window_seconds: riskPolicy.anomalyWindowSeconds,
        warn_move_pct_60s: riskPolicy.anomalyWarnMovePct60s,
        auto_kill_move_pct_60s: riskPolicy.anomalyAutoKillMovePct60s,
        auto_kill_enabled: riskPolicy.anomalyAutoKillEnabled
      }
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to evaluate anomaly detection', { reason: err.message });
  }
});

app.post('/v1/risk/anomaly-detection/check', async (req, res) => {
  const symbol = req.body?.symbol || DEFAULT_SYMBOL;
  const actor = req.body?.actor || 'api';
  const autoKill = req.body?.auto_kill === undefined ? true : parseBoolean(req.body?.auto_kill, null);
  const logWarning = req.body?.log_warning === undefined ? true : parseBoolean(req.body?.log_warning, null);

  if (typeof symbol !== 'string' || symbol.trim().length === 0) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'symbol is required', {});
  }
  if (autoKill === null) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'auto_kill must be boolean when provided', {});
  }
  if (logWarning === null) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'log_warning must be boolean when provided', {});
  }

  try {
    const [pool, tradingConfig] = await Promise.all([
      getDbPool(),
      getTradingConfig()
    ]);
    const riskPolicy = buildEffectiveRiskPolicy(tradingConfig);
    const strategyConfig = buildEffectiveStrategyConfig(tradingConfig, riskPolicy);
    const enabled = strategyConfig.anomalyDetectionEnabled !== false;
    if (!enabled) {
      return res.json({
        symbol,
        enabled: false,
        checked_at: nowIso(),
        anomaly: null,
        warning_log: { logged: false, order_id: null, reason: 'anomaly_detection_disabled' },
        kill_switch: { attempted: false, activated: false, alreadyActive: false }
      });
    }

    const evaluation = await evaluateAnomalyForSymbol(pool, symbol, riskPolicy, {
      autoKill,
      logWarning,
      actor
    });

    return res.json({
      symbol,
      enabled: true,
      checked_at: nowIso(),
      ...evaluation
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to run anomaly check', { reason: err.message });
  }
});

app.post('/v1/kill-switch', async (req, res) => {
  const enabled = parseBoolean(req.body?.enabled, null);
  const reason = req.body?.reason || null;
  const actor = req.body?.actor || 'api';

  if (enabled === null) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'enabled (boolean) is required', {});
  }

  try {
    const pool = await getDbPool();
    const tradingConfig = await getTradingConfig();
    tradingConfig.kill_switch_active = enabled;
    await setTradingConfig(tradingConfig);

    await pool.query(
      `INSERT INTO kill_switch_events (enabled, actor, reason)
       VALUES ($1, $2, $3)`,
      [enabled, actor, reason]
    );

    return res.json({
      enabled,
      updated_at: nowIso()
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to update kill switch', { reason: err.message });
  }
});

app.get('/v1/kill-switch', async (req, res) => {
  try {
    const [pool, tradingConfig] = await Promise.all([getDbPool(), getTradingConfig()]);
    const result = await pool.query(
      `SELECT event_id, enabled, actor, reason, created_at
       FROM kill_switch_events
       ORDER BY created_at DESC
       LIMIT 10`
    );
    return res.json({
      enabled: Boolean(tradingConfig.kill_switch_active),
      recent_events: result.rows
    });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch kill switch state', { reason: err.message });
  }
});

app.get('/v1/devnet/smoke-runs', async (req, res) => {
  try {
    const pool = await getDbPool();
    const limit = parseLimit(req.query.limit, 20, 200);
    const cursor = decodeCursor(req.query.cursor);
    const params = [];
    const where = ['1=1'];

    if (req.query.from) {
      params.push(req.query.from);
      where.push(`ran_at >= $${params.length}::timestamptz`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`ran_at <= $${params.length}::timestamptz`);
    }
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(ran_at, run_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(limit + 1);
    const query = `
      SELECT run_id, status, rpc_latency_ms, wallet_check, tx_simulation, ran_at
      FROM devnet_smoke_runs
      WHERE ${where.join(' AND ')}
      ORDER BY ran_at DESC, run_id DESC
      LIMIT $${params.length}
    `;
    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1].ran_at, items[items.length - 1].run_id) : null;
    return res.json({ items, next_cursor: nextCursor });
  } catch (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch devnet smoke runs', { reason: err.message });
  }
});

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
        SecretId: TRADING_CONFIG_SECRET_ID
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
      SecretId: TRADING_CONFIG_SECRET_ID
    }));
    const tradingConfig = JSON.parse(secretResp.SecretString);
    tradingConfig.kill_switch_active = active;

    await smClient.send(new PutSecretValueCommand({
      SecretId: TRADING_CONFIG_SECRET_ID,
      SecretString: JSON.stringify(tradingConfig)
    }));

    // Log the event to database
    try {
      const pool = await getDbPool();
      await pool.query(
        'INSERT INTO kill_switch_events (enabled, actor, reason) VALUES ($1, $2, $3)',
        [active, 'api', reason || null]
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
      SecretId: TRADING_CONFIG_SECRET_ID
    }));
    const tradingConfig = JSON.parse(secretResp.SecretString);

    // Get recent events from DB
    let recentEvents = [];
    try {
      const pool = await getDbPool();
      const result = await pool.query(
        'SELECT enabled, actor, reason, created_at FROM kill_switch_events ORDER BY created_at DESC LIMIT 5'
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
      pool.query("SELECT * FROM positions WHERE qty <> 0 ORDER BY symbol"),
      pool.query('SELECT * FROM portfolio_snapshots ORDER BY captured_at DESC LIMIT 1'),
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

// ==================== Background Scheduler ====================

async function runScheduledCycle() {
  const now = new Date().toISOString();
  schedulerState.lastTriggeredAt = now;
  schedulerState.cycleCount++;

  try {
    // Check kill switch before making the request
    const config = await getTradingConfig();
    if (config.kill_switch_active) {
      const result = { status: 'skipped', reason: 'kill_switch_active', triggered_at: now };
      schedulerState.lastResult = result;
      console.log(`[scheduler] Cycle #${schedulerState.cycleCount} skipped — kill switch active`);
      return result;
    }

    // Internal HTTP request to POST /v1/trade/cycle
    const result = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ trigger_source: 'scheduler' });
      const req = http.request({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/v1/trade/cycle',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ status_code: res.statusCode, ...parsed, triggered_at: now });
          } catch {
            resolve({ status_code: res.statusCode, raw: body, triggered_at: now });
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });

    schedulerState.lastResult = result;
    console.log(`[scheduler] Cycle #${schedulerState.cycleCount} completed — status ${result.status_code}`);
    return result;
  } catch (err) {
    const result = { status: 'error', error: err.message, triggered_at: now };
    schedulerState.lastResult = result;
    console.error(`[scheduler] Cycle #${schedulerState.cycleCount} error:`, err.message);
    return result;
  }
}

function startScheduler() {
  if (schedulerState.timer) return;
  schedulerState.enabled = true;
  schedulerState.timer = setInterval(() => {
    runScheduledCycle().catch((err) => console.error('[scheduler] Unhandled error:', err.message));
  }, schedulerState.intervalMs);
  console.log(`[scheduler] Started — interval ${schedulerState.intervalMs}ms`);
}

function stopScheduler() {
  if (schedulerState.timer) {
    clearInterval(schedulerState.timer);
    schedulerState.timer = null;
  }
  schedulerState.enabled = false;
  console.log('[scheduler] Stopped');
}

// GET /v1/scheduler/status
app.get('/v1/scheduler/status', (req, res) => {
  res.json({
    enabled: schedulerState.enabled,
    interval_ms: schedulerState.intervalMs,
    last_triggered_at: schedulerState.lastTriggeredAt,
    last_result: schedulerState.lastResult,
    cycle_count: schedulerState.cycleCount
  });
});

// POST /v1/scheduler/control
app.post('/v1/scheduler/control', (req, res) => {
  const { enabled, interval_ms } = req.body || {};

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: { code: 'INVALID_PARAM', message: '`enabled` (boolean) is required' } });
  }

  if (interval_ms !== undefined) {
    const parsed = parseInt(interval_ms, 10);
    if (isNaN(parsed) || parsed < 5000) {
      return res.status(400).json({ error: { code: 'INVALID_PARAM', message: '`interval_ms` must be >= 5000' } });
    }
    schedulerState.intervalMs = parsed;
  }

  if (enabled) {
    // If interval changed while running, restart
    if (schedulerState.timer) stopScheduler();
    startScheduler();
  } else {
    stopScheduler();
  }

  res.json({
    enabled: schedulerState.enabled,
    interval_ms: schedulerState.intervalMs,
    last_triggered_at: schedulerState.lastTriggeredAt,
    cycle_count: schedulerState.cycleCount
  });
});

// ==================== Start Server ====================

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Solana Autopilot API running on http://127.0.0.1:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /v1/health');
  console.log('  GET  /v1/bot/status?symbol=SOL-USDC');
  console.log('  POST /v1/trade/cycle');
  console.log('  GET  /v1/orders');
  console.log('  GET  /v1/fills');
  console.log('  GET  /v1/positions');
  console.log('  GET  /v1/portfolio/snapshots');
  console.log('  GET  /v1/risk/events');
  console.log('  GET  /v1/risk/policy');
  console.log('  PUT  /v1/risk/policy');
  console.log('  GET  /v1/strategy/config');
  console.log('  PUT  /v1/strategy/config');
  console.log('  GET  /v1/risk/anomaly-detection');
  console.log('  POST /v1/risk/anomaly-detection/check');
  console.log('  GET  /v1/kill-switch');
  console.log('  POST /v1/kill-switch');
  console.log('  GET  /v1/devnet/smoke-runs');
  console.log('  GET  /v1/scheduler/status');
  console.log('  POST /v1/scheduler/control');
  console.log('  GET  /api/deploy/status');
  console.log('  POST /api/deploy/restart');
  console.log('  GET  /api/deploy/logs?lines=50');
  console.log('  GET  /api/deploy/kill-switch');
  console.log('  POST /api/deploy/kill-switch');
  console.log('  GET  /api/portfolio/summary');

  // Auto-start scheduler if enabled via env var
  if (process.env.SCHEDULER_ENABLED === 'true') {
    console.log('[scheduler] Auto-starting (SCHEDULER_ENABLED=true)');
    startScheduler();
  }
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
ExecStart=/home/ubuntu/.nvm/versions/node/v22.22.0/bin/node server.js
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
