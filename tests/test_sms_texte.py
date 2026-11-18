from gateway.sms_texte import MAX, consent_request, fit, to_gsm


def test_to_gsm_removes_accents_and_typographic_quotes():
    assert to_gsm("« Vérification » — l’état civil…") == '" Verification " - l\'etat civil...'
    assert to_gsm("Yaméogo, Nikiéma, Ouédraogo").isascii()


def test_consent_request_fits_one_segment():
    text = consent_request("Administration C", "Casier judiciaire",
                           "Vérification du casier pour un emploi", 30)
    assert len(text) <= MAX and text.isascii()
    assert "1=OUI" in text and "2=NON" in text and "casier judiciaire" in text


def test_long_names_keep_the_instructions():
    text = consent_request("Direction générale de la Police nationale " * 2, "Registre de l'état civil",
                           "Délivrance du passeport ordinaire pour un usager résidant à l'étranger", 30)
    assert len(text) <= MAX
    assert text.endswith("Repondez 1=OUI ou 2=NON (sous 30 min, sinon refus).")


def test_fit_truncates():
    assert len(fit("é" * 400)) == MAX
