"""Référentiel : structures de l'État, leurs agents et leurs cas d'usage.

Un cas d'usage = une démarche (finalité) + une politique par registre consultable.
Modifier un cas d'usage clôt ses politiques en cours et en crée de nouvelles :
un accès passé reste toujours rattaché à la règle qui l'a autorisé.
Chaque opération est inscrite dans le journal d'audit chaîné.
"""
import re
import secrets

from psycopg.types.json import Jsonb

from . import audit, keycloak_admin
from .predicates import CASIER_CATEGORIES, PREDICATES

CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,29}$")
CAS_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,49}$")
MAX_CACHE_TTL_S = 86_400
REGISTRY_FOR_CASIER = "CASIER"


class Invalid(Exception):
    pass


class Missing(Exception):
    pass


# ---------------------------------------------------------------- catalogue

def catalogue(c) -> dict:
    registries = c.execute("""SELECT r.code, r.name, a.name AS owner
                              FROM administrative_registry r
                              JOIN administration a ON a.id = r.owner_admin_id
                              ORDER BY r.code""").fetchall()
    for r in registries:
        r["predicates"] = [{"code": k, "label": v["label"]}
                           for k, v in PREDICATES.items() if v["registry"] == r["code"]]
    # Registres sans information transmissible (ex. registre des IUE) : hors des cas d'usage
    registries = [r for r in registries if r["predicates"]]
    return {"registries": registries,
            "casier_categories": [{"code": k, "label": v} for k, v in CASIER_CATEGORIES.items()],
            "max_cache_ttl_s": MAX_CACHE_TTL_S}


# ---------------------------------------------------------------- structures

def list_administrations(c) -> list[dict]:
    return c.execute(
        """SELECT a.code, a.name, a.ministry, a.status, a.created_at,
                  (SELECT count(*) FROM cas_usage cu WHERE cu.admin_id = a.id AND cu.is_active)
                      AS cas_usage_count,
                  (SELECT coalesce(jsonb_agg(r.name ORDER BY r.code), '[]'::jsonb)
                     FROM administrative_registry r WHERE r.owner_admin_id = a.id) AS registries_held,
                  (SELECT coalesce(jsonb_agg(DISTINCT r.code), '[]'::jsonb)
                     FROM data_access_policy p JOIN administrative_registry r ON r.id = p.registry_id
                    WHERE p.requesting_admin_id = a.id AND p.is_active) AS registries_consulted
           FROM administration a ORDER BY a.created_at, a.code""").fetchall()


def get_administration(c, code: str) -> dict:
    row = c.execute("SELECT * FROM administration WHERE code=%s", (code.upper(),)).fetchone()
    if not row:
        raise Missing("Structure introuvable")
    return row


def create_administration(c, *, code: str, name: str, ministry: str | None, actor: dict) -> dict:
    code = code.strip().upper()
    if not CODE_RE.match(code):
        raise Invalid("Code invalide : lettres majuscules, chiffres et _ (2 à 30 caractères), ex. CEFORE")
    if c.execute("SELECT 1 FROM administration WHERE code=%s", (code,)).fetchone():
        raise Invalid(f"La structure {code} existe déjà")
    admin = c.execute(
        """INSERT INTO administration (code, name, ministry) VALUES (%s,%s,%s) RETURNING *""",
        (code, name.strip(), (ministry or "").strip() or None)).fetchone()
    # Le groupe Keycloak rattache les agents à la structure ; en cas d'échec, la transaction est annulée
    keycloak_admin.ensure_group(code, admin["name"])
    audit.log(c, "ADMINISTRATION_CREATED", actor_admin_id=admin["id"], actor_user_id=actor["user_id"],
              decision="N/A", attributes=[code])
    return admin


def set_administration_status(c, code: str, status: str, actor: dict) -> dict:
    admin = get_administration(c, code)
    row = c.execute("UPDATE administration SET status=%s WHERE id=%s RETURNING code, status",
                    (status, admin["id"])).fetchone()
    audit.log(c, "ADMINISTRATION_STATUS_CHANGED", actor_admin_id=admin["id"],
              actor_user_id=actor["user_id"], decision="N/A", attributes=[status])
    return row


def log_agent_event(c, code: str, event: str, username: str, actor: dict) -> None:
    admin = get_administration(c, code)
    audit.log(c, event, actor_admin_id=admin["id"], actor_user_id=actor["user_id"],
              decision="N/A", attributes=[username])


# ---------------------------------------------------------------- cas d'usage

def list_cas_usage(c, admin_id, *, active_only: bool = False) -> list[dict]:
    cas = c.execute(
        f"""SELECT id, code, label, description, legal_basis, requires_justification, is_active,
                   created_at, updated_at
            FROM cas_usage WHERE admin_id=%s {'AND is_active' if active_only else ''}
            ORDER BY is_active DESC, created_at""", (admin_id,)).fetchall()
    for cu in cas:
        cu["registres"] = c.execute(
            """SELECT p.policy_code, r.code AS registry_code, r.name AS registry_name,
                      p.allowed_predicates, p.requires_consent, p.degraded_cache_ttl_s, p.parametres,
                      p.valid_from
               FROM data_access_policy p JOIN administrative_registry r ON r.id = p.registry_id
               WHERE p.cas_usage_id=%s AND p.is_active ORDER BY r.code""", (cu["id"],)).fetchall()
    return cas


