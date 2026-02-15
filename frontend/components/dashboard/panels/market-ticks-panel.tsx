"use client"

import { useMarketTicks } from "@/hooks/use-api"
import { Panel, EmptyState } from "../panel"
import { BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts"
import { format } from "date-fns"

export function MarketTicksPanel() {
  const { data, isLoading, isError } = useMarketTicks("SOL-USDC", 5)
  const ticks = data?.ticks ?? []

  const chartData = ticks.map((t) => ({
    time: format(new Date(t.event_at), "HH:mm:ss"),
    mid: t.mid_price,
  }))

  const lastTick = ticks[ticks.length - 1]
  const DirectionIcon =
    data?.direction === "up"
      ? TrendingUp
      : data?.direction === "down"
        ? TrendingDown
        : Minus

  return (
    <Panel
      title="Market Ticks - SOL/USDC"
      icon={<BarChart3 className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      {!lastTick ? (
        <EmptyState message="No market data available. Ticks appear once the market feed is active." />
      ) : (
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Bid: </span>
              <span className="font-semibold tabular-nums text-foreground">
                ${lastTick.bid_price.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Ask: </span>
              <span className="font-semibold tabular-nums text-foreground">
                ${lastTick.ask_price.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Mid: </span>
              <span className="font-semibold tabular-nums text-foreground">
                ${lastTick.mid_price.toFixed(2)}
              </span>
            </div>
            <span
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                data.direction === "up"
                  ? "bg-success/15 text-success"
                  : data.direction === "down"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-secondary text-muted-foreground"
              )}
            >
              <DirectionIcon className="h-3 w-3" />
              {data.direction}
            </span>
          </div>

          {chartData.length > 1 && (
            <div className="min-h-[200px] w-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fill: "hsl(215 12% 50%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "hsl(215 12% 50%)" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(220 15% 10%)",
                      border: "1px solid hsl(220 12% 18%)",
                      borderRadius: 6,
                      fontSize: 11,
                      color: "hsl(210 15% 85%)",
                    }}
                    formatter={(value: number) => [
                      `$${value.toFixed(2)}`,
                      "Mid",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="mid"
                    stroke="hsl(185 70% 48%)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
