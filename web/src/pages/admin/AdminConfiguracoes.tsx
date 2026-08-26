import { useEffect, useState } from "react";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Save, Loader2, CheckCircle2, XCircle, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface FunnelSettings {
  app_base_url: string;
  trial_days: number;
  trial_message_limit: number;
  nudge_threshold_msgs: number;
  nudge_threshold_days: number;
}

interface StripeHealth {
  secret_key_set: boolean;
  livemode: boolean;
  webhook_secret_set: boolean;
  webhook_url: string;
  app_base_url: string;
  plans_active: number;
  plans_missing_price: string[];
  trial_days: number;
  trial_message_limit: number;
  ok: boolean;
}

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const STRIPE_WEBHOOK_URL = `${API_BASE}/webhooks/stripe`;

function CopyButton({ text }: { text: string }) {
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); toast.success("Copiado!"); }}
      className="ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      title="Copiar"
    >
      <Copy className="h-3 w-3" />
      copiar
    </button>
  );
}

function HealthRow({
  ok,
  label,
  detail,
  children,
}: {
  ok: boolean;
  label: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="text-meta font-medium">{label}</p>
        {detail && <p className="break-words text-label text-muted-foreground">{detail}</p>}
        {children}
      </div>
    </div>
  );
}

export default function AdminConfiguracoes() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FunnelSettings | null>(null);

  const { data: health, isLoading: healthLoading } = useQuery<StripeHealth>({
    queryKey: ["admin", "stripe-health"],
    queryFn: () => api.adminGet("/api/stripe/health"),
  });

  const { data: funnel, isLoading: funnelLoading } = useQuery<FunnelSettings>({
    queryKey: ["admin", "funnel-settings"],
    queryFn: () => api.adminGet("/api/settings/funnel"),
  });

  useEffect(() => {
    if (funnel && !form) setForm(funnel);
  }, [funnel]);

  const saveMutation = useMutation({
    mutationFn: (data: FunnelSettings) =>
      api.adminPut("/api/settings/funnel", data),
    onSuccess: () => {
      toast.success("Configurações salvas! Entram em vigor em até ~30s.");
      qc.invalidateQueries({ queryKey: ["admin", "funnel-settings"] });
      qc.invalidateQueries({ queryKey: ["admin", "stripe-health"] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao salvar"),
  });

  const dirty =
    form && funnel ? JSON.stringify(form) !== JSON.stringify(funnel) : false;

  return (
    <div className="space-y-6">
      <div className="mb-1 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-page-title font-bold text-foreground">Configurações</h1>
          <p className="text-meta text-muted-foreground">
            Checkout, trial e nudges de conversão.
          </p>
        </div>
      </div>

      {/* Card de saúde da integração Stripe */}
      <Card
        className={
          health?.ok
            ? "border-positive/20 bg-positive/[0.06]"
            : "border-warning/20 bg-warning/[0.06]"
        }
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              {health?.ok ? (
                <CheckCircle2 className="h-5 w-5 text-positive" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-warning" />
              )}
              Integração Stripe
            </CardTitle>
            {healthLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <Badge variant={health?.ok ? "success" : "secondary"}>
                {health?.ok ? "Pronto para vender" : "Configuração incompleta"}
              </Badge>
            )}
          </div>
          <CardDescription>
            Verifique se tudo está configurado antes de divulgar o produto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : health ? (
            <div className="space-y-3">
              {/* URL que precisa ser registrada como endpoint na Stripe */}
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="mb-1 font-medium">URL do webhook (registre na Stripe)</p>
                <div className="flex items-center gap-1">
                  <code className="break-all text-xs text-primary">{STRIPE_WEBHOOK_URL}</code>
                  <CopyButton text={STRIPE_WEBHOOK_URL} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Na Stripe: <strong>Desenvolvedores → Webhooks → Adicionar endpoint</strong> → cole
                  a URL acima e assine <code>checkout.session.completed</code>,{" "}
                  <code>invoice.paid</code> e <code>customer.subscription.deleted</code>.
                </p>
              </div>

              <HealthRow
                ok={health.secret_key_set}
                label={
                  health.secret_key_set && health.livemode
                    ? "Secret key configurada (modo LIVE)"
                    : "Secret key configurada"
                }
                detail={
                  health.secret_key_set
                    ? undefined
                    : "Cole a chave em Admin → Integrações (Stripe → Secret key)"
                }
              />
              <HealthRow
                ok={health.webhook_secret_set}
                label="Signing secret do webhook configurado"
                detail={
                  health.webhook_secret_set
                    ? undefined
                    : "Crie o endpoint na Stripe e cole o whsec_... em Admin → Integrações"
                }
              >
                {!health.webhook_secret_set && (
                  <p className="mt-1 text-label text-muted-foreground">
                    Na Stripe, vá em <strong>Desenvolvedores → Webhooks → Adicionar endpoint</strong>,
                    use a URL abaixo e assine os eventos{" "}
                    <code>checkout.session.completed</code>, <code>invoice.paid</code> e{" "}
                    <code>customer.subscription.deleted</code>.
                  </p>
                )}
              </HealthRow>
              <HealthRow
                ok={health.plans_active > 0}
                label={`${health.plans_active} plano(s) ativo(s)`}
                detail={
                  health.plans_active === 0
                    ? "Crie pelo menos um plano na página Planos"
                    : undefined
                }
              />
              <HealthRow
                ok={health.plans_missing_price.length === 0}
                label="Price IDs da Stripe preenchidos"
                detail={
                  health.plans_missing_price.length > 0
                    ? `Faltando em: ${health.plans_missing_price.join(", ")}`
                    : "Todos os planos ativos têm offer ID cadastrado"
                }
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Formulário do funil */}
      {funnelLoading || !form ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Funil de vendas</CardTitle>
            <CardDescription>
              O agente lê daqui sem precisar de redeploy. Alterações entram em
              vigor em até ~30 segundos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="app-base-url">URL pública do painel</Label>
              <Input
                id="app-base-url"
                value={form.app_base_url}
                onChange={(e) =>
                  setForm({ ...form, app_base_url: e.target.value })
                }
                placeholder="https://app.seudominio.com"
              />
              <p className="text-label text-muted-foreground">
                Base dos retornos do checkout da Stripe e do link{" "}
                <code>/assinatura</code> que o agente manda no WhatsApp quando o
                trial acaba.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">Trial grátis</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="trial-days">Duração (dias)</Label>
                  <Input
                    id="trial-days"
                    type="number"
                    min={0}
                    value={form.trial_days}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        trial_days: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">0 = sem trial</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trial-msgs">Limite de mensagens</Label>
                  <Input
                    id="trial-msgs"
                    type="number"
                    min={0}
                    value={form.trial_message_limit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        trial_message_limit: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    0 = ilimitado (não recomendado — não há o que converter)
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-sm font-semibold">Nudges de urgência</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Quando o trial está prestes a acabar, o bot envia uma bolha extra
                de conversão (sem passar pela IA).
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nudge-msgs">
                    Disparar com N mensagens restantes
                  </Label>
                  <Input
                    id="nudge-msgs"
                    type="number"
                    min={0}
                    value={form.nudge_threshold_msgs}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        nudge_threshold_msgs: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nudge-days">
                    Disparar com N dias restantes
                  </Label>
                  <Input
                    id="nudge-days"
                    type="number"
                    min={0}
                    value={form.nudge_threshold_days}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        nudge_threshold_days: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => form && saveMutation.mutate(form)}
                disabled={saveMutation.isPending || !dirty}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar configurações
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
