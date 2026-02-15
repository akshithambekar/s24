# s24: Solana Autopilot (OpenClaw + AWS + RDS + Dashboard)
## Developed: Akshith, Abhi, Tuga, Yahya

This repository implements a **Solana paper-trading control plane** around OpenClaw:

- Live SOL-USDC market ticks are ingested from **Jupiter quote API**
- A backend trading API enforces **server-side risk policy + kill switch**
- Trades are executed in **paper mode** by default, with optional **devnet execution mode**
- State is persisted in **PostgreSQL (RDS)**
- A Next.js dashboard provides operations, risk controls, and trade/session visibility
- OpenClaw is used as the autonomous agent/orchestration layer

This project is hackathon-oriented and optimized for deploy speed and operational visibility.

## What The System Actually Does

At runtime, the system has 4 main moving parts:

1. **OpenClaw gateway on EC2**
2. **Trading API service** (Express app generated/deployed by `scripts/deploy-api.sh`, default port `3001`)
3. **Market data adapter** (Jupiter polling writer to `market_ticks`)
4. **Frontend dashboard** (`frontend/`, Next.js)

### End-to-end flow

1. Market adapter polls Jupiter and writes bid/ask/mid ticks into `market_ticks`.
2. OpenClaw or UI triggers a trade cycle (`POST /v1/trade/cycle`).
3. Trading API checks:
   - kill switch
   - market data staleness
   - anomaly conditions
   - risk policy constraints
4. If blocked, API writes `risk_events` + rejected order context.
5. If approved:
   - inserts `signals` + `orders`
   - inserts `fills`
   - updates `positions`
   - writes `portfolio_snapshots`
6. Dashboard reads API endpoints and shows status, risk, orders/fills, and portfolio.

## Architecture

```text
OpenClaw Gateway (EC2, :18789)
  ├─ agent commands / orchestration
  └─ triggered by dashboard + prompts

Trading API (EC2, :3001)
  ├─ trade cycle / risk gating / kill switch
  ├─ deploy + ops endpoints
  ├─ scheduler
  └─ reads/writes PostgreSQL + AWS Secrets Manager

Market Data Adapter
  └─ Jupiter quotes -> market_ticks table

RDS PostgreSQL
  ├─ market_ticks, signals, orders, fills
  ├─ positions, portfolio_snapshots
  ├─ risk_events, kill_switch_events
  └─ devnet_smoke_runs

Frontend (Next.js)
  ├─ /api/proxy/* -> Trading API
  ├─ /api/openclaw/* -> OpenClaw gateway RPC over WebSocket
  └─ dashboard sections (trading, history, risk)
```

## Key Backend Behavior

The Trading API is created and installed by:

- `scripts/deploy-api.sh`

### Primary API groups

- Trading core:
  - `GET /v1/health`
  - `GET /v1/bot/status`
  - `POST /v1/trade/cycle`
  - `POST /v1/trading/reset`
- Data queries:
  - `GET /v1/orders`
  - `GET /v1/fills`
  - `GET /v1/positions`
  - `GET /v1/portfolio/snapshots`
  - `GET /v1/market/ticks/recent`
- Risk + strategy controls:
  - `GET/PUT /v1/risk/policy`
  - `GET/PUT /v1/strategy/config`
  - `GET /v1/risk/events`
  - `GET /v1/risk/anomaly-detection`
  - `POST /v1/risk/anomaly-detection/check`
- Kill switch:
  - `GET /v1/kill-switch`
  - `POST /v1/kill-switch`
- Scheduler:
  - `GET /v1/scheduler/status`
  - `POST /v1/scheduler/control`
- Devnet:
  - `GET /v1/devnet/wallet`
  - `PUT /v1/execution-mode` (`paper` or `devnet`)
  - `GET /v1/devnet/smoke-runs`
- Ops/deploy:
  - `GET /api/deploy/status`
  - `POST /api/deploy/restart`
  - `GET /api/deploy/logs`
  - `GET/POST /api/deploy/kill-switch`
  - `GET /api/portfolio/summary`

### Risk rules enforced server-side

Trade proposals can be blocked by these checks:

- `MAX_SINGLE_ORDER_SIZE`
- `MAX_TOTAL_OPEN_EXPOSURE`
- `MAX_OPEN_POSITIONS`
- `MAX_LOSS_PER_TRADE`
- `MAX_DAILY_LOSS`
- `COOLDOWN_SECONDS`
- `MAX_TRADES_PER_HOUR`
- `MAX_TRADES_PER_DAY`
- `MIN_CONFIDENCE`
- `MIN_PRICE_MOVEMENT_5M`

Auto-kill behavior exists for:

- prolonged stale market data
- extreme anomaly moves
- drawdown threshold breach

## Data Model

Schema source of truth:

- `infra/schema.sql`

Main tables:

- `market_ticks`
- `signals`
- `orders`
- `fills`
- `positions`
- `portfolio_snapshots`
- `risk_events`
- `kill_switch_events`
- `devnet_smoke_runs`

Migration currently present in repo:

- `infra/migrations/003_add_devnet_execution.sql`

## Frontend Dashboard

