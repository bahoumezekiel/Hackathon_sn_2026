"""Envoi de SMS aux usagers.

Fournisseur choisi par FASOLINK_SMS_PROVIDER :
  « simulateur » (défaut) : aucun envoi réel ; les SMS arrivent sur le téléphone simulé
                            (http://localhost:3002/telephone), où l'usager peut répondre.
  « twilio »              : envoi réel par l'API Twilio ; les réponses arrivent sur
                            POST /sms/twilio (webhook signé).
En mode démonstration, les échanges sont aussi copiés sur le téléphone simulé (Redis, 24 h),
pour les montrer à l'écran. Les numéros ne sont jamais écrits en clair dans les journaux.
"""
import json
import logging
import re
import time

from . import config, crypto, resilience, sms_texte, twilio_sms

log = logging.getLogger("fasolink.sms")
INBOX_TTL_S = 86_400


class SmsError(Exception):
    """L'envoi a échoué (fournisseur injoignable, numéro refusé…)."""

    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


def normalize(phone: str) -> str:
    """+226 70 12 34 56 -> 22670123456"""
    return re.sub(r"\D", "", phone or "")


def e164(phone: str) -> str:
    """+226 70 12 34 56 -> +22670123456 (format exigé par les opérateurs)"""
    return "+" + normalize(phone)


def fingerprint(phone: str) -> bytes:
    return crypto.fingerprint(normalize(phone), "TEL")


def mask(phone: str) -> str:
    """+226 70 12 34 56 -> +226 70 •• •• 56 ; +22670123456 -> +226 •• •• 56"""
    parts = phone.split()
    if len(parts) >= 4:
        return " ".join([*parts[:2], *["••"] * (len(parts) - 3), parts[-1]])
    digits = normalize(phone)
    return f"+{digits[:3]} •• •• {digits[-2:]}" if len(digits) > 6 else "••••"


def _inbox_key(phone: str) -> str:
    return f"{resilience.P}:sms:{normalize(phone)}"


def _store(phone: str, direction: str, text: str) -> None:
    if not config.DEMO_MODE:
        return
    key = _inbox_key(phone)
    resilience.r.rpush(key, json.dumps({"at": time.time(), "direction": direction, "text": text},
                                       ensure_ascii=False))
    resilience.r.ltrim(key, -50, -1)
    resilience.r.expire(key, INBOX_TTL_S)


def send(phone: str, text: str) -> None:
    """Envoie le SMS ; lève SmsError si le fournisseur le refuse.
    Toujours un seul segment sans accents (voir sms_texte) : livraison plus sûre, coût divisé."""
    text = sms_texte.fit(text)
    if config.SMS_PROVIDER == "twilio":
        try:
            sid = twilio_sms.send(account_sid=config.TWILIO_ACCOUNT_SID,
                                  auth_token=config.TWILIO_AUTH_TOKEN, to=e164(phone), body=text,
                                  from_=config.TWILIO_FROM,
                                  messaging_service_sid=config.TWILIO_MESSAGING_SERVICE_SID,
                                  api_key=config.TWILIO_API_KEY, api_secret=config.TWILIO_API_SECRET)
        except twilio_sms.TwilioError as exc:
            log.error("SMS non envoyé au %s : %s", mask(phone), exc)
            raise SmsError(str(exc), transient=exc.transient) from exc
        log.info("SMS Twilio %s envoyé au %s", sid, mask(phone))
    else:
        log.info("SMS simulé envoyé au %s (%d caractères)", mask(phone), len(text))
    _store(phone, "in", text)        # « in » : reçu par le téléphone de l'usager


def notify_call(phone: str, text: str) -> None:
    """Trace d'un appel vocal sur le téléphone simulé (démonstration)."""
    _store(phone, "in", text)


def record_reply(phone: str, text: str) -> None:
    _store(phone, "out", text)       # « out » : envoyé par l'usager


def inbox(phone: str) -> list[dict]:
    return [json.loads(m) for m in resilience.r.lrange(_inbox_key(phone), 0, -1)]


def twilio_request_valid(params: dict, received_signature: str) -> bool:
    return twilio_sms.signature_valid(config.TWILIO_AUTH_TOKEN, config.TWILIO_WEBHOOK_URL,
                                      params, received_signature)
