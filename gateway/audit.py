"""Journal d'audit chaîné : écriture et contrôle d'intégrité.

Le chaînage (hash de l'événement précédent + contenu) est calculé par PostgreSQL
(trigger trg_audit_chain) : la passerelle ne peut ni l'omettre ni le falsifier.
"""
from psycopg.types.json import Jsonb

from . import db


def log(conn, event_type: str, *, request_id=None, identity_id=None, actor_admin_id=None,
        actor_user_id=None, registry_id=None, purpose_code=None, decision=None,
        attributes=(), service_mode="NORMAL") -> dict:
    """Ajoute un événement au journal, dans la transaction de l'appelant."""
    return conn.execute(
        """INSERT INTO audit_event (request_id, identity_id, actor_admin_id, actor_user_id,
                                    registry_id, event_type, purpose_code, access_decision,
                                    attributes_accessed, service_mode)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           RETURNING id, seq, encode(event_hash, 'hex') AS hash""",
        (request_id, identity_id, actor_admin_id, actor_user_id, registry_id, event_type,
         purpose_code, decision, Jsonb(list(attributes)), service_mode),
    ).fetchone()


def integrity() -> dict:
    """Recalcule toute la chaîne : intacte, ou numéro du premier maillon altéré."""
    with db.tx() as c:
        broken = c.execute("SELECT broken_at_seq FROM verify_audit_chain()").fetchone()
        count = c.execute("SELECT count(*) AS n, max(encode(event_hash,'hex')) FILTER "
                          "(WHERE seq = (SELECT max(seq) FROM audit_event)) AS head "
                          "FROM audit_event").fetchone()
    return {"intact": broken is None, "broken_at_seq": broken and broken["broken_at_seq"],
            "events": count["n"], "head_hash": count["head"]}
