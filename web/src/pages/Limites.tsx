import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn, money } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { SpendingLimit, Transaction, Category } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useOpenOnQuery } from "@/hooks/useOpenOnQuery";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Target, AlertTriangle } from "lucide-react";

type Period = "monthly" | "weekly";

type LimitWithSpent = SpendingLimit & { spent: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);

function monthRange(now: Date): { from: string; to: string } {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: iso(first), to: iso(last) };
}

function weekRange(now: Date): { from: string; to: string } {
  // Semana de segunda (1) a domingo (0 -> tratado como 7)
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function periodLabel(p: string): string {
  return p === "weekly" ? "Semanal" : "Mensal";
}

interface LimitFormState {
  id: string | null;
  category: string;
  limit_amount: string;
  period: Period;
}

const emptyForm: LimitFormState = {
  id: null,
  category: "geral",
  limit_amount: "",
  period: "monthly",
};

export default function Limites() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<LimitFormState>(emptyForm);

  // Categorias de despesa (globais + do usuário) para o Select do formulário
  const { data: categories } = useQuery({
    queryKey: ["categories", "expense", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []).filter((c) => c.type === "expense" || c.type === "both");
    },
  });

  // Limites do usuário com o gasto do período corrente já calculado
  const { data: limits, isLoading } = useQuery({
    queryKey: ["limits", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<LimitWithSpent[]> => {
      const { data: rawLimits, error: limErr } = await supabase
        .from("spending_limits")
        .select("*")
        .order("category", { ascending: true });
      if (limErr) throw limErr;
      const allLimits = (rawLimits ?? []) as SpendingLimit[];
      if (allLimits.length === 0) return [];

      const now = new Date();
      const month = monthRange(now);
      const week = weekRange(now);

      // Busca despesas do maior intervalo necessário (o mês cobre a semana)
      // e agrega no cliente por período.
      const needsMonthly = allLimits.some((l) => l.period === "monthly");
      const needsWeekly = allLimits.some((l) => l.period === "weekly");

      const rangeFrom = needsMonthly ? month.from : week.from;
      const rangeTo = needsMonthly ? month.to : week.to;

      const { data: txData, error: txErr } = await supabase
        .from("transactions")
        .select("*")
        .eq("type", "expense")
        .gte("occurred_on", rangeFrom)
        .lte("occurred_on", rangeTo);
      if (txErr) throw txErr;
      const transactions = (txData ?? []) as Transaction[];

      const inRange = (date: string, from: string, to: string) =>
        date >= from && date <= to;

      const sumFor = (limit: SpendingLimit): number => {
        const range = limit.period === "weekly" ? week : month;
        return transactions.reduce((acc, t) => {
          if (!inRange(t.occurred_on, range.from, range.to)) return acc;
          if (limit.category !== "geral") {
            const cat = (t.category ?? "").toLowerCase();
            if (cat !== limit.category.toLowerCase()) return acc;
          }
          return acc + Number(t.amount);
        }, 0);
      };

      // Garante que dados semanais existam mesmo se só carregamos o mês:
      // como o mês engloba a semana corrente, o filtro de range acima resolve.
      void needsWeekly;

      return allLimits.map((l) => ({ ...l, spent: sumFor(l) }));
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (values: LimitFormState) => {
      const amount = Number(values.limit_amount);
      if (!values.category) throw new Error("Selecione uma categoria.");
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("Informe um valor válido maior que zero.");

      const payload = {
        user_id: user!.id,
        // Minúsculas p/ casar com a convenção do agente (finance_svc.set_limit)
        // e evitar limites duplicados entre WhatsApp e painel.
        category: values.category.trim().toLowerCase() || "geral",
        period: values.period,
        limit_amount: amount,
      };

      const { error } = await supabase
        .from("spending_limits")
        .upsert(payload, { onConflict: "user_id,category,period" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["limits"] });
      toast.success(form.id ? "Limite atualizado." : "Limite criado.");
      setDialogOpen(false);
      setForm(emptyForm);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("spending_limits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["limits"] });
      toast.success("Limite removido.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useOpenOnQuery(() => openNew());

  const openNew = () => {
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (limit: SpendingLimit) => {
    setForm({
      id: limit.id,
      category: limit.category,
      limit_amount: String(limit.limit_amount),
      period: limit.period as Period,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    upsertMutation.mutate(form);
  };

  const categoryOptions = (categories ?? []).map((c) => c.name);

  return (
    <div>
      <PageHeader
        title="Limites"
        description="Defina limites de gasto por categoria e acompanhe seu progresso."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            Novo limite
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-4 w-20" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !limits || limits.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target />}
            title="Nenhum limite cadastrado"
            description="Crie um limite para controlar seus gastos por categoria e receber avisos antes de estourar."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                Criar primeiro limite
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 stagger">
          {limits.map((limit) => {
            const spent = Number(limit.spent);
            const total = Number(limit.limit_amount);
            const pct = total > 0 ? (spent / total) * 100 : 0;
            const clampedPct = Math.min(100, Math.max(0, pct));
            const remaining = total - spent;
            const over = remaining < 0;

            const badgeVariant: "success" | "warning" | "destructive" =
              pct >= 100 ? "destructive" : pct >= 80 ? "warning" : "success";
            const badgeText =
              pct >= 100 ? "Estourado" : pct >= 80 ? "Atenção" : "No controle";

            const catLabel =
              limit.category === "geral" ? "Geral" : capitalize(limit.category);

            return (
              <Card key={limit.id} className="flex flex-col surface-interactive">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {catLabel}
                        {over && (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        )}
                      </CardTitle>
                      <CardDescription>{periodLabel(limit.period)}</CardDescription>
                    </div>
                    <Badge variant={badgeVariant}>{badgeText}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[1.375rem] font-semibold tracking-tight tabular text-foreground">
                      {money(spent)}
                    </span>
                    <span className="text-meta tabular text-muted-foreground">de {money(total)}</span>
                  </div>
                  <Progress value={clampedPct} />
                  <div className="flex items-center justify-between gap-2 text-label">
                    <span className="font-medium tabular text-muted-foreground">
                      {Math.round(pct)}% usado
                    </span>
                    <span className={cn("font-medium tabular", over ? "text-negative" : "text-positive")}>
                      {over
                        ? `${money(Math.abs(remaining))} acima do limite`
                        : `${money(remaining)} restante`}
                    </span>
                  </div>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(limit)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-negative hover:bg-negative/10 hover:text-negative"
                    onClick={() => deleteMutation.mutate(limit.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remover
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar limite" : "Novo limite"}</DialogTitle>
          <DialogDescription>
            Defina a categoria, o valor e o período do limite de gasto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category">Categoria</Label>
            <Select
              id="category"
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
            >
              <option value="geral">Geral (total)</option>
              {categoryOptions.map((name) => (
                <option key={name} value={name}>
                  {capitalize(name)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="limit_amount">Valor do limite</Label>
            <Input
              id="limit_amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0,00"
              value={form.limit_amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, limit_amount: e.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="period">Período</Label>
            <Select
              id="period"
              value={form.period}
              onChange={(e) =>
                setForm((f) => ({ ...f, period: e.target.value as Period }))
              }
            >
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}