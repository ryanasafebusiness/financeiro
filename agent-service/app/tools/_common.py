"""Helpers compartilhados pelas tools (não é uma tool — prefixo _, sem DEFINITION)."""

# Resultado padrão quando o valor não veio (ou veio zero/negativo). Faz o agente
# PEDIR o valor em vez de criar um lançamento de R$ 0,00.
INVALID_AMOUNT = {
    "ok": False,
    "erro": "valor_obrigatorio",
    "instrucao": (
        "NÃO registre/crie nada agora: o valor não foi informado (ou veio como zero). "
        "Pergunte ao usuário, de forma curta, qual é o valor exato em reais e só então "
        "chame a ferramenta. Nunca invente nem assuma R$ 0,00."
    ),
}


def parse_amount(valor):
    """Converte p/ float POSITIVO. Retorna None se ausente, zero, negativo ou inválido."""
    if valor is None:
        return None
    try:
        v = float(valor)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None
