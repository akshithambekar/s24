-- Trading API database schema
-- Aligned with migrations: 001_init_tables.sql + 002_add_indexes.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS market_ticks (
    tick_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    bid_price NUMERIC(18,8) NOT NULL,
    ask_price NUMERIC(18,8) NOT NULL,
    mid_price NUMERIC(18,8) NOT NULL,
    spread_bps INTEGER NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT market_ticks_price_check CHECK (ask_price >= bid_price)
);

CREATE TABLE IF NOT EXISTS signals (
    signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    confidence NUMERIC(6,5) NOT NULL,
    strategy_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signals_side_check CHECK (side IN ('buy', 'sell')),
    CONSTRAINT signals_confidence_check CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL,
    signal_id UUID NOT NULL REFERENCES signals(signal_id),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty NUMERIC(18,8) NOT NULL,
    limit_price NUMERIC(18,8),
    status TEXT NOT NULL,
    risk_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orders_side_check CHECK (side IN ('buy', 'sell')),
    CONSTRAINT orders_status_check CHECK (status IN ('proposed', 'approved', 'rejected', 'executed', 'canceled')),
    CONSTRAINT orders_qty_check CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS fills (
    fill_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(order_id),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty NUMERIC(18,8) NOT NULL,
    fill_price NUMERIC(18,8) NOT NULL,
    fee NUMERIC(18,8) NOT NULL DEFAULT 0,
    slippage_bps INTEGER NOT NULL DEFAULT 0,
    filled_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fills_side_check CHECK (side IN ('buy', 'sell')),
    CONSTRAINT fills_qty_check CHECK (qty > 0),
    CONSTRAINT fills_slippage_check CHECK (slippage_bps >= 0)
);

CREATE TABLE IF NOT EXISTS positions (
    symbol TEXT PRIMARY KEY,
    qty NUMERIC(18,8) NOT NULL,
    avg_entry_price NUMERIC(18,8) NOT NULL,
    mark_price NUMERIC(18,8) NOT NULL,
    unrealized_pnl NUMERIC(18,8) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nav NUMERIC(18,8) NOT NULL,
    cash NUMERIC(18,8) NOT NULL,
    realized_pnl NUMERIC(18,8) NOT NULL,
    unrealized_pnl NUMERIC(18,8) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_events (
    risk_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(order_id),
    action TEXT NOT NULL,
    rule TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT risk_events_action_check CHECK (action IN ('blocked', 'allowed', 'warned'))
);

CREATE TABLE IF NOT EXISTS kill_switch_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enabled BOOLEAN NOT NULL,
    reason TEXT,
    actor TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devnet_smoke_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL,
    rpc_latency_ms INTEGER,
    wallet_check TEXT,
    tx_simulation TEXT,
    ran_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT devnet_smoke_runs_status_check CHECK (status IN ('passed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_event_at
    ON market_ticks (symbol, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_signals_cycle_id
    ON signals (cycle_id);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_created_at
    ON signals (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_cycle_id
    ON orders (cycle_id);

CREATE INDEX IF NOT EXISTS idx_orders_symbol_created_at
    ON orders (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
    ON orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fills_order_id_filled_at
    ON fills (order_id, filled_at DESC);

CREATE INDEX IF NOT EXISTS idx_fills_symbol_filled_at
    ON fills (symbol, filled_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_captured_at
    ON portfolio_snapshots (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_events_order_id_created_at
    ON risk_events (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_events_created_at
    ON risk_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_devnet_smoke_runs_ran_at
    ON devnet_smoke_runs (ran_at DESC);
