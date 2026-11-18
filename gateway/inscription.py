"""Inscription d'un citoyen avec son identifiant unique électronique (IUE, 12 chiffres).

  1. L'usager saisit son IUE et sa date de naissance.
     FasoLink interroge le registre national de l'identifiant unique : l'IUE doit exister,
     être ACTIF, et la date de naissance doit correspondre.
  2. Un code à usage unique est envoyé au téléphone enregistré pour cet IUE
     (en démonstration, il est renvoyé à l'écran faute de passerelle SMS).
  3. L'usager saisit le code et choisit son mot de passe : son compte Keycloak est
     créé (identifiant = IUE) et, s'il n'était pas encore connu de FasoLink,
     son identité est enrôlée à partir des références fournies par ce registre.

Le code n'est jamais stocké en clair (empreinte dans Redis, durée limitée, essais
limités). Les données du registre ne sont pas conservées : elles sont relues à la
confirmation. Les réponses d'erreur ne révèlent pas si un IUE existe.
"""
import hashlib
import hmac
import logging
import re
import secrets

from . import audit, config, crypto, db, keycloak_admin, registry_client, resilience, sms

log = logging.getLogger("fasolink.inscription")

IUE_RE = re.compile(r"^\d{12}$")   # identifiant unique électronique : 12 chiffres
GENERIC = "IUE ou date de naissance incorrects."
STATUS_MESSAGES = {
    "SUSPENDU": "Cet IUE est suspendu. Rapprochez-vous d'un centre d'enrôlement de l'identifiant unique.",
    "ANNULE": "Cet IUE a été annulé. Rapprochez-vous d'un centre d'enrôlement de l'identifiant unique.",
    "DECEDE": "L'inscription est impossible pour cet IUE.",
}


class Invalid(Exception):
    pass


class Conflict(Exception):
    pass


class TooMany(Exception):
    pass


class Unavailable(Exception):
    pass


def _key(token: str) -> str:
    return f"{resilience.P}:signup:{token}"


def _code_hash(token: str, code: str) -> str:
    return hashlib.sha256(f"{token}|{code}".encode()).hexdigest()


mask_phone = sms.mask
_send_sms = sms.send   # démonstration : déposé sur le téléphone simulé ; jamais écrit dans les journaux


def _iue_registry() -> dict:
    with db.tx() as c:
        return c.execute("SELECT * FROM administrative_registry WHERE code='IUE'").fetchone()


def _fetch(iue: str) -> dict | None:
    try:
        return registry_client.fetch_record(_iue_registry(), iue)
    except registry_client.RecordNotFound:
        return None
    except registry_client.RegistryUnavailable as exc:
        raise Unavailable("Le registre des IUE ne répond pas. Réessayez dans quelques minutes.") from exc


def _check_record(record: dict | None, birth_date: str) -> dict:
    if not record or record.get("date_naissance") != birth_date:
        raise Invalid(GENERIC)
    status = str(record.get("statut", "")).upper()
    if status != "ACTIF":
        raise Invalid(STATUS_MESSAGES.get(status, "Cet IUE n'est pas actif. Rapprochez-vous d'un centre d'enrôlement."))
    if not record.get("telephone"):
        raise Invalid("Aucun téléphone n'est enregistré pour cet IUE. Rapprochez-vous d'un centre d'enrôlement.")
    return record


def _normalize(iue: str) -> str:
    iue = "".join(iue.split())   # « 4820 1973 6154 » est accepté
    if not IUE_RE.match(iue):
        raise Invalid("L'identifiant unique électronique compte 12 chiffres (ex. 482019736154).")
    return iue


def start(iue: str, birth_date: str) -> dict:
    """Étapes 1 et 2 : vérifie l'IUE auprès du registre de l'identifiant unique et envoie le code."""
    iue = _normalize(iue)
    limiter = f"{resilience.P}:signup:starts:{hashlib.sha256(iue.encode()).hexdigest()}"
    starts = resilience.r.incr(limiter)
    if starts == 1:
        resilience.r.expire(limiter, 900)
    if starts > config.SIGNUP_MAX_STARTS:
        raise TooMany("Trop de demandes de code pour cet IUE. Réessayez dans un quart d'heure.")

    record = _check_record(_fetch(iue), birth_date)
    if keycloak_admin.user_exists(iue.lower()):
        raise Conflict("Un compte existe déjà pour cet IUE : connectez-vous avec votre IUE et votre mot de passe.")

    token = secrets.token_urlsafe(24)
    code = f"{secrets.randbelow(10 ** 6):06d}"
    resilience.r.hset(_key(token), mapping={"iue": iue, "birth": birth_date,
                                            "code": _code_hash(token, code), "attempts": 0})
    resilience.r.expire(_key(token), config.SIGNUP_CODE_TTL_S)
    try:
        _send_sms(record["telephone"], f"FasoLink: votre code d'inscription est {code}. Valable 10 min. Ne le communiquez a personne.")
    except sms.SmsError as exc:
        resilience.r.delete(_key(token))
        raise Unavailable("Le SMS n'a pas pu être envoyé. Réessayez dans quelques minutes.") from exc
    out = {"token": token, "telephone": mask_phone(record["telephone"]),
           "expires_in": config.SIGNUP_CODE_TTL_S}
    if config.DEMO_MODE:
        out["demo_code"] = code   # aucune passerelle SMS en démonstration
    return out


