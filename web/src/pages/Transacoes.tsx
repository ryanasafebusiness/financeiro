import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn, brl, formatDate, formatDateTime } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction, Category } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  Inbox,
  Repeat,
  MapPin,
} from "lucide-react";

type TxType = "expense" | "income";
type TypeFilter = "all" | TxType;

interface MonthOption {
  value: string; // 'YYYY-MM'
  label: string;
}

interface FormState {
  type: TxType;
  amount: string;
  title: string;
  category: string;
  description: string;
  location: string;
  occurred_on: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const todayIso = (): string => iso(new Date());

function emptyForm(): FormState {
  return {
    type: "expense",
    amount: "",
    title: "",
    category: "",
    description: "",
    location: "",
    occurred_on: todayIso(),
  };
}

function buildMonthOptions(): MonthOption[] {
  const months: MonthOption[] = [];
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  });
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = fmt.format(d);
    months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return months;
}

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  return { first: iso(first), last: iso(last) };
}

export default function Transacoes() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [monthFilter, setMonthFilter] = useState<string>(monthOptions[0].value);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { first, last } = useMemo(() => monthRange(monthFilter), [monthFilter]);

  const {
    data: transactions = [],
    isLoading,
  } = useQuery<Transaction[]>({
    queryKey: ["transactions", user?.id, typeFilter, monthFilter],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", first)
        .lte("occurred_on", last)
        .order("occurred_on", { ascending: false });
      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const formCategories = useMemo(() => {
    return categories.filter(
      (c) => c.type === form.type || c.type === "both"
    );
  }, [categories, form.type]);

  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      const amount = Number(t.amount) || 0;
      if (t.type === "income") income += amount;
      else expense += amount;
    }
    return { income, expense, balance: income - expense };
  }, [transactions]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount);
      if (!form.amount || isNaN(amount) || amount <= 0) {
        throw new Error("Informe um valor maior que zero.");
      }
      const payload = {
        type: form.type,
        amount,
        title: form.title ? form.title : null,
        category: form.category ? form.category : null,
        description: form.description ? form.description : null,
        location: form.location ? form.location : null,
        occurred_on: form.occurred_on,
      };
      if (editingId) {
        const { error } = await supabase
          .from("transactions")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("transactions").insert({
          user_id: user!.id,
          source: "panel",
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(editingId ? "Transação atualizada!" : "Transação criada!");
      closeDialog();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transação excluída!");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(t: Transaction) {
    setEditingId(t.id);
    setForm({
      type: t.type,
      amount: String(Number(t.amount) || ""),
      title: t.title ?? "",
      category: t.category ?? "",
      description: t.description ?? "",
      location: t.location ?? "",
      occurred_on: t.occurred_on,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function handleDelete(t: Transaction) {
    if (
      window.confirm(
        `Excluir esta transação de ${brl(Number(t.amount) || 0)}? Esta ação não pode ser desfeita.`
      )
    ) {
      deleteMutation.mutate(t.id);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  function setType(type: TxType) {
    // Ao trocar o tipo, limpa a categoria caso não pertença ao novo tipo.
    setForm((f) => ({ ...f, type, category: "" }));
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Transações</h1>
        <p className="text-muted-foreground">
          Gerencie suas receitas e gastos.
        </p>
      </div>

      {/* Resumo */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Receitas
            </CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <div className="text-2xl font-bold text-emerald-600">
                {brl(summary.income)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gastos
            </CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <div className="text-2xl font-bold text-destructive">
                {brl(summary.expense)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo
            </CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <div
                className={cn(
                  "text-2xl font-bold",
                  summary.balance >= 0 ? "text-emerald-600" : "text-destructive"
                )}
              >
                {brl(summary.balance)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filtros + ação */}
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="space-y-1.5">
              <Label htmlFor="filter-type">Tipo</Label>
              <Select
                id="filter-type"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as TypeFilter)
                }
                className="sm:w-44"
              >
                <option value="all">Todos</option>
                <option value="expense">Gastos</option>
                <option value="income">Receitas</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-month">Mês</Label>
              <Select
                id="filter-month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="sm:w-52"
              >
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" />
            Nova transação
          </Button>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle>Lançamentos</CardTitle>
          <CardDescription>
            {isLoading
              ? "Carregando..."
              : `${transactions.length} ${
                  transactions.length === 1 ? "registro" : "registros"
                } no período.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                Nenhuma transação encontrada para os filtros selecionados.
              </p>
              <Button variant="outline" onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar a primeira
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((t) => {
                const amount = Number(t.amount) || 0;
                const isIncome = t.type === "income";
                const isRecurring = t.source === "recurring";
                const heading = t.title ?? t.category ?? "Transação";
                const when = t.occurred_at
                  ? formatDateTime(t.occurred_at)
                  : formatDate(t.occurred_on);
                // Só mostra a categoria na linha de baixo quando ela não vira o título.
                const showCategory = !!t.category && t.category !== heading;
                return (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      {/* Linha de cima: título + badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold leading-tight">
                          {heading}
                        </span>
                        <Badge variant={isIncome ? "success" : "secondary"}>
                          {isIncome ? "Receita" : "Gasto"}
                        </Badge>
                        {isRecurring && (
                          <Badge variant="outline" className="gap-1">
                            <Repeat className="h-3 w-3" />
                            recorrente
                          </Badge>
                        )}
                      </div>

                      {/* Linha do meio: descrição + local */}
                      {(t.description || t.location) && (
                        <div className="space-y-0.5 text-sm text-muted-foreground">
                          {t.description && <p>{t.description}</p>}
                          {t.location && (
                            <p className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{t.location}</span>
                            </p>
                          )}
                        </div>
                      )}

                      {/* Linha de baixo: data/hora + categoria */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{when}</span>
                        {showCategory && (
                          <>
                            <span aria-hidden="true">•</span>
                            <span>{t.category}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Valor */}
                    <div
                      className={cn(
                        "shrink-0 whitespace-nowrap text-lg font-bold",
                        isIncome ? "text-emerald-600" : "text-destructive"
                      )}
                    >
                      {isIncome ? "+" : "-"}
                      {brl(amount)}
                    </div>

                    {/* Ações */}
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar"
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir"
                        onClick={() => handleDelete(t)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de criação/edição */}
      <Dialog open={dialogOpen} onOpenChange={(b) => (b ? setDialogOpen(true) : closeDialog())}>
        <DialogHeader>
          <DialogTitle>
            {editingId ? "Editar transação" : "Nova transação"}
          </DialogTitle>
          <DialogDescription>
            Preencha os dados do lançamento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-type">Tipo</Label>
            <Select
              id="form-type"
              value={form.type}
              onChange={(e) => setType(e.target.value as TxType)}
            >
              <option value="expense">Gasto</option>
              <option value="income">Receita</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-title">Título</Label>
            <Input
              id="form-title"
              placeholder="Ex.: Cinema com a Gata"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-amount">Valor (R$)</Label>
            <Input
              id="form-amount"
              type="number"
              min="0"
              step="0.01"
              required
              placeholder="0,00"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-category">Categoria</Label>
            <Select
              id="form-category"
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
            >
              <option value="">Selecione...</option>
              {formCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </option>
              ))}
              {!formCategories.some((c) => c.name === "Outros") && (
                <option value="Outros">Outros</option>
              )}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-description">Descrição</Label>
            <Input
              id="form-description"
              placeholder="Ex.: Mercado, salário..."
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-location">Local (opcional)</Label>
            <Input
              id="form-location"
              placeholder="Ex.: Shopping, Restaurante X..."
              value={form.location}
              onChange={(e) =>
                setForm((f) => ({ ...f, location: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-date">Data</Label>
            <Input
              id="form-date"
              type="date"
              required
              value={form.occurred_on}
              onChange={(e) =>
                setForm((f) => ({ ...f, occurred_on: e.target.value }))
              }
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={saveMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending
                ? "Salvando..."
                : editingId
                ? "Salvar alterações"
                : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}