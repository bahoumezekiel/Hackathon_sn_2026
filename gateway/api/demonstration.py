"""Routes de démonstration, actives seulement avec FASOLINK_DEMO_MODE=1 (404 sinon).

Elles exposent les comptes fictifs et le téléphone simulé : à désactiver hors démonstration.
"""
import json

from fastapi import APIRouter, Depends, HTTPException

from .. import config, consentement_sms, db, sms
from ..schemas import PhoneReplyIn

DEMO_PASSWORD = "demo"


def _demo_only():
    if not config.DEMO_MODE:
        raise HTTPException(404)


router = APIRouter(tags=["démonstration"], dependencies=[Depends(_demo_only)])


@router.get("/demo/telephone/{phone}")
def demo_phone_inbox(phone: str):
    """SMS reçus et envoyés par le téléphone simulé d'un usager."""
    return sms.inbox(phone)


@router.post("/demo/telephone/{phone}")
def demo_phone_reply(phone: str, body: PhoneReplyIn):
    """L'usager répond depuis son téléphone simulé (même traitement que POST /sms/entrant)."""
    return {"reply": consentement_sms.handle_reply(phone, body.text)}


def _citizen(c: dict) -> dict:
    """Fiche d'un citoyen fictif, telle que les portails l'affichent en sélection rapide."""
    iue = c.get("iue")
    login = iue or c["etat_civil"]["ref"]
    return {
        "label": f"{c['prenoms']} {c['nom']}", "note": c.get("note", ""), "iue": iue,
        "local_reference": None if iue else c["etat_civil"]["ref"],
        "username": login.lower(),
        "has_account": c.get("compte") is not False,
        "telephone": config.SMS_DEMO_PHONES.get(iue or "")
                     or (c.get("identifiant_unique") or {}).get("telephone"),   # téléphone simulé
        "sans_web": bool(c.get("sans_web")),   # usager joignable seulement par SMS
        # Date de naissance des seuls citoyens à inscrire : formulaire rempli en un clic
        "birth_date": c["etat_civil"]["date_naissance"] if c.get("compte") is False else None,
    }


@router.get("/demo/config")
def demo_config():
    """Comptes Keycloak de démonstration et citoyens fictifs."""
    with db.tx() as c:
        admins = c.execute("""SELECT a.code, a.name FROM administration a
                              WHERE EXISTS (SELECT 1 FROM cas_usage cu
                                             WHERE cu.admin_id = a.id AND cu.created_by = 'seed')
                              ORDER BY a.created_at, a.code""").fetchall()
    citizens = json.loads((config.ROOT / "registries-mock" / "data" / "citoyens_fictifs.json")
                          .read_text(encoding="utf-8"))
    return {
        "keycloak": {"url": config.KEYCLOAK_PUBLIC_URL, "realm": config.KEYCLOAK_REALM,
                     "client_id": config.KEYCLOAK_CLI_CLIENT},
        "demo_password": DEMO_PASSWORD,
        "agents": [{"code": a["code"], "name": a["name"],
                    "username": config.agent_username(a["code"])} for a in admins],
        "supervisor": "superviseur",
        "platform_admin": "admin-fasolink",
        "citizens": [_citizen(c) for c in citizens],
    }
