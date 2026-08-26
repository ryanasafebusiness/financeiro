import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

const THEME_STORAGE_KEY = "zapwallet-theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#202124" : "#f8f9f8");
}

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(initialTheme()));

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    sync();
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (theme === "system") media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    }),
    [resolvedTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme deve ser usado dentro de ThemeProvider");
  return context;
}
