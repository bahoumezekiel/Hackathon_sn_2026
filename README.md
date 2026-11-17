# FasoLink

Socle d'interopérabilité administrative pour le Challenge 2 « Dites-le nous une fois ».
Les pièces circulent entre administrations, pas les usagers entre guichets.

## Stack technique (conforme à la fiche technique)

| Composant | Technologie | Rôle dans FasoLink |
|---|---|---|
| Base de données | **PostgreSQL 16** | Identités chiffrées, politiques, demandes, attestations, journal d'audit chaîné (append-only imposé par des triggers) |
| API d'interopérabilité | **FastAPI** | Passerelle : API pure, sans écrans |
| Interfaces | **React 18 + Vite** | 3 applications indépendantes, une par rôle, servies par nginx (qui relaie `/api` vers la passerelle). Design system commun dans [design/](design/) : jetons CSS, police Noto Sans auto-hébergée, icônes `lucide-react` |
| Authentification et rôles | **Keycloak 26** | Realm `fasolink`. Rôles `agent`, `supervisor` et `citizen`. Une administration correspond à un groupe Keycloak. Un client public par portail (*Authorization Code + PKCE S256*, imposé). Clients machine `admin-a`, `admin-b` et `admin-c` (*client credentials*) |
| Moteur de politiques | **Open Policy Agent 1.0** | [policies/fasolink.rego](policies/fasolink.rego) : finalité, justification, prédicats, consentement. La passerelle refuse tout accès si OPA ne répond pas. Les décisions sont journalisées |
| Cache et résilience | **Redis 7.4** | Disjoncteurs partagés, cache du mode dégradé (prédicats uniquement), file de relance. PostgreSQL fait foi : si Redis perd sa file, elle est reconstruite |
| Chiffrement et secrets | **Vault 1.18** (Transit) | Chiffrement AES-GCM de l'IUE et des références locales, empreintes HMAC, signature Ed25519 des attestations. **Aucune clé ne sort de Vault** ; la passerelle a un jeton à privilèges minimaux |
| Conteneurisation | **Docker Compose** | 15 services (dont 2 tâches d'initialisation), démarrage en une commande |
| Documentation API | **Swagger** | http://127.0.0.1:8000/docs, bouton *Authorize* pour coller un jeton Keycloak |

## Démarrage

Prérequis : Docker Desktop, Python 3.12+ (uniquement pour les scripts).

```powershell
python scripts/init_env.py          # une fois : secrets aléatoires (.env) + realm Keycloak
docker compose up -d --build        # environ 1 minute (Keycloak est le plus long)
python scripts/demo_epreuve.py      # rejoue l'épreuve et les 4 cas d'usage : 46 vérifications
```

| Application | Adresse | Compte de démo (mot de passe `demo`) |
|---|---|---|
| **Portail administration** | http://localhost:3001 | `agent-a`, `agent-b`, `agent-c`, `agent-recrutement`, `agent-concours`, `agent-casier`, `agent-nationalite` |
| **Portail citoyen** | http://localhost:3002 | IUE en minuscules (`bf1998000123`), ou référence d'état civil sans IUE (`ec-fdg-2001-000222`) |
| **Portail supervision** | http://localhost:3003 | `superviseur` |
| API (Swagger) | http://localhost:8000/docs | jeton Keycloak |
| Console Keycloak | http://localhost:8080 | `admin` / `KEYCLOAK_ADMIN_PASSWORD` dans `.env` |

Utilisez `localhost` (et non `127.0.0.1`) : c'est l'adresse déclarée dans Keycloak.

**Plusieurs rôles en même temps :** la session Keycloak est partagée par tous les onglets d'un même navigateur. Pour montrer les trois rôles côte à côte, ouvrez chaque portail dans un profil ou une fenêtre privée différente. Sinon, chaque portail propose « se connecter avec un autre compte » quand le rôle ne correspond pas.

**Développer un portail sans Docker** (la passerelle et Keycloak doivent tourner) : `cd portal-agent && npm install && npm run dev`. Vite relaie `/api` vers `localhost:8000`.

**Jeton machine** (système d'information d'une administration) :

```powershell
curl -X POST http://localhost:8080/realms/fasolink/protocol/openid-connect/token `
  -d grant_type=client_credentials -d client_id=admin-a -d client_secret=<ADMIN_A_CLIENT_SECRET du .env>
```

**Autres commandes :**
- Tests : `python -m pytest` pour les prédicats ;
- `docker run --rm -v ${PWD}/policies:/policies openpolicyagent/opa:1.0.0 test /policies -v` pour les 9 tests de politique ;
- Arrêt : `docker compose down`. Toutes les données sont réinitialisées au prochain démarrage.
- Attention : `docker compose up -d --build gateway` relance aussi l'initialisation, donc **remet les données de démo à zéro**. Évitez de le faire juste avant de présenter.

## Cas d'usage pratiques

Chaque démarche est décrite dans le catalogue des finalités (table `purpose`, [db/migrations/003_cas_usage.sql](db/migrations/003_cas_usage.sql)). Elle indique les pièces justificatives qu'elle évite. Le citoyen voit son compteur de pièces évitées, et la supervision voit le total par document.

| # | Démarche | Compte | Registres | Ce qui est transmis | Pièces évitées |
|---|---|---|---|---|---|
| 1 | **Candidature à un recrutement public** | `agent-recrutement` | État civil + nationalité + casier, en **un seul envoi** | 4 réponses Oui/Non : acte de naissance enregistré, âge 18–35 ans, nationalité burkinabè, casier compatible (consentement requis) | Extrait d'acte de naissance, certificat de nationalité, extrait de casier de moins de 3 mois |
| 2 | **Demande de bulletin n°3** | `agent-casier` | État civil | Attributs autorisés : nom, prénoms, date et lieu de naissance, sexe, **filiation** | Extrait d'acte de naissance (ou jugement supplétif) |
| 3 | **Instruction d'un certificat de nationalité** | `agent-nationalite` | État civil | Faits d'état civil et filiation. L'écran rappelle que **la décision reste au service de la nationalité** | Extrait d'acte de naissance |
| 4 | **Condition d'âge (concours, formation)** | `agent-concours` | État civil | Uniquement « Âge conforme (18–30 ans) : Oui/Non ». **Les bornes sont fixées par la politique** et inscrites dans l'attestation signée | Extrait d'acte de naissance |

Trois garde-fous de la conception :
- **Bornes d'âge imposées par la politique :** si l'agent pouvait choisir les bornes, il retrouverait la date de naissance exacte en les faisant varier.
- **Attributs bruts refusés par OPA :** un recruteur ou un organisateur de concours qui demande la date de naissance brute reçoit un refus. Le citoyen voit cette tentative.
- **Pas de cache pour les attributs :** les attributs (identité, filiation) ne sont jamais mis en cache pour le mode dégradé. Seules des réponses Oui/Non peuvent être réutilisées.

Le diplôme et les pièces propres à chaque recrutement restent à fournir par le candidat : FasoLink ne couvre que les pièces détenues par l'administration.

## Ce qui répond à l'épreuve en direct

| Exigence | Mécanisme |
|---|---|
| **Ne transmettre que l'utile** | L'administration demande un *prédicat* (`est_majeur`), pas un attribut. FasoLink lit la date de naissance et ne renvoie que « Majeur : Oui ». La réponse est signée par Vault, vérifiable par tous via `/.well-known/jwks.json`, liée à l'administration et à la finalité, et valable 15 minutes. OPA décide avant toute lecture. |
| **Montrer à l'usager qui a consulté ses données** | Le citoyen se connecte par Keycloak. Il voit qui a consulté ses données, quand, pourquoi, ce qui a été transmis, ce qui a été lu sans être transmis, et les tentatives refusées. Le journal est chaîné par SHA-256. Il peut signaler un accès, aussi à la voix. |
| **Tenir quand un registre tombe** | 1) Un disjoncteur Redis s'ouvre après 3 échecs. 2) Une réponse de moins de 24 h est réutilisée depuis le cache Redis si la politique l'autorise ; c'est interdit pour le casier. 3) Sinon, la demande part dans la file Redis et se relance automatiquement. Les autres registres continuent de répondre. |

## Scénario pour le jury (environ 5 minutes)

1. **Supervision** : montrez le *socle technique* (5 composants en vert).
2. **Administration** → Administration A, chip *Awa Ouédraogo*, Vérifier : **Majeur : Oui**. Ouvrez l'attestation et cliquez « Vérifier la signature ».
3. Cochez « Tenter aussi d'obtenir la nationalité » → **refus OPA** pour la nationalité, la majorité reste accordée.
4. **Citoyen** → `bf1998000123` / `demo` : les accès apparaissent en direct. Assistant vocal : « Qui a consulté mes données ? », puis « Je veux signaler le dernier accès ».
5. **Supervision** → l'alerte arrive. Cliquez « Simuler une panne » sur l'état civil.
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
portal-agent/          React : écran de l'administration demandeuse        → :3001
portal-citizen/        React : historique des accès + assistant vocal       → :3002
portal-supervision/    React : registres, socle, alertes, intégrité         → :3003
design/                Design system (source unique) : tokens.css, StatusPill, Logo, polices
db/migrations/         Schéma PostgreSQL
infra/vault/           Configuration de Vault (clés Transit, politique de la passerelle)
infra/keycloak/        Realm généré par scripts/init_env.py (non versionné) + thème de connexion
scripts/               init_env, seed_demo, demo_epreuve
```

Chaque portail est une application autonome : son propre `package.json`, son client Keycloak et son image Docker (build Node, puis nginx). Les trois partagent l'API et le design system.

### Design system

- **Source unique : [design/](design/).**
  - `tokens.css` contient les jetons de couleur, typographie, espacement et états.
  - Il définit trois thèmes, choisis par `<html data-portal="agent|citizen|supervision">`.
  - Le dossier contient aussi `StatusPill.jsx` (pastille d'état, verdict Oui/Non, synthèse d'un dossier), `Logo.jsx` et la police Noto Sans (licence OFL).
- **Copie dans chaque portail :** Docker construit chaque portail isolément, donc une copie est déposée dans `src/styles/` et `src/components/ui/`. Après toute modification de `design/`, lancez `python scripts/sync_design.py`. Pour vérifier qu'aucune copie n'a divergé, lancez `python scripts/sync_design.py --check`.
- **Règles d'usage :**
  - Un état n'est jamais signalé par la couleur seule : chaque pastille porte une icône et un mot.
  - Les composants n'utilisent que les jetons sémantiques (`--ok-bg`, `--deny-fg`…), jamais les couleurs brutes.
  - Le portail citoyen garde des zones tactiles d'au moins 48 px.

### Page de connexion Keycloak

Le thème `fasolink` se trouve dans [infra/keycloak/themes/fasolink/login/](infra/keycloak/themes/fasolink/login/). Le realm l'active, en français.

- **Fonctionnement :** il hérite du thème Keycloak standard, donc les formulaires et les flux d'authentification ne changent pas. Seuls l'habillage et les textes sont personnalisés.
- **Adapté à chaque portail :** l'écran reconnaît le portail d'où vient l'utilisateur (client OIDC). Il reprend alors ses couleurs et affiche un texte adapté : guichet administration, « Mes données » pour le citoyen, supervision en thème sombre.
- **Jetons et polices :** ce sont les mêmes que les portails, copiés par `scripts/sync_design.py`.
- **Comptes de démonstration :** ils sont affichés sous le formulaire. Mettez `fasolinkDemo=false` dans `theme.properties` hors démo.
- **Prise en compte des modifications :** les modifications du thème apparaissent au rechargement de la page, sans redémarrage, car Keycloak tourne en `start-dev`. Seul un premier ajout du thème demande de recréer le conteneur : `docker compose up -d --no-deps --force-recreate keycloak`.

## Limites de cette version de démonstration

- **Vault en mode dev** (en mémoire) et **Keycloak en `start-dev`** : la plateforme est entièrement réinitialisée à chaque démarrage. En production : Vault scellé avec stockage persistant, Keycloak en mode `start` avec TLS et base PostgreSQL.
- **Connexion :** les portails utilisent déjà *Authorization Code + PKCE*. Seul le client `fasolink-cli`, réservé aux scripts de démo, garde le flux « mot de passe ». En production : HTTPS partout, et fédération avec l'identité nationale pour les citoyens.
- **Mode démonstration :** il expose la liste des comptes de démo et la simulation de panne. Mettez `FASOLINK_DEMO_MODE=0` hors démo.
- **Assistant vocal :** basé sur des règles, en français (Web Speech API, Chrome ou Edge).

## Brancher les registres du jury

1. Remplacer les services `registry-*` dans `docker-compose.yml`, ou renseigner `FASOLINK_REGISTRY_<CODE>_URL`.
2. Adapter les noms de champs dans `gateway/predicates.py` et, si besoin, `fetch_record` dans `gateway/registry_client.py`.
3. Enrôler leurs citoyens sur le modèle de `scripts/seed_demo.py`.
