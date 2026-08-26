import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, Receipt, BarChart3, PieChart as PieChartIcon,
} from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { CHART_COLORS } from "@/components/dashboard/CategoryDonut";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction } from "@/integrations/supabase/types";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";

type Periodo = "atual" | "passado" | "tres" | "ano";

const PALETA = CHART_COLORS;

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function calcularPeriodo(periodo: Periodo): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (periodo) {
    case "atual": {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      return { from: iso(first), to: iso(last) };
    }
    case "passado": {
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      return { from: iso(first), to: iso(last) };
    }
    case "tres": {
      const first = new Date(y, m - 2, 1);
      const last = new Date(y, m + 1, 0);
      return { from: iso(first), to: iso(last) };
    }
    case "ano":
    default: {
      const first = new Date(y, 0, 1);
      const last = new Date(y, 11, 31);
      return { from: iso(first), to: iso(last) };
    }
  }
}

const MESES_CURTOS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function rotuloMes(chave: string): string {
  // chave: "YYYY-MM"
  const [ano, mes] = chave.split("-");
  const idx = Number(mes) - 1;
  return `${MESES_CURTOS[idx] ?? mes}/${ano.slice(2)}`;
}

interface ResumoCard {
  titulo: string;
  /** Valor numérico bruto — o StatTile cuida da formatação e da animação. */
  bruto: number;
  icone: React.ReactNode;
  tone: "positive" | "negative" | "primary" | "neutral";
  formato?: (n: number) => string;
}

