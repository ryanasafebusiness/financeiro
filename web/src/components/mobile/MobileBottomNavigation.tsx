import { BarChart3, Home, MoreHorizontal, Plus, ReceiptText } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const destinations = [
  { to: "/dashboard", label: "Início", icon: Home },
  { to: "/transacoes", label: "Transações", icon: ReceiptText },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

export function MobileBottomNavigation({ onCreate, onMore }: { onCreate: () => void; onMore: () => void }) {
  const { pathname } = useLocation();
  const overflowActive = !destinations.some((item) => pathname.startsWith(item.to));
  const itemClass = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.6875rem] font-medium transition-[color,transform,background-color] active:scale-95";

  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center gap-1">
        {destinations.slice(0, 2).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(itemClass, isActive ? "bg-primary-soft text-primary" : "text-muted-foreground")}>
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={onCreate} aria-label="Criar novo" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform active:scale-90">
          <Plus className="h-6 w-6" />
        </button>
        <NavLink to={destinations[2].to} className={({ isActive }) => cn(itemClass, isActive ? "bg-primary-soft text-primary" : "text-muted-foreground")}>
          <BarChart3 className="h-5 w-5" />
          <span>Relatórios</span>
        </NavLink>
        <button type="button" onClick={onMore} aria-current={overflowActive ? "page" : undefined} className={cn(itemClass, overflowActive ? "bg-primary-soft text-primary" : "text-muted-foreground")}>
          <MoreHorizontal className="h-5 w-5" />
          <span>Mais</span>
        </button>
      </div>
    </nav>
  );
}
