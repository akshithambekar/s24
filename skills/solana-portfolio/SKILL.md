---
name: solana-portfolio
description: Portfolio queries, position tracking, and PnL reporting for Solana paper trading
requires: curl, jq, psql
---

# Solana Portfolio Skill

## Overview

This skill provides portfolio visibility -- current positions, trade history, PnL tracking, and NAV timeline. All data comes from the paper-trading system's Status API (`http://127.0.0.1:3001`) and direct PostgreSQL queries against the trading database. Everything runs inline; no helper scripts are needed.

> **Important:** All data surfaced by this skill is paper trading data, not real positions or real funds.

---

## Quick Portfolio Summary

For a fast top-level view, hit the Status API. This returns the latest NAV, cash balance, realized and unrealized PnL, and current positions in a single call.

```bash
exec curl -s http://127.0.0.1:3001/api/portfolio/summary | jq .
```

The response shape follows the `/v1/portfolio/snapshots` and `/v1/positions` contract (see `API_CONTRACT.md` sections 5.6 and 5.7). Decimal values (`nav`, `qty`, `pnl`, etc.) are returned as strings to avoid floating-point drift.

---

## DB Connection Setup

All deeper queries run through `psql`. Build the connection string from the shared credentials file:

```bash
CREDS=$(cat ~/.openclaw/db-credentials.json)
export PGPASSWORD=$(echo $CREDS | jq -r .password)
PSQL="psql -h $(echo $CREDS | jq -r .host) -p $(echo $CREDS | jq -r .port) -U $(echo $CREDS | jq -r .username) -d $(echo $CREDS | jq -r .database)"
```

After running the block above, use `$PSQL -c "<SQL>"` for every query below.

---

## Deeper Queries

All queries below target the tables defined in `DB_SCHEMA.md`. Run each with `$PSQL -c "..."`.

### Current Positions

Show every open position with its mark price and unrealized PnL.

Table: `positions` (PK: `symbol`)

```sql
SELECT symbol,
       qty,
       avg_entry_price,
       mark_price,
       unrealized_pnl,
       updated_at
  FROM positions
 ORDER BY symbol;
```

### Recent Fills by Symbol

Retrieve the last 20 simulated executions for a given trading pair. Replace `<SYMBOL>` with the pair name (e.g. `SOL-USDC`).

Table: `fills` (PK: `fill_id`, FK: `order_id -> orders`)

```sql
SELECT fill_id,
       symbol,
       side,
       qty,
       fill_price,
       fee,
       slippage_bps,
       filled_at
  FROM fills
 WHERE symbol = '<SYMBOL>'
 ORDER BY filled_at DESC
 LIMIT 20;
```

### Orders by Status

List orders filtered by their lifecycle status. Replace `<STATUS>` with one of: `proposed`, `approved`, `rejected`, `executed`, `canceled`.

Table: `orders` (PK: `order_id`, FK: `signal_id -> signals`)

```sql
SELECT order_id,
       symbol,
       side,
       qty,
       status,
       risk_reason,
       created_at
  FROM orders
 WHERE status = '<STATUS>'
 ORDER BY created_at DESC
 LIMIT 20;
```

### NAV Timeline

Fetch the most recent 50 portfolio snapshots for charting NAV over time.

Table: `portfolio_snapshots` (PK: `snapshot_id`)

```sql
SELECT snapshot_id,
       nav,
       cash,
       realized_pnl,
       unrealized_pnl,
       captured_at
  FROM portfolio_snapshots
 ORDER BY captured_at DESC
 LIMIT 50;
```

### Daily PnL

Compute realized PnL per day from fill records over the last 7 days.

Tables: `fills`, `positions`

```sql
SELECT DATE(filled_at) AS day,
       SUM(
         (fill_price - (SELECT avg_entry_price
                          FROM positions
                         WHERE positions.symbol = fills.symbol))
         * qty
         * CASE WHEN side = 'sell' THEN 1 ELSE -1 END
       ) AS realized_pnl
  FROM fills
 GROUP BY DATE(filled_at)
 ORDER BY day DESC
 LIMIT 7;
```

---

## Presentation Rules

When displaying results to the user, follow these formatting rules:

- **USD values**: format to 2 decimal places (e.g. `$10,002.75`).
- **Token quantities**: format to 6 decimal places (e.g. `2.500000 SOL`).
- **Multi-row results**: render as a table (markdown or aligned columns).
- **Time-series data**: include a trend summary line (e.g. "NAV up 2.3% over last 24h" or "Realized PnL down $4.12 day-over-day").
- **Paper trading disclaimer**: always note that this is paper trading data, not real positions or real funds.
