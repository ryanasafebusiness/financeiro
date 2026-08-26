import { NavLink } from "react-router-dom";
import { LogOut, PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { userNav, adminNav, type NavItem } from "./nav-items";

/**
 * Sidebar minimalista (referência: apps premium de macOS).
 * Item ativo = fundo verde muito claro + ícone verde + texto escuro.
 */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  isAdmin,
  onNavigate,
  onSignOut,
  showCollapseButton = true,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  isAdmin?: boolean;
  onNavigate?: () => void;
  onSignOut: () => void;
  showCollapseButton?: boolean;
}) {
  const item = (n: NavItem) => (
    <Tooltip key={n.to} content={collapsed ? n.label : null} side="right" className="w-full">
      <NavLink
        to={n.to}
        end={n.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "group/nav relative flex w-full items-center rounded-lg text-body font-medium",
            "transition-[background-color,color] duration-200 ease-out-soft",
            collapsed ? "h-10 w-10 justify-center px-0" : "h-10 gap-3 px-3",
            isActive
              ? "bg-primary-soft text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )
        }
      >
        {({ isActive }) => (
          <>
            <n.icon
              className={cn(
                "h-[1.05rem] w-[1.05rem] shrink-0 transition-colors duration-200",
                isActive ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground"
              )}
            />
            {!collapsed && <span className="truncate">{n.label}</span>}
          </>
        )}
      </NavLink>
    </Tooltip>
  );

  return (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      {/* Marca */}
      <div className={cn("mb-5 flex h-10 items-center", collapsed ? "justify-center" : "gap-2.5 px-1.5")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
          <Wallet className="h-[1.05rem] w-[1.05rem]" />
        </div>
        {!collapsed && (
          <span className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
            ZapWallet
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {userNav.map(item)}

        {isAdmin && (
          <>
            <div className={cn("my-3 h-px bg-border", collapsed ? "mx-1" : "mx-1.5")} />
            {!collapsed && (
              <div className="px-3 pb-1.5 text-label font-semibold uppercase tracking-wide text-muted-foreground">
                Admin
              </div>
            )}
            {adminNav.map(item)}
          </>
        )}
      </nav>

      <div className={cn("mt-2 space-y-0.5 border-t border-border pt-3", collapsed && "flex flex-col items-center")}>
        {showCollapseButton && onToggleCollapsed && (
          <Tooltip content={collapsed ? "Expandir" : null} side="right" className="w-full">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={cn(
                "flex w-full items-center rounded-lg text-body font-medium text-muted-foreground",
                "transition-colors duration-200 hover:bg-muted hover:text-foreground",
                collapsed ? "h-10 w-10 justify-center" : "h-10 gap-3 px-3"
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-[1.05rem] w-[1.05rem]" />
              ) : (
                <>
                  <PanelLeftClose className="h-[1.05rem] w-[1.05rem]" />
                  <span>Recolher</span>
                </>
              )}
            </button>
          </Tooltip>
        )}

        <Tooltip content={collapsed ? "Sair" : null} side="right" className="w-full">
          <button
            type="button"
            onClick={onSignOut}
            className={cn(
              "flex w-full items-center rounded-lg text-body font-medium text-muted-foreground",
              "transition-colors duration-200 hover:bg-muted hover:text-foreground",
              collapsed ? "h-10 w-10 justify-center" : "h-10 gap-3 px-3"
            )}
          >
            <LogOut className="h-[1.05rem] w-[1.05rem]" />
            {!collapsed && <span>Sair</span>}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
