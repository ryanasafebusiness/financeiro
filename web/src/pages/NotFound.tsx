import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(50rem_32rem_at_50%_0%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent_70%)]"
      />
      <div className="relative flex flex-col items-center gap-5 animate-fade-up">
        <span className="flex h-12 w-12 items-center justify-center rounded-card bg-muted text-muted-foreground">
          <Compass className="h-5 w-5" />
        </span>
        <div className="space-y-1.5">
          <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            Erro 404
          </p>
          <h1 className="text-page-title font-bold text-foreground">Página não encontrada</h1>
          <p className="max-w-sm text-body text-muted-foreground">
            O endereço que você tentou abrir não existe ou foi movido.
          </p>
        </div>
        <Button asChild>
          <Link to="/dashboard">Voltar ao início</Link>
        </Button>
      </div>
    </div>
  );
}
