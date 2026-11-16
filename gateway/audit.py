"""Écriture dans le journal d'audit chaîné (le chaînage est calculé par la base)."""
from psycopg.types.json import Jsonb


def log(conn, event_type: str, *, request_id=None, identity_id=None, actor_admin_id=None,
        actor_user_id=None, registry_id=None, purpose_code=None, decision=None,
        attributes=(), service_mode="NORMAL") -> dict:
    return conn.execute(
        """INSERT INTO audit_event (request_id, identity_id, actor_admin_id, actor_user_id,
                                    registry_id, event_type, purpose_code, access_decision,
                                    attributes_accessed, service_mode)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           RETURNING id, seq, encode(event_hash, 'hex') AS hash""",
        (request_id, identity_id, actor_admin_id, actor_user_id, registry_id, event_type,
         purpose_code, decision, Jsonb(list(attributes)), service_mode),
    ).fetchone()
