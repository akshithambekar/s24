# Remaining Work — Solana Autopilot

> Status as of 2026-02-14 (evening). Covers Phases 3-5 from PROJECT_SPEC.md.

## What's Done

| Component | Status |
|-----------|--------|
| CloudFormation (EC2 + RDS + Secrets Manager + CloudWatch) | Done |
| DB schema (9 tables, indexes, constraints) | Done |
| OpenClaw bootstrap (model config, system prompt, skills install) | Done |
| 4 custom skills deployed to EC2 | Done |
| Paper trade CLI (`propose-order.js`) with embedded risk checks | Done |
| Devnet smoke test (`smoke-test.sh`) | Done |
| Market data adapter as systemd service on EC2 | Done — ticks flowing every 10s |
| Jupiter API key in Secrets Manager + IAM policy | Done |
| Status API on :3001 (health, kill switch, portfolio summary, logs) | Done |
| Risk policy spec (`strategy-risk` branch) | Done |
| SSM access, port forwarding, health checks | Done |
| System prompt with Trading API instructions | Done |
| Bootstrap.sh updated (7-step, includes market data adapter) | Done |
| Process supervision watchdog (systemd timer, 60s) | Done — deployed on EC2 |
| Deployment validation script (8 checks, all passing) | Done |

## What's Missing

| Component | Status |
|-----------|--------|
| Full Trading API (`/v1/*` per API_CONTRACT.md) | Not started |
| Trade cycle orchestrator (`POST /v1/trade/cycle`) | Not started |
| Strategy engine (autonomous signal generation) | Not started |
| Standalone risk engine service | Embedded in propose-order.js only |
| Web UI (deploy, configure, monitor) | Not started |
| Authentication/authorization | Not started |
| Tests | Not started |

---

## Person 1 — Infra / OpenClaw Runtime

Owner: Infrastructure, OpenClaw orchestration, deployment pipeline.

### P1.1 Deploy market data adapter as a systemd service — DONE
- Created `scripts/deploy-market-data.sh` (follows `deploy-api.sh` heredoc pattern)
- Deployed `ingest-jupiter-ticks.js` + `package.json` to `/home/ubuntu/market-data-adapter/`
- systemd user service `market-data-adapter.service` enabled and running
- Jupiter API key stored in Secrets Manager (`solana-autopilot-infra/jupiter-api-key`), IAM policy updated (v3)
- Adapter loads API key at startup, sends `x-api-key` header on all Jupiter requests
- Fixed bid/ask inversion (`Math.min/max` normalization) for DB `ask_price >= bid_price` constraint
- **Exit criteria met**: ticks flowing every 10s, latest tick <15s old
- Node path: `/home/ubuntu/.nvm/versions/node/v22.22.0/bin/node` (exact, not glob)

### P1.2 Add market data adapter to bootstrap.sh — DONE
- bootstrap.sh renumbered from 6 to 7 steps
- New step `[6/7]` copies adapter from repo, npm installs, creates systemd service, starts it
- Runs after RDS credentials (step 5/7), before gateway restart (step 7/7)

### P1.3 OpenClaw orchestration hooks — DONE
- System prompt (`clawd/system.md`) updated with Trading API Integration section
- Documents `/v1/trade/cycle`, `/v1/bot/status`, `/v1/portfolio/snapshots` endpoints with curl examples
- Notes 423 (kill switch) and 409 (duplicate) responses
- Fallback: agent can still use `propose-order.js` for manual trades
- **Remaining**: test end-to-end once Person 2 builds `/v1/trade/cycle`

### P1.4 Process supervision and recovery — DONE
- Created `scripts/deploy-watchdog.sh`, deployed to EC2
- `check-services.sh` monitors gateway (:18789), API (:3001), market-data-adapter
- Auto-restarts any crashed service
- Pushes `HealthyServices` and `ServiceRestarts` CloudWatch metrics
- systemd timer fires every 60s, log at `/home/ubuntu/watchdog/watchdog.log`
- Log auto-trimmed at 5000 lines

