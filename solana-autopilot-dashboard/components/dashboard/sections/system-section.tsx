"use client"

import { HealthPanel } from "../panels/health-panel"
import { SchedulerPanel } from "../panels/scheduler-panel"
import { DevnetSmokePanel } from "../panels/devnet-smoke-panel"
import { MarketTicksPanel } from "../panels/market-ticks-panel"

export function SystemSection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <HealthPanel />
        <SchedulerPanel />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <MarketTicksPanel />
        <DevnetSmokePanel />
      </div>
    </div>
  )
}
