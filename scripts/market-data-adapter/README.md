# Jupiter Market Data Adapter

Writes live SOL-USDC ticks into `market_ticks` in PostgreSQL.

## Install

```bash
cd /Users/abhimaddi/Downloads/x402-layer-1/github_clone/s24/scripts/market-data-adapter
npm install
```

## Run (single tick)

```bash
DATABASE_URL="postgresql://user:pass@host:5432/solana_autopilot?sslmode=require" npm run once
```

## Run (continuous)

```bash
DATABASE_URL="postgresql://user:pass@host:5432/solana_autopilot?sslmode=require" npm start
```

## Environment Variables

- `DATABASE_URL`: preferred DB connection string
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`: DB connection fallback
- `DB_SECRET_ID`: Secrets Manager secret fallback (default: `solana-autopilot-infra/db-credentials`)
- `AWS_REGION`: Secrets Manager region (default: `us-east-1`)
- `POLL_INTERVAL_MS`: loop interval (default: `10000`)
- `JUPITER_QUOTE_URL`: quote endpoint (default: `https://api.jup.ag/swap/v1/quote`)
- `SYMBOL`: stored symbol label (default: `SOL-USDC`)
- `SOL_AMOUNT_ATOMIC`: SOL input for bid quote (default: `1000000000` = 1 SOL)
- `USDC_NOTIONAL_ATOMIC`: USDC input for ask quote (default: `100000000` = 100 USDC)

## Output

Each loop writes:

- `symbol`
- `bid_price`
- `ask_price`
- `mid_price`
- `spread_bps`
- `event_at`
