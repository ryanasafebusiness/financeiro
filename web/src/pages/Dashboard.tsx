import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PieChart as PieChartIcon,
  Gauge,
  Receipt,
  ArrowRight,
  Repeat,
  MapPin,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, brl, formatDate, formatDateTime } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction } from "@/integrations/supabase/types";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type MeResponse = {
  profile: { name: string | null; plan: string | null; is_premium: boolean };
  mes_atual: {
    total_income: number;
    total_expense: number;
    balance: number;
    count: number;
  };
  gasto_por_categoria: { category: string; total: number }[];
  limites: {
    category: string;
    period: "monthly" | "weekly";
    limit: number;
    spent: number;
    remaining: number;
    exceeded: boolean;
    pct: number;
  }[];
};

const PIE_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
];

function limitBadge(limite: MeResponse["limites"][number]) {
  if (limite.exceeded || limite.pct > 100) {
    return <Badge variant="destructive">Excedido</Badge>;
  }
  if (limite.pct >= 80) {
    return <Badge variant="warning">Atenção</Badge>;
  }
  return <Badge variant="success">No limite</Badge>;
}

function StatCard({
  title,
  value,
  icon,
  valueClassName,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", valueClassName)}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MeResponse> => {
      return (await api.me()) as MeResponse;
    },
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ["dashboard-transactions", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });

  const greetingName = me?.profile?.name || "tudo bem";

  const categorias = (me?.gasto_por_categoria ?? [])
    .map((c) => ({ category: c.category, total: Number(c.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const limites = me?.limites ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {meLoading ? "Olá 👋" : `Olá, ${greetingName} 👋`}
        </h1>
        <p className="text-muted-foreground">
          Aqui está a visão geral das suas finanças deste mês.
        </p>
      </div>

      {/* Cards de topo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {meLoading ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        ) : (
          <>
            <StatCard
              title="Saldo do mês"
              value={brl(Number(me?.mes_atual.balance ?? 0))}
              icon={<Wallet className="h-4 w-4" />}
              valueClassName={
                Number(me?.mes_atual.balance ?? 0) >= 0
                  ? "text-emerald-600"
                  : "text-destructive"
              }
            />
            <StatCard
              title="Receitas"
              value={brl(Number(me?.mes_atual.total_income ?? 0))}
              icon={<TrendingUp className="h-4 w-4" />}
              valueClassName="text-emerald-600"
            />
            <StatCard
              title="Gastos"
              value={brl(Number(me?.mes_atual.total_expense ?? 0))}
              icon={<TrendingDown className="h-4 w-4" />}
              valueClassName="text-destructive"
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Gastos por categoria */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-primary" />
              <CardTitle>Gastos por categoria</CardTitle>
            </div>
            <CardDescription>Para onde foi o seu dinheiro este mês.</CardDescription>
          </CardHeader>
          <CardContent>
            {meLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : categorias.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <PieChartIcon className="mb-2 h-10 w-10 opacity-40" />
                <p>Nenhum gasto registrado neste mês.</p>
                <p className="text-sm">
                  Registre despesas pelo WhatsApp para ver seus gráficos aqui.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categorias}
                        dataKey="total"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {categorias.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => brl(Number(value))}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2">
                  {categorias.map((c, index) => (
                    <li
                      key={c.category}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{
                            backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                          }}
                        />
                        <span className="capitalize">{c.category}</span>
                      </span>
                      <span className="font-medium">{brl(c.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Limites */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              <CardTitle>Limites de gastos</CardTitle>
            </div>
            <CardDescription>Acompanhe o quanto já usou de cada limite.</CardDescription>
          </CardHeader>
          <CardContent>
            {meLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : limites.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Gauge className="mb-2 h-10 w-10 opacity-40" />
                <p>Você ainda não definiu nenhum limite.</p>
                <p className="text-sm">
                  Crie limites para não gastar mais do que planejou.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/limites">Criar limite</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-4">
                {limites.map((limite) => {
                  const pct = Math.max(0, Math.min(100, Number(limite.pct)));
                  return (
                    <li key={`${limite.category}-${limite.period}`}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize">
                            {limite.category === "geral" ? "Geral (total)" : limite.category}
                          </span>
                          {limitBadge(limite)}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {brl(Number(limite.spent))} / {brl(Number(limite.limit))}
                        </span>
                      </div>
                      <Progress value={pct} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Últimas transações */}
      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle>Últimas transações</CardTitle>
            </div>
            <CardDescription>Seus lançamentos mais recentes.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/transacoes" className="flex items-center gap-1">
              Ver todas
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {txLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Receipt className="mb-2 h-10 w-10 opacity-40" />
              <p>Nenhuma transação registrada ainda.</p>
              <p className="text-sm">
                Envie uma mensagem no WhatsApp ou adicione manualmente.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {transactions.map((tx) => {
                const isIncome = tx.type === "income";
                const amount = Number(tx.amount);
                const title = tx.title ?? tx.category ?? "Transação";
                const isRecurring = tx.source === "recurring";
                const dateLabel = tx.occurred_at
                  ? formatDateTime(tx.occurred_at)
                  : formatDate(tx.occurred_on);
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-bold">{title}</p>
                        <Badge variant={isIncome ? "success" : "secondary"}>
                          {isIncome ? "receita" : "gasto"}
                        </Badge>
                        {isRecurring && (
                          <Badge variant="outline" className="flex items-center gap-1">
                            <Repeat className="h-3 w-3" />
                            recorrente
                          </Badge>
                        )}
                      </div>
                      {tx.description && (
                        <p className="truncate text-sm text-muted-foreground">
                          {tx.description}
                        </p>
                      )}
                      {tx.location && (
                        <p className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{tx.location}</span>
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {dateLabel}
                        {tx.category && (
                          <>
                            {" · "}
                            <span className="capitalize">{tx.category}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-lg font-bold",
                        isIncome ? "text-emerald-600" : "text-destructive"
                      )}
                    >
                      {isIncome ? "+" : "-"}
                      {brl(Math.abs(amount))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
