"""Pipeline d'une demande de vérification.

  1. Identification du citoyen (IUE ou référence locale — procédure alternative)
  2. Décision de politique (finalité, justification, prédicats, consentement)
  3. Interrogation du registre derrière le disjoncteur
  4. Minimisation : calcul du prédicat, la donnée brute est jetée
  5. Attestation signée + journal d'audit chaîné
  En cas de panne : attestation récente réutilisée (si la politique l'autorise)
  ou mise en file d'attente avec relance automatique.
"""
import logging
import threading
import uuid
from collections import OrderedDict
from datetime import datetime, timedelta

from psycopg.types.json import Jsonb

from . import audit, config, consentement_sms, crypto, db, policy, registry_client, resilience
from .predicates import PREDICATES, PredicateError, compute, display

log = logging.getLogger("fasolink.service")


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


# ---------------------------------------------------------------- identité

def resolve_identity(conn, citizen: dict) -> dict:
    iue = "".join((citizen.get("iue") or "").split())   # IUE à 12 chiffres, espaces tolérés
    registry = (citizen.get("registry") or "").strip().upper()
    local_ref = (citizen.get("local_reference") or "").strip()
    if iue:
        row = conn.execute("SELECT * FROM national_identity_reference WHERE iue_fingerprint=%s",
                           (crypto.fingerprint(iue, "IUE"),)).fetchone()
    elif registry and local_ref:
        # Procédure alternative : citoyen sans IUE, retrouvé via la référence d'un registre
        row = conn.execute(
            """SELECT n.* FROM registry_identity_mapping m
               JOIN administrative_registry r ON r.id = m.registry_id
               JOIN national_identity_reference n ON n.id = m.identity_id
               WHERE r.code=%s AND m.local_reference_fingerprint=%s AND m.mapping_status='ACTIVE'""",
            (registry, crypto.fingerprint(local_ref, registry))).fetchone()
    else:
        raise BadRequest("Identifiant du citoyen manquant : IUE, ou registre + référence locale")
    if not row:
        raise NotFound("Citoyen introuvable dans FasoLink")
    return row


# ---------------------------------------------------------------- demande

def submit_verification(*, admin: dict, agent_id, citizen: dict, purpose_code: str,
                        predicates: list[str], justification: str | None) -> dict:
    predicates = list(OrderedDict.fromkeys(predicates))
    unknown = [p for p in predicates if p not in PREDICATES]
    if unknown:
        raise BadRequest(f"Prédicat(s) inconnu(s) : {', '.join(unknown)}")

    with db.tx() as c:
        identity = resolve_identity(c, citizen)

    by_registry: dict[str, list[str]] = OrderedDict()
    for p in predicates:
        by_registry.setdefault(PREDICATES[p]["registry"], []).append(p)

    results = [_submit_one(admin, agent_id, identity, code, preds, purpose_code, justification)
               for code, preds in by_registry.items()]
    return {"identity_status": identity["identity_status"], "results": results}


