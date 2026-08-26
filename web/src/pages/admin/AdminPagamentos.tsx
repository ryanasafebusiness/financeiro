import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { brl } from "@/lib/utils";
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pagamentos</h1>
        <p className="text-muted-foreground">
          Acompanhe todas as transações e o faturamento da plataforma.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total recebido
            </CardTitle>
            <Wallet className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold text-emerald-600">
                  {brl(totalReceived)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Soma de compras e assinaturas liberadas.
                </p>
              </>
            )}
          </CardContent>
        </Card>
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
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="rounded-full bg-muted p-3">
                <Inbox className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Nenhum pagamento por aqui</p>
              <p className="text-sm text-muted-foreground">
                Assim que houver transações, elas aparecerão nesta lista.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
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
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {new Date(p.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={eventVariant(p.event)}>{p.event}</Badge>
                      </td>
                      <td className="px-3 py-3">{p.plan ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-medium">
                        {brl(Number(p.amount ?? 0))}
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
