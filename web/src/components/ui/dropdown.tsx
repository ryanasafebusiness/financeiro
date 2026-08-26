import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Menu suspenso próprio (sem Radix): fecha ao clicar fora, no Esc e ao escolher
 * um item. Entrada com fade + scale sutis.
 */
export function Dropdown({
  trigger,
  children,
  align = "end",
  className,
  menuClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 min-w-[13rem] max-w-[calc(100vw-1.5rem)] origin-top overflow-hidden rounded-lg",
            "border border-border bg-popover p-1 shadow-lg animate-scale-in",
            align === "end" ? "right-0" : "left-0",
            menuClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  icon,
  children,
  onSelect,
  shortcut,
  className,
  tone = "default",
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onSelect?: () => void;
  shortcut?: string;
  className?: string;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body font-medium",
        "transition-colors duration-fast",
        tone === "danger"
          ? "text-negative hover:bg-negative/10"
          : "text-foreground hover:bg-muted",
        className
      )}
    >
      {icon && <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="text-label text-muted-foreground">{shortcut}</span>}
    </button>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-label font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export function DropdownSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}
