import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Crown,
  MessageSquare,
  Receipt,
  DollarSign,
  Radio,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api, apiUrl } from "@/lib/api";
import { brl, cn } from "@/lib/utils";
import { toast } from "sonner";

interface AdminStats {
  users: number;
  premium_active: number;
  messages_today: number;
  messages_total: number;
  transactions_total: number;
  revenue: number;
}

interface AdminMessage {
  chat: string;
  message: string;
  is_outgoing: boolean;
  ai_generated: boolean;
  created_at: string;
}

interface MessagesResponse {
  messages: AdminMessage[];
}

interface TicketResponse {
  ticket: string;
}

interface LogLine {
  id: number;
  level: string;
  text: string;
}

const MAX_LOG_LINES = 50;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function MetricCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </CardContent>
    </Card>
  );
}

function logLevelClass(level: string): string {
  const l = level.toLowerCase();
  if (l.includes("error") || l.includes("erro") || l.includes("fatal")) return "text-destructive";
  if (l.includes("warn") || l.includes("aviso")) return "text-amber-500";
  if (l.includes("debug") || l.includes("trace")) return "text-muted-foreground";
  if (l.includes("info")) return "text-emerald-500";
  return "text-foreground";
}

function MessageBadge({ message }: { message: AdminMessage }) {
  if (message.ai_generated) {
    return <Badge variant="default">IA</Badge>;
  }
  if (message.is_outgoing) {
    return <Badge variant="secondary">enviada</Badge>;
  }
  return <Badge variant="outline">recebida</Badge>;
}

export default function AdminDashboard() {
  const {
    data: stats,
    isLoading: statsLoading,
  } = useQuery<AdminStats>({
    queryKey: ["admin", "stats"],
    queryFn: async () => api.adminGet("/api/stats"),
  });

  const {
    data: messagesData,
    isLoading: messagesLoading,
  } = useQuery<MessagesResponse>({
    queryKey: ["admin", "messages"],
    queryFn: async () => api.adminGet("/api/messages?limit=30"),
  });

  const messages = messagesData?.messages ?? [];

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const lineIdRef = useRef(0);
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs]);

  const appendLog = (level: string, text: string) => {
    setLogs((prev) => {
      const next = [...prev, { id: lineIdRef.current++, level, text }];
      if (next.length > MAX_LOG_LINES) {
        return next.slice(next.length - MAX_LOG_LINES);
      }
      return next;
    });
  };

  const connect = async () => {
    if (connecting || connected) return;
    setConnecting(true);
    try {
      const { ticket } = await api.adminPost<TicketResponse>("/api/ticket", {});
      const url = apiUrl(
        "/admin/api/logs/stream?ticket=" + encodeURIComponent(ticket),
      );
      const es = new EventSource(url);
      sourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setConnecting(false);
      };

      es.onmessage = (event) => {
        let level = "info";
        let text = event.data as string;
        try {
          const parsed = JSON.parse(event.data) as { level?: string; message?: string };
          if (parsed && typeof parsed === "object") {
            level = parsed.level ?? level;
            text = parsed.message ?? text;
          }
        } catch {
          // texto cru
        }
        appendLog(level, text);
      };

      es.onerror = () => {
        toast.error("Conexão de logs perdida");
        es.close();
        if (sourceRef.current === es) {
          sourceRef.current = null;
        }
        setConnected(false);
        setConnecting(false);
      };
    } catch (e) {
      toast.error((e as Error).message);
      setConnecting(false);
    }
  };

  const disconnect = () => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Visão geral</h1>
        <p className="text-muted-foreground">Métricas e atividade do ZapWallet em tempo real.</p>
      </div>

      {statsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            title="Usuários"
            value={String(stats?.users ?? 0)}
            icon={Users}
            description="Total cadastrados"
          />
          <MetricCard
            title="Premium ativos"
            value={String(stats?.premium_active ?? 0)}
            icon={Crown}
            description="Assinaturas vigentes"
          />
          <MetricCard
            title="Mensagens hoje"
            value={String(stats?.messages_today ?? 0)}
            icon={MessageSquare}
            description={`${stats?.messages_total ?? 0} no total`}
          />
          <MetricCard
            title="Mensagens (total)"
            value={String(stats?.messages_total ?? 0)}
            icon={MessageSquare}
          />
          <MetricCard
            title="Transações"
            value={String(stats?.transactions_total ?? 0)}
            icon={Receipt}
            description="Registradas no sistema"
          />
          <MetricCard
            title="Receita"
            value={brl(Number(stats?.revenue ?? 0))}
            icon={DollarSign}
            description="Faturamento acumulado"
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mensagens recentes</CardTitle>
            <CardDescription>Últimas 30 mensagens trocadas.</CardDescription>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma mensagem encontrada.
              </p>
            ) : (
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {messages.map((msg, idx) => (
                  <div
                    key={`${msg.chat}-${msg.created_at}-${idx}`}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{msg.chat}</span>
                        <MessageBadge message={msg} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {msg.message}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Radio className={cn("h-4 w-4", connected ? "text-emerald-500" : "text-muted-foreground")} />
                Logs ao vivo
              </CardTitle>
              <CardDescription>
                {connected ? "Transmitindo logs do servidor." : "Conecte para acompanhar os logs."}
              </CardDescription>
            </div>
            {connected ? (
              <Button variant="outline" size="sm" onClick={disconnect}>
                Desconectar
              </Button>
            ) : (
              <Button size="sm" onClick={connect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Conectando
                  </>
                ) : (
                  "Conectar"
                )}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <pre
              ref={preRef}
              className="h-[420px] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100"
            >
              {logs.length === 0 ? (
                <span className="text-zinc-500">
                  {connected ? "Aguardando logs..." : "Nenhum log. Clique em \"Conectar\"."}
                </span>
              ) : (
                logs.map((line) => (
                  <div key={line.id} className={logLevelClass(line.level)}>
                    <span className="text-zinc-500">[{line.level}]</span> {line.text}
                  </div>
                ))
              )}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
