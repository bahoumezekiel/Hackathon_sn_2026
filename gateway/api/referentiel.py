"""Référentiel : structures, agents et cas d'usage (rôle platform_admin).

Rôle distinct du superviseur : la personne qui accorde les accès n'est pas celle qui les contrôle.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException

from .. import db, keycloak_admin, referentiel
from ..auth import platform_admin_auth
from ..schemas import AdministrationIn, AdministrationStatusIn, AgentIn, AgentStatusIn, CasUsageIn, CasUsageUpdateIn

router = APIRouter(prefix="/admin", tags=["référentiel"])


@router.get("/catalogue")
def admin_catalogue(_actor=Depends(platform_admin_auth)):
    """Registres connectés, informations (prédicats) qu'ils fournissent, catégories du casier."""
    with db.tx() as c:
        return referentiel.catalogue(c)


# ---------------------------------------------------------------- structures

@router.get("/administrations")
def admin_list_administrations(_actor=Depends(platform_admin_auth)):
    with db.tx() as c:
        return referentiel.list_administrations(c)


@router.post("/administrations", status_code=201)
def admin_create_administration(body: AdministrationIn, actor=Depends(platform_admin_auth)):
    """Crée une structure de l'État et son groupe Keycloak (rattachement des agents)."""
    with db.tx() as c:
        return referentiel.create_administration(c, code=body.code, name=body.name,
                                                 ministry=body.ministry, actor=actor)


@router.post("/administrations/{code}/status")
def admin_set_status(code: str, body: AdministrationStatusIn, actor=Depends(platform_admin_auth)):
    """Suspendre une structure : OPA refuse alors toutes ses demandes."""
    with db.tx() as c:
        return referentiel.set_administration_status(c, code, body.status, actor)


# ---------------------------------------------------------------- agents

@router.get("/administrations/{code}/agents")
def admin_list_agents(code: str, _actor=Depends(platform_admin_auth)):
    with db.tx() as c:
        admin = referentiel.get_administration(c, code)
    return keycloak_admin.list_agents(admin["code"])


@router.post("/administrations/{code}/agents", status_code=201)
def admin_create_agent(code: str, body: AgentIn, actor=Depends(platform_admin_auth)):
    """Crée un agent ; le mot de passe provisoire n'est affiché qu'une fois."""
    with db.tx() as c:
        admin = referentiel.get_administration(c, code)
        if admin["status"] != "ACTIVE":
            raise HTTPException(400, "Structure suspendue : réactivez-la avant de lui créer des agents")
        created = keycloak_admin.create_agent(
            admin["code"], admin["name"], username=body.username, first_name=body.first_name,
            last_name=body.last_name, email=body.email)
        referentiel.log_agent_event(c, admin["code"], "AGENT_CREATED", body.username, actor)
    return created


@router.post("/administrations/{code}/agents/{user_id}")
def admin_set_agent(code: str, user_id: uuid.UUID, body: AgentStatusIn,
                    actor=Depends(platform_admin_auth)):
    """Active ou désactive le compte d'un agent."""
    with db.tx() as c:
        admin = referentiel.get_administration(c, code)
        keycloak_admin.set_agent_enabled(admin["code"], str(user_id), body.enabled)
        referentiel.log_agent_event(c, admin["code"],
                                    "AGENT_ENABLED" if body.enabled else "AGENT_DISABLED",
                                    str(user_id), actor)
    return {"id": str(user_id), "enabled": body.enabled}


# ---------------------------------------------------------------- cas d'usage

@router.get("/administrations/{code}/cas-usage")
def admin_list_cas_usage(code: str, _actor=Depends(platform_admin_auth)):
    with db.tx() as c:
        admin = referentiel.get_administration(c, code)
        return referentiel.list_cas_usage(c, admin["id"])


@router.post("/administrations/{code}/cas-usage", status_code=201)
def admin_create_cas_usage(code: str, body: CasUsageIn, actor=Depends(platform_admin_auth)):
    """Crée un cas d'usage et une politique d'accès par registre consultable."""
    with db.tx() as c:
        return referentiel.create_cas_usage(c, code, body.model_dump(), actor)


@router.put("/cas-usage/{cas_id}")
def admin_update_cas_usage(cas_id: uuid.UUID, body: CasUsageUpdateIn,
                           actor=Depends(platform_admin_auth)):
    """Nouvelle version : les politiques en cours sont closes, jamais modifiées."""
    with db.tx() as c:
        return referentiel.update_cas_usage(c, cas_id, body.model_dump(), actor)


@router.post("/cas-usage/{cas_id}/deactivate")
def admin_deactivate_cas_usage(cas_id: uuid.UUID, actor=Depends(platform_admin_auth)):
    with db.tx() as c:
        return referentiel.deactivate_cas_usage(c, cas_id, actor)
