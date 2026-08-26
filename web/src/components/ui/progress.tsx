import { cn } from "@/lib/utils";

type Tone = "primary" | "positive" | "warning" | "negative" | "auto";

function toneClass(tone: Tone, pct: number): string {
  const resolved: Exclude<Tone, "auto"> =
    tone !== "auto" ? tone : pct >= 100 ? "negative" : pct >= 80 ? "warning" : "primary";
  return {
    primary: "bg-primary",
    positive: "bg-positive",
    warning: "bg-warning",
    negative: "bg-negative",
  }[resolved];
}

/**
 * Barra de progresso premium. `tone="auto"` vira amarelo perto do limite (>=80%)
 * e vermelho ao ultrapassar (>=100%).
 */
export function Progress({
  value = 0,
  className,
  tone = "auto",
  size = "md",
}: {
  value?: number;
  className?: string;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const raw = Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(100, raw));
  const height = { sm: "h-1.5", md: "h-2", lg: "h-2.5" }[size];

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("w-full overflow-hidden rounded-pill bg-foreground/[0.06]", height, className)}
    >
      <div
        className={cn(
          "h-full origin-left rounded-pill transition-[width] duration-slow ease-out-soft",
          toneClass(tone, raw)
        )}
        style={{ width: `${pct}%`, animation: "grow-x var(--duration-slow) var(--ease-out) backwards" }}
      />
    </div>
  );
}
