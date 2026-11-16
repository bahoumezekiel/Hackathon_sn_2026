import { keycloak } from "./auth";

async function request(path, { method = "GET", body } = {}) {
  await keycloak.updateToken(30).catch(() => keycloak.login());
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${keycloak.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(", ") : data.detail;
    throw new Error(detail || `Erreur ${res.status}`);
  }
  return data;
}

export const api = {
  history: () => request("/citizen/history"),
  integrity: () => request("/citizen/integrity"),
  consents: () => request("/citizen/consents"),
  setConsent: (policy_code, grant) => request("/citizen/consents", { method: "POST", body: { policy_code, grant } }),
  report: (request_id, description, channel) =>
    request("/citizen/alerts", { method: "POST", body: { request_id, description, channel } }),
};
