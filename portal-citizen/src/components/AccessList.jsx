import { useState } from "react";
import { Building2, EyeOff, FileCheck2, Flag, History } from "lucide-react";
import { api } from "../api";
import { ATTRIBUTE_LABELS, ago, formatDate, isDenied, isPending, purposeLabel } from "../labels";
import { StatusPill, toneFromResult } from "./ui/StatusPill";

const attrKeys = (value) => Object.keys(ATTRIBUTE_LABELS).filter((k) => k in value);

function Access({ a, onReported }) {
  const [reporting, setReporting] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("Je ne reconnais pas cette démarche.");
  const tone = toneFromResult(a);
  // Champs lus dans le registre mais NON transmis (les attributs transmis sont affichés au-dessus)
  const sentKeys = new Set(a.shared.flatMap((s) => (s.value && typeof s.value === "object" ? Object.keys(s.value) : [])));
  const readOnly = (a.fields_read || []).filter((f) => !sentKeys.has(f));

  async function report() {
    setSending(true);
    try {
      await api.report(a.id, text, "WEB");
      setReporting(false);
      onReported();
    } finally {
      setSending(false);
    }
  }

  return (
    <li className={`access access--${tone}`}>
      <div className="access__head">
        <time className="when" dateTime={a.created_at} title={formatDate(a.created_at)}>{ago(a.created_at)}</time>
        <StatusPill result={a} size="sm" />
      </div>
      <h3 className="who"><Building2 aria-hidden="true" size={18} /> {a.administration}</h3>
      <div className="why">{a.purpose_label || purposeLabel(a.purpose_code)} · {a.registry}</div>

      {isDenied(a) && <div className="result result--deny">L'accès a été refusé : {a.decision_reason}</div>}
      {isPending(a) && <div className="result result--wait">Le registre est momentanément indisponible ; la demande sera relancée automatiquement.</div>}
      {a.shared.map((s) => (s.value && typeof s.value === "object" ? (
        <div key={s.predicate} className="result result--ok">
          <span className="result__label">Transmis</span>
          <b>{attrKeys(s.value).map((k) => ATTRIBUTE_LABELS[k]).join(", ")}</b>
          <dl className="values">
            {attrKeys(s.value).map((k) => <div key={k}><dt>{ATTRIBUTE_LABELS[k]}</dt><dd>{s.value[k]}</dd></div>)}
          </dl>
        </div>
      ) : (
        <div key={s.predicate} className="result result--ok">
          <span className="result__label">Transmis</span>
          <b>{s.display}</b>
          {s.from_cache && <span className="tag tag--degraded">réponse réutilisée</span>}
        </div>
      )))}

      {a.documents_avoided?.length > 0 && (
        <div className="avoided">
          <FileCheck2 aria-hidden="true" size={16} />
          <span>Pièce que vous n'avez pas eu à fournir : <b>{a.documents_avoided.join(", ")}</b></span>
        </div>
      )}

      <dl className="facts">
        <dt>Motif déclaré</dt><dd>{a.justification || "—"}</dd>
        {readOnly.length > 0 && (
          <><dt>Lu sans être transmis</dt><dd><EyeOff aria-hidden="true" size={14} /> {readOnly.join(", ")}</dd></>
        )}
        <dt>Preuve</dt><dd className="mono proof">#{a.proof.seq} · {a.proof.hash.slice(0, 16)}…</dd>
      </dl>

      {a.alerted && <span className="tag tag--wait"><Flag aria-hidden="true" size={12} /> Signalement envoyé</span>}
      {!a.alerted && !reporting && (
        <button className="btn btn--outline" onClick={() => setReporting(true)}>
          <Flag aria-hidden="true" size={16} /> Je ne reconnais pas cet accès
        </button>
      )}
      {reporting && (
        <div className="report">
          <label htmlFor={`r-${a.id}`}>Votre message au délégué à la protection des données</label>
          <textarea id={`r-${a.id}`} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn btn--danger" onClick={report} disabled={sending}>Envoyer le signalement</button>
            <button className="btn btn--outline" onClick={() => setReporting(false)}>Annuler</button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function AccessList({ accesses, onReported }) {
  if (!accesses) return <div className="empty">Chargement…</div>;
  if (!accesses.length) {
    return (
      <div className="empty">
        <History aria-hidden="true" size={32} />
        <p>Aucune administration n'a encore consulté vos données.</p>
        <span>Chaque consultation apparaîtra ici, en direct.</span>
      </div>
    );
  }
  return (
    <ul className="timeline" aria-live="polite">
      {accesses.map((a) => <Access key={a.id} a={a} onReported={onReported} />)}
    </ul>
  );
}
