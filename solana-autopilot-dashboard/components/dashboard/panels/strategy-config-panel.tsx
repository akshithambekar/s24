"use client"

import { useEffect, useState } from "react"
import { useStrategyConfig, useUpdateStrategyConfig } from "@/hooks/use-api"
import { Panel } from "../panel"
import { Settings, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type StrategyForm = {
  enabled: boolean
  symbol: string
  defaultOrderSizeSol: number
  minConfidence: number
  minPriceMovePct5m: number
  cooldownSeconds: number
  anomalyDetectionEnabled: boolean
}

const DEFAULT_FORM: StrategyForm = {
  enabled: true,
  symbol: "SOL-USDC",
  defaultOrderSizeSol: 0.25,
  minConfidence: 0.7,
  minPriceMovePct5m: 2,
  cooldownSeconds: 60,
  anomalyDetectionEnabled: true,
}

export function StrategyConfigPanel() {
  const { data, isLoading, isError } = useStrategyConfig()
  const update = useUpdateStrategyConfig()
  const [form, setForm] = useState<StrategyForm>(DEFAULT_FORM)

  useEffect(() => {
    if (data?.strategy_config) {
      setForm({
        ...DEFAULT_FORM,
        ...data.strategy_config,
        anomalyDetectionEnabled: data.strategy_config.anomalyDetectionEnabled ?? true,
      })
    }
  }, [data])

  function handleSave() {
    update.mutate(form)
  }

  return (
    <Panel
      title="Strategy Config"
      icon={<Settings className="h-3.5 w-3.5" />}
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
        <div className="flex items-center justify-between rounded border border-border/50 bg-secondary/30 px-3 py-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Enabled
          </Label>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded border border-border/50 bg-secondary/30 px-3 py-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Anomaly Detection
          </Label>
          <Switch
            checked={form.anomalyDetectionEnabled}
            onCheckedChange={(v) => setForm({ ...form, anomalyDetectionEnabled: v })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Symbol
          </Label>
          <Input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            className="h-8 text-xs"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Default Order Size (SOL)
          </Label>
          <Input
            type="number"
            step="any"
            value={form.defaultOrderSizeSol}
            onChange={(e) => setForm({ ...form, defaultOrderSizeSol: Number(e.target.value) || 0 })}
            className="h-8 text-xs tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Min Confidence (0-1)
          </Label>
          <Input
            type="number"
            step="0.01"
            value={form.minConfidence}
            onChange={(e) => setForm({ ...form, minConfidence: Number(e.target.value) || 0 })}
            className="h-8 text-xs tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Min Price Move 5m (%)
          </Label>
          <Input
            type="number"
            step="0.01"
            value={form.minPriceMovePct5m}
            onChange={(e) => setForm({ ...form, minPriceMovePct5m: Number(e.target.value) || 0 })}
            className="h-8 text-xs tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Cooldown (s)
          </Label>
          <Input
            type="number"
            value={form.cooldownSeconds}
            onChange={(e) => setForm({ ...form, cooldownSeconds: Number(e.target.value) || 0 })}
            className="h-8 text-xs tabular-nums"
          />
        </div>
      </div>
    </Panel>
  )
}
