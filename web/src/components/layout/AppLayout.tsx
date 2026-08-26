import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link, Outlet, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, AlertTriangle, BarChart3, CreditCard, Gauge, LayoutDashboard,
  Repeat, Settings, Tags, Target, X,
} from "lucide-react";
import { CURRENCY_STORAGE_KEY, cn, type CurrencyCode } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, isPremiumActive } from "@/hooks/useProfile";
import type { Profile } from "@/integrations/supabase/types";
import { CommandMenu, useCommandShortcut, type CommandItem } from "@/components/ui/command-menu";
import { Sidebar } from "./Sidebar";
import { Topbar, type Alert } from "./Topbar";
import { BottomNav } from "./BottomNav";
import { MobileHeader } from "../mobile/MobileHeader";
import { MobileBottomNavigation } from "../mobile/MobileBottomNavigation";

const COLLAPSED_KEY = "zw:sidebar-collapsed";

/** Mensagem de urgência do trial (regra de negócio original preservada). */
function trialMessage(profile?: Profile | null): string | null {
  if (!profile || profile.plan !== "Trial" || !isPremiumActive(profile)) return null;

  const remaining =
    profile.message_limit > 0
      ? Math.max(0, profile.message_limit - (profile.messages_this_month ?? 0))
      : null;
  const daysLeft = profile.premium_until
    ? Math.max(0, Math.floor((new Date(profile.premium_until).getTime() - Date.now()) / 86_400_000))
    : null;

  if (remaining !== null && remaining <= 3) {
    return remaining === 0
      ? "Você usou todas as suas mensagens grátis. Assine para continuar usando o ZapWallet 👇"
      : `Faltam só ${remaining} mensagem${remaining === 1 ? "" : "s"} no seu trial grátis — assine agora para não perder o acesso.`;
  }
  if (daysLeft !== null && daysLeft <= 1) {
    return daysLeft === 0
      ? "Seu trial expira hoje! Garanta acesso contínuo assinando um plano."
      : "Seu trial termina amanhã — assine agora e continue sem interrupção.";
  }
  return null;
}

