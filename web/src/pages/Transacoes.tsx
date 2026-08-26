import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { categoryIcon } from "@/lib/category-visuals";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn, money, formatDate, formatDateTime } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Transaction, Category, CurrencyCode } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useOpenOnQuery } from "@/hooks/useOpenOnQuery";
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
  SlidersHorizontal,
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
  currency: CurrencyCode;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const todayIso = (): string => iso(new Date());

function emptyForm(currency: CurrencyCode = "EUR"): FormState {
  return {
    type: "expense",
    amount: "",
    title: "",
    category: "",
    description: "",
    location: "",
    occurred_on: todayIso(),
    currency,
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
  const { data: profile } = useProfile();
  const selectedCurrency = profile?.currency ?? "EUR";
  const qc = useQueryClient();

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [monthFilter, setMonthFilter] = useState<string>(monthOptions[0].value);

  const [dialogOpen, setDialogOpen] = useState(false);
  useOpenOnQuery(() => openNew());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { first, last } = useMemo(() => monthRange(monthFilter), [monthFilter]);

  const {
    data: transactions = [],
    isLoading,
  } = useQuery<Transaction[]>({
    queryKey: ["transactions", user?.id, typeFilter, monthFilter, selectedCurrency],
    enabled: !!user && !!profile,
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", first)
        .lte("occurred_on", last)
        .eq("currency", selectedCurrency)
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
        currency: form.currency,
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
    setForm(emptyForm(selectedCurrency));
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
      currency: t.currency ?? selectedCurrency,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm(selectedCurrency));
  }

  function handleDelete(t: Transaction) {
    if (
      window.confirm(
        `Excluir esta transação de ${money(Number(t.amount) || 0, t.currency)}? Esta ação não pode ser desfeita.`
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
      <PageHeader
        title="Transações"
        description="Gerencie suas receitas e gastos."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            Nova transação
          </Button>
        }
      />

      {/* Resumo do período */}
      <div className="grid gap-4 sm:grid-cols-3 stagger">
        <StatTile
          label="Receitas"
          value={summary.income}
          icon={<ArrowUpCircle className="h-4 w-4" />}
          tone="positive"
          loading={isLoading}
        />
        <StatTile
          label="Gastos"
          value={summary.expense}
          icon={<ArrowDownCircle className="h-4 w-4" />}
          tone="negative"
          loading={isLoading}
        />
        <StatTile
          label="Saldo"
          value={summary.balance}
          icon={<Wallet className="h-4 w-4" />}
          tone={summary.balance >= 0 ? "positive" : "negative"}
          loading={isLoading}
        />
      </div>

      {/* Filtros */}
      <div className="mt-4 flex flex-col gap-3 rounded-card border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center">
        <span className="flex items-center justify-between gap-2 text-meta font-medium text-muted-foreground">
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
          </span>
          <span className="tabular sm:hidden">
            {isLoading
              ? "…"
              : `${transactions.length} ${transactions.length === 1 ? "registro" : "registros"}`}
          </span>
        </span>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            id="filter-type"
            aria-label="Tipo"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="h-9 sm:w-40"
          >
            <option value="all">Todos os tipos</option>
            <option value="expense">Gastos</option>
            <option value="income">Receitas</option>
          </Select>

          <Select
            id="filter-month"
            aria-label="Mês"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="h-9 sm:w-52"
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <span className="hidden text-label tabular text-muted-foreground sm:block">
          {isLoading
            ? "Carregando…"
            : `${transactions.length} ${transactions.length === 1 ? "registro" : "registros"}`}
        </span>
      </div>

      {/* Lista */}
      <Card className="mt-4">
        <div className="px-3 py-3 sm:px-4">
          {isLoading ? (
            <div className="space-y-2 px-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="Nenhuma transação encontrada"
              description="Não há lançamentos para os filtros selecionados. Ajuste o período ou registre um novo."
              action={
                <Button variant="outline" size="sm" onClick={openNew}>
                  <Plus className="h-4 w-4" />
                  Adicionar transação
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
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
                const Icon = categoryIcon(t.category, t.type);

                return (
                  <li key={t.id} className="group">
                    <div className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors duration-fast hover:bg-muted/60">
                      <span
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          isIncome ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-body font-medium leading-tight text-foreground">
                            {heading}
                          </span>
                          {isRecurring && (
                            <Badge variant="outline" className="gap-1">
                              <Repeat className="h-3 w-3" />
                              recorrente
                            </Badge>
                          )}
                        </div>

                        {(t.description || t.location) && (
                          <div className="space-y-0.5 text-meta text-muted-foreground">
                            {t.description && <p className="truncate">{t.description}</p>}
                            {t.location && (
                              <p className="flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">{t.location}</span>
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-muted-foreground">
                          <span>{when}</span>
                          {showCategory && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="capitalize">{t.category}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* No mobile o valor fica acima das ações; no desktop, lado a lado. */}
                      <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-start sm:gap-2">
                        <div
                          className={cn(
                            "whitespace-nowrap pt-0.5 text-body font-semibold tabular",
                            isIncome ? "text-positive" : "text-foreground"
                          )}
                        >
                          {isIncome ? "+" : "\u2212"} {money(amount, t.currency)}
                        </div>

                        {/* Ações — discretas, aparecem no hover em telas grandes */}
                        <div className="-mr-1.5 flex shrink-0 gap-0.5 opacity-100 transition-opacity duration-fast sm:mr-0 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Editar"
                            onClick={() => openEdit(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Excluir"
                            onClick={() => handleDelete(t)}
                            disabled={deleteMutation.isPending}
                            className="hover:text-negative"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
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

          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
            <Label htmlFor="form-amount">Valor</Label>
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
              <Label htmlFor="form-currency">Moeda</Label>
              <Select
                id="form-currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as CurrencyCode }))}
              >
                <option value="EUR">Euro (€)</option>
                <option value="BRL">Real (R$)</option>
              </Select>
            </div>
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
