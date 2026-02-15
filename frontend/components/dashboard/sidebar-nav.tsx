"use client"

import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  ArrowLeftRight,
  History,
  ShieldCheck,
  HeartPulse,
  ScrollText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "trading", label: "Trading", icon: ArrowLeftRight },
  { id: "history", label: "Order History", icon: History },
  { id: "risk", label: "Risk & Strategy", icon: ShieldCheck },
  { id: "system", label: "System Health", icon: HeartPulse },
  { id: "logs", label: "Logs", icon: ScrollText },
] as const

export type NavSection = (typeof NAV_ITEMS)[number]["id"]

interface SidebarNavProps {
  active: NavSection
  onChange: (section: NavSection) => void
}

export function SidebarNav({ active, onChange }: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <TooltipProvider delayDuration={0}>
      <nav
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-200",
          collapsed ? "w-14" : "w-48"
        )}
      >
        <div className="flex flex-1 flex-col gap-1 px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onChange(item.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2.5 py-2 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="text-xs">
                    {item.label}
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}
        </div>

        <div className="border-t border-border px-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full justify-center text-muted-foreground hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      </nav>
    </TooltipProvider>
  )
}
