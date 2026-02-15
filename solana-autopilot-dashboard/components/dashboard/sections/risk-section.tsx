"use client"

import { RiskEventsPanel } from "../panels/risk-events-panel"
import { RiskPolicyPanel } from "../panels/risk-policy-panel"
import { StrategyConfigPanel } from "../panels/strategy-config-panel"
import { AnomalyPanel } from "../panels/anomaly-panel"

export function RiskSection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <RiskPolicyPanel />
        <StrategyConfigPanel />
      </div>
      <AnomalyPanel />
      <RiskEventsPanel />
    </div>
  )
}
