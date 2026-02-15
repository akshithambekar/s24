"use client"

import { useRef, useEffect, useState } from "react"
import { useLogs } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { ScrollText } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"

export function LogsPanel() {
  const { data, isLoading, isError } = useLogs(100)
  const [autoScroll, setAutoScroll] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const lines = data?.logs ?? []

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [data, autoScroll])

  return (
    <Panel
      title="Deploy Logs"
      icon={<ScrollText className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
      actions={
        <div className="flex items-center gap-2">
          <Switch
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
            className="scale-75"
          />
          <Label className="text-[10px] text-muted-foreground">
            Auto-scroll
          </Label>
        </div>
      }
    >
      {!lines.length ? (
        <EmptyState message="No logs available. Logs appear once the deploy agent is connected." />
      ) : (
        <ScrollArea className="h-80">
          <div className="flex flex-col gap-0.5 font-mono text-[11px]">
            {lines.map((line, i) => (
              <div
                key={i}
                className="flex gap-2 whitespace-pre-wrap break-all leading-relaxed"
              >
                <span className="select-none text-muted-foreground/50 tabular-nums">
                  {String(i + 1).padStart(3, "0")}
                </span>
                <span className="text-foreground/90">{line}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      )}
    </Panel>
  )
}
