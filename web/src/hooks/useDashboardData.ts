import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Goal, Transaction } from "@/integrations/supabase/types";
import { useAuth } from "./useAuth";

export type FlowRange = "7d" | "30d" | "3m" | "12m";

export const FLOW_RANGES: { value: FlowRange; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "3m", label: "3 meses" },
  { value: "12m", label: "12 meses" },
];

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseIso = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

function rangeStart(range: FlowRange, today: Date): Date {
  const d = new Date(today);
  switch (range) {
    case "7d":
      d.setDate(d.getDate() - 6);
      return d;
    case "30d":
      d.setDate(d.getDate() - 29);
      return d;
    case "3m":
      d.setMonth(d.getMonth() - 2);
      d.setDate(1);
      return d;
    case "12m":
    default:
      d.setMonth(d.getMonth() - 11);
      d.setDate(1);
      return d;
  }
}

export type FlowPoint = { key: string; label: string; receitas: number; despesas: number };

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "agosto de 2026" — usado no subtítulo do dashboard. */
export function currentMonthLabel(today = new Date()): string {
  return `${MESES[today.getMonth()]} de ${today.getFullYear()}`;
}

/** "Ago 2026" — usado no chip do header. */
export function currentMonthChip(today = new Date()): string {
  const m = MESES_CURTOS[today.getMonth()];
  return `${m[0].toUpperCase()}${m.slice(1)} ${today.getFullYear()}`;
}

/**
 * Agrega dados do dashboard a partir das tabelas existentes (somente leitura,
 * via RLS do próprio usuário). Nenhuma regra de negócio é alterada aqui:
 * os totais oficiais do mês continuam vindo de /api/me — estes números servem
 * para comparação com o mês anterior, séries temporais e sparklines.
 */
export function useDashboardData(range: FlowRange, currency: "EUR" | "BRL" = "EUR") {
  const { user } = useAuth();
  const today = useMemo(() => new Date(), []);

  // Busca o suficiente para o gráfico e sempre o mês anterior (comparativo).
  const from = useMemo(() => {
    const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const start = rangeStart(range, today);
    return iso(start < previousMonthStart ? start : previousMonthStart);
  }, [range, today]);

  const to = useMemo(() => iso(today), [today]);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["dashboard-series", user?.id, from, to, currency],
    enabled: !!user,
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", from)
        .lte("occurred_on", to)
        .eq("currency", currency)
        .order("occurred_on", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });

  const { data: goals, isLoading: goalsLoading } = useQuery({
    queryKey: ["dashboard-goals", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as Goal[];
    },
  });

  const derived = useMemo(() => {
    const list = rows ?? [];
    const y = today.getFullYear();
    const m = today.getMonth();
    const monthStart = new Date(y, m, 1);
    const prevStart = new Date(y, m - 1, 1);
    const prevEnd = new Date(y, m, 0);

    let prevIncome = 0;
    let prevExpense = 0;
    const prevByCategory = new Map<string, number>();

    // Série cumulativa do mês corrente (base dos sparklines).
    const daysSoFar = today.getDate();
    const dailyIncome = new Array(daysSoFar).fill(0);
    const dailyExpense = new Array(daysSoFar).fill(0);

    for (const t of list) {
      const d = parseIso(t.occurred_on);
      const amount = Math.abs(Number(t.amount) || 0);

      if (d >= prevStart && d <= prevEnd) {
        if (t.type === "income") prevIncome += amount;
        else {
          prevExpense += amount;
          const key = (t.category ?? "outros").toLowerCase();
          prevByCategory.set(key, (prevByCategory.get(key) ?? 0) + amount);
        }
      }

      if (d >= monthStart && d <= today) {
        const idx = Math.min(daysSoFar - 1, d.getDate() - 1);
        if (t.type === "income") dailyIncome[idx] += amount;
        else dailyExpense[idx] += amount;
      }
    }

    const cumulative = (arr: number[]) => {
      let acc = 0;
      return arr.map((v) => (acc += v));
    };
    const incomeSeries = cumulative(dailyIncome);
    const expenseSeries = cumulative(dailyExpense);
    const balanceSeries = incomeSeries.map((v, i) => v - expenseSeries[i]);

    // Série do gráfico de fluxo: por dia (7d/30d) ou por mês (3m/12m).
    const byMonth = range === "3m" || range === "12m";
    const start = rangeStart(range, today);
    const buckets = new Map<string, FlowPoint>();

    if (byMonth) {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= today) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        buckets.set(key, {
          key,
          label: `${MESES_CURTOS[cursor.getMonth()]}/${String(cursor.getFullYear()).slice(2)}`,
          receitas: 0,
          despesas: 0,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      const cursor = new Date(start);
      while (cursor <= today) {
        const key = iso(cursor);
        buckets.set(key, {
          key,
          label: `${String(cursor.getDate()).padStart(2, "0")}/${String(cursor.getMonth() + 1).padStart(2, "0")}`,
          receitas: 0,
          despesas: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    for (const t of list) {
      const d = parseIso(t.occurred_on);
      if (d < start || d > today) continue;
      const key = byMonth
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : t.occurred_on.slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const amount = Math.abs(Number(t.amount) || 0);
      if (t.type === "income") bucket.receitas += amount;
      else bucket.despesas += amount;
    }

    return {
      previous: { income: prevIncome, expense: prevExpense, balance: prevIncome - prevExpense },
      prevByCategory,
      series: { income: incomeSeries, expense: expenseSeries, balance: balanceSeries },
      flow: Array.from(buckets.values()),
      hasFlowData: list.some((t) => parseIso(t.occurred_on) >= start),
      daysInMonth: new Date(y, m + 1, 0).getDate(),
      dayOfMonth: daysSoFar,
    };
  }, [rows, range, today]);

  return {
    isLoading,
    goals: goals ?? [],
    goalsLoading,
    ...derived,
  };
}

/** Variação percentual protegida contra divisão por zero. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