export default function Relatorios() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const currency = profile?.currency ?? "EUR";
  const { convert, isLoading: ratesLoading } = useCurrencyConversion(currency);
  // Permite chegar aqui já no período escolhido no header do dashboard.
  const [searchParams] = useSearchParams();
  const periodoInicial = (["atual", "passado", "tres", "ano"] as Periodo[]).includes(
    searchParams.get("periodo") as Periodo
  )
    ? (searchParams.get("periodo") as Periodo)
    : "atual";
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);

  const { from, to } = useMemo(() => calcularPeriodo(periodo), [periodo]);

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions-relatorios", user?.id, from, to, currency],
    enabled: !!user && !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", from)
        .lte("occurred_on", to)
        .order("occurred_on", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });

  const lista: Transaction[] = transactions ?? [];
  const loading = isLoading || ratesLoading;
  const vazio = !loading && lista.length === 0;

  // Totais
  const { totalReceitas, totalGastos, qtdGastos } = useMemo(() => {
    let receitas = 0;
    let gastos = 0;
    let qtd = 0;
    for (const t of lista) {
      const valor = convert(Number(t.amount) || 0, t.currency) ?? 0;
      if (t.type === "income") {
        receitas += valor;
      } else {
        gastos += valor;
        qtd += 1;
      }
    }
    return { totalReceitas: receitas, totalGastos: gastos, qtdGastos: qtd };
  }, [lista, convert]);

  const saldo = totalReceitas - totalGastos;
  const ticketMedio = qtdGastos > 0 ? totalGastos / qtdGastos : 0;

  // Agregação por mês (YYYY-MM)
  const dadosPorMes = useMemo(() => {
    const mapa = new Map<string, { receitas: number; gastos: number }>();
    for (const t of lista) {
      const chave = t.occurred_on.slice(0, 7); // YYYY-MM
      const atual = mapa.get(chave) ?? { receitas: 0, gastos: 0 };
      const valor = convert(Number(t.amount) || 0, t.currency) ?? 0;
      if (t.type === "income") atual.receitas += valor;
      else atual.gastos += valor;
      mapa.set(chave, atual);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([chave, v]) => ({
        mes: rotuloMes(chave),
        Receitas: v.receitas,
        Gastos: v.gastos,
      }));
  }, [lista, convert]);

  // Gastos por categoria
  const dadosPorCategoria = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const t of lista) {
      if (t.type !== "expense") continue;
      const cat = t.category && t.category.trim() ? t.category : "Sem categoria";
      mapa.set(cat, (mapa.get(cat) ?? 0) + (convert(Number(t.amount) || 0, t.currency) ?? 0));
    }
    return Array.from(mapa.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [lista, convert]);

  const resumos: ResumoCard[] = [
    {
      titulo: "Total de receitas",
      bruto: totalReceitas,
      icone: <TrendingUp className="h-4 w-4" />,
      tone: "positive",
    },
    {
      titulo: "Total de gastos",
      bruto: totalGastos,
      icone: <TrendingDown className="h-4 w-4" />,
      tone: "negative",
    },
    {
      titulo: "Saldo",
      bruto: saldo,
      icone: <Wallet className="h-4 w-4" />,
      tone: saldo >= 0 ? "positive" : "negative",
    },
    {
      titulo: "Ticket médio de gasto",
      bruto: ticketMedio,
      icone: <Receipt className="h-4 w-4" />,
      tone: "primary",
    },
  ];


  return (
    <div className="flex flex-col min-h-full">
      {/* ── Desktop Header ── */}
      <div className="hidden md:block">
        <PageHeader
          title="Relatórios"
          description="Visualize suas receitas e gastos com gráficos."
          actions={
            <Select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as Periodo)}
              aria-label="Selecionar período"
              className="w-full sm:w-52"
            >
              <option value="atual">Mês atual</option>
              <option value="passado">Mês passado</option>
              <option value="tres">Últimos 3 meses</option>
              <option value="ano">Ano</option>
            </Select>
          }
        />
      </div>

      {/* ── Mobile Header & Selector ── */}
      <div className="md:hidden flex items-center justify-between mt-6 mb-4 px-4">
        <h1 className="text-xl font-bold text-foreground">Resumo</h1>
        <Select
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value as Periodo)}
          aria-label="Selecionar período"
          className="h-9 w-auto bg-secondary/50 border-0 pl-3 pr-8 text-sm rounded-full font-medium"
        >
          <option value="atual">Mês atual</option>
          <option value="passado">Mês passado</option>
          <option value="tres">Últimos 3 meses</option>
          <option value="ano">Ano</option>
        </Select>
      </div>

      {/* Cards-resumo */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 md:sm:grid-cols-2 lg:grid-cols-4 stagger px-4 md:px-0">
        {resumos.map((r) => (
          <div key={r.titulo} className="md:hidden flex flex-col bg-secondary/40 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
              <span className={cn("text-body", r.tone === "positive" ? "text-positive" : r.tone === "negative" ? "text-negative" : "text-muted-foreground")}>
                {r.icone}
              </span>
              <span className="text-xs font-medium">{r.titulo}</span>
            </div>
            <div className="text-base font-bold text-foreground">
              {loading ? "..." : (r.formato ? r.formato(r.bruto) : money(r.bruto))}
            </div>
          </div>
        ))}
        {/* Render padrão para Desktop */}
        <div className="hidden md:contents">
          {resumos.map((r) => (
            <StatTile
              key={r.titulo}
              label={r.titulo}
              value={r.bruto}
              icon={r.icone}
              tone={r.tone}
              loading={loading}
              format={r.formato}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 md:mt-4 grid gap-6 md:gap-4 lg:grid-cols-2">
        {/* Receitas x Gastos por mês */}
        <div className="bg-background md:bg-card md:rounded-card md:border md:border-border md:shadow-sm">
          <div className="px-4 md:px-0 md:contents hidden">
            <CardToolbar
              icon={<BarChart3 className="h-4 w-4" />}
              title="Receitas x Gastos"
              description="Comparativo agregado por mês no período."
            />
          </div>
          <div className="md:hidden flex items-center justify-between mb-4 px-4">
            <h2 className="text-base font-semibold text-foreground">Evolução do Saldo</h2>
          </div>
          <div className="px-1 md:px-3 pb-2 md:pb-5 sm:px-4">
            {loading ? (
              <Skeleton className="h-[250px] md:h-[300px] w-full rounded-lg mx-4" />
            ) : vazio || dadosPorMes.length === 0 ? (
              <EstadoVazio mensagem="Nenhuma transação encontrada neste período." />
            ) : (
              <ResponsiveContainer width="100%" height={250} className="md:!h-[300px]">
                <BarChart data={dadosPorMes} barGap={4} margin={{ left: -20, right: 10 }}>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 6"
                  />
                  <XAxis
                    dataKey="mes"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    dy={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))
                    }
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                    formatter={(value: number) => money(Number(value))}
                    contentStyle={{
                      borderRadius: 12,
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      background: "var(--popover)",
                      boxShadow: "var(--shadow-md)",
                    }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                  <Bar dataKey="Receitas" fill="var(--positive)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="Gastos" fill="var(--negative)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="md:hidden h-[1px] w-full bg-border/50" />

        {/* Gastos por categoria */}
        <div className="bg-background md:bg-card md:rounded-card md:border md:border-border md:shadow-sm">
          <div className="px-4 md:px-0 md:contents hidden">
            <CardToolbar
              icon={<PieChartIcon className="h-4 w-4" />}
              title="Gastos por categoria"
              description="Distribuição dos gastos no período."
            />
          </div>
          <div className="md:hidden flex items-center justify-between mb-2 mt-4 px-4">
            <h2 className="text-base font-semibold text-foreground">Onde você gastou</h2>
          </div>
          <div className="px-4 md:px-4 pb-5 sm:px-6">
            {loading ? (
              <Skeleton className="h-[250px] md:h-[300px] w-full rounded-lg" />
            ) : vazio || dadosPorCategoria.length === 0 ? (
              <EstadoVazio mensagem="Nenhum gasto encontrado neste período." />
            ) : (
              <GastosPorCategoria dados={dadosPorCategoria} total={totalGastos} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EstadoVazio({ mensagem }: { mensagem: string }) {
  return (
    <EmptyState
      icon={<Receipt />}
      title="Nada por aqui"
      description={mensagem}
      className="h-[300px]"
    />
  );
}

interface CategoriaItem {
  name: string;
  value: number;
}

function GastosPorCategoria({
  dados,
  total,
}: {
  dados: CategoriaItem[];
  total: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={dados}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            innerRadius={55}
            paddingAngle={2.5}
            cornerRadius={5}
            stroke="none"
            animationDuration={700}
          >
            {dados.map((_, i) => (
              <Cell key={i} fill={PALETA[i % PALETA.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [money(Number(value)), name]}
            contentStyle={{
              borderRadius: 12,
              fontSize: 13,
              border: "1px solid var(--border)",
              background: "var(--popover)",
              boxShadow: "var(--shadow-md)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="flex flex-col justify-center gap-2">
        {dados.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div
              key={d.name}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-meta transition-colors duration-fast hover:bg-muted"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PALETA[i % PALETA.length] }}
                />
                <span className="truncate capitalize">{d.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-semibold tabular">{money(d.value)}</span>
                <span className="w-11 text-right tabular text-muted-foreground">{pct.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
