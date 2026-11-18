"""Espace administration : les agents vérifient les pièces d'un usager (rôle agent)."""
import uuid

from fastapi import APIRouter, Depends

from .. import db, referentiel, service
from ..auth import agent_auth
from ..predicates import PREDICATES
from ..schemas import VerificationIn

router = APIRouter(tags=["administration"])


@router.get("/v1/purposes")
def purposes(auth=Depends(agent_auth)):
    """Cas d'usage de cette administration et registres consultables pour chacun.

    Le `purpose_code` d'une vérification est le code du cas d'usage ; l'agent choisit,
    selon l'usager, les registres à interroger parmi ceux du cas d'usage."""
    with db.tx() as c:
        cas = referentiel.list_cas_usage(c, auth["admin"]["id"], active_only=True)
    flat = [dict(r, purpose_code=cu["code"], purpose_label=cu["label"], legal_basis=cu["legal_basis"])
            for cu in cas for r in cu["registres"]]
    return {"administration": auth["admin"]["name"],
            "cas_usage": [{k: cu[k] for k in ("code", "label", "description", "legal_basis",
                                              "requires_justification", "registres")} for cu in cas],
            "purposes": flat,
            "predicates": {k: v["label"] for k, v in PREDICATES.items()}}


@router.post("/v1/verifications")
def create_verification(body: VerificationIn, auth=Depends(agent_auth)):
    """Pose une question (ex. est_majeur) et reçoit une réponse Oui/Non signée."""
    return service.submit_verification(
        admin=auth["admin"], agent_id=auth["agent_id"], citizen=body.citizen.model_dump(),
        purpose_code=body.purpose_code, predicates=body.predicates,
        justification=body.justification)


@router.get("/v1/requests/{request_id}")
def get_request(request_id: uuid.UUID, auth=Depends(agent_auth)):
    """Suivi d'une demande (attente d'un registre, accord SMS…) ; limité à son administration."""
    return service.request_view(request_id, admin_id=auth["admin"]["id"])