def _check_password(password: str, iue: str) -> None:
    if len(password) < 10 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise Invalid("Mot de passe trop faible : au moins 10 caractères, dont des lettres et des chiffres.")
    if iue.lower() in password.lower():
        raise Invalid("Le mot de passe ne doit pas contenir votre IUE.")


def _enroll(c, iue: str, record: dict) -> dict:
    """Identité FasoLink de cet IUE : existante, ou créée à partir des références du registre."""
    identity = c.execute("SELECT * FROM national_identity_reference WHERE iue_fingerprint=%s",
                         (crypto.fingerprint(iue, "IUE"),)).fetchone()
    if identity:
        return identity
    iue_ct = crypto.encrypt(iue)
    identity = c.execute(
        """INSERT INTO national_identity_reference
             (iue_ciphertext, iue_fingerprint, encryption_key_version, identity_status,
              verification_status, source_system, last_verified_at)
           VALUES (%s,%s,%s,'VERIFIED','SUCCESS','REGISTRE_IUE',now()) RETURNING *""",
        (iue_ct, crypto.fingerprint(iue, "IUE"), crypto.key_version(iue_ct))).fetchone()
    registries = {r["code"]: r["id"] for r in c.execute("SELECT code, id FROM administrative_registry")}
    for code, ref in (record.get("references") or {}).items():
        if code in registries:
            ref_ct = crypto.encrypt(ref)
            c.execute(
                """INSERT INTO registry_identity_mapping
                     (identity_id, registry_id, local_reference_ciphertext,
                      local_reference_fingerprint, encryption_key_version)
                   VALUES (%s,%s,%s,%s,%s)""",
                (identity["id"], registries[code], ref_ct, crypto.fingerprint(ref, code),
                 crypto.key_version(ref_ct)))
    return identity


def confirm(token: str, code: str, password: str) -> dict:
    """Étape 3 : vérifie le code, relit le registre, crée le compte (et l'identité si besoin)."""
    key = _key(token)
    pending = resilience.r.hgetall(key)
    if not pending:
        raise Invalid("Code expiré ou inscription introuvable : recommencez l'inscription.")
    if not hmac.compare_digest(pending["code"], _code_hash(token, code.strip())):
        attempts = resilience.r.hincrby(key, "attempts", 1)
        left = config.SIGNUP_MAX_ATTEMPTS - attempts
        if left <= 0:
            resilience.r.delete(key)
            raise Invalid("Code incorrect. Trop d'essais : recommencez l'inscription.")
        raise Invalid(f"Code incorrect ({left} essai{'s' if left > 1 else ''} restant{'s' if left > 1 else ''}).")

    iue = pending["iue"]
    _check_password(password, iue)
    record = _check_record(_fetch(iue), pending["birth"])   # statut relu : un IUE annulé entre-temps est refusé
    if not resilience.r.delete(key):                          # code à usage unique
        raise Invalid("Code déjà utilisé : recommencez l'inscription.")

    user_id = None
    try:
        with db.tx() as c:
            identity = _enroll(c, iue, record)
            registry_id = c.execute("SELECT id FROM administrative_registry WHERE code='IUE'").fetchone()["id"]
            audit.log(c, "CITIZEN_REGISTERED", identity_id=identity["id"], registry_id=registry_id,
                      decision="N/A", attributes=["statut", "date_naissance", "telephone"])
            # En dernier : si Keycloak refuse, l'enrôlement est annulé avec la transaction
            user_id = keycloak_admin.create_citizen(username=iue.lower(), first_name=record["prenoms"],
                                                    last_name=record["nom"], password=password)
    except keycloak_admin.Conflict:
        raise Conflict("Un compte existe déjà pour cet IUE : connectez-vous.")
    except Exception:
        if user_id:
            keycloak_admin.delete_user(user_id)
        raise
    return {"username": iue.lower(), "name": f"{record['prenoms']} {record['nom']}"}
