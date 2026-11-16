import { keycloak } from "./auth";

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    await keycloak.updateToken(30).catch(() => keycloak.login());
    headers.Authorization = `Bearer ${keycloak.token}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
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
  purposes: () => request("/v1/purposes"),
  verify: (payload) => request("/v1/verifications", { method: "POST", body: payload }),
  request: (id) => request(`/v1/requests/${id}`),
  checkSignature: (jws) => request("/v1/attestations/verify", { method: "POST", body: { jws }, auth: false }),
  demoDirectory: () => request("/demo/config", { auth: false }),
};
