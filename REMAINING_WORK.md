# Remaining Work — Solana Autopilot

> Status as of 2026-02-14 (latest). Covers Phases 3-5 from PROJECT_SPEC.md.

## What's Done

| Component                                                          | Status                         |
| ------------------------------------------------------------------ | ------------------------------ |
| CloudFormation (EC2 + RDS + Secrets Manager + CloudWatch)          | Done                           |
| DB schema (9 tables, indexes, constraints)                         | Done                           |
| OpenClaw bootstrap (model config, system prompt, skills install)   | Done                           |
| 4 custom skills deployed to EC2                                    | Done                           |
| Paper trade CLI (`propose-order.js`) with embedded risk checks     | Done                           |
| Devnet smoke test (`smoke-test.sh`)                                | Done                           |
| Market data adapter as systemd service on EC2                      | Done — ticks flowing every 10s |
| Jupiter API key in Secrets Manager + IAM policy                    | Done                           |
| Status API on :3001 (health, kill switch, portfolio summary, logs) | Done                           |
| Risk policy spec (`strategy-risk` branch)                          | Done                           |
| SSM access, port forwarding, health checks                         | Done                           |
| System prompt with Trading API instructions                        | Done                           |
| Bootstrap.sh updated (7-step, includes market data adapter)        | Done                           |
| Process supervision watchdog (systemd timer, 60s)                  | Done — deployed on EC2         |
| Deployment validation script (8 checks, all passing)               | Done                           |

## What's Missing

| Component                                               | Status                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Full Trading API (`/v1/*`)                              | **Deployed to EC2** (2026-02-14)                                                       |
| Trade cycle orchestrator (`POST /v1/trade/cycle`)       | **Deployed to EC2** (inline risk engine, 2026-02-14)                                   |
| Kill switch endpoints (`GET/POST /v1/kill-switch`)      | **Deployed to EC2**                                                                    |
| Risk events endpoint (`GET /v1/risk/events`)            | **Deployed to EC2**                                                                    |
| Background scheduler (auto-trigger cycles)              | **Deployed to EC2** (setInterval, kill switch aware, API-controlled)                   |
| Dynamic risk policy config (`GET/PUT /v1/risk/policy`)  | **Deployed to EC2**                                                                    |
| Dynamic strategy config (`GET/PUT /v1/strategy/config`) | **Deployed to EC2**                                                                    |
| Strategy engine (autonomous signal generation)          | **Out of scope** — only OpenClaw proposes trades; no standalone engine needed          |
| Anomaly detection (>5% price move auto-kill)            | **Deployed to EC2** (`GET/POST /v1/risk/anomaly-detection`)                            |
| Web UI (deploy, configure, monitor)                     | Not started                                                                            |
| Authentication/authorization                            | Not started                                                                            |
| Safety tests                                            | Not started                                                                            |

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

### P2.1 Build the full `/v1/*` Trading API — DONE

All 11 endpoints implemented in `deploy-api.sh` (~1465 lines):

- `/v1/health`, `/v1/bot/status`, `/v1/trade/cycle`, `/v1/orders`, `/v1/fills`, `/v1/positions`, `/v1/portfolio/snapshots`, `/v1/risk/events`, `/v1/kill-switch` (GET+POST), `/v1/devnet/smoke-runs`
- Cursor pagination (base64-encoded `{t,id}` cursors, default 50, max 200)
- `from`/`to` ISO-8601 date filters on all list endpoints
- Standard error shape (`{ error: { code, message, details } }`)
- `X-Request-Id` echo middleware
- Idempotency on `POST /v1/trade/cycle` via `idempotency_key` (DB-backed)
- Legacy `/api/deploy/*` endpoints retained for backward compatibility
- **Note**: `ExecStart` glob in systemd unit needs fix (`v22.*` → `v22.22.0`)

### P2.2 Implement `POST /v1/trade/cycle` orchestrator — DONE

Full pipeline implemented inline in `deploy-api.sh`:

1. Kill switch check → 423
2. Idempotency key check → 409 on duplicate (DB-backed reservation)
3. Market data staleness check (30s stale, 120s auto-kill)
4. Auto kill switch on prolonged stale data (>120s)
5. Strategy: accepts `proposal` object from caller (side, qty_sol, confidence, price_movement_5m_pct)
6. Signal + order insertion in transaction
7. Full risk engine (11 rules) evaluates inline
8. If rejected: order status=rejected, risk_event logged, 409 RISK_BLOCKED
9. If approved: simulated fill, position upsert (weighted avg entry), portfolio snapshot
10. Returns cycle_id, order_id, fill_id, status

### P2.3 Integrate risk policy values — DONE

`RISK_POLICY` object embedded in server.js with all spec values:

- `maxSingleOrderSol: 1`, `maxOpenExposureSol: 3`, `maxOpenPositions: 3`
- `maxDrawdownSol: 1`, `maxLossPerTradeSol: 0.3`, `maxDailyLossSol: 0.5`
- `cooldownSeconds: 60`, `maxTradesPerHour: 10`, `maxTradesPerDay: 50`
- `minConfidence: 0.7`, `minPriceMovePct5m: 2`
- `simulatedSlippagePct: 0.003`, `simulatedFeePct: 0.001`
- Auto kill switch on drawdown (NAV drops 1 SOL below starting 10 SOL)

### P2.4 Background scheduler — DONE

Implemented in `deploy-api.sh` (server.js heredoc):

