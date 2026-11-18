# FasoLink

**Socle d'interopérabilité administrative pour le Burkina Faso.**
Challenge 2 du Hackathon des Universités 2026 : « Dites-le nous une fois ».

Aujourd'hui, pour un concours ou une création d'entreprise, c'est l'usager qui fait le tour des guichets : acte de naissance à la mairie, certificat de nationalité au tribunal, casier judiciaire à la Justice. Pourtant, l'État possède déjà toutes ces informations.

Avec FasoLink, ce sont les administrations qui interrogent les registres existants, et non plus les citoyens qui transportent les papiers. Trois principes guident le projet :

- **Transmettre une réponse, pas une donnée.** L'administration demande « cette personne est-elle majeure ? ». Elle reçoit « Oui », signé et daté, jamais la date de naissance.
- **Personne ne consulte sans droit.** Un moteur de règles vérifie chaque demande avant toute lecture. En cas de refus, le registre n'est même pas interrogé.
- **L'usager garde la main.** Il voit en temps réel qui a consulté ses données, quand et pourquoi. Il peut signaler un accès qu'il ne reconnaît pas.

FasoLink ne remplace aucun registre et ne centralise aucune base. Il se branche sur l'existant.

---

## Sommaire

1. [Démarrer](#démarrer)
2. [Comptes de démonstration](#comptes-de-démonstration)
3. [Scénario de démonstration](#scénario-de-démonstration)
4. [Architecture](#architecture)
5. [Fonctionnalités](#fonctionnalités)
6. [Organisation du code](#organisation-du-code)
7. [Développement](#développement)
8. [Configuration avancée](#configuration-avancée)
9. [Vers la production](#vers-la-production)
10. [Dépannage](#dépannage)

---

## Démarrer

**Prérequis :**

- Docker Desktop (WSL 2 sous Windows) ;
- Python 3.12 ou plus pour les scripts.

Node.js 22.12+ n'est utile que pour développer les interfaces hors Docker.

```bash
python scripts/init_env.py        # une seule fois : secrets aléatoires (.env) et realm Keycloak
docker compose up -d --build      # environ une minute, Keycloak est le plus long à démarrer
```

Une fois la plateforme démarrée :

| Application | Adresse |
|---|---|
| Portail administration | http://localhost:3001 |
| Espace citoyen | http://localhost:3002 |
| Supervision et référentiel | http://localhost:3003 |
| API (Swagger) | http://localhost:8000/docs |
| Console Keycloak | http://localhost:8080 (compte `admin`, mot de passe `KEYCLOAK_ADMIN_PASSWORD` du `.env`) |

> Utilisez toujours `localhost`, et non `127.0.0.1` : c'est l'adresse déclarée dans Keycloak.

Pour vérifier que tout fonctionne de bout en bout, lancez le scénario de l'épreuve. Il faut d'abord `pip install httpx`. Le script se termine par « TOUT EST VERT » si chaque contrôle passe :

```bash
python scripts/demo_epreuve.py
```

La plateforme de démonstration ne conserve rien : chaque `docker compose up` repart d'une base neuve.

## Comptes de démonstration

Tous les comptes ont le mot de passe **`demo`**.

| Portail | Identifiant | Rôle |
|---|---|---|
| Administration | `agent-a` | Administration A : vérification de majorité |
| | `agent-b` | Administration B : vérification de nationalité |
| | `agent-c` | Administration C : vérification du casier pour un emploi |
| | `agent-cefore` | CEFORE : immatriculation d'une entreprise individuelle (3 registres) |
| Supervision | `superviseur` | Délégué à la protection des données : registres, demandes, alertes |
| | `admin-fasolink` | Administrateur de la plateforme : structures, agents, cas d'usage |
| Citoyen | IUE à 12 chiffres | Voir le tableau ci-dessous |

| Citoyen fictif | IUE | Particularité |
|---|---|---|
| Awa Ouédraogo | `482019736154` | Majeure, burkinabè, casier vierge |
| Issouf Sawadogo | `730562184907` | Mineur (16 ans) |
| Mariam Traoré | `615307429863` | Condamnation incompatible avec un emploi public |
| Salif Zongo | `259846103578` | Résident de nationalité étrangère |
| Adama Ouattara | `357690412845` | Aura 18 ans le 20 novembre 2026 |
| Aminata Kinda | — | Sans IUE : retrouvée par sa référence d'état civil (`ec-fdg-2001-000222`) |
| Ousmane Compaoré | `128475906331` | Pas encore de compte : peut s'inscrire (né le 24/06/1995) |
| Jean-Baptiste Nikiéma | `571938264402` | IUE annulé : l'inscription est refusée |
| Boureima Sawadogo | `693027415586` | Sans Internet : donne son accord par SMS |

La session Keycloak est partagée par tous les onglets d'un même navigateur. Pour montrer plusieurs rôles côte à côte, ouvrez chaque portail dans une fenêtre privée ou un profil différent.

## Scénario de démonstration

Ce parcours dure environ cinq minutes.

1. **Vérifier plusieurs pièces d'un coup.** Connectez-vous au portail administration avec `agent-cefore`.
   - Choisissez *Awa Ouédraogo* dans la sélection rapide, laissez les trois registres cochés, saisissez un motif, puis cliquez sur « Consulter les 3 registres ».
   - Majorité, nationalité et casier répondent **Oui** en moins d'une seconde.
   - Ouvrez une réponse et cliquez sur « Vérifier la signature ».
2. **L'usager est prévenu.** Dans une autre fenêtre, connectez-vous à l'espace citoyen avec `482019736154`.
   - La consultation apparaît dans les trois secondes, avec une notification.
   - Awa voit qui a consulté ses données, pourquoi, et ce qui a été transmis.
3. **Le refus.** Avec `agent-a`, cochez « Tester un refus ».
   - Le moteur de règles refuse l'information hors du cas d'usage, et le registre n'est pas interrogé.
   - La majorité, elle, reste accordée.
4. **Le signalement.** Côté citoyen, signalez la dernière consultation comme non reconnue.
   - Dans la supervision (`superviseur`), l'alerte arrive.
   - Prenez-la en charge, puis résolvez-la avec une note.
5. **La panne.** Dans la supervision, cliquez sur « Simuler une panne » sur l'état civil.
   - Revenez avec `agent-a` : pour Awa, la réponse récente est réutilisée (mode dégradé).
   - Pour *Adama Ouattara*, la demande est mise en attente.
   - Rétablissez le registre : la demande d'Adama se termine toute seule.
6. **L'accord par SMS.** Avec `agent-c`, vérifiez le casier de *Boureima Sawadogo*.
   - La demande attend son accord.
   - Sur le téléphone simulé (http://localhost:3002/telephone), répondez `1` : la réponse s'affiche chez l'agent.

## Architecture

Quatre types d'utilisateurs, une seule porte d'entrée, une passerelle qui fait respecter les règles :

```
 Agent d'administration ─┐                 ┌─ Portail administration ─┐
 Citoyen ────────────────┼──► Keycloak ───►├─ Espace citoyen ─────────┼──► Passerelle FasoLink ──► Registres existants
 Superviseur ────────────┤   (connexion,   └─ Supervision ────────────┘    (FastAPI)              état civil, nationalité,
 Administrateur ─────────┘    rôles)                                            │                    casier, identifiant unique
                                                                                ├── OPA ........ décide si l'accès est permis
                                                                                ├── Vault ...... chiffre et signe
                                                                                ├── PostgreSQL . demandes et journal d'audit chaîné
                                                                                └── Redis ...... disjoncteurs, cache, file de relance
```

| Composant | Technologie | Rôle |
|---|---|---|
| Passerelle | FastAPI (Python 3.12) | API d'interopérabilité, sans écran |
| Portails | React 19, Vite 8, nginx | Une application par rôle, servie avec une politique de sécurité du contenu stricte et l'isolation entre origines (COOP, COEP, CORP) |
| Authentification | Keycloak 26 | Connexion unique, rôles, *Authorization Code + PKCE* ; une administration = un groupe |
| Règles d'accès | Open Policy Agent 1.0 | Finalité, justification, informations autorisées, consentement. Sans réponse d'OPA, l'accès est refusé |
| Chiffrement et signature | Vault 1.18 (Transit) | Chiffrement des identifiants, empreintes HMAC, signature Ed25519. Aucune clé ne sort de Vault |
| Données | PostgreSQL 16 | Identités chiffrées, politiques, demandes, attestations, journal d'audit chaîné |
| Résilience | Redis 7.4 | Disjoncteurs partagés, cache du mode dégradé, file de relance |

Les diagrammes d'interaction et de séquence sont dans [docs/diagrammes/](docs/diagrammes/), à ouvrir avec draw.io.

## Fonctionnalités

### Ne transmettre que l'utile

L'administration ne demande pas un attribut (« date de naissance ») mais un *prédicat* (« est majeur »). La passerelle lit l'enregistrement, calcule la réponse puis jette la donnée brute.

L'attestation renvoyée :

- est signée par Vault ;
- est liée à l'administration et à la finalité ;
- est valable 15 minutes ;
- est vérifiable par n'importe qui avec la clé publique (`/.well-known/jwks.json`).

| Information | Registre | Pièce qu'elle remplace |
|---|---|---|
| `est_majeur` | État civil | Acte de naissance |
| `nationalite_burkinabe` | Nationalité | Certificat de nationalité |
| `casier_compatible_finalite` | Casier judiciaire | Extrait de casier judiciaire |

### Contrôle d'accès

Chaque demande est soumise à OPA ([policies/fasolink.rego](policies/fasolink.rego)) avant toute lecture. OPA vérifie :

- que l'administration est active ;
- que son cas d'usage autorise ce registre et cette information ;
- que le motif est présent ;
- que le consentement de l'usager est donné quand il est requis.

La passerelle refuse tout accès si OPA ne répond pas.

### Transparence pour le citoyen

Dans son espace, l'usager voit chaque consultation :

- quelle administration l'a faite, quand, et pour quel motif ;
- ce qui a été transmis ;
- ce qui a été lu sans être transmis ;
- les tentatives refusées.

Une notification apparaît dans les trois secondes. Il peut signaler un accès, au clavier ou à la voix. Son signalement devient une alerte que le superviseur instruit.

Le journal d'audit est chaîné par SHA-256 dans PostgreSQL. Modifier une seule ligne casse la chaîne, et l'intégrité est vérifiable depuis chaque portail.

### Résilience

Quand un registre tombe en panne, trois niveaux prennent le relais :

1. un disjoncteur s'ouvre après trois échecs : on cesse d'interroger un registre en panne ;
2. si la règle l'autorise, une réponse de moins de 24 h est réutilisée (jamais pour le casier) ;
3. sinon, la demande part en file d'attente et se relance seule au retour du registre.

Les autres registres continuent de répondre. Si Redis perd sa file, elle est reconstruite depuis PostgreSQL.

### Référentiel

L'administrateur de la plateforme (`admin-fasolink`) gère trois choses :

- il crée les structures, ce qui crée aussi leur groupe Keycloak ;
- il crée leurs agents, avec un mot de passe provisoire affiché une seule fois ;
- il définit leurs cas d'usage : base légale, registres consultables, informations transmises, consentement, règles du casier.

Une modification ne réécrit jamais une règle en place. L'ancienne version est close, une nouvelle est créée, et chaque accès passé reste lié à la règle qui l'a permis. Ce rôle est distinct du superviseur : la personne qui accorde les accès n'est pas celle qui les contrôle.

### Inscription avec l'IUE

Un citoyen sans compte s'inscrit sur http://localhost:3002/inscription :

1. Il saisit son IUE et sa date de naissance, vérifiés auprès du registre de l'identifiant unique.
2. Il reçoit un code à six chiffres sur le téléphone enregistré. Le code est valable 10 minutes, accepte 5 essais, et est stocké sous forme d'empreinte.
3. Il choisit son mot de passe.

En démonstration, le code s'affiche à l'écran.

### Consentement par SMS

Quand un cas d'usage exige le consentement et que l'usager ne s'est jamais prononcé, FasoLink lui envoie un SMS au numéro associé à son IUE. Il répond `1` (oui) ou `2` (non) :

- l'accord ne vaut que pour cette demande ;
- sans réponse sous 30 minutes, l'accès est refusé.

Le numéro n'est conservé que sous forme d'empreinte et masqué.

## Organisation du code

```
FasoLink/
├── gateway/                   Passerelle FastAPI
│   ├── main.py                Assemblage de l'application
│   ├── api/                   Routes, une par espace : public, administration, citoyen,
│   │                          supervision, référentiel, opérateurs SMS, démonstration
│   ├── schemas.py             Corps des requêtes (Pydantic)
│   ├── errors.py              Exceptions métier → réponses HTTP
│   ├── worker.py              Tâche de fond : santé des registres, relances, expirations
│   ├── service.py             Pipeline d'une vérification : identité → règles → registre → attestation
│   ├── predicates.py          Calcul des réponses Oui / Non (minimisation)
│   ├── policy.py              Collecte des faits et appel à OPA
│   ├── registry_client.py     Appels aux registres derrière le disjoncteur
│   ├── resilience.py          Redis : disjoncteurs, cache du mode dégradé, file de relance
│   ├── crypto.py              Vault Transit : chiffrement, empreintes, signature
│   ├── audit.py               Journal d'audit chaîné et contrôle d'intégrité
│   ├── auth.py                Jetons Keycloak et rôles
│   ├── referentiel.py         Structures et cas d'usage
│   ├── keycloak_admin.py      Comptes et groupes dans Keycloak
│   ├── inscription.py         Inscription des citoyens avec leur IUE
│   ├── consentement_sms.py    Accord de l'usager par SMS ou appel vocal
│   └── sms.py, sms_texte.py, twilio_sms.py   Envoi des SMS (simulateur ou Twilio)
├── frontend/                  Workspace npm des portails React
│   ├── shared/                Socle commun : styles, polices, session Keycloak, client API, composants
│   ├── agent/                 Portail administration            → :3001
│   ├── citizen/               Espace citoyen et inscription     → :3002
│   ├── supervision/           Supervision et référentiel        → :3003
│   └── nginx/                 Relais /api et en-têtes de sécurité
├── policies/                  Règles OPA et leurs tests
├── db/migrations/             Schéma PostgreSQL et données de référence
├── registries-mock/           Registres simulés et citoyens fictifs
├── infra/
│   ├── keycloak/themes/       Thème de la page de connexion
│   ├── vault/                 Clés Transit et politique de la passerelle
│   └── zap/                   Règles de l'audit OWASP ZAP
├── scripts/                   init_env, seed_demo, demo_epreuve, audit_securite
├── .github/workflows/         Tests et audit de sécurité à chaque push
├── tests/                     Tests unitaires
└── docs/                      Fiche technique, note de cadrage, diagrammes
```

## Développement

**Tests et qualité :**

```bash
python -m pytest                    # prédicats, textes SMS, client Twilio
ruff check .                        # style et erreurs Python
docker run --rm -v "${PWD}/policies:/policies" openpolicyagent/opa:1.0.0 test /policies -v
```

**Audit de sécurité.** Trois outils open source tournent dans Docker, sans rien installer d'autre :

```bash
python scripts/audit_securite.py              # gitleaks + semgrep + zap
python scripts/audit_securite.py gitleaks     # ou une seule analyse
```

| Outil | Ce qu'il vérifie | Configuration |
|---|---|---|
| Gitleaks | Aucun secret (clé, jeton, mot de passe) dans l'historique git ni dans les fichiers | [.gitleaks.toml](.gitleaks.toml) |
| Semgrep CE | Analyse statique : Python, React, Docker, nginx, OWASP Top 10 | [.semgrepignore](.semgrepignore) |
| OWASP ZAP | Scan dynamique de la plateforme démarrée : les trois portails et l'API (OpenAPI) | [infra/zap/regles.tsv](infra/zap/regles.tsv) |

Les rapports sont écrits dans `rapports-securite/`. Les quelques alertes ZAP ignorées sont justifiées une à une dans `regles.tsv`.

Ces contrôles tournent aussi sur GitHub à chaque push ([.github/workflows/securite.yml](.github/workflows/securite.yml)). Le workflow enchaîne les tests, les analyses statiques, puis la plateforme complète avec l'épreuve de bout en bout et ZAP.

Pour bloquer un secret avant même le commit, ajoutez Gitleaks en hook git :

```bash
printf '#!/bin/sh\ndocker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.28.0 git /repo --pre-commit --staged --config /repo/.gitleaks.toml --no-banner\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**Interfaces avec rechargement à chaud.** Le reste de la plateforme tourne dans Docker :

```bash
docker compose stop portal-agent    # libère le port 3001
cd frontend
npm install                         # une fois pour les trois portails
npm run dev -w agent                # citizen → 3002, supervision → 3003
```

Vite relaie `/api` vers la passerelle, comme nginx en production. Le code de `frontend/shared/` s'applique aux trois portails.

**Autres commandes utiles :**

- Reconstruire un seul portail : `docker compose up -d --build --no-deps portal-citizen`.
- Page de connexion : Keycloak tourne sans cache de thème, il suffit de modifier `infra/keycloak/themes/fasolink/login/` puis de recharger.
- Changement du realm : relancez `python scripts/init_env.py`, puis `docker compose up -d --force-recreate keycloak`.

**Jeton d'un système d'information** (flux *client credentials*) :

```bash
curl -X POST http://localhost:8080/realms/fasolink/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=admin-a -d client_secret=<ADMIN_A_CLIENT_SECRET du .env>
```

## Configuration avancée

Les secrets sont générés dans `.env` par `scripts/init_env.py` ; ce fichier n'est jamais versionné. Les réglages facultatifs s'y ajoutent, puis on relance `docker compose up -d --force-recreate gateway`.

| Variable | Effet |
|---|---|
| `FASOLINK_DEMO_MODE` | `1` (défaut) : sélection rapide, simulation de panne et téléphone simulé. `0` : tout cela disparaît |
| `FASOLINK_SMS_PROVIDER` | `simulateur` (défaut, aucun envoi réel) ou `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Envoi réel de SMS avec Twilio |
| `TWILIO_WEBHOOK_URL` | Adresse publique (ngrok…) où Twilio relaie les réponses ; la signature est vérifiée |
| `FASOLINK_VOICE_CONSENT`, `FASOLINK_PUBLIC_URL` | Accord par appel vocal (touches 1 / 2), pour les usagers qui ne lisent pas |
| `FASOLINK_SMS_DEMO_PHONES` | Remplace le téléphone fictif d'un IUE de démonstration par un vrai numéro |

Quelques précisions sur Twilio :

- Un compte d'essai n'envoie que des modèles prédéfinis, et seulement vers des numéros vérifiés.
- Au Burkina Faso, Twilio ne reçoit pas les réponses par SMS. L'appel vocal sert alors de canal de retour.
- En production, l'agrégateur de l'opérateur relaie les réponses sur `POST /sms/entrant`, authentifié par l'en-tête `X-SMS-Token`.

## Vers la production

Cette version est une démonstration. Pour un déploiement réel :

- **Infrastructure :**
  - Vault scellé avec stockage persistant ;
  - Keycloak en mode `start` avec TLS et base PostgreSQL ;
  - HTTPS partout.
- **Registres :**
  - remplacer les services `registry-*` ou renseigner `FASOLINK_REGISTRY_<CODE>_URL` ;
  - adapter les noms de champs dans [gateway/predicates.py](gateway/predicates.py) ;
  - enrôler les citoyens sur le modèle de [scripts/seed_demo.py](scripts/seed_demo.py).
- **Sécurité :**
  - authentifier la passerelle auprès des registres par certificat (mTLS) plutôt que par le jeton partagé de la démonstration ;
  - mettre `FASOLINK_DEMO_MODE=0`.
- **Validation juridique :** les bases légales marquées « À préciser » doivent être validées par un juriste.
- **Comptes de service :** le client `fasolink-cli` garde le flux « mot de passe » pour les scripts. Il est à supprimer.

## Dépannage

| Symptôme | Solution |
|---|---|
| Boucle de connexion ou « Invalid redirect uri » | Utilisez `localhost`, pas `127.0.0.1` |
| `vault-init` échoue avec « illegal option » | Fins de ligne Windows sur un script : `git add --renormalize .` puis `git checkout -- .` |
| Port 3001 à 3003 déjà occupé | Un `npm run dev` tourne encore, ou le conteneur du portail est démarré |
| Compte bloqué après plusieurs erreurs | Attendez une minute, ou débloquez-le dans la console Keycloak |
| Micro de l'assistant inactif | Chrome ou Edge, sur `localhost` ou en HTTPS, après autorisation du micro |

---

Les polices embarquées (Poppins, Public Sans, JetBrains Mono) sont distribuées sous licence SIL Open Font License.
