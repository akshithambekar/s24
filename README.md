## s24

**s24** is a 24/7 Solana trading agent that combines autonomous trade orchestration, risk-aware execution, market data ingestion, and an operational dashboard. It is designed as a control plane for continuous paper trading with optional devnet execution.

At runtime:

1. Market data is ingested and stored in PostgreSQL.
2. Trade cycles are triggered via the agent orchestration layer.
3. The Trading API evaluates risk constraints and execution rules.
4. Orders and fills are persisted and tracked.
5. The dashboard reflects portfolio state, positions, and risk in real time.
6. A kill switch can halt trading instantly.
7. All activity is observable through structured endpoints and UI panels.

> 🏆 Best Use of Solana @ Hackfax x PatriotHacks 2026. View the Devpost [here](https://devpost.com/software/s24).

---

## Architecture & Features

### OpenClaw Gateway (Agent Orchestration Layer)

- Runs on EC2
- Orchestrates trade cycles and agent-triggered actions
- Interfaces with backend endpoints for execution
- Acts as the autonomous control surface for the trading loop

---

### Trading API (Execution & Risk Engine)

- Express-based backend service
- Exposes endpoints for:
  - Health checks
  - Bot status
  - `POST /v1/trade/cycle`
  - Orders, fills, positions, and portfolio queries
  - Kill switch control
- Enforces:
  - Maximum order sizing
  - Exposure limits
  - Confidence thresholds
  - Risk event logging
- Persists state to PostgreSQL
- Integrates with AWS Secrets Manager for configuration

---

### Market Data Adapter

- Polls SOL–USDC pricing data (via Jupiter)
- Normalizes and stores ticks in the `market_ticks` table
- Provides the data foundation for trade decisions
- Supports continuous ingestion for strategy evaluation

---

### Dashboard (Next.js)

- Operational trading interface
- Displays:
  - Bot status
  - Orders and fills
  - Positions and portfolio snapshots
  - Risk events
  - Kill switch state
- Uses polling and mutation hooks for near real-time updates
- Proxies backend API requests

---

### Data Model

Core tables:

- `market_ticks`
- `signals`
- `orders`
- `fills`
- `positions`
- `portfolio_snapshots`
- `risk_events`
- `kill_switch_events`

Schema is defined in `infra/schema.sql` with versioned migrations under `infra/migrations`.

---

## End Result

- Continuous 24/7 paper trading loop  
- Autonomous trade cycle orchestration  
- Enforced backend risk controls  
- Real-time operational visibility  
- Instant kill switch protection  
