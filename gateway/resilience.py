"""État de résilience partagé dans Redis : disjoncteurs, cache du mode dégradé, file de relance.

PostgreSQL reste la source de vérité des demandes (statut QUEUED) : si Redis
perd sa file, elle est reconstruite à partir de la base (resync_queue).
"""
import json
import logging
import time

import redis

from . import config

log = logging.getLogger("fasolink.resilience")

r = redis.Redis.from_url(config.REDIS_URL, decode_responses=True,
                         socket_timeout=2, socket_connect_timeout=2)

P = "fasolink"
QUEUE = f"{P}:retry"

# Échec : +1 ; ouverture (ou réouverture après essai) au-delà du seuil.
# Renvoie {échecs, 2 si le disjoncteur vient de s'ouvrir / 1 s'il était déjà ouvert / 0 sinon}
_FAIL = r.register_script("""
local f = redis.call('HINCRBY', KEYS[1], 'failures', 1)
local was = redis.call('HGET', KEYS[1], 'opened_at')
if f >= tonumber(ARGV[1]) then
  redis.call('HSET', KEYS[1], 'opened_at', ARGV[2])
  if was then return {f, 1} end
  return {f, 2}
end
return {f, 0}
""")

# Succès : remise à zéro. Renvoie 1 si le disjoncteur était ouvert.
_OK = r.register_script("""
local was = redis.call('HGET', KEYS[1], 'opened_at')
redis.call('DEL', KEYS[1])
if was then return 1 end
return 0
""")


def _cb(code: str) -> str:
    return f"{P}:cb:{code}"


# --------------------------------------------------------------- disjoncteur

def circuit(code: str) -> dict:
    try:
        h = r.hgetall(_cb(code))
    except redis.RedisError:
        return {"failures": 0, "opened_at": None, "open": False, "redis": False}
    opened = float(h["opened_at"]) if "opened_at" in h else None
    return {"failures": int(h.get("failures", 0)), "opened_at": opened,
            "open": opened is not None and time.time() - opened < config.CIRCUIT_COOLDOWN_S,
            "redis": True}


def record_failure(code: str, threshold: int) -> tuple[int, bool]:
    """Renvoie (échecs consécutifs, vient_de_s_ouvrir)."""
    try:
        failures, state = _FAIL(keys=[_cb(code)], args=[threshold, time.time()])
        return int(failures), int(state) == 2
    except redis.RedisError:
        log.warning("Redis indisponible : disjoncteur non mis à jour")
        return 0, False


def record_success(code: str) -> bool:
    """Renvoie True si le disjoncteur était ouvert (registre rétabli)."""
    try:
        return bool(_OK(keys=[_cb(code)]))
    except redis.RedisError:
        return False


# --------------------------------------------------------------- cache du mode dégradé
# Ne contient que des PRÉDICATS (Oui/Non) déjà calculés, jamais de donnée brute,
# et uniquement pour les politiques qui l'autorisent (degraded_cache_ttl_s > 0).

def _cache_key(identity_id, registry_code, predicate, admin_id, purpose) -> str:
    return f"{P}:att:{identity_id}:{registry_code}:{predicate}:{admin_id}:{purpose}"


def cache_put(identity_id, registry_code, predicate, admin_id, purpose, value, observed_at, ttl_s):
    if ttl_s <= 0:
        return
    try:
        r.set(_cache_key(identity_id, registry_code, predicate, admin_id, purpose),
              json.dumps({"value": value, "observed_at": observed_at.isoformat()}), ex=ttl_s)
    except redis.RedisError:
        log.warning("Redis indisponible : attestation non mise en cache")


def cache_get(identity_id, registry_code, predicate, admin_id, purpose) -> dict | None:
    try:
        raw = r.get(_cache_key(identity_id, registry_code, predicate, admin_id, purpose))
    except redis.RedisError:
        return None
    return json.loads(raw) if raw else None


# --------------------------------------------------------------- file de relance

def queue_add(request_id, when_ts: float) -> bool:
    try:
        r.zadd(QUEUE, {str(request_id): when_ts})
        return True
    except redis.RedisError:
        log.warning("Redis indisponible : la demande %s sera reprise depuis la base", request_id)
        return False


def queue_due(limit: int = 20) -> list[str]:
    try:
        return r.zrangebyscore(QUEUE, "-inf", time.time(), start=0, num=limit)
    except redis.RedisError:
        return []


def queue_claim(request_id) -> bool:
    """Retrait atomique : une seule instance de la passerelle traite la demande."""
    try:
        return r.zrem(QUEUE, str(request_id)) == 1
    except redis.RedisError:
        return False


def queue_size() -> int:
    try:
        return r.zcard(QUEUE)
    except redis.RedisError:
        return -1


def health() -> bool:
    try:
        return r.ping()
    except redis.RedisError:
        return False
