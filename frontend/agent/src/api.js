import { createApi } from "@fasolink/shared/api";
import { createSession } from "@fasolink/shared/auth";

export const session = createSession("portal-agent");
const request = createApi(session);

export const api = {
  context: () => request("/v1/purposes"),
  verify: (payload) => request("/v1/verifications", { method: "POST", body: payload }),
  request: (id) => request(`/v1/requests/${encodeURIComponent(id)}`),
  checkSignature: (jws) => request("/v1/attestations/verify", { method: "POST", body: { jws }, auth: false }),
  /** Mode démonstration uniquement (404 sinon) : usagers fictifs à sélectionner en un clic. */
  demo: () => request("/demo/config", { auth: false }).catch(() => null),
};
