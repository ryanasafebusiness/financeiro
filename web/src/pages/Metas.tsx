import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Goal } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { brl, formatDate, cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Target,
  Plus,
  PlusCircle,
  Pencil,
  CheckCircle2,
  Archive,
  Trophy,
} from "lucide-react";

type GoalStatus = "active" | "completed" | "archived";

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Ativa",
  completed: "Concluída",
  archived: "Arquivada",
};

const STATUS_BADGE: Record<
  GoalStatus,
  "success" | "secondary" | "outline"
> = {
  active: "success",
  completed: "secondary",
  archived: "outline",
};

interface GoalFormState {
  name: string;
  target_amount: string;
  saved_amount: string;
  deadline: string;
}

const EMPTY_FORM: GoalFormState = {
  name: "",
  target_amount: "",
  saved_amount: "0",
  deadline: "",
};

export default function Metas() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [tab, setTab] = useState<GoalStatus>("active");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<GoalFormState>(EMPTY_FORM);

  const [editOpen, setEditOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editForm, setEditForm] = useState<GoalFormState>(EMPTY_FORM);

  const [addOpen, setAddOpen] = useState(false);
  const [addGoal, setAddGoal] = useState<Goal | null>(null);
  const [addValue, setAddValue] = useState<string>("");

  const { data: goals, isLoading } = useQuery({
    queryKey: ["goals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Goal[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["goals"] });

  const createMutation = useMutation({
    mutationFn: async (form: GoalFormState) => {
      const target = Number(form.target_amount);
      const saved = Number(form.saved_amount || "0");
      if (!form.name.trim()) throw new Error("Informe um nome para a meta.");
      if (!target || target <= 0)
        throw new Error("Informe um valor alvo válido.");
      if (saved < 0) throw new Error("O valor guardado não pode ser negativo.");
      const { error } = await supabase.from("goals").insert({
        user_id: user!.id,
        name: form.name.trim(),
        target_amount: target,
        saved_amount: saved,
        deadline: form.deadline ? form.deadline : null,
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Meta criada!");
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const editMutation = useMutation({
    mutationFn: async ({
      id,
      form,
    }: {
      id: string;
      form: GoalFormState;
    }) => {
      const target = Number(form.target_amount);
      const saved = Number(form.saved_amount || "0");
      if (!form.name.trim()) throw new Error("Informe um nome para a meta.");
      if (!target || target <= 0)
        throw new Error("Informe um valor alvo válido.");
      if (saved < 0) throw new Error("O valor guardado não pode ser negativo.");
      const { error } = await supabase
        .from("goals")
        .update({
          name: form.name.trim(),
          target_amount: target,
          saved_amount: saved,
          deadline: form.deadline ? form.deadline : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Meta atualizada!");
      setEditOpen(false);
      setEditGoal(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const addValueMutation = useMutation({
    mutationFn: async ({ goal, value }: { goal: Goal; value: number }) => {
      if (!value || value <= 0) throw new Error("Informe um valor válido.");
      const newSaved = Number(goal.saved_amount) + value;
      const { error } = await supabase
        .from("goals")
        .update({ saved_amount: newSaved })
        .eq("id", goal.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Valor adicionado!");
      setAddOpen(false);
      setAddGoal(null);
      setAddValue("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: GoalStatus;
    }) => {
      const { error } = await supabase
        .from("goals")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      invalidate();
      toast.success(
        variables.status === "completed"
          ? "Meta concluída!"
          : variables.status === "archived"
            ? "Meta arquivada."
            : "Meta atualizada!"
      );
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const openEdit = (goal: Goal) => {
    setEditGoal(goal);
    setEditForm({
      name: goal.name,
      target_amount: String(goal.target_amount),
      saved_amount: String(goal.saved_amount),
      deadline: goal.deadline ?? "",
    });
    setEditOpen(true);
  };

  const openAdd = (goal: Goal) => {
    setAddGoal(goal);
    setAddValue("");
    setAddOpen(true);
  };

  const filtered = (goals ?? []).filter((g) => g.status === tab);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Metas</h1>
          <p className="text-muted-foreground">
            Acompanhe suas metas de economia e veja seu progresso.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova meta
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as GoalStatus)}>
        <TabsList>
          <TabsTrigger value="active">Ativas</TabsTrigger>
          <TabsTrigger value="completed">Concluídas</TabsTrigger>
          <TabsTrigger value="archived">Arquivadas</TabsTrigger>
        </TabsList>

        {(["active", "completed", "archived"] as GoalStatus[]).map((status) => (
          <TabsContent key={status} value={status} className="mt-6">
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-40" />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-2 w-full" />
                      <Skeleton className="h-4 w-24" />
                    </CardContent>
                    <CardFooter className="gap-2">
                      <Skeleton className="h-9 w-full" />
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                status={status}
                onCreate={() => setCreateOpen(true)}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onAddValue={() => openAdd(goal)}
                    onEdit={() => openEdit(goal)}
                    onComplete={() =>
                      statusMutation.mutate({
                        id: goal.id,
                        status: "completed",
                      })
                    }
                    onArchive={() =>
                      statusMutation.mutate({
                        id: goal.id,
                        status: "archived",
                      })
                    }
                    statusPending={statusMutation.isPending}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Dialog: Nova meta */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogHeader>
          <DialogTitle>Nova meta</DialogTitle>
          <DialogDescription>
            Defina um objetivo de economia para acompanhar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(createForm);
          }}
        >
          <GoalFormFields form={createForm} setForm={setCreateForm} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Salvando..." : "Criar meta"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Dialog: Editar meta */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogHeader>
          <DialogTitle>Editar meta</DialogTitle>
          <DialogDescription>
            Atualize os dados da sua meta de economia.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (editGoal)
              editMutation.mutate({ id: editGoal.id, form: editForm });
          }}
        >
          <GoalFormFields form={editForm} setForm={setEditForm} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Dialog: Adicionar valor */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogHeader>
          <DialogTitle>Adicionar valor</DialogTitle>
          <DialogDescription>
            {addGoal
              ? `Some um valor ao que você já guardou em "${addGoal.name}".`
              : "Some um valor ao que você já guardou."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (addGoal)
              addValueMutation.mutate({
                goal: addGoal,
                value: Number(addValue),
              });
          }}
        >
          {addGoal && (
            <p className="text-sm text-muted-foreground">
              Guardado atualmente:{" "}
              <span className="font-medium text-foreground">
                {brl(Number(addGoal.saved_amount))}
              </span>
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="add-value">Valor a adicionar (R$)</Label>
            <Input
              id="add-value"
              type="number"
              min="0"
              step="0.01"
              placeholder="0,00"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={addValueMutation.isPending}>
              {addValueMutation.isPending ? "Adicionando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}

interface GoalCardProps {
  goal: Goal;
  onAddValue: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onArchive: () => void;
  statusPending: boolean;
}

function GoalCard({
  goal,
  onAddValue,
  onEdit,
  onComplete,
  onArchive,
  statusPending,
}: GoalCardProps) {
  const saved = Number(goal.saved_amount);
  const target = Number(goal.target_amount);
  const pct = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
  const status = goal.status as GoalStatus;
  const isActive = status === "active";
  const reached = target > 0 && saved >= target;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            {goal.name}
          </CardTitle>
          <Badge variant={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</Badge>
        </div>
        {goal.deadline && (
          <CardDescription>
            Prazo: {formatDate(goal.deadline)}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold text-emerald-600">
            {brl(saved)}
          </span>
          <span className="text-sm text-muted-foreground">
            de {brl(target)}
          </span>
        </div>
        <Progress value={pct} />
        <p
          className={cn(
            "text-xs",
            reached ? "text-emerald-600 font-medium" : "text-muted-foreground"
          )}
        >
          {reached
            ? "Meta atingida!"
            : `${pct.toFixed(0)}% concluído`}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {isActive ? (
          <>
            <Button size="sm" onClick={onAddValue}>
              <PlusCircle className="mr-1 h-4 w-4" />
              Adicionar valor
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1 h-4 w-4" />
              Editar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onComplete}
              disabled={statusPending}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Concluir
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onArchive}
              disabled={statusPending}
            >
              <Archive className="mr-1 h-4 w-4" />
              Arquivar
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onArchive}
            disabled={statusPending || status === "archived"}
          >
            <Archive className="mr-1 h-4 w-4" />
            {status === "archived" ? "Arquivada" : "Arquivar"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

interface GoalFormFieldsProps {
  form: GoalFormState;
  setForm: React.Dispatch<React.SetStateAction<GoalFormState>>;
}

function GoalFormFields({ form, setForm }: GoalFormFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="goal-name">Nome</Label>
        <Input
          id="goal-name"
          placeholder="Ex.: Reserva de emergência"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="goal-target">Valor alvo (R$)</Label>
          <Input
            id="goal-target"
            type="number"
            min="0"
            step="0.01"
            placeholder="0,00"
            value={form.target_amount}
            onChange={(e) =>
              setForm((f) => ({ ...f, target_amount: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-saved">Valor já guardado (R$)</Label>
          <Input
            id="goal-saved"
            type="number"
            min="0"
            step="0.01"
            placeholder="0,00"
            value={form.saved_amount}
            onChange={(e) =>
              setForm((f) => ({ ...f, saved_amount: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="goal-deadline">Prazo (opcional)</Label>
        <Input
          id="goal-deadline"
          type="date"
          value={form.deadline}
          onChange={(e) =>
            setForm((f) => ({ ...f, deadline: e.target.value }))
          }
        />
      </div>
    </>
  );
}

interface EmptyStateProps {
  status: GoalStatus;
  onCreate: () => void;
}

function EmptyState({ status, onCreate }: EmptyStateProps) {
  const config: Record<
    GoalStatus,
    { title: string; description: string; showCta: boolean }
  > = {
    active: {
      title: "Nenhuma meta ativa",
      description:
        "Crie sua primeira meta de economia e comece a acompanhar seu progresso.",
      showCta: true,
    },
    completed: {
      title: "Nenhuma meta concluída ainda",
      description:
        "Quando você atingir uma meta, marque-a como concluída para vê-la aqui.",
      showCta: false,
    },
    archived: {
      title: "Nenhuma meta arquivada",
      description: "As metas que você arquivar aparecerão aqui.",
      showCta: false,
    },
  };

  const { title, description, showCta } = config[status];

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {status === "completed" ? (
            <Trophy className="h-6 w-6" />
          ) : (
            <Target className="h-6 w-6" />
          )}
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        {showCta && (
          <Button onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Criar primeira meta
          </Button>
        )}
      </CardContent>
    </Card>
  );
}