def _submit_one(admin, agent_id, identity, registry_code, preds, purpose_code, justification):
    with db.tx() as c:
        reg = c.execute("SELECT * FROM administrative_registry WHERE code=%s",
                        (registry_code,)).fetchone()
        decision = policy.evaluate(c, admin_id=admin["id"], registry_id=reg["id"],
                                   identity_id=identity["id"], purpose_code=purpose_code,
                                   predicates=preds, justification=justification)

    # Seul le consentement manque : on le demande par SMS au numéro associé à l'IUE
    phone = consentement_sms.lookup_phone(identity) if decision.consent_can_unlock else None
    reason = decision.reason
    if decision.consent_can_unlock and not phone:
        reason += " ; l'usager n'a pas pu être joint par SMS (pas d'IUE actif ou de téléphone)"

    sms_text = None
    with db.tx() as c:
        if phone:
            status, effect, reason, completed = ("AWAITING_CONSENT", None,
                                                 "Accord de l'usager demandé par SMS", None)
        else:
            status = "PROCESSING" if decision.allowed else "DENIED"
            effect, completed = decision.effect, None if decision.allowed else db.utcnow()
        req = c.execute(
            """INSERT INTO access_request
                 (requester_admin_id, requester_user_id, identity_id, registry_id, policy_id,
                  purpose_code, legal_basis, justification, requested_predicates,
                  status, decision, decision_reason, completed_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (admin["id"], agent_id, identity["id"], reg["id"], decision.policy_id, purpose_code,
             decision.legal_basis or "Aucune base légale applicable", justification, Jsonb(preds),
             status, effect, reason, completed)).fetchone()
        common = dict(request_id=req["id"], identity_id=identity["id"], actor_admin_id=admin["id"],
                      actor_user_id=agent_id, registry_id=reg["id"], purpose_code=purpose_code)
        audit.log(c, "ACCESS_REQUESTED", decision="N/A", attributes=preds, **common)
        if phone:
            sms_text = consentement_sms.open_request(c, req, phone)
        else:
            audit.log(c, "POLICY_DECISION", decision=decision.effect, attributes=decision.granted,
                      **common)

    if sms_text:
        # En arrière-plan, avec nouvelles tentatives en cas de coupure réseau : l'agent reçoit
        # tout de suite « accord attendu », sa fiche se met à jour si l'envoi échoue finalement
        threading.Thread(target=consentement_sms.deliver, args=(req["id"], phone, sms_text),
                         daemon=True, name="consentement-sms").start()
    elif decision.allowed:
        execute(req["id"])
    return request_view(req["id"])


def execute(request_id, *, is_retry: bool = False) -> None:
    """Étapes 3 à 5. Appelé à la première tentative puis par la file de relance."""
    with db.tx() as c:
        req = c.execute("SELECT * FROM access_request WHERE id=%s", (request_id,)).fetchone()
        reg = c.execute("SELECT * FROM administrative_registry WHERE id=%s",
                        (req["registry_id"],)).fetchone()
        decision = policy.evaluate(c, admin_id=req["requester_admin_id"], registry_id=reg["id"],
                                   identity_id=req["identity_id"], purpose_code=req["purpose_code"],
                                   predicates=req["requested_predicates"],
                                   justification=req["justification"], request_id=request_id)
        if is_retry:
            audit.log(c, "REQUEST_RETRIED", decision="N/A", service_mode=req["service_mode"],
                      **_common(req))
        if not decision.allowed:  # ex. consentement retiré pendant l'attente, politique close
            c.execute("""UPDATE access_request SET status='DENIED', decision='DENY',
                         decision_reason=%s, completed_at=now(), next_retry_at=NULL
                         WHERE id=%s""", (decision.reason, request_id))
            audit.log(c, "POLICY_DECISION", decision="DENY", service_mode=req["service_mode"],
                      **_common(req))
            return
        if not is_retry and req["status"] == "PROCESSING" and \
                c.execute("SELECT 1 FROM sms_consent_request WHERE request_id=%s AND status='GRANTED'",
                          (request_id,)).fetchone():
            # Accord reçu par SMS : la décision d'accès est désormais favorable
            audit.log(c, "POLICY_DECISION", decision=decision.effect, attributes=decision.granted,
                      **_common(req))
        mapping = c.execute(
            """SELECT local_reference_ciphertext FROM registry_identity_mapping
               WHERE identity_id=%s AND registry_id=%s AND mapping_status='ACTIVE'""",
            (req["identity_id"], reg["id"])).fetchone()

    if not mapping:
        return _fail(req, "NO_MAPPING", "Ce citoyen n'est pas connu de ce registre")

    local_ref = crypto.decrypt(mapping["local_reference_ciphertext"])
    try:
        record = registry_client.fetch_record(reg, local_ref)
    except registry_client.RecordNotFound:
        return _fail(req, "RECORD_NOT_FOUND", "Enregistrement absent du registre source")
    except registry_client.RegistryUnavailable as exc:
        return _handle_unavailable(req, reg, decision, str(exc), is_retry)

    try:
        values = {p: compute(p, record, req["purpose_code"], params=decision.parametres)
                  for p in decision.granted}
    except PredicateError as exc:
        return _fail(req, "PREDICATE_ERROR", str(exc))
    finally:
        del record  # minimisation : la donnée brute n'est ni conservée ni transmise

    source_fields = sorted({f for p in decision.granted for f in PREDICATES[p]["source_fields"]})
    now = db.utcnow()
    with db.tx() as c:
        c.execute("""INSERT INTO identity_verification (identity_id, request_id, verification_type,
                         verification_status, source_system, verified_at)
                     VALUES (%s,%s,%s,'SUCCESS',%s,now())""",
                  (req["identity_id"], req["id"], ",".join(decision.granted), reg["code"]))
        for p, v in values.items():
            _issue_attestation(c, req, p, v, observed_at=now, from_cache=False)
        c.execute("""UPDATE access_request SET status='COMPLETED', decision=%s, decision_reason=%s,
                         completed_at=now(), next_retry_at=NULL WHERE id=%s""",
                  (decision.effect, decision.reason, req["id"]))
        mode = req["service_mode"]
        audit.log(c, "REGISTRY_QUERIED", decision=decision.effect, attributes=source_fields,
                  service_mode=mode, **_common(req))
        audit.log(c, "ATTESTATION_ISSUED", decision=decision.effect, attributes=decision.granted,
                  service_mode=mode, **_common(req))
    # Cache Redis du mode dégradé (prédicats seulement, durée fixée par la politique)
    for p, v in values.items():
        resilience.cache_put(req["identity_id"], reg["code"], p, req["requester_admin_id"],
                             req["purpose_code"], v, now, decision.degraded_cache_ttl_s)


def _common(req) -> dict:
    return dict(request_id=req["id"], identity_id=req["identity_id"],
                actor_admin_id=req["requester_admin_id"], actor_user_id=req["requester_user_id"],
                registry_id=req["registry_id"], purpose_code=req["purpose_code"])


def _issue_attestation(c, req, predicate, value, *, observed_at, from_cache):
    audience = c.execute("SELECT code FROM administration WHERE id=%s",
                         (req["requester_admin_id"],)).fetchone()["code"]
    att_id = uuid.uuid4()
    issued = db.utcnow()
    expires = issued + timedelta(seconds=config.ATTESTATION_TTL_S)
    token = crypto.sign({
        "iss": "fasolink", "aud": audience, "jti": str(att_id),
        "iat": int(issued.timestamp()), "exp": int(expires.timestamp()),
        "request_id": str(req["id"]), "purpose": req["purpose_code"],
        "predicate": predicate, "value": value,
        "observed_at": observed_at.isoformat(), "degraded": from_cache,
    })
    c.execute(
        """INSERT INTO attestation (id, request_id, identity_id, registry_id, audience_admin_id,
               purpose_code, predicate, predicate_value, observed_at, issued_at, expires_at,
               signature_jws, signing_key_id, served_from_cache)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (att_id, req["id"], req["identity_id"], req["registry_id"], req["requester_admin_id"],
         req["purpose_code"], predicate, Jsonb(value), observed_at, issued, expires, token,
         crypto.signing_key_id(), from_cache))


