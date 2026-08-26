import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/integrations/supabase/types";
import { useAuth } from "./useAuth";

/** Carrega o profile do usuário logado (RLS garante que é o próprio). */
export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

export function isPremiumActive(p?: Profile | null): boolean {
  if (!p) return false;
  if (p.is_admin) return true;
  if (!p.premium_until) return false;
  return new Date(p.premium_until).getTime() > Date.now();
}
