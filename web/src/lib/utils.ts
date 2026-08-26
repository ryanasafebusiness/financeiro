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

export const CURRENCY = {
  code: "EUR",
  symbol: "€",
  /** Locale usado só para agrupar os dígitos (pt-BR = 1.234,56, igual ao padrão europeu). */
  numberLocale: "pt-BR",
} as const;

/** Espaço fino inquebrável: o símbolo nunca se separa do número na quebra de linha. */
const NBSP = "\u00A0";

/** Formata um número como euro: 1234.5 -> "1.234,50 €". */
export function money(value: number | string | null | undefined): string {
  const parsed = typeof value === "string" ? parseFloat(value) : value ?? 0;
  const n = Number.isFinite(parsed as number) ? (parsed as number) : 0;
  const digits = n.toLocaleString(CURRENCY.numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${digits}${NBSP}${CURRENCY.symbol}`;
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
