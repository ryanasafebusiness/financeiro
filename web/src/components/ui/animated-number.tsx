import * as React from "react";
import { money } from "@/lib/utils";
import { cn } from "@/lib/utils";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Conta de 0 até `value` em `duration` ms. Devolve o valor corrente. */
export function useCountUp(value: number, duration = 700): number {
  const [display, setDisplay] = React.useState(() => (prefersReducedMotion() ? value : 0));
  const fromRef = React.useRef(0);

  React.useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(value)) {
      setDisplay(value || 0);
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const current = from + delta * easeOut(t);
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

/**
 * Valor financeiro com animação de entrada (count-up de ~700ms).
 * `tabular` evita que o layout "pule" enquanto os dígitos mudam.
 */
export function AnimatedNumber({
  value,
  format = money,
  duration = 700,
  className,
  prefix,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
  prefix?: string;
}) {
  const current = useCountUp(value, duration);
  return (
    <span className={cn("tabular", className)}>
      {prefix}
      {format(current)}
    </span>
  );
}
