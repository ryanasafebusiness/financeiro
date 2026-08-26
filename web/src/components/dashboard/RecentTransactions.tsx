import { Link } from "react-router-dom";
import { ArrowRight, Plus, Receipt, Repeat } from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { money, cn } from "@/lib/utils";
import { categoryIcon } from "@/lib/category-visuals";
import type { CurrencyCode, Transaction } from "@/integrations/supabase/types";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "Hoje" / "Ontem" / "01 ago" — datas curtas, estilo extrato. */
function shortDate(occurredOn: string): string {
  const [y, m, d] = occurredOn.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return occurredOn;
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return `${String(d).padStart(2, "0")} ${MESES[m - 1]}`;
}

export function RecentTransactions({
  transactions,
  isLoading,
  targetCurrency,
  convert,
}: {
  transactions: Transaction[];
  isLoading: boolean;
  targetCurrency: CurrencyCode;
  convert: (amount: number, source: CurrencyCode) => number | null;
}) {
  return (
    <Card>
      <CardToolbar
        icon={<Receipt className="h-4 w-4" />}
        title="Últimas transações"
        description="Seus lançamentos mais recentes."
        action={
          transactions.length > 0 ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/transacoes" className="gap-1.5">
                Ver todas
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        {isLoading ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            title="Nenhuma transação ainda"
            description="Envie uma mensagem no WhatsApp para registrar seu primeiro gasto — ou adicione manualmente."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/transacoes?novo=1" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar transação
                </Link>
              </Button>
            }
          />
        ) : (
          <ul>
            {transactions.map((tx) => {
              const isIncome = tx.type === "income";
              const Icon = categoryIcon(tx.category, tx.type);
              const title = tx.title ?? tx.category ?? "Transação";
              const meta = [tx.category, shortDate(tx.occurred_on)].filter(Boolean).join(" · ");
              const original = Number(tx.amount);
              // mantendo junto (na mesma lista) mas especificando a moeda original

              return (
                <li key={tx.id}>
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-fast hover:bg-muted/60">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        isIncome ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-body font-medium text-foreground">
                        <span className="truncate">{title}</span>
                        {tx.source === "recurring" && (
                          <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                      </p>
                      <p className="truncate text-label capitalize text-muted-foreground">{meta}</p>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 whitespace-nowrap text-body font-semibold tabular",
                        isIncome ? "text-positive" : "text-foreground"
                      )}
                    >
                      {isIncome ? "+" : "−"} {money(Math.abs(original), tx.currency)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
