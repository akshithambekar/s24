"use client"

import { usePortfolioSnapshots } from "@/hooks/use-api"
import { Panel, StatCard, EmptyState } from "../panel"
import { Wallet } from "lucide-react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"
import { format } from "date-fns"

export function PortfolioPanel() {
  const { data, isLoading, isError } = usePortfolioSnapshots()

  const snapshots = data?.items ?? []
  const latest = snapshots[0]
  const chartData = [...snapshots].reverse().map((s) => ({
    time: format(new Date(s.captured_at), "HH:mm"),
    nav: Number(s.nav),
  }))

  return (
    <Panel
      title="Portfolio Overview"
      icon={<Wallet className="h-3.5 w-3.5" />}
      isLoading={isLoading}
      isError={isError}
    >
      {!latest ? (
        <EmptyState message="No portfolio snapshots yet. The bot will populate this once trading begins." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="NAV (SOL)"
              value={Number(latest.nav)}
            />
            <StatCard
              label="Cash (SOL)"
              value={Number(latest.cash)}
            />
            <StatCard
              label="Realized PnL (SOL)"
              value={Number(latest.realized_pnl)}
              trend={Number(latest.realized_pnl) >= 0 ? "up" : "down"}
            />
            <StatCard
              label="Unrealized PnL (SOL)"
              value={Number(latest.unrealized_pnl)}
              trend={Number(latest.unrealized_pnl) >= 0 ? "up" : "down"}
            />
          </div>

          {chartData.length > 1 && (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(220 12% 18%)"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: "hsl(215 12% 50%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(215 12% 50%)" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => `${v.toFixed(2)}`}
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
                      `${value.toFixed(4)} SOL`,
                      "NAV",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="nav"
                    stroke="hsl(162 63% 48%)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: "hsl(162 63% 48%)" }}
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
