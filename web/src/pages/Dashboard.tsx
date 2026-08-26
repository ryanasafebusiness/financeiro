import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, TrendingDown, TrendingUp, Wallet, ChevronRight, Repeat, Target, Gauge } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Dropdown, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { money, cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction } from "@/integrations/supabase/types";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
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
  profile: { name: string | null; plan: string | null; is_premium: boolean; currency: "EUR" | "BRL" };
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
  const currency = me?.profile.currency ?? "EUR";
  const { data: exchangeRates, isLoading: ratesLoading, convert } = useCurrencyConversion(currency);

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ["dashboard-transactions", user?.id, me?.profile.currency],
    enabled: !!user && !!me?.profile.currency,
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
  } = useDashboardData(range, currency, exchangeRates);

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

  const loadingCards = meLoading || seriesLoading || ratesLoading;

  return (
    <div className="md:px-0 flex flex-col min-h-full">
      {/* ── Saldo da Conta Mobile ── */}
      <div className="bg-primary px-5 pb-6 pt-1 text-primary-foreground md:hidden">
        <div className="mt-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-primary-foreground/90">Conta</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">
              {meLoading ? "..." : money(balance)}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-primary-foreground/70" />
        </div>
      </div>

      {/* ── Quick Actions Mobile (Carousel) ── */}
      <div className="md:hidden mt-6 overflow-x-auto px-5 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="flex w-max gap-4">
          <button onClick={() => navigate("/transacoes?novo=1")} className="flex flex-col items-center gap-2 w-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/80 dark:bg-card">
              <TrendingUp className="h-6 w-6 text-foreground" />
            </div>
            <span className="text-center text-[12px] font-semibold text-foreground leading-tight">Receita</span>
          </button>
          <button onClick={() => navigate("/transacoes?novo=1")} className="flex flex-col items-center gap-2 w-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/80 dark:bg-card">
              <TrendingDown className="h-6 w-6 text-foreground" />
            </div>
            <span className="text-center text-[12px] font-semibold text-foreground leading-tight">Gasto</span>
          </button>
          <button onClick={() => navigate("/recorrentes?novo=1")} className="flex flex-col items-center gap-2 w-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/80 dark:bg-card">
              <Repeat className="h-6 w-6 text-foreground" />
            </div>
            <span className="text-center text-[12px] font-semibold text-foreground leading-tight">Recorrente</span>
          </button>
          <button onClick={() => navigate("/metas?novo=1")} className="flex flex-col items-center gap-2 w-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/80 dark:bg-card">
              <Target className="h-6 w-6 text-foreground" />
            </div>
            <span className="text-center text-[12px] font-semibold text-foreground leading-tight">Metas</span>
          </button>
          <button onClick={() => navigate("/limites?novo=1")} className="flex flex-col items-center gap-2 w-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/80 dark:bg-card">
              <Gauge className="h-6 w-6 text-foreground" />
            </div>
            <span className="text-center text-[12px] font-semibold text-foreground leading-tight">Limites</span>
          </button>
        </div>
      </div>

      {/* ── Cards "Meus Cartões" Mobile ── */}
      <div className="md:hidden px-5 mb-6 mt-2">
        <button onClick={() => navigate("/recorrentes")} className="flex w-full items-center gap-3 rounded-xl bg-secondary/60 dark:bg-card p-4 transition-transform active:scale-[0.98]">
          <Wallet className="h-5 w-5 text-foreground" />
          <span className="text-sm font-semibold text-foreground">Minhas assinaturas</span>
        </button>
      </div>

      <div className="md:hidden h-[1px] w-full bg-border" />

      {/* Desktop Wrapper Start */}
      <div className="px-4 py-6 sm:px-5 md:px-0 md:py-0 w-full">
        {/* ── Header Desktop ── */}
        <div className="hidden mb-7 md:flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-page-title font-bold text-foreground">
              {meLoading || !firstName ? "Olá 👋" : `Olá, ${firstName} 👋`}
            </h1>
            <p className="mt-1 text-body text-muted-foreground">
              Aqui está o resumo das suas finanças em {currentMonthLabel()}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

        {/* ── Cards financeiros Desktop ── */}
        <div className="hidden md:grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
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

        {/* ── Receitas e Gastos Mobile ── */}
        <div className="md:hidden py-5 -mx-4 px-4 sm:-mx-5 sm:px-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Receitas e Gastos</h2>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">Gasto atual</p>
            <p className="text-xl font-bold text-foreground">{money(expense)}</p>
            <p className="text-xs text-muted-foreground mt-2">Receitas no período de {money(income)}</p>
          </div>
        </div>

        <div className="md:hidden h-[1px] w-full bg-border -mx-4 sm:-mx-5 my-2" />

        {/* ── Fluxo financeiro ── */}
        <div className="mt-4 md:mt-4">
          <div className="md:hidden flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Fluxo de Caixa</h2>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
          <CashflowChart
            data={flow}
            range={range}
            onRangeChange={setRange}
            isLoading={seriesLoading}
            hasData={hasFlowData}
          />
        </div>

        <div className="md:hidden h-[1px] w-full bg-border -mx-4 sm:-mx-5 mt-6 mb-2" />

        {/* ── Categorias | Limites ── */}
        <div className="mt-4 md:mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.35fr_1fr]">
          <div>
            <div className="md:hidden flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Categorias</h2>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <CategoryDonut data={categorias} isLoading={meLoading} />
          </div>
          
          <div className="md:hidden h-[1px] w-full bg-border -mx-4 sm:-mx-5 my-4" />
          
          <div>
            <div className="md:hidden flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Limites</h2>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <LimitsCard limits={limites} isLoading={meLoading} />
          </div>
        </div>

        <div className="md:hidden h-[1px] w-full bg-border -mx-4 sm:-mx-5 my-6" />

        {/* ── Metas | Insights ── */}
        <div className="mt-4 md:mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="md:hidden flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Metas</h2>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <GoalsCard goals={goals} isLoading={goalsLoading} />
          </div>
          
          <div className="md:hidden h-[1px] w-full bg-border -mx-4 sm:-mx-5 my-4" />
          
          <div>
            <div className="md:hidden flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Dicas para você</h2>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <InsightsCard insights={insights} isLoading={loadingCards} />
          </div>
        </div>

        <div className="md:hidden h-[1px] w-full bg-border -mx-4 sm:-mx-5 my-6" />

        {/* ── Últimas transações ── */}
        <div className="mt-4 md:mt-4">
          <div className="md:hidden flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Últimas transações</h2>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
          <RecentTransactions
            transactions={transactions ?? []}
            isLoading={txLoading || ratesLoading}
            targetCurrency={currency}
            convert={convert}
          />
        </div>
      </div>
    </div>
  );
}
