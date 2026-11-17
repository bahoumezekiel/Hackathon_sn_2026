import { useState } from "react";
import { AnimatePresence, m } from "motion/react";
import {
  IDENTITY_STATUS, formatDateTime, formatTime, isDenied, isPending, pieceLabel, plural, purposeLabel,
} from "@fasolink/shared/format";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "./api";

const EXPAND = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.35 },
};

/** Réponse affichée pour une pièce : Oui, Non, refusée, en attente ou en échec. */
function outcomeOf(item) {
  const { result, error } = item;
  if (error) return { kind: "failed", label: "Échec", reason: error };
  if (isDenied(result)) return { kind: "denied", label: "Refusée", reason: result.decision_reason };
  if (isPending(result)) {
    const retry = result.next_retry_at ? ` Nouvelle tentative à ${formatTime(result.next_retry_at)}.` : "";
    return { kind: "pending", label: "En attente", reason: `Registre indisponible : relance automatique.${retry}` };
  }
  if (result.status === "FAILED") return { kind: "failed", label: "Échec", reason: result.decision_reason };
  return { kind: "answered" };
}

function Proof({ attestation }) {
  const [check, setCheck] = useState(null); // null · "busy" · résultat de /v1/attestations/verify
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const expired = new Date(attestation.expires_at) < new Date();

  async function verify() {
    setCheck("busy");
    setCheck(await api.checkSignature(attestation.jws).catch((err) => ({ valid: false, error: err.message })));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(attestation.jws);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Presse-papiers refusé par le navigateur : le jeton reste sélectionnable à la main.
    }
  }

  return (
    <m.div className="proof" {...EXPAND}>
      <div className="proof-inner">
        <p className="proof-meta">
          Attestation signée par FasoLink · {expired ? "expirée" : `valable jusqu'à ${formatTime(attestation.expires_at)}`}
        </p>
        <div className="proof-actions">
          <button type="button" className="btn btn-secondary" onClick={verify} disabled={check === "busy"}>
            {check === "busy" ? <><Spinner /> Vérification…</> : "Vérifier la signature"}
          </button>
          <button type="button" className="btn btn-quiet" aria-expanded={showToken} onClick={() => setShowToken((v) => !v)}>
            {showToken ? "Masquer le jeton" : "Voir le jeton"}
          </button>
        </div>
        {check && check !== "busy" && (
          <p className={`notice ${check.valid ? "notice-info" : "notice-danger"}`} role="status">
            {check.valid
              ? `Signature valide : émise pour ${check.claims.aud}, finalité « ${purposeLabel(check.claims.purpose).toLowerCase()} ».`
              : check.error}
          </p>
        )}
        {showToken && (
          <div className="token">
            <code>{attestation.jws}</code>
            <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? "Copié" : "Copier"}</button>
          </div>
        )}
      </div>
    </m.div>
  );
}

function PieceRow({ item, predicateLabels }) {
  const [proofOpen, setProofOpen] = useState(false);
  const outcome = outcomeOf(item);
  const attestations = outcome.kind === "answered" ? item.result.attestations : [];

  return (
    <li className={`piece-row is-${outcome.kind}${item.resolved ? " is-resolved" : ""}`}>
      <div className="piece-row-main">
        <div className="piece-row-text">
          <p className="piece-row-name">{pieceLabel(item.purpose.allowed_predicates[0])}</p>
          <p className="piece-row-meta">{purposeLabel(item.purpose.purpose_code)} · {item.purpose.registry_name}</p>
        </div>

        <div className="piece-row-answer">
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={outcome.kind}
              className="answers"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {outcome.kind === "answered"
                ? attestations.map((a) => (
                  <span key={a.predicate} className={`answer ${a.value === true ? "is-yes" : "is-no"}`}>
                    {attestations.length > 1 && <span className="answer-label">{predicateLabels[a.predicate] ?? a.predicate}</span>}
                    {a.value === true ? "Oui" : a.value === false ? "Non" : String(a.value)}
                  </span>
                ))
                : (
                  <span className={`answer is-${outcome.kind}`}>
                    {outcome.kind === "pending" && <Spinner />}
                    {outcome.label}
                  </span>
                )}
            </m.div>
          </AnimatePresence>
        </div>

        {attestations.length > 0 && (
          <button type="button" className="btn btn-quiet proof-toggle" aria-expanded={proofOpen} onClick={() => setProofOpen((v) => !v)}>
            Preuve
          </button>
        )}
      </div>

      {outcome.reason && <p className="piece-row-reason">{outcome.reason}</p>}
      {attestations.filter((a) => a.served_from_cache).map((a) => (
        <p key={a.predicate} className="piece-row-reason is-cache">
          Registre indisponible : réponse vérifiée le {formatDateTime(a.observed_at)}, réutilisée comme l'autorise la
          politique d'accès.
        </p>
      ))}
      <AnimatePresence initial={false}>
        {proofOpen && attestations.map((a) => <Proof key={a.predicate} attestation={a} />)}
      </AnimatePresence>
    </li>
  );
}

/** Synthèse du dossier : « 2 Oui · 1 Non · 1 refusée ». */
function tally(items) {
  const count = { yes: 0, no: 0, other: 0 };
  for (const item of items) {
    if (outcomeOf(item).kind !== "answered") count.other += 1;
    else for (const a of item.result.attestations) count[a.value === true ? "yes" : "no"] += 1;
  }
  return count;
}

export default function Dossier({ dossier, predicateLabels, open, onToggle }) {
  const { citizen, items } = dossier;
  const count = tally(items);
  const identity = IDENTITY_STATUS[dossier.identityStatus];
  const bodyId = `dossier-${dossier.id}`;

  return (
    <m.article
      layout="position"
      className={`card dossier${open ? " is-open" : ""}`}
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <button type="button" className="dossier-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="dossier-who">
          <span className="dossier-name">{citizen.name ?? "Usager"}</span>
          <span className="mono dossier-id">{citizen.id}</span>
        </span>
        <span className="dossier-tally">
          {count.yes > 0 && <span className="tally is-yes">{count.yes} Oui</span>}
          {count.no > 0 && <span className="tally is-no">{count.no} Non</span>}
          {count.other > 0 && <span className="tally is-other">{plural(count.other, "sans réponse", "sans réponse")}</span>}
        </span>
        <time className="dossier-time" dateTime={dossier.at}>{formatTime(dossier.at)}</time>
        <span className="chevron" aria-hidden="true" />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <m.div id={bodyId} className="dossier-body" {...EXPAND}>
            {identity && <p className="dossier-identity"><Badge tone="warning">{identity}</Badge></p>}
            <ul className="piece-rows">
              {items.map((item) => <PieceRow key={item.key} item={item} predicateLabels={predicateLabels} />)}
            </ul>
            <p className="dossier-motive"><span>Motif déclaré</span>{dossier.justification}</p>
          </m.div>
        )}
      </AnimatePresence>
    </m.article>
  );
}
