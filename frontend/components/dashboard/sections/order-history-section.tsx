"use client"

import { OrdersPanel } from "../panels/orders-panel"
import { FillsPanel } from "../panels/fills-panel"
import { useTradingSession } from "@/hooks/use-trading-session"

export function OrderHistorySection() {
  const tradingSession = useTradingSession()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <OrdersPanel
        scope="past"
        sessionStartedAt={tradingSession.startedAt}
        title="Past Orders"
        emptyMessage="No past orders found."
      />
      <FillsPanel
        scope="past"
        sessionStartedAt={tradingSession.startedAt}
        title="Past Fills"
        emptyMessage="No past fills found."
      />
    </div>
  )
}
