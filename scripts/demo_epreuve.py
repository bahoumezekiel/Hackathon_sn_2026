"""Rejoue l'épreuve en direct de bout en bout (sert aussi de test d'intégration).

    docker compose up -d --build
    python scripts/demo_epreuve.py

Toutes les requêtes passent par des jetons Keycloak. Code de sortie 0 si tout est vert.
"""
import json
import pathlib
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
http = httpx.Client(base_url=BASE, timeout=15)
failures = 0
ENV = dict(line.split("=", 1) for line in
           (pathlib.Path(__file__).resolve().parent.parent / ".env").read_text(encoding="utf-8").splitlines()
           if "=" in line and not line.startswith("#"))


def check(label: str, condition: bool, detail="") -> None:
    global failures
    print(f"  {'OK ' if condition else 'ÉCHEC'}  {label}" + (f"  — {detail}" if detail else ""))
    if not condition:
        failures += 1


def title(text: str) -> None:
    print(f"\n=== {text} ===")


cfg = http.get("/demo/config").raise_for_status().json()
KC = cfg["keycloak"]
TOKEN_URL = f"{KC['url']}/realms/{KC['realm']}/protocol/openid-connect/token"


def kc_token(**form) -> dict:
    r = httpx.post(TOKEN_URL, data=form, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def user_token(username: str) -> dict:
    """Compte humain (agent, superviseur, citoyen) — flux mot de passe de démonstration."""
    return kc_token(grant_type="password", client_id=KC["client_id"], username=username,
                    password=cfg["demo_password"])


AGENT = {a["code"]: user_token(a["username"]) for a in cfg["agents"]}
SUP = user_token(cfg["supervisor"])


def verify(admin, citizen, purpose, predicates, justification="Dossier usager n° 2026-118 au guichet",
           headers=None, attributes=()):
    r = http.post("/v1/verifications", headers=headers or AGENT[admin],
                  json={"citizen": citizen, "purpose_code": purpose, "predicates": predicates,
                        "attributes": list(attributes), "justification": justification})
    r.raise_for_status()
    return r.json()


def first(resp):
    return resp["results"][0]


def value(result, predicate):
    return next((a["value"] for a in result["attestations"] if a["predicate"] == predicate), None)


AWA = {"iue": "BF1998000123"}
ISSOUF = {"iue": "BF2010000456"}
MARIAM = {"iue": "BF1985000789"}
SALIF = {"iue": "BF1979001012"}
AMINATA = {"registry": "ETAT_CIVIL", "local_reference": "EC-FDG-2001-000222"}
FATIMATA = {"iue": "BF1990001415"}
ADAMA = {"iue": "BF2008001617"}

# S'assurer que les registres sont en marche au départ
for code in ("ETAT_CIVIL", "NATIONALITE", "CASIER"):
    http.post(f"/supervision/registries/{code}/simulate", headers=SUP, json={"down": False})

# ---------------------------------------------------------------------------
title("Épreuve 1 — Ne transmettre que l'utile")
res = first(verify("ADMIN_A", AWA, "VERIF_MAJORITE", ["est_majeur"]))
raw = json.dumps(res)
check("Administration A : Awa est majeure", value(res, "est_majeur") is True,
      res["attestations"][0]["display"] if res["attestations"] else res)
check("Aucune date de naissance dans la réponse", "1998" not in raw and "date_naissance" not in raw)
check("Réponse signée (JWS)", res["attestations"][0]["jws"].count(".") == 2)
ver = http.post("/v1/attestations/verify", json={"jws": res["attestations"][0]["jws"]}).json()
check("Signature vérifiable publiquement", ver["valid"] is True)
falsified = res["attestations"][0]["jws"][:-4] + "AAAA"
check("Attestation falsifiée rejetée",
      http.post("/v1/attestations/verify", json={"jws": falsified}).json()["valid"] is False)

res = first(verify("ADMIN_A", ISSOUF, "VERIF_MAJORITE", ["est_majeur"]))
check("Issouf (16 ans) : majeur = Non", value(res, "est_majeur") is False)

res = first(verify("ADMIN_B", SALIF, "VERIF_NATIONALITE", ["nationalite_burkinabe"]))
check("Administration B : Salif n'est pas burkinabè", value(res, "nationalite_burkinabe") is False)

res = verify("ADMIN_A", AWA, "VERIF_MAJORITE", ["est_majeur", "nationalite_burkinabe"])
decisions = {r["registry"]["code"]: r["decision"] for r in res["results"]}
check("A ne peut pas interroger la nationalité (finalité non autorisée)",
      decisions == {"ETAT_CIVIL": "PERMIT", "NATIONALITE": "DENY"}, decisions)

res = first(verify("ADMIN_C", ISSOUF, "VERIF_CASIER_EMPLOI", ["casier_compatible_finalite"]))
check("Casier sans consentement : refusé", res["decision"] == "DENY", res["decision_reason"])
res = first(verify("ADMIN_C", MARIAM, "VERIF_CASIER_EMPLOI", ["casier_compatible_finalite"]))
check("Casier de Mariam : incompatible (Non), sans détail de la condamnation",
      value(res, "casier_compatible_finalite") is False and "FRAUDE" not in json.dumps(res))
res = first(verify("ADMIN_A", AWA, "VERIF_MAJORITE", ["est_majeur"], justification=""))
check("Justification obligatoire", res["decision"] == "DENY", res["decision_reason"])

res = first(verify("ADMIN_A", AMINATA, "VERIF_MAJORITE", ["est_majeur"]))
check("Aminata sans IUE : procédure alternative", value(res, "est_majeur") is True)

# Système d'information de l'administration B : jeton machine (client credentials)
machine = kc_token(grant_type="client_credentials", client_id="admin-b",
                   client_secret=ENV["ADMIN_B_CLIENT_SECRET"])
res = first(verify("ADMIN_B", FATIMATA, "VERIF_NATIONALITE", ["nationalite_burkinabe"], headers=machine))
check("Échange machine à machine (Keycloak client credentials)",
      value(res, "nationalite_burkinabe") is True)
check("Sans jeton : accès refusé", http.post("/v1/verifications", json={}).status_code == 401)
check("Citoyen ne peut pas interroger un registre",
      http.get("/v1/purposes", headers=user_token("bf1998000123")).status_code == 403)

# ---------------------------------------------------------------------------
title("Épreuve 2 — Montrer à l'usager qui a consulté ses données")
auth = user_token("bf1998000123")  # Awa se connecte avec son IUE
hist = http.get("/citizen/history", headers=auth).raise_for_status().json()
admins = {a["administration"] for a in hist["accesses"]}
check("Awa voit les consultations de l'Administration A", "Administration A" in admins, admins)
check("Elle voit la tentative refusée (nationalité)",
      any(a["decision"] == "DENY" for a in hist["accesses"]))
granted = next(a for a in hist["accesses"] if a["shared"])
check("Elle voit ce qui a été transmis et ce que FasoLink a lu",
      granted["shared"][0]["display"] == "Majeur : Oui" and granted["fields_read"] == ["date_naissance"],
      f"{granted['shared'][0]['display']} / lu : {granted['fields_read']}")
integ = http.get("/citizen/integrity", headers=auth).json()
check("Journal d'audit intègre", integ["intact"], f"{integ['events']} événements chaînés")
alert = http.post("/citizen/alerts", headers=auth,
                  json={"request_id": granted["id"], "description": "Je ne connais pas cette démarche",
                        "channel": "VOICE"}).raise_for_status().json()
check("Alerte citoyenne enregistrée", alert["status"] == "OPEN")

# ---------------------------------------------------------------------------
title("Épreuve 3 — Tenir quand un registre tombe en panne")
first(verify("ADMIN_A", FATIMATA, "VERIF_MAJORITE", ["est_majeur"]))  # amorce le cache autorisé
http.post("/supervision/registries/ETAT_CIVIL/simulate", headers=SUP, json={"down": True})
print("  ... registre de l'état civil mis en panne")

res = first(verify("ADMIN_A", FATIMATA, "VERIF_MAJORITE", ["est_majeur"]))
check("Mode dégradé : réponse issue d'une attestation récente",
      res["service_mode"] == "DEGRADED_CACHE" and value(res, "est_majeur") is True, res["service_mode"])

res = first(verify("ADMIN_A", ADAMA, "VERIF_MAJORITE", ["est_majeur"]))
check("Sans attestation récente : demande mise en file d'attente",
      res["status"] == "QUEUED", res["status"])
queued_id = res["request_id"]

res = first(verify("ADMIN_C", MARIAM, "VERIF_CASIER_EMPLOI", ["casier_compatible_finalite"]))
check("Les autres registres continuent de répondre", res["status"] == "COMPLETED")

regs = {r["code"]: r for r in http.get("/supervision/registries", headers=SUP).json()}
check("Supervision : panne détectée", regs["ETAT_CIVIL"]["status"] in ("DOWN", "DEGRADED"),
      regs["ETAT_CIVIL"]["status"])

http.post("/supervision/registries/ETAT_CIVIL/simulate", headers=SUP, json={"down": False})
print("  ... registre rétabli, attente de la relance automatique")
deadline = time.time() + 40
state = None
while time.time() < deadline:
    state = http.get(f"/v1/requests/{queued_id}", headers=AGENT["ADMIN_A"]).json()
    if state["status"] != "QUEUED" and state["status"] != "PROCESSING":
        break
    time.sleep(1)
check("Demande relancée et traitée au retour du registre", state["status"] == "COMPLETED",
      f"{state['status']} — {state['attestations'][0]['display'] if state['attestations'] else ''}")

integ = http.get("/supervision/integrity", headers=SUP).json()
check("Journal toujours intègre après la panne", integ["intact"], f"{integ['events']} événements")

# ---------------------------------------------------------------------------
RASMANE = {"registry": "ETAT_CIVIL", "local_reference": "EC-OHG-1993-000333"}
RECRUT = ["acte_naissance_valide", "age_eligible", "nationalite_burkinabe", "casier_compatible_finalite"]
IDENTITE = ["nom", "prenoms", "date_naissance", "lieu_naissance", "sexe", "pere", "mere"]


def values(resp) -> dict:
    return {a["predicate"]: a["value"] for r in resp["results"] for a in r["attestations"]}


title("Cas d'usage 1 — Candidature à un recrutement public (3 registres, une demande)")
res = verify("RECRUTEMENT", AWA, "CANDIDATURE_RECRUTEMENT", RECRUT)
v = values(res)
check("Awa : un seul envoi interroge état civil, nationalité et casier",
      {r["registry"]["code"] for r in res["results"]} == {"ETAT_CIVIL", "NATIONALITE", "CASIER"})
check("Awa : dossier administratif complet (4/4 conditions)", all(v.get(p) is True for p in RECRUT), v)
docs = [d for r in res["results"] for d in r["documents_replaced"]]
check("3 pièces évitées au candidat", len(docs) == 3, " · ".join(docs))
v = values(verify("RECRUTEMENT", MARIAM, "CANDIDATURE_RECRUTEMENT", RECRUT))
check("Mariam (41 ans, condamnation) : âge et casier non conformes, nationalité conforme",
      v.get("age_eligible") is False and v.get("casier_compatible_finalite") is False
      and v.get("nationalite_burkinabe") is True, v)
res = verify("RECRUTEMENT", ISSOUF, "CANDIDATURE_RECRUTEMENT", RECRUT)
casier = next(r for r in res["results"] if r["registry"]["code"] == "CASIER")
check("Issouf : casier refusé faute de consentement du candidat", casier["decision"] == "DENY",
      casier["decision_reason"])
res = verify("RECRUTEMENT", AWA, "CANDIDATURE_RECRUTEMENT", RECRUT, attributes=["date_naissance"])
ec = next(r for r in res["results"] if r["registry"]["code"] == "ETAT_CIVIL")
check("Le recruteur n'obtient pas la date de naissance brute (refus partiel OPA)",
      ec["decision"] == "PARTIAL" and "1998" not in json.dumps(ec["attestations"][0]["value"]), ec["decision_reason"])

title("Cas d'usage 2 — Demande de bulletin n°3 (identité et filiation)")
res = verify("CASIER", AWA, "DELIVRANCE_BULLETIN_3", [], attributes=IDENTITE)
attrs = values(res).get("attributs_etat_civil") or {}
check("Le service du casier reçoit identité et filiation sans téléversement d'acte",
      attrs.get("pere") == "Ouédraogo Issaka" and attrs.get("mere") == "Sawadogo Aminata", attrs)
check("Pièce évitée : extrait d'acte de naissance", res["results"][0]["documents_replaced"] != [],
      res["results"][0]["documents_replaced"])
res = verify("CASIER", AMINATA, "DELIVRANCE_BULLETIN_3", [], attributes=IDENTITE)
check("Fonctionne aussi pour une citoyenne sans IUE (Aminata)",
      (values(res).get("attributs_etat_civil") or {}).get("prenoms") == "Aminata")
res = verify("CASIER", AWA, "DELIVRANCE_BULLETIN_3", ["nationalite_burkinabe"], attributes=["nom"])
check("Le service du casier ne peut pas consulter la nationalité",
      next(r for r in res["results"] if r["registry"]["code"] == "NATIONALITE")["decision"] == "DENY")

title("Cas d'usage 3 — Instruction d'un certificat de nationalité")
res = verify("NATIONALITE", FATIMATA, "INSTRUCTION_CERTIFICAT_NATIONALITE", [],
             attributes=["nom", "prenoms", "date_naissance", "lieu_naissance", "pere", "mere"])
attrs = values(res).get("attributs_etat_civil") or {}
check("Le service de la nationalité reçoit les faits d'état civil et la filiation",
      attrs.get("lieu_naissance") == "Banfora" and attrs.get("pere") == "Sanou Bakary", attrs)
purposes_nat = http.get("/v1/purposes", headers=AGENT["NATIONALITE"]).json()["purposes"]
note = next(p for p in purposes_nat if p["purpose_code"] == "INSTRUCTION_CERTIFICAT_NATIONALITE")["decision_note"]
check("Rappel : la décision sur la nationalité reste au service compétent", bool(note) and "compétence" in note)
res = verify("NATIONALITE", FATIMATA, "INSTRUCTION_CERTIFICAT_NATIONALITE", [], attributes=["nom", "sexe"])
check("Attribut hors politique (sexe) refusé", res["results"][0]["decision"] == "PARTIAL",
      res["results"][0]["decision_reason"])

title("Cas d'usage 4 — Condition d'âge pour un concours (18–30 ans)")
res = verify("CONCOURS", AWA, "ELIGIBILITE_AGE", ["age_eligible"])
att = res["results"][0]["attestations"][0]
check("Awa (28 ans) : éligible", att["value"] is True, att["display"])
check("Rasmané (33 ans, enrôlement en cours) : non éligible",
      values(verify("CONCOURS", RASMANE, "ELIGIBILITE_AGE", ["age_eligible"])).get("age_eligible") is False)
claims = http.post("/v1/attestations/verify", json={"jws": att["jws"]}).json()["claims"]
check("Bornes d'âge fixées par la politique et inscrites dans l'attestation",
      claims.get("conditions") == {"min_age": 18, "max_age": 30}, claims.get("conditions"))
res = verify("CONCOURS", AWA, "ELIGIBILITE_AGE", [], attributes=["date_naissance"])
check("L'organisateur ne peut pas obtenir la date de naissance", res["results"][0]["decision"] == "DENY")

title("Impact « Dites-le nous une fois »")
hist = http.get("/citizen/history", headers=user_token("bf1998000123")).json()
avoided = [d for a in hist["accesses"] for d in a["documents_avoided"]]
check("Awa voit les pièces qu'elle n'a pas eu à fournir", len(avoided) >= 4, f"{len(avoided)} pièces")
b3 = [s["value"] for a in hist["accesses"] if a["purpose_code"] == "DELIVRANCE_BULLETIN_3"
      for s in a["shared"] if isinstance(s["value"], dict)]
check("Elle voit que sa filiation a été transmise au service du casier",
      any("pere" in v and "mere" in v for v in b3), f"{len(b3)} transmission(s) d'attributs")
impact = http.get("/supervision/impact", headers=SUP).json()
check("Supervision : compteur de pièces évitées", impact["documents_avoided"] > 0,
      f"{impact['documents_avoided']} pièces évitées")

stack = http.get("/supervision/stack", headers=SUP).json()["components"]
check("Socle technique complet opérationnel", all(s["up"] for s in stack),
      ", ".join(f"{s['component']}={'OK' if s['up'] else 'KO'}" for s in stack))

print(f"\n{'TOUT EST VERT' if failures == 0 else f'{failures} vérification(s) en échec'}")
sys.exit(1 if failures else 0)
