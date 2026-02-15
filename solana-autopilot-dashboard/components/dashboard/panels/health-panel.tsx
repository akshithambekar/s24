"use client"

import { useHealth, useDeployStatus } from "@/hooks/use-api"
import { Panel } from "../panel"
import { HeartPulse } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

export function HealthPanel() {
  const { data: health, isLoading: hLoading, isError: hError } = useHealth()
  const { data: deploy } = useDeployStatus()

  return (
    <Panel
      title="System Health"
      icon={<HeartPulse className="h-3.5 w-3.5" />}
      isLoading={hLoading}
      isError={hError}
    >
      <div className="flex flex-col gap-4">
        {/* Overall status */}
        <div
          className={cn(
            "flex items-center justify-between rounded-md border px-4 py-3",
            health?.status === "healthy"
              ? "border-success/50 bg-success/10"
              : health?.status === "degraded"
                ? "border-warning/50 bg-warning/10"
                : "border-destructive/50 bg-destructive/10"
          )}
        >
          <span
            className={cn(
              "text-sm font-bold uppercase",
              health?.status === "healthy"
                ? "text-success"
                : health?.status === "degraded"
                  ? "text-warning"
                  : "text-destructive"
            )}
          >
            {health?.status ?? "UNKNOWN"}
          </span>
          {deploy && (
            <span className="text-[10px] text-muted-foreground">
              Deploy: {deploy.status} at {format(new Date(deploy.timestamp), "yyyy-MM-dd HH:mm")}
            </span>
          )}
        </div>

        {/* Dependencies */}
        {health?.dependencies && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Dependencies
            </p>
            <div className="flex flex-col gap-1.5">
              {Object.entries(health.dependencies).map(([name, dep]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded border border-border/50 bg-secondary/30 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-foreground">{name}</span>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        dep === "healthy" || dep === "ok"
                          ? "bg-success/15 text-success"
                          : dep === "degraded" || dep === "stale" || dep === "unknown"
                            ? "bg-warning/15 text-warning"
                            : "bg-destructive/15 text-destructive"
                      )}
                    >
                      {dep}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
