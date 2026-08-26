import { cn } from "@/lib/utils";

/** Placeholder com brilho deslizante (mais elegante que um pulse chapado). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/[0.045] to-transparent" />
    </div>
  );
}
