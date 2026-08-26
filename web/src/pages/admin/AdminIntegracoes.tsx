import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Loader2, ShieldCheck, Bot, MessageSquare, CreditCard } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface Field {
  set: boolean;
  from_db: boolean;
  masked?: string; // segredos
  value?: string; // não-segredos
}
type Integrations = Record<string, Field>;

interface FieldDef {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  hint?: string;
}

const GROUPS: { title: string; icon: typeof Bot; desc: string; fields: FieldDef[] }[] = [
  {
    title: "OpenAI",
    icon: Bot,
    desc: "Cérebro do agente: conversa, transcrição de áudio e leitura de imagens.",
    fields: [
      { key: "openai_api_key", label: "Chave da API", secret: true, placeholder: "sk-...", hint: "platform.openai.com → API keys" },
      { key: "openai_model", label: "Modelo principal", secret: false, placeholder: "gpt-4o-mini" },
      { key: "openai_vision_model", label: "Modelo de visão (imagens)", secret: false, placeholder: "gpt-4o" },
      { key: "openai_transcribe_model", label: "Modelo de transcrição (áudio)", secret: false, placeholder: "whisper-1" },
      { key: "openai_guardrails_model", label: "Modelo de segurança", secret: false, placeholder: "gpt-4o-mini" },
    ],
  },
  {
    title: "uazapi (WhatsApp)",
    icon: MessageSquare,
    desc: "Gateway que envia e recebe as mensagens no WhatsApp.",
    fields: [
      { key: "uazapi_base_url", label: "URL base", secret: false, placeholder: "https://sua-instancia.uazapi.com" },
      { key: "uazapi_token", label: "Token da instância", secret: true, placeholder: "token...", hint: "também valida o token do webhook recebido" },
    ],
  },
  {
    title: "Stripe (pagamento)",
    icon: CreditCard,
    desc: "Chaves das assinaturas. Os preços de cada plano ficam na página Planos.",
    fields: [
      { key: "stripe_secret_key", label: "Secret key", secret: true, placeholder: "sk_live_...", hint: "Stripe → Desenvolvedores → Chaves de API" },
      { key: "stripe_webhook_secret", label: "Signing secret do webhook", secret: true, placeholder: "whsec_...", hint: "Stripe → Webhooks → seu endpoint → Signing secret" },
    ],
  },
];

export default function AdminIntegracoes() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<Integrations>({
    queryKey: ["admin", "integrations"],
    queryFn: () => api.adminGet("/api/settings/integrations"),
  });

  // Inicializa: não-segredos com o valor atual; segredos em branco (placeholder mostra o mascarado).
  useEffect(() => {
    if (!data) return;
    const init: Record<string, string> = {};
    for (const g of GROUPS)
      for (const f of g.fields) init[f.key] = f.secret ? "" : data[f.key]?.value ?? "";
    setForm(init);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      api.adminPut("/api/settings/integrations", payload),
    onSuccess: (res: any) => {
      const n = res?.saved?.length ?? 0;
      toast.success(`${n} chave(s) salva(s). Entram em vigor em ~30s.`);
      qc.invalidateQueries({ queryKey: ["admin", "integrations"] });
      qc.invalidateQueries({ queryKey: ["admin", "stripe-health"] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao salvar"),
  });

  // Monta o que mudou: segredos só se digitados; não-segredos só se diferentes do atual.
  function changedPayload(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const g of GROUPS)
      for (const f of g.fields) {
        const v = (form[f.key] ?? "").trim();
        if (f.secret) {
          if (v) out[f.key] = v;
        } else if (v && v !== (data?.[f.key]?.value ?? "")) {
          out[f.key] = v;
        }
      }
    return out;
  }

  const dirtyCount = Object.keys(changedPayload()).length;

  function onSubmit() {
    const payload = changedPayload();
    if (Object.keys(payload).length === 0) {
      toast.info("Nada para salvar.");
      return;
    }
    saveMutation.mutate(payload);
  }

  return (
    <div className="space-y-6">
      <div className="mb-1 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-page-title font-bold text-foreground">Integrações</h1>
          <p className="text-meta text-muted-foreground">
            Chaves de API do OpenAI, uazapi e Stripe. Alterações entram em vigor sem redeploy.
          </p>
        </div>
      </div>

      <Card className="border-positive/20 bg-positive/[0.06]">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" />
          <p className="text-sm text-muted-foreground">
            As chaves ficam num cofre no servidor (tabela bloqueada, só o backend acessa) e nunca
            são exibidas por completo. Deixe um campo de segredo em branco para manter o valor atual.
          </p>
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {GROUPS.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <group.icon className="h-5 w-5 text-primary" />
                  {group.title}
                </CardTitle>
                <CardDescription>{group.desc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.fields.map((f) => {
                  const info = data[f.key];
                  return (
                    <div key={f.key} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={f.key}>{f.label}</Label>
                        <Badge variant={info?.from_db ? "success" : "secondary"} className="text-xs">
                          {info?.from_db ? "salvo no painel" : info?.set ? "vindo do .env" : "não configurado"}
                        </Badge>
                      </div>
                      <Input
                        id={f.key}
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        value={form[f.key] ?? ""}
                        placeholder={
                          f.secret
                            ? info?.set
                              ? `${info.masked} (deixe em branco para manter)`
                              : f.placeholder
                            : f.placeholder
                        }
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        className={f.secret ? "font-mono text-sm" : undefined}
                      />
                      {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          <div className="flex items-center justify-end gap-3">
            {dirtyCount > 0 && (
              <span className="text-sm text-muted-foreground">
                {dirtyCount} alteração(ões) pendente(s)
              </span>
            )}
            <Button onClick={onSubmit} disabled={saveMutation.isPending || dirtyCount === 0}>
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar chaves
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
