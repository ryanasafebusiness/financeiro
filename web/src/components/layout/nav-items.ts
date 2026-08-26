import {
  LayoutDashboard, ArrowLeftRight, Repeat, Tags, Target, Gauge, BarChart3, CreditCard,
  Shield, Users, MessageSquare, Receipt, Bot, Package, Settings, KeyRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

/** Navegação principal do usuário. Rotas idênticas às de App.tsx. */
export const userNav: NavItem[] = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { to: "/recorrentes", label: "Recorrentes", icon: Repeat },
  { to: "/categorias", label: "Categorias", icon: Tags },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/limites", label: "Limites", icon: Gauge },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/assinatura", label: "Assinatura", icon: CreditCard },
];

export const adminNav: NavItem[] = [
  { to: "/admin", label: "Visão geral", icon: Shield, end: true },
  { to: "/admin/usuarios", label: "Usuários", icon: Users },
  { to: "/admin/conversas", label: "Conversas", icon: MessageSquare },
  { to: "/admin/pagamentos", label: "Pagamentos", icon: Receipt },
  { to: "/admin/planos", label: "Planos", icon: Package },
  { to: "/admin/prompt", label: "Prompt da IA", icon: Bot },
  { to: "/admin/integracoes", label: "Integrações", icon: KeyRound },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

/** Itens mais usados — barra inferior no mobile. */
export const bottomNav: NavItem[] = [
  userNav[0], // Início
  userNav[1], // Transações
  userNav[5], // Limites
  userNav[6], // Relatórios
];
