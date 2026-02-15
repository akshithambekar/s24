"use client"

import { useState } from "react"
import { useKillSwitch, useToggleKillSwitch } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { format } from "date-fns"

export function KillSwitchPanel() {
  const { data: ks, isLoading, isError } = useKillSwitch()
  const toggle = useToggleKillSwitch()
  const [actor, setActor] = useState("")
  const [reason, setReason] = useState("")
  const events = ks?.recent_events ?? []
  const latestEvent = events[0]

  function handleToggle() {
    toggle.mutate({
      enabled: !ks?.enabled,
      actor: actor || "dashboard-user",
      reason: reason || (ks?.enabled ? "Manual deactivation" : "Manual activation"),
    })
    setActor("")
    setReason("")
  }

  return (
    <Panel
      title="Kill Switch"
      icon={<ShieldAlert className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      <div className="flex flex-col gap-4">
        {/* Current state */}
        <div
          className={cn(
            "flex items-center justify-between rounded-md border px-4 py-3",
            ks?.enabled
              ? "border-destructive/50 bg-destructive/10"
              : "border-success/50 bg-success/10"
          )}
        >
          <div>
            <p
              className={cn(
                "text-sm font-bold uppercase",
                ks?.enabled ? "text-destructive" : "text-success"
              )}
            >
              {ks?.enabled ? "KILL SWITCH ACTIVE" : "KILL SWITCH OFF"}
            </p>
            {ks?.enabled && latestEvent?.created_at && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Updated {format(new Date(latestEvent.created_at), "yyyy-MM-dd HH:mm:ss")} by {latestEvent.actor ?? "unknown"}
              </p>
            )}
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant={ks?.enabled ? "outline" : "destructive"}
                size="sm"
                className="h-7 text-xs font-semibold"
              >
                {ks?.enabled ? "Deactivate" : "Activate"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-border bg-card text-foreground">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-foreground">
                  {ks?.enabled ? "Deactivate Kill Switch?" : "Activate Kill Switch?"}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  {ks?.enabled
                    ? "This will re-enable trading. Are you sure?"
                    : "This will immediately stop all trading activity."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Actor</Label>
                  <Input
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="Your name"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Reason</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for toggle"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleToggle}
                  className={cn(
                    "h-8 text-xs",
                    ks?.enabled
                      ? "bg-success text-success-foreground hover:bg-success/90"
                      : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  )}
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Recent events */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Events
          </p>
          {!events?.length ? (
            <EmptyState message="No kill switch events recorded." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {events.slice(0, 5).map((e) => (
                <div
                  key={e.event_id}
                  className="flex items-center justify-between rounded border border-border/50 bg-secondary/30 px-3 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        e.enabled
                          ? "bg-destructive/15 text-destructive"
                          : "bg-success/15 text-success"
                      )}
                    >
                      {e.enabled ? "activated" : "deactivated"}
                    </span>
                    <span className="text-muted-foreground">
                      by {e.actor ?? "unknown"}
                    </span>
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {format(new Date(e.created_at), "MM/dd HH:mm")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
