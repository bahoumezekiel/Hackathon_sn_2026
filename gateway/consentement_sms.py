"""Consentement par SMS, pour les usagers qui n'ont pas accès au portail web.

  1. Un agent interroge un registre dont le cas d'usage exige le consentement ;
     l'usager ne l'a jamais donné ni refusé (OPA : seul le consentement bloque).
  2. FasoLink lit le téléphone associé à son IUE (registre de l'identifiant unique)
     et envoie : « 1 = OUI, 2 = NON ». La demande passe en AWAITING_CONSENT.
  3. Réponse 1 : l'accord est enregistré POUR CETTE DEMANDE SEULEMENT, puis le
     registre est consulté. Réponse 2 ou délai dépassé : la demande est refusée.

Le numéro n'est conservé que sous forme d'empreinte (pour reconnaître la réponse)
et masquée. Chaque étape est inscrite au journal d'audit chaîné.
"""
import logging
import time
from datetime import timedelta

from . import audit, config, crypto, db, registry_client, sms, sms_texte, twilio_sms

log = logging.getLogger("fasolink.consentement_sms")

YES = {"1", "OUI", "O", "YES"}
NO = {"2", "NON", "N", "NO"}


def lookup_phone(identity: dict) -> str | None:
    """Téléphone associé à l'IUE de l'usager, si l'IUE est actif ; sinon None."""
    if not identity.get("iue_ciphertext"):
        return None                           # usager sans IUE : pas de téléphone connu
    iue = crypto.decrypt(identity["iue_ciphertext"])
    with db.tx() as c:
        reg = c.execute("SELECT * FROM administrative_registry WHERE code='IUE'").fetchone()
    if not reg:
        return None
    try:
        record = registry_client.fetch_record(reg, iue)
    except (registry_client.RecordNotFound, registry_client.RegistryUnavailable):
        return None
    if str(record.get("statut", "")).upper() != "ACTIF":
        return None
    return record.get("telephone") or None


