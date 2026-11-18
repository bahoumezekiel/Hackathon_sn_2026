"""Authentification par jetons Keycloak (OIDC).

Rôles du realm « fasolink » :
  agent       agent ou système d'une administration ; l'administration est
              donnée par le groupe Keycloak (ADMIN_A, ADMIN_B…)
  supervisor  délégué à la protection des données / exploitation
  platform_admin  administrateur du référentiel : structures, agents, cas d'usage
  citizen     citoyen ; son identifiant de connexion est son IUE, ou sa
              référence d'état civil s'il n'a pas d'IUE
"""
import uuid

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config, db, service

bearer = HTTPBearer(auto_error=False, description="Jeton d'accès Keycloak (realm fasolink)")
_jwks = jwt.PyJWKClient(config.KEYCLOAK_JWKS_URL, cache_keys=True, lifespan=300, timeout=5)


def _claims(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None:
        raise HTTPException(401, "Jeton d'accès Keycloak requis", headers={"WWW-Authenticate": "Bearer"})
    try:
        key = _jwks.get_signing_key_from_jwt(creds.credentials).key
        return jwt.decode(creds.credentials, key, algorithms=["RS256"],
                          audience=config.KEYCLOAK_AUDIENCE, issuer=config.KEYCLOAK_ISSUER)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Jeton expiré, reconnectez-vous") from None
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise HTTPException(401, f"Jeton invalide ({type(exc).__name__})") from exc


def _roles(claims: dict) -> set[str]:
    return set(claims.get("realm_access", {}).get("roles", []))


def agent_auth(creds=Depends(bearer)) -> dict:
    claims = _claims(creds)
    if "agent" not in _roles(claims):
        raise HTTPException(403, "Rôle « agent » requis")
    groups = [g.strip("/") for g in claims.get("groups", [])]
    with db.tx() as c:
        admin = c.execute("SELECT * FROM administration WHERE code = ANY(%s) LIMIT 1",
                          (groups,)).fetchone()
    if not admin:
        raise HTTPException(403, "Ce compte n'est rattaché à aucune administration")
    return {"admin": admin, "agent_id": uuid.UUID(claims["sub"]),
            "agent_name": claims.get("preferred_username"), "client": claims.get("azp")}


def supervisor_auth(creds=Depends(bearer)) -> dict:
    claims = _claims(creds)
    if "supervisor" not in _roles(claims):
        raise HTTPException(403, "Rôle « supervisor » requis")
    return claims


def platform_admin_auth(creds=Depends(bearer)) -> dict:
    """Administrateur de la plateforme : crée structures, agents et cas d'usage.
    Rôle distinct du superviseur : qui accorde les accès n'est pas qui les contrôle."""
    claims = _claims(creds)
    if "platform_admin" not in _roles(claims):
        raise HTTPException(403, "Rôle « platform_admin » requis")
    return {"user_id": uuid.UUID(claims["sub"]), "username": claims.get("preferred_username")}


def citizen_auth(creds=Depends(bearer)) -> uuid.UUID:
    claims = _claims(creds)
    if "citizen" not in _roles(claims):
        raise HTTPException(403, "Rôle « citizen » requis")
    login = claims.get("preferred_username", "")
    with db.tx() as c:
        try:
            identity = service.resolve_identity(c, {"iue": login})
        except service.NotFound:
            identity = service.resolve_identity(c, {"registry": "ETAT_CIVIL", "local_reference": login})
    return identity["id"]


def keycloak_ready() -> bool:
    try:
        _jwks.get_jwk_set()
        return True
    except jwt.PyJWKClientError:
        return False
