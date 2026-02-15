"use client"

import { PortfolioPanel } from "../panels/portfolio-panel"
import { PositionsPanel } from "../panels/positions-panel"
import { OrdersPanel } from "../panels/orders-panel"
import { FillsPanel } from "../panels/fills-panel"
import { MarketTicksPanel } from "../panels/market-ticks-panel"

export function DashboardSection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PortfolioPanel />
        <MarketTicksPanel />
      </div>
      <PositionsPanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersPanel />
        <FillsPanel />
      </div>
    </div>
  )
}
