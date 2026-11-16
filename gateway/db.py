"""Accès PostgreSQL : une transaction courte par étape (pas de verrou pendant les appels HTTP)."""
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb  # noqa: F401  (réexporté)

from . import config


@contextmanager
def tx():
    conn = psycopg.connect(config.DATABASE_URL, row_factory=dict_row, autocommit=True,
                           options="-c search_path=fasolink,public")
    try:
        with conn.transaction():
            yield conn
    finally:
        conn.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
