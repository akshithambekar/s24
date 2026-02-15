"use client"

import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  ArrowLeftRight,
  History,
  ShieldCheck,
  PanelLeft,
} from "lucide-react"
import { useState } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "trading", label: "Trading", icon: ArrowLeftRight },
  { id: "history", label: "Order History", icon: History },
  { id: "risk", label: "Risk & Strategy", icon: ShieldCheck },
] as const

export type NavSection = (typeof NAV_ITEMS)[number]["id"]

interface SidebarNavProps {
  active: NavSection
  onChange: (section: NavSection) => void
}

export function SidebarNav({ active, onChange }: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [logoHovered, setLogoHovered] = useState(false)

  function collapse() {
    setLogoHovered(false)
    setCollapsed(true)
  }

  function expand() {
    setLogoHovered(false)
    setCollapsed(false)
  }

  return (
    <TooltipProvider delayDuration={0}>
      <nav
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-200",
          collapsed ? "w-14" : "w-48"
        )}
      >
        {/* Logo + toggle */}
        <div className={cn("flex items-center py-2.5", collapsed ? "justify-center px-2" : "justify-between px-2.5")}>
          <div className="flex items-center gap-2">
            {collapsed ? (
              <button
                onClick={expand}
                onMouseEnter={() => setLogoHovered(true)}
                onMouseLeave={() => setLogoHovered(false)}
                className="flex h-7 w-7 items-center justify-center"
              >
                {logoHovered ? (
                  <PanelLeft className="h-4 w-4 text-foreground" />
                ) : (
                  <div className="brand-logo-wrap">
                    <img
                      src="/s24-crab-logo.png"
                      alt="s24 logo"
                      className="brand-logo-img"
                    />
                  </div>
                )}
              </button>
            ) : (
              <>
                <div className="brand-logo-wrap flex-shrink-0" aria-hidden="true">
                  <img
                    src="/s24-crab-logo.png"
                    alt="s24 logo"
                    className="brand-logo-img"
                  />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-primary">
                  s24
                </span>
              </>
            )}
          </div>
          {!collapsed && (
            <button
              onClick={collapse}
              className="text-muted-foreground hover:text-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
        </div>

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

      </nav>
    </TooltipProvider>
  )
}