Primary UI app:

- `frontend/`

The frontend is a terminal-style Next.js dashboard with React Query polling/mutations.

### Active navigation sections

- Dashboard
- Trading
- Order History
- Risk & Strategy

### Notable behavior

- Uses trading session scoping via `localStorage` to separate current vs past orders/fills.
- `Trade Cycle Control` panel starts OpenClaw handshake by sending:
  - `/new`
  - `start paper trading on solana devnet`
- Streams OpenClaw responses for preview in the panel.
- Uses API proxy routes to avoid browser CORS coupling:
  - `frontend/app/api/proxy/[...path]/route.ts`
  - `frontend/app/api/openclaw/[...path]/route.ts`
  - `frontend/app/api/openclaw/responses/route.ts`

## Repository Layout

```text
.
├─ frontend/                         # main dashboard app (Next.js)
├─ infra/
│  ├─ schema.sql                     # DB schema
│  ├─ migrations/003_add_devnet_execution.sql
│  └─ solana-autopilot-infra.yaml    # AWS extended infra template
├─ scripts/
│  ├─ deploy.sh                      # OpenClaw stack deploy helper
│  ├─ bootstrap.sh                   # EC2 bootstrap (skills + config + adapter)
│  ├─ deploy-api.sh                  # installs API service on EC2
│  ├─ deploy-market-data.sh          # installs Jupiter tick ingester service
│  ├─ deploy-watchdog.sh             # installs service watchdog timer
│  ├─ validate-deployment.sh         # post-deploy checks
│  ├─ tunnel.sh                      # local tunnels for :3001 + :18789
│  ├─ connect.sh                     # OpenClaw-only tunnel helper
│  └─ provision-devnet-wallet.sh     # puts devnet wallet into Secrets Manager
├─ skills/                           # OpenClaw skills used at bootstrap
└─ PROJECT_SPEC.md
```

## Deployment Workflow (AWS)

### 1) Deploy base OpenClaw stack

```bash
bash scripts/deploy.sh openclaw-bedrock us-east-1
```

### 2) Deploy extended infra (RDS + secrets + IAM policy + alarms)

Use:

- `infra/solana-autopilot-infra.yaml`

Required parameters include:

- `OpenClawVpcId`
- `OpenClawSecurityGroupId`
- `OpenClawInstanceId`

Then attach the managed policy to the OpenClaw EC2 role:

```bash
bash scripts/attach-iam-policy.sh openclaw-bedrock solana-autopilot-infra us-east-1
```

### 3) On EC2, bootstrap and install services

Run:

- `scripts/bootstrap.sh`
- `scripts/deploy-market-data.sh`
- `scripts/deploy-api.sh`
- `scripts/deploy-watchdog.sh`

### 4) Validate deployment

```bash
bash scripts/validate-deployment.sh
```

### 5) Tunnel locally

```bash
bash scripts/tunnel.sh <instance-id> us-east-1
```

This forwards:

- `http://localhost:3001` (Trading API)
- `http://localhost:18789` (OpenClaw gateway)

## Running Frontend Locally

From repo root:

```bash
cd frontend
npm install
npm run dev
```

### Frontend env vars

Set as needed (defaults are shown by code):

- `BACKEND_API_BASE_URL` (default: `http://localhost:3001`)
- `NEXT_PUBLIC_API_BASE_URL` (default: `/api/proxy`)
- `NEXT_PUBLIC_OPENCLAW_BASE_URL` (default: `/api/openclaw`)
- `OPENCLAW_GATEWAY_BASE_URL` (default: `ws://localhost:18789`)
- `OPENCLAW_GATEWAY_TOKEN` (if gateway requires token)
- `OPENCLAW_HTTP_BASE_URL` (for responses stream route)
- `OPENCLAW_RESPONSES_PATH` (default: `/v1/responses`)
- `OPENCLAW_RESPONSES_TIMEOUT_MS` (default: `180000`)
- `OPENCLAW_RPC_TIMEOUT_MS`
- `OPENCLAW_AGENT_RPC_TIMEOUT_MS`
- `OPENCLAW_HTTP_AUTH_TOKEN`
- `OPENCLAW_RESPONSES_MODEL`

## Operational Notes

- Default trading mode is paper.
- `devnet` mode exists and records transaction metadata, but this phase does not implement live mainnet execution.
- Kill switch is enforced in backend logic, not prompt text.
- Watchdog timer can auto-restart gateway/API/adapter if unhealthy.
- Project includes an older UI snapshot directory (`solana-autopilot-dashboard/`), but the active app is `frontend/`.

## Quick Health Checks

- API health: `curl -s http://127.0.0.1:3001/v1/health`
- Bot status: `curl -s http://127.0.0.1:3001/v1/bot/status`
- Kill switch: `curl -s http://127.0.0.1:3001/v1/kill-switch`
- Recent ticks: `curl -s 'http://127.0.0.1:3001/v1/market/ticks/recent?symbol=SOL-USDC&minutes=5'`

---

If you are onboarding: start with `PROJECT_SPEC.md`, then `scripts/deploy-api.sh`, then `frontend/`.
