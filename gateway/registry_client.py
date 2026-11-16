"""Appels aux registres, protégés par un disjoncteur (circuit breaker).

L'état du disjoncteur est partagé dans Redis entre toutes les instances de la
passerelle ; il est recopié dans administrative_registry pour l'historique.
"""
import logging

import httpx

from . import audit, config, db, resilience

log = logging.getLogger("fasolink.registry")
_client = httpx.Client()


class RegistryUnavailable(Exception):
    pass


class RecordNotFound(Exception):
    pass


def fetch_record(reg: dict, local_reference: str) -> dict:
    if resilience.circuit(reg["code"])["open"]:
        raise RegistryUnavailable("Disjoncteur ouvert : registre indisponible")
    try:
        resp = _client.get(f"{reg['endpoint_url']}/records/{local_reference}",
                           headers={"X-Registry-Token": config.REGISTRY_TOKEN},
                           timeout=reg["timeout_ms"] / 1000)
    except httpx.HTTPError as exc:
        record_failure(reg)
        raise RegistryUnavailable(f"Registre injoignable ({type(exc).__name__})") from exc
    if resp.status_code == 404:
        record_success(reg)
        raise RecordNotFound()
    if resp.status_code != 200:
        record_failure(reg)
        raise RegistryUnavailable(f"Registre en erreur (HTTP {resp.status_code})")
    record_success(reg)
    return resp.json()


def health_check(reg: dict) -> bool:
    try:
        ok = _client.get(f"{reg['endpoint_url']}/health", timeout=1.5).status_code == 200
    except httpx.HTTPError:
        ok = False
    (record_success if ok else record_failure)(reg)
    return ok


def record_failure(reg: dict) -> None:
    failures, just_opened = resilience.record_failure(reg["code"], reg["failure_threshold"])
    with db.tx() as c:
        c.execute(
            """UPDATE administrative_registry SET consecutive_failures=%s,
                   status = CASE WHEN %s >= failure_threshold THEN 'DOWN' ELSE 'DEGRADED' END,
                   circuit_opened_at = CASE WHEN %s THEN now() ELSE circuit_opened_at END,
                   last_health_check = now()
               WHERE id=%s""",
            (failures, failures, just_opened, reg["id"]))
        if just_opened:
            audit.log(c, "REGISTRY_DOWN", registry_id=reg["id"], decision="N/A")
            log.warning("Disjoncteur ouvert pour %s", reg["code"])


def record_success(reg: dict) -> None:
    recovered = resilience.record_success(reg["code"])
    with db.tx() as c:
        c.execute("""UPDATE administrative_registry SET consecutive_failures=0, status='UP',
                         circuit_opened_at=NULL, last_health_check=now() WHERE id=%s""",
                  (reg["id"],))
        if recovered:
            audit.log(c, "REGISTRY_RECOVERED", registry_id=reg["id"], decision="N/A")
            log.info("Registre %s rétabli", reg["code"])
