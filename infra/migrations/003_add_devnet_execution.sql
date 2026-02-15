-- Migration 003: Add devnet execution columns to fills and orders
-- Adds execution_mode, tx_signature, tx_slot, network_fee_sol to fills
-- Adds execution_mode to orders
-- All columns are nullable/defaulted so existing paper data remains valid

BEGIN;

-- ── fills table ──────────────────────────────────────────────────────
ALTER TABLE fills
    ADD COLUMN execution_mode TEXT DEFAULT 'paper',
    ADD COLUMN tx_signature   TEXT,
    ADD COLUMN tx_slot        BIGINT,
    ADD COLUMN network_fee_sol NUMERIC(18,8);

ALTER TABLE fills
    ADD CONSTRAINT fills_execution_mode_check
        CHECK (execution_mode IN ('paper', 'devnet', 'live'));

CREATE INDEX idx_fills_execution_mode_filled_at
    ON fills (execution_mode, filled_at DESC);

CREATE UNIQUE INDEX idx_fills_tx_signature
    ON fills (tx_signature)
    WHERE tx_signature IS NOT NULL;

-- ── orders table ─────────────────────────────────────────────────────
ALTER TABLE orders
    ADD COLUMN execution_mode TEXT DEFAULT 'paper';

ALTER TABLE orders
    ADD CONSTRAINT orders_execution_mode_check
        CHECK (execution_mode IN ('paper', 'devnet', 'live'));

COMMIT;
