class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function detailOf(data, status) {
  const detail = data?.detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join(" ; ");
  if (typeof detail === "string") return detail;
  if (status === 403) return "Action non autorisée pour votre compte.";
  if (status >= 500) return "Le service rencontre un problème. Réessayez dans un instant.";
  return `Erreur ${status}`;
}

/** Client de la passerelle FasoLink, relayée sous /api (même origine : ni CORS ni cookie).
 *  Chaque appel porte un jeton frais et échoue proprement au-delà du délai. */
export function createApi(session, { timeoutMs = 15_000 } = {}) {
  return async function request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = `Bearer ${await session.token()}`;

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err.name === "TimeoutError";
      throw new ApiError(timeout ? "Le service ne répond pas. Réessayez." : "Connexion au service impossible.", 0);
    }

    if (res.status === 401 && auth) session.login();
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(detailOf(data, res.status), res.status);
    return data;
  };
}
