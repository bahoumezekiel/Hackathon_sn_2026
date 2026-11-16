import { useState } from "react";
import { api } from "../api";
import { IDENTITY_STATUS, formatDate, purposeLabel } from "../labels";

function StatusPill({ result }) {
  if (result.decision === "DENY") return <span className="pill bad">Refusé</span>;
  if (result.status === "QUEUED" || result.status === "PROCESSING") return <span className="pill warn">En attente</span>;
  if (result.status === "FAILED") return <span className="pill bad">Échec</span>;
  if (result.service_mode === "DEGRADED_CACHE") return <span className="pill warn">Mode dégradé</span>;
  if (result.service_mode === "QUEUED_RETRY") return <span className="pill ok">Relancée automatiquement</span>;
  return <span className="pill ok">Autorisé</span>;
}

function Attestation({ a }) {
  const [check, setCheck] = useState(null);
  return (
    <div className="attestation">
      <div className={`answer ${a.value === true ? "yes" : "no"}`}>{a.display}</div>
      {a.served_from_cache && (
        <div className="banner warn">
          Registre momentanément indisponible : réponse issue d'une vérification du {formatDate(a.observed_at)}, autorisée par la politique.
        </div>
      )}
      <details>
        <summary>Attestation signée — valable jusqu'au {formatDate(a.expires_at)}</summary>
        <code className="jws">{a.jws}</code>
        <button type="button" className="btn ghost small"
          onClick={() => api.checkSignature(a.jws).then(setCheck).catch((e) => setCheck({ valid: false, error: e.message }))}>
          Vérifier la signature
        </button>
        {check && (check.valid
          ? <span className="pill ok">Signature valide (Vault · Ed25519)</span>
          : <span className="pill bad">{check.error}</span>)}
      </details>
    </div>
  );
}

export default function AnswerCard({ result, ident, identityStatus, resolved }) {
  const pending = result.status === "QUEUED" || result.status === "PROCESSING";
  return (
    <article className={`card ${resolved ? "flash" : ""}`}>
      <div className="card-head">
        <StatusPill result={result} />
        {IDENTITY_STATUS[identityStatus] && <span className="pill neutral">{IDENTITY_STATUS[identityStatus]}</span>}
        <span className="muted">{result.registry.name} · {purposeLabel(result.purpose_code)} · usager {ident}</span>
      </div>

      {result.decision === "DENY" && (
        <>
          <div className="answer no">Accès refusé</div>
          <div className="banner bad">{result.decision_reason}</div>
        </>
      )}
      {result.decision !== "DENY" && pending && (
        <>
          <div className="answer wait">En attente du registre</div>
          <div className="banner warn">
            Le registre « {result.registry.name} » est indisponible et aucune réponse récente n'est réutilisable.
            La demande sera relancée automatiquement : cette carte se mettra à jour toute seule.
          </div>
        </>
      )}
      {result.status === "FAILED" && <div className="banner bad">{result.decision_reason}</div>}
      {result.status === "COMPLETED" && (
        <>
          {result.attestations.map((a) => <Attestation key={a.predicate} a={a} />)}
          <div className="muted small">
            Données transmises : {result.attestations.length} réponse(s) Oui/Non — aucune donnée personnelle brute.
          </div>
        </>
      )}
    </article>
  );
}
