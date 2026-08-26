"""Buffer em memória dos logs + pub/sub p/ stream SSE no painel admin."""
import asyncio
import logging
from collections import deque
from datetime import datetime, timezone

_BUFFER: deque[dict] = deque(maxlen=500)
_subscribers: set[asyncio.Queue] = set()


class AdminLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        _BUFFER.append(entry)
        for q in list(_subscribers):
            try:
                q.put_nowait(entry)
            except Exception:
                pass


def get_recent() -> list[dict]:
    return list(_BUFFER)


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)
