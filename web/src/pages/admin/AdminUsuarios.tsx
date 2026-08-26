import { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "@/lib/utils";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Crown, Bot, Users } from "lucide-react";

interface AdminUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  plan: string | null;
  premium_until: string | null;
  is_admin: boolean;
  ai_online: boolean;
  messages_this_month: number;
  message_limit: number | null;
  created_at: string;
}

interface AdminUsersResponse {
  users: AdminUser[];
}

const PLAN_OPTIONS = [
  { value: "Mensal", label: "Mensal" },
  { value: "Trimestral", label: "Trimestral" },
  { value: "Anual", label: "Anual" },
  { value: "Premium", label: "Premium" },
];

function isPremiumActiveUntil(premiumUntil: string | null): boolean {
  if (!premiumUntil) return false;
  const until = new Date(premiumUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() >= Date.now();
}

export default function AdminUsuarios() {
  const qc = useQueryClient();

  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce simples por estado
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => clearTimeout(handle);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", debouncedSearch],
    queryFn: async () => {
      const res = (await api.adminGet(
        "/api/users?search=" + encodeURIComponent(debouncedSearch),
      )) as AdminUsersResponse;
      return res?.users ?? [];
    },
  });

  // Estado do dialog de liberar premium
  const [premiumDialogOpen, setPremiumDialogOpen] = useState<boolean>(false);
  const [premiumTarget, setPremiumTarget] = useState<AdminUser | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>("Mensal");
  const [days, setDays] = useState<string>("30");

  const openPremiumDialog = (u: AdminUser) => {
    setPremiumTarget(u);
    setSelectedPlan(u.plan && PLAN_OPTIONS.some((p) => p.value === u.plan) ? u.plan : "Mensal");
    setDays("30");
    setPremiumDialogOpen(true);
  };

  const premiumMutation = useMutation({
    mutationFn: async (vars: { id: string; plan: string; days: number }) => {
      return api.adminPost("/api/users/" + vars.id + "/premium", {
        plan: vars.plan,
        days: vars.days,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Premium liberado com sucesso");
      setPremiumDialogOpen(false);
      setPremiumTarget(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const aiMutation = useMutation({
    mutationFn: async (vars: { id: string; online: boolean }) => {
      return api.adminPost("/api/users/" + vars.id + "/ai", {
        online: vars.online,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Status da IA atualizado");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleSubmitPremium = () => {
    if (!premiumTarget) return;
    const parsedDays = Number(days);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      toast.error("Informe um número de dias válido");
      return;
    }
    premiumMutation.mutate({
      id: premiumTarget.id,
      plan: selectedPlan,
      days: parsedDays,
    });
  };

  const users = data ?? [];

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Gerencie usuários, libere acesso premium e controle a IA."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Lista de usuários
          </CardTitle>
          <CardDescription>
            Busque por nome, telefone ou e-mail.
          </CardDescription>
          <div className="relative mt-2 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar usuário..."
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="Nenhum usuário encontrado"
              description="Ajuste a busca ou aguarde novos cadastros."
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <table className="w-full min-w-[760px] text-meta">
                <thead>
                  <tr className="border-b border-border text-left text-label font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="py-2.5 pr-4 font-medium">Nome</th>
                    <th className="py-2.5 pr-4 font-medium">Telefone</th>
                    <th className="py-2.5 pr-4 font-medium">Plano</th>
                    <th className="py-2.5 pr-4 font-medium">Validade</th>
                    <th className="py-2.5 pr-4 font-medium">Mensagens</th>
                    <th className="py-2.5 pr-4 font-medium">IA</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const active = isPremiumActiveUntil(u.premium_until);
                    const limitLabel =
                      u.message_limit == null ? "∞" : String(u.message_limit);
                    return (
                      <tr
                        key={u.id}
                        className="border-b border-border align-middle transition-colors duration-fast last:border-0 hover:bg-muted/50"
                      >
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {u.name || "Sem nome"}
                            </span>
                            {u.is_admin && (
                              <Badge variant="secondary">Admin</Badge>
                            )}
                          </div>
                          {u.email && (
                            <div className="max-w-[16rem] truncate text-label text-muted-foreground">
                              {u.email}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {u.phone || "—"}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {u.plan || "—"}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>
                              {u.premium_until
                                ? formatDate(u.premium_until)
                                : "—"}
                            </span>
                            <Badge variant={active ? "success" : "outline"}>
                              {active ? "Ativo" : "Inativo"}
                            </Badge>
                          </div>
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {u.messages_this_month}/{limitLabel}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <Badge variant={u.ai_online ? "success" : "secondary"}>
                            {u.ai_online ? "On" : "Off"}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPremiumDialog(u)}
                            >
                              <Crown className="mr-1 h-4 w-4" />
                              Liberar premium
                            </Button>
                            <Button
                              size="sm"
                              variant={u.ai_online ? "secondary" : "default"}
                              disabled={aiMutation.isPending}
                              onClick={() =>
                                aiMutation.mutate({
                                  id: u.id,
                                  online: !u.ai_online,
                                })
                              }
                            >
                              <Bot className="mr-1 h-4 w-4" />
                              {u.ai_online ? "Desligar IA" : "Ligar IA"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={premiumDialogOpen} onOpenChange={setPremiumDialogOpen}>
        <DialogHeader>
          <DialogTitle>Liberar premium</DialogTitle>
          <DialogDescription>
            {premiumTarget
              ? "Conceder acesso premium para " +
                (premiumTarget.name || premiumTarget.phone || "usuário") +
                "."
              : "Conceder acesso premium ao usuário."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="premium-plan">Plano</Label>
            <Select
              id="premium-plan"
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="premium-days">Dias</Label>
            <Input
              id="premium-days"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setPremiumDialogOpen(false)}
            disabled={premiumMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmitPremium}
            disabled={premiumMutation.isPending}
          >
            {premiumMutation.isPending ? "Salvando..." : "Liberar premium"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