def open_request(c, req: dict, phone: str) -> str:
    """Enregistre la demande d'accord et renvoie le texte du SMS (envoyé après la transaction)."""
    info = c.execute(
        """SELECT a.name AS admin, r.name AS registry,
                  coalesce(purpose_label(q.requester_admin_id, q.purpose_code), q.purpose_code) AS purpose
           FROM access_request q
           JOIN administration a ON a.id = q.requester_admin_id
           JOIN administrative_registry r ON r.id = q.registry_id
           WHERE q.id=%s""", (req["id"],)).fetchone()
    expires = db.utcnow() + timedelta(seconds=config.SMS_CONSENT_TTL_S)
    c.execute(
        """INSERT INTO sms_consent_request (request_id, identity_id, phone_fingerprint, phone_masked,
                                            expires_at)
           VALUES (%s,%s,%s,%s,%s)""",
        (req["id"], req["identity_id"], sms.fingerprint(phone), sms.mask(phone), expires))
    audit.log(c, "CONSENT_REQUESTED", request_id=req["id"], identity_id=req["identity_id"],
              actor_admin_id=req["requester_admin_id"], actor_user_id=req["requester_user_id"],
              registry_id=req["registry_id"], purpose_code=req["purpose_code"], decision="N/A",
              attributes=["SMS"])
    return sms_texte.consent_request(info["admin"], info["registry"], info["purpose"],
                                     config.SMS_CONSENT_TTL_S // 60)


def _deny(c, row: dict, status: str, reason: str) -> None:
    c.execute("""UPDATE sms_consent_request SET status=%s,
                     answered_at = CASE WHEN %s = 'REFUSED' THEN now() END
                 WHERE id=%s""", (status, status, row["id"]))
    c.execute("""UPDATE access_request SET status='DENIED', decision='DENY', decision_reason=%s,
                     completed_at=now() WHERE id=%s AND status='AWAITING_CONSENT'""",
              (reason, row["request_id"]))
    audit.log(c, "POLICY_DECISION", request_id=row["request_id"], identity_id=row["identity_id"],
              actor_admin_id=row["requester_admin_id"], actor_user_id=row["requester_user_id"],
              registry_id=row["registry_id"], purpose_code=row["purpose_code"], decision="DENY",
              attributes=["SMS", status])


_PENDING = """SELECT s.*, q.requester_admin_id, q.requester_user_id, q.registry_id, q.purpose_code,
                     a.name AS admin
              FROM sms_consent_request s
              JOIN access_request q ON q.id = s.request_id
              JOIN administration a ON a.id = q.requester_admin_id
              WHERE {where}
              ORDER BY s.sent_at DESC
              FOR UPDATE OF s SKIP LOCKED"""


def _grant(c, target: dict, channel: str) -> None:
    c.execute("UPDATE sms_consent_request SET status='GRANTED', answered_at=now() WHERE id=%s",
              (target["id"],))
    label = "par SMS" if channel == "SMS" else "par appel vocal"
    c.execute("""UPDATE access_request SET status='PROCESSING', decision_reason=%s
                 WHERE id=%s AND status='AWAITING_CONSENT'""",
              (f"Accord de l'usager reçu {label}", target["request_id"]))
    audit.log(c, "CONSENT_GIVEN", request_id=target["request_id"],
              identity_id=target["identity_id"], actor_admin_id=target["requester_admin_id"],
              registry_id=target["registry_id"], purpose_code=target["purpose_code"],
              decision="N/A", attributes=[channel, "GRANTED"])


def _run(request_id) -> None:
    from . import service  # import tardif : service importe ce module
    service.execute(request_id)


def handle_reply(phone: str, text: str) -> str:
    """Réponse par SMS (« 1 » ou « 2 ») ; renvoie le SMS de confirmation envoyé."""
    sms.record_reply(phone, text)
    answer = text.strip().upper().rstrip(".!")
    granted_request = None
    with db.tx() as c:
        rows = c.execute(_PENDING.format(where="s.phone_fingerprint=%s AND s.status='PENDING' "
                                               "AND s.expires_at > now()"),
                         (sms.fingerprint(phone),)).fetchall()
        if not rows:
            reply = "FasoLink: aucune demande d'acces n'attend votre reponse."
        elif answer not in YES | NO:
            reply = "FasoLink: reponse non comprise. Repondez 1=OUI ou 2=NON."
        else:
            target, older = rows[0], rows[1:]
            for row in older:   # la réponse vaut pour la demande la plus récente
                _deny(c, row, "SUPERSEDED",
                      "Accord non recueilli : une demande plus récente a été envoyée au même numéro")
            if answer in YES:
                _grant(c, target, "SMS")
                granted_request = target["request_id"]
                reply = f"FasoLink: merci, accord transmis a {target['admin']} pour cette demande uniquement."
            else:
                _deny(c, target, "REFUSED", "L'usager a refusé l'accès par SMS")
                reply = f"FasoLink: refus enregistre. {target['admin']} n'aura pas acces a vos donnees."
    try:
        sms.send(phone, reply)
    except sms.SmsError:
        pass   # confirmation seulement : la réponse de l'usager est déjà prise en compte
    if granted_request:
        _run(granted_request)
    return reply


# ---------------------------------------------------------------- appel vocal (Twilio Voice)

def voice_action_url(consent_id) -> str:
    """URL publique où Twilio renvoie la touche pressée ; l'identifiant (UUID) n'est pas devinable
    et la signature Twilio de chaque appel est vérifiée."""
    return f"{config.PUBLIC_URL}/voix/twilio?consent={consent_id}"


def start_call(request_id, phone: str) -> None:
    """Appelle l'usager pour recueillir son accord (en plus du SMS d'information)."""
    with db.tx() as c:
        row = c.execute(
            """SELECT s.id, a.name AS admin, r.name AS registry,
                      coalesce(purpose_label(q.requester_admin_id, q.purpose_code), q.purpose_code) AS purpose
               FROM sms_consent_request s
               JOIN access_request q ON q.id = s.request_id
               JOIN administration a ON a.id = q.requester_admin_id
               JOIN administrative_registry r ON r.id = q.registry_id
               WHERE s.request_id=%s AND s.status='PENDING'""", (request_id,)).fetchone()
    if not row:
        return
    question = (f"Bonjour. Ici FasoLink. {row['admin']} demande à consulter votre {row['registry'].lower()}, "
                f"pour : {row['purpose']}. Pour accepter, appuyez sur 1. Pour refuser, appuyez sur 2.")
    twiml = twilio_sms.twiml_ask(question, voice_action_url(row["id"]),
                                 "Nous n'avons pas reçu de réponse. Vous pouvez encore répondre au SMS "
                                 "de FasoLink. Au revoir.")
    try:
        sid = twilio_sms.call(account_sid=config.TWILIO_ACCOUNT_SID, auth_token=config.TWILIO_AUTH_TOKEN,
                              to=sms.e164(phone), from_=config.TWILIO_FROM, twiml=twiml,
                              api_key=config.TWILIO_API_KEY, api_secret=config.TWILIO_API_SECRET)
        log.info("Appel de consentement %s vers %s", sid, sms.mask(phone))
        sms.notify_call(phone, "Appel vocal de FasoLink : appuyez sur 1 (OUI) ou 2 (NON).")
    except twilio_sms.TwilioError as exc:
        log.error("Appel de consentement impossible vers %s : %s", sms.mask(phone), exc)


def handle_voice(consent_id, digits: str) -> tuple[str, object]:
    """Touche pressée pendant l'appel ; renvoie (TwiML à lire, demande à exécuter ou None)."""
    with db.tx() as c:
        target = c.execute(_PENDING.format(where="s.id=%s AND s.status='PENDING' AND s.expires_at > now()"),
                           (consent_id,)).fetchone()
        if not target:
            return twilio_sms.twiml_say("Cette demande n'attend plus de réponse. Au revoir."), None
        if digits == "1":
            _grant(c, target, "VOIX")
            return twilio_sms.twiml_say(
                f"Merci. Votre accord a été transmis à {target['admin']}, pour cette demande uniquement. "
                "Au revoir."), target["request_id"]
        if digits == "2":
            _deny(c, target, "REFUSED", "L'usager a refusé l'accès par appel vocal")
            return twilio_sms.twiml_say(
                f"Votre refus est enregistré. {target['admin']} n'aura pas accès à vos données. Au revoir."), None
    return twilio_sms.twiml_say("Touche non reconnue. Vous pouvez répondre au SMS de FasoLink. Au revoir."), None


def run_granted(request_id) -> None:
    """Consulte le registre après l'accord (appelé après la réponse à Twilio)."""
    _run(request_id)


SEND_ATTEMPTS = 3


def deliver(request_id, phone: str, text: str) -> None:
    """Envoie le SMS de demande d'accord (3 essais si le réseau coupe), puis l'appel vocal."""
    for attempt in range(1, SEND_ATTEMPTS + 1):
        try:
            sms.send(phone, text)
            break
        except sms.SmsError as exc:
            if exc.transient and attempt < SEND_ATTEMPTS:
                log.warning("Envoi du SMS, essai %d/%d échoué : nouvel essai", attempt, SEND_ATTEMPTS)
                time.sleep(5 * attempt)
                continue
            send_failed(request_id, f"Accord non demandé : SMS non envoyé ({exc})")
            return
    # Au Burkina, Twilio ne reçoit pas les réponses par SMS : on appelle l'usager,
    # qui répond en appuyant sur 1 ou 2 (option FASOLINK_VOICE_CONSENT=1)
    if config.VOICE_CONSENT and config.SMS_PROVIDER == "twilio" and config.PUBLIC_URL:
        start_call(request_id, phone)


def send_failed(request_id, reason: str) -> None:
    """Le SMS n'a pas pu partir : la demande est refusée tout de suite, motif à l'appui."""
    with db.tx() as c:
        row = c.execute(_PENDING.format(where="s.request_id=%s AND s.status='PENDING'"),
                        (request_id,)).fetchone()
        if row:
            _deny(c, row, "EXPIRED", reason)


def expire_due() -> int:
    """Tâche de fond : sans réponse dans le délai, la demande est refusée."""
    with db.tx() as c:
        rows = c.execute(_PENDING.format(where="s.status='PENDING' AND s.expires_at <= now()")).fetchall()
        for row in rows:
            _deny(c, row, "EXPIRED", "Accord de l'usager non reçu dans le délai (SMS sans réponse)")
    return len(rows)
