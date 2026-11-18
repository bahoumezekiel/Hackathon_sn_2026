"""Routes publiques : santé, vérification des attestations, inscription des citoyens."""
import jwt
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from .. import crypto, health, inscription
from ..predicates import display
from ..schemas import AttestationIn, SignupConfirmIn, SignupStartIn

router = APIRouter()


@router.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/docs")


@router.get("/health")
def liveness():
    return {"status": "UP"}


@router.get("/health/stack", tags=["public"])
def health_stack():
    """État de chaque composant du socle technique."""
    return health.stack_status()


@router.get("/.well-known/jwks.json", tags=["public"])
def jwks():
    """Clé publique : n'importe qui peut vérifier une attestation FasoLink."""
    return crypto.jwks()


@router.post("/v1/attestations/verify", tags=["public"])
def verify_attestation(body: AttestationIn):
    try:
        claims = crypto.verify(body.jws)
    except jwt.ExpiredSignatureError:
        return {"valid": False, "error": "Attestation expirée"}
    except jwt.PyJWTError as exc:
        return {"valid": False, "error": f"Signature invalide ({type(exc).__name__})"}
    return {"valid": True, "claims": claims,
            "display": display(claims["predicate"], claims["value"])}


# ---------------------------------------------------------------- inscription des citoyens

@router.post("/public/inscription/code", tags=["inscription"])
def signup_start(body: SignupStartIn):
    """Vérifie l'IUE auprès du registre national de l'identifiant unique et envoie un code au
    téléphone enregistré. En démonstration, le code est renvoyé (`demo_code`)."""
    return inscription.start(body.iue, body.date_naissance.isoformat())


@router.post("/public/inscription/confirmation", tags=["inscription"], status_code=201)
def signup_confirm(body: SignupConfirmIn):
    """Vérifie le code et crée le compte citoyen (identifiant de connexion : l'IUE)."""
    return inscription.confirm(body.token, body.code, body.password)
