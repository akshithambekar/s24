"use client"

import { useState } from "react"
import { useBotStatus, useKillSwitch, useHealth } from "@/hooks/use-api"
import { cn } from "@/lib/utils"
import { Activity, ShieldAlert, Database, Clock } from "lucide-react"

export function StatusStrip() {
  const { data: bot } = useBotStatus()
  const { data: killSwitch } = useKillSwitch()
  const { data: health } = useHealth()
  const [logoError, setLogoError] = useState(false)

  return (
    <header className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div className="brand-logo-wrap" aria-hidden="true">
          {!logoError ? (
            <img
              src="/s24-crab-logo.png"
              alt="s24 logo"
              className="brand-logo-img"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="brand-logo-fallback">s24</div>
          )}
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">
            s24
          </span>
          <span className="mt-0.5 text-[10px] text-muted-foreground">
            {bot?.mode ? bot.mode.toUpperCase() : ""}
          </span>
        </div>
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
            {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>
    </header>
  )
}
