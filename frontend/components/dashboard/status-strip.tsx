"use client"

import { useEffect, useState } from "react"
import { useBotStatus, useKillSwitch, useHealth } from "@/hooks/use-api"
import { useGatewayHealth as useOcHealth } from "@/hooks/use-openclaw"
import { cn } from "@/lib/utils"
import { Activity, ShieldAlert, Database, Bot, Clock } from "lucide-react"

interface StatusStripProps {
  title?: string
  actions?: React.ReactNode
}

export function StatusStrip({ title, actions }: StatusStripProps) {
  const { data: bot } = useBotStatus()
  const { data: killSwitch } = useKillSwitch()
  const { data: health } = useHealth()
  const { data: ocHealth } = useOcHealth()
  const [clockText, setClockText] = useState("--:--:--")

  useEffect(() => {
    const updateClock = () => {
      setClockText(new Date().toLocaleTimeString())
    }
    updateClock()
    const id = setInterval(updateClock, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {title && (
          <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">
            {title}
          </h1>
        )}
        {actions}
      </div>
      <div className="flex items-center gap-4 text-xs">
        {/* Bot state */}
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Bot:</span>
          <span
            className={cn(
              "font-semibold uppercase",
              bot?.state === "running"
                ? "text-success"
                : bot?.state === "paused"
                  ? "text-destructive"
                  : "text-warning"
            )}
          >
            {bot?.state ?? "---"}
          </span>
        </div>

        {/* Kill switch */}
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Kill:</span>
          <span
            className={cn(
              "font-semibold uppercase",
              killSwitch?.enabled
                ? "text-destructive animate-pulse-glow"
                : "text-success"
            )}
          >
            {killSwitch?.enabled ? "ACTIVE" : "OFF"}
          </span>
        </div>

        {/* Agent */}
        <div className="hidden items-center gap-1.5 sm:flex">
          <Bot className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Agent:</span>
          <span
            className={cn(
              "font-semibold uppercase",
              ocHealth?.ok
                ? "text-success"
                : "text-destructive"
            )}
          >
            {ocHealth?.ok ? "OK" : "---"}
          </span>
        </div>

        {/* Health */}
        <div className="hidden items-center gap-1.5 sm:flex">
          <Database className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Health:</span>
          <span
            className={cn(
              "font-semibold uppercase",
              health?.status === "healthy" || health?.status === "ok"
                ? "text-success"
                : health?.status === "degraded"
                  ? "text-warning"
                  : "text-destructive"
            )}
          >
            {health?.status ?? "---"}
          </span>
        </div>

        {/* Last update */}
        <div className="hidden items-center gap-1.5 md:flex">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">
            {clockText}
          </span>
        </div>
      </div>
    </header>
  )
}
