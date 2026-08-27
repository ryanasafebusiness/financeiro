"""Instância do Celery.

Broker/backend = Redis. Em dev (REDIS_URL=fake) não há broker real, então
ativamos task_always_eager: as tasks rodam inline no processo da API. Em
produção, rode a API e o worker (`celery -A app.celery_app.celery worker`).
"""
import logging

from celery import Celery
from celery.schedules import crontab

from app.config import settings

log = logging.getLogger(__name__)

_eager = settings.effective_redis_url.lower() == "fake"

celery = Celery(
    "gobbi",
    broker=settings.broker_url if not _eager else "memory://",
    backend=settings.backend_url if not _eager else "cache+memory://",
    include=["app.tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.app_tz,
    enable_utc=True,
    task_track_started=True,
    worker_max_tasks_per_child=200,
    broker_connection_retry_on_startup=True,
    # Cada task só ocupa 1 slot — evita que finalize_batch (lento, IA) bloqueie
    # o worker enquanto process_inbound (rápido, webhook) espera na fila.
    worker_prefetch_multiplier=1,
    # Resultados expiram em 1h — suficiente p/ retry tracking, sem acumular no Redis.
    result_expires=3600,
    # Filas separadas p/ escala independente:
    #   inbound  → process_inbound  (rápido, muitos; 1 worker --concurrency=8)
    #   agent    → finalize_batch   (lento, IA;    1 worker --concurrency=2-4)
    #   celery   → beat tasks (default)
    task_routes={
        "app.tasks.process_inbound": {"queue": "inbound"},
        "app.tasks.finalize_batch": {"queue": "agent"},
    },
)

# Jobs agendados (requer `celery beat` rodando).
celery.conf.beat_schedule = {
    # Materializa as transações recorrentes 1x/dia.
    "materializar-recorrencias": {
        "task": "app.tasks.materializar_recorrencias",
        "schedule": crontab(hour=6, minute=0),
    },
    # Zera o contador mensal de mensagens no início do mês (pula trials).
    "reset-mensal-mensagens": {
        "task": "app.tasks.reset_monthly_counters",
        "schedule": crontab(hour=0, minute=5, day_of_month=1),
    },
}

if _eager:
    celery.conf.task_always_eager = True
    celery.conf.task_eager_propagates = False
    log.info("Celery em modo EAGER (dev) — tasks rodam inline")
