export const PURPOSES = {
  VERIF_MAJORITE: "Vérification de majorité",
  VERIF_NATIONALITE: "Vérification de nationalité",
  VERIF_CASIER_EMPLOI: "Vérification du casier (emploi)",
};
export const purposeLabel = (code) => PURPOSES[code] || code;

export const formatDate = (iso) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `il y a ${Math.max(s, 0)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return formatDate(iso);
}

export const isDenied = (a) => a.decision === "DENY";
export const isPending = (a) => a.status === "QUEUED" || a.status === "PROCESSING";

/** Phrase simple décrivant un accès, utilisée par la liste et par l'assistant vocal. */
export function describe(a) {
  const purpose = purposeLabel(a.purpose_code).toLowerCase();
  if (isDenied(a)) return `${a.administration} a tenté une ${purpose} ${ago(a.created_at)}, mais l'accès a été refusé.`;
  const what = a.shared.map((s) => s.display).join(", ") || "aucune information pour l'instant";
  return `${a.administration}, ${ago(a.created_at)}, pour une ${purpose}. Information transmise : ${what}.`;
}