export default function AppLayout() {
  const { signOut } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1"
  );

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (profile?.currency) localStorage.setItem(CURRENCY_STORAGE_KEY, profile.currency);
  }, [profile?.currency]);

  const handleCurrencyChange = useCallback(async (currency: CurrencyCode) => {
    if (!profile || profile.currency === currency) return;
    const { error } = await supabase.from("profiles").update({ currency }).eq("id", profile.id);
    if (error) {
      toast.error("Não foi possível trocar a moeda.");
      return;
    }
    localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    await queryClient.invalidateQueries();
    window.location.reload();
  }, [profile, queryClient]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate("/login");
  }, [signOut, navigate]);

  const openCommand = useCallback(() => setCommandOpen(true), []);
  useCommandShortcut(openCommand);

  const banner = trialMessage(profile);

  const alerts: Alert[] = useMemo(() => {
    const list: Alert[] = [];
    if (banner) {
      list.push({
        id: "trial",
        title: "Seu trial está acabando",
        description: banner,
        to: "/assinatura",
        tone: "warning",
      });
    }
    return list;
  }, [banner]);

  /** Ações do ⌘K — apenas navegação; a lógica de cada tela é a existente. */
  const commandItems: CommandItem[] = useMemo(
    () => [
      {
        id: "nova-transacao",
        label: "Nova transação",
        group: "Ações",
        keywords: "adicionar gasto receita lancamento",
        icon: <ArrowLeftRight />,
        run: () => navigate("/transacoes?novo=1"),
      },
      {
        id: "nova-meta",
        label: "Criar meta",
        group: "Ações",
        keywords: "objetivo poupar guardar",
        icon: <Target />,
        run: () => navigate("/metas?novo=1"),
      },
      {
        id: "novo-limite",
        label: "Criar limite",
        group: "Ações",
        keywords: "orcamento teto controle",
        icon: <Gauge />,
        run: () => navigate("/limites?novo=1"),
      },
      {
        id: "nova-recorrente",
        label: "Criar recorrência",
        group: "Ações",
        keywords: "assinatura mensal fixo",
        icon: <Repeat />,
        run: () => navigate("/recorrentes?novo=1"),
      },
      {
        id: "ir-inicio",
        label: "Início",
        group: "Ir para",
        keywords: "dashboard resumo home",
        icon: <LayoutDashboard />,
        run: () => navigate("/dashboard"),
      },
      {
        id: "ir-transacoes",
        label: "Transações",
        group: "Ir para",
        keywords: "extrato historico",
        icon: <ArrowLeftRight />,
        run: () => navigate("/transacoes"),
      },
      {
        id: "ir-categorias",
        label: "Categorias",
        group: "Ir para",
        icon: <Tags />,
        run: () => navigate("/categorias"),
      },
      {
        id: "ir-relatorios",
        label: "Relatórios",
        group: "Ir para",
        keywords: "graficos analise",
        icon: <BarChart3 />,
        run: () => navigate("/relatorios"),
      },
      {
        id: "ir-assinatura",
        label: "Assinatura",
        group: "Ir para",
        keywords: "plano pagamento premium configuracoes",
        icon: <CreditCard />,
        run: () => navigate("/assinatura"),
      },
      ...(profile?.is_admin
        ? [
            {
              id: "ir-admin",
              label: "Painel admin",
              group: "Ir para",
              keywords: "administracao gestao configuracoes",
              icon: <Settings />,
              run: () => navigate("/admin"),
            } as CommandItem,
          ]
        : []),
    ],
    [navigate, profile?.is_admin]
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      {/* Sidebar desktop — fixa, sem borda pesada */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden shrink-0 border-r border-border bg-surface md:block",
          "transition-[width] duration-slow ease-out-soft",
          collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]"
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          isAdmin={profile?.is_admin}
          onSignOut={handleSignOut}
          profile={profile}
          onCurrencyChange={handleCurrencyChange}
        />
      </aside>

      {/* Sidebar mobile — drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[17rem] border-r border-border bg-surface shadow-lg animate-sheet-in">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Fechar menu"
              className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <Sidebar
              collapsed={false}
              isAdmin={profile?.is_admin}
              onNavigate={() => setDrawerOpen(false)}
              onSignOut={handleSignOut}
              showCollapseButton={false}
              profile={profile}
              onCurrencyChange={handleCurrencyChange}
            />
          </aside>
        </div>
      )}

      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-col transition-[padding] duration-slow ease-out-soft",
          collapsed ? "md:pl-[var(--sidebar-width-collapsed)]" : "md:pl-[var(--sidebar-width)]"
        )}
      >
        <div className="hidden md:block">
          <Topbar
            profile={profile}
            alerts={alerts}
            onOpenMenu={() => setDrawerOpen(true)}
            onOpenCommand={openCommand}
            onSignOut={handleSignOut}
            onCurrencyChange={handleCurrencyChange}
          />
        </div>
        <MobileHeader
          profile={profile}
          alertCount={alerts.length}
          onOpenSearch={openCommand}
          onOpenAlerts={openCommand}
          onOpenProfile={() => setDrawerOpen(true)}
        />

        {banner && (
          <Link
            to="/assinatura"
            className="group border-b border-warning/20 bg-warning/[0.07] transition-colors duration-fast hover:bg-warning/[0.12]"
          >
            <div className="mx-auto flex w-full max-w-content items-start gap-2.5 px-4 py-2.5 text-meta leading-snug text-warning sm:items-center md:px-8">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
              <span className="min-w-0">{banner}</span>
            </div>
          </Link>
        )}

        <main className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-0">
          <div className="mx-auto w-full min-w-0 max-w-content md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <div className="hidden md:block">
        <BottomNav />
      </div>
      <MobileBottomNavigation 
        onCreate={() => navigate("/transacoes?novo=1")} 
        onMore={() => setDrawerOpen(true)} 
      />

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} items={commandItems} />
    </div>
  );
}
