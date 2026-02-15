"use client"

import { useState } from "react"
import { useSchedulerStatus, useControlScheduler } from "@/hooks/use-api"
import { Panel } from "../panel"
import { Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

export function SchedulerPanel() {
  const { data, isLoading, isError } = useSchedulerStatus()
  const control = useControlScheduler()
  const [intervalMs, setIntervalMs] = useState("")

  function handleToggle() {
    control.mutate({
      enabled: !data?.enabled,
      interval_ms: intervalMs ? parseInt(intervalMs) : undefined,
    })
  }

  function handleUpdateInterval() {
    if (!intervalMs) return
    control.mutate({
      enabled: data?.enabled ?? false,
      interval_ms: parseInt(intervalMs),
    })
  }

  return (
    <Panel
      title="Scheduler"
      icon={<Timer className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "flex items-center justify-between rounded-md border px-4 py-3",
            data?.enabled
              ? "border-success/50 bg-success/10"
              : "border-border bg-secondary/30"
          )}
        >
          <div>
            <p
              className={cn(
                "text-sm font-bold uppercase",
                data?.enabled ? "text-success" : "text-muted-foreground"
              )}
            >
              {data?.enabled ? "ENABLED" : "DISABLED"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Interval: {data?.interval_ms ?? "---"}ms
            </p>
          </div>
          <Button
            variant={data?.enabled ? "destructive" : "default"}
            size="sm"
            onClick={handleToggle}
            disabled={control.isPending}
            className="h-7 text-xs font-semibold"
          >
            {data?.enabled ? "Disable" : "Enable"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded border border-border/50 bg-secondary/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">Last Run</p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">
              {data?.last_triggered_at
                ? format(new Date(data.last_triggered_at), "HH:mm:ss")
                : "---"}
            </p>
          </div>
          <div className="rounded border border-border/50 bg-secondary/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">Cycle Count</p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">
              {data?.cycle_count ?? 0}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Interval (ms)
            </Label>
            <Input
              type="number"
              value={intervalMs}
              onChange={(e) => setIntervalMs(e.target.value)}
              placeholder={String(data?.interval_ms ?? 10000)}
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpdateInterval}
            disabled={!intervalMs || control.isPending}
            className="h-8 text-xs"
          >
            Update
          </Button>
        </div>
      </div>
    </Panel>
  )
}
