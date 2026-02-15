"use client"

import { useState } from "react"
import { useOrders } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { ClipboardList, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { OrderFilters } from "@/types/api"

export function OrdersPanel() {
  const [filters, setFilters] = useState<OrderFilters>({})
  const [symbolInput, setSymbolInput] = useState("")
  const [statusInput, setStatusInput] = useState("")
  const { data, isLoading, isError } = useOrders(filters)

  const orders = data?.items ?? []

  function applyFilters() {
    setFilters({
      ...filters,
      symbol: symbolInput || undefined,
      status: statusInput || undefined,
      cursor: undefined,
    })
  }

  function nextPage() {
    if (data?.next_cursor) {
      setFilters({ ...filters, cursor: data.next_cursor })
    }
  }

  function prevPage() {
    setFilters({ ...filters, cursor: undefined })
  }

  return (
    <Panel
      title="Orders"
      icon={<ClipboardList className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
      actions={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Symbol"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            className="h-6 w-24 text-xs"
          />
          <Input
            placeholder="Status"
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value)}
            className="h-6 w-20 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={applyFilters}
            className="h-6 text-xs"
          >
            Filter
          </Button>
        </div>
      }
    >
      {!orders.length ? (
        <EmptyState message="No orders match the current filters." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-semibold">Time</th>
                  <th className="pb-2 pr-3 font-semibold">Symbol</th>
                  <th className="pb-2 pr-3 font-semibold">Side</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Qty</th>
                  <th className="pb-2 pr-3 font-semibold">Status</th>
                  <th className="pb-2 font-semibold">Risk Reason</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.order_id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                      {format(new Date(o.created_at), "MM/dd HH:mm")}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{o.symbol}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          o.side === "buy"
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive"
                        )}
                      >
                        {o.side}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {Number(o.qty).toFixed(4)}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                          o.status === "filled"
                          || o.status === "executed"
                            ? "bg-success/15 text-success"
                            : o.status === "rejected"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-warning/15 text-warning"
                        )}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {o.risk_reason ?? "---"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={prevPage}
              disabled={!filters.cursor}
              className="h-6 text-xs"
            >
              <ChevronLeft className="mr-1 h-3 w-3" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={nextPage}
              disabled={!data?.next_cursor}
              className="h-6 text-xs"
            >
              Next
              <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
