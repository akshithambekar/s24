"use client"

import { usePositions } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

export function PositionsPanel() {
  const { data, isLoading, isError } = usePositions()
  const positions = data?.items ?? []

  return (
    <Panel
      title="Open Positions"
      icon={<TrendingUp className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      {!positions.length ? (
        <EmptyState message="No open positions. Positions will appear after trades execute." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-semibold">Symbol</th>
                <th className="pb-2 pr-4 font-semibold text-right">Qty</th>
                <th className="pb-2 pr-4 font-semibold text-right">Avg Entry</th>
                <th className="pb-2 pr-4 font-semibold text-right">Mark</th>
                <th className="pb-2 pr-4 font-semibold text-right">Unreal. PnL</th>
                <th className="pb-2 font-semibold text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr
                  key={p.symbol}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="py-2 pr-4 font-semibold text-foreground">
                    {p.symbol}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {Number(p.qty).toFixed(4)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    ${Number(p.avg_entry_price).toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    ${Number(p.mark_price).toFixed(2)}
                  </td>
                  <td
                    className={cn(
                      "py-2 pr-4 text-right font-semibold tabular-nums",
                      Number(p.unrealized_pnl) >= 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    ${Number(p.unrealized_pnl).toFixed(2)}
                  </td>
                  <td className="py-2 text-right text-muted-foreground">
                    {format(new Date(p.updated_at), "HH:mm:ss")}
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
