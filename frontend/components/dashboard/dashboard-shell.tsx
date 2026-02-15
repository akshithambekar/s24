"use client"

import { useState, useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { SidebarNav, type NavSection } from "./sidebar-nav"
import { StatusStrip } from "./status-strip"
import { KillSwitchBanner } from "./kill-switch-banner"
import { CommandPalette } from "./command-palette"
import { DashboardSection } from "./sections/dashboard-section"
import { TradingSection } from "./sections/trading-section"
import { OrderHistorySection } from "./sections/order-history-section"
import { RiskSection } from "./sections/risk-section"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Command } from "lucide-react"
import { useKillSwitch } from "@/hooks/use-api"
import { useTradingSession } from "@/hooks/use-trading-session"

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: "Dashboard Overview",
  trading: "Trading Control",
  history: "Order History",
  risk: "Risk & Strategy",
}

export function DashboardShell() {
  const [section, setSection] = useState<NavSection>("dashboard")
  const qc = useQueryClient()
  const { data: killSwitch } = useKillSwitch()
  const tradingSession = useTradingSession()

  useEffect(() => {
    if (!killSwitch?.enabled || !tradingSession.isActive) return

    tradingSession.endSession()
    qc.invalidateQueries({ queryKey: ["orders"] })
    qc.invalidateQueries({ queryKey: ["fills"] })
  }, [killSwitch?.enabled, tradingSession.isActive, tradingSession.endSession, qc])

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
    <div className="flex h-screen overflow-hidden">
      <SidebarNav active={section} onChange={setSection} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <KillSwitchBanner />
        <StatusStrip
          title={SECTION_TITLES[section]}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="hidden h-6 gap-1.5 text-xs text-muted-foreground sm:flex"
              onClick={() => {
                document.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    metaKey: true,
                  })
                )
              }}
            >
              <span>Quick Actions</span>
              <Command className="ml-1 h-2.5 w-2.5 text-muted-foreground" />
              <kbd className="pointer-events-none inline-flex h-4 items-center rounded border border-border bg-secondary px-1 font-mono text-[10px] text-muted-foreground">
                K
              </kbd>
            </Button>
          }
        />

        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {section === "dashboard" && <DashboardSection />}
              {section === "trading" && <TradingSection />}
              {section === "history" && <OrderHistorySection />}
              {section === "risk" && <RiskSection />}
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
