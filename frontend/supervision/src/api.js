import { createApi } from "@fasolink/shared/api";
import { createSession } from "@fasolink/shared/auth";

export const session = createSession("portal-supervision");
const request = createApi(session);

export const api = {
  overview: async () => {
    const [stack, registries, requests, alerts, integrity] = await Promise.all([
      request("/supervision/stack"),
      request("/supervision/registries"),
      request("/supervision/requests"),
      request("/supervision/alerts"),
      request("/supervision/integrity"),
    ]);
    return { stack, registries, requests, alerts, integrity };
  },
  simulate: (code, down) =>
    request(`/supervision/registries/${encodeURIComponent(code)}/simulate`, { method: "POST", body: { down } }),
  updateAlert: (id, status, note) =>
    request(`/supervision/alerts/${encodeURIComponent(id)}`, { method: "POST", body: { status, note: note || null } }),
  // Référentiel (rôle platform_admin) : structures, agents, cas d'usage
  catalogue: () => request("/admin/catalogue"),
  administrations: () => request("/admin/administrations"),
  createAdministration: (body) => request("/admin/administrations", { method: "POST", body }),
  setAdministrationStatus: (code, status) =>
    request(`/admin/administrations/${encodeURIComponent(code)}/status`, { method: "POST", body: { status } }),
  agents: (code) => request(`/admin/administrations/${encodeURIComponent(code)}/agents`),
  createAgent: (code, body) => request(`/admin/administrations/${encodeURIComponent(code)}/agents`, { method: "POST", body }),
  setAgentEnabled: (code, id, enabled) =>
    request(`/admin/administrations/${encodeURIComponent(code)}/agents/${encodeURIComponent(id)}`, { method: "POST", body: { enabled } }),
  casUsage: (code) => request(`/admin/administrations/${encodeURIComponent(code)}/cas-usage`),
  createCasUsage: (code, body) =>
    request(`/admin/administrations/${encodeURIComponent(code)}/cas-usage`, { method: "POST", body }),
  updateCasUsage: (id, body) => request(`/admin/cas-usage/${encodeURIComponent(id)}`, { method: "PUT", body }),
  deactivateCasUsage: (id) => request(`/admin/cas-usage/${encodeURIComponent(id)}/deactivate`, { method: "POST" }),
  /** Mode démonstration uniquement (404 sinon) : autorise la simulation de panne. */
  demo: () => request("/demo/config", { auth: false }).then(() => true, () => false),
};
