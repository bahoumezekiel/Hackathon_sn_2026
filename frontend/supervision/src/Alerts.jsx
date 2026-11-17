import { useId, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { purposeLabel, timeAgo } from "@fasolink/shared/format";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "./api";

const STATUS = {
  OPEN: { tone: "danger", label: "Nouvelle" },
  IN_REVIEW: { tone: "warning", label: "En examen" },
  RESOLVED: { tone: "success", label: "Résolue" },
  REJECTED: { tone: "neutral", label: "Rejetée" },
};
const CHANNEL = { WEB: "Portail citoyen", VOICE: "Assistant vocal", SMS: "SMS", USSD: "USSD" };

export const isOpen = (a) => a.status === "OPEN" || a.status === "IN_REVIEW";

function Alert({ alert: a, onChange }) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const status = STATUS[a.status];

  async function update(next) {
    setBusy(next);
    setError("");
    try {
      await api.updateAlert(a.id, next, note.trim());
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const action = (next, label, variant) => (
    <button type="button" className={`btn ${variant}`} onClick={() => update(next)} disabled={Boolean(busy)}>
      {busy === next ? <><Spinner /> {label}</> : label}
    </button>
  );

  return (
    <m.li
      layout="position"
      className={`alert${isOpen(a) ? " is-open" : ""}`}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <header className="alert-head">
        <Badge tone={status.tone}>{status.label}</Badge>
        <time dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
      </header>
      <p className="alert-target">
        {a.contested_administration ?? "Accès non précisé"}
        {a.contested_purpose && <span> · {purposeLabel(a.contested_purpose)}</span>}
      </p>
      <blockquote className="alert-text">{a.description}</blockquote>
      <p className="alert-channel">Reçue par {CHANNEL[a.channel] ?? a.channel}</p>

      {isOpen(a) ? (
        <div className="alert-actions">
          {a.status === "IN_REVIEW" && (
            <div className="field">
              <label className="label" htmlFor={noteId}>Note de traitement (facultative)</label>
              <input id={noteId} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>
          )}
          <div className="alert-buttons">
            {a.status === "OPEN"
              ? action("IN_REVIEW", "Prendre en charge", "btn-primary")
              : <>{action("RESOLVED", "Résoudre", "btn-primary")}{action("REJECTED", "Rejeter", "btn-secondary")}</>}
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      ) : (
        a.resolution_note && <p className="alert-note">Note : {a.resolution_note}</p>
      )}
    </m.li>
  );
}

export default function Alerts({ alerts, onChange }) {
  const open = alerts.filter(isOpen).length;
  return (
    <section className="card side-block" aria-labelledby="alerts-title">
      <header className="side-head">
        <h2 id="alerts-title" className="section-title">Alertes citoyennes</h2>
        {open > 0 && <span className="count is-alert">{open}</span>}
      </header>
      {alerts.length === 0 ? (
        <p className="hint">Aucun citoyen n'a signalé d'accès.</p>
      ) : (
        <ul className="alerts">
          <AnimatePresence initial={false}>
            {alerts.map((a) => <Alert key={a.id} alert={a} onChange={onChange} />)}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
