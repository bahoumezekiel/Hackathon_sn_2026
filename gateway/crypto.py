"""Chiffrement, empreintes et signature via Vault (moteur Transit).

Aucune clé cryptographique ne quitte Vault : FasoLink envoie les données à
chiffrer / signer et reçoit le résultat. Seules les clés PUBLIQUES de signature
sont lues, pour vérifier les attestations et publier le JWKS.
"""
import base64
import json
import threading

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from . import config

PII_KEY = "fasolink-pii"
FINGERPRINT_KEY = "fasolink-fingerprint"
SIGNING_KEY = "fasolink-attestation"

_client = httpx.Client(base_url=config.VAULT_ADDR, timeout=5,
                       headers={"X-Vault-Token": config.VAULT_TOKEN})


class VaultError(RuntimeError):
    pass


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _transit(path: str, payload: dict) -> dict:
    try:
        resp = _client.post(f"/v1/transit/{path}", json=payload)
    except httpx.HTTPError as exc:
        raise VaultError(f"Vault injoignable ({type(exc).__name__})") from exc
    if resp.status_code >= 400:
        raise VaultError(f"Vault a refusé {path} (HTTP {resp.status_code})")
    return resp.json()["data"]


# --------------------------------------------------------------- chiffrement

def encrypt(plaintext: str) -> bytes:
    """Renvoie le chiffré Vault (« vault:v1:… ») encodé en octets, pour BYTEA."""
    return _transit(f"encrypt/{PII_KEY}", {"plaintext": _b64(plaintext.encode())})["ciphertext"].encode()


def decrypt(blob) -> str:
    data = _transit(f"decrypt/{PII_KEY}", {"ciphertext": bytes(blob).decode()})
    return base64.b64decode(data["plaintext"]).decode()


def key_version(blob) -> str:
    """Version de clé contenue dans un chiffré Vault : « vault:v1:… » -> « v1 »."""
    return bytes(blob).decode().split(":")[1]


def fingerprint(value: str, namespace: str) -> bytes:
    """HMAC-SHA256 déterministe, pour rechercher un identifiant sans le déchiffrer.
    Le namespace (IUE, ETAT_CIVIL…) évite les collisions entre référentiels."""
    data = f"{namespace}|{value.strip().upper()}".encode()
    mac = _transit(f"hmac/{FINGERPRINT_KEY}/sha2-256", {"input": _b64(data)})["hmac"]
    return base64.b64decode(mac.split(":", 2)[2])


# --------------------------------------------------------------- signature (JWS EdDSA)

_public_keys: dict[str, Ed25519PublicKey] = {}
_latest_version = 0
_lock = threading.Lock()


def _load_signing_keys() -> None:
    global _latest_version
    try:
        resp = _client.get(f"/v1/transit/keys/{SIGNING_KEY}")
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise VaultError("Clés de signature indisponibles dans Vault") from exc
    data = resp.json()["data"]
    with _lock:
        for version, info in data["keys"].items():
            raw = base64.b64decode(info["public_key"])
            _public_keys[f"{SIGNING_KEY}-v{version}"] = Ed25519PublicKey.from_public_bytes(raw)
        _latest_version = int(data["latest_version"])


def _ensure_keys() -> None:
    if not _latest_version:
        _load_signing_keys()


def sign(payload: dict) -> str:
    _ensure_keys()
    version = _latest_version
    header = {"alg": "EdDSA", "typ": "JWT", "kid": f"{SIGNING_KEY}-v{version}"}
    signing_input = (_b64url(json.dumps(header, separators=(",", ":")).encode()) + "."
                     + _b64url(json.dumps(payload, separators=(",", ":"), default=str).encode()))
    sig = _transit(f"sign/{SIGNING_KEY}", {"input": _b64(signing_input.encode()),
                                            "key_version": version})["signature"]
    return f"{signing_input}.{_b64url(base64.b64decode(sig.split(':', 2)[2]))}"


def verify(token: str) -> dict:
    _ensure_keys()
    kid = jwt.get_unverified_header(token).get("kid", "")
    if kid not in _public_keys:
        _load_signing_keys()  # rotation de clé : recharger
    key = _public_keys.get(kid)
    if key is None:
        raise jwt.InvalidKeyError("Clé de signature inconnue")
    return jwt.decode(token, key, algorithms=["EdDSA"], options={"verify_aud": False})


def signing_key_id() -> str:
    _ensure_keys()
    return f"{SIGNING_KEY}-v{_latest_version}"


def jwks() -> dict:
    _ensure_keys()
    from cryptography.hazmat.primitives import serialization
    keys = []
    for kid, key in _public_keys.items():
        raw = key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        keys.append({"kty": "OKP", "crv": "Ed25519", "x": _b64url(raw), "kid": kid,
                     "alg": "EdDSA", "use": "sig"})
    return {"keys": keys}


def health() -> bool:
    try:
        return _client.get("/v1/sys/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False