### P1.5 Deployment validation script — DONE
- Created `scripts/validate-deployment.sh`, all 8 checks passing on EC2:
  1. Gateway listening on :18789 — PASS
  2. API listening on :3001 — PASS
  3. Market data adapter running — PASS
  4. Skills installed (4 found) — PASS
  5. DB connectivity — PASS
  6. Table count (9 tables) — PASS
  7. Market data fresh (2s old) — PASS
  8. Trading config (paper_mode=True) — PASS

---

## Person 2 — Backend / Trading API

Owner: Full Trading API service, market data integration, paper execution.

### P2.1 Build the full `/v1/*` Trading API
Extend or replace the existing Status API (`deploy-api.sh`) to implement all endpoints from `API_CONTRACT.md`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/health` | GET | Service + dependency health (DB, market data staleness) |
| `/v1/bot/status` | GET | Mode, state, kill switch, last cycle, last tick, staleness |
| `/v1/trade/cycle` | POST | Trigger one strategy→risk→execution cycle (idempotent) |
| `/v1/orders` | GET | Order history with cursor pagination, filters (symbol, status, from/to) |
| `/v1/fills` | GET | Fill history with cursor pagination, filters |
| `/v1/positions` | GET | Current positions with optional symbol filter |
| `/v1/portfolio/snapshots` | GET | NAV/PnL timeline with cursor pagination |
| `/v1/risk/events` | GET | Risk audit trail with cursor pagination |
| `/v1/kill-switch` | POST | Toggle kill switch (writes kill_switch_events) |
| `/v1/kill-switch` | GET | Current state + recent events |
| `/v1/devnet/smoke-runs` | GET | Smoke test history with cursor pagination |

Requirements:
- Cursor pagination on all list endpoints (default 50, max 200)
- `from`/`to` ISO-8601 date filters
- Standard error shape from API_CONTRACT.md section 3
- Decimal values serialized as strings (no float drift)
- `Authorization: Bearer <token>` header (can use gateway token for now)
- `X-Request-Id` echo
- Idempotency on `POST /v1/trade/cycle` via `idempotency_key`

### P2.2 Implement `POST /v1/trade/cycle` orchestrator
This is the core endpoint that chains the full pipeline:
1. Check kill switch → 423 if active
2. Check idempotency_key → 409 if duplicate
3. Fetch latest market tick → error if stale (>30s per risk policy)
4. Call Person 3's strategy engine to generate signal
5. Insert signal row
6. Create order with status `proposed`
7. Call Person 3's risk engine to approve/reject
8. If rejected: update order, insert risk_event, return result
9. If approved: simulate fill, upsert position, capture snapshot
10. Return cycle result with cycle_id, order_id, fill details

### P2.3 Integrate risk policy values from `strategy-risk` branch
Update `trading-config.json` defaults and `propose-order.js` to use Person 3's tighter limits:
- Max single order: 1 SOL (not $1000 USD)
- Max exposure: 3 SOL
- Staleness: 30s (not 60s)
- Cooldown: 60s
- Min confidence: 0.7
- Max daily loss: 0.5 SOL
- Auto kill switch on 1 SOL drawdown

### P2.4 Background scheduler
- Node.js scheduler (setInterval or node-cron) that auto-triggers trade cycles
- Configurable interval (default: every 60s)
- Respects kill switch (skips cycle if active)
- Logs each cycle attempt and result
- Can be enabled/disabled via API

### P2.5 Deploy updated API to EC2
- Update `deploy-api.sh` with the full Trading API
- Restart the service
- Verify all `/v1/*` endpoints respond correctly

---

## Person 3 — Strategy / Risk Engine

Owner: Strategy engine, risk engine, kill switch logic.

### P3.1 Build standalone strategy engine module
Create `src/strategy/engine.js` (or integrate into Trading API):
- Read latest N market ticks from `market_ticks` table
- Implement at least one strategy (momentum):
  - If price moved >2% in last 5 minutes → signal in that direction
  - Confidence = magnitude of move / threshold (capped at 1.0)
  - If spread > 50bps → reduce confidence by 0.2
- Output: `{ symbol, side, qty, confidence, reason }`
- Write signal to `signals` table
- Configurable parameters: lookback window, threshold %, confidence multiplier

### P3.2 Build standalone risk engine module
Create `src/risk/engine.js` (or integrate into Trading API):
- Accept order intent, return `APPROVED` or `REJECTED` with reason
- Implement all checks from `docs/risk_policy.md`:

| Check | Rule | Action |
|-------|------|--------|
| Kill switch | `kill_switch_active == true` | Reject: `KILL_SWITCH_ACTIVE` |
| Confidence | `confidence < 0.7` | Reject: `LOW_CONFIDENCE` |
| Staleness | `latest tick age > 30s` | Reject: `STALE_MARKET_DATA` |
| Order size | `qty * price > 1 SOL equivalent` | Reject: `MAX_ORDER_SIZE` |
| Position limit | `total exposure > 3 SOL` | Reject: `MAX_POSITION_NOTIONAL` |
| Position count | `open positions > 3` | Reject: `MAX_OPEN_POSITIONS` |
| Daily loss | `daily loss > 0.5 SOL` | Reject: `MAX_DAILY_LOSS` |
| Drawdown | `NAV < 9 SOL (starting 10)` | Reject + auto kill switch: `MAX_DRAWDOWN` |
| Cooldown | `last order < 60s ago` | Reject: `COOLDOWN_ACTIVE` |
| Hourly cap | `orders this hour > 10` | Reject: `MAX_HOURLY_TRADES` |
| Daily cap | `orders today > 50` | Reject: `MAX_DAILY_TRADES` |

- Write all decisions to `risk_events` table

### P3.3 Auto kill switch on drawdown
- After every fill, check if NAV has dropped below drawdown threshold (starting NAV - max drawdown)
- If breached: auto-activate kill switch, insert `kill_switch_events` row with reason `AUTO_DRAWDOWN`
- Log to CloudWatch

### P3.4 Anomaly detection
- After each market tick ingested, check for >5% price move in <60s
- If detected: log warning, recommend kill switch activation (insert risk_event with action `warned`)
- Optionally auto-activate kill switch on extreme moves (>10% in 60s)

### P3.5 Risk management API endpoints
Provide to Person 2 for integration into the Trading API:
- `GET /v1/risk/policy` — current limits
- `PUT /v1/risk/policy` — update limits dynamically
- `GET /v1/strategy/config` — current strategy parameters
- `PUT /v1/strategy/config` — update strategy parameters

### P3.6 Safety tests
Write and execute tests proving:
- [ ] Kill switch blocks all trades immediately
- [ ] Oversized orders are rejected
- [ ] Position limit blocks new trades when reached
- [ ] Drawdown triggers auto kill switch
- [ ] Cooldown is enforced
- [ ] Low-confidence signals are rejected
- [ ] Stale market data blocks trades
- [ ] No order reaches execution without passing risk engine

---

## Person 4 — UI / Product

Owner: Standalone web UI, user workflows, demo.

### P4.1 Project scaffolding
- Set up React (or Next.js) app in `ui/` directory
- Configure build tooling (Vite or Next.js)
- Add Tailwind CSS or similar for styling
- Set up API client that hits the `/v1/*` Trading API

### P4.2 Authentication page
- Login form (can be simple token-based for hackathon scope)
- Store gateway token in session
- Redirect to dashboard on success

### P4.3 Deploy page
- Form to trigger OpenClaw instance deployment (or show status if already deployed)
- Show deployment status transitions: deploying → bootstrapping → healthy
- Display instance details: instance ID, region, model, gateway URL

### P4.4 Dashboard — Portfolio overview
- Current NAV, cash, total unrealized PnL (from `GET /v1/portfolio/snapshots`)
- NAV chart over time (line chart from snapshot history)
- Current positions table (from `GET /v1/positions`):
  - Symbol, qty, avg entry, mark price, unrealized PnL
- Daily PnL summary

### P4.5 Dashboard — Trade history
- Recent orders table (from `GET /v1/orders`):
  - Time, symbol, side, qty, status, risk reason
  - Filter by status (proposed/approved/rejected/executed)
- Recent fills table (from `GET /v1/fills`):
  - Time, symbol, side, qty, fill price, fee, slippage
- Pagination using cursor from API

### P4.6 Dashboard — Bot controls
- Bot status indicator (running/stopped/error) from `GET /v1/bot/status`
- Kill switch toggle button with confirmation dialog
  - Shows current state + recent events
  - Calls `POST /v1/kill-switch`
- Manual trade cycle trigger button
  - Calls `POST /v1/trade/cycle`
  - Shows result inline (approved/rejected with details)
- Strategy configuration panel (if P3.5 API is ready):
  - Confidence threshold slider
  - Cooldown input
  - Position size limits

### P4.7 Dashboard — System health
- Service health indicators from `GET /v1/health`
- Market data staleness indicator
- Recent risk events table (from `GET /v1/risk/events`)
- Devnet smoke test results (from `GET /v1/devnet/smoke-runs`)
- Gateway logs viewer (from existing `/api/deploy/logs`)

### P4.8 Deploy UI to EC2
- Build static assets
- Serve from the API server (Express static middleware) or nginx
- Accessible via the port-forwarded gateway URL

### P4.9 Demo script
- Write step-by-step demo runbook:
  1. Open UI → show login
  2. Show deployed instance status
  3. Show live market data flowing
  4. Trigger a trade cycle → show order appear in history
  5. Show portfolio update
  6. Activate kill switch → show trades blocked
  7. Deactivate → resume trading
  8. Run devnet smoke test
- Record demo video or prepare live walkthrough

---

## Dependencies

```
P1.1 (market data service)  ──→  P2.2 (trade cycle needs fresh ticks)
P2.1 (Trading API)          ──→  P4.4-P4.7 (UI calls /v1/* endpoints)
P3.1 (strategy engine)      ──→  P2.2 (trade cycle calls strategy)
P3.2 (risk engine)          ──→  P2.2 (trade cycle calls risk checks)
P2.2 (trade cycle)          ──→  P1.3 (OpenClaw hooks call the API)
P2.1 (Trading API)          ──→  P3.5 (risk/strategy config endpoints)
P2.5 (deploy API)           ──→  P4.8 (UI needs live backend)
```

### Suggested Parallel Work Order

**DONE (Person 1 infra complete):**
- ~~P1.1 — Deploy market data adapter~~ DONE
- ~~P1.2 — Add to bootstrap.sh~~ DONE
- ~~P1.3 — OpenClaw orchestration hooks~~ DONE (system prompt ready, pending P2 API)
- ~~P1.4 — Process supervision~~ DONE
- ~~P1.5 — Validation script~~ DONE

**Immediate (can start now, no dependencies):**
- P3.1 — Build strategy engine module
- P3.2 — Build risk engine module
- P4.1 — Scaffold UI project

**Next (needs P3.1, P3.2):**
- P2.1 — Build full Trading API
- P2.2 — Build trade cycle orchestrator
- P4.2-P4.3 — Auth + deploy pages

**Then (needs P2.1):**
- P2.4 — Background scheduler
- P4.4-P4.7 — Dashboard pages

**Finally (needs everything above):**
- P2.5 — Deploy updated API
- P3.6 — Safety tests
- P4.8-P4.9 — Deploy UI, demo script
