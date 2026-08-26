import * as React from "react";
import { cn } from "@/lib/utils";

/** Select nativo estilizado (sem dependências externas), com chevron próprio. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-card px-3 py-2 pr-9 text-base text-foreground shadow-xs sm:text-body",
        "transition-[border-color,box-shadow] duration-fast ease-out-soft",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/[0.12]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "bg-[right_0.75rem_center] bg-no-repeat",
        "[background-image:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2368746D' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")]",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";
