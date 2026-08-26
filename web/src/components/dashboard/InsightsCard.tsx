import { Lightbulb, TrendingDown, TrendingUp, CalendarClock } from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export type Insight = {
  id: string;
  text: string;
  tone: "positive" | "negative" | "neutral";
  kind: "trend-down" | "trend-up" | "projection";
};

const ICON = {
  "trend-down": TrendingDown,
  "trend-up": TrendingUp,
  projection: CalendarClock,
};

const TONE = {
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  neutral: "bg-primary-soft text-primary",
};

/**
 * Insights derivados dos dados reais do usuário (comparação com o mês anterior
 * e projeção de fim de mês). Sem dados suficientes, mostra estado vazio —
 * nunca números inventados.
 */
export function InsightsCard({ insights, isLoading }: { insights: Insight[]; isLoading: boolean }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardToolbar
        icon={<Lightbulb className="h-4 w-4" />}
        title="Insights"
        description="Leituras rápidas do seu mês."
      />
      <div className="flex-1 px-5 pb-6 sm:px-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <EmptyState
            icon={<Lightbulb />}
            title="Ainda sem insights"
            description="Assim que houver histórico suficiente, os padrões dos seus gastos aparecem aqui."
          />
        ) : (
          <ul className="space-y-2.5">
            {insights.map((i) => {
              const Icon = ICON[i.kind];
              return (
                <li
                  key={i.id}
                  className="flex items-start gap-3 rounded-lg bg-surface-secondary px-3 py-2.5"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TONE[i.tone]}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-meta leading-relaxed text-foreground">{i.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
