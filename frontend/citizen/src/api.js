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

/** Inscription (pages publiques, sans jeton) : vérification de l'IUE auprès de l'ONI puis code SMS. */
export const signup = {
  start: (iue, dateNaissance) =>
    request("/public/inscription/code", { method: "POST", body: { iue, date_naissance: dateNaissance }, auth: false }),
  confirm: (token, code, password) =>
    request("/public/inscription/confirmation", { method: "POST", body: { token, code, password }, auth: false }),
  demo: () => request("/demo/config", { auth: false }).catch(() => null),
};

/** Démonstration : téléphone simulé d'un usager (SMS reçus, réponses 1/2). */
export const phone = {
  inbox: (number) => request(`/demo/telephone/${encodeURIComponent(number)}`, { auth: false }),
  reply: (number, text) =>
    request(`/demo/telephone/${encodeURIComponent(number)}`, { method: "POST", body: { text }, auth: false }),
};
