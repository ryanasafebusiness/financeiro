import { Link, useNavigate } from "react-router-dom";
import { Bell, Menu, Search, LogOut, CreditCard, Sparkles, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import type { Profile } from "@/integrations/supabase/types";
import type { CurrencyCode } from "@/lib/utils";

export type Alert = {
  id: string;
  title: string;
  description?: string;
  to?: string;
  tone?: "default" | "warning" | "danger";
};

function initials(name?: string | null): string {
  const clean = (name ?? "").trim();
  if (!clean) return "ZW";
  const parts = clean.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "ZW";
}

/** Barra superior fixa, translúcida — some no scroll sem roubar atenção. */
export function Topbar({
  profile,
  alerts,
  onOpenMenu,
  onOpenCommand,
  onSignOut,
  onCurrencyChange,
}: {
  profile?: Profile | null;
  alerts: Alert[];
  onOpenMenu: () => void;
  onOpenCommand: () => void;
  onSignOut: () => void;
  onCurrencyChange: (currency: CurrencyCode) => void | Promise<void>;
}) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-content items-center gap-3 px-4 md:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <span className="text-[0.9375rem] font-semibold tracking-tight md:hidden">ZapWallet</span>

        {/* Gatilho do command menu */}
        <button
          type="button"
          onClick={onOpenCommand}
          className={cn(
            "group ml-auto flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-xs",
            "text-meta text-muted-foreground transition-[border-color,color] duration-fast",
            "hover:border-border-strong hover:text-foreground md:ml-0 md:w-64"
          )}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden md:block">Buscar…</span>
          <kbd className="ml-auto hidden items-center rounded border border-border px-1.5 py-0.5 text-label md:flex">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Notificações */}
          <Dropdown
            menuClassName="w-[min(20rem,calc(100vw-1.5rem))]"
            trigger={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label="Notificações"
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-fast",
                  open ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Bell className="h-[1.05rem] w-[1.05rem]" />
                {alerts.length > 0 && (
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-negative ring-2 ring-background" />
                )}
              </button>
            )}
          >
            <DropdownLabel>Notificações</DropdownLabel>
            {alerts.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Bell />}
                title="Tudo em dia"
                description="Você não tem alertas no momento."
              />
            ) : (
              alerts.map((a) => {
                const body = (
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-meta font-semibold",
                        a.tone === "danger" ? "text-negative" : a.tone === "warning" ? "text-warning" : "text-foreground"
                      )}
                    >
                      {a.title}
                    </p>
                    {a.description && (
                      <p className="mt-0.5 text-label leading-relaxed text-muted-foreground">{a.description}</p>
                    )}
                  </div>
                );
                return a.to ? (
                  <Link
                    key={a.id}
                    to={a.to}
                    className="block rounded-md px-2.5 py-2 transition-colors duration-fast hover:bg-muted"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={a.id} className="rounded-md px-2.5 py-2">
                    {body}
                  </div>
                );
              })
            )}
          </Dropdown>

          {/* Avatar + menu rápido */}
          <Dropdown
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label="Sua conta"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-meta font-semibold text-accent-foreground ring-1 ring-inset ring-primary/20 transition-transform duration-fast hover:scale-[1.03]"
              >
                {initials(profile?.name)}
              </button>
            )}
          >
            <div className="px-2.5 pb-2 pt-1.5">
              <p className="truncate text-meta font-semibold text-foreground">
                {profile?.name || "Sua conta"}
              </p>
              <p className="truncate text-label text-muted-foreground">
                {profile?.plan ? `Plano ${profile.plan}` : "ZapWallet"}
              </p>
            </div>
            <DropdownSeparator />
            <DropdownItem icon={<CreditCard />} onSelect={() => navigate("/assinatura")}>
              Assinatura
            </DropdownItem>
            <DropdownItem icon={<Sparkles />} onSelect={() => navigate("/relatorios")}>
              Relatórios
            </DropdownItem>
            <DropdownItem
              icon={<Coins />}
              onSelect={() => onCurrencyChange(profile?.currency === "BRL" ? "EUR" : "BRL")}
            >
              Moeda: {profile?.currency === "BRL" ? "Real (R$)" : "Euro (€)"}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<LogOut />} tone="danger" onSelect={onSignOut}>
              Sair
            </DropdownItem>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
