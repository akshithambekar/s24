"use client"

import { useAnomalyStatus, useTriggerAnomalyCheck } from "@/hooks/use-api"
import { Panel, StatCard, EmptyState } from "../panel"
import { Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AnomalyCheckResult } from "@/types/api"
import { useState } from "react"

export function AnomalyPanel() {
  const { data, isLoading, isError } = useAnomalyStatus("SOL-USDC")
  const check = useTriggerAnomalyCheck()
  const [checkResult, setCheckResult] = useState<AnomalyCheckResult | null>(null)

  async function handleCheck() {
    const res = await check.mutateAsync("SOL-USDC")
    setCheckResult(res)
  }

  return (
    <Panel
      title="Anomaly Detection"
      icon={<Zap className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheck}
          disabled={check.isPending}
          className="h-6 text-xs"
        >
          Run Check
        </Button>
      }
    >
      {!data ? (
        <EmptyState message="No anomaly data for SOL-USDC." />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Severity"
              value={data.anomaly?.severity ?? "none"}
              className={cn(
                (data.anomaly?.severity ?? "none") === "extreme"
                  ? "border-destructive/50"
                  : (data.anomaly?.severity ?? "none") === "warning"
                    ? "border-warning/50"
                    : ""
              )}
            />
            <StatCard label="Move %" value={data.anomaly?.price_move_pct ?? 0} />
            <StatCard label="Window (s)" value={data.policy.window_seconds} />
            <StatCard label="Warn Threshold %" value={data.policy.warn_move_pct_60s} />
          </div>

          {checkResult && (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-xs",
                checkResult.anomaly?.detected
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-success/50 bg-success/10 text-success"
              )}
            >
              <p className="font-semibold uppercase">
                {checkResult.anomaly?.detected ? "Anomaly Detected" : "No Anomaly"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Severity: {checkResult.anomaly?.severity ?? "none"} | Move: {checkResult.anomaly?.price_move_pct ?? 0}% | Window: {checkResult.anomaly?.window_seconds ?? 0}s
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
