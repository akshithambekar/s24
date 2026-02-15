"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useKillSwitch } from "@/hooks/use-api"
import { useTradingSession } from "@/hooks/use-trading-session"
import { Panel } from "../panel"
import { Play, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { sendAgentMessage } from "@/lib/openclaw/endpoints"

export function TradeCyclePanel() {
  const qc = useQueryClient()
  const killSwitch = useKillSwitch()
  const tradingSession = useTradingSession()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isKillSwitchActive = killSwitch.data?.enabled === true
  const isStarting = tradingSession.status === "starting"
  const isStarted = tradingSession.status === "started"
  const isDisabled = isKillSwitchActive || isStarting || isStarted

  async function handleLaunch() {
    if (isDisabled) return

    setErrorMsg(null)
    tradingSession.setStarting()

    try {
      await sendAgentMessage({
        message: "/new",
        expectFinal: true,
      })

      await sendAgentMessage({
        message: "start paper trading on solana devnet",
        expectFinal: true,
      })

      tradingSession.startSession(new Date().toISOString())
      qc.invalidateQueries({ queryKey: ["orders"] })
      qc.invalidateQueries({ queryKey: ["fills"] })
      toast.success("Trading session started")
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to start trading session"
      tradingSession.setError(msg)
      setErrorMsg(msg)
    }
  }

  const buttonLabel = isStarting
    ? "Starting trading session..."
    : isStarted
      ? "Trading Session Started"
      : "Start Trading Session"

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

      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Starts a new OpenClaw trading session by sending <code>/new</code>,
          waiting for a response, then sending{" "}
          <code>start paper trading on solana devnet</code>.
        </p>

        <Button
          onClick={handleLaunch}
          disabled={isDisabled}
          className="h-8 w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold"
        >
          {isStarting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {buttonLabel}
            </>
          ) : (
            buttonLabel
          )}
        </Button>

        {/* Success */}
        {isStarted && (
          <div className="flex items-center gap-2 rounded-md border border-success/50 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="font-semibold">
              Trading session started. Start is locked until kill switch turns on.
            </span>
          </div>
        )}

        {/* Error */}
        {tradingSession.status === "error" && (errorMsg || tradingSession.errorMessage) && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{errorMsg ?? tradingSession.errorMessage}</span>
          </div>
        )}
      </div>
    </Panel>
  )
}
