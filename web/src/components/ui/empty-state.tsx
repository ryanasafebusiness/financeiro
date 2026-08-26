import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Estado vazio compacto e elegante: ocupa só o espaço necessário,
 * sem grandes áreas mortas.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = "md",
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center animate-fade-in",
        size === "sm" ? "gap-2 py-6" : "gap-3 py-10",
        className
      )}
    >
      {icon && (
        <span
          className={cn(
            "flex items-center justify-center rounded-card bg-muted text-muted-foreground",
            size === "sm" ? "h-10 w-10 [&>svg]:h-4 [&>svg]:w-4" : "h-12 w-12 [&>svg]:h-5 [&>svg]:w-5"
          )}
        >
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <p className="text-body font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-meta leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
