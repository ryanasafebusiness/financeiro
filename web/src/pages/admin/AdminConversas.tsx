import { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Search, MessageSquare, ArrowLeft } from "lucide-react";

interface AdminUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

interface AdminUsersResponse {
  users: AdminUser[];
}

interface ChatMessage {
  id: string;
  chat: string;
  message: string;
  is_outgoing: boolean;
  ai_generated: boolean;
  created_at: string;
}

interface MessagesResponse {
  messages: ChatMessage[];
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ConversationView({ user }: { user: AdminUser }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-conversation", user.id],
    queryFn: async () => {
      const res = (await api.adminGet(
        "/api/users/" + user.id + "/messages?limit=300",
      )) as MessagesResponse;
      return res?.messages ?? [];
    },
  });

  const messages = data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-12 w-2/3", i % 2 === 0 ? "" : "ml-auto")}
          />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Nenhuma mensagem registrada para este usuário.
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className="space-y-2 p-4">
      {messages.map((msg) => {
        const incoming = !msg.is_outgoing; // recebida do usuário
        const day = dayLabel(msg.created_at);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={msg.id}>
            {showDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {day}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex",
                incoming ? "justify-start" : "justify-end",
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                  incoming
                    ? "rounded-bl-sm bg-card border"
                    : "rounded-br-sm bg-primary text-primary-foreground",
                )}
              >
                {!incoming && msg.ai_generated && (
                  <Badge
                    variant="secondary"
                    className="mb-1 h-4 px-1.5 text-[10px]"
                  >
                    IA
                  </Badge>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                <div
                  className={cn(
                    "mt-1 text-right text-[10px]",
                    incoming
                      ? "text-muted-foreground"
                      : "text-primary-foreground/70",
                  )}
                >
                  {formatDateTime(msg.created_at)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminConversas() {
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [selected, setSelected] = useState<AdminUser | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(handle);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users-conversas", debouncedSearch],
    queryFn: async () => {
      const res = (await api.adminGet(
        "/api/users?search=" + encodeURIComponent(debouncedSearch),
      )) as AdminUsersResponse;
      return res?.users ?? [];
    },
  });

  const users = data ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Conversas</h1>
        <p className="text-muted-foreground">
          Espelhamento das conversas do WhatsApp por usuário (somente leitura).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Lista de usuários */}
        <Card className={cn(selected && "hidden lg:block")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-primary" />
              Usuários
            </CardTitle>
            <CardDescription>Selecione para ver a conversa.</CardDescription>
            <div className="relative mt-2">
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
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum usuário encontrado.
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      selected?.id === u.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    <div className="truncate font-medium">
                      {u.name || "Sem nome"}
                    </div>
                    <div
                      className={cn(
                        "truncate text-xs",
                        selected?.id === u.id
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {u.phone || u.email || u.id}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversa */}
        <Card className={cn("min-h-[60vh]", !selected && "hidden lg:flex")}>
          {selected ? (
            <>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0 border-b">
                <Button
                  variant="ghost"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    {selected.name || "Sem nome"}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {selected.phone || selected.email || selected.id}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="max-h-[60vh] overflow-y-auto p-0">
                <ConversationView user={selected} />
              </CardContent>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Selecione um usuário para ver a conversa.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
