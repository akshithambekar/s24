"use client"

import { useSmokeRuns } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { FlaskConical } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

export function DevnetSmokePanel() {
  const { data, isLoading, isError } = useSmokeRuns()
  const runs = data?.items ?? []

  return (
    <Panel
      title="Devnet Smoke Runs"
      icon={<FlaskConical className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      {!runs.length ? (
        <EmptyState message="No smoke runs recorded. Runs appear after devnet tests execute." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-3 font-semibold">Ran At</th>
                <th className="pb-2 pr-3 font-semibold">Status</th>
                <th className="pb-2 pr-3 font-semibold text-right">RPC Latency</th>
                <th className="pb-2 pr-3 font-semibold">Wallet</th>
                <th className="pb-2 font-semibold">TX Sim</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.run_id}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                    {format(new Date(r.ran_at), "MM/dd HH:mm")}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        r.status === "passed"
                          ? "bg-success/15 text-success"
                          : "bg-destructive/15 text-destructive"
                      )}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.rpc_latency_ms === null ? "---" : `${r.rpc_latency_ms}ms`}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase",
                        r.wallet_check === "ok"
                          ? "text-success"
                          : "text-destructive"
                      )}
                    >
                      {r.wallet_check}
                    </span>
                  </td>
                  <td className="py-2">
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase",
                        r.tx_simulation === "ok"
                          ? "text-success"
                          : "text-destructive"
                      )}
                    >
                      {r.tx_simulation}
                    </span>
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
