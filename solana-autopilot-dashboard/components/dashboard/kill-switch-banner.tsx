"use client"

import { useKillSwitch } from "@/hooks/use-api"
import { AlertTriangle } from "lucide-react"

export function KillSwitchBanner() {
  const { data } = useKillSwitch()
  const latestReason = data?.recent_events?.[0]?.reason

  if (!data?.enabled) return null

  return (
    <div className="flex items-center justify-center gap-2 bg-destructive/15 px-4 py-1.5 text-xs font-semibold text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 animate-pulse-glow" />
      <span>KILL SWITCH ACTIVE - All trading is halted</span>
      {latestReason && (
        <span className="text-destructive/70">({latestReason})</span>
      )}
    </div>
  )
}
