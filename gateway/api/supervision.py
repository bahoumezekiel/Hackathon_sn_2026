"""Espace supervision : registres, flux des demandes, alertes et intégrité (rôle supervisor)."""
import uuid
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .. import audit, config, db, health, resilience
from ..auth import supervisor_auth
from ..schemas import AlertUpdateIn, OutageIn

router = APIRouter(prefix="/supervision", tags=["supervision"], dependencies=[Depends(supervisor_auth)])


@router.get("/registries")
def supervision_registries():
    with db.tx() as c:
        rows = c.execute(
            """SELECT r.code, r.name, r.status, r.failure_threshold, r.last_health_check,
                      (SELECT count(*) FROM access_request q
                        WHERE q.registry_id = r.id AND q.status = 'QUEUED') AS queued
               FROM administrative_registry r ORDER BY r.code""").fetchall()
    for row in rows:  # état du disjoncteur : lu dans Redis
        cb = resilience.circuit(row["code"])
        row["consecutive_failures"] = cb["failures"]
        row["circuit_open"] = cb["open"]
        row["circuit_opened_at"] = (datetime.fromtimestamp(cb["opened_at"], UTC)
                                    if cb["opened_at"] else None)
    return rows


@router.get("/stack")
def supervision_stack():
    return {"components": health.stack_status(), "retry_queue_size": resilience.queue_size()}


@router.post("/registries/{code}/simulate")
def supervision_simulate(code: str, body: OutageIn):
    """DÉMONSTRATION : provoque ou lève une panne du registre simulé."""
    if not config.DEMO_MODE:
        raise HTTPException(403, "Disponible uniquement en mode démonstration")
    with db.tx() as c:
        reg = c.execute("SELECT endpoint_url FROM administrative_registry WHERE code=%s",
                        (code.upper(),)).fetchone()
    if not reg:
        raise HTTPException(404, "Registre inconnu")
    r = httpx.post(f"{reg['endpoint_url']}/_chaos", json={"down": body.down},
                   headers={"X-Registry-Token": config.REGISTRY_TOKEN}, timeout=3)
    r.raise_for_status()
    return r.json()


@router.get("/requests")
def supervision_requests():
    with db.tx() as c:
        return c.execute(
            """SELECT q.id, q.created_at, a.name AS administration, r.code AS registry,
                      q.purpose_code, q.status, q.decision, q.service_mode, q.retry_count,
                      purpose_label(q.requester_admin_id, q.purpose_code) AS purpose_label
               FROM access_request q
               JOIN administration a ON a.id = q.requester_admin_id
               JOIN administrative_registry r ON r.id = q.registry_id
               ORDER BY q.created_at DESC LIMIT 25""").fetchall()


@router.get("/alerts")
def supervision_alerts():
    """Signalements des citoyens, les dossiers ouverts en premier."""
    with db.tx() as c:
        return c.execute(
            """SELECT ca.id, ca.created_at, ca.channel, ca.language, ca.description, ca.status,
                      ca.resolution_note, a.name AS contested_administration,
                      e.purpose_code AS contested_purpose, e.event_timestamp AS contested_at,
                      purpose_label(e.actor_admin_id, e.purpose_code) AS contested_purpose_label
               FROM citizen_alert ca
               LEFT JOIN audit_event e ON e.id = ca.audit_event_id
               LEFT JOIN administration a ON a.id = e.actor_admin_id
               ORDER BY (ca.status IN ('OPEN','IN_REVIEW')) DESC, ca.created_at DESC
               LIMIT 50""").fetchall()


@router.post("/alerts/{alert_id}")
def supervision_update_alert(alert_id: uuid.UUID, body: AlertUpdateIn):
    closed = body.status in ("RESOLVED", "REJECTED")
    with db.tx() as c:
        row = c.execute(
            """UPDATE citizen_alert SET status=%s, resolution_note=coalesce(%s, resolution_note),
                   resolved_at=%s WHERE id=%s RETURNING id, status""",
            (body.status, body.note, db.utcnow() if closed else None, alert_id)).fetchone()
    if not row:
        raise HTTPException(404, "Alerte introuvable")
    return row


@router.get("/integrity")
def supervision_integrity():
    return audit.integrity()
