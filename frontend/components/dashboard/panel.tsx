"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle } from "lucide-react"
import type { ReactNode } from "react"

interface PanelProps {
  title: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  isLoading?: boolean
  isError?: boolean
  errorMessage?: string
}

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  isLoading,
  isError,
  errorMessage,
}: PanelProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[180px] flex-col rounded-md border border-border bg-card/50 backdrop-blur-sm",
        className
      )}
    >
      <div className="flex min-h-[44px] shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          <span>{title}</span>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="flex-1 p-4">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{errorMessage ?? "Failed to fetch data"}</span>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

export function StatCard({
  label,
  value,
  prefix,
  className,
  trend,
}: {
  label: string
  value: string | number
  prefix?: string
  className?: string
  trend?: "up" | "down" | "neutral"
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-secondary/30 px-4 py-3",
        className
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          trend === "up" && "text-success",
          trend === "down" && "text-destructive",
          !trend && "text-foreground"
        )}
      >
        {prefix}
        {typeof value === "number" ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}
      </p>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
