export const PURPOSES = {
  VERIF_MAJORITE: "Majorité",
  VERIF_NATIONALITE: "Nationalité",
  VERIF_CASIER_EMPLOI: "Casier (emploi)",
};
export const purposeLabel = (code) => PURPOSES[code] || code || "—";

export function ago(iso) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${Math.max(s, 0)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

export const time = (iso) => new Date(iso).toLocaleTimeString("fr-FR");

export const REGISTRY_STATE = {
  UP: ["up", "Opérationnel"],
  DEGRADED: ["warn", "Instable"],
  DOWN: ["down", "En panne"],
  MAINTENANCE: ["warn", "Maintenance"],
};

export const ALERT_STATUS = { OPEN: "Ouverte", IN_REVIEW: "En cours", RESOLVED: "Résolue", REJECTED: "Rejetée" };

export function requestState(q) {
  if (q.decision === "DENY") return ["down", "Refusé"];
  if (q.status === "QUEUED" || q.status === "PROCESSING") return ["warn", "En attente"];
  if (q.status === "FAILED") return ["down", "Échec"];
  if (q.service_mode === "DEGRADED_CACHE") return ["warn", "Mode dégradé"];
  if (q.service_mode === "QUEUED_RETRY") return ["up", "Relancée"];
  return ["up", "Autorisé"];
}
