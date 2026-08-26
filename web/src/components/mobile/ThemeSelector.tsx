import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const options: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Laptop },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" aria-label="Tema da interface">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => setTheme(option.value)}
          className={cn(
            "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-meta font-medium transition-all active:scale-[0.98]",
            theme === option.value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
          )}
        >
          <option.icon className="h-4 w-4" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
