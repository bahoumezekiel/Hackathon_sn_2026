"""Corps des requêtes de l'API, validés par Pydantic avant d'atteindre la logique métier."""
import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- vérifications et attestations

class CitizenRef(BaseModel):
    """Usager visé : son IUE, ou à défaut un registre et sa référence locale."""
    iue: str | None = Field(default=None, max_length=64)
    registry: str | None = Field(default=None, max_length=32)
    local_reference: str | None = Field(default=None, max_length=64)


class VerificationIn(BaseModel):
    citizen: CitizenRef
    purpose_code: str = Field(max_length=64)
    predicates: list[str] = Field(min_length=1, max_length=10)
    justification: str | None = Field(default=None, max_length=500)


class AttestationIn(BaseModel):
    jws: str = Field(max_length=8192)


# ---------------------------------------------------------------- espace citoyen

class AlertIn(BaseModel):
    request_id: uuid.UUID | None = None
    description: str = Field(min_length=3, max_length=2000)
    channel: Literal["WEB", "VOICE", "SMS", "USSD"] = "WEB"
    language: Literal["fr", "mos", "dyu"] = "fr"   # français, mooré, dioula


class ConsentIn(BaseModel):
    policy_code: str = Field(max_length=64)
    grant: bool


class SignupStartIn(BaseModel):
    iue: str = Field(min_length=4, max_length=20)
    date_naissance: date


class SignupConfirmIn(BaseModel):
    token: str = Field(min_length=10, max_length=64)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    password: str = Field(min_length=10, max_length=128)


# ---------------------------------------------------------------- SMS

class SmsIn(BaseModel):
    """Format des SMS entrants (à adapter à l'agrégateur de l'opérateur)."""
    sender: str = Field(alias="from", min_length=8, max_length=20)
    text: str = Field(min_length=1, max_length=160)


class PhoneReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=160)


# ---------------------------------------------------------------- supervision

class OutageIn(BaseModel):
    down: bool


class AlertUpdateIn(BaseModel):
    status: Literal["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]
    note: str | None = Field(default=None, max_length=1000)


# ---------------------------------------------------------------- référentiel

class AdministrationIn(BaseModel):
    code: str = Field(min_length=2, max_length=30)
    name: str = Field(min_length=3, max_length=150)
    ministry: str | None = Field(default=None, max_length=150)


class AdministrationStatusIn(BaseModel):
    status: Literal["ACTIVE", "SUSPENDED"]


class AgentIn(BaseModel):
    username: str = Field(min_length=3, max_length=60, pattern=r"^[a-z0-9][a-z0-9._-]+$")
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=150, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AgentStatusIn(BaseModel):
    enabled: bool


class CasierParamsIn(BaseModel):
    categories_incompatibles: list[str] = Field(default_factory=list, max_length=20)
    ignorer_sursis: bool = False


class RegistreIn(BaseModel):
    """Un registre consultable dans un cas d'usage, avec les informations qu'il peut transmettre."""
    registry_code: str = Field(max_length=30)
    predicates: list[str] = Field(min_length=1, max_length=10)
    requires_consent: bool = False
    degraded_cache_ttl_s: int = Field(default=0, ge=0, le=86_400)
    parametres: CasierParamsIn | None = None


class CasUsageUpdateIn(BaseModel):
    label: str = Field(min_length=3, max_length=150)
    description: str | None = Field(default=None, max_length=1000)
    legal_basis: str = Field(min_length=5, max_length=150)
    requires_justification: bool = True
    registres: list[RegistreIn] = Field(min_length=1, max_length=10)


class CasUsageIn(CasUsageUpdateIn):
    code: str = Field(min_length=3, max_length=50)
