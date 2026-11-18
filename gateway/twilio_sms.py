"""Client Twilio minimal (API REST, sans SDK) : SMS, appels vocaux (TwiML) et webhooks signés.

  Envoi    : POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
  Réception: Twilio appelle notre URL publique (POST, formulaire) avec From, Body…
             signé par X-Twilio-Signature = Base64(HMAC-SHA1(auth_token,
             URL + concaténation triée des paramètres « clé+valeur »)).
Aucune dépendance à la configuration : testable seul (tests/test_twilio_sms.py).
"""
import base64
import hashlib
import hmac
from xml.sax.saxutils import escape

import httpx

API = "https://api.twilio.com/2010-04-01"


class TwilioError(Exception):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient   # coupure réseau : un nouvel essai peut réussir


def _auth(account_sid: str, auth_token: str, api_key: str, api_secret: str) -> tuple[str, str]:
    """Clé d'API (recommandée par Twilio, révocable seule) ou, à défaut, SID + jeton principal."""
    return (api_key, api_secret) if api_key and api_secret else (account_sid, auth_token)


def send(*, account_sid: str, auth_token: str, to: str, body: str, from_: str = "",
         messaging_service_sid: str = "", api_key: str = "", api_secret: str = "",
         client: httpx.Client | None = None) -> str:
    """Envoie un SMS ; renvoie l'identifiant Twilio du message (SM…)."""
    if not account_sid or not (auth_token or api_secret) or not (from_ or messaging_service_sid):
        raise TwilioError("Twilio non configuré (SID, jeton ou clé d'API, et numéro d'envoi requis)")
    data = {"To": to, "Body": body}
    if messaging_service_sid:
        data["MessagingServiceSid"] = messaging_service_sid
    else:
        data["From"] = from_
    http = client or httpx.Client(timeout=10)
    try:
        resp = http.post(f"{API}/Accounts/{account_sid}/Messages.json", data=data,
                         auth=_auth(account_sid, auth_token, api_key, api_secret))
    except httpx.HTTPError as exc:
        raise TwilioError(f"Twilio injoignable ({type(exc).__name__})", transient=True) from exc
    if resp.status_code >= 400:
        try:
            err = resp.json()
            detail = f"{err.get('code')} : {err.get('message')}"
        except ValueError:
            detail = f"HTTP {resp.status_code}"
        raise TwilioError(f"Twilio a refusé l'envoi ({detail})")
    return resp.json().get("sid", "")


def call(*, account_sid: str, auth_token: str, to: str, from_: str, twiml: str,
         api_key: str = "", api_secret: str = "", client: httpx.Client | None = None) -> str:
    """Passe un appel vocal dont le déroulé est décrit en TwiML ; renvoie l'identifiant (CA…)."""
    if not account_sid or not (auth_token or api_secret) or not from_:
        raise TwilioError("Twilio non configuré (SID, jeton ou clé d'API, et numéro d'appel requis)")
    http = client or httpx.Client(timeout=10)
    try:
        resp = http.post(f"{API}/Accounts/{account_sid}/Calls.json",
                         data={"To": to, "From": from_, "Twiml": twiml},
                         auth=_auth(account_sid, auth_token, api_key, api_secret))
    except httpx.HTTPError as exc:
        raise TwilioError(f"Twilio injoignable ({type(exc).__name__})", transient=True) from exc
    if resp.status_code >= 400:
        try:
            err = resp.json()
            detail = f"{err.get('code')} : {err.get('message')}"
        except ValueError:
            detail = f"HTTP {resp.status_code}"
        raise TwilioError(f"Twilio a refusé l'appel ({detail})")
    return resp.json().get("sid", "")


VOICE = 'language="fr-FR" voice="Polly.Lea"'   # voix française naturelle (Amazon Polly via Twilio)


def twiml_say(text: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Say {VOICE}>{escape(text)}</Say></Response>'


def twiml_ask(question: str, action_url: str, no_answer: str) -> str:
    """Lit la question et attend UNE touche (deux essais), envoyée en POST à action_url."""
    gather = (f'<Gather input="dtmf" numDigits="1" timeout="8" action="{escape(action_url)}" method="POST">'
              f'<Say {VOICE}>{escape(question)}</Say></Gather>')
    return (f'<?xml version="1.0" encoding="UTF-8"?><Response>{gather}{gather}'
            f'<Say {VOICE}>{escape(no_answer)}</Say></Response>')


def signature(auth_token: str, url: str, params: dict) -> str:
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def signature_valid(auth_token: str, url: str, params: dict, received: str) -> bool:
    if not auth_token or not url or not received:
        return False
    return hmac.compare_digest(signature(auth_token, url, params), received)
