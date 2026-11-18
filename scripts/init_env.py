"""Prépare la plateforme : secrets aléatoires (.env) et realm Keycloak.

    python scripts/init_env.py           # une seule fois
    python scripts/init_env.py --force   # régénérer tous les secrets

Ni .env ni infra/keycloak/realm-fasolink.json ne doivent être versionnés.
"""
import argparse
import json
import pathlib
import secrets
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
REALM = ROOT / "infra" / "keycloak" / "realm-fasolink.json"
DEMO_PASSWORD = "demo"  # comptes de démonstration uniquement
# Structures livrées avec la démo (les autres sont créées depuis le portail Supervision)
ADMINS = {"ADMIN_A": "Administration A", "ADMIN_B": "Administration B", "ADMIN_C": "Administration C",
          "CEFORE": "Centre de formalités des entreprises"}
ADMIN_API_CLIENT = "fasolink-admin-api"   # compte de service de la passerelle (groupes et agents)


def agent_username(code: str) -> str:  # identique à gateway.config.agent_username
    suffix = code[6:] if code.startswith("ADMIN_") else code
    return f"agent-{suffix.lower().replace('_', '-')}"


def client_id_of(code: str) -> str:  # ADMIN_A -> admin-a, CEFORE -> cefore
    return code.lower().replace("_", "-")

parser = argparse.ArgumentParser()
parser.add_argument("--force", action="store_true")
args = parser.parse_args()


def read_env() -> dict:
    if not ENV.exists():
        return {}
    pairs = (line.split("=", 1) for line in ENV.read_text(encoding="utf-8").splitlines()
             if "=" in line and not line.startswith("#"))
    return {k.strip(): v.strip() for k, v in pairs}


env = {} if args.force else read_env()
if "POSTGRES_PASSWORD" not in env:  # .env absent, ancien format, ou --force
    env = {
        "POSTGRES_PASSWORD": secrets.token_urlsafe(18),
        "REDIS_PASSWORD": secrets.token_urlsafe(18),
        "VAULT_ROOT_TOKEN": secrets.token_urlsafe(18),
        "VAULT_GATEWAY_TOKEN": secrets.token_urlsafe(18),
        "KEYCLOAK_ADMIN_PASSWORD": secrets.token_urlsafe(12),
        "FASOLINK_REGISTRY_TOKEN": secrets.token_urlsafe(24),
        "FASOLINK_ADMIN_API_SECRET": secrets.token_urlsafe(24),
        **{f"{code}_CLIENT_SECRET": secrets.token_urlsafe(24) for code in ADMINS},
    }
    ENV.write_text("# Généré par scripts/init_env.py — NE PAS VERSIONNER\n"
                   + "\n".join(f"{k}={v}" for k, v in env.items()) + "\n", encoding="utf-8")
    print(f"Secrets générés : {ENV}")
else:
    print(f"Secrets existants conservés : {ENV}")
    # Administration ajoutée depuis la génération du .env : on complète sans toucher au reste
    wanted = ["FASOLINK_ADMIN_API_SECRET", *(f"{code}_CLIENT_SECRET" for code in ADMINS)]
    added = {k: secrets.token_urlsafe(24) for k in wanted if k not in env}
    if added:
        with ENV.open("a", encoding="utf-8") as f:
            f.writelines(f"{k}={v}\n" for k, v in added.items())
        env.update(added)
        print(f"Secrets ajoutés : {', '.join(added)}")


# ------------------------------------------------------------------ realm Keycloak
def mappers():
    return [
        {"name": "administrations", "protocol": "openid-connect",
         "protocolMapper": "oidc-group-membership-mapper",
         "config": {"claim.name": "groups", "full.path": "false", "access.token.claim": "true",
                    "id.token.claim": "false", "userinfo.token.claim": "false",
                    "introspection.token.claim": "true"}},
        {"name": "audience-fasolink", "protocol": "openid-connect",
         "protocolMapper": "oidc-audience-mapper",
         "config": {"included.custom.audience": "fasolink-gateway", "access.token.claim": "true",
                    "id.token.claim": "false", "introspection.token.claim": "true"}},
    ]


def user(username, first, last, roles, groups=()):
    return {"username": username, "enabled": True, "emailVerified": True,
            "firstName": first, "lastName": last, "email": f"{username}@demo.fasolink.bf",
            "credentials": [{"type": "password", "value": DEMO_PASSWORD, "temporary": False}],
            "realmRoles": list(roles), "groups": [f"/{g}" for g in groups]}


citizens = json.loads((ROOT / "registries-mock" / "data" / "citoyens_fictifs.json")
                      .read_text(encoding="utf-8"))

# Un client public par portail React : Authorization Code + PKCE (S256), pas de mot de passe direct
PORTALS = {"portal-agent": ("Portail administration", 3001),
           "portal-citizen": ("Portail citoyen", 3002),
           "portal-supervision": ("Portail supervision", 3003)}
