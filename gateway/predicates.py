"""Moteur de minimisation.

Deux formes de réponse, toutes deux décidées par OPA selon la politique :
  * PRÉDICATS : une question fermée (« est majeur ? ») → Oui/Non. La donnée
    brute est lue puis jetée, jamais transmise.
  * ATTRIBUTS : quelques champs précis, quand la mission l'exige (identité et
    filiation pour le bulletin n°3). Seuls les champs autorisés sont extraits.
"""
from datetime import date

PREDICATES = {
    "est_majeur": {
        "registry": "ETAT_CIVIL", "label": "Majeur",
        "source_fields": ["date_naissance"],
    },
    "acte_naissance_valide": {
        "registry": "ETAT_CIVIL", "label": "Acte de naissance enregistré",
        "source_fields": ["acte de naissance"],
    },
    "age_eligible": {
        "registry": "ETAT_CIVIL", "label": "Âge conforme aux conditions",
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

ATTRIBUTES = {
    "nom": {"registry": "ETAT_CIVIL", "label": "Nom"},
    "prenoms": {"registry": "ETAT_CIVIL", "label": "Prénoms"},
    "date_naissance": {"registry": "ETAT_CIVIL", "label": "Date de naissance"},
    "lieu_naissance": {"registry": "ETAT_CIVIL", "label": "Lieu de naissance"},
    "sexe": {"registry": "ETAT_CIVIL", "label": "Sexe"},
    "pere": {"registry": "ETAT_CIVIL", "label": "Père"},
    "mere": {"registry": "ETAT_CIVIL", "label": "Mère"},
}

# Nom de l'attestation qui regroupe les attributs transmis
ATTRIBUTES_CLAIM = "attributs_etat_civil"

MAJORITY_AGE = 18

# Catégories de condamnation incompatibles, par finalité. À valider juridiquement.
INCOMPATIBLE_BY_PURPOSE = {
    "VERIF_CASIER_EMPLOI": {"VOL", "FRAUDE", "CORRUPTION", "DETOURNEMENT", "VIOLENCE"},
    "CANDIDATURE_RECRUTEMENT": {"VOL", "FRAUDE", "CORRUPTION", "DETOURNEMENT", "VIOLENCE"},
}


class PredicateError(Exception):
    pass


def age_on(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _birth_date(record: dict) -> date:
    raw = record.get("date_naissance")
    if not raw:
        raise PredicateError("date de naissance absente du registre")
    return date.fromisoformat(raw)


def compute(predicate: str, record: dict, purpose_code: str, params: dict | None = None,
            today: date | None = None):
    today = today or date.today()
    params = params or {}

    if predicate == "est_majeur":
        return age_on(_birth_date(record), today) >= MAJORITY_AGE

    if predicate == "acte_naissance_valide":
        return bool(record.get("date_naissance")) and not record.get("deces")

    if predicate == "age_eligible":
        if "min_age" not in params and "max_age" not in params:
            raise PredicateError("bornes d'âge absentes de la politique")
        ref = date.fromisoformat(params["reference_date"]) if params.get("reference_date") else today
        age = age_on(_birth_date(record), ref)
        return params.get("min_age", 0) <= age <= params.get("max_age", 200)

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


def disclose(attributes: list[str], record: dict) -> dict:
    """Extrait uniquement les attributs autorisés ; le reste de l'enregistrement est ignoré."""
    missing = [a for a in attributes if record.get(a) in (None, "")]
    if missing:
        raise PredicateError(f"attribut(s) absent(s) du registre : {', '.join(missing)}")
    return {a: record[a] for a in attributes}


def display(predicate: str, value, params: dict | None = None) -> str:
    if predicate == ATTRIBUTES_CLAIM and isinstance(value, dict):
        labels = [spec["label"] for k, spec in ATTRIBUTES.items() if k in value]
        return "Attributs transmis : " + ", ".join(labels)
    label = PREDICATES.get(predicate, {}).get("label", predicate)
    if predicate == "age_eligible" and params:
        label += f" ({params.get('min_age', 0)}–{params.get('max_age', '…')} ans)"
    if isinstance(value, bool):
        return f"{label} : {'Oui' if value else 'Non'}"
    return f"{label} : {value}"


def item_registry(name: str) -> str | None:
    spec = PREDICATES.get(name) or ATTRIBUTES.get(name)
    return spec["registry"] if spec else None
