#!/usr/bin/env node
"use strict";

const { Pool } = require("pg");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CONFIG = {
  symbol: process.env.SYMBOL || "SOL-USDC",
  inputMint: process.env.BASE_MINT || SOL_MINT,
  outputMint: process.env.QUOTE_MINT || USDC_MINT,
  baseDecimals: parsePositiveInt("BASE_DECIMALS", 9),
  quoteDecimals: parsePositiveInt("QUOTE_DECIMALS", 6),
  // Ask side: buy SOL with this much USDC
  usdcNotionalAtomic: parsePositiveInt("USDC_NOTIONAL_ATOMIC", 100_000_000), // 100 USDC
  // Bid side: sell this much SOL for USDC
  solAmountAtomic: parsePositiveInt("SOL_AMOUNT_ATOMIC", 1_000_000_000), // 1 SOL
  quoteUrl: process.env.JUPITER_QUOTE_URL || "https://api.jup.ag/swap/v1/quote",
  slippageBps: parsePositiveInt("SLIPPAGE_BPS", 50),
  pollIntervalMs: parsePositiveInt("POLL_INTERVAL_MS", 10_000),
  awsRegion: process.env.AWS_REGION || "us-east-1",
  dbSecretId: process.env.DB_SECRET_ID || "solana-autopilot-infra/db-credentials",
  dbSsl: parseBool(process.env.DB_SSL, true)
};

let dbPool = null;

function parsePositiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer. Got: ${raw}`);
  }
  return value;
}

function parseBool(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function toFloatAmount(atomicAmount, decimals) {
  return Number(atomicAmount) / (10 ** decimals);
}

function buildQuoteUrl(inputMint, outputMint, amountAtomic) {
  const url = new URL(CONFIG.quoteUrl);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountAtomic));
  url.searchParams.set("swapMode", "ExactIn");
  url.searchParams.set("slippageBps", String(CONFIG.slippageBps));
  return url.toString();
}

async function getDbPool() {
  if (dbPool) return dbPool;

  if (process.env.DATABASE_URL) {
    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: CONFIG.dbSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000
    });
    return dbPool;
  }

  if (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) {
    dbPool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number.parseInt(process.env.PGPORT, 10) : 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: CONFIG.dbSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000
    });
    return dbPool;
  }

  const creds = await loadDbCredsFromSecretsManager(CONFIG.dbSecretId, CONFIG.awsRegion);
  dbPool = new Pool({
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    user: creds.username,
    password: creds.password,
    ssl: CONFIG.dbSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000
  });
  return dbPool;
}

async function loadDbCredsFromSecretsManager(secretId, region) {
  let awsSdk;
  try {
    awsSdk = require("@aws-sdk/client-secrets-manager");
  } catch (err) {
    throw new Error(
      "Missing @aws-sdk/client-secrets-manager dependency. " +
      "Install dependencies or provide DATABASE_URL / PG* env vars."
    );
  }

  const client = new awsSdk.SecretsManagerClient({ region });
  const resp = await client.send(new awsSdk.GetSecretValueCommand({ SecretId: secretId }));
  if (!resp.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString`);
  }
  const parsed = JSON.parse(resp.SecretString);
  const required = ["host", "port", "dbname", "username", "password"];
  const missing = required.filter((k) => parsed[k] === undefined || parsed[k] === null || parsed[k] === "");
  if (missing.length > 0) {
    throw new Error(`Secret ${secretId} missing required fields: ${missing.join(", ")}`);
  }
  parsed.port = Number.parseInt(parsed.port, 10);
  return parsed;
}

async function fetchQuote(inputMint, outputMint, amountAtomic) {
  const url = buildQuoteUrl(inputMint, outputMint, amountAtomic);
  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Jupiter quote failed (${resp.status}): ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  if (!data.outAmount) {
    throw new Error(`Jupiter response missing outAmount: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function computeTickFields(solToUsdcQuote, usdcToSolQuote) {
  const usdcOut = toFloatAmount(solToUsdcQuote.outAmount, CONFIG.quoteDecimals);
  const solIn = toFloatAmount(CONFIG.solAmountAtomic, CONFIG.baseDecimals);
  const bidPrice = usdcOut / solIn;

  const usdcIn = toFloatAmount(CONFIG.usdcNotionalAtomic, CONFIG.quoteDecimals);
  const solOut = toFloatAmount(usdcToSolQuote.outAmount, CONFIG.baseDecimals);
  const askPrice = usdcIn / solOut;

  const midPrice = (bidPrice + askPrice) / 2;
  const spreadBpsRaw = ((askPrice - bidPrice) / midPrice) * 10000;
  const spreadBps = Math.max(0, Math.round(spreadBpsRaw));

  return {
    bidPrice: bidPrice.toFixed(8),
    askPrice: askPrice.toFixed(8),
    midPrice: midPrice.toFixed(8),
    spreadBps
  };
}

async function insertTick(pool, tick) {
  const query = `
    INSERT INTO market_ticks
      (symbol, bid_price, ask_price, mid_price, spread_bps, event_at)
    VALUES
      ($1, $2, $3, $4, $5, $6)
  `;
  await pool.query(query, [
    CONFIG.symbol,
    tick.bidPrice,
    tick.askPrice,
    tick.midPrice,
    tick.spreadBps,
    tick.eventAt
  ]);
}

async function runOnce(pool) {
  const [solToUsdc, usdcToSol] = await Promise.all([
    fetchQuote(CONFIG.inputMint, CONFIG.outputMint, CONFIG.solAmountAtomic),
    fetchQuote(CONFIG.outputMint, CONFIG.inputMint, CONFIG.usdcNotionalAtomic)
  ]);

  const prices = computeTickFields(solToUsdc, usdcToSol);
  const tick = {
    ...prices,
    eventAt: new Date().toISOString()
  };

  await insertTick(pool, tick);
  console.log(
    `[${tick.eventAt}] ${CONFIG.symbol} bid=${tick.bidPrice} ask=${tick.askPrice} mid=${tick.midPrice} spread_bps=${tick.spreadBps}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const runOnceOnly = process.argv.includes("--once");
  const pool = await getDbPool();

  await pool.query("SELECT 1");
  console.log("Connected to PostgreSQL. Starting Jupiter ingestion...");

  if (runOnceOnly) {
    await runOnce(pool);
    await pool.end();
    return;
  }

  while (true) {
    const started = Date.now();
    try {
      await runOnce(pool);
    } catch (err) {
      console.error(`Tick ingestion failed: ${err.message}`);
    }
    const elapsed = Date.now() - started;
    await sleep(Math.max(0, CONFIG.pollIntervalMs - elapsed));
  }
}

async function shutdown() {
  try {
    if (dbPool) await dbPool.end();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
