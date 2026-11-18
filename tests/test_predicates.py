from datetime import date

import pytest

from gateway.predicates import PredicateError, age_on, compute, display

TODAY = date(2026, 11, 16)


def test_age_birthday_not_yet_reached():
    assert age_on(date(2008, 11, 20), TODAY) == 17
    assert age_on(date(2008, 11, 16), TODAY) == 18


def test_est_majeur():
    assert compute("est_majeur", {"date_naissance": "1998-03-14"}, "X", TODAY) is True
    assert compute("est_majeur", {"date_naissance": "2008-11-20"}, "X", TODAY) is False
    with pytest.raises(PredicateError):
        compute("est_majeur", {}, "X", TODAY)


def test_nationalite():
    assert compute("nationalite_burkinabe", {"nationalite": "BF", "statut": "VALIDE"}, "X") is True
    assert compute("nationalite_burkinabe", {"nationalite": "CI", "statut": "VALIDE"}, "X") is False
    assert compute("nationalite_burkinabe", {"nationalite": "BF", "statut": "RETIRE"}, "X") is False


def test_casier_depends_on_purpose():
    fraude = {"condamnations": [{"categorie": "FRAUDE"}]}
    routier = {"condamnations": [{"categorie": "ROUTIER"}]}
    assert compute("casier_compatible_finalite", fraude, "VERIF_CASIER_EMPLOI") is False
    assert compute("casier_compatible_finalite", routier, "VERIF_CASIER_EMPLOI") is True
    with pytest.raises(PredicateError):
        compute("casier_compatible_finalite", routier, "FINALITE_INCONNUE")


def test_display():
    assert display("est_majeur", True) == "Majeur : Oui"


def test_casier_rules_from_cas_usage():
    fraude_sursis = {"condamnations": [{"categorie": "FRAUDE", "peine": "12 mois avec sursis"}]}
    fraude_ferme = {"condamnations": [{"categorie": "FRAUDE", "peine": "6 mois ferme"}]}
    regle = {"categories_incompatibles": ["FRAUDE", "VOL"], "ignorer_sursis": True}
    # Règle portée par la politique : prioritaire sur la finalité, quel que soit son code
    assert compute("casier_compatible_finalite", fraude_sursis, "IMMAT_EI", params=regle) is True
    assert compute("casier_compatible_finalite", fraude_ferme, "IMMAT_EI", params=regle) is False
    stricte = {"categories_incompatibles": ["FRAUDE"]}
    assert compute("casier_compatible_finalite", fraude_sursis, "IMMAT_EI", params=stricte) is False
    assert compute("casier_compatible_finalite", {"condamnations": []}, "IMMAT_EI", params=stricte) is True
