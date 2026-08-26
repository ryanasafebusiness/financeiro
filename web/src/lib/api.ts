// Cliente do agent-service (FastAPI). Anexa o JWT do Supabase nas chamadas
// autenticadas (/api/me, /admin/*). OTP é público.
import { supabase } from "@/integrations/supabase/client";

const configuredBase = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");

// Produção na Vercel usa rewrites na mesma origem. Se um .env local escapar
// para o build, nunca deixe o navegador remoto tentar acessar localhost.
const isRemoteBrowserWithLocalApi = (() => {
  if (!configuredBase || typeof window === "undefined") return false;
  try {
    const apiHost = new URL(configuredBase, window.location.origin).hostname;
    const pageHost = window.location.hostname;
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    return localHosts.has(apiHost) && !localHosts.has(pageHost);
  } catch {
    return false;
  }
})();

const BASE = isRemoteBrowserWithLocalApi ? "" : configuredBase;

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res: Response) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  // ── OTP (público) ──
  async requestOtp(phone: string) {
    return handle(await fetch(apiUrl("/api/otp/request"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    }));
  },
  async verifyOtp(phone: string, code: string): Promise<{ email: string; token: string; type: string }> {
    return handle(await fetch(apiUrl("/api/otp/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    }));
  },

  // ── usuário ──
  async me<T = any>(): Promise<T> {
    return handle(await fetch(apiUrl("/api/me"), { headers: await authHeaders() }));
  },
  async plans<T = any>(): Promise<T> {
    return handle(await fetch(apiUrl("/api/plans")));
  },
  async exchangeRates<T = any>(currency: "EUR" | "BRL"): Promise<T> {
    return handle(await fetch(apiUrl(`/api/exchange-rates?currency=${currency}`)));
  },
  /**
   * Abre uma Checkout Session da Stripe e devolve a URL hospedada.
   * mode "subscription" renova sozinho; "payment" é a compra única, único
   * caminho que MB WAY e Multibanco conseguem pagar.
   */
  async createCheckout(
    planId: string,
    mode: "subscription" | "payment" = "subscription",
  ): Promise<{ url: string; session_id: string }> {
    return handle(await fetch(apiUrl("/api/checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ plan_id: planId, mode }),
    }));
  },

  // ── admin ──
  async adminGet<T = any>(path: string): Promise<T> {
    return handle(await fetch(apiUrl(`/admin${path}`), { headers: await authHeaders() }));
  },
  async adminPost<T = any>(path: string, body: unknown): Promise<T> {
    return handle(await fetch(apiUrl(`/admin${path}`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    }));
  },
  async adminPut<T = any>(path: string, body: unknown): Promise<T> {
    return handle(await fetch(apiUrl(`/admin${path}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    }));
  },
  async adminPatch<T = any>(path: string, body: unknown): Promise<T> {
    return handle(await fetch(apiUrl(`/admin${path}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    }));
  },
  async adminDelete<T = any>(path: string): Promise<T> {
    return handle(await fetch(apiUrl(`/admin${path}`), {
      method: "DELETE",
      headers: await authHeaders(),
    }));
  },
};
