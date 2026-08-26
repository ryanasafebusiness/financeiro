"""Relatório em PDF: o serviço de PDF, o envio via uazapi e a tool gerar_relatorio(formato='pdf')."""
import json
from datetime import datetime

from app.services import finance_svc as F
from app.services import report_pdf_svc, uazapi_svc, ai_agent_svc as A
from app.tools import gerar_relatorio
from tests.conftest import USER_ID, PHONE
from tests.fakes import assistant_tools, tool_call, final


# ── report_pdf_svc (puro) ─────────────────────────────────────────────────────
def _sample_kwargs():
    return dict(
        user_name="Gabriel 🤑",                       # emoji é descartado, sem crash
        period_label="Junho de 2026",
        summary={"total_income": 3000.0, "total_expense": 1234.56, "balance": 1765.44, "count": 3},
        by_category=[{"category": "🍔 Alimentação", "total": 800.0},
                     {"category": "Transporte", "total": 434.56}],
        transactions=[
            {"occurred_at": "2026-06-15T09:00:00", "title": "Salário", "category": "Salário",
             "type": "income", "amount": 3000.0},
            {"occurred_on": "2026-06-12", "title": "Uber pra reunião", "category": "Transporte",
             "type": "expense", "amount": 34.56},
        ],
        limits=[{"category": "alimentação", "period": "monthly", "spent": 800.0,
                 "limit": 600.0, "exceeded": True, "pct": 133.3}],
        generated_at=datetime(2026, 6, 15, 14, 30),
    )


def test_pdf_bytes_validos():
    pdf = report_pdf_svc.build_financial_report_pdf(**_sample_kwargs())
    assert isinstance(pdf, (bytes, bytearray))
    assert bytes(pdf[:5]) == b"%PDF-"
    assert len(pdf) > 800


def test_pdf_periodo_vazio_nao_quebra():
    pdf = report_pdf_svc.build_financial_report_pdf(
        user_name="", period_label="Maio de 2026",
        summary={"total_income": 0, "total_expense": 0, "balance": 0, "count": 0},
        by_category=[], transactions=[], limits=[],
    )
    assert bytes(pdf[:5]) == b"%PDF-"


def test_pdf_trunca_muitos_lancamentos():
    txs = [{"occurred_on": "2026-06-01", "title": f"Gasto {i}", "category": "Outros",
            "type": "expense", "amount": 1.0} for i in range(120)]
    pdf = report_pdf_svc.build_financial_report_pdf(
        user_name="X", period_label="Junho de 2026",
        summary={"total_income": 0, "total_expense": 120.0, "balance": -120.0, "count": 120},
        by_category=[{"category": "Outros", "total": 120.0}], transactions=txs, limits=[],
    )
    assert bytes(pdf[:5]) == b"%PDF-"


def test_eur_formatacao():
    assert report_pdf_svc._eur(1234.5) == "1.234,50 €"
    assert report_pdf_svc._eur(-50) == "-50,00 €"


def test_txt_descarta_emoji_mantem_acento():
    assert report_pdf_svc._txt("🍔 Alimentação") == "Alimentação"
    assert report_pdf_svc._txt("Salário") == "Salário"


# ── uazapi_svc.send_media / data uri ──────────────────────────────────────────
def test_pdf_data_uri():
    uri = uazapi_svc.pdf_data_uri(b"%PDF-fake")
    assert uri.startswith("data:application/pdf;base64,")