def _fail(req, code: str, message: str) -> None:
    with db.tx() as c:
        c.execute("""INSERT INTO identity_verification (identity_id, request_id, verification_type,
                         verification_status, source_system, error_code)
                     SELECT %s, %s, 'LOOKUP', 'FAILED', code, %s
                     FROM administrative_registry WHERE id=%s""",
                  (req["identity_id"], req["id"], code, req["registry_id"]))
        c.execute("""UPDATE access_request SET status='FAILED', decision_reason=%s,
                         completed_at=now(), next_retry_at=NULL WHERE id=%s""",
                  (message, req["id"]))
        audit.log(c, "REQUEST_FAILED", decision="N/A", service_mode=req["service_mode"],
                  **_common(req))


def _handle_unavailable(req, reg, decision, error: str, is_retry: bool) -> None:
    with db.tx() as c:
        c.execute("""INSERT INTO identity_verification (identity_id, request_id, verification_type,
                         verification_status, source_system, error_code)
                     VALUES (%s,%s,'LOOKUP','UNAVAILABLE',%s,'REGISTRY_UNAVAILABLE')""",
                  (req["identity_id"], req["id"], reg["code"]))
        audit.log(c, "REGISTRY_UNAVAILABLE", decision="N/A", service_mode=req["service_mode"],
                  **_common(req))

        # Niveau 2 : réutiliser une réponse récente du cache Redis, si la politique l'autorise
        if decision.degraded_cache_ttl_s > 0 and not is_retry:
            cached = {}
            for p in decision.granted:
                hit = resilience.cache_get(req["identity_id"], reg["code"], p,
                                           req["requester_admin_id"], req["purpose_code"])
                if hit:
                    cached[p] = hit
            if len(cached) == len(decision.granted):
                for p, hit in cached.items():
                    _issue_attestation(c, req, p, hit["value"],
                                       observed_at=datetime.fromisoformat(hit["observed_at"]),
                                       from_cache=True)
                c.execute("""UPDATE access_request SET status='COMPLETED', decision=%s,
                                 decision_reason=%s, service_mode='DEGRADED_CACHE', completed_at=now()
                             WHERE id=%s""",
                          (decision.effect, decision.reason + " ; servi en mode dégradé", req["id"]))
                audit.log(c, "CACHE_SERVED", decision=decision.effect, attributes=decision.granted,
                          service_mode="DEGRADED_CACHE", **_common(req))
                return

        # Niveau 3 : file d'attente avec relance exponentielle
        retries = req["retry_count"] + (1 if is_retry else 0)
        if retries >= config.MAX_RETRIES:
            c.execute("""UPDATE access_request SET status='FAILED', completed_at=now(),
                             decision_reason=%s, next_retry_at=NULL WHERE id=%s""",
                      ("Registre indisponible après plusieurs tentatives", req["id"]))
            audit.log(c, "REQUEST_FAILED", decision="N/A", service_mode="QUEUED_RETRY",
                      **_common(req))
            return
        delay = min(5 * 2 ** retries, 300)
        row = c.execute("""UPDATE access_request SET status='QUEUED', service_mode='QUEUED_RETRY',
                               retry_count=%s, next_retry_at=now() + make_interval(secs => %s)
                           WHERE id=%s RETURNING next_retry_at""",
                        (retries, delay, req["id"])).fetchone()
        if not is_retry:
            audit.log(c, "REQUEST_QUEUED", decision="N/A", service_mode="QUEUED_RETRY",
                      **_common(req))
    resilience.queue_add(req["id"], row["next_retry_at"].timestamp())
    log.info("Demande %s en attente (%s)", req["id"], error)


