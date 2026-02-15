"use client"

import { PortfolioPanel } from "../panels/portfolio-panel"
import { PositionsPanel } from "../panels/positions-panel"
import { OrdersPanel } from "../panels/orders-panel"
import { FillsPanel } from "../panels/fills-panel"
import { MarketTicksPanel } from "../panels/market-ticks-panel"
import { useTradingSession } from "@/hooks/use-trading-session"

export function DashboardSection() {
  const tradingSession = useTradingSession()

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PortfolioPanel />
        <MarketTicksPanel />
      </div>
      <PositionsPanel />
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
