import { useState } from "react";
import { NavLink, Link, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ArrowLeftRight, Repeat, Tags, Target, Gauge, BarChart3, CreditCard,
  Shield, Users, MessageSquare, Receipt, Bot, LogOut, Menu, X, Wallet,
  Package, Settings, AlertTriangle, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, isPremiumActive } from "@/hooks/useProfile";

const userNav = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { to: "/recorrentes", label: "Recorrentes", icon: Repeat },
  { to: "/categorias", label: "Categorias", icon: Tags },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/limites", label: "Limites", icon: Gauge },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/assinatura", label: "Assinatura", icon: CreditCard },
];

const adminNav = [
  { to: "/admin", label: "Visão geral", icon: Shield, end: true },
  { to: "/admin/usuarios", label: "Usuários", icon: Users },
  { to: "/admin/conversas", label: "Conversas", icon: MessageSquare },
  { to: "/admin/pagamentos", label: "Pagamentos", icon: Receipt },
  { to: "/admin/planos", label: "Planos", icon: Package },
  { to: "/admin/prompt", label: "Prompt da IA", icon: Bot },
  { to: "/admin/integracoes", label: "Integrações", icon: KeyRound },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

function useTrialBanner(profile: ReturnType<typeof useProfile>["data"]) {
  if (!profile || profile.plan !== "Trial" || !isPremiumActive(profile)) return null;

  const remaining =
    profile.message_limit > 0
      ? Math.max(0, profile.message_limit - (profile.messages_this_month ?? 0))
      : null;
  const daysLeft =
    profile.premium_until
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
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const trialBanner = useTrialBanner(profile);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200",
      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

  const iconOnlyClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center justify-center h-10 w-10 rounded-lg transition-colors duration-200 relative group",
      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

  const Sidebar = (
    <div className="flex h-full flex-col gap-1 p-4">
      <div className={cn("flex items-center gap-2 px-2 mb-6", collapsed ? "justify-center" : "")}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
          <Wallet className="h-5 w-5" />
        </div>
        {!collapsed && <span className="text-lg font-bold">ZapWallet</span>}
      </div>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mb-4 flex items-center justify-center h-10 w-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-200 self-center"
        title={collapsed ? "Expandir" : "Retrair"}
      >
        {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
      </button>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1">
          {userNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={collapsed ? iconOnlyClass : linkClass}
              onClick={() => setOpen(false)}
              title={collapsed ? n.label : undefined}
            >
              <n.icon className="h-4 w-4" />
              {!collapsed && n.label}
            </NavLink>
          ))}
        </div>

        {profile?.is_admin && (
          <div className="mt-6 space-y-1">
            {!collapsed && (
              <div className="px-3 text-xs font-semibold uppercase text-muted-foreground">Admin</div>
            )}
            {adminNav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={collapsed ? iconOnlyClass : linkClass}
                onClick={() => setOpen(false)}
                title={collapsed ? n.label : undefined}
              >
                <n.icon className="h-4 w-4" />
                {!collapsed && n.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSignOut}
        className={collapsed ? iconOnlyClass({ isActive: false }) : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"}
        title={collapsed ? "Sair" : undefined}
      >
        <LogOut className="h-4 w-4" /> {!collapsed && "Sair"}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* sidebar desktop */}
      <aside className={cn(
        "hidden shrink-0 border-r md:block transition-all duration-200",
        collapsed ? "w-20" : "w-64"
      )}>{Sidebar}</aside>

      {/* sidebar mobile */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r bg-card">{Sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <button onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="font-bold">ZapWallet</span>
        </header>

        {trialBanner && (
          <Link
            to="/assinatura"
            className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-800 hover:bg-amber-100"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{trialBanner}</span>
          </Link>
        )}

        <main className="flex-1 overflow-x-hidden p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
