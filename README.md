# FasoLink

Socle d'interopérabilité administrative pour le Challenge 2 « Dites-le nous une fois ».
Les pièces circulent entre administrations, pas les usagers entre guichets.

## Stack technique (conforme à la fiche technique)

| Composant | Technologie | Rôle dans FasoLink |
|---|---|---|
| Base de données | **PostgreSQL 16** | Identités chiffrées, politiques, demandes, attestations, journal d'audit chaîné (append-only imposé par des triggers) |
| API d'interopérabilité | **FastAPI** | Passerelle : API pure, sans écrans |
| Interfaces | **React 19 + Vite 8** | 3 applications, une par rôle, dans un workspace npm (`frontend/`) qui partage le socle visuel, l'authentification et le client API. Servies par nginx (relais `/api`, CSP stricte) |
| Authentification et rôles | **Keycloak 26** | Realm `fasolink`. Rôles `agent`, `supervisor`, `citizen` et `platform_admin`. Une administration correspond à un groupe Keycloak. Un client public par portail (*Authorization Code + PKCE S256*, imposé). Clients machine `admin-a`, `admin-b`, `admin-c`, `cefore` (*client credentials*). Client `fasolink-admin-api` : compte de service de la passerelle, limité à la gestion des utilisateurs et des groupes |
| Moteur de politiques | **Open Policy Agent 1.0** | [policies/fasolink.rego](policies/fasolink.rego) : finalité, justification, prédicats, consentement. La passerelle refuse tout accès si OPA ne répond pas. Les décisions sont journalisées |
| Cache et résilience | **Redis 7.4** | Disjoncteurs partagés, cache du mode dégradé (prédicats uniquement), file de relance. PostgreSQL fait foi : si Redis perd sa file, elle est reconstruite |
| Chiffrement et secrets | **Vault 1.18** (Transit) | Chiffrement AES-GCM de l'IUE et des références locales, empreintes HMAC, signature Ed25519 des attestations. **Aucune clé ne sort de Vault** ; la passerelle a un jeton à privilèges minimaux |
| Conteneurisation | **Docker Compose** | 16 services (dont 2 tâches d'initialisation), démarrage en une commande |
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
| **Portail administration** | http://localhost:3001 | `agent-a`, `agent-b`, `agent-c` (un cas de l'épreuve chacun) ou `agent-cefore` (CEFORE : immatriculation d'une entreprise individuelle, 3 registres à cocher selon l'usager) |
| **Portail citoyen** | http://localhost:3002 | IUE à 12 chiffres (`482019736154`), ou référence d'état civil sans IUE (`ec-fdg-2001-000222`). Inscription : http://localhost:3002/inscription |
| **Portail supervision** | http://localhost:3003 | `superviseur` (tableau de bord) ou `admin-fasolink` (référentiel : structures, agents, cas d'usage) |
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

## Inscription des citoyens avec leur IUE

L'**identifiant unique électronique (IUE)** est le numéro à **12 chiffres** prévu par la loi sur l'identification unique électronique de base de la personne physique (octobre 2024). L'enrôlement de masse a été lancé le 11 novembre 2026 par le ministère de la Transition digitale (projet WURI). Il est attribué à toute personne résidant au Burkina Faso, Burkinabè ou non : **il prouve l'unicité de la personne, pas sa nationalité**, qui reste vérifiée dans son propre registre. Les IUE de démonstration sont des numéros sans signification : un identifiant ne doit révéler ni la date de naissance ni le lieu. La structure qui détient le registre est marquée « à préciser » (distincte de l'ONI, qui gère la CNIB).

Un citoyen sans compte s'inscrit sur http://localhost:3002/inscription. Le lien « Créer mon compte avec mon IUE » figure aussi sur la page de connexion du portail citoyen.

1. **IUE + date de naissance** : FasoLink interroge le **registre national de l'identifiant unique** (service `registry-iue`). L'IUE doit exister, être `ACTIF`, et la date de naissance doit correspondre. Le message d'erreur est le même que l'IUE soit inconnu ou que la date soit fausse, pour ne pas révéler quels IUE existent.
2. **Code à 6 chiffres** envoyé au téléphone enregistré pour cet IUE. Le code est valable 10 minutes et accepte 5 essais ; il est stocké sous forme d'empreinte dans Redis, jamais en clair. Chaque IUE est limité à 3 demandes de code par quart d'heure. **En démonstration, aucun SMS n'est envoyé : le code s'affiche à l'écran.**
3. **Mot de passe** choisi par le citoyen (10 caractères minimum, avec lettres et chiffres). Le compte Keycloak est créé, l'identifiant de connexion est l'IUE. Si l'IUE n'était pas encore connu de FasoLink, l'identité est enrôlée à partir des références fournies par le registre. L'inscription est inscrite au journal chaîné.

| Usager de démo (sans compte) | IUE | Date de naissance | Résultat |
|---|---|---|---|
| Ousmane Compaoré | `128475906331` | 24/06/1995 | Inscription possible |
| Pauline Yaméogo | `846251037790` | 08/09/2001 | Inscription possible ; identité enrôlée à l'inscription |
| Jean-Baptiste Nikiéma | `571938264402` | 02/04/1988 | Refus : IUE annulé |

Le registre des IUE apparaît dans la supervision (panne simulable) mais pas dans les cas d'usage : il ne transmet aucune information aux administrations.

## Consentement par SMS (usagers sans accès au web)

Quand un cas d'usage exige le consentement de l'usager et qu'il ne l'a **jamais donné ni refusé**, FasoLink ne refuse plus d'emblée la demande : il envoie un SMS au **numéro associé à son IUE** dans le registre de l'identifiant unique.

> FasoLink : Administration C demande à consulter votre dossier « Casier judiciaire » pour : Vérification du casier pour un emploi. Répondez 1 pour OUI (accepter) ou 2 pour NON (refuser). Sans réponse sous 30 min, l'accès est refusé.

- La demande passe à l'état **« Accord SMS attendu »**. L'agent voit le numéro masqué (`+226 76 •• •• 21`) et l'heure limite, et sa fiche se met à jour seule.
- **1 (ou OUI)** : l'accord est enregistré **pour cette demande uniquement**, puis le registre est consulté. Une prochaine demande déclenchera un nouveau SMS.
- **2 (ou NON)**, ou **pas de réponse sous 30 minutes** : la demande est refusée, avec le motif.
- Si plusieurs demandes attendent sur le même numéro, la réponse vaut pour la plus récente ; les autres sont refusées.
- Si l'usager a déjà **refusé ou retiré** son consentement sur le portail, aucun SMS n'est envoyé. Un usager sans IUE actif ou sans téléphone ne peut pas être joint : la demande est refusée.
- Le numéro n'est pas stocké en clair : seulement une empreinte (Vault HMAC) et sa forme masquée. Chaque envoi et chaque réponse sont inscrits au journal chaîné.

**Démonstration :** aucun SMS réel n'est envoyé. Le **téléphone simulé** http://localhost:3002/telephone affiche les SMS reçus par un usager et permet d'y répondre (boutons « 1 · OUI » / « 2 · NON »). Usager prévu pour ce scénario : **Boureima Sawadogo**, cultivateur à Kaya, téléphone simple sans Internet, IUE `693027415586`, sans compte web. Avec `agent-c`, vérifiez son casier : la fiche attend, le SMS arrive sur le téléphone simulé, répondez 1, la réponse apparaît chez l'agent.

**En production :** l'opérateur SMS (agrégateur Orange, Moov…) relaie les réponses sur `POST /sms/entrant` (`{"from": "+226…", "text": "1"}`), authentifié par l'en-tête `X-SMS-Token`. Cette route reste fermée tant que `FASOLINK_SMS_WEBHOOK_TOKEN` n'est pas défini.

### Envoyer de vrais SMS avec Twilio

Par défaut, `FASOLINK_SMS_PROVIDER=simulateur` : aucun SMS réel, tout passe par le téléphone simulé. Pour de vrais SMS, ajoutez dans `.env` (jamais versionné) :

```
FASOLINK_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_FROM=+1…                      # numéro Twilio (ou TWILIO_MESSAGING_SERVICE_SID=MG…)
TWILIO_WEBHOOK_URL=https://xxxx.ngrok-free.app/sms/twilio   # réponses des usagers (facultatif)
FASOLINK_SMS_DEMO_PHONES=693027415586=+226XXXXXXXX           # vrai téléphone pour un IUE de démo
```

puis `docker compose up -d --force-recreate`.

- **Envoi** : API REST Twilio, sans SDK ([gateway/twilio_sms.py](gateway/twilio_sms.py)). Si Twilio refuse l'envoi, la demande est refusée tout de suite avec le motif, au lieu d'attendre une réponse qui n'arrivera pas.
- **Réponses** : dans la console Twilio, le numéro → *Messaging → A message comes in* → `POST` vers `TWILIO_WEBHOOK_URL` (exposez le port 8000 avec `ngrok http 8000`). La signature `X-Twilio-Signature` est vérifiée. Sans webhook, l'usager peut aussi répondre depuis le téléphone simulé, qui passe par le même traitement.
- **Numéros de démo** : les téléphones des citoyens fictifs n'existent pas. `FASOLINK_SMS_DEMO_PHONES` remplace celui d'un IUE par un vrai numéro, dans le registre de l'identifiant unique.
- **Compte d'essai (Trial)** : Twilio n'y autorise que ses **modèles prédéfinis** (erreur 572006) et seulement vers des **numéros vérifiés**. Le texte de consentement de FasoLink exige un compte **payant**, avec le Burkina Faso activé dans *Messaging → Geo permissions*.

### Appel vocal de consentement (Twilio Voice)

Au Burkina Faso, Twilio **ne reçoit pas les réponses par SMS** (SMS bidirectionnel non pris en charge). Avec `FASOLINK_VOICE_CONSENT=1`, FasoLink envoie le SMS d'information **puis appelle l'usager** : une voix française lit la demande, l'usager appuie sur **1 (OUI)** ou **2 (NON)**. N'importe quel téléphone suffit, et il n'est pas nécessaire de savoir lire.

```
FASOLINK_VOICE_CONSENT=1
FASOLINK_PUBLIC_URL=https://xxxx.ngrok-free.app     # ngrok http 8000, sans chemin
```

- Twilio renvoie la touche pressée sur `POST /voix/twilio?consent=<id>`. La signature est vérifiée, et le registre n'est consulté qu'après la réponse à Twilio.
- Prérequis Twilio : un numéro avec la capacité *Voice*, et le **Burkina Faso activé dans _Voice → Settings → Geo permissions_**. Ce réglage est distinct de celui des SMS ; sans lui, Twilio renvoie l'erreur 21216.
- Coût : environ 0,69 $ par minute vers un mobile burkinabè.
- Chaque nouvelle adresse ngrok doit être reportée dans `FASOLINK_PUBLIC_URL` (puis `docker compose up -d gateway`).

## Référentiel : structures, agents et cas d'usage

L'administrateur de la plateforme (`admin-fasolink`, rôle `platform_admin`) travaille dans l'onglet **Référentiel** du portail Supervision. Ce rôle est distinct du superviseur : la personne qui accorde les accès n'est pas celle qui les contrôle.

1. **Créer une structure** (ex. `CENI`) : la passerelle crée la ligne `administration` et le groupe Keycloak du même code.
2. **Créer ses agents** : un compte Keycloak du rôle `agent` est créé dans ce groupe, avec un mot de passe provisoire affiché une seule fois, à changer à la première connexion.
3. **Définir ses cas d'usage** : un libellé, une base légale, et les **registres consultables**. Pour chaque registre, l'administrateur choisit les informations transmises (Oui/Non), le consentement, la réutilisation en cas de panne (interdite pour le casier) et, pour le casier, les condamnations incompatibles.
4. **L'agent** choisit son cas d'usage, identifie l'usager et **coche les registres que son dossier exige**. FasoLink envoie une seule demande et la répartit entre les registres. OPA refuse tout registre hors du cas d'usage.

Le code du cas d'usage est la finalité (`purpose_code`) des demandes, des politiques et du journal : l'usager voit « Immatriculation d'une entreprise individuelle » dans son historique. Une modification **ne touche jamais une politique en place** : l'ancienne est close (`valid_until`), une nouvelle est créée, et chaque accès passé reste lié à sa règle. Chaque opération de l'administrateur est inscrite dans le journal chaîné. Une structure suspendue est refusée par OPA.

Les structures créées à la main disparaissent au prochain `docker compose up` (tout est réinitialisé). Le CEFORE est livré dans [003_referentiel.sql](db/migrations/003_referentiel.sql) pour que la démo soit reproductible. Ses bases légales sont marquées « À préciser » et doivent être validées par un juriste.

**Mise à jour d'une installation existante :** relancez `python scripts/init_env.py` (ajoute le secret `FASOLINK_ADMIN_API_SECRET` et régénère le realm), puis `docker compose up -d --build --force-recreate`.

## Ce qui répond à l'épreuve en direct

| Exigence | Mécanisme |
|---|---|
| **Ne transmettre que l'utile** | L'administration demande un *prédicat* (`est_majeur`), pas un attribut. FasoLink lit la date de naissance et ne renvoie que « Majeur : Oui ». La réponse est signée par Vault, vérifiable par tous via `/.well-known/jwks.json`, liée à l'administration et à la finalité, et valable 15 minutes. OPA décide avant toute lecture. |
| **Montrer à l'usager qui a consulté ses données** | Le citoyen se connecte par Keycloak. Il voit qui a consulté ses données, quand, pourquoi, ce qui a été transmis, ce qui a été lu sans être transmis, et les tentatives refusées. Le journal est chaîné par SHA-256. Il peut signaler un accès, aussi à la voix. |
| **Tenir quand un registre tombe** | 1) Un disjoncteur Redis s'ouvre après 3 échecs. 2) Une réponse de moins de 24 h est réutilisée depuis le cache Redis si la politique l'autorise ; c'est interdit pour le casier. 3) Sinon, la demande part dans la file Redis et se relance automatiquement. Les autres registres continuent de répondre. |

## Scénario pour le jury (environ 5 minutes)

1. **Supervision** : montrez le *socle technique* (5 composants en vert).
2. **Administration** (`agent-a`) → usager fictif *Awa Ouédraogo*, « Interroger le registre » : **Majeur : Oui**. Cliquez « Vérifier la signature » sous la réponse.
   - **Plusieurs registres pour une démarche** (`agent-cefore`) : cas d'usage « Immatriculation d'une entreprise individuelle ». Choisir *Awa Ouédraogo*, laisser les 3 registres cochés, « Consulter les 3 registres » : majorité, nationalité et casier répondent **Oui** en une seule demande. Pour *Mariam Traoré*, décocher la nationalité : sa condamnation avec sursis n'empêche pas l'immatriculation (règle propre à ce cas d'usage). Dans l'espace citoyen d'Awa ouvert à côté, chaque consultation déclenche une notification en moins de 3 secondes (cloche + alerte, et notification du système si elle est activée).
3. Cochez la case *Démonstration* (« demander aussi Nationalité burkinabè ») → **refus OPA** pour la nationalité, la majorité reste accordée.
4. **Citoyen** → `482019736154` / `demo` : les accès apparaissent en direct. Assistant vocal : « Qui a consulté mes données ? », puis « Je veux signaler le dernier accès ».
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
  referentiel.py       Structures, cas d'usage, versions des politiques (rôle platform_admin)
  keycloak_admin.py    Création des groupes (structures) et des agents dans Keycloak
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
