import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Repeat, Pause, Play, TrendingUp, TrendingDown } from "lucide-react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { brl, formatDate } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { RecurringTransaction, Frequency, Category } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

const FREQ_LABEL: Record<Frequency, string> = {
  daily: "Diário", weekly: "Semanal", monthly: "Mensal", yearly: "Anual",
};
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const clampDay = (y: number, m: number, day: number) =>
  new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));

/** Próxima ocorrência (>= hoje) conforme a regra — espelha o backend. */
function nextOccurrence(freq: Frequency, dom: number, dow: number, moy: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (freq === "daily") return iso(today);
  if (freq === "weekly") {
    const delta = (dow - today.getDay() + 7) % 7;
    return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta));
  }
  if (freq === "yearly") {
    let c = clampDay(today.getFullYear(), moy - 1, dom);
    if (c < today) c = clampDay(today.getFullYear() + 1, moy - 1, dom);
    return iso(c);
  }
  // monthly
  let c = clampDay(today.getFullYear(), today.getMonth(), dom);
  if (c < today) c = clampDay(today.getFullYear(), today.getMonth() + 1, dom);
  return iso(c);
}

interface FormState {
  id: string | null;
  type: "expense" | "income";
  title: string;
  amount: string;
  category: string;
  description: string;
  location: string;
  frequency: Frequency;
  day_of_month: string;
  day_of_week: string;
  month_of_year: string;
}

const empty: FormState = {
  id: null, type: "expense", title: "", amount: "", category: "", description: "",
  location: "", frequency: "monthly", day_of_month: "5", day_of_week: "1", month_of_year: "1",
};

export default function Recorrentes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);

  const { data: categories } = useQuery({
    queryKey: ["categories", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from("categories").select("*").eq("user_id", user!.id).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["recurring", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<RecurringTransaction[]> => {
      const { data, error } = await supabase
        .from("recurring_transactions").select("*").order("next_run", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const amount = Number(f.amount);
      if (!f.title.trim()) throw new Error("Dê um título à recorrência.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor válido.");
      const dom = Number(f.day_of_month) || 1;
      const dow = Number(f.day_of_week) || 0;
      const moy = Number(f.month_of_year) || 1;
      const payload = {
        user_id: user!.id,
        type: f.type,
        title: f.title.trim(),
        amount,
        category: f.category || null,
        description: f.description || null,
        location: f.location || null,
        frequency: f.frequency,
        day_of_month: f.frequency === "monthly" || f.frequency === "yearly" ? dom : null,
        day_of_week: f.frequency === "weekly" ? dow : null,
        month_of_year: f.frequency === "yearly" ? moy : null,
        next_run: nextOccurrence(f.frequency, dom, dow, moy),
      };
      if (f.id) {
        const { error } = await supabase.from("recurring_transactions").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("recurring_transactions").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      toast.success(form.id ? "Recorrência atualizada." : "Recorrência criada.");
      setOpen(false);
      setForm(empty);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = useMutation({
    mutationFn: async (r: RecurringTransaction) => {
      const { error } = await supabase.from("recurring_transactions").update({ active: !r.active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring_transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring"] }); toast.success("Recorrência removida."); },
    onError: (e) => toast.error((e as Error).message),
  });

  const openEdit = (r: RecurringTransaction) => {
    setForm({
      id: r.id, type: r.type, title: r.title, amount: String(r.amount),
      category: r.category ?? "", description: r.description ?? "", location: r.location ?? "",
      frequency: r.frequency, day_of_month: String(r.day_of_month ?? 5),
      day_of_week: String(r.day_of_week ?? 1), month_of_year: String(r.month_of_year ?? 1),
    });
    setOpen(true);
  };

  const rule = (r: RecurringTransaction) => {
    if (r.frequency === "monthly") return `Todo dia ${r.day_of_month}`;
    if (r.frequency === "weekly") return `Toda ${WEEKDAYS[r.day_of_week ?? 0]}`;
    if (r.frequency === "daily") return "Todo dia";
    if (r.frequency === "yearly") return `Todo ${r.day_of_month}/${r.month_of_year}`;
    return FREQ_LABEL[r.frequency];
  };

  const catOptions = (categories ?? []).filter(
    (c) => c.type === form.type || c.type === "both"
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recorrentes</h1>
          <p className="text-muted-foreground">
            Lançamentos que se repetem sozinhos (ex.: salário todo dia 15, aluguel todo dia 10).
          </p>
        </div>
        <Button onClick={() => { setForm(empty); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Nova recorrência
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-3"><Repeat className="h-6 w-6 text-primary" /></div>
            <p className="font-medium">Nenhuma recorrência ainda</p>
            <p className="text-sm text-muted-foreground">
              Crie uma para seu salário, aluguel, assinatura… e o ZapWallet lança sozinho no dia certo.
            </p>
            <Button onClick={() => { setForm(empty); setOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Criar primeira
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => {
            const income = r.type === "income";
            return (
              <Card key={r.id} className={r.active ? "" : "opacity-60"}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 truncate">
                        {income ? <TrendingUp className="h-4 w-4 text-emerald-600" />
                                : <TrendingDown className="h-4 w-4 text-destructive" />}
                        {r.title}
                      </CardTitle>
                      <CardDescription>{rule(r)} · {FREQ_LABEL[r.frequency]}</CardDescription>
                    </div>
                    <Badge variant={r.active ? "success" : "secondary"}>{r.active ? "Ativa" : "Pausada"}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className={`text-xl font-bold ${income ? "text-emerald-600" : "text-destructive"}`}>
                    {income ? "+" : "-"} {brl(r.amount)}
                  </p>
                  {r.category && <p className="text-sm text-muted-foreground">{r.category}</p>}
                  <p className="text-xs text-muted-foreground">Próxima: {formatDate(r.next_run)}</p>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggle.mutate(r)}>
                    {r.active ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                    {r.active ? "Pausar" : "Ativar"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                          onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar recorrência" : "Nova recorrência"}</DialogTitle>
          <DialogDescription>O lançamento será criado automaticamente no dia certo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(form); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FormState["type"] }))}>
                <option value="expense">Gasto</option>
                <option value="income">Receita</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input type="number" min="0" step="0.01" placeholder="0,00"
                     value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Título</Label>
            <Input placeholder="Ex: Salário, Aluguel, Academia"
                   value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                <option value="">—</option>
                {catOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Frequência</Label>
              <Select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency }))}>
                <option value="monthly">Mensal</option>
                <option value="weekly">Semanal</option>
                <option value="daily">Diária</option>
                <option value="yearly">Anual</option>
              </Select>
            </div>
          </div>

          {(form.frequency === "monthly") && (
            <div className="space-y-2">
              <Label>Dia do mês</Label>
              <Input type="number" min="1" max="31" value={form.day_of_month}
                     onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value }))} />
            </div>
          )}
          {form.frequency === "weekly" && (
            <div className="space-y-2">
              <Label>Dia da semana</Label>
              <Select value={form.day_of_week} onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value }))}>
                {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
              </Select>
            </div>
          )}
          {form.frequency === "yearly" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Dia</Label>
                <Input type="number" min="1" max="31" value={form.day_of_month}
                       onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Mês</Label>
                <Input type="number" min="1" max="12" value={form.month_of_year}
                       onChange={(e) => setForm((f) => ({ ...f, month_of_year: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
