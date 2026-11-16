"""Crée la base, applique les migrations et enrôle les citoyens fictifs.

    python scripts/seed_demo.py           # première installation
    python scripts/seed_demo.py --reset   # tout effacer et recommencer
"""
import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402

from gateway import config, crypto  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--reset", action="store_true", help="supprime le schéma fasolink et le recrée")
args = parser.parse_args()

dbname = urlparse(config.DATABASE_URL).path.lstrip("/")
with psycopg.connect(config.ADMIN_DATABASE_URL, autocommit=True) as c:
    if not c.execute("SELECT 1 FROM pg_database WHERE datname=%s", (dbname,)).fetchone():
        c.execute(f'CREATE DATABASE "{dbname}"')
        print(f"Base {dbname} créée")

with psycopg.connect(config.DATABASE_URL, autocommit=True) as c:
    exists = c.execute("SELECT 1 FROM pg_namespace WHERE nspname='fasolink'").fetchone()
    if exists and not args.reset:
        sys.exit("Le schéma fasolink existe déjà. Utilisez --reset pour tout réinitialiser.")
    if exists:
        c.execute("DROP SCHEMA fasolink CASCADE")
        print("Schéma fasolink supprimé")
    for migration in sorted((ROOT / "db" / "migrations").glob("*.sql")):
        c.execute(migration.read_text(encoding="utf-8"))
        print(f"Migration appliquée : {migration.name}")

    c.execute("SET search_path TO fasolink, public")
    for code, url in config.REGISTRY_URLS.items():
        c.execute("UPDATE administrative_registry SET endpoint_url=%s WHERE code=%s", (url, code))

    registries = {r[0]: r[1] for r in c.execute("SELECT code, id FROM administrative_registry")}
    policies = {r[0]: (r[1], r[2]) for r in c.execute(
        "SELECT policy_code, requesting_admin_id, purpose_code FROM data_access_policy")}
    sections = {"ETAT_CIVIL": "etat_civil", "NATIONALITE": "nationalite", "CASIER": "casier"}

    citizens = json.loads((ROOT / "registries-mock" / "data" / "citoyens_fictifs.json")
                          .read_text(encoding="utf-8"))
    with c.transaction():
        for cit in citizens:
            iue = cit.get("iue")
            identity_id = c.execute(
                """INSERT INTO national_identity_reference
                     (iue_ciphertext, iue_fingerprint, encryption_key_version, identity_status,
                      verification_status, source_system, last_verified_at)
                   VALUES (%s,%s,%s,%s,%s,'ONI',%s) RETURNING id""",
                (iue_ct := crypto.encrypt(iue) if iue else None,
                 crypto.fingerprint(iue, "IUE") if iue else None,
                 crypto.key_version(iue_ct) if iue else None,
                 cit["identity_status"],
                 "SUCCESS" if cit["identity_status"] == "VERIFIED" else "NOT_VERIFIED",
                 datetime.now(timezone.utc) if cit["identity_status"] == "VERIFIED" else None,
                 )).fetchone()[0]
            for code, section in sections.items():
                if cit.get(section):
                    ref = cit[section]["ref"]
                    ref_ct = crypto.encrypt(ref)
                    c.execute(
                        """INSERT INTO registry_identity_mapping
                             (identity_id, registry_id, local_reference_ciphertext,
                              local_reference_fingerprint, encryption_key_version)
                           VALUES (%s,%s,%s,%s,%s)""",
                        (identity_id, registries[code], ref_ct,
                         crypto.fingerprint(ref, code), crypto.key_version(ref_ct)))
            for policy_code in cit.get("consents", []):
                admin_id, purpose = policies[policy_code]
                c.execute(
                    """INSERT INTO citizen_consent (identity_id, purpose_code, requesting_admin_id,
                           consent_status, proof_reference)
                       VALUES (%s,%s,%s,'GRANTED','enrolement-demo')""",
                    (identity_id, purpose, admin_id))
    print(f"{len(citizens)} citoyens fictifs enrôlés")
