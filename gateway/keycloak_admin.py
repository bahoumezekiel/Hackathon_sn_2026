"""Gestion des structures et des agents dans Keycloak (API d'administration).

Une structure = un groupe Keycloak portant son code ; un agent = un utilisateur
du rôle « agent » membre de ce groupe (voir auth.agent_auth).
La passerelle agit avec le compte de service du client « fasolink-admin-api »,
limité à la gestion des utilisateurs et des groupes du realm fasolink.
"""
import secrets
import time

import httpx

from . import config


class KeycloakAdminError(Exception):
    pass


class Conflict(KeycloakAdminError):
    pass


_client = httpx.Client(base_url=config.KEYCLOAK_URL, timeout=5)
_token = {"value": None, "exp": 0.0}
_BASE = f"/admin/realms/{config.KEYCLOAK_REALM}"


def _access_token() -> str:
    if _token["value"] and _token["exp"] > time.time() + 15:
        return _token["value"]
    if not config.KEYCLOAK_ADMIN_CLIENT_SECRET:
        raise KeycloakAdminError("Secret du client fasolink-admin-api absent : relancez scripts/init_env.py")
    try:
        r = _client.post(f"/realms/{config.KEYCLOAK_REALM}/protocol/openid-connect/token",
                         data={"grant_type": "client_credentials",
                               "client_id": config.KEYCLOAK_ADMIN_CLIENT,
                               "client_secret": config.KEYCLOAK_ADMIN_CLIENT_SECRET})
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise KeycloakAdminError(f"Keycloak injoignable ({type(exc).__name__})") from exc
    body = r.json()
    _token.update(value=body["access_token"], exp=time.time() + body.get("expires_in", 60))
    return _token["value"]


def _call(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        r = _client.request(method, _BASE + path,
                            headers={"Authorization": f"Bearer {_access_token()}"}, **kwargs)
    except httpx.HTTPError as exc:
        raise KeycloakAdminError(f"Keycloak injoignable ({type(exc).__name__})") from exc
    if r.status_code == 409:
        raise Conflict("Existe déjà dans Keycloak")
    if r.status_code >= 400:
        raise KeycloakAdminError(f"Keycloak a refusé l'opération ({r.status_code})")
    return r


# ---------------------------------------------------------------- structures (groupes)

def find_group(code: str) -> dict | None:
    groups = _call("GET", "/groups", params={"search": code, "exact": "true",
                                             "briefRepresentation": "true"}).json()
    return next((g for g in groups if g["name"] == code), None)


def ensure_group(code: str, label: str) -> str:
    """Crée le groupe de la structure s'il n'existe pas ; renvoie son identifiant."""
    group = find_group(code)
    if group:
        return group["id"]
    _call("POST", "/groups", json={"name": code, "attributes": {"label": [label]}})
    group = find_group(code)
    if not group:
        raise KeycloakAdminError("Groupe créé mais introuvable")
    return group["id"]


# ---------------------------------------------------------------- agents

def _user_view(u: dict) -> dict:
    return {"id": u["id"], "username": u["username"], "first_name": u.get("firstName"),
            "last_name": u.get("lastName"), "email": u.get("email"),
            "enabled": u.get("enabled", False), "created_at": u.get("createdTimestamp"),
            "must_change_password": "UPDATE_PASSWORD" in u.get("requiredActions", [])}


def list_agents(code: str) -> list[dict]:
    group = find_group(code)
    if not group:
        return []
    members = _call("GET", f"/groups/{group['id']}/members",
                    params={"max": 200, "briefRepresentation": "false"}).json()
    return [_user_view(u) for u in members if not u["username"].startswith("service-account-")]


def create_agent(code: str, label: str, *, username: str, first_name: str, last_name: str,
                 email: str | None) -> dict:
    """Crée l'agent avec un mot de passe provisoire, à changer à la première connexion."""
    group_id = ensure_group(code, label)
    password = secrets.token_urlsafe(9)
    rep = {"username": username, "firstName": first_name, "lastName": last_name,
           "enabled": True, "emailVerified": bool(email),
           "credentials": [{"type": "password", "value": password, "temporary": True}],
           "requiredActions": ["UPDATE_PASSWORD"]}
    if email:
        rep["email"] = email
    location = _call("POST", "/users", json=rep).headers.get("Location", "")
    user_id = location.rstrip("/").rsplit("/", 1)[-1]
    role = _call("GET", "/roles/agent").json()
    _call("POST", f"/users/{user_id}/role-mappings/realm", json=[role])
    _call("PUT", f"/users/{user_id}/groups/{group_id}")
    return {"id": user_id, "username": username, "temporary_password": password}


def user_exists(username: str) -> bool:
    users = _call("GET", "/users", params={"username": username, "exact": "true",
                                           "briefRepresentation": "true"}).json()
    return any(u["username"] == username for u in users)


def create_citizen(*, username: str, first_name: str, last_name: str, password: str) -> str:
    """Compte citoyen créé par l'usager lui-même, après vérification de son IUE.
    Le mot de passe est choisi par l'usager : il n'est ni provisoire ni connu de FasoLink."""
    location = _call("POST", "/users", json={
        "username": username, "firstName": first_name, "lastName": last_name,
        "enabled": True, "credentials": [{"type": "password", "value": password, "temporary": False}],
    }).headers.get("Location", "")
    user_id = location.rstrip("/").rsplit("/", 1)[-1]
    role = _call("GET", "/roles/citizen").json()
    _call("POST", f"/users/{user_id}/role-mappings/realm", json=[role])
    return user_id


def delete_user(user_id: str) -> None:
    """Annule une création incomplète (ex. échec de l'enrôlement après création du compte)."""
    _call("DELETE", f"/users/{user_id}")


def set_agent_enabled(code: str, user_id: str, enabled: bool) -> None:
    """Active ou désactive un agent, seulement s'il appartient bien à cette structure."""
    if not any(a["id"] == user_id for a in list_agents(code)):
        raise KeycloakAdminError("Cet agent n'appartient pas à cette structure")
    _call("PUT", f"/users/{user_id}", json={"enabled": enabled})


def health() -> bool:
    try:
        _access_token()
        return True
    except KeycloakAdminError:
        return False
