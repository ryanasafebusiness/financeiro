import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";
import { AnimatedNumber } from "./animated-number";
import { money } from "@/lib/utils";

/**
 * Métrica compacta reutilizável (páginas internas e painel admin).
 * Versão enxuta do MetricCard do dashboard, sem sparkline.
 */
export function StatTile({
  label,
  value,
  icon,
  tone = "neutral",
  loading,
  format = money,
  hint,
  className,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative" | "primary";
  loading?: boolean;
  format?: (n: number) => string;
  hint?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    neutral: "text-foreground",
    primary: "text-primary",
    positive: "text-positive",
    negative: "text-negative",
  }[tone];

  const iconTone = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    positive: "bg-positive/10 text-positive",
    negative: "bg-negative/10 text-negative",
  }[tone];

  return (
    <Card className={cn("px-5 py-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-meta font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", iconTone)}>
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />
      ) : (
        <AnimatedNumber
          value={value}
          format={format}
          className={cn("mt-2 block text-metric font-semibold", toneClass)}
        />
      )}
      {hint && <p className="mt-1 text-label text-muted-foreground">{hint}</p>}
    </Card>
  );
}
