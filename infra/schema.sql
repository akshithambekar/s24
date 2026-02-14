-- Solana Autopilot Database Schema
-- Per PROJECT_SPEC.md Section 7: Core Data Model

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==================== market_ticks ====================
-- Price snapshots and spread metrics
CREATE TABLE IF NOT EXISTS market_ticks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pair VARCHAR(32) NOT NULL,              -- e.g. 'SOL/USDC'
    token_mint VARCHAR(64),                 -- Solana token mint address
    price NUMERIC(20, 8) NOT NULL,
    bid NUMERIC(20, 8),
    ask NUMERIC(20, 8),
    spread_bps NUMERIC(10, 2),              -- spread in basis points
    volume_24h NUMERIC(20, 2),
    source VARCHAR(32) NOT NULL,            -- 'jupiter', 'birdeye', 'pyth', etc.
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_ticks_pair_time ON market_ticks (pair, fetched_at DESC);
CREATE INDEX idx_market_ticks_fetched ON market_ticks (fetched_at DESC);

-- ==================== signals ====================
-- Strategy outputs and confidence
CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy VARCHAR(64) NOT NULL,          -- strategy name/version
    pair VARCHAR(32) NOT NULL,
    direction VARCHAR(4) NOT NULL CHECK (direction IN ('BUY', 'SELL', 'HOLD')),
    confidence NUMERIC(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    tick_id UUID REFERENCES market_ticks(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signals_pair_time ON signals (pair, created_at DESC);
CREATE INDEX idx_signals_strategy ON signals (strategy, created_at DESC);

-- ==================== orders ====================
-- Intended and approved/rejected orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signal_id UUID REFERENCES signals(id),
    pair VARCHAR(32) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type VARCHAR(16) NOT NULL DEFAULT 'MARKET' CHECK (order_type IN ('MARKET', 'LIMIT')),
    quantity NUMERIC(20, 8) NOT NULL,
    price NUMERIC(20, 8),                   -- limit price if applicable
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED')),
    rejection_reason TEXT,
    risk_check_passed BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_status ON orders (status, created_at DESC);
CREATE INDEX idx_orders_pair ON orders (pair, created_at DESC);

-- ==================== fills ====================
-- Simulated fill records
CREATE TABLE IF NOT EXISTS fills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    pair VARCHAR(32) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity NUMERIC(20, 8) NOT NULL,
    fill_price NUMERIC(20, 8) NOT NULL,
    slippage_bps NUMERIC(10, 2),            -- simulated slippage
    fee_usd NUMERIC(10, 4),                 -- simulated fee
    execution_mode VARCHAR(16) NOT NULL DEFAULT 'PAPER' CHECK (execution_mode IN ('PAPER', 'DEVNET')),
    filled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fills_order ON fills (order_id);
CREATE INDEX idx_fills_pair_time ON fills (pair, filled_at DESC);

-- ==================== positions ====================
-- Current exposure by pair
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pair VARCHAR(32) NOT NULL UNIQUE,
    side VARCHAR(4) NOT NULL CHECK (side IN ('LONG', 'SHORT', 'FLAT')),
    quantity NUMERIC(20, 8) NOT NULL DEFAULT 0,
    avg_entry_price NUMERIC(20, 8),
    current_price NUMERIC(20, 8),
    unrealized_pnl NUMERIC(20, 4),
    realized_pnl NUMERIC(20, 4) NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_positions_pair ON positions (pair);

-- ==================== portfolio_snapshots ====================
-- NAV and PnL timeline
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    total_nav NUMERIC(20, 4) NOT NULL,      -- net asset value
    total_pnl NUMERIC(20, 4) NOT NULL,
    unrealized_pnl NUMERIC(20, 4) NOT NULL,
    realized_pnl NUMERIC(20, 4) NOT NULL,
    num_positions INTEGER NOT NULL DEFAULT 0,
    max_drawdown_pct NUMERIC(8, 4),
    metadata JSONB DEFAULT '{}',
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolio_snapshots_time ON portfolio_snapshots (snapshot_at DESC);

-- ==================== risk_events ====================
-- Rule violations and blocks
CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id),
    rule VARCHAR(64) NOT NULL,              -- e.g. 'MAX_POSITION_SIZE', 'DAILY_LOSS_LIMIT'
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'BLOCK', 'CRITICAL')),
    description TEXT NOT NULL,
    current_value NUMERIC(20, 4),
    threshold_value NUMERIC(20, 4),
    action_taken VARCHAR(32) NOT NULL CHECK (action_taken IN ('ALLOWED', 'BLOCKED', 'REDUCED', 'ALERT_ONLY')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_events_severity ON risk_events (severity, created_at DESC);
CREATE INDEX idx_risk_events_order ON risk_events (order_id);

-- ==================== kill_switch_events ====================
-- Stop/start audit trail
CREATE TABLE IF NOT EXISTS kill_switch_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(16) NOT NULL CHECK (action IN ('ACTIVATE', 'DEACTIVATE')),
    triggered_by VARCHAR(64) NOT NULL,      -- 'user', 'risk_engine', 'system'
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kill_switch_time ON kill_switch_events (created_at DESC);

-- ==================== devnet_smoke_runs ====================
-- Smoke test results and latency
CREATE TABLE IF NOT EXISTS devnet_smoke_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_type VARCHAR(32) NOT NULL,         -- 'wallet_sign', 'rpc_send', 'balance_check'
    status VARCHAR(16) NOT NULL CHECK (status IN ('PASS', 'FAIL', 'TIMEOUT', 'SKIP')),
    latency_ms INTEGER,
    rpc_endpoint VARCHAR(256),
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devnet_smoke_time ON devnet_smoke_runs (executed_at DESC);
CREATE INDEX idx_devnet_smoke_status ON devnet_smoke_runs (status, executed_at DESC);
