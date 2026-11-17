import { createApi } from "@fasolink/shared/api";
import { createSession } from "@fasolink/shared/auth";

export const session = createSession("portal-citizen");
const request = createApi(session);

export const api = {
  history: () => request("/citizen/history"),
  integrity: () => request("/citizen/integrity"),
  consents: () => request("/citizen/consents"),
  setConsent: (policyCode, grant) =>
    request("/citizen/consents", { method: "POST", body: { policy_code: policyCode, grant } }),
  report: (requestId, description, channel) =>
    request("/citizen/alerts", { method: "POST", body: { request_id: requestId, description, channel } }),
};
