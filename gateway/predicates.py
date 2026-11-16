"""Moteur de minimisation : transforme un enregistrement brut en réponse Oui/Non.

La donnée brute (date de naissance, condamnations...) n'est jamais persistée
ni transmise : seul le prédicat calculé sort de FasoLink.
"""
from datetime import date

PREDICATES = {
    "est_majeur": {
        "registry": "ETAT_CIVIL", "label": "Majeur",
        "source_fields": ["date_naissance"],
    },
    "nationalite_burkinabe": {
        "registry": "NATIONALITE", "label": "Nationalité burkinabè",
        "source_fields": ["nationalite", "statut"],
    },
    "casier_compatible_finalite": {
        "registry": "CASIER", "label": "Casier compatible avec la finalité",
        "source_fields": ["condamnations.categorie"],
    },
}

MAJORITY_AGE = 18

# Catégories de condamnation incompatibles, par finalité. À valider juridiquement.
INCOMPATIBLE_BY_PURPOSE = {
    "VERIF_CASIER_EMPLOI": {"VOL", "FRAUDE", "CORRUPTION", "DETOURNEMENT", "VIOLENCE"},
}


class PredicateError(Exception):
    pass


def age_on(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def compute(predicate: str, record: dict, purpose_code: str, today: date | None = None):
    today = today or date.today()
    if predicate == "est_majeur":
        raw = record.get("date_naissance")
        if not raw:
            raise PredicateError("date de naissance absente du registre")
        return age_on(date.fromisoformat(raw), today) >= MAJORITY_AGE

    if predicate == "nationalite_burkinabe":
        nationality = str(record.get("nationalite", "")).strip().upper()
        status = str(record.get("statut", "VALIDE")).strip().upper()
        return nationality in {"BF", "BFA", "BURKINABE", "BURKINABÈ"} and status == "VALIDE"

    if predicate == "casier_compatible_finalite":
        if purpose_code not in INCOMPATIBLE_BY_PURPOSE:
            raise PredicateError(f"aucune règle d'appréciation pour la finalité {purpose_code}")
        incompatible = INCOMPATIBLE_BY_PURPOSE[purpose_code]
        return not any(str(c.get("categorie", "")).upper() in incompatible
                       for c in record.get("condamnations", []))

    raise PredicateError(f"prédicat inconnu : {predicate}")


def display(predicate: str, value) -> str:
    label = PREDICATES.get(predicate, {}).get("label", predicate)
    if isinstance(value, bool):
        return f"{label} : {'Oui' if value else 'Non'}"
    return f"{label} : {value}"
