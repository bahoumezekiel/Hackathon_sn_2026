package fasolink.authz_test

import rego.v1

import data.fasolink.authz

policy_a := {
	"policy_code": "POL_A_MAJORITE",
	"allowed_predicates": ["est_majeur"],
	"requires_consent": false,
	"requires_justification": true,
}

policy_c := {
	"policy_code": "POL_C_CASIER",
	"allowed_predicates": ["casier_compatible_finalite"],
	"requires_consent": true,
	"requires_justification": true,
}

base := {
	"administration": {"code": "ADMIN_A", "status": "ACTIVE"},
	"purpose_code": "VERIF_MAJORITE",
	"predicates": ["est_majeur"],
	"justification": "Dossier n° 2026-118",
	"policy": policy_a,
}

test_permit if {
	d := authz.decision with input as base
	d.effect == "PERMIT"
	d.granted == ["est_majeur"]
}

test_no_policy_denied if {
	d := authz.decision with input as object.remove(base, ["policy"])
	d.effect == "DENY"
}

test_suspended_admin_denied if {
	d := authz.decision with input as object.union(base, {"administration": {"code": "ADMIN_A", "status": "SUSPENDED"}})
	d.effect == "DENY"
}

test_justification_required if {
	d := authz.decision with input as object.union(base, {"justification": "   "})
	d.effect == "DENY"
	contains(d.reason, "Justification")
}

test_predicate_not_allowed if {
	d := authz.decision with input as object.union(base, {"predicates": ["date_naissance"]})
	d.effect == "DENY"
}

test_partial if {
	d := authz.decision with input as object.union(base, {"predicates": ["est_majeur", "date_naissance"]})
	d.effect == "PARTIAL"
	d.granted == ["est_majeur"]
}

test_consent_missing if {
	d := authz.decision with input as object.union(base, {"policy": policy_c, "predicates": ["casier_compatible_finalite"]})
	d.effect == "DENY"
	contains(d.reason, "non recueilli")
}

test_consent_withdrawn if {
	d := authz.decision with input as object.union(base, {"policy": policy_c, "predicates": ["casier_compatible_finalite"], "consent": "WITHDRAWN"})
	d.effect == "DENY"
	contains(d.reason, "retiré")
}

policy_b3 := {
	"policy_code": "POL_CASIER_B3_IDENTITE",
	"allowed_predicates": [],
	"allowed_attributes": ["nom", "prenoms", "date_naissance", "lieu_naissance", "sexe", "pere", "mere"],
	"requires_consent": false,
	"requires_justification": true,
}

b3 := object.union(base, {
	"administration": {"code": "CASIER", "status": "ACTIVE"},
	"purpose_code": "DELIVRANCE_BULLETIN_3",
	"predicates": [],
	"attributes": ["nom", "prenoms", "pere", "mere"],
	"policy": policy_b3,
})

test_attributes_granted if {
	d := authz.decision with input as b3
	d.effect == "PERMIT"
	d.granted_attributes == ["nom", "prenoms", "pere", "mere"]
}

test_attribute_outside_policy_refused if {
	d := authz.decision with input as object.union(b3, {"attributes": ["nom", "nationalite"]})
	d.effect == "PARTIAL"
	d.granted_attributes == ["nom"]
	contains(d.reason, "nationalite")
}

test_raw_birth_date_refused_for_age_check if {
	# Un organisateur de concours n'a droit qu'au Oui/Non, pas à la date de naissance
	d := authz.decision with input as object.union(base, {"attributes": ["date_naissance"], "predicates": []})
	d.effect == "DENY"
}

test_consent_granted if {
	d := authz.decision with input as object.union(base, {"policy": policy_c, "predicates": ["casier_compatible_finalite"], "consent": "GRANTED"})
	d.effect == "PERMIT"
}
