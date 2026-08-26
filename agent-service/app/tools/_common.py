"""Helpers compartilhados pelas tools (não é uma tool — prefixo _, sem DEFINITION)."""

# Resultado padrão quando o valor não veio (ou veio zero/negativo). Faz o agente
# PEDIR o valor em vez de criar um lançamento de valor zero.
INVALID_AMOUNT = {
    "ok": False,
    "erro": "valor_obrigatorio",
    "instrucao": (
        "NÃO registre/crie nada agora: o valor não foi informado (ou veio como zero). "
        "Pergunte ao usuário, de forma curta, qual é o valor exato e, se necessário, a moeda; "
        "só então chame a ferramenta. Nunca invente nem assuma valor zero."
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
