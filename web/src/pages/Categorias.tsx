import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Category } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useOpenOnQuery } from "@/hooks/useOpenOnQuery";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState as UIEmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tags, Plus, Pencil, Trash2, Sparkles } from "lucide-react";

type CategoryType = "expense" | "income" | "both";

const TYPE_LABEL: Record<CategoryType, string> = {
  expense: "Despesa",
  income: "Receita",
  both: "Ambos",
};

const TYPE_BADGE: Record<CategoryType, "destructive" | "success" | "secondary"> = {
  expense: "destructive",
  income: "success",
  both: "secondary",
};

const GROUPS: { type: CategoryType; title: string; description: string }[] = [
  { type: "expense", title: "Despesas", description: "Categorias usadas nos seus gastos." },
  { type: "income", title: "Receitas", description: "Categorias usadas nas suas entradas." },
  { type: "both", title: "Ambas", description: "Servem para gastos e receitas." },
];

interface CategoryFormState {
  emoji: string;
  name: string;
  type: CategoryType;
  description: string;
}

const EMPTY_FORM: CategoryFormState = {
  emoji: "",
  name: "",
  type: "expense",
  description: "",
};

export default function Categorias() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  useOpenOnQuery(() => { setCreateForm(EMPTY_FORM); setCreateOpen(true); });
  const [createForm, setCreateForm] = useState<CategoryFormState>(EMPTY_FORM);

  const [editOpen, setEditOpen] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editForm, setEditForm] = useState<CategoryFormState>(EMPTY_FORM);

  const [deleteCat, setDeleteCat] = useState<Category | null>(null);

  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "categories" });

  const validate = (form: CategoryFormState) => {
    const name = form.name.trim();
    if (!name) throw new Error("Informe um nome para a categoria.");
    if (form.emoji.trim().length > 4)
      throw new Error("Use um único emoji.");
    return {
      name,
      type: form.type,
      emoji: form.emoji.trim() || null,
      description: form.description.trim() || null,
    };
  };

  const friendlyError = (e: unknown) => {
    const msg = (e as { message?: string; code?: string })?.message ?? "";
    if (msg.includes("duplicate") || msg.includes("23505"))
      return "Você já tem uma categoria com esse nome.";
    return (e as Error).message || "Não foi possível salvar.";
  };

  const createMutation = useMutation({
    mutationFn: async (form: CategoryFormState) => {
      const payload = validate(form);
      const { error } = await supabase
        .from("categories")
        .insert({ user_id: user!.id, ...payload });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Categoria criada!");
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: CategoryFormState }) => {
      const payload = validate(form);
      const { error } = await supabase
        .from("categories")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Categoria atualizada!");
      setEditOpen(false);
      setEditCat(null);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Categoria excluída.");
      setDeleteCat(null);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const openEdit = (cat: Category) => {
    setEditCat(cat);
    setEditForm({
      emoji: cat.emoji ?? "",
      name: cat.name,
      type: cat.type,
      description: cat.description ?? "",
    });
    setEditOpen(true);
  };

  const grouped = useMemo(() => {
    const map: Record<CategoryType, Category[]> = { expense: [], income: [], both: [] };
    for (const c of categories ?? []) map[c.type]?.push(c);
    return map;
  }, [categories]);

  return (
    <div>
      <PageHeader
        title="Categorias"
        description="Crie e edite suas categorias. A descrição ajuda o ZapWallet a classificar seus lançamentos automaticamente."
        actions={
          <Button
            onClick={() => {
              setCreateForm(EMPTY_FORM);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nova categoria
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (categories ?? []).length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-8">
          {GROUPS.map(({ type, title, description }) =>
            grouped[type].length === 0 ? null : (
              <section key={type}>
                <div className="mb-3.5">
                  <h2 className="text-card-title font-semibold text-foreground">{title}</h2>
                  <p className="text-meta text-muted-foreground">{description}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 stagger">
                  {grouped[type].map((cat) => (
                    <CategoryCard
                      key={cat.id}
                      cat={cat}
                      onEdit={() => openEdit(cat)}
                      onDelete={() => setDeleteCat(cat)}
                    />
                  ))}
                </div>
              </section>
            )
          )}
        </div>
      )}

      {/* Dialog: Nova categoria */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogHeader>
          <DialogTitle>Nova categoria</DialogTitle>
          <DialogDescription>
            Dê um nome e uma descrição clara — é ela que a IA usa para classificar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(createForm);
          }}
        >
          <CategoryFormFields form={createForm} setForm={setCreateForm} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Salvando..." : "Criar categoria"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Dialog: Editar categoria */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogHeader>
          <DialogTitle>Editar categoria</DialogTitle>
          <DialogDescription>
            Atualize o nome, o tipo, o emoji ou a descrição para a IA.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (editCat) editMutation.mutate({ id: editCat.id, form: editForm });
          }}
        >
          <CategoryFormFields form={editForm} setForm={setEditForm} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Dialog: Excluir categoria */}
      <Dialog open={!!deleteCat} onOpenChange={(o) => !o && setDeleteCat(null)}>
        <DialogHeader>
          <DialogTitle>Excluir categoria</DialogTitle>
          <DialogDescription>
            {deleteCat
              ? `Tem certeza que quer excluir "${deleteCat.name}"? Os lançamentos antigos mantêm o nome da categoria, mas ela some das sugestões.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDeleteCat(null)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => deleteCat && deleteMutation.mutate(deleteCat.id)}
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function CategoryCard({
  cat,
  onEdit,
  onDelete,
}: {
  cat: Category;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex flex-col surface-interactive">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[1.0625rem] leading-none">
              {cat.emoji ? cat.emoji : <Tags className="h-4 w-4 text-muted-foreground" />}
            </span>
            <CardTitle className="truncate capitalize">{cat.name}</CardTitle>
          </div>
          <Badge variant={TYPE_BADGE[cat.type]}>{TYPE_LABEL[cat.type]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {cat.description ? (
          <p className="text-meta leading-relaxed text-muted-foreground">{cat.description}</p>
        ) : (
          <p className="flex items-start gap-1.5 text-meta text-warning">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Sem descrição — adicione uma para a IA acertar mais.
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" />
          Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="hover:bg-negative/10 hover:text-negative"
        >
          <Trash2 className="h-4 w-4" />
          Excluir
        </Button>
      </CardFooter>
    </Card>
  );
}

function CategoryFormFields({
  form,
  setForm,
}: {
  form: CategoryFormState;
  setForm: React.Dispatch<React.SetStateAction<CategoryFormState>>;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[88px_1fr]">
        <div className="space-y-2">
          <Label htmlFor="cat-emoji">Emoji</Label>
          <Input
            id="cat-emoji"
            placeholder="🍔"
            maxLength={4}
            value={form.emoji}
            onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cat-name">Nome</Label>
          <Input
            id="cat-name"
            placeholder="Ex.: Pets"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cat-type">Tipo</Label>
        <Select
          id="cat-type"
          value={form.type}
          onChange={(e) =>
            setForm((f) => ({ ...f, type: e.target.value as CategoryType }))
          }
        >
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
          <option value="both">Ambos (gastos e receitas)</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cat-description">Descrição para a IA</Label>
        <Textarea
          id="cat-description"
          placeholder="O que entra aqui? Ex.: ração, veterinário, banho e tosa, petshop."
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
        />
        <p className="text-xs text-muted-foreground">
          Liste exemplos e palavras-chave; o ZapWallet usa isso para classificar
          seus lançamentos pelo WhatsApp.
        </p>
      </div>
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <UIEmptyState
        icon={<Tags />}
        title="Nenhuma categoria ainda"
        description="Crie sua primeira categoria com uma descrição para a IA classificar seus gastos e receitas."
        action={
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Criar primeira categoria
          </Button>
        }
      />
    </Card>
  );
}
