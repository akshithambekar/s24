"use client"

import { useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { SidebarNav, type NavSection } from "./sidebar-nav"
import { StatusStrip } from "./status-strip"
import { KillSwitchBanner } from "./kill-switch-banner"
import { CommandPalette } from "./command-palette"
import { DashboardSection } from "./sections/dashboard-section"
import { TradingSection } from "./sections/trading-section"
import { RiskSection } from "./sections/risk-section"
import { SystemSection } from "./sections/system-section"
import { LogsSection } from "./sections/logs-section"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Command } from "lucide-react"

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: "Dashboard Overview",
  trading: "Trading Control",
  risk: "Risk & Strategy",
  system: "System Health",
  logs: "Logs",
}

export function DashboardShell() {
  const [section, setSection] = useState<NavSection>("dashboard")
  const qc = useQueryClient()

  const handleRefreshAll = useCallback(() => {
    qc.invalidateQueries()
    toast.success("Refreshing all data...")
  }, [qc])

  const handleTriggerCycle = useCallback(() => {
    setSection("trading")
    toast.info("Navigate to Trading to trigger a cycle")
  }, [])

  const handleToggleKillSwitch = useCallback(() => {
    setSection("trading")
    toast.info("Navigate to Trading to toggle kill switch")
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <KillSwitchBanner />
      <StatusStrip />

      <div className="flex flex-1 overflow-hidden">
        <SidebarNav active={section} onChange={setSection} />

        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-3">
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">
              {SECTION_TITLES[section]}
            </h1>
            <Button
              variant="outline"
              size="sm"
              className="hidden h-7 gap-1.5 text-xs text-muted-foreground sm:flex"
              onClick={() => {
                // Dispatch keyboard shortcut to open command palette
                document.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    metaKey: true,
                  })
                )
              }}
            >
              <Command className="h-3 w-3" />
              <span>Quick Actions</span>
              <kbd className="pointer-events-none ml-1 inline-flex h-4 items-center rounded border border-border bg-secondary px-1 font-mono text-[10px] text-muted-foreground">
                {"K"}
              </kbd>
            </Button>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {section === "dashboard" && <DashboardSection />}
              {section === "trading" && <TradingSection />}
              {section === "risk" && <RiskSection />}
              {section === "system" && <SystemSection />}
              {section === "logs" && <LogsSection />}
            </div>
          </ScrollArea>
        </main>
      </div>

      <CommandPalette
        onNavigate={setSection}
        onTriggerCycle={handleTriggerCycle}
        onToggleKillSwitch={handleToggleKillSwitch}
        onRefreshAll={handleRefreshAll}
      />
    </div>
  )
}
