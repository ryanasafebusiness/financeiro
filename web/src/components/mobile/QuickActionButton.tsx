import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function QuickActionButton({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "snap-start flex w-[4.75rem] shrink-0 flex-col items-center gap-2 rounded-xl py-1 text-center",
        "transition-[transform,opacity] duration-fast active:scale-[0.96] active:opacity-80",
        className
      )}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-secondary text-foreground ring-1 ring-inset ring-border/60">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[0.75rem] font-medium leading-tight text-foreground">{label}</span>
    </button>
  );
}