def _validate_registres(c, registres: list[dict]) -> list[dict]:
    if not registres:
        raise Invalid("Choisissez au moins un registre consultable")
    known = {r["code"]: r["id"] for r in c.execute("SELECT code, id FROM administrative_registry")}
    seen, clean = set(), []
    for item in registres:
        code = item["registry_code"].upper()
        if code not in known:
            raise Invalid(f"Registre inconnu : {code}")
        if code in seen:
            raise Invalid(f"Registre en double : {code}")
        seen.add(code)
        preds = list(dict.fromkeys(item["predicates"]))
        if not preds:
            raise Invalid(f"Choisissez au moins une information pour le registre {code}")
        wrong = [p for p in preds if PREDICATES.get(p, {}).get("registry") != code]
        if wrong:
            raise Invalid(f"Information non fournie par le registre {code} : {', '.join(wrong)}")
        ttl = int(item.get("degraded_cache_ttl_s") or 0)
        if not 0 <= ttl <= MAX_CACHE_TTL_S:
            raise Invalid("Durée de réutilisation en cas de panne : entre 0 et 24 h")
        params = {}
        if code == REGISTRY_FOR_CASIER:
            if ttl:
                raise Invalid("Le casier judiciaire ne peut pas être servi depuis le cache en cas de panne")
            raw = item.get("parametres") or {}
            cats = [str(x).upper() for x in raw.get("categories_incompatibles", [])]
            if not cats:
                raise Invalid("Casier : choisissez les catégories de condamnation incompatibles avec ce cas d'usage")
            unknown = [x for x in cats if x not in CASIER_CATEGORIES]
            if unknown:
                raise Invalid(f"Catégorie de condamnation inconnue : {', '.join(unknown)}")
            params = {"categories_incompatibles": sorted(set(cats)),
                      "ignorer_sursis": bool(raw.get("ignorer_sursis", False))}
        clean.append({"registry_id": known[code], "registry_code": code, "predicates": preds,
                      "requires_consent": bool(item.get("requires_consent", False)),
                      "degraded_cache_ttl_s": ttl, "parametres": params})
    return clean


def _write_policies(c, admin: dict, cas: dict, registres: list[dict]) -> None:
    # Clôture des politiques en cours, puis nouvelle version
    c.execute("""UPDATE data_access_policy SET is_active=false, valid_until=now()
                 WHERE cas_usage_id=%s AND is_active""", (cas["id"],))
    for r in registres:
        c.execute(
            """INSERT INTO data_access_policy
                 (policy_code, registry_id, requesting_admin_id, purpose_code, legal_basis,
                  allowed_predicates, requires_consent, requires_justification,
                  degraded_cache_ttl_s, cas_usage_id, parametres)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (f"POL_{admin['code']}_{secrets.token_hex(4).upper()}", r["registry_id"], admin["id"],
             cas["code"], cas["legal_basis"], Jsonb(r["predicates"]), r["requires_consent"],
             cas["requires_justification"], r["degraded_cache_ttl_s"], cas["id"],
             Jsonb(r["parametres"])))


def _audit_cas(c, event: str, admin: dict, cas: dict, registres: list[dict], actor: dict) -> None:
    audit.log(c, event, actor_admin_id=admin["id"], actor_user_id=actor["user_id"],
              purpose_code=cas["code"], decision="N/A",
              attributes=[f"{r['registry_code']}:{p}" for r in registres for p in r["predicates"]])


def create_cas_usage(c, admin_code: str, body: dict, actor: dict) -> dict:
    admin = get_administration(c, admin_code)
    code = body["code"].strip().upper()
    if not CAS_CODE_RE.match(code):
        raise Invalid("Code du cas d'usage invalide : lettres majuscules, chiffres et _ (3 à 50 caractères)")
    if c.execute("SELECT 1 FROM cas_usage WHERE admin_id=%s AND code=%s", (admin["id"], code)).fetchone():
        raise Invalid(f"Le cas d'usage {code} existe déjà pour cette structure")
    registres = _validate_registres(c, body["registres"])
    cas = c.execute(
        """INSERT INTO cas_usage (admin_id, code, label, description, legal_basis,
                                  requires_justification, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (admin["id"], code, body["label"].strip(), (body.get("description") or "").strip() or None,
         body["legal_basis"].strip(), body.get("requires_justification", True),
         actor["username"])).fetchone()
    _write_policies(c, admin, cas, registres)
    _audit_cas(c, "CAS_USAGE_CREATED", admin, cas, registres, actor)
    return cas


def _get_cas(c, cas_id) -> tuple[dict, dict]:
    cas = c.execute("SELECT * FROM cas_usage WHERE id=%s", (cas_id,)).fetchone()
    if not cas:
        raise Missing("Cas d'usage introuvable")
    admin = c.execute("SELECT * FROM administration WHERE id=%s", (cas["admin_id"],)).fetchone()
    return cas, admin


def update_cas_usage(c, cas_id, body: dict, actor: dict) -> dict:
    cas, admin = _get_cas(c, cas_id)
    registres = _validate_registres(c, body["registres"])
    cas = c.execute(
        """UPDATE cas_usage SET label=%s, description=%s, legal_basis=%s,
               requires_justification=%s, is_active=true
           WHERE id=%s RETURNING *""",
        (body["label"].strip(), (body.get("description") or "").strip() or None,
         body["legal_basis"].strip(), body.get("requires_justification", True), cas_id)).fetchone()
    _write_policies(c, admin, cas, registres)
    _audit_cas(c, "CAS_USAGE_UPDATED", admin, cas, registres, actor)
    return cas


def deactivate_cas_usage(c, cas_id, actor: dict) -> dict:
    cas, admin = _get_cas(c, cas_id)
    c.execute("""UPDATE data_access_policy SET is_active=false, valid_until=now()
                 WHERE cas_usage_id=%s AND is_active""", (cas_id,))
    cas = c.execute("UPDATE cas_usage SET is_active=false WHERE id=%s RETURNING *", (cas_id,)).fetchone()
    _audit_cas(c, "CAS_USAGE_DEACTIVATED", admin, cas, [], actor)
    return cas
