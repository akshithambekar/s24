"use client"

import { useEffect, useState } from "react"
import { useRiskPolicy, useUpdateRiskPolicy } from "@/hooks/use-api"
import { Panel } from "../panel"
import { Shield, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type RiskPolicyForm = {
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

type RiskNumericKey = Exclude<keyof RiskPolicyForm, "anomalyAutoKillEnabled">

const DEFAULT_FORM: RiskPolicyForm = {
  startingBalanceSol: 10,
  maxSingleOrderSol: 1,
  maxOpenExposureSol: 3,
  maxOpenPositions: 3,
  maxDrawdownSol: 1,
  maxLossPerTradeSol: 0.3,
  maxDailyLossSol: 0.5,
  cooldownSeconds: 60,
  maxTradesPerHour: 100,
  maxTradesPerDay: 1200,
  minConfidence: 0.7,
  minPriceMovePct5m: 2,
  anomalyWarnMovePct60s: 5,
  anomalyAutoKillMovePct60s: 10,
  anomalyWindowSeconds: 60,
  anomalyAutoKillEnabled: true,
  simulatedSlippagePct: 0.003,
  simulatedFeePct: 0.001,
}

export function RiskPolicyPanel() {
  const { data, isLoading, isError } = useRiskPolicy()
  const update = useUpdateRiskPolicy()
  const [form, setForm] = useState<RiskPolicyForm>(DEFAULT_FORM)

  useEffect(() => {
    if (data?.risk_policy) {
      setForm(data.risk_policy)
    }
  }, [data])

  function handleSave() {
    update.mutate(form)
  }

  const numericFields: Array<{ key: RiskNumericKey; label: string }> = [
    { key: "startingBalanceSol", label: "Starting Balance (SOL)" },
    { key: "maxSingleOrderSol", label: "Max Single Order (SOL)" },
    { key: "maxOpenExposureSol", label: "Max Open Exposure (SOL)" },
    { key: "maxOpenPositions", label: "Max Open Positions" },
    { key: "maxDrawdownSol", label: "Max Drawdown (SOL)" },
    { key: "maxLossPerTradeSol", label: "Max Loss/Trade (SOL)" },
    { key: "maxDailyLossSol", label: "Max Daily Loss (SOL)" },
    { key: "cooldownSeconds", label: "Cooldown (s)" },
    { key: "maxTradesPerHour", label: "Max Trades / Hour" },
    { key: "maxTradesPerDay", label: "Max Trades / Day" },
    { key: "minConfidence", label: "Min Confidence (0-1)" },
    { key: "minPriceMovePct5m", label: "Min Move 5m (%)" },
    { key: "anomalyWarnMovePct60s", label: "Anomaly Warn Move 60s (%)" },
    { key: "anomalyAutoKillMovePct60s", label: "Anomaly Auto-Kill Move 60s (%)" },
    { key: "anomalyWindowSeconds", label: "Anomaly Window (s)" },
    { key: "simulatedSlippagePct", label: "Simulated Slippage Pct" },
    { key: "simulatedFeePct", label: "Simulated Fee Pct" },
  ]

  return (
    <Panel
      title="Risk Policy"
      icon={<Shield className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={update.isPending}
          className="h-6 text-xs"
        >
          <Save className="mr-1 h-3 w-3" />
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {numericFields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {f.label}
            </Label>
            <Input
              type="number"
              step="any"
              value={form[f.key] as number}
              onChange={(e) =>
                setForm({
                  ...form,
                  [f.key]: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0,
                })
              }
              className="h-8 text-xs tabular-nums"
            />
          </div>
        ))}

        <div className="flex items-center justify-between rounded border border-border/50 bg-secondary/30 px-3 py-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Anomaly Auto-Kill Enabled
          </Label>
          <Switch
            checked={form.anomalyAutoKillEnabled}
            onCheckedChange={(v) => setForm({ ...form, anomalyAutoKillEnabled: v })}
          />
        </div>
      </div>
    </Panel>
  )
}
