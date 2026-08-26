import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Dropdown, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { money, cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction } from "@/integrations/supabase/types";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  currentMonthChip,
  currentMonthLabel,
  pctChange,
  useDashboardData,
  type FlowRange,
} from "@/hooks/useDashboardData";

import { MetricCard, MetricCardSkeleton } from "@/components/dashboard/MetricCard";
import { CashflowChart } from "@/components/dashboard/CashflowChart";
import { CategoryDonut } from "@/components/dashboard/CategoryDonut";
import { LimitsCard, type LimitItem } from "@/components/dashboard/LimitsCard";
import { GoalsCard } from "@/components/dashboard/GoalsCard";
import { InsightsCard, type Insight } from "@/components/dashboard/InsightsCard";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { QuickActions } from "@/components/dashboard/QuickActions";

type MeResponse = {
  profile: { name: string | null; plan: string | null; is_premium: boolean };
  mes_atual: {
    total_income: number;
    total_expense: number;
    balance: number;
    count: number;
  };
  gasto_por_categoria: { category: string; total: number }[];
  limites: LimitItem[];
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<FlowRange>("30d");

  // Fonte oficial dos totais do mês (regra de negócio do backend).
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MeResponse> => (await api.me()) as MeResponse,
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

  // Séries, comparativos e metas — derivados das tabelas existentes.
  const {
    isLoading: seriesLoading,
    previous,
    prevByCategory,
    series,
    flow,
    hasFlowData,
    daysInMonth,
    dayOfMonth,
    goals,
    goalsLoading,
  } = useDashboardData(range);

  const income = Number(me?.mes_atual.total_income ?? 0);
  const expense = Number(me?.mes_atual.total_expense ?? 0);
  const balance = Number(me?.mes_atual.balance ?? 0);

  const categorias = useMemo(
    () =>
      (me?.gasto_por_categoria ?? [])
        .map((c) => ({ category: c.category, total: Number(c.total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 6),
    [me]
  );

  const limites = me?.limites ?? [];
  const firstName = me?.profile?.name?.trim().split(/\s+/)[0] ?? "";

  /**
   * Insights calculados a partir dos dados reais do usuário. Sem histórico
   * suficiente a lista fica vazia e o card mostra seu estado vazio.
   */
  const insights: Insight[] = useMemo(() => {
    if (meLoading || seriesLoading) return [];
    const list: Insight[] = [];

    // 1) Maior variação de gasto por categoria vs. mês anterior.
    let best: { category: string; diffPct: number } | null = null;
    for (const c of categorias) {
      const prev = prevByCategory.get(c.category.toLowerCase());
      if (!prev || prev <= 0) continue;
      const diff = ((c.total - prev) / prev) * 100;
      if (Math.abs(diff) < 5) continue;
      if (!best || Math.abs(diff) > Math.abs(best.diffPct)) {
        best = { category: c.category, diffPct: diff };
      }
    }
    if (best) {
      const down = best.diffPct < 0;
      list.push({
        id: "categoria",
        kind: down ? "trend-down" : "trend-up",
        tone: down ? "positive" : "negative",
        text: `Você gastou ${Math.abs(best.diffPct).toFixed(0)}% ${down ? "menos" : "mais"} com ${best.category} neste mês.`,
      });
    }

    // 2) Projeção de sobra no fim do mês, no ritmo atual.
    if (dayOfMonth >= 5 && (income > 0 || expense > 0)) {
      const projectedExpense = (expense / dayOfMonth) * daysInMonth;
      const projected = income - projectedExpense;
      list.push({
        id: "projecao",
        kind: "projection",
        tone: projected >= 0 ? "positive" : "negative",
        text:
          projected >= 0
            ? `Se continuar neste ritmo, sobrarão aproximadamente ${money(projected)} no fim do mês.`
            : `No ritmo atual, o mês deve fechar com cerca de ${money(Math.abs(projected))} a mais em gastos do que em receitas.`,
      });
    }

    return list;
  }, [meLoading, seriesLoading, categorias, prevByCategory, income, expense, dayOfMonth, daysInMonth]);

  const loadingCards = meLoading || seriesLoading;

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-page-title font-bold text-foreground">
            {meLoading || !firstName ? "Olá 👋" : `Olá, ${firstName} 👋`}
          </h1>
          <p className="mt-1 text-body text-muted-foreground">
            Aqui está o resumo das suas finanças em {currentMonthLabel()}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de período: o resumo é sempre do mês corrente;
              os demais períodos abrem em Relatórios. */}
          <Dropdown
            trigger={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-meta font-medium text-foreground shadow-xs transition-colors duration-fast hover:border-border-strong"
              >
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                {currentMonthChip()}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-fast",
                    open && "rotate-180"
                  )}
                />
              </button>
            )}
          >
            <DropdownLabel>Período</DropdownLabel>
            <DropdownItem icon={<Check />}>{currentMonthChip()} (atual)</DropdownItem>
            <DropdownItem onSelect={() => navigate("/relatorios?periodo=passado")}>
              Mês passado
            </DropdownItem>
            <DropdownItem onSelect={() => navigate("/relatorios?periodo=tres")}>
              Últimos 3 meses
            </DropdownItem>
            <DropdownItem onSelect={() => navigate("/relatorios?periodo=ano")}>
              Este ano
            </DropdownItem>
          </Dropdown>
          <QuickActions />
        </div>
      </div>

      {/* ── Cards financeiros: saldo com mais peso ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
        {loadingCards ? (
          <>
            <MetricCardSkeleton emphasis className="sm:col-span-2" />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              className="sm:col-span-2"
              emphasis
              label="Saldo do mês"
              value={balance}
              delta={pctChange(balance, previous.balance)}
              series={series.balance}
              icon={<Wallet />}
              tone={balance >= 0 ? "neutral" : "negative"}
            />
            <MetricCard
              label="Receitas"
              value={income}
              delta={pctChange(income, previous.income)}
              series={series.income}
              icon={<TrendingUp />}
              tone="positive"
            />
            <MetricCard
              label="Gastos"
              value={expense}
              delta={pctChange(expense, previous.expense)}
              series={series.expense}
              icon={<TrendingDown />}
              tone="negative"
              higherIsBetter={false}
            />
          </>
        )}
      </div>

      {/* ── Fluxo financeiro ── */}
      <div className="mt-4">
        <CashflowChart
          data={flow}
          range={range}
          onRangeChange={setRange}
          isLoading={seriesLoading}
          hasData={hasFlowData}
        />
      </div>

      {/* ── Categorias | Limites ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.35fr_1fr]">
        <CategoryDonut data={categorias} isLoading={meLoading} />
        <LimitsCard limits={limites} isLoading={meLoading} />
      </div>

      {/* ── Metas | Insights ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <GoalsCard goals={goals} isLoading={goalsLoading} />
        <InsightsCard insights={insights} isLoading={loadingCards} />
      </div>

      {/* ── Últimas transações ── */}
      <div className="mt-4">
        <RecentTransactions transactions={transactions ?? []} isLoading={txLoading} />
      </div>
    </div>
  );
}
