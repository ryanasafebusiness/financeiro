import * as React from "react";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
 * Command menu (⌘K / Ctrl+K).
 * Base do algoritmo de ranking/navegação adaptada do "Command Palette" do
 * 21st.dev (@ddoemonn), reescrita sem motion/react e sem Radix para respeitar
 * os primitives próprios do ZapWallet.
 * ------------------------------------------------------------------------ */

const BOUNDARY = /[\s\-_/.:]/;

export type CommandItem = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  keywords?: string;
  shortcut?: string[];
  icon?: React.ReactNode;
  run: () => void;
};

/** Pontua um texto contra a busca, favorecendo prefixos e inícios de palavra. */
function scoreOne(text: string, query: string): number {
  const t = text.toLowerCase();
  let cursor = 0;
  let total = 0;
  let streak = 0;

  for (let i = 0; i < query.length; i++) {
    const at = t.indexOf(query[i], cursor);
    if (at < 0) return -1;
    streak = at === cursor && i > 0 ? streak + 1 : 0;
    total += 2 + streak * 4;
    if (at === 0) total += 12;
    else if (BOUNDARY.test(t[at - 1])) total += 8;
    cursor = at + 1;
  }
  return total;
}

function rank(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const scored: { item: CommandItem; score: number; order: number }[] = [];
  items.forEach((item, i) => {
    const direct = scoreOne(item.label, q);
    const aliased = item.keywords ? scoreOne(item.keywords, q) - 3 : -1;
    const best = Math.max(direct, aliased);
    if (best < 0) return;
    scored.push({ item, score: best - item.label.length * 0.05, order: i });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.item);
}

/** Atalho global ⌘K / Ctrl+K. */
export function useCommandShortcut(onOpen: () => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

export function CommandMenu({
  open,
  onOpenChange,
  items,
  placeholder = "Buscar ação ou página…",
  emptyLabel = "Nada encontrado.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [pinned, setPinned] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const results = React.useMemo(() => rank(items, query), [items, query]);
  const activeId = results.some((r) => r.id === pinned) ? pinned : results[0]?.id ?? null;
  const activeIndex = results.findIndex((r) => r.id === activeId);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setPinned(null);
      // foco após a montagem, sem rolar a página
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const reveal = (index: number) => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!list || !row) return;
    const top = row.offsetTop - 6;
    const bottom = row.offsetTop + row.offsetHeight + 6;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };

  const move = (delta: number) => {
    if (results.length === 0) return;
    const from = activeIndex < 0 ? 0 : activeIndex;
    const next = (from + delta + results.length) % results.length;
    setPinned(results[next].id);
    reveal(next);
  };

  const run = (item?: CommandItem) => {
    const target = item ?? results.find((r) => r.id === activeId);
    if (!target) return;
    onOpenChange(false);
    target.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  if (!open) return null;

  // Agrupa preservando a ordem do ranking.
  const groups: { name: string; items: CommandItem[] }[] = [];
  results.forEach((item) => {
    const name = item.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  });

  let index = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[8vh] sm:p-4 sm:pt-[12vh]">
      <div
        className="absolute inset-0 bg-foreground/25 backdrop-blur-[3px] animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu de comandos"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-card border border-border bg-popover shadow-lg animate-fade-up"
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.2 10.2 13.5 13.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-body"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-label text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[min(55vh,26rem)] overflow-y-auto overscroll-contain p-1.5">
          {results.length === 0 ? (
            <p className="py-10 text-center text-meta text-muted-foreground">{emptyLabel}</p>
          ) : (
            groups.map((group) => (
              <div key={group.name || "geral"}>
                {group.name && (
                  <div className="px-2.5 pb-1 pt-2 text-label font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.name}
                  </div>
                )}
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  const active = item.id === activeId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={i}
                      onMouseMove={() => item.id !== activeId && setPinned(item.id)}
                      onClick={() => run(item)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-fast",
                        active ? "bg-muted" : "bg-transparent"
                      )}
                    >
                      {item.icon && (
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md [&>svg]:h-4 [&>svg]:w-4",
                            active ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
                          )}
                        >
                          {item.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="hidden shrink-0 text-meta text-muted-foreground sm:block">
                          {item.hint}
                        </span>
                      )}
                      {item.shortcut && (
                        <span className="flex shrink-0 items-center gap-1">
                          {item.shortcut.map((k) => (
                            <kbd
                              key={k}
                              className="rounded border border-border px-1.5 py-0.5 text-label text-muted-foreground"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden items-center justify-between border-t border-border px-4 py-2 text-label text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border px-1.5 py-0.5">↑</kbd>
            <kbd className="rounded border border-border px-1.5 py-0.5">↓</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border px-1.5 py-0.5">↵</kbd>
            selecionar
          </span>
        </div>
      </div>
    </div>
  );
}
