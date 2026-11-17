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

// État d'un registre → [ton StatusPill, libellé]
export const REGISTRY_STATE = {
  UP: ["ok", "Opérationnel"],
  DEGRADED: ["degraded", "Instable"],
  DOWN: ["deny", "En panne"],
  MAINTENANCE: ["wait", "Maintenance"],
};

// Statut d'une alerte → [ton StatusPill, libellé]
export const ALERT_STATUS = {
  OPEN: ["deny", "Ouverte"],
  IN_REVIEW: ["wait", "En cours"],
  RESOLVED: ["ok", "Résolue"],
  REJECTED: ["fail", "Rejetée"],
};
