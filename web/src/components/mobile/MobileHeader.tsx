import { Bell, Search } from "lucide-react";
import type { Profile } from "@/integrations/supabase/types";

function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "Z") + (parts[1]?.[0] ?? "W")).toUpperCase();
}

export function MobileHeader({
  profile,
  alertCount,
  onOpenSearch,
  onOpenAlerts,
  onOpenProfile,
}: {
  profile?: Profile | null;
  alertCount: number;
  onOpenSearch: () => void;
  onOpenAlerts: () => void;
  onOpenProfile: () => void;
}) {
  const firstName = profile?.name?.trim().split(/\s+/)[0];
  return (
    <header className="sticky top-0 z-30 border-b border-transparent bg-primary pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex h-14 items-center gap-3 px-4">
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Abrir perfil e mais opções"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-foreground text-primary font-semibold transition-transform active:scale-95"
        >
          {initials(profile?.name)}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-label text-primary-foreground/80">Sua vida financeira</p>
          <p className="truncate text-body font-semibold text-primary-foreground">{firstName ? `Olá, ${firstName}` : "ZapWallet"}</p>
        </div>
        <button type="button" onClick={onOpenSearch} aria-label="Buscar" className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground transition-colors active:bg-primary-hover">
          <Search className="h-5 w-5" />
        </button>
        <button type="button" onClick={onOpenAlerts} aria-label="Notificações" className="relative flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground transition-colors active:bg-primary-hover">
          <Bell className="h-5 w-5" />
          {alertCount > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-negative ring-2 ring-background" />}
        </button>
      </div>
    </header>
  );
}
