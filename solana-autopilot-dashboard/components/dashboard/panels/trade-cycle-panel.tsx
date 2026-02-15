"use client"

import { useState } from "react"
import { useTriggerTradeCycle, useKillSwitch } from "@/hooks/use-api"
import { Panel } from "../panel"
import { Play, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { TradeCycleResult } from "@/types/api"

export function TradeCyclePanel() {
  const killSwitch = useKillSwitch()
  const mutation = useTriggerTradeCycle()
  const [result, setResult] = useState<TradeCycleResult | null>(null)

  const [triggerSource, setTriggerSource] = useState("manual")
  const [symbol, setSymbol] = useState("SOL-USDC")
  const [idempotencyKey, setIdempotencyKey] = useState("")
  const [includeProposal, setIncludeProposal] = useState(false)
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [qtySol, setQtySol] = useState("1")
  const [confidence, setConfidence] = useState("0.8")
  const [priceMovement, setPriceMovement] = useState("0.5")
  const [expectedLoss, setExpectedLoss] = useState("0.1")

  const isKillSwitchActive = killSwitch.data?.enabled === true

  async function handleTrigger() {
    const payload = {
      trigger_source: triggerSource,
      symbol,
      idempotency_key: idempotencyKey || undefined,
      proposal: includeProposal
        ? {
            side,
            qty_sol: parseFloat(qtySol),
            confidence: parseFloat(confidence),
            price_movement_5m_pct: parseFloat(priceMovement),
            expected_loss_sol: parseFloat(expectedLoss),
          }
        : undefined,
    }
    const res = await mutation.mutateAsync(payload)
    setResult(res)
  }

  return (
    <Panel
      title="Trade Cycle Control"
      icon={<Play className="h-3.5 w-3.5" />}
    >
      {isKillSwitchActive && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-semibold">
            Kill switch is ACTIVE. Trade triggers are disabled.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Trigger Source
            </Label>
            <Input
              value={triggerSource}
              onChange={(e) => setTriggerSource(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Symbol
            </Label>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Idempotency Key (optional)
            </Label>
            <Input
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              className="h-8 text-xs"
              placeholder="auto-generated if empty"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={includeProposal}
              onCheckedChange={setIncludeProposal}
            />
            <Label className="text-xs text-muted-foreground">
              Include proposal
            </Label>
          </div>
        </div>

        {includeProposal && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Side
              </Label>
              <div className="flex gap-2">
                <Button
                  variant={side === "buy" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSide("buy")}
                  className={cn(
                    "h-7 flex-1 text-xs",
                    side === "buy" && "bg-success text-success-foreground hover:bg-success/90"
                  )}
                >
                  Buy
                </Button>
                <Button
                  variant={side === "sell" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSide("sell")}
                  className={cn(
                    "h-7 flex-1 text-xs",
                    side === "sell" && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  )}
                >
                  Sell
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Qty (SOL)
              </Label>
              <Input
                type="number"
                value={qtySol}
                onChange={(e) => setQtySol(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Confidence
              </Label>
              <Input
                type="number"
                step="0.01"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Price Movement 5m %
              </Label>
              <Input
                type="number"
                step="0.01"
                value={priceMovement}
                onChange={(e) => setPriceMovement(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Expected Loss (SOL)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={expectedLoss}
                onChange={(e) => setExpectedLoss(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      <Button
        onClick={handleTrigger}
        disabled={mutation.isPending || isKillSwitchActive}
        className="mt-4 h-8 w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold"
      >
        {mutation.isPending ? "Triggering..." : "Trigger Trade Cycle"}
      </Button>

      {result && (
        <div
          className={cn(
            "mt-4 rounded-md border px-3 py-2 text-xs",
            result.status === "executed"
              ? "border-success/50 bg-success/10 text-success"
              : "border-warning/50 bg-warning/10 text-warning"
          )}
        >
          <p className="font-semibold uppercase">
            {result.status ?? (result.accepted ? "QUEUED" : "UNKNOWN")}
          </p>
          <p className="mt-1 text-foreground/80">
            Cycle: {result.cycle_id}
            {result.order_id ? ` | Order: ${result.order_id}` : ""}
            {result.fill_id ? ` | Fill: ${result.fill_id}` : ""}
          </p>
        </div>
      )}
    </Panel>
  )
}
