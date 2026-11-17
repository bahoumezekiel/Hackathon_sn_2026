-- =====================================================================
-- FasoLink — Données de référence pour la démonstration
-- Administrations, registres simulés et politiques des 3 cas d'usage.
-- Les citoyens fictifs proviennent des registres fournis par le jury.
-- =====================================================================
BEGIN;
SET search_path TO fasolink, public;

INSERT INTO administration (code, name, ministry, keycloak_client_id) VALUES
  ('ADMIN_A',     'Administration A',            NULL,                              'admin-a'),
  ('ADMIN_B',     'Administration B',            NULL,                              'admin-b'),
  ('ADMIN_C',     'Administration C',            NULL,                              'admin-c'),
  ('ADMIN_D',     'Direction des concours',      'Fonction publique',               'admin-d'),
  ('ETAT_CIVIL',  'Service de l''état civil',    'Administration territoriale',     'registry-etat-civil'),
  ('NATIONALITE', 'Service de la nationalité',   'Justice',                         'registry-nationalite'),
  ('CASIER',      'Casier judiciaire national',  'Justice',                         'registry-casier');

INSERT INTO administrative_registry (code, name, owner_admin_id, endpoint_url, authentication_type)
SELECT v.code, v.name, a.id, v.url, 'OAUTH2_CLIENT'
FROM (VALUES
  ('ETAT_CIVIL',  'Registre de l''état civil',  'ETAT_CIVIL',  'http://registry-etat-civil:8000'),
  ('NATIONALITE', 'Registre de la nationalité', 'NATIONALITE', 'http://registry-nationalite:8000'),
  ('CASIER',      'Casier judiciaire',          'CASIER',      'http://registry-casier:8000')
) AS v(code, name, owner, url)
JOIN administration a ON a.code = v.owner;

-- Cas 1 : vérification de majorité (A -> état civil) => est_majeur
-- Cas 2 : vérification de nationalité (B -> nationalité) => nationalite_burkinabe
-- Cas 3 : vérification du casier (C -> casier) => casier_compatible_finalite
-- Dossier complet (D -> les trois registres) : un candidat à un concours de la fonction publique
--   ne fournit plus ni acte de naissance, ni certificat de nationalité, ni extrait de casier
INSERT INTO data_access_policy
  (policy_code, registry_id, requesting_admin_id, purpose_code, legal_basis,
   allowed_predicates, requires_consent, requires_justification, degraded_cache_ttl_s)
SELECT v.policy, r.id, a.id, v.purpose, v.basis, v.preds::jsonb, v.consent, true, v.ttl
FROM (VALUES
  ('POL_A_MAJORITE',   'ETAT_CIVIL',  'ADMIN_A', 'VERIF_MAJORITE',
     'À préciser : texte juridique fondant la mission de A', '["est_majeur"]',                 false, 86400),
  ('POL_B_NATIONALITE','NATIONALITE', 'ADMIN_B', 'VERIF_NATIONALITE',
     'À préciser : texte juridique fondant la mission de B', '["nationalite_burkinabe"]',      false, 86400),
  ('POL_C_CASIER',     'CASIER',      'ADMIN_C', 'VERIF_CASIER_EMPLOI',
     'À préciser : texte juridique fondant la mission de C', '["casier_compatible_finalite"]', true,  0),
  ('POL_D_MAJORITE',   'ETAT_CIVIL',  'ADMIN_D', 'VERIF_MAJORITE',
     'À préciser : conditions d''accès aux emplois publics', '["est_majeur"]',                   false, 86400),
  ('POL_D_NATIONALITE','NATIONALITE', 'ADMIN_D', 'VERIF_NATIONALITE',
     'À préciser : conditions d''accès aux emplois publics', '["nationalite_burkinabe"]',        false, 86400),
  ('POL_D_CASIER',     'CASIER',      'ADMIN_D', 'VERIF_CASIER_EMPLOI',
     'À préciser : conditions d''accès aux emplois publics', '["casier_compatible_finalite"]',   false, 0)
) AS v(policy, registry, admin, purpose, basis, preds, consent, ttl)
JOIN administrative_registry r ON r.code = v.registry
JOIN administration a          ON a.code = v.admin;

COMMIT;
