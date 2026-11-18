"""État des composants du socle technique, affiché dans la supervision."""
from . import crypto, db, policy, resilience
from .auth import keycloak_ready


def _postgres_ready() -> bool:
    try:
        with db.tx() as c:
            c.execute("SELECT 1")
        return True
    except Exception:
        return False


def stack_status() -> list[dict]:
    return [
        {"component": "PostgreSQL", "role": "Base de données", "up": _postgres_ready()},
        {"component": "Keycloak", "role": "Authentification et rôles", "up": keycloak_ready()},
        {"component": "Open Policy Agent", "role": "Moteur de politiques", "up": policy.health()},
        {"component": "Redis", "role": "Cache et résilience", "up": resilience.health()},
        {"component": "Vault", "role": "Chiffrement et secrets", "up": crypto.health()},
    ]