clients = [{
    "clientId": client_id, "name": label, "publicClient": True, "baseUrl": f"http://localhost:{port}",
    "standardFlowEnabled": True, "directAccessGrantsEnabled": False,
    "redirectUris": [f"http://localhost:{port}/*", f"http://127.0.0.1:{port}/*"],
    "webOrigins": [f"http://localhost:{port}", f"http://127.0.0.1:{port}"],
    "attributes": {"pkce.code.challenge.method": "S256",
                   "post.logout.redirect.uris": f"http://localhost:{port}/*##http://127.0.0.1:{port}/*"},
    "protocolMappers": mappers(),
} for client_id, (label, port) in PORTALS.items()]
# Client des scripts de démonstration et des tests (flux mot de passe, sans navigateur)
clients.append({
    "clientId": "fasolink-cli", "name": "Scripts de démonstration", "publicClient": True,
    "standardFlowEnabled": False, "directAccessGrantsEnabled": True,
    "protocolMappers": mappers(),
})
users = []
for code, name in ADMINS.items():
    client_id = client_id_of(code)
    clients.append({
        "clientId": client_id, "name": f"Système d'information — {name}",
        "publicClient": False, "secret": env[f"{code}_CLIENT_SECRET"],
        "serviceAccountsEnabled": True, "standardFlowEnabled": False,
        "directAccessGrantsEnabled": False, "protocolMappers": mappers(),
    })
    users.append({"username": f"service-account-{client_id}", "enabled": True,
                  "serviceAccountClientId": client_id, "realmRoles": ["agent"],
                  "groups": [f"/{code}"]})
    users.append(user(agent_username(code), "Agent", name, ["agent"], [code]))
users.append(user("superviseur", "Délégué", "Protection des données", ["supervisor"]))
users.append(user("admin-fasolink", "Administrateur", "Référentiel FasoLink", ["platform_admin"]))
# Compte de service de la passerelle : gère uniquement utilisateurs et groupes du realm
clients.append({
    "clientId": ADMIN_API_CLIENT, "name": "Passerelle FasoLink — gestion des structures et des agents",
    "publicClient": False, "secret": env["FASOLINK_ADMIN_API_SECRET"],
    "serviceAccountsEnabled": True, "standardFlowEnabled": False, "directAccessGrantsEnabled": False,
})
users.append({"username": f"service-account-{ADMIN_API_CLIENT}", "enabled": True,
              "serviceAccountClientId": ADMIN_API_CLIENT,
              "clientRoles": {"realm-management": ["manage-users", "view-users", "query-users",
                                                   "query-groups", "view-realm"]}})
for c in citizens:
    if c.get("compte") is False:  # créera son compte lui-même (inscription avec son IUE)
        continue
    # Identifiant de connexion : IUE, ou référence d'état civil pour les citoyens sans IUE
    login = (c.get("iue") or c["etat_civil"]["ref"]).lower()
    users.append(user(login, c["prenoms"], c["nom"], ["citizen"]))

def _attribute(name, label, validations, required=False):
    attr = {"name": name, "displayName": label, "validations": validations,
            "permissions": {"view": ["admin", "user"], "edit": ["admin", "user"]}, "multivalued": False}
    if required:
        attr["required"] = {"roles": ["admin", "user"]}
    return attr


# Profil utilisateur : e-mail FACULTATIF. Un citoyen s'inscrit avec son IUE et son téléphone,
# un agent peut être créé sans e-mail ; sinon Keycloak bloque la connexion (« profil incomplet »).
USER_PROFILE = {
    "attributes": [
        _attribute("username", "${username}", {"length": {"min": 3, "max": 255},
                                               "username-prohibited-characters": {},
                                               "up-username-not-idn-homograph": {}}),
        _attribute("email", "${email}", {"email": {}, "length": {"max": 255}}),
        _attribute("firstName", "${firstName}", {"length": {"max": 255}, "person-name-prohibited-characters": {}}, True),
        _attribute("lastName", "${lastName}", {"length": {"max": 255}, "person-name-prohibited-characters": {}}, True),
    ],
    "groups": [{"name": "user-metadata", "displayHeader": "User metadata",
                "displayDescription": "Attributes, which refer to user metadata"}],
}

realm = {
    "realm": "fasolink", "enabled": True, "displayName": "FasoLink",
    "components": {"org.keycloak.userprofile.UserProfileProvider": [{
        "providerId": "declarative-user-profile", "subComponents": {},
        "config": {"kc.user.profile.config": [json.dumps(USER_PROFILE, ensure_ascii=False)]},
    }]},
    "accessTokenLifespan": 900, "sslRequired": "none",
    "loginTheme": "fasolink",  # infra/keycloak/themes/fasolink
    "internationalizationEnabled": True, "supportedLocales": ["fr"], "defaultLocale": "fr",
    # Protection contre les essais de mots de passe en série (blocage temporaire, croissant)
    "bruteForceProtected": True, "failureFactor": 5, "waitIncrementSeconds": 60,
    "maxFailureWaitSeconds": 900, "permanentLockout": False,
    "roles": {"realm": [
        {"name": "agent", "description": "Agent ou système d'une administration demandeuse"},
        {"name": "supervisor", "description": "Supervision et protection des données"},
        {"name": "citizen", "description": "Citoyen consultant ses données"},
        {"name": "platform_admin", "description": "Administrateur du référentiel : structures, agents, cas d'usage"},
    ]},
    "groups": [{"name": code, "attributes": {"label": [name]}} for code, name in ADMINS.items()],
    "clients": clients,
    "users": users,
}
REALM.parent.mkdir(parents=True, exist_ok=True)
REALM.write_text(json.dumps(realm, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Realm Keycloak généré : {REALM} ({len(users)} comptes, mot de passe de démo « {DEMO_PASSWORD} »)")
sys.exit(0)
