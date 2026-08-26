import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface SystemPromptResponse {
  prompt: string;
  default: string;
  is_custom: boolean;
}

export default function AdminPrompt() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "system-prompt"],
    queryFn: async () => (await api.adminGet("/api/settings/system-prompt")) as SystemPromptResponse,
  });

  // Sincroniza o rascunho quando o prompt salvo chega/atualiza.
  useEffect(() => {
    if (data?.prompt !== undefined) setDraft(data.prompt);
  }, [data?.prompt]);

  const save = useMutation({
    mutationFn: async (prompt: string) =>
      api.adminPut("/api/settings/system-prompt", { prompt }),
    onSuccess: () => {
      toast.success("Prompt salvo! O agente passa a usar em até ~30s.");
      queryClient.invalidateQueries({ queryKey: ["admin", "system-prompt"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar"),
  });

  const reset = useMutation({
    mutationFn: async () => api.adminPost("/api/settings/system-prompt/reset", {}),
    onSuccess: (res: { prompt: string }) => {
      setDraft(res.prompt);
      toast.success("Prompt restaurado para o padrão do código.");
      queryClient.invalidateQueries({ queryKey: ["admin", "system-prompt"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível restaurar"),
  });

  const busy = save.isPending || reset.isPending;
  const dirty = data ? draft !== data.prompt : false;
  const charCount = draft.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Prompt da IA</h1>
          <p className="text-sm text-muted-foreground">
            Persona e regras do agente no WhatsApp. Salvar sincroniza com o serviço na nuvem sem redeploy.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Prompt de sistema</CardTitle>
              <CardDescription>
                Editado aqui sobrescreve o padrão do código. O contexto dinâmico (nome, saldo, data) e o
                formato de resposta são acrescentados automaticamente — não precisa repeti-los.
              </CardDescription>
            </div>
            {data?.is_custom ? (
              <Badge variant="secondary">Personalizado</Badge>
            ) : (
              <Badge variant="outline">Padrão</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
                spellCheck={false}
                className="min-h-[420px] font-mono text-xs leading-relaxed"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{charCount} caracteres</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => reset.mutate()}
                    disabled={busy || !data?.is_custom}
                  >
                    {reset.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
                    )}
                    Restaurar padrão
                  </Button>
                  <Button
                    onClick={() => save.mutate(draft)}
                    disabled={busy || !dirty || !draft.trim()}
                  >
                    {save.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
