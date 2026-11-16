export const PURPOSES = {
  VERIF_MAJORITE: "Vérification de majorité",
  VERIF_NATIONALITE: "Vérification de nationalité",
  VERIF_CASIER_EMPLOI: "Vérification du casier (emploi)",
};
export const purposeLabel = (code) => PURPOSES[code] || code;

export const IDENTITY_STATUS = {
  NO_IUE: "Procédure alternative (sans IUE)",
  IDENTITY_PENDING: "Enrôlement en cours",
  UNVERIFIABLE: "IUE non vérifiable",
};

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "";
