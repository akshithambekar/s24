# Trading API Contract (v1)

Owner: Abhi Maddi (Backend/Data)  
Status: Draft for team sign-off  

## 1. Scope

This contract defines how clients (Telegram wrapper UI, OpenClaw runtime) interact with the Trading API service for paper trading on Solana.

Execution modes:
- `paper_mode` (default)
- `devnet_smoke_mode` (operational checks)
- `live_mode` is out of scope for this phase

## 2. Conventions

- Base path: `/v1`
- Content type: `application/json`
- Auth header: `Authorization: Bearer <token>`
- Trace header: `X-Request-Id: <uuid>` (optional, echoed back)
- Time format: ISO-8601 UTC (`2026-02-14T23:59:59Z`)
- IDs: UUID v4 unless otherwise noted

## 3. Standard Error Shape

All non-2xx responses use:

```json
{
  "error": {
    "code": "RISK_BLOCKED",
    "message": "Order rejected by risk policy",
    "details": {
      "rule": "MAX_NOTIONAL_PER_ORDER",
      "limit": "1000",
      "requested": "1400"
    }
  }
}
```

Common error codes:
- `UNAUTHORIZED`
- `FORBIDDEN`
- `BAD_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `STALE_MARKET_DATA`
- `RISK_BLOCKED`
- `KILL_SWITCH_ACTIVE`
- `INTERNAL_ERROR`

## 4. Pagination and Filters

Cursor pagination for list endpoints:
- Query: `limit` (default 50, max 200), `cursor` (opaque)
- Response:

```json
{
  "items": [],
  "next_cursor": "eyJpZCI6ICIuLi4ifQ=="
}
```

Common filters:
- `from` / `to` (ISO-8601 UTC)
- `symbol` (example: `SOL-USDC`)
- `status` where applicable

## 5. Endpoints

### 5.1 Health

`GET /v1/health`

Purpose: service and dependencies health probe.

Response `200`:

```json
{
  "status": "ok",
  "service": "trading-api",
  "time": "2026-02-14T18:00:00Z",
  "dependencies": {
    "db": "ok",
    "market_data": "ok"
  }
}
```

### 5.2 Bot Status

`GET /v1/bot/status`

Purpose: current runtime state for UI/OpenClaw.

Response `200`:

```json
{
  "mode": "paper_mode",
  "state": "running",
  "kill_switch": false,
  "last_cycle_at": "2026-02-14T17:59:12Z",
  "last_tick_at": "2026-02-14T17:59:58Z",
  "market_data_stale": false
}
```

### 5.3 Trigger Trade Cycle

`POST /v1/trade/cycle`

Purpose: OpenClaw/manual trigger for one strategy-risk-execution cycle.

Request body:

```json
{
  "trigger_source": "openclaw",
  "idempotency_key": "9f1d84a3-2a28-431f-bf03-6f5b6d1de4b1",
  "symbol": "SOL-USDC"
}
```

Response `202`:

```json
{
  "cycle_id": "8f38f156-2929-4d36-9722-2c1760d7b1ee",
  "accepted": true,
  "queued_at": "2026-02-14T18:00:01Z"
}
```

Errors:
- `409 CONFLICT` with `code=CONFLICT` for duplicate `idempotency_key`
- `423` with `code=KILL_SWITCH_ACTIVE`

### 5.4 Orders

`GET /v1/orders?limit=50&cursor=...&from=...&to=...&symbol=SOL-USDC&status=approved`

Purpose: order intent and approval state history.

Order status enum:
- `proposed`
- `approved`
- `rejected`
- `executed`
- `canceled`

Response `200`:

```json
{
  "items": [
    {
      "order_id": "ccf38611-f4e7-4060-a9ca-7d524e4f913d",
      "cycle_id": "8f38f156-2929-4d36-9722-2c1760d7b1ee",
      "symbol": "SOL-USDC",
      "side": "buy",
      "qty": "2.500000",
      "limit_price": "112.25",
      "status": "approved",
      "risk_reason": null,
      "created_at": "2026-02-14T18:00:02Z"
    }
  ],
  "next_cursor": null
}
```

### 5.5 Fills

`GET /v1/fills?limit=50&cursor=...&from=...&to=...&symbol=SOL-USDC`

Purpose: simulated execution records.

Response `200`:

```json
{
  "items": [
    {
      "fill_id": "550f9329-16cd-49ba-b5dc-338f84fb5584",
      "order_id": "ccf38611-f4e7-4060-a9ca-7d524e4f913d",
      "symbol": "SOL-USDC",
      "side": "buy",
      "qty": "2.500000",
      "fill_price": "112.30",
      "fee": "0.28",
      "slippage_bps": 4,
      "filled_at": "2026-02-14T18:00:03Z"
    }
  ],
  "next_cursor": null
}
```

### 5.6 Positions

`GET /v1/positions?symbol=SOL-USDC`

Purpose: current net exposure by pair.

Response `200`:

```json
{
  "items": [
    {
      "symbol": "SOL-USDC",
      "qty": "5.000000",
      "avg_entry_price": "111.85",
      "mark_price": "112.40",
      "unrealized_pnl": "2.75",
      "updated_at": "2026-02-14T18:00:04Z"
    }
  ]
}
```

### 5.7 Portfolio Snapshots

`GET /v1/portfolio/snapshots?limit=200&cursor=...&from=...&to=...`

Purpose: NAV and PnL timeline for charts.

Response `200`:

```json
{
  "items": [
    {
      "snapshot_id": "20f4ff91-b60f-4372-8785-cbf07f3be3db",
      "nav": "10002.75",
      "cash": "9438.75",
      "realized_pnl": "1.35",
      "unrealized_pnl": "1.40",
      "captured_at": "2026-02-14T18:00:05Z"
    }
  ],
  "next_cursor": null
}
```

### 5.8 Risk Events

`GET /v1/risk/events?limit=50&cursor=...&from=...&to=...`

Purpose: audit of risk blocks/alerts.

Response `200`:

```json
{
  "items": [
    {
      "risk_event_id": "d7f5e8f1-2f3d-4d42-ab2a-f10f07b26376",
      "order_id": "1ad44858-7589-46e4-b9c4-ef552268adf2",
      "action": "blocked",
      "rule": "MAX_POSITION_NOTIONAL",
      "details": {
        "limit": "5000",
        "projected": "5400"
      },
      "created_at": "2026-02-14T18:00:06Z"
    }
  ],
  "next_cursor": null
}
```

### 5.9 Kill Switch

`POST /v1/kill-switch`

Purpose: immediate global stop/start for new executions.

Request body:

```json
{
  "enabled": true,
  "reason": "Manual halt from Telegram admin command"
}
```

Response `200`:

```json
{
  "enabled": true,
  "updated_at": "2026-02-14T18:00:07Z"
}
```

### 5.10 Devnet Smoke Runs

`GET /v1/devnet/smoke-runs?limit=20&cursor=...&from=...&to=...`

Purpose: operational wallet/RPC checks (not trading PnL).

Response `200`:

```json
{
  "items": [
    {
      "run_id": "3be3f65e-c17c-4d0f-9c53-4ec1285f2e20",
      "status": "passed",
      "rpc_latency_ms": 183,
      "wallet_check": "ok",
      "tx_simulation": "ok",
      "ran_at": "2026-02-14T18:00:08Z"
    }
  ],
  "next_cursor": null
}
```

## 6. Data Type Notes

- Decimal values are serialized as strings to avoid float drift:
  - `qty`, `price`, `fee`, `nav`, `pnl` fields
- `symbol` format: `<BASE>-<QUOTE>` (example `SOL-USDC`)
- `side` enum: `buy | sell`

## 7. Idempotency

For mutating calls (`POST /v1/trade/cycle`, `POST /v1/kill-switch`), client should send:
- `idempotency_key` in body for cycle trigger
- optional `X-Request-Id` header for traceability

Duplicate writes must return existing result or `409 CONFLICT`.

## 8. Open Questions for Team Sign-Off

- Final auth provider/token format for `Authorization` header.
- Whether `POST /v1/kill-switch` should be admin-only scope with separate role claims.
- Polling interval recommendations for Telegram/UI clients.
