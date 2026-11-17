# FasoLink

Socle d'interopérabilité administrative pour le Challenge 2 « Dites-le nous une fois ».
Les pièces circulent entre administrations, pas les usagers entre guichets.

## Stack technique (conforme à la fiche technique)

| Composant | Technologie | Rôle dans FasoLink |
|---|---|---|
| Base de données | **PostgreSQL 16** | Identités chiffrées, politiques, demandes, attestations, journal d'audit chaîné (append-only imposé par des triggers) |
| API d'interopérabilité | **FastAPI** | Passerelle : API pure, sans écrans |
| Interfaces | **React 19 + Vite 8** | 3 applications, une par rôle, dans un workspace npm (`frontend/`) qui partage le socle visuel, l'authentification et le client API. Servies par nginx (relais `/api`, CSP stricte) |
| Authentification et rôles | **Keycloak 26** | Realm `fasolink`. Rôles `agent`, `supervisor` et `citizen`. Une administration correspond à un groupe Keycloak. Un client public par portail (*Authorization Code + PKCE S256*, imposé). Clients machine `admin-a` à `admin-d` (*client credentials*) |
| Moteur de politiques | **Open Policy Agent 1.0** | [policies/fasolink.rego](policies/fasolink.rego) : finalité, justification, prédicats, consentement. La passerelle refuse tout accès si OPA ne répond pas. Les décisions sont journalisées |
| Cache et résilience | **Redis 7.4** | Disjoncteurs partagés, cache du mode dégradé (prédicats uniquement), file de relance. PostgreSQL fait foi : si Redis perd sa file, elle est reconstruite |
| Chiffrement et secrets | **Vault 1.18** (Transit) | Chiffrement AES-GCM de l'IUE et des références locales, empreintes HMAC, signature Ed25519 des attestations. **Aucune clé ne sort de Vault** ; la passerelle a un jeton à privilèges minimaux |
| Conteneurisation | **Docker Compose** | 15 services (dont 2 tâches d'initialisation), démarrage en une commande |
| Documentation API | **Swagger** | http://127.0.0.1:8000/docs, bouton *Authorize* pour coller un jeton Keycloak |

## Démarrage

Prérequis : Docker Desktop (WSL 2 sous Windows), Python 3.12+ pour les scripts (`pip install httpx` pour `demo_epreuve.py`). Node.js 22.12+ seulement pour développer les interfaces hors Docker.

```powershell
python scripts/init_env.py          # une fois : secrets aléatoires (.env) + realm Keycloak
docker compose up -d --build        # environ 1 minute (Keycloak est le plus long)
python scripts/demo_epreuve.py      # rejoue l'épreuve : 28 vérifications
```

| Application | Adresse | Compte de démo (mot de passe `demo`) |
|---|---|---|
| **Portail administration** | http://localhost:3001 | `agent-a`, `agent-b`, `agent-c` (un cas de l'épreuve chacun) ou `agent-d` (Direction des concours : dossier complet, 3 pièces) |
| **Portail citoyen** | http://localhost:3002 | IUE en minuscules (`bf1998000123`), ou référence d'état civil sans IUE (`ec-fdg-2001-000222`) |
| **Portail supervision** | http://localhost:3003 | `superviseur` |
| API (Swagger) | http://localhost:8000/docs | jeton Keycloak |
| Console Keycloak | http://localhost:8080 | `admin` / `KEYCLOAK_ADMIN_PASSWORD` dans `.env` |

Utilisez `localhost` (et non `127.0.0.1`) : c'est l'adresse déclarée dans Keycloak.

**Plusieurs rôles en même temps :** la session Keycloak est partagée par tous les onglets d'un même navigateur. Pour montrer les trois rôles côte à côte, ouvrez chaque portail dans un profil ou une fenêtre privée différente. Sinon, chaque portail propose « se connecter avec un autre compte » quand le rôle ne correspond pas.

### Interfaces : configuration et démarrage

Les trois portails et la page de connexion n'ont rien à configurer pour la démonstration : `docker compose up -d --build` construit une image nginx par portail à partir du workspace `frontend/`.

| Réglage | Où | Rôle |
|---|---|---|
| `VITE_KEYCLOAK_URL` | argument de build (`frontend/Dockerfile`, défaut `http://localhost:8080`) | Adresse de Keycloak vue par le navigateur, intégrée au JavaScript |
| `KEYCLOAK_URL` | environnement du conteneur (`docker-compose.yml`) | Même adresse, autorisée par la politique de sécurité du contenu (CSP) de nginx. Doit être identique à `VITE_KEYCLOAK_URL` |
| `FASOLINK_DEMO_MODE` | environnement de la passerelle | `1` : usagers fictifs, case « Démonstration » et simulation de panne visibles. `0` : tout cela disparaît des interfaces |
| Thème de connexion | `infra/keycloak/themes/fasolink/` | Monté dans Keycloak ; activé par `scripts/init_env.py` (`loginTheme`), avec la langue française et la protection contre les essais de mots de passe |

**Reconstruire un seul portail** sans réinitialiser la base :

```powershell
docker compose up -d --build --no-deps portal-citizen     # ou portal-agent, portal-supervision
```

**Développer une interface avec rechargement à chaud** (le reste de la plateforme tourne dans Docker) :

```powershell
docker compose stop portal-agent          # libère le port 3001
cd frontend
npm install                               # une fois, installe les trois portails et le socle partagé
npm run dev -w agent                      # http://localhost:3001 ; citizen → 3002, supervision → 3003
npm run build -w agent                    # vérifie la compilation de production
```

Vite relaie `/api` vers la passerelle (`localhost:8000`), comme nginx en production. Le code commun (styles, polices, session Keycloak, client API, composants) est dans `frontend/shared/` : une modification s'applique aux trois portails.

**Modifier la page de connexion :** Keycloak tourne en mode développement, sans cache de thème. Il suffit de modifier les fichiers de `infra/keycloak/themes/fasolink/login/` puis de recharger la page. Après une modification du realm dans `scripts/init_env.py`, relancez le script, puis `docker compose up -d --force-recreate keycloak`.

**Dépannage**

- *`vault-init` échoue avec « illegal option »* : un script a été extrait avec des fins de ligne Windows. Le fichier `.gitattributes` l'évite. Sur un clone existant : `git add --renormalize .` puis `git checkout -- .`.
- *Boucle de connexion, ou « Invalid redirect uri »* : utilisez `localhost`, pas `127.0.0.1`.
- *Port 3001 à 3003 déjà occupé* : un serveur `npm run dev` tourne encore ; arrêtez-le, ou arrêtez le conteneur du portail correspondant.
- *Compte bloqué après plusieurs erreurs de mot de passe* : attendez une minute, ou débloquez-le dans la console Keycloak (realm `fasolink`, Utilisateurs).
- *Micro de l'assistant inactif* : la reconnaissance vocale fonctionne dans Chrome et Edge, sur `localhost` ou en HTTPS, après autorisation du micro.

**Jeton machine** (système d'information d'une administration) :

```powershell
curl -X POST http://localhost:8080/realms/fasolink/protocol/openid-connect/token `
  -d grant_type=client_credentials -d client_id=admin-a -d client_secret=<ADMIN_A_CLIENT_SECRET du .env>
```

**Autres commandes :**
- Tests : `python -m pytest` pour les prédicats ;
- `docker run --rm -v ${PWD}/policies:/policies openpolicyagent/opa:1.0.0 test /policies -v` pour les 9 tests de politique ;
- Arrêt : `docker compose down`. Toutes les données sont réinitialisées au prochain démarrage.

## Ce qui répond à l'épreuve en direct

| Exigence | Mécanisme |
|---|---|
| **Ne transmettre que l'utile** | L'administration demande un *prédicat* (`est_majeur`), pas un attribut. FasoLink lit la date de naissance et ne renvoie que « Majeur : Oui ». La réponse est signée par Vault, vérifiable par tous via `/.well-known/jwks.json`, liée à l'administration et à la finalité, et valable 15 minutes. OPA décide avant toute lecture. |
| **Montrer à l'usager qui a consulté ses données** | Le citoyen se connecte par Keycloak. Il voit qui a consulté ses données, quand, pourquoi, ce qui a été transmis, ce qui a été lu sans être transmis, et les tentatives refusées. Le journal est chaîné par SHA-256. Il peut signaler un accès, aussi à la voix. |
| **Tenir quand un registre tombe** | 1) Un disjoncteur Redis s'ouvre après 3 échecs. 2) Une réponse de moins de 24 h est réutilisée depuis le cache Redis si la politique l'autorise ; c'est interdit pour le casier. 3) Sinon, la demande part dans la file Redis et se relance automatiquement. Les autres registres continuent de répondre. |

## Scénario pour le jury (environ 5 minutes)

1. **Supervision** : montrez le *socle technique* (5 composants en vert).
2. **Administration** (`agent-a`) → usager fictif *Awa Ouédraogo*, « Interroger le registre » : **Majeur : Oui**. Cliquez « Vérifier la signature » sous la réponse.
   - **Dossier complet** (`agent-d`) : choisir *Awa Ouédraogo*, laisser les 3 pièces cochées, « Vérifier les 3 pièces » : acte de naissance, certificat de nationalité et extrait de casier répondent **Oui** en une seule action. Dans l'espace citoyen d'Awa ouvert à côté, chaque consultation déclenche une notification en moins de 3 secondes (cloche + alerte, et notification du système si elle est activée).
3. Cochez la case *Démonstration* (« demander aussi Nationalité burkinabè ») → **refus OPA** pour la nationalité, la majorité reste accordée.
4. **Citoyen** → `bf1998000123` / `demo` : les accès apparaissent en direct. Assistant vocal : « Qui a consulté mes données ? », puis « Je veux signaler le dernier accès ».
5. **Supervision** → l'alerte arrive : « Prendre en charge », puis « Résoudre » avec une note. Cliquez « Simuler une panne » sur l'état civil.
6. **Administration** → Awa : **mode dégradé**. *Adama* : **en attente**.
7. **Supervision** → « Rétablir le registre » : la carte d'Adama se met à jour toute seule.

## Organisation du code

```
docker-compose.yml     postgres, redis, keycloak, opa, vault, registres, passerelle, 3 portails
gateway/               FastAPI : API d'interopérabilité
  main.py              Routes + tâche de fond (santé des registres, relances)
  auth.py              Validation des jetons Keycloak (JWKS, rôles, groupe = administration)
  policy.py            Collecte des faits + appel à OPA
  crypto.py            Vault Transit : chiffrement, HMAC, signature JWS EdDSA
  resilience.py        Redis : disjoncteur (scripts Lua atomiques), cache, file de relance
  service.py           Pipeline : identité → OPA → registre → minimisation → attestation → audit
  predicates.py        Moteur de minimisation
  registry_client.py   Appels aux registres derrière le disjoncteur
policies/              Règles OPA (.rego) et leurs tests
registries-mock/       3 registres simulés + citoyens fictifs (remplaçables par ceux du jury)
frontend/              Workspace npm des portails React (une image Docker par portail)
  shared/              Socle commun : styles et polices, session Keycloak, client API, composants
  agent/               Écran de l'administration demandeuse                → :3001
  citizen/             Historique des accès, assistant vocal, consentements → :3002
  supervision/         Registres, socle, flux, alertes, intégrité du journal → :3003
  nginx/               Configuration nginx des portails (relais /api, en-têtes de sécurité)
db/migrations/         Schéma PostgreSQL
infra/vault/           Configuration de Vault (clés Transit, politique de la passerelle)
infra/keycloak/        Realm généré par scripts/init_env.py (non versionné)
  themes/fasolink/     Thème de la page de connexion (FreeMarker + CSS, polices OFL embarquées)
scripts/               init_env, seed_demo, demo_epreuve
```

Chaque portail est une application autonome : son propre `package.json`, son client Keycloak, son image Docker (build Node, puis nginx) et son identité visuelle. Le seul point commun entre les trois est l'API.

## Limites de cette version de démonstration

- **Vault en mode dev** (en mémoire) et **Keycloak en `start-dev`** : la plateforme est entièrement réinitialisée à chaque démarrage. En production : Vault scellé avec stockage persistant, Keycloak en mode `start` avec TLS et base PostgreSQL.
- **Connexion :** les portails utilisent déjà *Authorization Code + PKCE*. Seul le client `fasolink-cli`, réservé aux scripts de démo, garde le flux « mot de passe ». En production : HTTPS partout, et fédération avec l'identité nationale pour les citoyens.
- **Mode démonstration :** il expose la liste des comptes de démo et la simulation de panne. Mettez `FASOLINK_DEMO_MODE=0` hors démo.
- **Assistant vocal :** basé sur des règles, en français (Web Speech API, Chrome ou Edge).

## Brancher les registres du jury

1. Remplacer les services `registry-*` dans `docker-compose.yml`, ou renseigner `FASOLINK_REGISTRY_<CODE>_URL`.
2. Adapter les noms de champs dans `gateway/predicates.py` et, si besoin, `fetch_record` dans `gateway/registry_client.py`.
3. Enrôler leurs citoyens sur le modèle de `scripts/seed_demo.py`.
