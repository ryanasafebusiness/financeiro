import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { bottomNav } from "./nav-items";

/** Navegação inferior no mobile — acesso em um toque ao que mais importa. */
export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="flex h-14 items-stretch">
        {bottomNav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-label font-medium transition-colors duration-fast",
                isActive ? "text-primary" : "text-muted-foreground"
              )
            }
          >
            <n.icon className="h-[1.15rem] w-[1.15rem]" />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
