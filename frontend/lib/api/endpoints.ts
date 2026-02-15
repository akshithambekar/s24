import { apiFetch, ApiError } from "./client"
import type {
  BotStatus,
  TradingResetResponse,
  KillSwitchState,
  KillSwitchTogglePayload,
  KillSwitchToggleResponse,
  PortfolioSnapshot,
  Position,
  Order,
  OrderFilters,
  Fill,
  FillFilters,
  TradeCyclePayload,
  TradeCycleResult,
  RiskEvent,
  RiskPolicy,
  RiskPolicyResponse,
  StrategyConfig,
  StrategyConfigResponse,
  AnomalyStatus,
  AnomalyCheckResult,
  MarketTicksResponse,
  SchedulerStatus,
  SchedulerControlPayload,
  HealthStatus,
  DeployStatus,
  SmokeRun,
  CursorPage,
  ListResponse,
  LogsResponse,
} from "@/types/api"

// ─── Bot ───
export const fetchBotStatus = () =>
  apiFetch<BotStatus>("/v1/bot/status")

// ─── Kill Switch ───
export const fetchKillSwitch = () =>
  apiFetch<KillSwitchState>("/v1/kill-switch")

export const toggleKillSwitch = (payload: KillSwitchTogglePayload) =>
  apiFetch<KillSwitchToggleResponse>("/v1/kill-switch", {
    method: "POST",
    body: JSON.stringify(payload),
  })

// ─── Portfolio ───
export const fetchPortfolioSnapshots = (limit = 200, cursor?: string) => {
  const params = new URLSearchParams()
  params.set("limit", String(limit))
  if (cursor) params.set("cursor", cursor)
  return apiFetch<CursorPage<PortfolioSnapshot>>(
    `/v1/portfolio/snapshots?${params.toString()}`
  )
}

// ─── Positions ───
export const fetchPositions = () =>
  apiFetch<ListResponse<Position>>("/v1/positions")

// ─── Orders ───
export const fetchOrders = (filters: OrderFilters = {}) => {
  const params = new URLSearchParams()
  if (filters.symbol) params.set("symbol", filters.symbol)
  if (filters.status) params.set("status", filters.status)
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.cursor) params.set("cursor", filters.cursor)
  if (filters.limit) params.set("limit", String(filters.limit))
  const qs = params.toString()
  return apiFetch<CursorPage<Order>>(`/v1/orders${qs ? `?${qs}` : ""}`)
}

// ─── Fills ───
export const fetchFills = (filters: FillFilters = {}) => {
  const params = new URLSearchParams()
  if (filters.symbol) params.set("symbol", filters.symbol)
  if (filters.execution_mode) params.set("execution_mode", filters.execution_mode)
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.cursor) params.set("cursor", filters.cursor)
  if (filters.limit) params.set("limit", String(filters.limit))
  const qs = params.toString()
  return apiFetch<CursorPage<Fill>>(`/v1/fills${qs ? `?${qs}` : ""}`)
}

// ─── Trade Cycle ───
export const triggerTradeCycle = (payload: TradeCyclePayload) =>
  apiFetch<TradeCycleResult>("/v1/trade/cycle", {
    method: "POST",
    body: JSON.stringify(payload),
  })

// ─── Risk Events ───
export const fetchRiskEvents = () =>
  apiFetch<CursorPage<RiskEvent>>("/v1/risk/events")

// ─── Risk Policy ───
export const fetchRiskPolicy = () =>
  apiFetch<RiskPolicyResponse>("/v1/risk/policy")

export const updateRiskPolicy = (policy: Partial<RiskPolicy>) =>
  apiFetch<RiskPolicyResponse>("/v1/risk/policy", {
    method: "PUT",
    body: JSON.stringify({ risk_policy: policy }),
  })

// ─── Strategy Config ───
export const fetchStrategyConfig = () =>
  apiFetch<StrategyConfigResponse>("/v1/strategy/config")

export const updateStrategyConfig = (config: Partial<StrategyConfig>) =>
  apiFetch<StrategyConfigResponse>("/v1/strategy/config", {
    method: "PUT",
    body: JSON.stringify({ strategy_config: config }),
  })

// ─── Anomaly Detection ───
export const fetchAnomalyStatus = (symbol = "SOL-USDC") =>
  apiFetch<AnomalyStatus>(
    `/v1/risk/anomaly-detection?symbol=${encodeURIComponent(symbol)}`
  )

export const triggerAnomalyCheck = (symbol = "SOL-USDC") =>
  apiFetch<AnomalyCheckResult>("/v1/risk/anomaly-detection/check", {
    method: "POST",
    body: JSON.stringify({ symbol }),
  })

// ─── Market Ticks ───
export const fetchMarketTicks = (
  symbol = "SOL-USDC",
  minutes = 5
) =>
  apiFetch<MarketTicksResponse>(
    `/v1/market/ticks/recent?symbol=${encodeURIComponent(symbol)}&minutes=${minutes}`
  )

// ─── Scheduler ───
export const fetchSchedulerStatus = () =>
  apiFetch<SchedulerStatus>("/v1/scheduler/status")

export const controlScheduler = (payload: SchedulerControlPayload) =>
  apiFetch<SchedulerStatus>("/v1/scheduler/control", {
    method: "POST",
    body: JSON.stringify(payload),
  })

// ─── Health ───
export const fetchHealth = () =>
  apiFetch<HealthStatus>("/v1/health")

export const fetchDeployStatus = () =>
  apiFetch<DeployStatus>("/api/deploy/status")

// ─── Devnet Smoke ───
export const fetchSmokeRuns = (limit = 20, cursor?: string) => {
  const params = new URLSearchParams()
  params.set("limit", String(limit))
  if (cursor) params.set("cursor", cursor)
  return apiFetch<CursorPage<SmokeRun>>(`/v1/devnet/smoke-runs?${params.toString()}`)
}

// ─── Trading Reset ───
export const resetTrading = async () => {
  try {
    return await apiFetch<TradingResetResponse>("/v1/trading/reset", {
      method: "POST",
    })
  } catch (err) {
    // Backward compatibility: some deployed API versions do not expose reset.
    if (err instanceof ApiError && err.status === 404) {
      return {
        reset: false,
        message:
          "Trading reset endpoint is unavailable on this backend version. Continuing without reset.",
        reset_at: new Date().toISOString(),
      } satisfies TradingResetResponse
    }
    throw err
  }
}

// ─── Logs ───
export const fetchLogs = (lines = 50) =>
  apiFetch<LogsResponse>(`/api/deploy/logs?lines=${lines}`)
