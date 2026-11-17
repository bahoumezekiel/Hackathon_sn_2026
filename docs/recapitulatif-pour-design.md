# FasoLink — Récapitulatif technique pour une proposition de design

> Ce document décrit **ce qui existe déjà et fonctionne** (API, écrans, technologies). Il sert de base à une proposition de design professionnel qui **ne change pas le fonctionnement** : mêmes écrans, mêmes données, mêmes appels API, nouvelle qualité visuelle et nouvelle expérience.

## 1. Le projet en bref

**FasoLink** est un socle d'interopérabilité administrative pour le Burkina Faso (hackathon, Challenge 2 « Dites-le nous une fois »). Son principe : les pièces circulent entre administrations, pas les usagers entre guichets.

- Une administration pose une question à un registre (état civil, nationalité, casier judiciaire). Par exemple : « ce candidat est-il majeur ? ».
- FasoLink répond par **Oui/Non signé**, ou par les seuls attributs autorisés par la loi, sans transmettre la donnée brute.
- Le **citoyen voit** qui a consulté ses données, pourquoi, et ce qui a été transmis. Il peut signaler un abus, aussi à la voix.
- Si un registre tombe en panne, le service **continue** (mode dégradé, file de relance).

**Trois publics, trois applications distinctes :**

| Public | Contexte d'usage | Attentes |
|---|---|---|
| Agent d'administration | Poste de guichet, ordinateur, usage répété toute la journée | Rapidité, clarté du résultat, confiance (signature) |
| Citoyen | **Téléphone** en priorité, niveau numérique variable, français (mooré et dioula à venir) | Simplicité, réassurance, transparence, accessibilité |
| Supervision (délégué à la protection des données, exploitation) | Grand écran, surveillance continue, démonstration au jury | Lecture d'un coup d'œil, alertes, état en temps réel |

## 2. Technologies utilisées

| Couche | Technologie | Remarque pour le design |
|---|---|---|
| Interfaces | **React 18.3 + Vite 5.4**, JavaScript (JSX) | **Aucune bibliothèque d'interface** (ni Tailwind, ni MUI) : CSS écrit à la main, un fichier `styles.css` par portail. On peut en introduire une. |
| Serveur des interfaces | nginx 1.27 (image Docker) | Relaie `/api/*` vers la passerelle |
| Authentification | **Keycloak 26** (OIDC, *Authorization Code + PKCE*), bibliothèque `keycloak-js` | La **page de connexion est celle de Keycloak**, avec son thème par défaut. Un thème Keycloak aux couleurs de FasoLink est à prévoir. |
| API | FastAPI (Python 3.12), documentation Swagger | Ne pas modifier |
| Base de données | PostgreSQL 16 | — |
| Moteur de politiques | Open Policy Agent (Rego) | Décide Autorisé / Partiel / Refusé, avec un motif lisible |
| Cache et résilience | Redis 7.4 | Disjoncteur, mode dégradé, file de relance |
| Chiffrement et signature | HashiCorp Vault (Transit) | Signature Ed25519 des attestations |
| Déploiement | Docker Compose (15 services) | — |
| Voix | Web Speech API du navigateur (Chrome/Edge, `fr-FR`) | Reconnaissance et synthèse vocale |

## 3. Les applications et leurs écrans

### 3.1 Portail administration — `portal-agent` (http://localhost:3001)

Rôle Keycloak `agent`. Comptes de démo (mot de passe `demo`) : `agent-a`, `agent-b`, `agent-c`, `agent-recrutement`, `agent-concours`, `agent-casier`, `agent-nationalite`.

**Écran unique en deux colonnes**, plus un écran de refus d'accès.

| Zone | Contenu actuel |
|---|---|
| Barre supérieure | Logo « ★ FasoLink » + étiquette « Guichet », nom de l'administration connectée, identifiant de l'agent, bouton « Se déconnecter » |
| Colonne gauche : « Nouvelle vérification » | 1) **Liste déroulante des démarches** autorisées pour l'administration. 2) **Encadré de la démarche** : description, « Pièces que l'usager n'a plus à fournir » (étiquettes barrées), « Informations obtenues directement » par registre (questions Oui/Non et attributs), mention « consentement requis », base légale, et éventuel rappel de compétence (⚖). 3) **Identifiant de l'usager** : bascule IUE / « Sans IUE (acte d'état civil) », champ de saisie, pastilles de citoyens fictifs (démo). 4) **Justification** (zone de texte, obligatoire). 5) Case « Demander aussi la date de naissance brute (démonstration d'un refus) ». 6) Bouton « Lancer la vérification ». |
| Colonne droite : « Dossiers traités » | Une **carte « dossier »** par envoi, la plus récente en haut (détail ci-dessous). |
| Écran de refus d'accès | « Portail réservé aux agents… », bouton « Se connecter avec un compte agent ». |

