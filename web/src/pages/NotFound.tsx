import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-5xl font-bold">404</h1>
      <p className="text-muted-foreground">Página não encontrada.</p>
      <Link to="/dashboard">
        <Button>Voltar ao início</Button>
      </Link>
    </div>
  );
}
