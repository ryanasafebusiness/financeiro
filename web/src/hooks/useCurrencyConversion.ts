import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CurrencyCode } from "@/integrations/supabase/types";

export type ExchangeRates = {
  target: CurrencyCode;
  date: string;
  provider: string;
  rates: Record<CurrencyCode, number>;
};

export function useCurrencyConversion(target: CurrencyCode) {
  const query = useQuery<ExchangeRates>({
    queryKey: ["exchange-rates", target],
    queryFn: () => api.exchangeRates(target),
    staleTime: 6 * 60 * 60 * 1000,
  });

  const convert = useCallback((amount: number, source: CurrencyCode): number | null => {
    if (source === target) return amount;
    const multiplier = query.data?.rates[source];
    return typeof multiplier === "number" && Number.isFinite(multiplier)
      ? amount * multiplier
      : null;
  }, [query.data, target]);

  return { ...query, convert };
}