- `schedulerState` object tracks enabled, intervalMs, lastTriggeredAt, lastResult, cycleCount, timer
- `runScheduledCycle()` — checks kill switch via `getTradingConfig()`, makes internal HTTP `POST /v1/trade/cycle` with `trigger_source: 'scheduler'`
- `startScheduler()` / `stopScheduler()` — manage `setInterval` timer, clean lifecycle (no leaked timers)
- `GET /v1/scheduler/status` — returns current scheduler state
- `POST /v1/scheduler/control` — accepts `{ enabled: bool, interval_ms?: number }` to start/stop scheduler
- Auto-start on boot if `SCHEDULER_ENABLED=true` env var is set
- Scheduler disabled by default (safe)
- Uses `setInterval` — no new npm dependencies
- Minimum interval enforced at 5000ms

### P2.5 Deploy updated API to EC2 — DONE (deployed 2026-02-14)

- `deploy-api.sh` deployed via SSM `send-command` (S3 presigned URL staging)
- API confirmed listening on `:3001` (PID 29920)
- All `/v1/*` endpoints + `/v1/scheduler/*` endpoints live
- Includes risk/policy, strategy/config, and anomaly detection endpoints

---

## Person 3 — Strategy / Risk Engine

Owner: Strategy engine, risk engine, kill switch logic.

### P3.1 Build standalone strategy engine module — CANCELLED (out of scope)

**Product decision: only OpenClaw proposes trades.** The trade cycle accepts a `proposal` from the caller (OpenClaw); no autonomous signal generation is required. A standalone strategy engine was previously considered for scheduler-driven trading; not needed for agent-only workflow.

### P3.2 Build standalone risk engine module — DONE (embedded in Trading API)

All 11 risk checks implemented inline in `/v1/trade/cycle` handler in `deploy-api.sh`:

- `MAX_SINGLE_ORDER_SIZE` (>1 SOL)
- `MAX_TOTAL_OPEN_EXPOSURE` (>3 SOL)
- `MAX_OPEN_POSITIONS` (>3)
- `MAX_LOSS_PER_TRADE` (>0.3 SOL)
- `MAX_DAILY_LOSS` (>0.5 SOL)
- `COOLDOWN_SECONDS` (<60s since last trade)
- `MAX_TRADES_PER_HOUR` (>10)
- `MAX_TRADES_PER_DAY` (>50)
- `MIN_CONFIDENCE` (<0.7)
- `MIN_PRICE_MOVEMENT_5M` (<2%)
- Kill switch + stale market data checks handled before risk evaluation
- All decisions written to `risk_events` table

### P3.3 Auto kill switch on drawdown — DONE (embedded in Trading API)

- Checked before every trade in `/v1/trade/cycle`
- If `drawdownSol >= maxDrawdownSol` (1 SOL): auto-activates kill switch via `maybeActivateKillSwitch()`
- Writes to `kill_switch_events` with actor `risk-engine`
- Also auto-kills on prolonged stale market data (>120s)

### P3.4 Anomaly detection

- After each market tick ingested, check for >5% price move in <60s
- If detected: log warning, recommend kill switch activation (insert risk_event with action `warned`)
- Optionally auto-activate kill switch on extreme moves (>10% in 60s)

### P3.5 Risk management API endpoints — PARTIALLY DONE

Already built in `deploy-api.sh` (Person 2 overlap):

- `GET /v1/risk/events` — ✅ done (paginated, cursor-based)
- `GET /v1/kill-switch` — ✅ done (returns state + recent events)
- `POST /v1/kill-switch` — ✅ done (enable/disable with actor + reason)

Still needed:

- `GET /v1/risk/policy` — return current `RISK_POLICY` values
- `PUT /v1/risk/policy` — update limits dynamically (currently hardcoded in server.js)
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
P1.1 (market data service)  ──→  P2.2 (trade cycle needs fresh ticks)     ✅ DONE
P2.1 (Trading API)          ──→  P4.4-P4.7 (UI calls /v1/* endpoints)
P3.2 (risk engine)          ──→  P2.2 (trade cycle calls risk checks)     ✅ DONE (inline)
P2.2 (trade cycle)          ──→  P1.3 (OpenClaw hooks call the API)       ✅ DONE
P2.5 (deploy API)           ──→  P4.8 (UI needs live backend)
~~P3.1 (strategy engine)~~   — out of scope (only OpenClaw proposes trades)
```

### Suggested Parallel Work Order

**DONE:**

- ~~P1.1–P1.5~~ — All Person 1 infra tasks
- ~~P2.1~~ — Full `/v1/*` Trading API (built, needs EC2 deploy)
- ~~P2.2~~ — Trade cycle orchestrator with inline risk engine
- ~~P2.3~~ — Risk policy values integrated
- ~~P2.4~~ — Background scheduler (setInterval, kill switch aware, API-controlled)
- ~~P2.5~~ — Deploy script ready (ExecStart glob fixed, scheduler included)
- ~~P3.2~~ — Risk engine (embedded in Trading API)
- ~~P3.3~~ — Auto kill switch on drawdown (embedded in Trading API)
- ~~P3.5 (partial)~~ — Kill switch endpoints + risk events endpoint (built in `deploy-api.sh`)

**Immediate (can start now):**

- **P4.1** — Scaffold UI project

**Next (needs P2.5 deployed to EC2):**

- P3.5 (remaining) — `GET/PUT /v1/risk/policy` + `GET/PUT /v1/strategy/config` (Person 3 designs, Person 2 integrates)
- P4.2-P4.3 — Auth + deploy pages
- P4.4-P4.7 — Dashboard pages (API is ready)

**Finally:**

- P3.4 — Anomaly detection
- P3.6 — Safety tests
- P4.8-P4.9 — Deploy UI, demo script
