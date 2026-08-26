import { useState } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { PieChart as PieIcon, Plus } from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { money, cn } from "@/lib/utils";

export type CategorySlice = { category: string; total: number };

/** Paleta de dataviz — tokens, nunca hex solto. */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

export function CategoryDonut({
  data,
  isLoading,
}: {
  data: CategorySlice[];
  isLoading: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const total = data.reduce((acc, c) => acc + c.total, 0);
  const active = hovered !== null ? data[hovered] : null;

  return (
    <Card className="flex min-w-0 flex-col">
      <CardToolbar
        icon={<PieIcon className="h-4 w-4" />}
        title="Gastos por categoria"
        description="Para onde foi o seu dinheiro este mês."
        action={
          data.length > 0 ? (
            <Button asChild variant="ghost" size="xs">
              <Link to="/relatorios">Detalhes</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 px-5 pb-6 sm:px-6">
        {isLoading ? (
          <div className="flex items-center gap-6">
            <Skeleton className="h-40 w-40 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<PieIcon />}
            title="Nenhum gasto neste mês"
            description="Assim que você registrar despesas, elas aparecem divididas por categoria aqui."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/transacoes?novo=1" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar gasto
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            {/* Donut + total no centro */}
            <div className="relative mx-auto h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="total"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={84}
                    paddingAngle={2.5}
                    cornerRadius={5}
                    stroke="none"
                    animationDuration={700}
                    onMouseEnter={(_, i) => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {data.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        opacity={hovered === null || hovered === i ? 1 : 0.35}
                        style={{ transition: "opacity 200ms var(--ease-out)" }}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                {active ? (
                  <>
                    <span className="max-w-[6.5rem] truncate text-label font-medium capitalize text-muted-foreground">
                      {active.category}
                    </span>
                    <span className="text-[1.0625rem] font-semibold tabular text-foreground">
                      {money(active.total)}
                    </span>
                    <span className="text-label tabular text-muted-foreground">
                      {total > 0 ? ((active.total / total) * 100).toFixed(0) : 0}%
                    </span>
                  </>
                ) : (
                  <>
                    <AnimatedNumber
                      value={total}
                      className="text-[1.25rem] font-semibold text-foreground"
                    />
                    <span className="text-label text-muted-foreground">Total gasto</span>
                  </>
                )}
              </div>
            </div>

            {/* Legenda */}
            <ul className="min-w-0 flex-1 space-y-1">
              {data.map((c, i) => {
                const pct = total > 0 ? (c.total / total) * 100 : 0;
                return (
                  <li
                    key={c.category}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-fast",
                      hovered === i ? "bg-muted" : "bg-transparent"
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-meta font-medium capitalize text-foreground">
                      {c.category}
                    </span>
                    <span className="shrink-0 text-meta font-semibold tabular text-foreground">
                      {money(c.total)}
                    </span>
                    <span className="w-9 shrink-0 text-right text-label tabular text-muted-foreground">
                      {pct.toFixed(0)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
