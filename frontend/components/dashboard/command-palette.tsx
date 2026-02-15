"use client"

import { useEffect, useState } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Play,
  ShieldAlert,
  RefreshCw,
  History,
  LayoutDashboard,
  ArrowLeftRight,
  ShieldCheck,
} from "lucide-react"
import type { NavSection } from "./sidebar-nav"

interface CommandPaletteProps {
  onNavigate: (section: NavSection) => void
  onTriggerCycle: () => void
  onToggleKillSwitch: () => void
  onRefreshAll: () => void
}

export function CommandPalette({
  onNavigate,
  onTriggerCycle,
  onToggleKillSwitch,
  onRefreshAll,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  function run(fn: () => void) {
    fn()
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." className="text-foreground" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onTriggerCycle)}>
            <Play className="mr-2 h-4 w-4 text-primary" />
            <span>Trigger Trade Cycle</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onToggleKillSwitch)}>
            <ShieldAlert className="mr-2 h-4 w-4 text-destructive" />
            <span>Toggle Kill Switch</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onRefreshAll)}>
            <RefreshCw className="mr-2 h-4 w-4 text-accent" />
            <span>Refresh All Data</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => onNavigate("dashboard"))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onNavigate("trading"))}>
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            <span>Trading</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onNavigate("history"))}>
            <History className="mr-2 h-4 w-4" />
            <span>Order History</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onNavigate("risk"))}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            <span>Risk & Strategy</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
