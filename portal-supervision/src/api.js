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
  overview: () => Promise.all([
    request("/supervision/stack"),
    request("/supervision/registries"),
    request("/supervision/requests"),
    request("/supervision/alerts"),
    request("/supervision/integrity"),
    request("/supervision/impact"),
  ]).then(([stack, registries, requests, alerts, integrity, impact]) =>
    ({ stack, registries, requests, alerts, integrity, impact })),
  simulate: (code, down) => request(`/supervision/registries/${code}/simulate`, { method: "POST", body: { down } }),
  updateAlert: (id, status) => request(`/supervision/alerts/${id}`, { method: "POST", body: { status } }),
};
