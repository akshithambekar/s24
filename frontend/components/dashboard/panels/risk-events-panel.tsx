"use client"

import { useRiskEvents } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { ShieldCheck } from "lucide-react"
import { format } from "date-fns"

export function RiskEventsPanel() {
  const { data, isLoading, isError } = useRiskEvents()
  const events = data?.items ?? []

  return (
    <Panel
      title="Risk Events"
      icon={<ShieldCheck className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      {!events.length ? (
        <EmptyState message="No risk events recorded. Events appear when risk rules trigger." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-3 font-semibold">Time</th>
                <th className="pb-2 pr-3 font-semibold">Action</th>
                <th className="pb-2 pr-3 font-semibold">Rule</th>
                <th className="pb-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.risk_event_id}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                    {format(new Date(e.created_at), "MM/dd HH:mm")}
                  </td>
                  <td className="py-2 pr-3 font-semibold text-warning">
                    {e.action}
                  </td>
                  <td className="py-2 pr-3 text-foreground">{e.rule}</td>
                  <td className="py-2 text-muted-foreground">
                    {JSON.stringify(e.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
