#!/usr/bin/env node
'use strict';

const { Client } = require('pg');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Token mint address map
// ---------------------------------------------------------------------------
const MINT_MAP = {
  SOL:  'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP:  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  RAY:  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: propose-order.js --symbol <PAIR> --side <buy|sell> --qty <decimal> [--limit-price <decimal>]

Arguments:
  --symbol        Trading pair, e.g. SOL-USDC
  --side          Order side: buy or sell
  --qty           Order quantity (decimal)
  --limit-price   Optional limit price (decimal)
  --help          Show this help message

Example:
  node propose-order.js --symbol SOL-USDC --side buy --qty 1.5
  node propose-order.js --symbol BONK-USDC --side sell --qty 100000 --limit-price 0.00002`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--symbol' && argv[i + 1]) {
      args.symbol = argv[++i];
    } else if (arg === '--side' && argv[i + 1]) {
      args.side = argv[++i].toLowerCase();
    } else if (arg === '--qty' && argv[i + 1]) {
      args.qty = parseFloat(argv[++i]);
    } else if (arg === '--limit-price' && argv[i + 1]) {
      args.limitPrice = parseFloat(argv[++i]);
    }
  }
  return args;
}

function readJsonFile(filePath) {
  const resolved = filePath.replace(/^~/, process.env.HOME || '');
  const raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse JSON from ${url}: ${err.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function splitSymbol(symbol) {
  const parts = symbol.split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid symbol format "${symbol}". Expected BASE-QUOTE, e.g. SOL-USDC`);
  }
  return { base: parts[0].toUpperCase(), quote: parts[1].toUpperCase() };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Parse CLI args
  const args = parseArgs(process.argv);

  if (args.help || (!args.symbol && !args.side && args.qty === undefined)) {
    printUsage();
    process.exit(0);
  }

  if (!args.symbol) throw new Error('Missing required argument: --symbol');
  if (!args.side || !['buy', 'sell'].includes(args.side)) {
    throw new Error('Missing or invalid --side argument. Must be "buy" or "sell".');
  }
  if (args.qty === undefined || isNaN(args.qty) || args.qty <= 0) {
    throw new Error('Missing or invalid --qty argument. Must be a positive decimal.');
  }

  const { symbol, side, qty, limitPrice } = args;
  const { base, quote } = splitSymbol(symbol);

  // 2. Read DB credentials and connect
  const dbCreds = readJsonFile('~/.openclaw/db-credentials.json');
  const client = new Client({
    host: dbCreds.host,
    port: dbCreds.port,
    database: dbCreds.database,
    user: dbCreds.username,
    password: dbCreds.password,
    ssl: dbCreds.ssl !== undefined ? dbCreds.ssl : { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // 3. Read trading config
    const config = readJsonFile('~/.openclaw/trading-config.json');
    const {
      paper_mode,
      max_position_size_usd,
      max_daily_loss_usd,
      cooldown_seconds,
      kill_switch_active,
    } = config;

    // 4. Kill switch check
    if (kill_switch_active) {
      const err = {
        error: 'kill_switch_active',
        message: 'Trading is halted. The kill switch is currently active.',
      };
      console.log(JSON.stringify(err, null, 2));
      process.exit(1);
    }

    // 5. Fetch latest market tick
    let midPrice;
    const tickRes = await client.query(
      `SELECT mid_price, event_at
         FROM market_ticks
        WHERE symbol = $1
        ORDER BY event_at DESC
        LIMIT 1`,
      [symbol]
    );

    const now = new Date();
    if (tickRes.rows.length > 0) {
      const tickAge = (now.getTime() - new Date(tickRes.rows[0].event_at).getTime()) / 1000;
      if (tickAge <= 60) {
        midPrice = parseFloat(tickRes.rows[0].mid_price);
      }
    }

    // Fallback: fetch from Jupiter API
    if (midPrice === undefined) {
      const baseMint = MINT_MAP[base];
      const quoteMint = MINT_MAP[quote];
      if (!baseMint || !quoteMint) {
        throw new Error(`Unknown token in pair ${symbol}. Supported: ${Object.keys(MINT_MAP).join(', ')}`);
      }

      const jupUrl = `https://api.jup.ag/price/v2?ids=${baseMint},${quoteMint}`;
      const jupData = await httpsGetJson(jupUrl);

      const baseData = jupData.data && jupData.data[baseMint];
      const quoteData = jupData.data && jupData.data[quoteMint];

      if (!baseData || !baseData.price) {
        throw new Error(`Jupiter API returned no price for base token ${base} (${baseMint})`);
      }

      const basePriceUsd = parseFloat(baseData.price);
      const quotePriceUsd = quoteData && quoteData.price ? parseFloat(quoteData.price) : 1.0;

      midPrice = basePriceUsd / quotePriceUsd;

      // Insert a new market_ticks row with the fetched price
      const tickId = crypto.randomUUID();
      const spreadBps = 5; // default spread estimate
      const bidPrice = midPrice * (1 - spreadBps / 20000);
      const askPrice = midPrice * (1 + spreadBps / 20000);

      await client.query(
        `INSERT INTO market_ticks (tick_id, symbol, bid_price, ask_price, mid_price, spread_bps, event_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tickId, symbol, bidPrice, askPrice, midPrice, spreadBps, now]
      );
    }

    // 6. Insert signal
    const cycleId = crypto.randomUUID();
    const signalId = crypto.randomUUID();

    await client.query(
      `INSERT INTO signals (signal_id, cycle_id, symbol, side, confidence, strategy_payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [signalId, cycleId, symbol, side, 1.0, JSON.stringify({ source: 'cli', paper_mode })]
    );

    // 7. Insert order with status 'proposed'
    const orderId = crypto.randomUUID();

    await client.query(
      `INSERT INTO orders (order_id, cycle_id, signal_id, symbol, side, qty, limit_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orderId, cycleId, signalId, symbol, side, qty, limitPrice || null, 'proposed']
    );

    // 8. Risk checks
    let rejected = false;
    let riskReason = null;

    // 8a. Position notional check
    const posRes = await client.query(
      `SELECT qty, avg_entry_price FROM positions WHERE symbol = $1`,
      [symbol]
    );
    const currentQty = posRes.rows.length > 0 ? parseFloat(posRes.rows[0].qty) : 0;
    const orderNotional = qty * midPrice;
    const effectiveQty = side === 'buy' ? currentQty + qty : currentQty - qty;
    const positionNotional = Math.abs(effectiveQty) * midPrice;

    if (positionNotional > max_position_size_usd) {
      rejected = true;
      riskReason = `position_size_exceeded: resulting notional $${positionNotional.toFixed(2)} exceeds max $${max_position_size_usd}`;
    }

    // 8b. Daily realized loss check
    if (!rejected) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const pnlRes = await client.query(
        `SELECT COALESCE(SUM(
           CASE WHEN f.side = 'sell'
                THEN (f.fill_price - p.avg_entry_price) * f.qty - f.fee
                ELSE -f.fee
           END
         ), 0) AS daily_realized_pnl
         FROM fills f
         LEFT JOIN positions p ON p.symbol = f.symbol
         WHERE f.filled_at >= $1`,
        [todayStart]
      );

      const dailyRealizedPnl = parseFloat(pnlRes.rows[0].daily_realized_pnl);
      if (dailyRealizedPnl < 0 && Math.abs(dailyRealizedPnl) > max_daily_loss_usd) {
        rejected = true;
        riskReason = `daily_loss_exceeded: realized loss $${Math.abs(dailyRealizedPnl).toFixed(2)} exceeds max $${max_daily_loss_usd}`;
      }
    }

    // 8c. Cooldown check
    if (!rejected) {
      const cooldownRes = await client.query(
        `SELECT created_at FROM orders
         WHERE symbol = $1 AND order_id != $2
         ORDER BY created_at DESC LIMIT 1`,
        [symbol, orderId]
      );

      if (cooldownRes.rows.length > 0) {
        const lastOrderTime = new Date(cooldownRes.rows[0].created_at);
        const elapsed = (now.getTime() - lastOrderTime.getTime()) / 1000;
        if (elapsed < cooldown_seconds) {
          rejected = true;
          riskReason = `cooldown_active: ${elapsed.toFixed(1)}s since last order, requires ${cooldown_seconds}s`;
        }
      }
    }

    // 9. If rejected
    if (rejected) {
      await client.query(
        `UPDATE orders SET status = 'rejected', risk_reason = $1 WHERE order_id = $2`,
        [riskReason, orderId]
      );

      const riskEventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO risk_events (risk_event_id, order_id, action, rule, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [riskEventId, orderId, 'blocked', riskReason, JSON.stringify({ mid_price: midPrice, qty, side, symbol })]
      );

      const result = {
        status: 'rejected',
        cycle_id: cycleId,
        order_id: orderId,
        symbol,
        side,
        qty,
        mid_price: midPrice,
        risk_reason: riskReason,
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // 10. If approved
    const approveRiskEventId = crypto.randomUUID();
    await client.query(
      `INSERT INTO risk_events (risk_event_id, order_id, action, rule, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [approveRiskEventId, orderId, 'allowed', 'all_checks_passed', JSON.stringify({ mid_price: midPrice, qty, side, symbol })]
    );

    await client.query(
      `UPDATE orders SET status = 'approved' WHERE order_id = $1`,
      [orderId]
    );

    // 11. Simulate fill
    const slippageBps = Math.floor(Math.random() * 5) + 1; // 1-5 bps
    const slippageFactor = slippageBps / 10000;
    const fillPrice = side === 'buy'
      ? midPrice * (1 + slippageFactor)
      : midPrice * (1 - slippageFactor);
    const notional = qty * fillPrice;
    const fee = notional * 0.001; // 0.1%

    // 12. Insert fill
    const fillId = crypto.randomUUID();
    const filledAt = new Date();

    await client.query(
      `INSERT INTO fills (fill_id, order_id, symbol, side, qty, fill_price, fee, slippage_bps, filled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [fillId, orderId, symbol, side, qty, fillPrice, fee, slippageBps, filledAt]
    );

    // 13. Upsert position
    let newQty, newAvgEntry;

    if (posRes.rows.length > 0) {
      const oldQty = parseFloat(posRes.rows[0].qty);
      const oldAvgEntry = parseFloat(posRes.rows[0].avg_entry_price);

      if (side === 'buy') {
        newQty = oldQty + qty;
        newAvgEntry = newQty !== 0
          ? (oldAvgEntry * oldQty + fillPrice * qty) / newQty
          : 0;
      } else {
        newQty = oldQty - qty;
        newAvgEntry = oldAvgEntry; // avg entry stays the same on sell
      }
    } else {
      if (side === 'buy') {
        newQty = qty;
        newAvgEntry = fillPrice;
      } else {
        newQty = -qty;
        newAvgEntry = fillPrice;
      }
    }

    const unrealizedPnl = (fillPrice - newAvgEntry) * newQty;

    await client.query(
      `INSERT INTO positions (symbol, qty, avg_entry_price, mark_price, unrealized_pnl, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (symbol)
       DO UPDATE SET
         qty = $2,
         avg_entry_price = $3,
         mark_price = $4,
         unrealized_pnl = $5,
         updated_at = NOW()`,
      [symbol, newQty, newAvgEntry, fillPrice, unrealizedPnl]
    );

    // 14. Update order to executed
    await client.query(
      `UPDATE orders SET status = 'executed' WHERE order_id = $1`,
      [orderId]
    );

    // 15. Capture portfolio snapshot
    // Get cash from latest snapshot (default 10000)
    const snapRes = await client.query(
      `SELECT cash FROM portfolio_snapshots ORDER BY captured_at DESC LIMIT 1`
    );
    let cash = snapRes.rows.length > 0 ? parseFloat(snapRes.rows[0].cash) : 10000;

    // Adjust cash: buying reduces cash, selling increases cash
    if (side === 'buy') {
      cash -= notional + fee;
    } else {
      cash += notional - fee;
    }

    // Sum all position notionals
    const allPosRes = await client.query(
      `SELECT symbol, qty, mark_price, unrealized_pnl FROM positions`
    );
    let totalPositionNotional = 0;
    let totalUnrealizedPnl = 0;
    for (const row of allPosRes.rows) {
      totalPositionNotional += Math.abs(parseFloat(row.qty)) * parseFloat(row.mark_price);
      totalUnrealizedPnl += parseFloat(row.unrealized_pnl);
    }

    const nav = cash + totalPositionNotional;

    // Get today's realized PnL for the snapshot
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const realizedRes = await client.query(
      `SELECT COALESCE(SUM(
         CASE WHEN f.side = 'sell'
              THEN (f.fill_price - p.avg_entry_price) * f.qty - f.fee
              ELSE -f.fee
         END
       ), 0) AS realized_pnl
       FROM fills f
       LEFT JOIN positions p ON p.symbol = f.symbol
       WHERE f.filled_at >= $1`,
      [todayStart]
    );
    const realizedPnl = parseFloat(realizedRes.rows[0].realized_pnl);

    const snapshotId = crypto.randomUUID();
    await client.query(
      `INSERT INTO portfolio_snapshots (snapshot_id, nav, cash, realized_pnl, unrealized_pnl, captured_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [snapshotId, nav, cash, realizedPnl, totalUnrealizedPnl]
    );

    // 16. Print JSON summary
    const summary = {
      status: 'executed',
      cycle_id: cycleId,
      order_id: orderId,
      fill_id: fillId,
      symbol,
      side,
      qty,
      fill_price: parseFloat(fillPrice.toFixed(8)),
      fee: parseFloat(fee.toFixed(8)),
      slippage_bps: slippageBps,
      position: {
        qty: parseFloat(newQty.toFixed(8)),
        avg_entry: parseFloat(newAvgEntry.toFixed(8)),
        unrealized_pnl: parseFloat(unrealizedPnl.toFixed(8)),
      },
      nav: parseFloat(nav.toFixed(8)),
    };

    console.log(JSON.stringify(summary, null, 2));

  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
