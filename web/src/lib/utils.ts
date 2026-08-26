import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------
   Moeda — ponto único de formatação do app.
   Formato: "1.234,56 €" (símbolo depois, ponto de milhar, vírgula decimal).
   Para trocar de moeda, mexa só aqui.
   ------------------------------------------------------------------ */

export type CurrencyCode = "EUR" | "BRL";
export const CURRENCY_STORAGE_KEY = "zw:currency";

export function preferredCurrency(): CurrencyCode {
  if (typeof window === "undefined") return "EUR";
  return localStorage.getItem(CURRENCY_STORAGE_KEY) === "BRL" ? "BRL" : "EUR";
}

/** Espaço fino inquebrável: o símbolo nunca se separa do número na quebra de linha. */
const NBSP = "\u00A0";

/** Formata sem converter: EUR -> "1.234,50 €"; BRL -> "R$ 1.234,50". */
export function money(
  value: number | string | null | undefined,
  currency: CurrencyCode = preferredCurrency(),
): string {
  const parsed = typeof value === "string" ? parseFloat(value) : value ?? 0;
  const n = Number.isFinite(parsed as number) ? (parsed as number) : 0;
  const digits = n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "BRL" ? `R$${NBSP}${digits}` : `${digits}${NBSP}€`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (sem fuso). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** timestamptz -> 'DD/MM/YYYY HH:MM' no fuso local. Cai p/ formatDate se inválido. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return formatDate(iso);
  return dt.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
