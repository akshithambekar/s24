"use client"

import { LogsPanel } from "../panels/logs-panel"

export function LogsSection() {
  return (
    <div className="flex flex-col gap-4">
      <LogsPanel />
    </div>
  )
}
