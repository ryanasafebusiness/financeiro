import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardToolbar } from "@/components/ui/card";
import { Segmented } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils";
import { FLOW_RANGES, type FlowPoint, type FlowRange } from "@/hooks/useDashboardData";
import { Activity, Plus } from "lucide-react";
import { Link } from "react-router-dom";

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : String(Math.round(n));

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="mb-1.5 text-label font-semibold text-muted-foreground">{label}</p>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-3 text-meta">
            <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
              {p.dataKey}
            </span>
            <span className="ml-auto font-semibold tabular text-foreground">{money(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fluxo financeiro: receitas x despesas, visual Apple/Stripe. */
export function CashflowChart({
  data,
  range,
  onRangeChange,
  isLoading,
  hasData,
}: {
  data: FlowPoint[];
  range: FlowRange;
  onRangeChange: (r: FlowRange) => void;
  isLoading: boolean;
  hasData: boolean;
}) {
  return (
    <Card className="min-w-0">
      <CardToolbar
        icon={<Activity className="h-4 w-4" />}
        title="Fluxo financeiro"
        description="Receitas e despesas ao longo do tempo."
        action={<Segmented value={range} onChange={onRangeChange} options={FLOW_RANGES} />}
      />
      <div className="px-3 pb-5 pt-1 sm:px-4">
        {isLoading ? (
          <Skeleton className="h-[260px] w-full rounded-lg" />
        ) : !hasData ? (
          <EmptyState
            icon={<Activity />}
            title="Sem movimentações no período"
            description="Registre uma receita ou um gasto pelo WhatsApp para o gráfico começar a ganhar forma."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/transacoes?novo=1" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar transação
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-receitas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-despesas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--negative)" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="var(--negative)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 6"
                  opacity={0.7}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  dy={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={compact}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="receitas"
                  stroke="var(--positive)"
                  strokeWidth={2}
                  fill="url(#grad-receitas)"
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  animationDuration={700}
                />
                <Area
                  type="monotone"
                  dataKey="despesas"
                  stroke="var(--negative)"
                  strokeWidth={2}
                  fill="url(#grad-despesas)"
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  animationDuration={700}
                  animationBegin={120}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {hasData && !isLoading && (
          <div className="mt-3 flex items-center justify-center gap-5 text-label text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-pill bg-positive" /> Receitas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-pill bg-negative" /> Despesas
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
