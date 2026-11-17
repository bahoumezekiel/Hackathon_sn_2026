"""API FasoLink : espace administration, espace citoyen, espace supervision."""
import json
import logging
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from . import audit, config, crypto, db, policy, registry_client, resilience, service
from .auth import agent_auth, citizen_auth, keycloak_ready, supervisor_auth
from .predicates import ATTRIBUTES, display

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s : %(message)s")
log = logging.getLogger("fasolink")


# ---------------------------------------------------------------- tâche de fond

def _worker(stop: threading.Event) -> None:
    """Contrôle de santé des registres + relance des demandes en attente."""
    while not stop.is_set():
        try:
            service.resync_queue()
            with db.tx() as c:
                registries = c.execute("SELECT * FROM administrative_registry").fetchall()
            for reg in registries:
                registry_client.health_check(reg)
            if (n := service.process_due_queue()):
                log.info("%s demande(s) relancée(s)", n)
        except Exception:
            log.exception("Erreur dans la tâche de fond")
        stop.wait(config.WORKER_INTERVAL_S)


@asynccontextmanager
async def lifespan(_app):
    stop = threading.Event()
    thread = threading.Thread(target=_worker, args=(stop,), daemon=True, name="fasolink-worker")
    thread.start()
    yield
    stop.set()
    thread.join(timeout=5)


app = FastAPI(
    title="FasoLink", version="0.2.0", lifespan=lifespan,
    description=(
        "Socle d'interopérabilité administrative — « Dites-le nous une fois ».\n\n"
        "**Authentification** : jeton d'accès Keycloak (realm `fasolink`). Pour un système "
        "d'information : flux *client credentials* avec le client `admin-a`, `admin-b` ou `admin-c`. "
        "Cliquez sur **Authorize** et collez le jeton."),
    swagger_ui_parameters={"persistAuthorization": True},
)


@app.exception_handler(crypto.VaultError)
async def _vault_error(_req, exc):
    log.error("Vault : %s", exc)
    return JSONResponse(status_code=503, content={"detail": "Service de chiffrement (Vault) indisponible"})


