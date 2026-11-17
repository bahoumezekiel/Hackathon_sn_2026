import { useState } from "react";
import { Database, FileCheck2, KeyRound, Scale, ShieldCheck, ShieldX } from "lucide-react";
import { api } from "../api";
import { IDENTITY_STATUS, formatDate } from "../labels";
import { StatusPill, Verdict, summarizeDossier } from "./ui/StatusPill";

const ATTRIBUTE_LABELS = {
  nom: "Nom", prenoms: "Prénoms", date_naissance: "Date de naissance",
  lieu_naissance: "Lieu de naissance", sexe: "Sexe", pere: "Père", mere: "Mère",
};
const isPending = (r) => r.status === "QUEUED" || r.status === "PROCESSING";

function Signature({ jws }) {
  const [check, setCheck] = useState(null);
  return (
    <details className="sig">
      <summary><KeyRound aria-hidden="true" size={14} /> Attestation signée</summary>
      <code className="jws">{jws}</code>
      <div className="sig__row">
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => api.checkSignature(jws).then(setCheck).catch((e) => setCheck({ valid: false, error: e.message }))}>
          Vérifier la signature
        </button>
        <span aria-live="polite">
          {check && (check.valid
            ? <StatusPill tone="ok" size="sm">Signature valide · Vault Ed25519</StatusPill>
            : <StatusPill tone="deny" size="sm">{check.error || "Signature invalide"}</StatusPill>)}
        </span>
      </div>
    </details>
  );
}

function Attestation({ a }) {
  if (a.value && typeof a.value === "object") {
    return (
      <div className="attestation">
        <table className="attrs">
          <caption className="visually-hidden">Attributs d'état civil transmis</caption>
          <tbody>
            {Object.keys(ATTRIBUTE_LABELS).filter((k) => k in a.value).map((k) => (
              <tr key={k}><th scope="row">{ATTRIBUTE_LABELS[k]}</th><td>{a.value[k]}</td></tr>
            ))}
          </tbody>
        </table>
        <Signature jws={a.jws} />
      </div>
    );
  }
  const [label] = a.display.split(" : ");
  return (
    <div className="attestation">
      <div className="check-row">
        <span>{label}</span>
        <Verdict value={a.value} />
      </div>
      {a.served_from_cache && (
        <div className="banner banner--degraded">
          Registre momentanément indisponible : réponse issue d'une vérification du {formatDate(a.observed_at)}, autorisée par la politique.
        </div>
      )}
      <Signature jws={a.jws} />
    </div>
  );
}

function RegistryResult({ result }) {
  return (
    <div className="registry-result">
      <div className="registry-head">
        <span className="registry-name"><Database aria-hidden="true" size={16} /> {result.registry.name}</span>
        <StatusPill result={result} size="sm" count={result.retry_count} />
      </div>
      {result.decision === "DENY" && <div className="banner banner--deny"><ShieldX aria-hidden="true" size={16} /> <span>{result.decision_reason}</span></div>}
      {result.decision === "PARTIAL" && <div className="banner banner--info">{result.decision_reason}</div>}
      {result.decision !== "DENY" && isPending(result) && (
        <div className="banner banner--wait">
          Registre indisponible et aucune réponse récente réutilisable : relance automatique en cours, cette carte se mettra à jour toute seule.
        </div>
      )}
      {result.status === "FAILED" && <div className="banner banner--deny">{result.decision_reason}</div>}
      {result.attestations.map((a) => <Attestation key={a.predicate} a={a} />)}
    </div>
  );
}

export default function DossierCard({ purpose, results, ident, identityStatus, resolved }) {
  const expected = purpose.checks.reduce((n, c) => n + c.predicates.length, 0);
  const s = summarizeDossier(results, expected);
  const avoided = results.flatMap((r) => r.documents_replaced || []);
  const completed = results.some((r) => r.status === "COMPLETED");

  return (
    <article className={`card card--${s.tone} ${resolved ? "flash" : ""}`}>
      <div className="card-head">
        <span className="purpose-name">{purpose.label}</span>
        {IDENTITY_STATUS[identityStatus] && <span className="tag">{IDENTITY_STATUS[identityStatus]}</span>}
        <span className="muted mono">usager {ident}</span>
      </div>

      <div className={`summary summary--${s.tone}`}>
        {s.tone === "ok" ? <ShieldCheck aria-hidden="true" size={26} /> : null}
        <span className="summary__title">{s.title}</span>
        {s.total > 0 && <span className="summary__count">{s.met}/{s.total} condition{s.total > 1 ? "s" : ""}</span>}
      </div>

      {avoided.length > 0 && (
        <div className="avoided">
          <FileCheck2 aria-hidden="true" size={16} />
          <span><b>{avoided.length} pièce{avoided.length > 1 ? "s" : ""}</b> que l'usager n'a pas eu à fournir : {avoided.join(" · ")}</span>
        </div>
      )}
      {purpose.decision_note && completed && (
        <div className="banner banner--info"><Scale aria-hidden="true" size={16} /> <span>{purpose.decision_note}</span></div>
      )}
      {results.map((r) => <RegistryResult key={r.request_id} result={r} />)}
    </article>
  );
}
