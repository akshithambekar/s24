"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  OrderFilters,
  FillFilters,
  KillSwitchTogglePayload,
  TradeCyclePayload,
  RiskPolicy,
  StrategyConfig,
  SchedulerControlPayload,
} from "@/types/api"
import { ApiError } from "@/lib/api/client"
import * as api from "@/lib/api/endpoints"

// ─── Helpers ───
function onApiError(err: unknown) {
  if (err instanceof ApiError) {
    toast.error(`[${err.code}] ${err.message}`)
  } else {
    toast.error("An unexpected error occurred")
  }
}

// ─── Query Keys ───
export const qk = {
  botStatus: ["bot-status"],
  killSwitch: ["kill-switch"],
  portfolio: ["portfolio"],
  positions: ["positions"],
  orders: (f: OrderFilters) => ["orders", f],
  fills: (f: FillFilters) => ["fills", f],
  riskEvents: ["risk-events"],
  riskPolicy: ["risk-policy"],
  strategyConfig: ["strategy-config"],
  anomaly: (s: string) => ["anomaly", s],
  marketTicks: (s: string, m: number) => ["market-ticks", s, m],
  scheduler: ["scheduler"],
  health: ["health"],
  deploy: ["deploy"],
  smokeRuns: ["smoke-runs"],
  logs: ["logs"],
} as const

// ─── Fast-polling queries (5-10s) ───
export function useBotStatus() {
  return useQuery({
    queryKey: qk.botStatus,
    queryFn: api.fetchBotStatus,
    refetchInterval: 5_000,
    retry: 1,
  })
}

export function useKillSwitch() {
  return useQuery({
    queryKey: qk.killSwitch,
    queryFn: api.fetchKillSwitch,
    refetchInterval: 5_000,
    retry: 1,
  })
}

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: api.fetchHealth,
    refetchInterval: 10_000,
    retry: 1,
  })
}

export function useSchedulerStatus() {
  return useQuery({
    queryKey: qk.scheduler,
    queryFn: api.fetchSchedulerStatus,
    refetchInterval: 10_000,
    retry: 1,
  })
}

// ─── Medium-polling queries (15-30s) ───
export function usePortfolioSnapshots() {
  return useQuery({
    queryKey: qk.portfolio,
    queryFn: () => api.fetchPortfolioSnapshots(),
    refetchInterval: 15_000,
  })
}

export function usePositions() {
  return useQuery({
    queryKey: qk.positions,
    queryFn: api.fetchPositions,
    refetchInterval: 15_000,
  })
}

export function useOrders(filters: OrderFilters = {}) {
  return useQuery({
    queryKey: qk.orders(filters),
    queryFn: () => api.fetchOrders(filters),
    refetchInterval: 30_000,
  })
}

export function useFills(filters: FillFilters = {}) {
  return useQuery({
    queryKey: qk.fills(filters),
    queryFn: () => api.fetchFills(filters),
    refetchInterval: 30_000,
  })
}

export function useRiskEvents() {
  return useQuery({
    queryKey: qk.riskEvents,
    queryFn: api.fetchRiskEvents,
    refetchInterval: 30_000,
  })
}

export function useMarketTicks(symbol = "SOL-USDC", minutes = 5) {
  return useQuery({
    queryKey: qk.marketTicks(symbol, minutes),
    queryFn: () => api.fetchMarketTicks(symbol, minutes),
    refetchInterval: 15_000,
  })
}

// ─── Slow / on-demand queries ───
export function useRiskPolicy() {
  return useQuery({
    queryKey: qk.riskPolicy,
    queryFn: api.fetchRiskPolicy,
    refetchInterval: 60_000,
  })
}

export function useStrategyConfig() {
  return useQuery({
    queryKey: qk.strategyConfig,
    queryFn: api.fetchStrategyConfig,
    refetchInterval: 60_000,
  })
}

export function useAnomalyStatus(symbol = "SOL-USDC") {
  return useQuery({
    queryKey: qk.anomaly(symbol),
    queryFn: () => api.fetchAnomalyStatus(symbol),
    refetchInterval: 30_000,
  })
}

export function useDeployStatus() {
  return useQuery({
    queryKey: qk.deploy,
    queryFn: api.fetchDeployStatus,
    refetchInterval: 60_000,
  })
}

export function useSmokeRuns() {
  return useQuery({
    queryKey: qk.smokeRuns,
    queryFn: api.fetchSmokeRuns,
    refetchInterval: 60_000,
  })
}

export function useLogs(lines = 50) {
  return useQuery({
    queryKey: [...qk.logs, lines],
    queryFn: () => api.fetchLogs(lines),
    refetchInterval: 30_000,
  })
}

// ─── Mutations ───
export function useToggleKillSwitch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: KillSwitchTogglePayload) =>
      api.toggleKillSwitch(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.killSwitch })
      toast.success("Kill switch toggled")
    },
    onError: onApiError,
  })
}

export function useTriggerTradeCycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: TradeCyclePayload) =>
      api.triggerTradeCycle(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.positions })
      qc.invalidateQueries({ queryKey: qk.portfolio })
    },
    onError: onApiError,
  })
}

export function useUpdateRiskPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (policy: Partial<RiskPolicy>) =>
      api.updateRiskPolicy(policy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.riskPolicy })
      toast.success("Risk policy updated")
    },
    onError: onApiError,
  })
}

export function useUpdateStrategyConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<StrategyConfig>) =>
      api.updateStrategyConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.strategyConfig })
      toast.success("Strategy config updated")
    },
    onError: onApiError,
  })
}

export function useControlScheduler() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SchedulerControlPayload) =>
      api.controlScheduler(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.scheduler })
      toast.success("Scheduler updated")
    },
    onError: onApiError,
  })
}

export function useTriggerAnomalyCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (symbol: string) => api.triggerAnomalyCheck(symbol),
    onSuccess: (_data, symbol) => {
      qc.invalidateQueries({ queryKey: qk.anomaly(symbol) })
    },
    onError: onApiError,
  })
}
