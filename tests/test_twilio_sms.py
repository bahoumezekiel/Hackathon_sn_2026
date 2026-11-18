import base64
import hashlib
import hmac

import httpx
import pytest

from gateway import twilio_sms

SID, TOKEN = "AC" + "0" * 32, "secret-token"


def test_send_posts_form_with_basic_auth():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = dict(httpx.QueryParams(request.content.decode()))
        return httpx.Response(201, json={"sid": "SM123"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sid = twilio_sms.send(account_sid=SID, auth_token=TOKEN, to="+22676580321", body="1 = OUI",
                          from_="+15005550006", client=client)
    assert sid == "SM123"
    assert seen["url"].endswith(f"/Accounts/{SID}/Messages.json")
    assert seen["auth"] == "Basic " + base64.b64encode(f"{SID}:{TOKEN}".encode()).decode()
    assert seen["body"] == {"To": "+22676580321", "Body": "1 = OUI", "From": "+15005550006"}


def test_send_error_is_explicit():
    client = httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, json={"code": 21608, "message": "unverified number"})))
    with pytest.raises(twilio_sms.TwilioError, match="21608"):
        twilio_sms.send(account_sid=SID, auth_token=TOKEN, to="+226", body="x", from_="+1", client=client)


def test_send_requires_configuration():
    with pytest.raises(twilio_sms.TwilioError):
        twilio_sms.send(account_sid="", auth_token="", to="+226", body="x")


def test_webhook_signature():
    url = "https://exemple.ngrok-free.app/sms/twilio"
    params = {"From": "+22676580321", "Body": "1", "MessageSid": "SM1"}
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))   # règle de Twilio
    expected = base64.b64encode(hmac.new(TOKEN.encode(), payload.encode(), hashlib.sha1).digest()).decode()
    assert twilio_sms.signature(TOKEN, url, params) == expected
    assert twilio_sms.signature_valid(TOKEN, url, params, expected)
    assert not twilio_sms.signature_valid(TOKEN, url, {**params, "Body": "2"}, expected)
    assert not twilio_sms.signature_valid("", url, params, expected)


def test_call_sends_inline_twiml():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["body"] = dict(httpx.QueryParams(request.content.decode()))
        return httpx.Response(201, json={"sid": "CA123"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    twiml = twilio_sms.twiml_say("Bonjour")
    assert twilio_sms.call(account_sid=SID, auth_token=TOKEN, to="+22665758130", from_="+15107268993",
                           twiml=twiml, client=client) == "CA123"
    assert seen["url"].endswith(f"/Accounts/{SID}/Calls.json")
    assert seen["body"] == {"To": "+22665758130", "From": "+15107268993", "Twiml": twiml}


def test_twiml_ask_waits_for_one_digit_and_escapes():
    xml = twilio_sms.twiml_ask("Casier & <emploi> : appuyez sur 1",
                               "https://x.ngrok-free.app/voix/twilio?consent=abc&y=1", "Au revoir")
    assert xml.count('numDigits="1"') == 2                       # deux essais
    assert 'action="https://x.ngrok-free.app/voix/twilio?consent=abc&amp;y=1"' in xml
    assert "Casier &amp; &lt;emploi&gt;" in xml and 'language="fr-FR"' in xml
    assert xml.endswith("<Say language=\"fr-FR\" voice=\"Polly.Lea\">Au revoir</Say></Response>")


def test_api_key_is_preferred_over_auth_token():
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers["Authorization"]
        return httpx.Response(201, json={"sid": "SM1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    twilio_sms.send(account_sid=SID, auth_token="", api_key="SKkey", api_secret="secret", to="+226",
                    body="x", from_="+1", client=client)
    assert seen["auth"] == "Basic " + base64.b64encode(b"SKkey:secret").decode()
