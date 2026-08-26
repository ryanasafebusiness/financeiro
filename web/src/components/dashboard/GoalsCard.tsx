import { Link } from "react-router-dom";
import { Plus, Target } from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { money, formatDate } from "@/lib/utils";
import type { Goal } from "@/integrations/supabase/types";

export function GoalsCard({ goals, isLoading }: { goals: Goal[]; isLoading: boolean }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardToolbar
        icon={<Target className="h-4 w-4" />}
        title="Metas"
        description="O quanto você já juntou de cada objetivo."
        action={
          goals.length > 0 ? (
            <Button asChild variant="ghost" size="xs">
              <Link to="/metas">Ver todas</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 px-5 pb-6 sm:px-6">
        {isLoading ? (
          <div className="space-y-5">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : goals.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="Nenhuma meta ativa"
            description="Crie uma meta e acompanhe o progresso a cada valor guardado."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/metas?novo=1" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Criar meta
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-5">
            {goals.map((g) => {
              const target = Number(g.target_amount) || 0;
              const saved = Number(g.saved_amount) || 0;
              const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
              return (
                <li key={g.id}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-meta font-semibold text-foreground">{g.name}</span>
                    <span className="shrink-0 text-label font-semibold tabular text-primary">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={pct} tone="primary" />
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-label text-muted-foreground">
                    <span className="tabular">
                      <span className="font-semibold text-foreground">{money(saved)}</span> de {money(target)}
                    </span>
                    {g.deadline && <span>até {formatDate(g.deadline)}</span>}
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
