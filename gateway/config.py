"""Configuration lue depuis l'environnement (fourni par docker-compose.yml)."""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Variable d'environnement {name} manquante (voir docker-compose.yml)")
    return value


def _get(name: str, default: str) -> str:
    return os.environ.get(name) or default


# PostgreSQL
DATABASE_URL = _require("FASOLINK_DATABASE_URL")
ADMIN_DATABASE_URL = _get("FASOLINK_ADMIN_DATABASE_URL", "")

# Redis : disjoncteur, cache du mode dégradé, file de relance
REDIS_URL = _require("FASOLINK_REDIS_URL")

# Open Policy Agent : décisions d'accès
OPA_URL = _get("FASOLINK_OPA_URL", "http://opa:8181")

# Vault (moteur Transit) : chiffrement, empreintes, signature
VAULT_ADDR = _get("FASOLINK_VAULT_ADDR", "http://vault:8200")
VAULT_TOKEN = _require("FASOLINK_VAULT_TOKEN")

# Keycloak : authentification et rôles
KEYCLOAK_URL = _get("FASOLINK_KEYCLOAK_URL", "http://keycloak:8080")            # réseau interne
KEYCLOAK_PUBLIC_URL = _get("FASOLINK_KEYCLOAK_PUBLIC_URL", "http://localhost:8080")  # navigateur
KEYCLOAK_REALM = _get("FASOLINK_KEYCLOAK_REALM", "fasolink")
KEYCLOAK_ISSUER = f"{KEYCLOAK_PUBLIC_URL}/realms/{KEYCLOAK_REALM}"
KEYCLOAK_JWKS_URL = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
KEYCLOAK_AUDIENCE = "fasolink-gateway"
KEYCLOAK_CLI_CLIENT = "fasolink-cli"   # scripts de démo / tests (flux mot de passe)

# Registres
REGISTRY_TOKEN = _require("FASOLINK_REGISTRY_TOKEN")
REGISTRY_URLS = {
    code: _get(f"FASOLINK_REGISTRY_{code}_URL", default)
    for code, default in (
        ("ETAT_CIVIL", "http://registry-etat-civil:8000"),
        ("NATIONALITE", "http://registry-nationalite:8000"),
        ("CASIER", "http://registry-casier:8000"),
    )
}

DEMO_MODE = _get("FASOLINK_DEMO_MODE", "0") == "1"
ATTESTATION_TTL_S = int(_get("FASOLINK_ATTESTATION_TTL_S", "900"))
CIRCUIT_COOLDOWN_S = int(_get("FASOLINK_CIRCUIT_COOLDOWN_S", "15"))
WORKER_INTERVAL_S = float(_get("FASOLINK_WORKER_INTERVAL_S", "3"))
MAX_RETRIES = int(_get("FASOLINK_MAX_RETRIES", "20"))