# ---------------------------------------------------------------- file de relance (Redis)

def resync_queue() -> None:
    """PostgreSQL fait foi : toute demande QUEUED absente de Redis y est remise."""
    with db.tx() as c:
        rows = c.execute("SELECT id, next_retry_at FROM access_request WHERE status='QUEUED'").fetchall()
    for row in rows:
        try:
            resilience.r.zadd(resilience.QUEUE, {str(row["id"]): row["next_retry_at"].timestamp()},
                              nx=True)
        except Exception:
            return


def process_due_queue() -> int:
    processed = 0
    for rid in resilience.queue_due():
        with db.tx() as c:
            row = c.execute("""SELECT q.status, r.code FROM access_request q
                               JOIN administrative_registry r ON r.id = q.registry_id
                               WHERE q.id=%s""", (rid,)).fetchone()
        if not row or row["status"] != "QUEUED":
            resilience.queue_claim(rid)          # entrée obsolète
            continue
        if resilience.circuit(row["code"])["failures"] > 0:
            continue                             # registre pas encore rétabli : on attend
        if not resilience.queue_claim(rid):
            continue                             # prise par une autre instance
        with db.tx() as c:
            claimed = c.execute("""UPDATE access_request SET status='PROCESSING'
                                   WHERE id=%s AND status='QUEUED' RETURNING id""", (rid,)).fetchone()
        if not claimed:
            continue
        try:
            execute(rid, is_retry=True)
            processed += 1
        except Exception:  # une demande en échec ne bloque pas les autres
            log.exception("Relance de %s en échec", rid)
            with db.tx() as c:
                c.execute("""UPDATE access_request SET status='QUEUED',
                                 next_retry_at=now() + interval '30 seconds' WHERE id=%s""", (rid,))
            resilience.queue_add(rid, db.utcnow().timestamp() + 30)
    return processed


# ---------------------------------------------------------------- vues

def request_view(request_id, *, admin_id=None) -> dict:
    with db.tx() as c:
        req = c.execute(
            """SELECT q.*, r.code AS registry_code, r.name AS registry_name,
                      purpose_label(q.requester_admin_id, q.purpose_code) AS purpose_label,
                      (SELECT jsonb_build_object('telephone', s.phone_masked, 'status', s.status,
                                                 'sent_at', s.sent_at, 'expires_at', s.expires_at,
                                                 'answered_at', s.answered_at)
                         FROM sms_consent_request s WHERE s.request_id = q.id) AS consent_sms
               FROM access_request q JOIN administrative_registry r ON r.id = q.registry_id
               WHERE q.id=%s""", (request_id,)).fetchone()
        if not req or (admin_id and req["requester_admin_id"] != admin_id):
            raise NotFound("Demande introuvable")
        atts = c.execute(
            """SELECT predicate, predicate_value, observed_at, issued_at, expires_at,
                      signature_jws, served_from_cache
               FROM attestation WHERE request_id=%s ORDER BY issued_at""", (request_id,)).fetchall()
    return {
        "request_id": str(req["id"]),
        "registry": {"code": req["registry_code"], "name": req["registry_name"]},
        "purpose_code": req["purpose_code"],
        "purpose_label": req["purpose_label"],
        "consent_sms": req["consent_sms"],   # accord demandé par SMS (numéro masqué)
        "status": req["status"],
        "decision": req["decision"],
        "decision_reason": req["decision_reason"],
        "service_mode": req["service_mode"],
        "next_retry_at": req["next_retry_at"],
        "attestations": [{
            "predicate": a["predicate"],
            "value": a["predicate_value"],
            "display": display(a["predicate"], a["predicate_value"]),
            "observed_at": a["observed_at"],
            "expires_at": a["expires_at"],
            "served_from_cache": a["served_from_cache"],
            "jws": a["signature_jws"],
        } for a in atts],
    }
