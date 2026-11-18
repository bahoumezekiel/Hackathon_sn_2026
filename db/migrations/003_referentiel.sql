-- =====================================================================
-- FasoLink — Référentiel des structures et de leurs cas d'usage
--
-- Un CAS D'USAGE est la démarche qu'une structure traite (ex. « Immatriculation
-- d'une entreprise individuelle » au CEFORE). C'est la finalité déclarée :
-- son code est le purpose_code des demandes, des politiques et du journal.
-- Il regroupe une politique par registre consultable ; l'agent coche,
-- selon l'usager, les registres utiles parmi ceux-là.
--
-- L'administrateur de la plateforme (rôle platform_admin) crée les structures,
-- leurs agents et leurs cas d'usage depuis le portail Supervision.
-- Une politique n'est jamais modifiée : elle est close (valid_until) et
-- remplacée, pour que chaque accès passé reste rattaché à sa règle.
-- =====================================================================
BEGIN;
SET search_path TO fasolink, public;

CREATE TABLE cas_usage (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id                UUID NOT NULL REFERENCES administration(id),
    code                    VARCHAR(50)  NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{2,49}$'),
    label                   VARCHAR(150) NOT NULL,
    description             TEXT,
    legal_basis             VARCHAR(150) NOT NULL,
    requires_justification  BOOLEAN NOT NULL DEFAULT true,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    created_by              VARCHAR(100),                 -- identifiant Keycloak de l'administrateur
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_cas_usage UNIQUE (admin_id, code)
);
CREATE TRIGGER trg_touch_cas_usage BEFORE UPDATE ON cas_usage
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE data_access_policy
    ADD COLUMN cas_usage_id UUID REFERENCES cas_usage(id),
    -- Règles d'appréciation propres au cas d'usage, ex. pour le casier :
    -- {"categories_incompatibles": ["FRAUDE"], "ignorer_sursis": true}
    ADD COLUMN parametres JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT parametres_is_object CHECK (jsonb_typeof(parametres) = 'object');
CREATE INDEX idx_policy_cas_usage ON data_access_policy (cas_usage_id) WHERE is_active;

-- Libellé lisible d'une finalité, pour les portails (citoyen, agent, supervision)
CREATE FUNCTION purpose_label(p_admin UUID, p_code TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT label FROM fasolink.cas_usage WHERE admin_id = p_admin AND code = p_code
$$;

-- ---------------------------------------------------------------------
-- Cas d'usage des administrations de l'épreuve (A, B, C) : une finalité, un registre
-- ---------------------------------------------------------------------
INSERT INTO cas_usage (admin_id, code, label, legal_basis, created_by)
SELECT DISTINCT ON (p.requesting_admin_id, p.purpose_code)
       p.requesting_admin_id, p.purpose_code,
       CASE p.purpose_code
         WHEN 'VERIF_MAJORITE'      THEN 'Vérification de majorité'
         WHEN 'VERIF_NATIONALITE'   THEN 'Vérification de nationalité'
         WHEN 'VERIF_CASIER_EMPLOI' THEN 'Vérification du casier pour un emploi'
         ELSE p.purpose_code END,
       p.legal_basis, 'seed'
FROM data_access_policy p;

UPDATE data_access_policy p SET cas_usage_id = cu.id
FROM cas_usage cu
WHERE cu.admin_id = p.requesting_admin_id AND cu.code = p.purpose_code;

UPDATE data_access_policy SET parametres =
    '{"categories_incompatibles": ["VOL","FRAUDE","CORRUPTION","DETOURNEMENT","VIOLENCE"]}'
WHERE policy_code = 'POL_C_CASIER';

-- ---------------------------------------------------------------------
-- Exemple livré : le CEFORE (guichet unique de création d'entreprise)
-- Cas d'usage « Immatriculation d'une entreprise individuelle » :
--   état civil  -> Majeur              (capacité à exercer le commerce)
--   casier      -> Casier compatible   (interdictions d'exercer le commerce)
--   nationalité -> Nationalité burkinabè (à cocher selon le promoteur)
-- Bases légales à faire valider par un juriste.
-- ---------------------------------------------------------------------
INSERT INTO administration (code, name, ministry, keycloak_client_id) VALUES
  ('CEFORE', 'Centre de formalités des entreprises', 'Industrie, Commerce et Artisanat', 'cefore');

INSERT INTO cas_usage (admin_id, code, label, description, legal_basis, created_by)
SELECT id, 'IMMAT_ENTREPRISE_INDIVIDUELLE', 'Immatriculation d''une entreprise individuelle',
       'Inscription d''un commerçant personne physique au RCCM. La nationalité n''est vérifiée que si le dossier du promoteur le demande.',
       'À préciser : Acte uniforme OHADA relatif au droit commercial général', 'seed'
FROM administration WHERE code = 'CEFORE';

INSERT INTO data_access_policy
  (policy_code, registry_id, requesting_admin_id, purpose_code, legal_basis, allowed_predicates,
   requires_consent, requires_justification, degraded_cache_ttl_s, cas_usage_id, parametres)
SELECT v.policy, r.id, cu.admin_id, cu.code, cu.legal_basis, v.preds::jsonb,
       false, true, v.ttl, cu.id, v.params::jsonb
FROM (VALUES
  ('POL_CEFORE_IMMAT_ETAT_CIVIL',  'ETAT_CIVIL',  '["est_majeur"]',                 86400, '{}'),
  ('POL_CEFORE_IMMAT_NATIONALITE', 'NATIONALITE', '["nationalite_burkinabe"]',      86400, '{}'),
  ('POL_CEFORE_IMMAT_CASIER',      'CASIER',      '["casier_compatible_finalite"]', 0,
     '{"categories_incompatibles": ["VOL","FRAUDE","CORRUPTION","DETOURNEMENT"], "ignorer_sursis": true}')
) AS v(policy, registry, preds, ttl, params)
JOIN administrative_registry r ON r.code = v.registry
CROSS JOIN cas_usage cu
WHERE cu.code = 'IMMAT_ENTREPRISE_INDIVIDUELLE';

COMMIT;
