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
  /** Mode démonstration uniquement (404 sinon) : autorise la simulation de panne. */
  demo: () => request("/demo/config", { auth: false }).then(() => true, () => false),
};
