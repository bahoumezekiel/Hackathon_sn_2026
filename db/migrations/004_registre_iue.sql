-- =====================================================================
-- FasoLink — Registre national de l'identifiant unique électronique (IUE)
--
-- Loi sur l'identification unique électronique de base de la personne physique
-- (adoptée en octobre 2024) ; enrôlement de masse lancé le 11 novembre 2026 par le
-- ministère de la Transition digitale (projet WURI). L'IUE compte 12 chiffres et est
-- attribué à toute personne résidant au Burkina Faso (Burkinabè, étrangers, apatrides) :
-- il prouve l'unicité de la personne, PAS sa nationalité.
-- Structure détentrice : nom officiel à préciser (distincte de l'ONI, qui gère la CNIB).
--
-- Sert à l'inscription des citoyens : FasoLink vérifie que l'IUE existe,
-- qu'il est ACTIF et que la date de naissance correspond, puis envoie un
-- code au téléphone enregistré pour cet IUE. Le registre n'expose aucune
-- information (prédicat) aux administrations : il n'apparaît pas dans le
-- catalogue des cas d'usage, mais il est supervisé comme les autres
-- (disjoncteur, panne simulée).
-- =====================================================================
BEGIN;
SET search_path TO fasolink, public;

INSERT INTO administration (code, name, ministry, keycloak_client_id) VALUES
  ('IDENTIFIANT_UNIQUE', 'Identifiant unique électronique (structure à préciser)',
   'Transition digitale, Postes et Communications électroniques', 'registry-iue');

INSERT INTO administrative_registry (code, name, owner_admin_id, endpoint_url, authentication_type)
SELECT 'IUE', 'Registre national de l''identifiant unique', id, 'http://registry-iue:8000', 'OAUTH2_CLIENT'
FROM administration WHERE code = 'IDENTIFIANT_UNIQUE';

COMMIT;
