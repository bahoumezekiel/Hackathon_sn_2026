# FasoLink — politique d'accès aux registres (Open Policy Agent)
#
# Entrée (construite par la passerelle à partir de PostgreSQL) :
#   administration : {code, status}
#   purpose_code   : finalité déclarée
#   predicates     : informations demandées (ex. ["est_majeur"])
#   justification  : motif saisi par l'agent
#   policy         : politique applicable (absente si aucune)
#   consent        : dernier statut de consentement (absent si jamais recueilli)
#
# Sortie : data.fasolink.authz.decision = {effect, reason, granted}
package fasolink.authz

import rego.v1

min_justification_length := 10

granted := [p | some p in input.predicates; p in input.policy.allowed_predicates]

refused := [p | some p in input.predicates; not p in object.get(input, ["policy", "allowed_predicates"], [])]

deny(reason) := {"effect": "DENY", "reason": reason, "granted": []}

decision := deny("Administration suspendue ou inconnue") if {
	object.get(input, ["administration", "status"], "") != "ACTIVE"
} else := deny(sprintf("Aucune politique n'autorise cette administration à interroger ce registre pour la finalité %s", [input.purpose_code])) if {
	not input.policy
} else := deny(sprintf("Justification obligatoire (%d caractères minimum)", [min_justification_length])) if {
	input.policy.requires_justification
	count(trim_space(object.get(input, "justification", ""))) < min_justification_length
} else := deny(sprintf("Information non autorisée pour cette finalité : %s", [concat(", ", refused)])) if {
	count(granted) == 0
} else := deny("Consentement du citoyen requis et non recueilli") if {
	input.policy.requires_consent
	not input.consent
} else := deny("Consentement retiré ou refusé par le citoyen") if {
	input.policy.requires_consent
	input.consent != "GRANTED"
} else := {
	"effect": "PARTIAL",
	"reason": sprintf("Conforme à la politique %s ; refusé : %s", [input.policy.policy_code, concat(", ", refused)]),
	"granted": granted,
} if {
	count(refused) > 0
} else := {
	"effect": "PERMIT",
	"reason": sprintf("Conforme à la politique %s", [input.policy.policy_code]),
	"granted": granted,
}
