// FasoLink — StatusPill, Verdict et utilitaires d'état
// Ne lit que des champs déjà renvoyés par l'API : status, decision, service_mode.
// Dépendance : lucide-react (imports nommés, compatibles tree-shaking).
import {
  Check,
  X,
  Clock,
  AlertTriangle,
  RotateCw,
  AlertCircle,
  Contrast,
} from "lucide-react";
import "./StatusPill.css";

/** Définition des tons : libellé par défaut + icône. */
export const TONES = {
  ok:       { label: "Autorisé",                 Icon: Check },
  partial:  { label: "Partiel",                  Icon: Contrast },
  deny:     { label: "Refusé",                   Icon: X },
  wait:     { label: "En attente",               Icon: Clock },
  degraded: { label: "Mode dégradé",             Icon: AlertTriangle },
  retry:    { label: "Relancée automatiquement", Icon: RotateCw },
  fail:     { label: "Échec",                    Icon: AlertCircle },
};

/**
 * Déduit le ton d'un résultat de registre (POST /v1/verifications,
 * GET /v1/requests/{id}) ou d'un accès citoyen (GET /citizen/history).
 * L'ordre des tests compte : un échec ou une attente prime sur la décision.
 *
 * @param {{status?: string, decision?: string, service_mode?: string}} r
 * @returns {keyof TONES}
 */
export function toneFromResult(r = {}) {
  const { status, decision, service_mode: mode } = r;
  if (status === "FAILED") return "fail";
  if (status === "QUEUED" || status === "PROCESSING") return "wait";
  if (status === "DENIED" || decision === "DENY") return "deny";
  if (mode === "DEGRADED_CACHE") return "degraded";
  if (mode === "QUEUED_RETRY" && status === "COMPLETED") return "retry";
  if (decision === "PARTIAL") return "partial";
  if (decision === "PERMIT" || status === "COMPLETED") return "ok";
  return "wait";
}

/**
 * Pastille d'état : couleur + icône + mot (jamais la couleur seule).
 *
 * Usage :
 *   <StatusPill result={res} />                         // ton déduit de l'API
 *   <StatusPill tone="deny" />                           // ton imposé
 *   <StatusPill tone="ok">Opérationnel</StatusPill>      // libellé libre (supervision)
 *   <StatusPill result={res} count={2} />                // « Relancée ×2 »
 */
export function StatusPill({ result, tone, count, size = "md", children, className = "" }) {
  const t = tone ?? toneFromResult(result);
  const { label, Icon } = TONES[t] ?? TONES.wait;
  const text = children ?? label;

  return (
    <span className={`fl-pill fl-pill--${t} fl-pill--${size} ${className}`.trim()}>
      <Icon className="fl-pill__icon" aria-hidden="true" strokeWidth={2.6} />
      <span>{text}</span>
      {count > 1 && <span className="fl-pill__count">×{count}</span>}
    </span>
  );
}

/**
 * Réponse Oui/Non d'un prédicat (attestation.value === true | false).
 * Valeur inconnue → tiret neutre avec texte pour les lecteurs d'écran.
 */
export function Verdict({ value }) {
  if (value === true) {
    return (
      <span className="fl-verdict fl-verdict--yes">
        <Check aria-hidden="true" strokeWidth={3} className="fl-verdict__icon" />
        Oui
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="fl-verdict fl-verdict--no">
        <X aria-hidden="true" strokeWidth={3} className="fl-verdict__icon" />
        Non
      </span>
    );
  }
  return (
    <span className="fl-verdict fl-verdict--unknown">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">Réponse non disponible</span>
    </span>
  );
}

/**
 * Synthèse d'un dossier, calculée à partir des résultats déjà reçus.
 * `expected` (facultatif) = nombre de conditions Oui/Non prévues par la démarche :
 * il permet d'afficher « 2/4 » quand un registre n'a pas encore répondu.
 * Renvoie { tone, title, met, total } pour la grande ligne de la carte.
 */
export function summarizeDossier(results = [], expected = 0) {
  const predicates = results.flatMap((r) =>
    (r.attestations ?? []).filter((a) => typeof a.value === "boolean")
  );
  const total = Math.max(predicates.length, expected);
  const met = predicates.filter((a) => a.value === true).length;
  const pending = results.some((r) => ["QUEUED", "PROCESSING"].includes(r.status));
  const denied = results.some((r) => toneFromResult(r) === "deny" || r.status === "FAILED");

  // Démarche sans condition Oui/Non (attributs seuls, ex. bulletin n°3)
  if (total === 0) {
    if (pending) return { tone: "wait", title: "En attente du registre", met, total };
    if (denied) return { tone: "deny", title: "Accès refusé", met, total };
    return { tone: "ok", title: "Informations d'état civil reçues", met, total };
  }
  if (pending) {
    return { tone: "wait", title: "En attente…", met, total };
  }
  if (met === total && !denied) {
    return { tone: "ok", title: "Toutes les conditions sont remplies", met, total };
  }
  return { tone: "deny", title: "Dossier incomplet", met, total };
}
