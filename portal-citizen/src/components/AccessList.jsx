import { useState } from "react";
import { api } from "../api";
import { ago, formatDate, isDenied, isPending, purposeLabel } from "../labels";

function Access({ a, onReported }) {
  const [reporting, setReporting] = useState(false);
  const [text, setText] = useState("Je ne reconnais pas cette démarche.");
  const denied = isDenied(a);
  const pending = isPending(a);

  async function report() {
    await api.report(a.id, text, "WEB");
    setReporting(false);
    onReported();
  }

  return (
    <li className={`access ${denied ? "deny" : pending ? "pending" : "ok"}`}>
      <div className="when" title={formatDate(a.created_at)}>{ago(a.created_at)}</div>
      <div className="who">{a.administration}</div>
      <div className="why">{purposeLabel(a.purpose_code)} · {a.registry}</div>

      {denied && <div className="result deny">Accès refusé — {a.decision_reason}</div>}
      {pending && <div className="result pending">En attente : le registre est momentanément indisponible</div>}
      {a.shared.map((s) => (
        <div key={s.predicate} className="result ok">
          Transmis : <b>{s.display}</b>{s.from_cache && <span className="tag">réponse réutilisée</span>}
        </div>
      ))}

      <dl>
        <dt>Motif déclaré</dt><dd>{a.justification || "—"}</dd>
        {a.fields_read?.length > 0 && (<><dt>Lu par FasoLink</dt><dd>{a.fields_read.join(", ")} <i>(jamais transmis)</i></dd></>)}
        <dt>Preuve</dt><dd className="mono">#{a.proof.seq} · {a.proof.hash.slice(0, 20)}…</dd>
      </dl>

      {a.alerted && <span className="tag warn">Signalement envoyé</span>}
      {!a.alerted && !reporting && (
        <button className="btn-outline" onClick={() => setReporting(true)}>Je ne reconnais pas cet accès</button>
      )}
      {reporting && (
        <div className="report">
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn" onClick={report}>Envoyer le signalement</button>
            <button className="btn-outline" onClick={() => setReporting(false)}>Annuler</button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function AccessList({ accesses, onReported }) {
  if (!accesses) return <div className="empty">Chargement…</div>;
  if (!accesses.length) return <div className="empty">Aucune administration n'a encore consulté vos données.</div>;
  return (
    <ul className="timeline">
      {accesses.map((a) => <Access key={a.id} a={a} onReported={onReported} />)}
    </ul>
  );
}
