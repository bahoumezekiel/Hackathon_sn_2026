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
# Compte technique de la passerelle pour créer groupes (structures) et agents
KEYCLOAK_ADMIN_CLIENT = "fasolink-admin-api"
KEYCLOAK_ADMIN_CLIENT_SECRET = _get("FASOLINK_KEYCLOAK_ADMIN_CLIENT_SECRET", "")


def agent_username(admin_code: str) -> str:
    """Compte de démonstration d'une structure : ADMIN_A -> agent-a, CEFORE -> agent-cefore."""
    suffix = admin_code[6:] if admin_code.startswith("ADMIN_") else admin_code
    return f"agent-{suffix.lower().replace('_', '-')}"

# Registres
REGISTRY_TOKEN = _require("FASOLINK_REGISTRY_TOKEN")
REGISTRY_URLS = {
    code: _get(f"FASOLINK_REGISTRY_{code}_URL", default)
    for code, default in (
        ("ETAT_CIVIL", "http://registry-etat-civil:8000"),
        ("NATIONALITE", "http://registry-nationalite:8000"),
        ("CASIER", "http://registry-casier:8000"),
        ("IUE", "http://registry-iue:8000"),
    )
}

# Inscription des citoyens : code à usage unique envoyé au téléphone du registre des IUE
SIGNUP_CODE_TTL_S = int(_get("FASOLINK_SIGNUP_CODE_TTL_S", "600"))
SIGNUP_MAX_ATTEMPTS = 5          # essais de code avant d'annuler l'inscription en cours
SIGNUP_MAX_STARTS = 3            # demandes de code par IUE et par quart d'heure

# Consentement par SMS (usagers sans accès au web)
SMS_CONSENT_TTL_S = int(_get("FASOLINK_SMS_CONSENT_TTL_S", "1800"))   # 30 min pour répondre
SMS_WEBHOOK_TOKEN = _get("FASOLINK_SMS_WEBHOOK_TOKEN", "")            # vide : route opérateur fermée

# Fournisseur SMS : « simulateur » (téléphone simulé, aucun envoi réel) ou « twilio »
SMS_PROVIDER = _get("FASOLINK_SMS_PROVIDER", "simulateur").lower()
TWILIO_ACCOUNT_SID = _get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = _get("TWILIO_AUTH_TOKEN", "")      # sert aussi à vérifier la signature des webhooks
# Clé d'API Twilio (SK…) : recommandée pour les appels à l'API, révocable sans toucher au compte
TWILIO_API_KEY = _get("TWILIO_API_KEY", "")
TWILIO_API_SECRET = _get("TWILIO_API_SECRET", "")
TWILIO_FROM = _get("TWILIO_FROM", "")                                  # numéro Twilio (+1…) ou expéditeur
TWILIO_MESSAGING_SERVICE_SID = _get("TWILIO_MESSAGING_SERVICE_SID", "")   # à la place de TWILIO_FROM
# URL publique EXACTE configurée dans la console Twilio pour les SMS entrants
# (ex. https://xxxx.ngrok-free.app/sms/twilio) : elle sert à vérifier la signature.
TWILIO_WEBHOOK_URL = _get("TWILIO_WEBHOOK_URL", "")
# Appel vocal de consentement (Twilio Voice) : l'usager appuie sur 1 (OUI) ou 2 (NON).
# Au Burkina Faso, Twilio ne reçoit pas les réponses par SMS ; l'appel est bidirectionnel.
VOICE_CONSENT = _get("FASOLINK_VOICE_CONSENT", "0") == "1"
# Adresse publique de la passerelle (ngrok…), sans chemin : Twilio y renvoie la touche pressée
PUBLIC_URL = (_get("FASOLINK_PUBLIC_URL", "") or TWILIO_WEBHOOK_URL.split("/sms/")[0]).rstrip("/")
# Démonstration : vrais numéros pour certains IUE fictifs (même valeur que le registre des IUE)
SMS_DEMO_PHONES = dict(pair.split("=", 1) for pair in _get("FASOLINK_SMS_DEMO_PHONES", "").split(",")
                       if "=" in pair)

DEMO_MODE = _get("FASOLINK_DEMO_MODE", "0") == "1"
ATTESTATION_TTL_S = int(_get("FASOLINK_ATTESTATION_TTL_S", "900"))
CIRCUIT_COOLDOWN_S = int(_get("FASOLINK_CIRCUIT_COOLDOWN_S", "15"))
WORKER_INTERVAL_S = float(_get("FASOLINK_WORKER_INTERVAL_S", "3"))
MAX_RETRIES = int(_get("FASOLINK_MAX_RETRIES", "20"))
