import { useNavigate } from "react-router-dom";
import { ChevronDown, Gauge, Plus, Repeat, Target, TrendingDown, TrendingUp } from "lucide-react";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

/**
 * Botão "Novo" com menu de ações rápidas. Cada item leva à tela existente
 * já com o diálogo de criação aberto (?novo=1) — a lógica é a da própria tela.
 */
export function QuickActions() {
  const navigate = useNavigate();

  return (
    <Dropdown
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-body font-medium text-primary-foreground shadow-xs",
            "transition-[background-color,transform] duration-fast ease-out-soft hover:bg-primary-hover active:scale-[0.985]"
          )}
        >
          <Plus className="h-4 w-4" />
          Novo
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-fast", open && "rotate-180")}
          />
        </button>
      )}
    >
      <DropdownLabel>Registrar</DropdownLabel>
      <DropdownItem icon={<TrendingUp />} onSelect={() => navigate("/transacoes?novo=1")}>
        Receita
      </DropdownItem>
      <DropdownItem icon={<TrendingDown />} onSelect={() => navigate("/transacoes?novo=1")}>
        Gasto
      </DropdownItem>
      <DropdownItem icon={<Repeat />} onSelect={() => navigate("/recorrentes?novo=1")}>
        Recorrência
      </DropdownItem>
      <DropdownSeparator />
      <DropdownLabel>Planejar</DropdownLabel>
      <DropdownItem icon={<Target />} onSelect={() => navigate("/metas?novo=1")}>
        Criar meta
      </DropdownItem>
      <DropdownItem icon={<Gauge />} onSelect={() => navigate("/limites?novo=1")}>
        Criar limite
      </DropdownItem>
    </Dropdown>
  );
}
