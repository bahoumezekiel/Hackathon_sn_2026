"""Espace citoyen : historique des consultations, signalements et consentements (rôle citizen)."""
from fastapi import APIRouter, Depends, HTTPException

from .. import audit, crypto, db
from ..auth import citizen_auth
from ..predicates import display
from ..schemas import AlertIn, ConsentIn

router = APIRouter(prefix="/citizen", tags=["citoyen"])

# Une ligne par consultation, avec tout ce que l'usager a le droit de savoir :
# qui, quand, pourquoi, ce qui a été transmis, ce qui a été lu, et la preuve dans le journal.
_HISTORY = """
SELECT q.id, q.created_at, q.completed_at, q.purpose_code, q.status, q.decision,
       purpose_label(q.requester_admin_id, q.purpose_code) AS purpose_label,
       (SELECT s.status FROM sms_consent_request s WHERE s.request_id = q.id) AS consent_sms,
       q.decision_reason, q.service_mode, q.justification,
       a.name AS administration, r.name AS registry, r.code AS registry_code,
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
WHERE q.identity_id = %s
ORDER BY q.created_at DESC LIMIT 200"""


@router.get("/history")
def citizen_history(identity_id=Depends(citizen_auth)):
    """Qui a consulté mes données, quand, pourquoi, et qu'est-ce qui a été transmis ?"""
    with db.tx() as c:
        identity = c.execute("SELECT identity_status, iue_ciphertext FROM national_identity_reference "
                             "WHERE id=%s", (identity_id,)).fetchone()
        rows = c.execute(_HISTORY, (identity_id,)).fetchall()
    for row in rows:
        row["shared"] = [dict(s, display=display(s["predicate"], s["value"])) for s in row["shared"]]
    iue_hint = None
    if identity["iue_ciphertext"]:
        iue_hint = "••••" + crypto.decrypt(identity["iue_ciphertext"])[-4:]
    return {"identity_status": identity["identity_status"], "iue_hint": iue_hint, "accesses": rows}


@router.get("/integrity")
def citizen_integrity(_identity=Depends(citizen_auth)):
    return audit.integrity()


@router.post("/alerts")
def citizen_alert(body: AlertIn, identity_id=Depends(citizen_auth)):
    """Signaler un accès suspect (portail web ou assistant vocal)."""
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


@router.get("/consents")
def citizen_consents(identity_id=Depends(citizen_auth)):
    """Cas d'usage soumis au consentement, et le dernier choix de l'usager pour chacun."""
    with db.tx() as c:
        return c.execute(
            """SELECT p.policy_code, p.purpose_code, a.name AS administration, r.name AS registry,
                      purpose_label(p.requesting_admin_id, p.purpose_code) AS purpose_label,
                      (SELECT cc.consent_status FROM citizen_consent cc
                        WHERE cc.identity_id=%s AND cc.requesting_admin_id=p.requesting_admin_id
                          AND cc.purpose_code=p.purpose_code
                        ORDER BY cc.collected_at DESC LIMIT 1) AS status
               FROM data_access_policy p
               JOIN administration a ON a.id = p.requesting_admin_id
               JOIN administrative_registry r ON r.id = p.registry_id
               WHERE p.requires_consent AND p.is_active ORDER BY p.policy_code""",
            (identity_id,)).fetchall()


@router.post("/consents")
def citizen_set_consent(body: ConsentIn, identity_id=Depends(citizen_auth)):
    """Donner ou retirer son consentement ; chaque changement est inscrit au journal."""
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
