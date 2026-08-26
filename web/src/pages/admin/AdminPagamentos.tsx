import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { money } from "@/lib/utils";
import { CreditCard, Wallet, Inbox } from "lucide-react";

interface Payment {
  id: string;
  user_id: string;
  event: string;
  plan: string | null;
  amount: number;
  status: string | null;
  payment_method: string | null;
  created_at: string;
}

interface PaymentsResponse {
  payments: Payment[];
}

const RELEASING_EVENTS = [
  "purchase_approved",
  "subscription_created",
  "subscription_renewed",
];

function eventVariant(
  event: string,
): "success" | "destructive" | "secondary" {
  if (event === "purchase_approved" || event.startsWith("subscription_")) {
    return "success";
  }
  if (event === "refund" || event === "chargeback") {
    return "destructive";
  }
  return "secondary";
}

export default function AdminPagamentos() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "payments"],
    queryFn: async () => {
      const res = await api.adminGet("/api/payments?limit=100");
      return res as PaymentsResponse;
    },
  });

  const payments = data?.payments ?? [];

  const totalReceived = payments.reduce((acc, p) => {
    if (RELEASING_EVENTS.includes(p.event)) {
      return acc + Number(p.amount ?? 0);
    }
    return acc;
  }, 0);

  return (
    <div>
      <PageHeader
        title="Pagamentos"
        description="Acompanhe todas as transações e o faturamento da plataforma."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Total recebido"
          value={totalReceived}
          icon={<Wallet className="h-4 w-4" />}
          tone="positive"
          loading={isLoading}
          hint="Soma de compras e assinaturas liberadas."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Histórico de pagamentos
          </CardTitle>
          <CardDescription>Últimas 100 transações registradas.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="Nenhum pagamento por aqui"
              description="Assim que houver transações, elas aparecerão nesta lista."
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <table className="w-full min-w-[720px] text-meta">
                <thead>
                  <tr className="border-b border-border text-left text-label font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Evento</th>
                    <th className="px-3 py-2 font-medium">Plano</th>
                    <th className="px-3 py-2 font-medium">Valor</th>
                    <th className="px-3 py-2 font-medium">Método</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border transition-colors duration-fast last:border-0 hover:bg-muted/50"
                    >
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {new Date(p.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={eventVariant(p.event)}>{p.event}</Badge>
                      </td>
                      <td className="px-3 py-3">{p.plan ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-medium">
                        {money(Number(p.amount ?? 0))}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {p.payment_method ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {p.status ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
