import { Link } from "react-router-dom";
import { Gauge, Plus } from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { money, cn } from "@/lib/utils";

export type LimitItem = {
  category: string;
  period: "monthly" | "weekly";
  limit: number;
  spent: number;
  remaining: number;
  exceeded: boolean;
  pct: number;
};

function statusLabel(pct: number, exceeded: boolean) {
  if (exceeded || pct > 100) return { text: "Excedido", cls: "text-negative" };
  if (pct >= 80) return { text: "Atenção", cls: "text-warning" };
  return { text: "No limite", cls: "text-muted-foreground" };
}

/** Limites de gastos com barras de progresso que mudam de tom perto do teto. */
export function LimitsCard({ limits, isLoading }: { limits: LimitItem[]; isLoading: boolean }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardToolbar
        icon={<Gauge className="h-4 w-4" />}
        title="Limites de gastos"
        description="Quanto você já usou de cada teto definido."
        action={
          limits.length > 0 ? (
            <Button asChild variant="ghost" size="xs">
              <Link to="/limites">Gerenciar</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 px-5 pb-6 sm:px-6">
        {isLoading ? (
          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : limits.length === 0 ? (
          <EmptyState
            icon={<Gauge />}
            title="Nenhum limite definido"
            description="Defina um teto por categoria e acompanhe o quanto ainda pode gastar."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/limites?novo=1" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Criar limite
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-5">
            {limits.map((l) => {
              const pct = Math.max(0, Number(l.pct) || 0);
              const status = statusLabel(pct, l.exceeded);
              const remaining = Number(l.remaining);
              return (
                <li key={`${l.category}-${l.period}`}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-meta font-semibold capitalize text-foreground">
                      {l.category === "geral" ? "Limite mensal" : l.category}
                    </span>
                    <span className="shrink-0 text-meta tabular text-muted-foreground">
                      <span className="font-semibold text-foreground">{money(Number(l.spent))}</span>
                      {" / "}
                      {money(Number(l.limit))}
                    </span>
                  </div>
                  <Progress value={pct} />
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-label">
                    <span className={cn("font-medium", status.cls)}>
                      {status.text} · {Math.round(pct)}%
                    </span>
                    <span className="tabular text-muted-foreground">
                      {remaining >= 0 ? `Restante ${money(remaining)}` : `Ultrapassou ${money(Math.abs(remaining))}`}
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
