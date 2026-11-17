from datetime import date

import pytest

from gateway.predicates import ATTRIBUTES_CLAIM, PredicateError, age_on, compute, disclose, display

TODAY = date(2026, 11, 16)


def test_age_birthday_not_yet_reached():
    assert age_on(date(2008, 11, 20), TODAY) == 17
    assert age_on(date(2008, 11, 16), TODAY) == 18


def test_est_majeur():
    assert compute("est_majeur", {"date_naissance": "1998-03-14"}, "X", today=TODAY) is True
    assert compute("est_majeur", {"date_naissance": "2008-11-20"}, "X", today=TODAY) is False
    with pytest.raises(PredicateError):
        compute("est_majeur", {}, "X", today=TODAY)


def test_age_eligible_uses_policy_bounds():
    bounds = {"min_age": 18, "max_age": 30}
    assert compute("age_eligible", {"date_naissance": "1998-03-14"}, "X", bounds, TODAY) is True   # 28 ans
    assert compute("age_eligible", {"date_naissance": "1993-07-11"}, "X", bounds, TODAY) is False  # 33 ans
    assert compute("age_eligible", {"date_naissance": "2010-06-01"}, "X", bounds, TODAY) is False  # 16 ans
    # Date de référence (ex. date de clôture du concours) fixée par la politique
    assert compute("age_eligible", {"date_naissance": "2008-11-20"}, "X",
                   {"min_age": 18, "reference_date": "2026-12-31"}, TODAY) is True


def test_age_eligible_requires_bounds():
    with pytest.raises(PredicateError):
        compute("age_eligible", {"date_naissance": "1998-03-14"}, "X", {}, TODAY)


def test_acte_naissance_valide():
    assert compute("acte_naissance_valide", {"date_naissance": "1998-03-14"}, "X") is True
    assert compute("acte_naissance_valide", {"date_naissance": "1998-03-14", "deces": "2020-01-01"}, "X") is False


def test_nationalite():
    assert compute("nationalite_burkinabe", {"nationalite": "BF", "statut": "VALIDE"}, "X") is True
    assert compute("nationalite_burkinabe", {"nationalite": "CI", "statut": "VALIDE"}, "X") is False
    assert compute("nationalite_burkinabe", {"nationalite": "BF", "statut": "RETIRE"}, "X") is False


def test_casier_depends_on_purpose():
    fraude = {"condamnations": [{"categorie": "FRAUDE"}]}
    routier = {"condamnations": [{"categorie": "ROUTIER"}]}
    assert compute("casier_compatible_finalite", fraude, "CANDIDATURE_RECRUTEMENT") is False
    assert compute("casier_compatible_finalite", routier, "CANDIDATURE_RECRUTEMENT") is True
    with pytest.raises(PredicateError):
        compute("casier_compatible_finalite", routier, "FINALITE_INCONNUE")


def test_disclose_only_requested_attributes():
    record = {"nom": "Ouédraogo", "prenoms": "Awa", "date_naissance": "1998-03-14",
              "pere": "Ouédraogo Issaka", "mere": "Sawadogo Aminata", "lieu_naissance": "Ouagadougou"}
    out = disclose(["nom", "pere", "mere"], record)
    assert out == {"nom": "Ouédraogo", "pere": "Ouédraogo Issaka", "mere": "Sawadogo Aminata"}
    with pytest.raises(PredicateError):
        disclose(["sexe"], record)


def test_display():
    assert display("est_majeur", True) == "Majeur : Oui"
    assert display("age_eligible", False, {"min_age": 18, "max_age": 30}) == \
        "Âge conforme aux conditions (18–30 ans) : Non"
    assert display(ATTRIBUTES_CLAIM, {"nom": "X", "pere": "Y"}) == "Attributs transmis : Nom, Père"
