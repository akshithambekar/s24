---
name: solana-paper-trader
description: Paper trading skill for Solana tokens using real-time Jupiter price data
requires:
  - node
  - curl
  - jq
---

# Solana Paper Trader

Execute simulated (paper) trades against real-time Solana market data. All trades are recorded in the PostgreSQL database with full audit trails.

## Prerequisites

- **solana-trader-v2** must be installed — it provides Jupiter price data and wallet queries.
- Database credentials at `~/.openclaw/db-credentials.json`
- Trading config at `~/.openclaw/trading-config.json`

## How to Trade

### 1. Fetch Current Price

Before proposing any trade, always fetch the current price using solana-trader-v2's Jupiter commands:

```
solana-trader-v2 price SOL-USDC
```

If solana-trader-v2 is unavailable, fall back to the Jupiter API directly:

```bash
curl -s "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
```

### 2. Execute Paper Trade

```bash
exec node {baseDir}/scripts/propose-order.js --symbol SOL-USDC --side buy --qty 1.5
```

With optional limit price:

```bash
exec node {baseDir}/scripts/propose-order.js --symbol SOL-USDC --side buy --qty 1.5 --limit-price 150.00
```

### 3. Supported Token Pairs

| Token | Mint Address |
|-------|-------------|
| SOL   | `So11111111111111111111111111111111111111112` |
| USDC  | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| BONK  | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` |
| JUP   | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` |
| RAY   | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` |

Valid symbols: `SOL-USDC`, `BONK-USDC`, `JUP-USDC`, `RAY-USDC`

## Safety Rules

1. **Always check the kill switch** before proposing a trade. If active, refuse immediately.
2. **Never bypass the risk engine.** Every order goes through position-size, daily-loss, and cooldown checks.
3. **Reject stale data.** If the latest market tick is older than 60 seconds and the Jupiter API fallback also fails, do not trade.
4. **Log everything.** The script records signals, orders, risk events, fills, and position updates atomically.

## Example Interactions

**User:** "Buy 1 SOL"
1. Fetch SOL-USDC price via solana-trader-v2
2. Run: `exec node {baseDir}/scripts/propose-order.js --symbol SOL-USDC --side buy --qty 1`
3. Report the JSON result (approved/rejected, fill price, updated position)

**User:** "Sell half my SOL position"
1. Query current SOL position from the database
2. Calculate half the current qty
3. Fetch SOL-USDC price
4. Run: `exec node {baseDir}/scripts/propose-order.js --symbol SOL-USDC --side sell --qty <half>`
5. Report the result

**User:** "Set a limit buy for 2 SOL at $140"
1. Run: `exec node {baseDir}/scripts/propose-order.js --symbol SOL-USDC --side buy --qty 2 --limit-price 140.00`
2. Report whether the order was approved or rejected by the risk engine
