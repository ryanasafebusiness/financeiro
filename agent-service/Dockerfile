FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Override the command in docker-compose / Railway for the worker:
#   web    -> uvicorn app.main:app --host 0.0.0.0 --port $PORT
#   worker -> celery -A app.celery_app.celery worker --loglevel=info
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
