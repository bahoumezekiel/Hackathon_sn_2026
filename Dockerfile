# Image unique : passerelle FasoLink, registres simulés et script d'initialisation
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY gateway gateway
COPY registries-mock registries-mock
COPY db db
COPY scripts scripts

RUN useradd --system --uid 10001 fasolink
USER fasolink

EXPOSE 8000
CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
