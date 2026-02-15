"use client"

import { useGatewayStatus, useGatewayHealth } from "@/hooks/use-openclaw"
import { Panel, StatCard } from "../panel"
import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"

export function AgentStatusPanel() {
  const {
    data: status,
    isLoading: sLoading,
    isError: sError,
  } = useGatewayStatus()
  const { data: health } = useGatewayHealth()

  const session = status?.sessions?.recent?.[0]
  const agent = status?.heartbeat?.agents?.[0]

  const model = session?.model ?? "---"
  const percentUsed = session?.percentUsed != null ? `${session.percentUsed}%` : "---"
  const tokensRemaining =
    session?.remainingTokens != null
      ? `${Math.round(session.remainingTokens / 1000)}k`
      : "---"

  return (
    <Panel
      title="Agent Status"
      icon={<Bot className="h-3.5 w-3.5" />}
      isLoading={sLoading}
      isError={sError}
    >
      <div className="flex flex-col gap-4">
        {/* Gateway health */}
        <div
          className={cn(
            "flex items-center justify-between rounded-md border px-4 py-3",
            health?.ok
              ? "border-success/50 bg-success/10"
              : "border-destructive/50 bg-destructive/10"
          )}
        >
          <span
            className={cn(
              "text-sm font-bold uppercase",
              health?.ok ? "text-success" : "text-destructive"
            )}
          >
            {health?.ok ? "CONNECTED" : "DISCONNECTED"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Agent: {status?.heartbeat?.defaultAgentId ?? "---"}
            {agent?.enabled ? ` | HB: ${agent.every}` : ""}
          </span>
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Model" value={model} />
          <StatCard label="Context Used" value={percentUsed} />
          <StatCard label="Tokens Left" value={tokensRemaining} />
        </div>

        {/* Channel summary */}
        {status?.channelSummary && status.channelSummary.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Channels
            </p>
            <div className="flex flex-col gap-1.5">
              {status.channelSummary.map((line) => (
                <div
                  key={line}
                  className="flex items-center justify-between rounded border border-border/50 bg-secondary/30 px-3 py-2 text-xs"
                >
                  <span className="text-foreground">{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
