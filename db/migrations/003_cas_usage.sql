-- =====================================================================
-- FasoLink — Cas d'usage pratiques
--   1. Candidature à un recrutement public (3 registres en une demande)
--   2. Demande de bulletin n°3 du casier judiciaire (identité + filiation)
--   3. Instruction d'un certificat de nationalité (faits d'état civil)
--   4. Condition d'âge pour un concours ou une formation
-- =====================================================================
BEGIN;
SET search_path TO fasolink, public;

-- ---------------------------------------------------------------------
-- Catalogue des finalités : libellé, explication, pièces évitées au citoyen
-- replaces : [{ "registry": code du registre, "document": pièce qui n'est plus demandée }]
-- ---------------------------------------------------------------------
CREATE TABLE purpose (
    code            VARCHAR(50) PRIMARY KEY,
    label           VARCHAR(150) NOT NULL,
    description     TEXT,
    replaces        JSONB NOT NULL DEFAULT '[]'::jsonb,
    decision_note   TEXT,           -- rappel de compétence affiché à l'agent
    CONSTRAINT replaces_is_array CHECK (jsonb_typeof(replaces) = 'array')
);

-- Paramètres des prédicats fixés PAR LA POLITIQUE (jamais par l'agent).
-- Ex. bornes d'âge : si l'agent pouvait les choisir, il retrouverait la date
-- de naissance exacte par essais successifs.
ALTER TABLE data_access_policy
    ADD COLUMN predicate_params JSONB NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO purpose (code, label, description, replaces, decision_note) VALUES
('VERIF_MAJORITE', 'Vérification de majorité',
 'L''administration vérifie que l''usager est majeur.',
 '[{"registry":"ETAT_CIVIL","document":"Extrait d''acte de naissance"}]', NULL),
('VERIF_NATIONALITE', 'Vérification de nationalité',
 'L''administration vérifie que l''usager est de nationalité burkinabè.',
 '[{"registry":"NATIONALITE","document":"Certificat de nationalité burkinabè"}]', NULL),
('VERIF_CASIER_EMPLOI', 'Vérification du casier (emploi)',
 'L''administration vérifie que le casier est compatible avec l''emploi visé.',
 '[{"registry":"CASIER","document":"Extrait de casier judiciaire (bulletin n°3)"}]', NULL),
('CANDIDATURE_RECRUTEMENT', 'Candidature à un recrutement public',
 'Constitution du dossier administratif d''un candidat à un recrutement public. Le diplôme et les pièces propres au recrutement restent à fournir par le candidat.',
 '[{"registry":"ETAT_CIVIL","document":"Extrait d''acte de naissance"},
   {"registry":"NATIONALITE","document":"Certificat de nationalité burkinabè"},
   {"registry":"CASIER","document":"Extrait de casier judiciaire de moins de trois mois"}]', NULL),
('DELIVRANCE_BULLETIN_3', 'Demande de bulletin n°3 du casier judiciaire',
 'Le service du casier judiciaire identifie le demandeur et sa filiation directement auprès de l''état civil.',
 '[{"registry":"ETAT_CIVIL","document":"Extrait d''acte de naissance (ou jugement supplétif)"}]', NULL),
('INSTRUCTION_CERTIFICAT_NATIONALITE', 'Instruction d''un certificat de nationalité',
 'Le service de la nationalité obtient les faits d''état civil et de filiation nécessaires à l''instruction.',
 '[{"registry":"ETAT_CIVIL","document":"Extrait d''acte de naissance"}]',
 'FasoLink transmet des faits d''état civil. La décision sur la nationalité reste de la seule compétence du service de la nationalité.'),
('ELIGIBILITE_AGE', 'Condition d''âge (concours, formation)',
 'L''organisateur vérifie que le candidat respecte la limite d''âge. Seul le résultat Oui/Non est transmis.',
 '[{"registry":"ETAT_CIVIL","document":"Extrait d''acte de naissance"}]', NULL);

-- ---------------------------------------------------------------------
-- Nouvelles administrations demandeuses
-- (CASIER et NATIONALITE existent déjà comme détenteurs de registres ;
--  elles deviennent aussi demandeuses vis-à-vis de l'état civil)
-- ---------------------------------------------------------------------
INSERT INTO administration (code, name, ministry) VALUES
  ('RECRUTEMENT', 'Entreprise publique — Direction des ressources humaines', 'Fonction publique'),
  ('CONCOURS',    'Direction des examens et concours',                       'Fonction publique');

INSERT INTO data_access_policy
  (policy_code, registry_id, requesting_admin_id, purpose_code, legal_basis,
   allowed_predicates, allowed_attributes, predicate_params,
   requires_consent, requires_justification, degraded_cache_ttl_s)
SELECT v.policy, r.id, a.id, v.purpose, v.basis, v.preds::jsonb, v.attrs::jsonb, v.params::jsonb,
       v.consent, true, v.ttl
FROM (VALUES
  -- Cas 1 : recrutement public — une finalité, trois registres
  ('POL_RECRUT_ETAT_CIVIL', 'ETAT_CIVIL', 'RECRUTEMENT', 'CANDIDATURE_RECRUTEMENT',
   'À préciser : texte régissant le recrutement concerné',
   '["acte_naissance_valide","age_eligible"]', '[]',
   '{"age_eligible":{"min_age":18,"max_age":35}}', false, 86400),
  ('POL_RECRUT_NATIONALITE', 'NATIONALITE', 'RECRUTEMENT', 'CANDIDATURE_RECRUTEMENT',
   'À préciser : texte régissant le recrutement concerné',
   '["nationalite_burkinabe"]', '[]', '{}', false, 86400),
  ('POL_RECRUT_CASIER', 'CASIER', 'RECRUTEMENT', 'CANDIDATURE_RECRUTEMENT',
   'À préciser : texte régissant le recrutement concerné',
   '["casier_compatible_finalite"]', '[]', '{}', true, 0),
  -- Cas 2 : bulletin n°3 — le casier obtient identité et filiation
  ('POL_CASIER_B3_IDENTITE', 'ETAT_CIVIL', 'CASIER', 'DELIVRANCE_BULLETIN_3',
   'À préciser : texte organisant la délivrance du bulletin n°3',
   '[]', '["nom","prenoms","date_naissance","lieu_naissance","sexe","pere","mere"]', '{}', false, 0),
  -- Cas 3 : certificat de nationalité — faits d'état civil pour l'instruction
  ('POL_NAT_CERTIFICAT', 'ETAT_CIVIL', 'NATIONALITE', 'INSTRUCTION_CERTIFICAT_NATIONALITE',
   'À préciser : code des personnes et de la famille / textes sur la nationalité',
   '[]', '["nom","prenoms","date_naissance","lieu_naissance","pere","mere"]', '{}', false, 0),
  -- Cas 4 : condition d'âge — bornes fixées par la politique
  ('POL_CONCOURS_AGE', 'ETAT_CIVIL', 'CONCOURS', 'ELIGIBILITE_AGE',
   'À préciser : arrêté d''ouverture du concours',
   '["age_eligible"]', '[]', '{"age_eligible":{"min_age":18,"max_age":30}}', false, 86400)
) AS v(policy, registry, admin, purpose, basis, preds, attrs, params, consent, ttl)
JOIN administrative_registry r ON r.code = v.registry
JOIN administration a          ON a.code = v.admin;

COMMIT;
