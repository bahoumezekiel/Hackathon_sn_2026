"""Point de décision : rassemble les faits (PostgreSQL) et interroge OPA.

La logique d'autorisation est entièrement dans policies/fasolink.rego.
Si OPA ne répond pas, l'accès est refusé (fail closed).
"""
import logging
from dataclasses import dataclass, field

import httpx

from . import config

log = logging.getLogger("fasolink.policy")
_client = httpx.Client(base_url=config.OPA_URL, timeout=2)


@dataclass
class Decision:
    effect: str                       # PERMIT | PARTIAL | DENY
    reason: str
    granted: list = field(default_factory=list)              # prédicats accordés
    granted_attributes: list = field(default_factory=list)   # attributs accordés
    policy_id: object = None
    legal_basis: str | None = None
    degraded_cache_ttl_s: int = 0
    predicate_params: dict = field(default_factory=dict)     # fixés par la politique

    @property
    def allowed(self) -> bool:
        return self.effect in ("PERMIT", "PARTIAL")


def evaluate(conn, *, admin_id, registry_id, identity_id, purpose_code: str,
             predicates: list[str], justification: str | None,
             attributes: list[str] | None = None) -> Decision:
    admin = conn.execute("SELECT code, status FROM administration WHERE id=%s",
                         (admin_id,)).fetchone()
    pol = conn.execute(
        """SELECT * FROM data_access_policy
           WHERE requesting_admin_id=%s AND registry_id=%s AND purpose_code=%s
             AND is_active AND valid_from <= now()
             AND (valid_until IS NULL OR valid_until > now())
           ORDER BY valid_from DESC LIMIT 1""",
        (admin_id, registry_id, purpose_code)).fetchone()

    opa_input = {
        "administration": dict(admin) if admin else {},
        "purpose_code": purpose_code,
        "predicates": list(predicates),
        "attributes": list(attributes or []),
        "justification": justification or "",
    }
    base = {}
    if pol:
        opa_input["policy"] = {k: pol[k] for k in ("policy_code", "allowed_predicates",
                                                   "allowed_attributes", "requires_consent",
                                                   "requires_justification", "legal_basis")}
        base = dict(policy_id=pol["id"], legal_basis=pol["legal_basis"],
                    degraded_cache_ttl_s=pol["degraded_cache_ttl_s"],
                    predicate_params=pol["predicate_params"] or {})
        if pol["requires_consent"]:
            consent = conn.execute(
                """SELECT consent_status FROM citizen_consent
                   WHERE identity_id=%s AND requesting_admin_id=%s AND purpose_code=%s
                   ORDER BY collected_at DESC LIMIT 1""",
                (identity_id, admin_id, purpose_code)).fetchone()
            if consent:
                opa_input["consent"] = consent["consent_status"]

    try:
        resp = _client.post("/v1/data/fasolink/authz/decision", json={"input": opa_input})
        resp.raise_for_status()
        result = resp.json().get("result")
    except httpx.HTTPError as exc:
        log.error("OPA injoignable : %s", exc)
        return Decision("DENY", "Moteur de politiques indisponible : accès refusé par sécurité", **base)
    if not result:
        return Decision("DENY", "Aucune décision du moteur de politiques", **base)
    return Decision(result["effect"], result["reason"], list(result.get("granted", [])),
                    list(result.get("granted_attributes", [])), **base)


def health() -> bool:
    try:
        return _client.get("/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False
