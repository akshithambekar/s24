"use client"

import { useEffect, useMemo, useState } from "react"
import { useFills } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { Receipt, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import type { FillFilters } from "@/types/api"

type FillsPanelScope = "current" | "past" | "all"

interface FillsPanelProps {
  scope?: FillsPanelScope
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

export function FillsPanel({
  scope = "all",
  sessionStartedAt = null,
  title,
  emptyMessage,
}: FillsPanelProps) {
  const [filters, setFilters] = useState<FillFilters>({})
  const hasRequiredSession = scope !== "current" || Boolean(sessionStartedAt)

  const effectiveFilters = useMemo<FillFilters>(() => {
    const next: FillFilters = { ...filters }

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

  const { data, isLoading, isError } = useFills(effectiveFilters, {
    enabled: hasRequiredSession,
  })

  const fills = hasRequiredSession ? (data?.items ?? []) : []
  const panelTitle = title ?? (scope === "past" ? "Past Fills" : "Fills")
  const resolvedEmptyMessage = !hasRequiredSession
    ? emptyMessage ?? "Start a trading session to view current fills."
    : emptyMessage ?? (scope === "past"
        ? "No past fills found."
        : "No fills yet. Fills appear after orders are executed on-chain.")

  useEffect(() => {
    setFilters((prev) => ({ ...prev, cursor: undefined }))
  }, [scope, sessionStartedAt])

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
      icon={<Receipt className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      {!fills.length ? (
        <EmptyState message={resolvedEmptyMessage} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Time</th>
                  <th className="py-2 pr-3 font-semibold">Symbol</th>
                  <th className="py-2 pr-3 font-semibold">Side</th>
                  <th className="py-2 pr-3 font-semibold text-right">Qty</th>
                  <th className="py-2 pr-3 font-semibold text-right">Price</th>
                  <th className="py-2 pr-3 font-semibold text-right">Fee</th>
                  <th className="py-2 font-semibold text-right">Slip (bps)</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => (
                  <tr
                    key={f.fill_id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                      {format(new Date(f.filled_at), "MM/dd HH:mm")}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{f.symbol}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          f.side === "buy"
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive"
                        )}
                      >
                        {f.side}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {Number(f.qty).toFixed(4)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      ${Number(f.fill_price).toFixed(2)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      ${Number(f.fee).toFixed(4)}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right tabular-nums",
                        Number(f.slippage_bps) > 10
                          ? "text-warning"
                          : "text-muted-foreground"
                      )}
                    >
                      {Number(f.slippage_bps).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(filters.cursor || data?.next_cursor) && (
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
          )}
        </>
      )}
    </Panel>
  )
}
