"""Tâche de fond de la passerelle, lancée au démarrage de l'API.

À chaque tour : santé des registres (disjoncteurs), relance des demandes en attente
et expiration des accords SMS restés sans réponse.
"""
import logging
import threading
from contextlib import contextmanager

from . import config, consentement_sms, db, registry_client, service

log = logging.getLogger("fasolink.worker")


def _tick() -> None:
    service.resync_queue()
    with db.tx() as c:
        registries = c.execute("SELECT * FROM administrative_registry").fetchall()
    for reg in registries:
        registry_client.health_check(reg)
    if (n := service.process_due_queue()):
        log.info("%s demande(s) relancée(s)", n)
    if (n := consentement_sms.expire_due()):
        log.info("%s demande(s) refusée(s) : accord SMS non reçu", n)


def _loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            _tick()
        except Exception:  # une erreur passagère (base, Redis…) ne doit pas arrêter la boucle
            log.exception("Erreur dans la tâche de fond")
        stop.wait(config.WORKER_INTERVAL_S)


@contextmanager
def running():
    """Démarre la boucle dans un thread et l'arrête proprement à la sortie."""
    stop = threading.Event()
    thread = threading.Thread(target=_loop, args=(stop,), daemon=True, name="fasolink-worker")
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=5)
