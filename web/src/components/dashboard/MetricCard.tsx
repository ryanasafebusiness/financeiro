import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Sparkline } from "@/components/ui/sparkline";

type Tone = "neutral" | "positive" | "negative";

/**
 * Card financeiro premium: rótulo, valor animado, variação vs. mês anterior
 * e um sparkline discreto ao fundo.
 */
export function MetricCard({
  label,
  value,
  delta,
  series,
  icon,
  tone = "neutral",
  emphasis = false,
  /** true = alta é bom (receitas/saldo); false = alta é ruim (gastos) */
  higherIsBetter = true,
  className,
}: {
  label: string;
  value: number;
  delta: number | null;
  series: number[];
  icon: React.ReactNode;
  tone?: Tone;
  emphasis?: boolean;
  higherIsBetter?: boolean;
  className?: string;
}) {
  const valueTone =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground";

  const stroke =
    tone === "positive"
      ? "var(--positive)"
      : tone === "negative"
        ? "var(--negative)"
        : "var(--primary)";

  const deltaGood = delta === null ? null : higherIsBetter ? delta >= 0 : delta <= 0;
  const DeltaIcon = delta === null ? Minus : delta >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card
      className={cn(
        "group overflow-hidden surface-interactive",
        emphasis && "large-summary-card",
        className
      )}
    >
      <div className={cn("relative px-5 pb-5 pt-5", emphasis && "sm:px-6")}>
        <div className="flex items-start justify-between gap-3">
          <p className="summary-card-label text-meta font-medium text-muted-foreground">{label}</p>
          <span className="summary-card-icon flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors duration-200 group-hover:bg-primary-soft group-hover:text-primary [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        </div>

        <AnimatedNumber
          value={value}
          className={cn(
            "mt-3 block font-semibold",
            emphasis ? "text-metric sm:text-metric-lg" : "text-[1.625rem] leading-8 tracking-tight sm:text-metric",
            "summary-card-value",
            valueTone
          )}
        />

        <div className="mt-2 flex items-center gap-2">
          {delta === null ? (
            <span className="summary-card-meta text-label text-muted-foreground">sem base de comparação</span>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 text-label font-semibold tabular",
                  deltaGood ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                )}
              >
                <DeltaIcon className="h-3 w-3" />
                {Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
              </span>
              <span className="summary-card-meta text-label text-muted-foreground">vs. mês passado</span>
            </>
          )}
        </div>
      </div>

      {/* Sparkline sangrando na base do card */}
      <div className="pointer-events-none -mt-2 opacity-90">
        <Sparkline data={series.length ? series : [0, 0]} stroke={stroke} height={emphasis ? 64 : 52} />
      </div>
    </Card>
  );
}

export function MetricCardSkeleton({
  emphasis,
  className,
}: {
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="space-y-3 px-5 pb-6 pt-5">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className={cn("animate-pulse rounded bg-muted", emphasis ? "h-9 w-52" : "h-8 w-40")} />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-[52px] w-full animate-pulse bg-muted/60" />
    </Card>
  );
}
