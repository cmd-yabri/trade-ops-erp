import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProfitTrendData {
  period: string;
  profit: number;
  revenue: number;
  costs: number;
}

interface ProfitTrendsChartProps {
  data: ProfitTrendData[];
}

export function ProfitTrendsChart({ data }: ProfitTrendsChartProps) {
  const [timeframe, setTimeframe] = useState<"week" | "month">("week");

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      notation: "compact",
    }).format(value);
  };

  // Filter data based on selected timeframe
  const filteredData = timeframe === "week" ? data.slice(-7) : data.slice(-30);

  return (
    <div className="bg-card rounded-xl border border-border p-6 stat-card-shadow">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-foreground">
          اتجاهات الأرباح
        </h3>
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          <Button
            variant={timeframe === "week" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTimeframe("week")}
            className={cn("h-7 text-xs", timeframe === "week" && "shadow-sm")}
          >
            أسبوعي
          </Button>
          <Button
            variant={timeframe === "month" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTimeframe("month")}
            className={cn("h-7 text-xs", timeframe === "month" && "shadow-sm")}
          >
            شهري
          </Button>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={filteredData}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          >
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(221, 83%, 53%)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(221, 83%, 53%)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="period"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              formatter={(value: number) => [formatCurrency(value), "الربح"]}
            />
            <Area
              type="monotone"
              dataKey="profit"
              stroke="hsl(221, 83%, 53%)"
              strokeWidth={2}
              fill="url(#profitGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
