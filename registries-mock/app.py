"""Registre administratif simulé (état civil, nationalité ou casier).

Une instance par registre, choisi par la variable REGISTRY_CODE.
Renvoie l'enregistrement COMPLET : c'est FasoLink qui minimise.
/_chaos permet de simuler une panne pendant la démonstration.
À remplacer par un adaptateur vers les registres fournis par le jury.
"""
import json
import os
import pathlib

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

CODE = os.environ.get("REGISTRY_CODE", "ETAT_CIVIL").upper()
TOKEN = os.environ.get("FASOLINK_REGISTRY_TOKEN", "")
SECTION = {"ETAT_CIVIL": "etat_civil", "NATIONALITE": "nationalite", "CASIER": "casier"}[CODE]

_data = json.loads((pathlib.Path(__file__).parent / "data" / "citoyens_fictifs.json")
                   .read_text(encoding="utf-8"))
RECORDS = {c[SECTION]["ref"]: {k: v for k, v in c[SECTION].items() if k != "ref"}
           for c in _data if c.get(SECTION)}

state = {"down": False}
app = FastAPI(title=f"Registre simulé — {CODE}")


def _check(token: str | None) -> None:
    if not TOKEN or token != TOKEN:
        raise HTTPException(401, "Jeton de registre invalide")


@app.get("/health")
def health():
    if state["down"]:
        raise HTTPException(503, "Registre en panne (simulation)")
    return {"status": "UP", "registry": CODE, "records": len(RECORDS)}


@app.get("/records/{local_reference}")
def get_record(local_reference: str, x_registry_token: str | None = Header(None)):
    _check(x_registry_token)
    if state["down"]:
        raise HTTPException(503, "Registre en panne (simulation)")
    record = RECORDS.get(local_reference.strip().upper())
    if record is None:
        raise HTTPException(404, "Référence inconnue")
    return record


class Chaos(BaseModel):
    down: bool


@app.post("/_chaos")
def chaos(body: Chaos, x_registry_token: str | None = Header(None)):
    _check(x_registry_token)
    state["down"] = body.down
    return {"registry": CODE, "down": state["down"]}
