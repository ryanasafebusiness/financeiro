import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Ativar modo claro" : "Ativar modo escuro";

  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        aria-pressed={isDark}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-md text-muted-foreground",
          "transition-[background-color,color,transform] duration-fast hover:bg-muted hover:text-foreground active:scale-95",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className
        )}
      >
        <Sun
          aria-hidden
          className={cn(
            "absolute h-[1.05rem] w-[1.05rem] transition-[opacity,transform] duration-200",
            isDark ? "rotate-90 scale-75 opacity-0" : "rotate-0 scale-100 opacity-100"
          )}
        />
        <Moon
          aria-hidden
          className={cn(
            "absolute h-[1.05rem] w-[1.05rem] transition-[opacity,transform] duration-200",
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-75 opacity-0"
          )}
        />
      </button>
    </Tooltip>
  );
}