**Carte « dossier »** (composant `DossierCard`) :
- **En-tête :** nom de la démarche, pastille du statut d'identité (« Procédure alternative (sans IUE) », « Enrôlement en cours »), identifiant de l'usager.
- **Synthèse en grand :** « Toutes les conditions sont remplies (4/4) » en vert, « Dossier incomplet — 2/4 » en rouge, « En attente… » en ocre, ou « Informations d'état civil reçues ».
- **Bandeau « N pièce(s) que l'usager n'a pas eu à fournir : … ».**
- **Un bloc par registre interrogé :**
  - nom du registre et pastille d'état (Autorisé, Partiel, Refusé, En attente, Mode dégradé, Relancée automatiquement, Échec) ;
  - motif en cas de refus ou de refus partiel ;
  - **lignes question → verdict** (« Âge conforme aux conditions (18–35 ans) » → **Oui**/**Non**), ou **tableau d'attributs** (Nom, Prénoms, Date de naissance, Lieu de naissance, Sexe, Père, Mère) ;
  - bandeau « mode dégradé » avec la date de la donnée réutilisée ;
  - volet repliable « Attestation signée » : jeton JWS et bouton « Vérifier la signature », qui affiche « Signature valide (Vault · Ed25519) ».
- La carte **se met à jour toute seule** quand un registre en panne revient (interrogation toutes les 2 s, avec un flash vert).

### 3.2 Portail citoyen — `portal-citizen` (http://localhost:3002)

Rôle Keycloak `citizen`. Identifiant : l'IUE en minuscules (`bf1998000123`) ou la référence d'acte s'il n'y a pas d'IUE (`ec-fdg-2001-000222`). Mot de passe `demo`. **Conçu d'abord pour le téléphone** (colonne de 640 px maximum).

| Zone | Contenu actuel |
|---|---|
| En-tête (dégradé vert vers bordeaux, coins arrondis en bas) | « ★ FasoLink », bouton « Déconnexion », **« Bonjour Awa Ouédraogo »**, « 15 demande(s) ont concerné vos données · IUE ••••0123 ». **Encart jaune « 11 pièce(s) justificative(s) que vous n'avez pas eu à fournir »**. Encart « ✔ Journal d'audit intact — 132 événements chaînés… » (rouge en cas d'altération). |
| Onglets fixes (pilules) | « 👁 Mes accès », « 🎤 Assistant », « ✋ Consentements » |
| Onglet « Mes accès » | **Liste chronologique de cartes** avec une bordure gauche colorée (vert = autorisé, rouge = refusé, ocre = en attente). Chaque carte contient : « il y a 12 s », nom de l'administration, démarche et registre, encadré du résultat (« Transmis : **Majeur : Oui** », « Accès refusé — motif », ou liste des attributs transmis avec leurs valeurs), mention « réponse réutilisée » en mode dégradé, bandeau « 📄 Pièce que vous n'avez pas eu à fournir », puis le détail : motif déclaré par l'agent, « Lu par FasoLink : date_naissance (jamais transmis) », preuve (#numéro et empreinte). Bouton « Je ne reconnais pas cet accès », qui ouvre une zone de texte et « Envoyer le signalement » ; une fois envoyé, l'étiquette « Signalement envoyé » s'affiche. Rafraîchissement toutes les 3 s. |
| Onglet « Assistant » | Fil de conversation en bulles (assistant à gauche, citoyen à droite en vert). Suggestions : « Qui a consulté mes données ? », « Quelles pièces m'ont été évitées ? », « Y a-t-il eu des refus ? », « Je veux signaler le dernier accès ». En bas : **bouton micro rond** (rouge et pulsant pendant l'écoute), champ texte, bouton « Envoyer ». Les réponses sont aussi lues à voix haute. |
| Onglet « Consentements » | Texte d'explication, puis une carte par démarche soumise à consentement (administration, démarche, registre) avec un **interrupteur** on/off. |
| Écran de refus d'accès | « Espace réservé aux citoyens », bouton de reconnexion. |

### 3.3 Portail supervision — `portal-supervision` (http://localhost:3003)

Rôle Keycloak `supervisor`. Compte `superviseur` / `demo`. **Thème sombre**, grand écran, rafraîchi toutes les 2 s.

| Zone | Contenu actuel |
|---|---|
| Barre supérieure | « ★ FasoLink / Supervision », voyant « ● EN DIRECT » pulsant, utilisateur, « Déconnexion » |
| **5 indicateurs** | Pièces justificatives évitées aux citoyens (jaune) · Refusées par OPA (rouge) · Servies en mode dégradé (ocre) · Alertes citoyennes ouvertes · Composants du socle « 5/5 » |
| Registres connectés (3 cartes) | Nom et code, voyant, état (Opérationnel, Instable, En panne), disjoncteur (fermé, ou ouvert depuis X s), échecs « 0/3 », demandes en file, dernier contrôle. Bouton **« Simuler une panne »** ou **« Rétablir le registre »** (démo jury). |
| Flux des demandes (tableau) | Heure · Administration · Démarche · Registre · État (pastille colorée, avec ×N relances). **Aucune identité de citoyen.** |
| Colonne droite | **Impact « Dites-le nous une fois »** : nombre par type de pièce évitée, puis par démarche (abouties / total). **Socle technique** : PostgreSQL, Keycloak, OPA, Redis, Vault avec leurs voyants, et la taille de la file de relance. **Journal d'audit** : « Intègre » ou « Rompu à #N », nombre d'événements, empreinte de tête. **Alertes citoyennes** : canal (🎤 ou 💬), administration contestée, démarche, ancienneté, texte, boutons Prendre en charge / Résoudre / Rejeter. |

### 3.4 Pages hors portails
- **Connexion Keycloak** (http://localhost:8080) : thème Keycloak par défaut, en anglais. **À habiller.**
- **Swagger** (http://localhost:8000/docs) : documentation de l'API, non concernée par le design.

## 4. Endpoints de l'API

Base : `http://localhost:8000`. Depuis un portail, on l'appelle via `/api/...` (relais nginx). Authentification : `Authorization: Bearer <jeton Keycloak>`.

### Public
| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/health` | État de la passerelle |
| GET | `/health/stack` | État des 5 composants du socle |
| GET | `/.well-known/jwks.json` | Clé publique pour vérifier les attestations |
| POST | `/v1/attestations/verify` | Vérifie une attestation signée → `{valid, claims, display}` |
| GET | `/demo/config` | Démo uniquement : comptes et citoyens fictifs (pastilles) |

### Administration (rôle `agent`)
| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/v1/purposes` | Démarches autorisées, regroupées : `label`, `description`, `replaces[]` (pièces évitées), `decision_note`, `checks[]` (par registre : `predicates[]`, `attributes[]`, `requires_consent`, `legal_basis`) |
| POST | `/v1/verifications` | Envoi : `{citizen: {iue} \| {registry, local_reference}, purpose_code, predicates[], attributes[], justification}` → `{identity_status, results[]}` (un résultat par registre) |
| GET | `/v1/requests/{id}` | Relit un résultat (suivi d'une demande en attente) |

Forme d'un **résultat** (un registre) :
```json
{
  "request_id": "…", "registry": {"code": "ETAT_CIVIL", "name": "Registre de l'état civil"},
  "purpose_code": "CANDIDATURE_RECRUTEMENT", "purpose_label": "Candidature à un recrutement public",
  "status": "COMPLETED | DENIED | QUEUED | PROCESSING | FAILED",
  "decision": "PERMIT | PARTIAL | DENY", "decision_reason": "Conforme à la politique …",
  "service_mode": "NORMAL | DEGRADED_CACHE | QUEUED_RETRY",
  "documents_replaced": ["Extrait d'acte de naissance"],
  "attestations": [
    {"predicate": "age_eligible", "value": true, "display": "Âge conforme aux conditions (18–35 ans) : Oui",
     "observed_at": "…", "expires_at": "…", "served_from_cache": false, "jws": "eyJ…"},
    {"predicate": "attributs_etat_civil", "value": {"nom": "Ouédraogo", "pere": "…"}, "display": "Attributs transmis : Nom, Père", "…": "…"}
  ]
}
```

### Citoyen (rôle `citizen`)
| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/citizen/history` | `{identity_status, iue_hint, accesses[]}`. Chaque accès contient : administration, `purpose_label`, registre, statut et décision, motif, `service_mode`, justification, `shared[]` (transmis), `fields_read[]` (lus), `documents_avoided[]`, `proof {seq, hash}`, `alerted` |
| GET | `/citizen/integrity` | `{intact, events, head_hash}` |
| POST | `/citizen/alerts` | Signaler un accès : `{request_id, description, channel: WEB \| VOICE}` |
| GET | `/citizen/consents` | Démarches soumises à consentement, avec leur statut |
| POST | `/citizen/consents` | `{policy_code, grant: true \| false}` |

### Supervision (rôle `supervisor`)
| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/supervision/registries` | Registres : statut, disjoncteur, échecs, file, dernier contrôle |
| POST | `/supervision/registries/{code}/simulate` | Démo : `{down: true \| false}` |
| GET | `/supervision/requests` | 25 dernières demandes, sans identité |
| GET | `/supervision/impact` | `{documents_avoided, by_document[], by_purpose[]}` |
| GET | `/supervision/stack` | Composants du socle et taille de la file de relance |
| GET | `/supervision/alerts` | Alertes citoyennes |
| POST | `/supervision/alerts/{id}` | `{status: IN_REVIEW \| RESOLVED \| REJECTED}` |
| GET | `/supervision/integrity` | Intégrité de la chaîne d'audit |

## 5. Les démarches (catalogue) affichées dans les écrans

| Démarche | Administration | Ce qui est transmis |
|---|---|---|
| Vérification de majorité | Administration A | Majeur : Oui/Non |
| Vérification de nationalité | Administration B | Nationalité burkinabè : Oui/Non |
| Vérification du casier (emploi) | Administration C | Casier compatible : Oui/Non (consentement) |
| **Candidature à un recrutement public** | Entreprise publique — DRH | 4 Oui/Non sur **3 registres** en un envoi |
| **Demande de bulletin n°3** | Casier judiciaire national | Identité et filiation (7 attributs) |
| **Instruction d'un certificat de nationalité** | Service de la nationalité | Faits d'état civil et filiation, avec un rappel de compétence |
| **Condition d'âge (concours, formation)** | Direction des examens et concours | Âge conforme (18–30 ans) : Oui/Non |

## 6. Identité visuelle actuelle (à faire évoluer)

- **Couleurs :** vert institutionnel `#0b6e4f` (principal), rouge `#c8102e`, jaune étoile `#fcd116`. Elles reprennent le drapeau du Burkina Faso, sans le reproduire.
- **États :** vert = autorisé ou oui, rouge = refusé ou non, ocre `#8a6300` / `#e2a400` = en attente ou mode dégradé, gris = neutre.
- **Typographie :** police système (Segoe UI, system-ui). Aucune police de marque.
- **Logo :** provisoire, une étoile « ★ » suivie du mot FasoLink.
- **Ambiance par portail :**
  - administration : clair et sobre ;
  - citoyen : chaleureux, fond sable `#f7f1e6`, cartes arrondies ;
  - supervision : sombre, `#0e1412`.
- **Icônes :** émojis (👁 🎤 ✋ 📄 ⚖ 💬). À remplacer par un vrai jeu d'icônes.

## 7. Contraintes à respecter

- **Ne pas changer** : appels API, champs affichés, rôles, flux de connexion Keycloak (PKCE), rafraîchissements automatiques.
- **Les trois portails restent des applications séparées** (un `package.json`, une image Docker chacune). Un jeu de composants ou de jetons de design partagé est possible, mais copié ou publié comme paquet.
- **Accessibilité :** contrastes AA, ne jamais signaler un état par la couleur seule (le texte « Oui »/« Non » et les pastilles le font déjà), cibles tactiles d'au moins 44 px côté citoyen, zones `aria-live` pour les mises à jour automatiques.
- **Langue :** français. Prévoir des textes plus longs pour le mooré et le dioula.
- **Réseau :** le portail citoyen doit rester léger (mobile, réseau limité) ; le JS fait aujourd'hui environ 58 Ko compressé.
- **Mentions de démonstration à garder visibles :** pastilles de citoyens fictifs, case « démonstration d'un refus », boutons de panne simulée.

## 8. Ce que j'attends de la proposition de design

1. Une identité visuelle (logo, palette, typographie, icônes) crédible pour une **infrastructure numérique publique** burkinabè.
2. Des **jetons de design** communs (couleurs, espacements, rayons, ombres, états) déclinés par portail.
3. Une maquette de chaque écran listé en section 3, **avec ses états** : vide, chargement, autorisé, partiel, refusé, en attente, mode dégradé, erreur, accès refusé.
4. Un **thème pour la page de connexion Keycloak**.
5. Des recommandations de mise en œuvre compatibles avec React + Vite. Par exemple, faut-il adopter une bibliothèque (Tailwind, shadcn/ui, Mantine…) ou rester en CSS pur ?