def test_send_media_monta_payload(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self):
            return None

    def _post(url, headers=None, json=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return _Resp()

    monkeypatch.setattr(uazapi_svc._client, "post", _post)
    ok = uazapi_svc.send_media("5585999999999", "data:application/pdf;base64,AAA", "document",
                               doc_name="R.pdf", text="oi", mimetype="application/pdf")
    assert ok is True
    assert captured["url"].endswith("/send/media")
    assert captured["json"]["type"] == "document"
    assert captured["json"]["docName"] == "R.pdf"
    assert captured["json"]["number"] == "5585999999999"


# ── tool gerar_relatorio: regressão do formato resumo ─────────────────────────
def test_relatorio_resumo_nao_envia(ctx, db, sent_media):
    F.create_transaction(USER_ID, "expense", 100, "Alimentação", "x")
    r = gerar_relatorio.execute(ctx, periodo="mes_atual")           # formato padrão
    assert r["ok"] is True and r["gastos"] == 100.0
    assert "enviado" not in r
    assert sent_media == []


# ── tool gerar_relatorio: formato pdf envia documento ─────────────────────────
def test_relatorio_pdf_envia_documento(ctx, db, sent_media):
    F.create_transaction(USER_ID, "expense", 100, "Alimentação", "almoço")
    F.create_transaction(USER_ID, "income", 300, "Salário", "pagamento")
    r = gerar_relatorio.execute(ctx, periodo="mes_atual", formato="pdf")

    assert r["ok"] is True and r["enviado"] is True
    assert r["arquivo"].endswith(".pdf")
    assert "instrucao" in r
    assert len(sent_media) == 1
    msg = sent_media[0]
    assert msg["number"] == PHONE
    assert msg["media_type"] == "document"
    assert msg["doc_name"].endswith(".pdf")
    assert msg["mimetype"] == "application/pdf"
    assert msg["file"].startswith("data:application/pdf;base64,")


def test_relatorio_pdf_sem_telefone(make_db, sent_media):
    db = make_db()
    # zera o telefone do perfil
    db.rows("profiles")[0]["phone"] = ""
    from app.services import supabase_svc
    profile = supabase_svc.get_profile(USER_ID)
    ctx = {"user_id": USER_ID, "profile": profile}
    r = gerar_relatorio.execute(ctx, periodo="mes_atual", formato="pdf")
    assert r["enviado"] is False and r["erro"] == "sem_telefone"
    assert sent_media == []


def test_relatorio_pdf_falha_envio(ctx, db, monkeypatch):
    monkeypatch.setattr(uazapi_svc, "send_media", lambda *a, **k: False)
    r = gerar_relatorio.execute(ctx, periodo="mes_atual", formato="pdf")
    assert r["enviado"] is False and r["erro"] == "falha_envio"
    assert "instrucao" in r


# ── resolução de período / rótulo ─────────────────────────────────────────────
def test_relatorio_pdf_personalizado_label(ctx, db, sent_media):
    F.create_transaction(USER_ID, "expense", 10, "Outros", "x", "2026-03-15")
    r = gerar_relatorio.execute(ctx, periodo="personalizado", formato="pdf",
                                data_inicio="2026-03-01", data_fim="2026-03-31")
    assert r["periodo"]["inicio"] == "2026-03-01"
    assert r["periodo"]["label"] == "01/03/2026 a 31/03/2026"
    assert r["gastos"] == 10.0
    assert "/" not in sent_media[0]["doc_name"]
    assert sent_media[0]["doc_name"] == "Relatório ZapWallet - 01-03-2026 a 31-03-2026.pdf"


def test_relatorio_label_mes_atual(ctx, db):
    r = gerar_relatorio.execute(ctx, periodo="mes_atual")
    # rótulo no formato "<Mês> de <ano>"
    assert " de " in r["periodo"]["label"]


# ── cenário ponta-a-ponta no agente ────────────────────────────────────────────
def test_cenario_relatorio_pdf(db, profile, patch_openai, sent_media):
    F.create_transaction(USER_ID, "expense", 100, "Alimentação", "x")
    patch_openai([
        assistant_tools(tool_call("gerar_relatorio", periodo="mes_atual", formato="pdf")),
        final({"mensagens_cliente": ["Prontinho! Te mandei o relatório em PDF 📄"]}),
    ])
    reply = A.run("sess", "me manda o relatório do mês em pdf", profile)
    assert reply["mensagens_cliente"]
    assert len(sent_media) == 1
    assert sent_media[0]["media_type"] == "document"
