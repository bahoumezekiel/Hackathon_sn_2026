-- =====================================================================
-- FasoLink — Consentement par SMS (usagers sans accès au web)
--
-- Quand un cas d'usage exige le consentement et que l'usager ne l'a jamais
-- donné ni refusé, FasoLink lui envoie un SMS au numéro associé à son IUE
-- (registre de l'identifiant unique) : « 1 = OUI, 2 = NON ».
-- La demande attend (AWAITING_CONSENT) ; l'accord ne vaut QUE pour elle.
-- Le numéro n'est pas stocké en clair : empreinte HMAC (Vault) + forme masquée.
-- =====================================================================
BEGIN;
SET search_path TO fasolink, public;

ALTER TABLE access_request DROP CONSTRAINT access_request_status_check;
ALTER TABLE access_request ADD CONSTRAINT access_request_status_check
    CHECK (status IN ('RECEIVED','PROCESSING','COMPLETED','DENIED','QUEUED','FAILED',
                      'AWAITING_CONSENT'));

CREATE TABLE sms_consent_request (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID NOT NULL UNIQUE REFERENCES access_request(id),
    identity_id         UUID NOT NULL REFERENCES national_identity_reference(id),
    phone_fingerprint   BYTEA NOT NULL,                -- HMAC du numéro (retrouver la réponse)
    phone_masked        VARCHAR(30) NOT NULL,          -- +226 70 •• •• 54
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','GRANTED','REFUSED','EXPIRED','SUPERSEDED')),
    sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    answered_at         TIMESTAMPTZ,
    CONSTRAINT sms_answer_coherence CHECK ((status IN ('GRANTED','REFUSED')) = (answered_at IS NOT NULL)),
    CONSTRAINT sms_validity CHECK (expires_at > sent_at)
);
CREATE INDEX idx_sms_pending ON sms_consent_request (phone_fingerprint, sent_at DESC) WHERE status = 'PENDING';
CREATE INDEX idx_sms_expiry  ON sms_consent_request (expires_at) WHERE status = 'PENDING';

COMMIT;
