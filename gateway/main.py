"""Point d'entrée de la passerelle FasoLink (uvicorn gateway.main:app).

Assemble l'application : journalisation, tâche de fond, gestion des erreurs et routes.
La logique métier est dans les modules du paquet ; les routes sont dans gateway/api/.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from . import errors, worker
from .api import ROUTERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s : %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with worker.running():
        yield


app = FastAPI(
    title="FasoLink", version="0.2.0", lifespan=lifespan,
    description=(
        "Socle d'interopérabilité administrative — « Dites-le nous une fois ».\n\n"
        "**Authentification** : jeton d'accès Keycloak (realm `fasolink`). Pour un système "
        "d'information : flux *client credentials* avec le client `admin-a`, `admin-b`, `admin-c` ou `cefore`. "
        "Cliquez sur **Authorize** et collez le jeton."),
    swagger_ui_parameters={"persistAuthorization": True},
)
errors.register(app)

# En-têtes de sécurité des réponses de l'API. Derrière nginx (portails), les mêmes sont posés par
# security-headers.inc ; ici, ils protègent les accès directs (Swagger, webhooks des opérateurs).
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    # Données personnelles et décisions d'accès : jamais conservées par un cache intermédiaire
    "Cache-Control": "no-store",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response

for router in ROUTERS:
    app.include_router(router)
