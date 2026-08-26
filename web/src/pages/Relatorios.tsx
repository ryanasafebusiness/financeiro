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
    queryKey: ["transactions-relatorios", user?.id, from, to],
    enabled: !!user,
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
  const vazio = !isLoading && lista.length === 0;

  // Totais
  const { totalReceitas, totalGastos, qtdGastos } = useMemo(() => {
    let receitas = 0;
    let gastos = 0;
    let qtd = 0;
    for (const t of lista) {
      const valor = Number(t.amount) || 0;
      if (t.type === "income") {
        receitas += valor;
      } else {
        gastos += valor;
        qtd += 1;
      }
    }
    return { totalReceitas: receitas, totalGastos: gastos, qtdGastos: qtd };
  }, [lista]);

  const saldo = totalReceitas - totalGastos;
  const ticketMedio = qtdGastos > 0 ? totalGastos / qtdGastos : 0;

  // Agregação por mês (YYYY-MM)
  const dadosPorMes = useMemo(() => {
    const mapa = new Map<string, { receitas: number; gastos: number }>();
    for (const t of lista) {
      const chave = t.occurred_on.slice(0, 7); // YYYY-MM
      const atual = mapa.get(chave) ?? { receitas: 0, gastos: 0 };
      const valor = Number(t.amount) || 0;
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
  }, [lista]);

  // Gastos por categoria
  const dadosPorCategoria = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const t of lista) {
      if (t.type !== "expense") continue;
      const cat = t.category && t.category.trim() ? t.category : "Sem categoria";
      mapa.set(cat, (mapa.get(cat) ?? 0) + (Number(t.amount) || 0));
    }
    return Array.from(mapa.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [lista]);

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
    <div>
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

      {/* Cards-resumo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
        {resumos.map((r) => (
          <StatTile
            key={r.titulo}
            label={r.titulo}
            value={r.bruto}
            icon={r.icone}
            tone={r.tone}
            loading={isLoading}
            format={r.formato}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Receitas x Gastos por mês */}
        <Card>
          <CardToolbar
            icon={<BarChart3 className="h-4 w-4" />}
            title="Receitas x Gastos"
            description="Comparativo agregado por mês no período."
          />
          <div className="px-3 pb-5 sm:px-4">
            {isLoading ? (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            ) : vazio || dadosPorMes.length === 0 ? (
              <EstadoVazio mensagem="Nenhuma transação encontrada neste período." />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dadosPorMes} barGap={6}>
                  <CartesianGrid
                    vertical={false}
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 6"
                  />
                  <XAxis
                    dataKey="mes"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    dy={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))
                    }
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                    formatter={(value: number) => money(Number(value))}
                    contentStyle={{
                      borderRadius: 12,
                      fontSize: 13,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      boxShadow: "var(--shadow-md)",
                    }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                  <Bar dataKey="Receitas" fill="hsl(var(--positive))" radius={[6, 6, 0, 0]} maxBarSize={38} />
                  <Bar dataKey="Gastos" fill="hsl(var(--negative))" radius={[6, 6, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Gastos por categoria */}
        <Card>
          <CardToolbar
            icon={<PieChartIcon className="h-4 w-4" />}
            title="Gastos por categoria"
            description="Distribuição dos gastos no período."
          />
          <div className="px-4 pb-5 sm:px-6">
            {isLoading ? (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            ) : vazio || dadosPorCategoria.length === 0 ? (
              <EstadoVazio mensagem="Nenhum gasto encontrado neste período." />
            ) : (
              <GastosPorCategoria dados={dadosPorCategoria} total={totalGastos} />
            )}
          </div>
        </Card>
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
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--popover))",
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
