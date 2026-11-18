"""Webhooks des opérateurs : réponses des usagers sans accès au web (SMS, appel vocal).

Ces routes ne portent pas de jeton Keycloak : l'appelant est authentifié par un secret
partagé (X-SMS-Token) ou par la signature Twilio (X-Twilio-Signature).
"""
import uuid
from urllib.parse import parse_qsl

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from .. import config, consentement_sms, sms, twilio_sms
from ..schemas import SmsIn

router = APIRouter(tags=["sms"])

_EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


async def _form(request: Request) -> dict:
    return dict(parse_qsl((await request.body()).decode(), keep_blank_values=True))


@router.post("/sms/entrant")
def sms_inbound(body: SmsIn, x_sms_token: str | None = Header(None)):
    """Réponse d'un usager à une demande d'accord (« 1 » = OUI, « 2 » = NON), relayée par
    l'opérateur SMS. Fermée tant que FASOLINK_SMS_WEBHOOK_TOKEN n'est pas configuré."""
    if not config.SMS_WEBHOOK_TOKEN or x_sms_token != config.SMS_WEBHOOK_TOKEN:
        raise HTTPException(403, "Opérateur SMS non authentifié")
    return {"reply": consentement_sms.handle_reply(body.sender, body.text)}


@router.post("/sms/twilio")
async def sms_twilio(request: Request):
    """Webhook Twilio des SMS entrants (« A message comes in », HTTP POST).
    La signature X-Twilio-Signature est vérifiée avec l'URL publique TWILIO_WEBHOOK_URL."""
    params = await _form(request)
    if config.SMS_PROVIDER != "twilio" or \
            not sms.twilio_request_valid(params, request.headers.get("X-Twilio-Signature", "")):
        raise HTTPException(403, "Signature Twilio invalide")
    await run_in_threadpool(consentement_sms.handle_reply, params.get("From", ""), params.get("Body", ""))
    # La confirmation à l'usager part par l'API (sms.send) : la réponse TwiML reste vide
    return Response(_EMPTY_TWIML, media_type="application/xml")


@router.post("/voix/twilio")
async def voice_twilio(request: Request, consent: uuid.UUID, background: BackgroundTasks):
    """Touche pressée par l'usager pendant l'appel de consentement (Twilio <Gather>).
    Répond en TwiML ; le registre n'est consulté qu'après la réponse, en tâche de fond."""
    params = await _form(request)
    url = consentement_sms.voice_action_url(consent)
    if not config.VOICE_CONSENT or not twilio_sms.signature_valid(
            config.TWILIO_AUTH_TOKEN, url, params, request.headers.get("X-Twilio-Signature", "")):
        raise HTTPException(403, "Signature Twilio invalide")
    twiml, granted = await run_in_threadpool(consentement_sms.handle_voice, consent,
                                             params.get("Digits", ""))
    if granted:
        background.add_task(consentement_sms.run_granted, granted)
    return Response(twiml, media_type="application/xml")