@app.exception_handler(service.NotFound)
async def _not_found(_req, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(service.BadRequest)
async def _bad_request(_req, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# ---------------------------------------------------------------- modèles

class CitizenRef(BaseModel):
    iue: str | None = None
    registry: str | None = None
    local_reference: str | None = None


class VerificationIn(BaseModel):
    citizen: CitizenRef
    purpose_code: str
    predicates: list[str] = Field(default_factory=list,
                                  description="Questions fermées, ex. est_majeur → Oui/Non")
    attributes: list[str] = Field(default_factory=list,
                                  description="Champs demandés, ex. nom, pere (si la politique l'autorise)")
    justification: str | None = None


class AttestationIn(BaseModel):
    jws: str


class AlertIn(BaseModel):
    request_id: uuid.UUID | None = None
    description: str = Field(min_length=3, max_length=2000)
    channel: str = "WEB"
    language: str = "fr"


class ConsentIn(BaseModel):
    policy_code: str
    grant: bool


class OutageIn(BaseModel):
    down: bool


class AlertUpdateIn(BaseModel):
    status: str
    note: str | None = None


# ---------------------------------------------------------------- public

@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/docs")


@app.get("/health")
def health():
    return {"status": "UP"}


def _stack_status() -> list[dict]:
    def pg() -> bool:
        try:
            with db.tx() as c:
                c.execute("SELECT 1")
            return True
        except Exception:
            return False
    return [
        {"component": "PostgreSQL", "role": "Base de données", "up": pg()},
        {"component": "Keycloak", "role": "Authentification et rôles", "up": keycloak_ready()},
        {"component": "Open Policy Agent", "role": "Moteur de politiques", "up": policy.health()},
        {"component": "Redis", "role": "Cache et résilience", "up": resilience.health()},
        {"component": "Vault", "role": "Chiffrement et secrets", "up": crypto.health()},
    ]


@app.get("/health/stack", tags=["public"])
def health_stack():
    """État de chaque composant du socle technique."""
    return _stack_status()


@app.get("/.well-known/jwks.json", tags=["public"])
def jwks():
    """Clé publique : n'importe qui peut vérifier une attestation FasoLink."""
    return crypto.jwks()


@app.post("/v1/attestations/verify", tags=["public"])
def verify_attestation(body: AttestationIn):
    try:
        claims = crypto.verify(body.jws)
    except jwt.ExpiredSignatureError:
        return {"valid": False, "error": "Attestation expirée"}
    except jwt.PyJWTError as exc:
        return {"valid": False, "error": f"Signature invalide ({type(exc).__name__})"}
    return {"valid": True, "claims": claims,
            "display": display(claims["predicate"], claims["value"])}


# ---------------------------------------------------------------- espace administration

@app.get("/v1/purposes", tags=["administration"])
def purposes(auth=Depends(agent_auth)):
    """Démarches que cette administration peut effectuer, regroupées par finalité.

    Une finalité peut couvrir plusieurs registres (ex. candidature à un recrutement :
    état civil + nationalité + casier) : un seul envoi interroge alors chacun d'eux."""
    with db.tx() as c:
        rows = c.execute(
            """SELECT p.policy_code, p.purpose_code, p.legal_basis, p.allowed_predicates,
                      p.allowed_attributes, p.predicate_params, p.requires_consent,
                      r.code AS registry_code, r.name AS registry_name,
                      pu.label, pu.description, pu.replaces, pu.decision_note
               FROM data_access_policy p
               JOIN administrative_registry r ON r.id = p.registry_id
               LEFT JOIN purpose pu ON pu.code = p.purpose_code
               WHERE p.requesting_admin_id=%s AND p.is_active
               ORDER BY p.purpose_code, r.code""",
            (auth["admin"]["id"],)).fetchall()
    grouped: dict[str, dict] = {}
    for row in rows:
        g = grouped.setdefault(row["purpose_code"], {
            "purpose_code": row["purpose_code"], "label": row["label"] or row["purpose_code"],
            "description": row["description"], "decision_note": row["decision_note"],
            "replaces": row["replaces"] or [], "checks": []})
        g["checks"].append({
            "policy_code": row["policy_code"], "registry_code": row["registry_code"],
            "registry_name": row["registry_name"], "legal_basis": row["legal_basis"],
            "requires_consent": row["requires_consent"],
            "predicates": [{"code": p, "label": display(p, None, row["predicate_params"].get(p))
                            .removesuffix(" : None")} for p in row["allowed_predicates"]],
            "attributes": [{"code": a, "label": ATTRIBUTES[a]["label"]}
                           for a in row["allowed_attributes"] if a in ATTRIBUTES],
        })
    return {"administration": auth["admin"]["name"], "purposes": list(grouped.values())}


@app.post("/v1/verifications", tags=["administration"])
def create_verification(body: VerificationIn, auth=Depends(agent_auth)):
    """Pose des questions (ex. est_majeur → Oui/Non) ou demande des attributs autorisés.

    Les informations sont regroupées par registre ; chaque registre fait l'objet d'une
    décision OPA, d'une attestation signée et d'une trace d'audit distinctes."""
    return service.submit_verification(
        admin=auth["admin"], agent_id=auth["agent_id"], citizen=body.citizen.model_dump(),
        purpose_code=body.purpose_code, predicates=body.predicates, attributes=body.attributes,
        justification=body.justification)


@app.get("/v1/requests/{request_id}", tags=["administration"])
def get_request(request_id: uuid.UUID, auth=Depends(agent_auth)):
    return service.request_view(request_id, admin_id=auth["admin"]["id"])


# ---------------------------------------------------------------- espace citoyen

@app.get("/citizen/history", tags=["citoyen"])
def citizen_history(identity_id=Depends(citizen_auth)):
    """Qui a consulté mes données, quand, pourquoi, et qu'est-ce qui a été transmis ?"""
    with db.tx() as c:
        identity = c.execute("SELECT identity_status, iue_ciphertext FROM national_identity_reference "
                             "WHERE id=%s", (identity_id,)).fetchone()
        rows = c.execute(
            """SELECT q.id, q.created_at, q.completed_at, q.purpose_code, q.status, q.decision,
                      q.decision_reason, q.service_mode, q.justification,
                      a.name AS administration, r.name AS registry, r.code AS registry_code,
                      coalesce(pu.label, q.purpose_code) AS purpose_label,
                      coalesce(dp.predicate_params, '{}'::jsonb) AS predicate_params,
                      CASE WHEN q.status = 'COMPLETED' THEN
                        coalesce((SELECT jsonb_agg(d->>'document') FROM jsonb_array_elements(pu.replaces) d
                                  WHERE d->>'registry' = r.code), '[]'::jsonb)
                      ELSE '[]'::jsonb END AS documents_avoided,
                      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                 'predicate', t.predicate, 'value', t.predicate_value,
                                 'from_cache', t.served_from_cache, 'observed_at', t.observed_at)
                               ORDER BY t.issued_at), '[]'::jsonb)
                         FROM attestation t WHERE t.request_id = q.id) AS shared,
                      (SELECT e.attributes_accessed FROM audit_event e
                        WHERE e.request_id = q.id AND e.event_type = 'REGISTRY_QUERIED'
                        ORDER BY e.seq DESC LIMIT 1) AS fields_read,
                      (SELECT jsonb_build_object('event_id', e.id, 'seq', e.seq,
                                                 'hash', encode(e.event_hash, 'hex'))
                         FROM audit_event e WHERE e.request_id = q.id
                         ORDER BY e.seq DESC LIMIT 1) AS proof,
                      EXISTS (SELECT 1 FROM citizen_alert ca JOIN audit_event e
                                ON e.id = ca.audit_event_id WHERE e.request_id = q.id) AS alerted
               FROM access_request q
               JOIN administration a ON a.id = q.requester_admin_id
               JOIN administrative_registry r ON r.id = q.registry_id
               LEFT JOIN purpose pu ON pu.code = q.purpose_code
               LEFT JOIN data_access_policy dp ON dp.id = q.policy_id
               WHERE q.identity_id = %s
               ORDER BY q.created_at DESC LIMIT 200""", (identity_id,)).fetchall()
    for row in rows:
        params = row.pop("predicate_params")
        row["shared"] = [dict(s, display=display(s["predicate"], s["value"], params.get(s["predicate"])))
                         for s in row["shared"]]
    iue_hint = None
    if identity["iue_ciphertext"]:
        iue_hint = "••••" + crypto.decrypt(identity["iue_ciphertext"])[-4:]
    return {"identity_status": identity["identity_status"], "iue_hint": iue_hint, "accesses": rows}


@app.get("/citizen/integrity", tags=["citoyen"])
def citizen_integrity(_identity=Depends(citizen_auth)):
    return _integrity()


@app.post("/citizen/alerts", tags=["citoyen"])
def citizen_alert(body: AlertIn, identity_id=Depends(citizen_auth)):
    """Signaler un accès suspect (portail web ou assistant vocal)."""
    if body.channel not in ("WEB", "VOICE", "SMS", "USSD"):
        raise HTTPException(400, "Canal invalide")
    with db.tx() as c:
        event_id = None
        if body.request_id:
            req = c.execute("SELECT id FROM access_request WHERE id=%s AND identity_id=%s",
                            (body.request_id, identity_id)).fetchone()
            if not req:
                raise HTTPException(404, "Accès introuvable")
            event_id = c.execute("SELECT id FROM audit_event WHERE request_id=%s "
                                 "ORDER BY seq DESC LIMIT 1", (body.request_id,)).fetchone()["id"]
        alert = c.execute(
            """INSERT INTO citizen_alert (identity_id, audit_event_id, channel, language, description)
               VALUES (%s,%s,%s,%s,%s) RETURNING id, status, created_at""",
            (identity_id, event_id, body.channel, body.language, body.description)).fetchone()
        audit.log(c, "CITIZEN_ALERT", identity_id=identity_id, request_id=body.request_id,
                  decision="N/A")
    return alert


@app.get("/citizen/consents", tags=["citoyen"])
def citizen_consents(identity_id=Depends(citizen_auth)):
    with db.tx() as c:
        return c.execute(
            """SELECT p.policy_code, p.purpose_code, coalesce(pu.label, p.purpose_code) AS purpose_label,
                      a.name AS administration, r.name AS registry,
                      (SELECT cc.consent_status FROM citizen_consent cc
                        WHERE cc.identity_id=%s AND cc.requesting_admin_id=p.requesting_admin_id
                          AND cc.purpose_code=p.purpose_code
                        ORDER BY cc.collected_at DESC LIMIT 1) AS status
               FROM data_access_policy p
               JOIN administration a ON a.id = p.requesting_admin_id
               JOIN administrative_registry r ON r.id = p.registry_id
               LEFT JOIN purpose pu ON pu.code = p.purpose_code
               WHERE p.requires_consent AND p.is_active ORDER BY p.policy_code""",
            (identity_id,)).fetchall()


@app.post("/citizen/consents", tags=["citoyen"])
def citizen_set_consent(body: ConsentIn, identity_id=Depends(citizen_auth)):
    with db.tx() as c:
        pol = c.execute("SELECT * FROM data_access_policy WHERE policy_code=%s AND requires_consent",
                        (body.policy_code,)).fetchone()
        if not pol:
            raise HTTPException(404, "Politique inconnue ou sans consentement")
        status = "GRANTED" if body.grant else "WITHDRAWN"
        c.execute(
            """INSERT INTO citizen_consent (identity_id, purpose_code, requesting_admin_id,
                   consent_status, withdrawn_at, proof_reference)
               VALUES (%s,%s,%s,%s,%s,'portail-citoyen')""",
            (identity_id, pol["purpose_code"], pol["requesting_admin_id"], status,
             None if body.grant else db.utcnow()))
        audit.log(c, "CONSENT_CHANGED", identity_id=identity_id,
                  actor_admin_id=pol["requesting_admin_id"], registry_id=pol["registry_id"],
                  purpose_code=pol["purpose_code"], decision="N/A", attributes=[status])
    return {"policy_code": body.policy_code, "status": status}


# ---------------------------------------------------------------- espace supervision

def _integrity() -> dict:
    with db.tx() as c:
        broken = c.execute("SELECT broken_at_seq FROM verify_audit_chain()").fetchone()
        count = c.execute("SELECT count(*) AS n, max(encode(event_hash,'hex')) FILTER "
                          "(WHERE seq = (SELECT max(seq) FROM audit_event)) AS head "
                          "FROM audit_event").fetchone()
    return {"intact": broken is None, "broken_at_seq": broken and broken["broken_at_seq"],
            "events": count["n"], "head_hash": count["head"]}


@app.get("/supervision/registries", tags=["supervision"], dependencies=[Depends(supervisor_auth)])
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
        row["circuit_opened_at"] = (datetime.fromtimestamp(cb["opened_at"], timezone.utc)
                                    if cb["opened_at"] else None)
    return rows


@app.get("/supervision/stack", tags=["supervision"], dependencies=[Depends(supervisor_auth)])
def supervision_stack():
    return {"components": _stack_status(), "retry_queue_size": resilience.queue_size()}


@app.post("/supervision/registries/{code}/simulate", tags=["supervision"],
          dependencies=[Depends(supervisor_auth)])
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


@app.get("/supervision/requests", tags=["supervision"], dependencies=[Depends(supervisor_auth)])
def supervision_requests():
    with db.tx() as c:
        return c.execute(
            """SELECT q.id, q.created_at, a.name AS administration, r.code AS registry,
                      q.purpose_code, coalesce(pu.label, q.purpose_code) AS purpose_label,
                      q.status, q.decision, q.service_mode, q.retry_count
               FROM access_request q
               JOIN administration a ON a.id = q.requester_admin_id
               JOIN administrative_registry r ON r.id = q.registry_id
               LEFT JOIN purpose pu ON pu.code = q.purpose_code
               ORDER BY q.created_at DESC LIMIT 25""").fetchall()


@app.get("/supervision/impact", tags=["supervision"], dependencies=[Depends(supervisor_auth)])
def supervision_impact():
    """Pièces justificatives que les citoyens n'ont pas eu à fournir, grâce aux échanges directs."""
    with db.tx() as c:
        by_document = c.execute(
            """SELECT d->>'document' AS document, count(*) AS avoided
               FROM access_request q
               JOIN administrative_registry r ON r.id = q.registry_id
               JOIN purpose pu ON pu.code = q.purpose_code
               CROSS JOIN LATERAL jsonb_array_elements(pu.replaces) d
               WHERE q.status = 'COMPLETED' AND d->>'registry' = r.code
               GROUP BY 1 ORDER BY 2 DESC""").fetchall()
        by_purpose = c.execute(
            """SELECT coalesce(pu.label, q.purpose_code) AS purpose, count(*) AS requests,
                      count(*) FILTER (WHERE q.status = 'COMPLETED') AS completed
               FROM access_request q LEFT JOIN purpose pu ON pu.code = q.purpose_code
               GROUP BY 1 ORDER BY 2 DESC""").fetchall()
    return {"documents_avoided": sum(d["avoided"] for d in by_document),
            "by_document": by_document, "by_purpose": by_purpose}


@app.get("/supervision/alerts", tags=["supervision"], dependencies=[Depends(supervisor_auth)])
def supervision_alerts():
    with db.tx() as c:
        return c.execute(
            """SELECT ca.id, ca.created_at, ca.channel, ca.language, ca.description, ca.status,
                      ca.resolution_note, a.name AS contested_administration,
                      e.purpose_code AS contested_purpose, e.event_timestamp AS contested_at
               FROM citizen_alert ca
               LEFT JOIN audit_event e ON e.id = ca.audit_event_id
               LEFT JOIN administration a ON a.id = e.actor_admin_id
               ORDER BY (ca.status IN ('OPEN','IN_REVIEW')) DESC, ca.created_at DESC
               LIMIT 50""").fetchall()


@app.post("/supervision/alerts/{alert_id}", tags=["supervision"],
          dependencies=[Depends(supervisor_auth)])
def supervision_update_alert(alert_id: uuid.UUID, body: AlertUpdateIn):
    if body.status not in ("OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"):
        raise HTTPException(400, "Statut invalide")
    closed = body.status in ("RESOLVED", "REJECTED")
    with db.tx() as c:
        row = c.execute(
            """UPDATE citizen_alert SET status=%s, resolution_note=coalesce(%s, resolution_note),
                   resolved_at=%s WHERE id=%s RETURNING id, status""",
            (body.status, body.note, db.utcnow() if closed else None, alert_id)).fetchone()
    if not row:
        raise HTTPException(404, "Alerte introuvable")
    return row


@app.get("/supervision/integrity", tags=["supervision"], dependencies=[Depends(supervisor_auth)])
def supervision_integrity():
    return _integrity()


# ---------------------------------------------------------------- démonstration

@app.get("/demo/config", tags=["démonstration"])
def demo_config():
    """DÉMONSTRATION UNIQUEMENT : comptes Keycloak de démo et citoyens fictifs."""
    if not config.DEMO_MODE:
        raise HTTPException(404)
    with db.tx() as c:
        admins = c.execute("SELECT code, name FROM administration WHERE code = ANY(%s) ORDER BY code",
                           (list(config.DEMO_AGENTS),)).fetchall()
    data = json.loads((config.ROOT / "registries-mock" / "data" / "citoyens_fictifs.json")
                      .read_text(encoding="utf-8"))
    citizens = [{
        "label": f"{c['prenoms']} {c['nom']}", "note": c.get("note", ""), "iue": c.get("iue"),
        "local_reference": c["etat_civil"]["ref"] if not c.get("iue") else None,
        "username": (c.get("iue") or c["etat_civil"]["ref"]).lower(),
    } for c in data]
    return {
        "keycloak": {"url": config.KEYCLOAK_PUBLIC_URL, "realm": config.KEYCLOAK_REALM,
                     "client_id": config.KEYCLOAK_CLI_CLIENT},
        "demo_password": "demo",
        "agents": [{"code": a["code"], "name": a["name"], "username": config.DEMO_AGENTS[a["code"]]}
                   for a in admins],
        "supervisor": "superviseur",
        "citizens": citizens,
    }
