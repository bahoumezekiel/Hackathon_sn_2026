-- =====================================================================
-- FasoLink — Schéma du noyau d'interopérabilité (PostgreSQL 16)
-- Version 2 : schéma consolidé et corrigé à partir de la fiche technique v1
-- =====================================================================
-- Principes appliqués :
--   * FasoLink ne stocke AUCUNE donnée métier des registres : uniquement
--     des références chiffrées, des politiques, des demandes, des
--     attestations (prédicats) et un journal d'audit.
--   * L'IUE et les références locales sont chiffrés au repos (chiffrement
--     applicatif via Vault/KMS) ; la recherche se fait par empreinte HMAC.
--   * Le journal d'audit est append-only et chaîné par hachage.
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS fasolink;
SET search_path TO fasolink, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() pour la chaîne d'audit

-- ---------------------------------------------------------------------
-- 1. Administrations (demandeuses et/ou détentrices de registres)
--    Table absente de la v1 alors qu'elle est référencée partout.
-- ---------------------------------------------------------------------
CREATE TABLE administration (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(30)  NOT NULL UNIQUE,
    name                VARCHAR(150) NOT NULL,
    ministry            VARCHAR(150),
    keycloak_client_id  VARCHAR(100) UNIQUE,          -- lien avec l'IAM
    status              VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. Registres administratifs connectés
-- ---------------------------------------------------------------------
CREATE TABLE administrative_registry (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    VARCHAR(30)  NOT NULL UNIQUE,   -- ETAT_CIVIL, NATIONALITE, CASIER
    name                    VARCHAR(150) NOT NULL,
    owner_admin_id          UUID NOT NULL REFERENCES administration(id),
    endpoint_url            TEXT NOT NULL,
    authentication_type     VARCHAR(30)  NOT NULL
                            CHECK (authentication_type IN ('MTLS','OAUTH2_CLIENT','API_KEY')),
    status                  VARCHAR(20)  NOT NULL DEFAULT 'UP'
                            CHECK (status IN ('UP','DEGRADED','DOWN','MAINTENANCE')),
    -- Paramètres de résilience (disjoncteur)
    timeout_ms              INTEGER NOT NULL DEFAULT 2000 CHECK (timeout_ms > 0),
    failure_threshold       INTEGER NOT NULL DEFAULT 3    CHECK (failure_threshold > 0),
    consecutive_failures    INTEGER NOT NULL DEFAULT 0,
    circuit_opened_at       TIMESTAMPTZ,
    last_health_check       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. Référence d'identité nationale (IUE chiffré)
--    Remplace les deux versions de la v1 (on garde la version chiffrée).
-- ---------------------------------------------------------------------
CREATE TABLE national_identity_reference (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iue_ciphertext          BYTEA,                       -- NULL si aucun IUE attribué
    iue_fingerprint         BYTEA UNIQUE,                -- HMAC-SHA256(IUE, clé Vault)
    encryption_key_version  VARCHAR(30),
    identity_status         VARCHAR(30) NOT NULL
                            CHECK (identity_status IN (
                                'VERIFIED',              -- IUE disponible et vérifié
                                'IDENTITY_PENDING',      -- enrôlement en cours
                                'NO_IUE',                -- procédure alternative
                                'UNVERIFIABLE')),        -- IUE temporairement non vérifiable
    verification_status     VARCHAR(30) NOT NULL DEFAULT 'NOT_VERIFIED'
                            CHECK (verification_status IN ('NOT_VERIFIED','SUCCESS','FAILED','RETRY_PENDING')),
    source_system           VARCHAR(50),
    last_verified_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Un IUE chiffré va toujours avec son empreinte et sa version de clé
    CONSTRAINT iue_consistency CHECK (
        (iue_ciphertext IS NULL AND iue_fingerprint IS NULL)
        OR (iue_ciphertext IS NOT NULL AND iue_fingerprint IS NOT NULL
            AND encryption_key_version IS NOT NULL)),
    CONSTRAINT verified_needs_iue CHECK (
        identity_status <> 'VERIFIED' OR iue_ciphertext IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 4. Correspondance identité FasoLink <-> référence locale d'un registre
--    Remplace registry_mappings + registry_identity_mapping de la v1.
--    Permet la procédure alternative (citoyen sans IUE) sans créer
--    un second identifiant national permanent.
-- ---------------------------------------------------------------------
CREATE TABLE registry_identity_mapping (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id                 UUID NOT NULL REFERENCES national_identity_reference(id),
    registry_id                 UUID NOT NULL REFERENCES administrative_registry(id),
    local_reference_ciphertext  BYTEA NOT NULL,
    local_reference_fingerprint BYTEA NOT NULL,          -- v1 : VARCHAR(30) erroné
    encryption_key_version      VARCHAR(30) NOT NULL,
    mapping_status              VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
                                CHECK (mapping_status IN ('ACTIVE','PENDING','CONFLICT','REVOKED')),
    valid_from                  TIMESTAMPTZ NOT NULL DEFAULT now(),   -- v1 : "Valid_form"
    valid_until                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mapping_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT uq_registry_local_ref UNIQUE (registry_id, local_reference_fingerprint)
);
-- Une seule correspondance active par identité et par registre
CREATE UNIQUE INDEX uq_active_mapping
    ON registry_identity_mapping (identity_id, registry_id)
    WHERE mapping_status = 'ACTIVE';

-- ---------------------------------------------------------------------
-- 5. Politiques d'accès (traduites en règles OPA)
--    Les administrations demandent des PRÉDICATS (ex. est_majeur),
--    pas des attributs bruts (ex. date_naissance).
-- ---------------------------------------------------------------------
CREATE TABLE data_access_policy (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_code             VARCHAR(50)  NOT NULL UNIQUE,
    registry_id             UUID NOT NULL REFERENCES administrative_registry(id),
    requesting_admin_id     UUID NOT NULL REFERENCES administration(id),  -- v1 : "Requestion_admin_id"
    purpose_code            VARCHAR(50)  NOT NULL,
    legal_basis             VARCHAR(150) NOT NULL,
    allowed_predicates      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ex. ["est_majeur"]
    allowed_attributes      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- attributs bruts, exceptionnels
    requires_consent        BOOLEAN NOT NULL DEFAULT false,
    requires_justification  BOOLEAN NOT NULL DEFAULT true,
    -- Mode dégradé : durée pendant laquelle une attestation déjà émise
    -- peut être réutilisée si le registre est en panne (0 = interdit)
    degraded_cache_ttl_s    INTEGER NOT NULL DEFAULT 0 CHECK (degraded_cache_ttl_s >= 0),
    is_active               BOOLEAN NOT NULL DEFAULT true,
    valid_from              TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT policy_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT predicates_is_array CHECK (jsonb_typeof(allowed_predicates) = 'array'),
    CONSTRAINT attributes_is_array CHECK (jsonb_typeof(allowed_attributes) = 'array')
);
CREATE INDEX idx_policy_lookup
    ON data_access_policy (requesting_admin_id, registry_id, purpose_code)
    WHERE is_active;

-- ---------------------------------------------------------------------
-- 6. Consentement du citoyen
-- ---------------------------------------------------------------------
CREATE TABLE citizen_consent (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id         UUID NOT NULL REFERENCES national_identity_reference(id),
    purpose_code        VARCHAR(50) NOT NULL,
    requesting_admin_id UUID NOT NULL REFERENCES administration(id),
    consent_status      VARCHAR(20) NOT NULL
                        CHECK (consent_status IN ('GRANTED','REFUSED','WITHDRAWN')),
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    withdrawn_at        TIMESTAMPTZ,
    proof_reference     VARCHAR(150),
    CONSTRAINT withdrawn_coherence CHECK (
        (consent_status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);
CREATE INDEX idx_consent_lookup
    ON citizen_consent (identity_id, requesting_admin_id, purpose_code, collected_at DESC);

-- ---------------------------------------------------------------------
-- 7. Demandes d'accès
--    Ajouts v2 : status, decision, service_mode, file de relance.
-- ---------------------------------------------------------------------
CREATE TABLE access_request (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_admin_id      UUID NOT NULL REFERENCES administration(id),
    requester_user_id       UUID NOT NULL,                -- sujet Keycloak de l'agent
    identity_id             UUID NOT NULL REFERENCES national_identity_reference(id),
    registry_id             UUID NOT NULL REFERENCES administrative_registry(id),
    policy_id               UUID REFERENCES data_access_policy(id),
    purpose_code            VARCHAR(50)  NOT NULL,
    legal_basis             VARCHAR(150) NOT NULL,        -- v1 : 50 ici, 150 ailleurs
    justification           TEXT,                         -- saisie par l'agent
    requested_predicates    JSONB NOT NULL DEFAULT '[]'::jsonb,
    requested_attributes    JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                  VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
                            CHECK (status IN ('RECEIVED','PROCESSING','COMPLETED',
                                              'DENIED','QUEUED','FAILED')),
    decision                VARCHAR(20)
                            CHECK (decision IN ('PERMIT','DENY','PARTIAL')),
    decision_reason         TEXT,                         -- motif OPA / refus
    service_mode            VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
                            CHECK (service_mode IN ('NORMAL','DEGRADED_CACHE','QUEUED_RETRY')),
    retry_count             INTEGER NOT NULL DEFAULT 0,
    next_retry_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),   -- v1 : "TIMESTAMTZ"
    completed_at            TIMESTAMPTZ,
    CONSTRAINT completed_has_decision CHECK (
        status NOT IN ('COMPLETED','DENIED') OR decision IS NOT NULL),
    CONSTRAINT queued_has_retry CHECK (
        status <> 'QUEUED' OR next_retry_at IS NOT NULL)
);
CREATE INDEX idx_request_identity ON access_request (identity_id, created_at DESC);
CREATE INDEX idx_request_retry    ON access_request (next_retry_at) WHERE status = 'QUEUED';

-- ---------------------------------------------------------------------
-- 8. Vérifications d'identité
--    Remplace identity_verification_history + identity_verification.
-- ---------------------------------------------------------------------
CREATE TABLE identity_verification (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id         UUID NOT NULL REFERENCES national_identity_reference(id),
    request_id          UUID REFERENCES access_request(id),   -- v1 : "Requested_id"
    verification_type   VARCHAR(40) NOT NULL,
    verification_status VARCHAR(30) NOT NULL
                        CHECK (verification_status IN ('SUCCESS','FAILED','UNAVAILABLE','TIMEOUT')),
    source_system       VARCHAR(50) NOT NULL,
    source_reference    VARCHAR(150),
    proof_reference     VARCHAR(150),
    verified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ,                          -- v1 : VARCHAR(50)
    error_code          VARCHAR(50),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT failure_has_error CHECK (
        verification_status = 'SUCCESS' OR error_code IS NOT NULL)
);
CREATE INDEX idx_verification_identity ON identity_verification (identity_id, verified_at DESC);

-- ---------------------------------------------------------------------
-- 9. Attestations (NOUVEAU) — réponse minimisée et signée
--    Ex. { predicate: "est_majeur", value: true } signé par FasoLink.
--    Sert aussi de cache autorisé en mode dégradé (jamais de donnée brute).
-- ---------------------------------------------------------------------
CREATE TABLE attestation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID NOT NULL REFERENCES access_request(id),
    identity_id         UUID NOT NULL REFERENCES national_identity_reference(id),
    registry_id         UUID NOT NULL REFERENCES administrative_registry(id),
    audience_admin_id   UUID NOT NULL REFERENCES administration(id),  -- destinataire
    purpose_code        VARCHAR(50) NOT NULL,
    predicate           VARCHAR(60) NOT NULL,              -- est_majeur, nationalite_bf, casier_vierge...
    predicate_value     JSONB NOT NULL,                    -- true / false / "BF"
    observed_at         TIMESTAMPTZ NOT NULL,              -- quand le registre a été lu (≠ issued_at en mode dégradé)
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    signature_jws       TEXT NOT NULL,                     -- JWS compact (EdDSA)
    signing_key_id      VARCHAR(60) NOT NULL,
    served_from_cache   BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT attestation_validity CHECK (expires_at > issued_at),
    CONSTRAINT attestation_observed CHECK (observed_at <= issued_at)
);
CREATE INDEX idx_attestation_cache
    ON attestation (identity_id, registry_id, predicate, audience_admin_id, purpose_code, expires_at DESC);

-- ---------------------------------------------------------------------
-- 10. Journal d'audit — append-only, chaîné par SHA-256
-- ---------------------------------------------------------------------
CREATE TABLE audit_event (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq                 BIGINT NOT NULL UNIQUE,   -- attribué par trg_audit_chain, sous verrou
    request_id          UUID REFERENCES access_request(id),
    identity_id         UUID REFERENCES national_identity_reference(id),
    actor_admin_id      UUID REFERENCES administration(id),
    actor_user_id       UUID,
    registry_id         UUID REFERENCES administrative_registry(id),
    event_type          VARCHAR(50) NOT NULL,     -- ACCESS_REQUESTED, POLICY_DECISION, REGISTRY_QUERIED,
                                                  -- ATTESTATION_ISSUED, CACHE_SERVED, REGISTRY_DOWN,
                                                  -- CONSENT_CHANGED, CITIZEN_ALERT...
    purpose_code        VARCHAR(50),
    access_decision     VARCHAR(20) CHECK (access_decision IN ('PERMIT','DENY','PARTIAL','N/A')),
    attributes_accessed JSONB NOT NULL DEFAULT '[]'::jsonb,
    service_mode        VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    event_timestamp     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    previous_hash       BYTEA NOT NULL,
    event_hash          BYTEA NOT NULL UNIQUE
);
CREATE INDEX idx_audit_identity ON audit_event (identity_id, event_timestamp DESC);
CREATE INDEX idx_audit_request  ON audit_event (request_id);

-- Calcul du chaînage : event_hash = SHA256(previous_hash || contenu canonique)
CREATE FUNCTION audit_event_canonical(e audit_event) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT concat_ws('|',
        e.id, e.seq, e.request_id, e.identity_id, e.actor_admin_id, e.actor_user_id,
        e.registry_id, e.event_type, e.purpose_code, e.access_decision,
        e.attributes_accessed::text, e.service_mode,
        to_char(e.event_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

-- Numéro d'ordre tiré APRÈS le verrou : l'ordre des numéros est exactement celui du chaînage,
-- même quand plusieurs demandes sont journalisées en parallèle.
CREATE SEQUENCE audit_event_seq;

CREATE FUNCTION audit_event_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prev BYTEA;
BEGIN
    -- Sérialise les insertions pour garantir une chaîne linéaire
    PERFORM pg_advisory_xact_lock(hashtext('fasolink.audit_event'));
    NEW.seq := nextval('fasolink.audit_event_seq');
    SELECT event_hash INTO prev FROM fasolink.audit_event ORDER BY seq DESC LIMIT 1;
    NEW.previous_hash := COALESCE(prev, '\x00'::bytea);           -- bloc de genèse
    NEW.event_hash    := digest(NEW.previous_hash
                                || convert_to(fasolink.audit_event_canonical(NEW), 'UTF8'),
                                'sha256');
    RETURN NEW;
END $$;

CREATE TRIGGER trg_audit_chain
    BEFORE INSERT ON audit_event
    FOR EACH ROW EXECUTE FUNCTION audit_event_chain();

-- Interdiction de modifier ou supprimer un événement d'audit
CREATE FUNCTION audit_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_event est en ajout seul (append-only) : % interdit', TG_OP;
END $$;

CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
CREATE TRIGGER trg_audit_no_truncate
    BEFORE TRUNCATE ON audit_event
    FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();

-- Vérification de l'intégrité de toute la chaîne (utilisée par le portail citoyen)
CREATE FUNCTION verify_audit_chain()
RETURNS TABLE (broken_at_seq BIGINT, expected_hash BYTEA, stored_hash BYTEA)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r    fasolink.audit_event;
    prev BYTEA := '\x00'::bytea;
    calc BYTEA;
BEGIN
    FOR r IN SELECT * FROM fasolink.audit_event ORDER BY seq LOOP
        calc := digest(prev || convert_to(fasolink.audit_event_canonical(r), 'UTF8'), 'sha256');
        IF r.previous_hash <> prev OR r.event_hash <> calc THEN
            broken_at_seq := r.seq; expected_hash := calc; stored_hash := r.event_hash;
            RETURN NEXT;
            RETURN;
        END IF;
        prev := r.event_hash;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 11. Alertes citoyennes (NOUVEAU) — signalement d'un accès suspect,
--     depuis le portail web ou l'assistant vocal.
-- ---------------------------------------------------------------------
CREATE TABLE citizen_alert (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id         UUID NOT NULL REFERENCES national_identity_reference(id),
    audit_event_id      UUID REFERENCES audit_event(id),     -- accès contesté
    channel             VARCHAR(20) NOT NULL CHECK (channel IN ('WEB','VOICE','SMS','USSD')),
    language            VARCHAR(10) NOT NULL DEFAULT 'fr',    -- fr, mos (mooré), dyu (dioula)
    description         TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','REJECTED')),
    handled_by          UUID,
    resolution_note     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    CONSTRAINT resolution_coherence CHECK (
        (status IN ('RESOLVED','REJECTED')) = (resolved_at IS NOT NULL))
);
CREATE INDEX idx_alert_open ON citizen_alert (status, created_at) WHERE status IN ('OPEN','IN_REVIEW');

-- ---------------------------------------------------------------------
-- 12. Vue citoyenne : « qui a consulté mes données ? »
-- ---------------------------------------------------------------------
CREATE VIEW citizen_access_history AS
SELECT  e.identity_id,
        e.event_timestamp           AS consulted_at,
        a.name                      AS administration,
        r.name                      AS registry,
        e.purpose_code              AS purpose,
        e.access_decision           AS decision,
        e.attributes_accessed       AS data_shared,
        e.service_mode,
        e.id                        AS audit_event_id,
        encode(e.event_hash, 'hex') AS proof_hash
FROM    audit_event e
LEFT JOIN administration a          ON a.id = e.actor_admin_id
LEFT JOIN administrative_registry r ON r.id = e.registry_id
WHERE   e.event_type IN ('ATTESTATION_ISSUED','CACHE_SERVED')
   OR  (e.event_type = 'POLICY_DECISION' AND e.access_decision = 'DENY');  -- tentatives refusées

-- Mise à jour automatique de updated_at
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER trg_touch_admin    BEFORE UPDATE ON administration
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_registry BEFORE UPDATE ON administrative_registry
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_identity BEFORE UPDATE ON national_identity_reference
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
