"""Traduction des exceptions métier en réponses HTTP.

Les modules métier lèvent des exceptions explicites (NotFound, Conflict…) et ne
connaissent rien de HTTP ; la correspondance avec les codes de statut est faite ici.
"""
import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import crypto, inscription, keycloak_admin, referentiel, service

log = logging.getLogger("fasolink")

# Exception métier -> code HTTP ; le message de l'exception est renvoyé tel quel à l'appelant
_STATUS = {
    service.NotFound: 404,
    referentiel.Missing: 404,
    service.BadRequest: 400,
    referentiel.Invalid: 400,
    inscription.Invalid: 400,
    inscription.Conflict: 409,
    inscription.TooMany: 429,
    inscription.Unavailable: 503,
}


def _detail(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": message})


def _passthrough(status: int):
    async def handle(_req, exc):
        return _detail(status, str(exc))
    return handle


def register(app: FastAPI) -> None:
    for exc_class, status in _STATUS.items():
        app.add_exception_handler(exc_class, _passthrough(status))

    @app.exception_handler(crypto.VaultError)
    async def _vault_error(_req, exc):
        log.error("Vault : %s", exc)
        return _detail(503, "Service de chiffrement (Vault) indisponible")

    @app.exception_handler(keycloak_admin.Conflict)
    async def _keycloak_conflict(_req, _exc):
        return _detail(409, "Cet identifiant est déjà utilisé dans Keycloak")

    @app.exception_handler(keycloak_admin.KeycloakAdminError)
    async def _keycloak_error(_req, exc):
        log.error("Keycloak (administration) : %s", exc)
        return _detail(502, f"Gestion des comptes indisponible : {exc}")
