const PURPOSES = {
  VERIF_MAJORITE: "Vérification de majorité",
  VERIF_NATIONALITE: "Vérification de nationalité",
  VERIF_CASIER_EMPLOI: "Vérification du casier pour un emploi",
};
/** Libellé d'une finalité : celui du cas d'usage fourni par l'API, sinon le libellé connu, sinon le code. */
export const purposeLabel = (code, label) => label ?? PURPOSES[code] ?? code ?? "—";

/** Pièce justificative que chaque information remplace : l'usager n'a plus à la fournir. */
const PIECES = {
  est_majeur: "Acte de naissance",
  nationalite_burkinabe: "Certificat de nationalité",
  casier_compatible_finalite: "Extrait de casier judiciaire",
};
export const pieceLabel = (predicate) => PIECES[predicate] ?? predicate;

export const IDENTITY_STATUS = {
  NO_IUE: "Procédure alternative, sans IUE",
  IDENTITY_PENDING: "Enrôlement en cours",
  UNVERIFIABLE: "IUE non vérifiable",
};

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const clock = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const relative = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

export const formatDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : "—");
export const formatTime = (iso) => (iso ? clock.format(new Date(iso)) : "—");

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "—";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "à l'instant";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return formatDateTime(iso);
}

/** « 1 événement », « 0 événement », « 3 événements » (règle française : pluriel à partir de 2). */
export const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;

export const isPending = (r) => r.status === "QUEUED" || r.status === "PROCESSING";
export const isDenied = (r) => r.decision === "DENY";
/** Accord de l'usager demandé par SMS, réponse pas encore reçue. */
export const isAwaitingConsent = (r) => r.status === "AWAITING_CONSENT";
/** Fiche encore ouverte : registre indisponible ou accord SMS attendu. */
export const isOpenRequest = (r) => isPending(r) || isAwaitingConsent(r);

/** État lisible d'une demande, commun aux trois portails. */
export function requestState(r) {
  if (isDenied(r)) return { tone: "danger", label: "Refusé" };
  if (isAwaitingConsent(r)) return { tone: "warning", label: "Accord SMS attendu" };
  if (isPending(r)) return { tone: "warning", label: "En attente" };
  if (r.status === "FAILED") return { tone: "danger", label: "Échec" };
  if (r.service_mode === "DEGRADED_CACHE") return { tone: "warning", label: "Mode dégradé" };
  if (r.service_mode === "QUEUED_RETRY") return { tone: "success", label: "Relancée" };
  return { tone: "success", label: "Autorisé" };
}
