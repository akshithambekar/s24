"use client"

import { TradeCyclePanel } from "../panels/trade-cycle-panel"
import { KillSwitchPanel } from "../panels/kill-switch-panel"
import { OrdersPanel } from "../panels/orders-panel"
import { FillsPanel } from "../panels/fills-panel"
import { useTradingSession } from "@/hooks/use-trading-session"

export function TradingSection() {
  const tradingSession = useTradingSession()

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TradeCyclePanel />
        <KillSwitchPanel />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersPanel
          scope="current"
          sessionStartedAt={tradingSession.startedAt}
          emptyMessage="Start a trading session to view current orders."
        />
        <FillsPanel
          scope="current"
          sessionStartedAt={tradingSession.startedAt}
          emptyMessage="Start a trading session to view current fills."
        />
      </div>
    </div>
  )
}
