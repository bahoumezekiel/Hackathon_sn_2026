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
        "source_fields": ["condamnations.categorie", "condamnations.peine"],
    },
}

MAJORITY_AGE = 18

# Catégories de condamnation connues du casier (choix proposés à l'administrateur)
CASIER_CATEGORIES = {
    "VOL": "Vol", "FRAUDE": "Fraude, escroquerie", "CORRUPTION": "Corruption",
    "DETOURNEMENT": "Détournement de biens publics", "VIOLENCE": "Violences aux personnes",
    "STUPEFIANTS": "Stupéfiants", "ROUTIER": "Infractions routières",
}

# Règles par défaut des finalités historiques. Les cas d'usage créés par l'administrateur
# portent leurs propres règles (data_access_policy.parametres). À valider juridiquement.
INCOMPATIBLE_BY_PURPOSE = {
    "VERIF_CASIER_EMPLOI": {"VOL", "FRAUDE", "CORRUPTION", "DETOURNEMENT", "VIOLENCE"},
}


class PredicateError(Exception):
    pass


def age_on(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _casier_rule(purpose_code: str, params: dict) -> tuple[set, bool]:
    """(catégories incompatibles, ignorer les peines avec sursis) pour cette finalité."""
    if "categories_incompatibles" in params:
        return ({str(c).upper() for c in params["categories_incompatibles"]},
                bool(params.get("ignorer_sursis", False)))
    if purpose_code in INCOMPATIBLE_BY_PURPOSE:
        return INCOMPATIBLE_BY_PURPOSE[purpose_code], False
    raise PredicateError(f"aucune règle d'appréciation pour la finalité {purpose_code}")


def compute(predicate: str, record: dict, purpose_code: str, today: date | None = None,
            params: dict | None = None):
    today = today or date.today()
    params = params or {}
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
        incompatible, skip_suspended = _casier_rule(purpose_code, params)
        return not any(str(c.get("categorie", "")).upper() in incompatible
                       and not (skip_suspended and "sursis" in str(c.get("peine", "")).lower())
                       for c in record.get("condamnations", []))

    raise PredicateError(f"prédicat inconnu : {predicate}")


def display(predicate: str, value) -> str:
    label = PREDICATES.get(predicate, {}).get("label", predicate)
    if isinstance(value, bool):
        return f"{label} : {'Oui' if value else 'Non'}"
    return f"{label} : {value}"
