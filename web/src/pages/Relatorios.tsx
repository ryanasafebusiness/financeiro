import { useMemo, useState } from "react";
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
import { TrendingUp, TrendingDown, Wallet, Receipt } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { brl } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction } from "@/integrations/supabase/types";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

type Periodo = "atual" | "passado" | "tres" | "ano";

const PALETA = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#eab308",
];

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
  valor: string;
  icone: React.ReactNode;
  cor: string;
}

export default function Relatorios() {
  const { user } = useAuth();
  const [periodo, setPeriodo] = useState<Periodo>("atual");

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
      valor: brl(totalReceitas),
      icone: <TrendingUp className="h-4 w-4" />,
      cor: "text-emerald-600",
    },
    {
      titulo: "Total de gastos",
      valor: brl(totalGastos),
      icone: <TrendingDown className="h-4 w-4" />,
      cor: "text-destructive",
    },
    {
      titulo: "Saldo",
      valor: brl(saldo),
      icone: <Wallet className="h-4 w-4" />,
      cor: saldo >= 0 ? "text-emerald-600" : "text-destructive",
    },
    {
      titulo: "Ticket médio de gasto",
      valor: brl(ticketMedio),
      icone: <Receipt className="h-4 w-4" />,
      cor: "text-primary",
    },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Relatórios</h1>
          <p className="text-muted-foreground">
            Visualize suas receitas e gastos com gráficos.
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as Periodo)}
            aria-label="Selecionar período"
          >
            <option value="atual">Mês atual</option>
            <option value="passado">Mês passado</option>
            <option value="tres">Últimos 3 meses</option>
            <option value="ano">Ano</option>
          </Select>
        </div>
      </div>

      {/* Cards-resumo */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-28" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-7 w-24" />
                </CardContent>
              </Card>
            ))
          : resumos.map((r) => (
              <Card key={r.titulo}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {r.titulo}
                  </CardTitle>
                  <span className={r.cor}>{r.icone}</span>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${r.cor}`}>{r.valor}</div>
                </CardContent>
              </Card>
            ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Receitas x Gastos por mês */}
        <Card>
          <CardHeader>
            <CardTitle>Receitas x Gastos por mês</CardTitle>
            <CardDescription>Comparativo agregado por mês no período.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : vazio || dadosPorMes.length === 0 ? (
              <EstadoVazio mensagem="Nenhuma transação encontrada neste período." />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dadosPorMes}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="mes" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => brl(v)}
                    width={90}
                  />
                  <Tooltip
                    formatter={(value: number) => brl(Number(value))}
                    labelClassName="font-medium"
                    contentStyle={{ borderRadius: 8, fontSize: 13 }}
                  />
                  <Legend />
                  <Bar dataKey="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Gastos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Gastos por categoria */}
        <Card>
          <CardHeader>
            <CardTitle>Gastos por categoria</CardTitle>
            <CardDescription>Distribuição dos gastos no período.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : vazio || dadosPorCategoria.length === 0 ? (
              <EstadoVazio mensagem="Nenhum gasto encontrado neste período." />
            ) : (
              <GastosPorCategoria dados={dadosPorCategoria} total={totalGastos} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EstadoVazio({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center text-center">
      <Receipt className="mb-3 h-10 w-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{mensagem}</p>
    </div>
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
            paddingAngle={2}
          >
            {dados.map((_, i) => (
              <Cell key={i} fill={PALETA[i % PALETA.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [brl(Number(value)), name]}
            contentStyle={{ borderRadius: 8, fontSize: 13 }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="flex flex-col justify-center gap-2">
        {dados.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div
              key={d.name}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: PALETA[i % PALETA.length] }}
                />
                <span className="truncate">{d.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-medium">{brl(d.value)}</span>
                <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
