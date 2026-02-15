"use client"

import { TradeCyclePanel } from "../panels/trade-cycle-panel"
import { KillSwitchPanel } from "../panels/kill-switch-panel"
import { OrdersPanel } from "../panels/orders-panel"
import { FillsPanel } from "../panels/fills-panel"

export function TradingSection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TradeCyclePanel />
        <KillSwitchPanel />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersPanel />
        <FillsPanel />
      </div>
    </div>
  )
}
