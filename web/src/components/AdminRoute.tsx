import { Navigate } from "react-router-dom";
import { useProfile } from "@/hooks/useProfile";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading } = useProfile();
  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Carregando…</div>;
  }
  if (!profile?.is_admin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
