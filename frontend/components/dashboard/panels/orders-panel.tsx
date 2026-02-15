"use client"

import { useEffect, useMemo, useState } from "react"
import { useOrders } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { ClipboardList, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { OrderFilters } from "@/types/api"

type OrdersPanelScope = "current" | "past" | "all"

interface OrdersPanelProps {
  scope?: OrdersPanelScope
  sessionStartedAt?: string | null
  title?: string
  emptyMessage?: string
}

function isoOneMillisecondBefore(iso: string | null | undefined) {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return null
  return new Date(ts - 1).toISOString()
}

export function OrdersPanel({
  scope = "all",
  sessionStartedAt = null,
  title,
  emptyMessage,
}: OrdersPanelProps) {
  const [filters, setFilters] = useState<OrderFilters>({})
  const [symbolInput, setSymbolInput] = useState("")
  const [statusInput, setStatusInput] = useState("")
  const hasRequiredSession = scope !== "current" || Boolean(sessionStartedAt)

  const effectiveFilters = useMemo<OrderFilters>(() => {
    const next: OrderFilters = { ...filters }

    if (scope === "current") {
      next.from = sessionStartedAt ?? undefined
      next.to = undefined
    }

    if (scope === "past") {
      next.from = undefined
      next.to = isoOneMillisecondBefore(sessionStartedAt) ?? undefined
    }

    return next
  }, [filters, scope, sessionStartedAt])

  const { data, isLoading, isError } = useOrders(effectiveFilters, {
    enabled: hasRequiredSession,
  })

  const orders = hasRequiredSession ? (data?.items ?? []) : []
  const panelTitle = title ?? (scope === "past" ? "Past Orders" : "Orders")
  const resolvedEmptyMessage = !hasRequiredSession
    ? emptyMessage ?? "Start a trading session to view current orders."
    : emptyMessage ?? (scope === "past"
        ? "No past orders found."
        : "No orders match the current filters.")

  useEffect(() => {
    setFilters((prev) => ({ ...prev, cursor: undefined }))
  }, [scope, sessionStartedAt])

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
      title={panelTitle}
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
        <EmptyState message={resolvedEmptyMessage} />
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
