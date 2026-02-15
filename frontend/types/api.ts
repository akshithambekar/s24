// ─── Error Shape ───
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ─── Common Response Shapes ───
export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
}

export interface ListResponse<T> {
  items: T[]
}

// ─── Anomaly ───
export interface AnomalyState {
  detected: boolean
  severity: "none" | "warning" | "extreme" | string
  price_move_pct: number
  baseline_mid_price: number | null
  latest_mid_price: number | null
  baseline_at: string | null
  latest_at: string | null
  window_seconds: number
  samples: number
}

// ─── Bot / Status ───
export interface BotStatus {
  mode: "paper" | "devnet" | "live" | string
  state: "running" | "paused" | string
  kill_switch: boolean
  last_cycle_at: string | null
  last_tick_at: string | null
  market_data_stale: boolean
  portfolio_nav_sol: number
  drawdown_sol: number
  anomaly_detection: {
    enabled: boolean
    state: AnomalyState | null
  }
}

// ─── Kill Switch ───
export interface KillSwitchEvent {
  event_id: string
  enabled: boolean
  actor: string | null
  reason: string | null
  created_at: string
}

export interface KillSwitchState {
  enabled: boolean
  recent_events: KillSwitchEvent[]
}

export interface KillSwitchTogglePayload {
  enabled: boolean
  actor?: string
  reason?: string
}

export interface KillSwitchToggleResponse {
  enabled: boolean
  updated_at: string
}

// ─── Portfolio ───
export interface PortfolioSnapshot {
  snapshot_id: string
  nav: number
  cash: number
  realized_pnl: number
  unrealized_pnl: number
  captured_at: string
}

// ─── Positions ───
export interface Position {
  symbol: string
  qty: number
  avg_entry_price: number
  mark_price: number
  unrealized_pnl: number
  updated_at: string
}

// ─── Orders ───
export interface Order {
  order_id: string
  cycle_id: string | null
  signal_id: string | null
  symbol: string
  side: "buy" | "sell"
  qty: number
  limit_price: number | null
  status: string
  risk_reason: string | null
  execution_mode: "paper" | "devnet" | "live" | string
  created_at: string
}

export interface OrderFilters {
  symbol?: string
  status?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

// ─── Fills ───
export interface Fill {
  fill_id: string
  order_id: string
  symbol: string
  side: "buy" | "sell"
  qty: number
  fill_price: number
  fee: number
  slippage_bps: number
  filled_at: string
  execution_mode: "paper" | "devnet" | "live" | string
  tx_signature: string | null
  tx_slot: number | null
  network_fee_sol: number | null
}

export interface FillFilters {
  symbol?: string
  execution_mode?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

// ─── Trade Cycle ───
export interface TradeCycleProposal {
  side: "buy" | "sell"
  qty_sol: number
  confidence: number
  price_movement_5m_pct: number
  expected_loss_sol?: number
}

export interface TradeCyclePayload {
  trigger_source?: string
  symbol?: string
  idempotency_key?: string
  proposal?: TradeCycleProposal
  force_no_trade?: boolean
}

export interface TradeCycleResult {
  cycle_id: string
  accepted: boolean
  queued_at: string
  symbol: string
  trigger_source: string
  order_id?: string
  fill_id?: string
  status?: string
  execution_mode?: string
  tx_signature?: string | null
  tx_slot?: number | null
  network_fee_sol?: number | null
  anomaly?: AnomalyState | null
}

// ─── Risk Events ───
export interface RiskEvent {
  risk_event_id: string
  order_id: string
  action: "blocked" | "allowed" | "warned" | string
  rule: string
  details: Record<string, unknown>
  created_at: string
}

// ─── Risk Policy ───
export interface RiskPolicy {
  startingBalanceSol: number
  maxSingleOrderSol: number
  maxOpenExposureSol: number
  maxOpenPositions: number
  maxDrawdownSol: number
  maxLossPerTradeSol: number
  maxDailyLossSol: number
  cooldownSeconds: number
  maxTradesPerHour: number
  maxTradesPerDay: number
  minConfidence: number
  minPriceMovePct5m: number
  anomalyWarnMovePct60s: number
  anomalyAutoKillMovePct60s: number
  anomalyWindowSeconds: number
  anomalyAutoKillEnabled: boolean
  simulatedSlippagePct: number
  simulatedFeePct: number
}

export interface RiskPolicyResponse {
  risk_policy: RiskPolicy
  overrides: Partial<RiskPolicy>
  defaults: RiskPolicy
  updated_at?: string
}

// ─── Strategy Config ───
export interface StrategyConfig {
  enabled: boolean
  symbol: string
  defaultOrderSizeSol: number
  minConfidence: number
  minPriceMovePct5m: number
  cooldownSeconds: number
  anomalyDetectionEnabled?: boolean
}

export interface StrategyConfigResponse {
  strategy_config: StrategyConfig
  overrides: Partial<StrategyConfig>
  defaults: StrategyConfig
  updated_at?: string
}

// ─── Anomaly Detection ───
export interface AnomalyStatus {
  symbol: string
  enabled: boolean
  anomaly: AnomalyState | null
  policy: {
    window_seconds: number
    warn_move_pct_60s: number
    auto_kill_move_pct_60s: number
    auto_kill_enabled: boolean
  }
}

export interface AnomalyCheckResult {
  symbol: string
  enabled: boolean
  checked_at: string
  anomaly: AnomalyState | null
  warning_log: {
    logged: boolean
    order_id: string | null
    reason: string | null
  }
  kill_switch: {
    attempted: boolean
    activated: boolean
    alreadyActive: boolean
  }
}

// ─── Market Ticks ───
export interface MarketTick {
  mid_price: number
  bid_price: number
  ask_price: number
  spread_bps: number
  event_at: string
}

export interface MarketTicksResponse {
  symbol: string
  window_minutes: number
  tick_count: number
  latest_mid_price: number | null
  latest_bid: number | null
  latest_ask: number | null
  latest_at: string | null
  price_change_pct: number
  direction: "up" | "down" | "flat" | string
  ticks: MarketTick[]
}

// ─── Scheduler ───
export interface SchedulerStatus {
  enabled: boolean
  interval_ms: number
  last_triggered_at: string | null
  last_result?: Record<string, unknown> | null
  cycle_count: number
}

export interface SchedulerControlPayload {
  enabled: boolean
  interval_ms?: number
}

// ─── Health ───
export interface HealthStatus {
  status: "ok" | "degraded" | "healthy" | "unhealthy" | string
  service: string
  time: string
  dependencies: Record<string, string>
  error?: string
}

export interface DeployStatus {
  status: string
  timestamp: string
  checks: Record<string, unknown>
}

// ─── Devnet Smoke ───
export interface SmokeRun {
  run_id: string
  ran_at: string
  status: "passed" | "failed" | string
  rpc_latency_ms: number | null
  wallet_check: string | null
  tx_simulation: string | null
}

// ─── Logs ───
export interface LogsResponse {
  logs: string[]
  line_count: number
  timestamp: string
}
