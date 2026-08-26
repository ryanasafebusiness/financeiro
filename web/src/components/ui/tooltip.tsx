import * as React from "react";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";

const SIDE: Record<Side, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * Tooltip leve em CSS puro (sem Radix). Aparece no hover e no foco por teclado.
 * Usado principalmente pela sidebar recolhida.
 */
export function Tooltip({
  content,
  side = "right",
  children,
  className,
}: {
  content: React.ReactNode;
  side?: Side;
  children: React.ReactNode;
  className?: string;
}) {
  if (!content) return <>{children}</>;
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1",
          "text-label font-medium text-popover-foreground shadow-md",
          "opacity-0 scale-95 transition-[opacity,transform] duration-fast ease-out-soft",
          "group-hover/tt:opacity-100 group-hover/tt:scale-100",
          "group-focus-within/tt:opacity-100 group-focus-within/tt:scale-100",
          SIDE[side]
        )}
      >
        {content}
      </span>
    </span>
  );
}
