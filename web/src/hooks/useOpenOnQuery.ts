import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Abre um diálogo já existente da página quando a URL traz `?novo=1`
 * (usado pelo command menu e pelas ações rápidas). Consome o parâmetro
 * para não reabrir ao navegar de volta. Não altera nenhuma regra de negócio.
 */
export function useOpenOnQuery(open: (v: boolean) => void, param = "novo") {
  const [params, setParams] = useSearchParams();
  const flag = params.get(param);

  useEffect(() => {
    if (flag !== "1") return;
    open(true);
    const next = new URLSearchParams(params);
    next.delete(param);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);
}
