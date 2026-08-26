import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Pencil, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { brl } from "@/lib/utils";

interface Plan {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  message_limit: number;
  cakto_offer_id: string | null;
  active: boolean;
}

const EMPTY_FORM = {
  name: "",
  price: "",
  duration_days: "30",
  message_limit: "0",
  cakto_offer_id: "",
  active: true,
};

function isPlaceholderOffer(offer: string | null): boolean {
  return !offer || offer.startsWith("TROQUE_PELO_OFFER_ID");
}

export default function AdminPlanos() {
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Plan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const res = (await api.adminGet("/api/plans")) as { plans: Plan[] };
      return res.plans ?? [];
    },
  });

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditTarget(plan);
    setForm({
      name: plan.name,
      price: String(plan.price),
      duration_days: String(plan.duration_days),
      message_limit: String(plan.message_limit),
      cakto_offer_id: plan.cakto_offer_id ?? "",
      active: plan.active,
    });
    setDialogOpen(true);
  }

  function openDelete(plan: Plan) {
    setDeleteTarget(plan);
    setDeleteDialogOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: (data: object) => api.adminPost("/api/plans", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      toast.success("Plano criado com sucesso");
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao criar plano"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      api.adminPatch(`/api/plans/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      toast.success("Plano atualizado");
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao atualizar plano"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.adminDelete(`/api/plans/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      toast.success("Plano removido");
      setDeleteDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao remover plano"),
  });

  function handleSubmit() {
    const price = parseFloat(form.price);
    const duration_days = parseInt(form.duration_days);
    const message_limit = parseInt(form.message_limit);

    if (!form.name.trim()) return void toast.error("Informe o nome do plano");
    if (isNaN(price) || price < 0) return void toast.error("Preço inválido");
    if (isNaN(duration_days) || duration_days < 1) return void toast.error("Duração mínima: 1 dia");
    if (isNaN(message_limit) || message_limit < 0) return void toast.error("Limite de mensagens inválido");

    const payload = {
      name: form.name.trim(),
      price,
      duration_days,
      message_limit,
      cakto_offer_id: form.cakto_offer_id.trim(),
      active: form.active,
    };

    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const busy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Planos</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie os planos e os offer IDs da Cakto.
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo plano
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Planos cadastrados
          </CardTitle>
          <CardDescription>
            Cada plano precisa do offer ID da Cakto para liberar acesso automaticamente após o pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              Nenhum plano cadastrado. Clique em "Novo plano" para começar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Nome</th>
                    <th className="py-3 pr-4 font-medium">Preço</th>
                    <th className="py-3 pr-4 font-medium">Dias</th>
                    <th className="py-3 pr-4 font-medium">Msgs</th>
                    <th className="py-3 pr-4 font-medium">Offer ID (Cakto)</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b last:border-0 align-middle">
                      <td className="py-3 pr-4 font-medium">{plan.name}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{brl(Number(plan.price))}</td>
                      <td className="py-3 pr-4">{plan.duration_days}d</td>
                      <td className="py-3 pr-4">
                        {plan.message_limit > 0 ? plan.message_limit : "∞"}
                      </td>
                      <td className="py-3 pr-4">
                        {isPlaceholderOffer(plan.cakto_offer_id) ? (
                          <span className="flex items-center gap-1.5 text-amber-600">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span className="font-mono text-xs">
                              {plan.cakto_offer_id || "—"}
                            </span>
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {plan.cakto_offer_id}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={plan.active ? "success" : "secondary"}>
                          {plan.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(plan)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => openDelete(plan)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog criar / editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editTarget ? "Editar plano" : "Novo plano"}</DialogTitle>
          <DialogDescription>
            {editTarget
              ? "Altere as configurações. O offer ID deve corresponder ao ID do produto na Cakto."
              : "Preencha os dados. Use o offer ID do produto cadastrado na Cakto."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="plan-name">Nome</Label>
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Mensal, Trimestral, Anual"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plan-price">Preço (R$)</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                step={0.01}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-days">Duração (dias)</Label>
              <Input
                id="plan-days"
                type="number"
                min={1}
                value={form.duration_days}
                onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-msgs">
              Limite de mensagens{" "}
              <span className="text-muted-foreground">(0 = ilimitado)</span>
            </Label>
            <Input
              id="plan-msgs"
              type="number"
              min={0}
              value={form.message_limit}
              onChange={(e) => setForm({ ...form, message_limit: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-offer">Offer ID (Cakto)</Label>
            <Input
              id="plan-offer"
              value={form.cakto_offer_id}
              onChange={(e) => setForm({ ...form, cakto_offer_id: e.target.value })}
              placeholder="Ex: abc123def456"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Encontre em Cakto → Produtos → seu produto → Oferta → ID da oferta
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-active">Status</Label>
            <Select
              id="plan-active"
              value={form.active ? "1" : "0"}
              onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}
            >
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editTarget ? "Salvar" : "Criar plano"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Dialog confirmar exclusão */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogHeader>
          <DialogTitle>Remover plano</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja remover o plano{" "}
            <strong>{deleteTarget?.name}</strong>? Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteDialogOpen(false)}
            disabled={deleteMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Remover
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
