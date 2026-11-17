import { useEffect, useId, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import {
  formatDateTime, isDenied, isPending, purposeLabel, requestState, timeAgo,
} from "@fasolink/shared/format";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "./api";

/** Champs des registres, tels que le citoyen les comprend. */
const FIELD_LABELS = {
  date_naissance: "date de naissance",
  nationalite: "nationalité",
  statut: "statut de nationalité",
  "condamnations.categorie": "catégories de condamnations",
};
const fieldsText = (fields) => fields.map((f) => FIELD_LABELS[f] ?? f).join(", ");

function ReportForm({ access, onDone, onCancel }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (text.trim().length < 3) return setError("Décrivez en quelques mots ce qui vous semble anormal.");
    setBusy(true);
    try {
      await api.report(access.id, text.trim(), "WEB");
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <m.form
      className="report"
      onSubmit={submit}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className="field">
        <label className="label" htmlFor={id}>Pourquoi cet accès vous semble-t-il anormal ?</label>
        <textarea
          id={id}
          className="input"
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Par exemple : je n'ai fait aucune démarche auprès de cette administration."
          aria-invalid={Boolean(error)}
        />
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="report-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <><Spinner /> Envoi…</> : "Envoyer le signalement"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Annuler</button>
      </div>
    </m.form>
  );
}

function Access({ access: a, focused, onChange }) {
  const [reporting, setReporting] = useState(false);
  const state = requestState(a);

  return (
    <m.li
      layout="position"
      id={`access-${a.id}`}
      className={`access tone-${state.tone}${focused ? " is-focused" : ""}`}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <time className="access-when" dateTime={a.created_at} title={formatDateTime(a.created_at)}>
        {timeAgo(a.created_at)}
      </time>

      <article className="card access-card">
        <header className="access-head">
          <div>
            <h2>{a.administration}</h2>
            <p className="access-purpose">{purposeLabel(a.purpose_code)} · {a.registry}</p>
          </div>
          <Badge tone={state.tone}>{state.label}</Badge>
        </header>

        {isDenied(a) && (
          <p className="access-outcome is-denied">
            <strong>Accès refusé.</strong> {a.decision_reason}
          </p>
        )}
        {isPending(a) && (
          <p className="access-outcome is-pending">
            Le registre est momentanément indisponible : la vérification sera faite dès son retour.
          </p>
        )}
        {a.shared.length > 0 && (
          <div className="shared">
            <p className="detail-label">Transmis à l'administration</p>
            <ul>
              {a.shared.map((s) => (
                <li key={s.predicate}>
                  <span className="shared-value">{s.display}</span>
                  {s.from_cache && <span className="shared-note">réponse récente réutilisée, registre indisponible</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="access-details">
          <div>
            <dt className="detail-label">Motif déclaré</dt>
            <dd>{a.justification || "Non précisé"}</dd>
          </div>
          {a.fields_read?.length > 0 && (
            <div>
              <dt className="detail-label">Lu sans être transmis</dt>
              <dd>
                <span className="read-fields">{fieldsText(a.fields_read)}</span> : consulté par FasoLink pour
                calculer la réponse, jamais envoyé à l'administration.
              </dd>
            </div>
          )}
          {a.proof && (
            <div>
              <dt className="detail-label">Preuve au journal</dt>
              <dd className="mono proof-ref">n° {a.proof.seq} · {a.proof.hash.slice(0, 16)}…</dd>
            </div>
          )}
        </dl>

        <footer className="access-foot">
          {a.alerted ? (
            <Badge tone="warning">Signalement transmis au délégué à la protection des données</Badge>
          ) : (
            !reporting && (
              <button type="button" className="btn btn-secondary" onClick={() => setReporting(true)}>
                Je ne reconnais pas cet accès
              </button>
            )
          )}
          <AnimatePresence>
            {reporting && !a.alerted && (
              <ReportForm
                access={a}
                onCancel={() => setReporting(false)}
                onDone={() => { setReporting(false); onChange(); }}
              />
            )}
          </AnimatePresence>
        </footer>
      </article>
    </m.li>
  );
}

export default function AccessList({ accesses, focus, onChange }) {
  // Ouverture depuis une notification : la consultation est amenée au centre de l'écran
  useEffect(() => {
    if (!focus) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`access-${focus.id}`)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  }, [focus]);

  if (!accesses) {
    return <p className="panel-loading"><Spinner /> Chargement de votre historique…</p>;
  }
  if (!accesses.length) {
    return (
      <div className="panel-empty">
        <h2>Aucune consultation pour le moment</h2>
        <p>Dès qu'une administration vérifiera une information vous concernant, elle apparaîtra ici, en direct.</p>
      </div>
    );
  }
  return (
    <ol className="timeline">
      <AnimatePresence initial={false}>
        {accesses.map((a) => <Access key={a.id} access={a} focused={focus?.id === a.id} onChange={onChange} />)}
      </AnimatePresence>
    </ol>
  );
}
