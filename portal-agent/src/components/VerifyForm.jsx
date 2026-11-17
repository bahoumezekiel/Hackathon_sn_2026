import { useEffect, useId, useState } from "react";
import { FileText, Hand, Loader2, Scale, Search } from "lucide-react";
import { api } from "../api";

export default function VerifyForm({ purposes, onSubmit }) {
  const [mode, setMode] = useState("iue");
  const [ident, setIdent] = useState("");
  const [code, setCode] = useState(purposes[0]?.purpose_code);
  const [justification, setJustification] = useState("Dossier n° 2026-118 — demande au guichet");
  const [overreach, setOverreach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoCitizens, setDemoCitizens] = useState([]);
  const id = useId();

  useEffect(() => {
    api.demoDirectory().then((d) => setDemoCitizens(d.citizens)).catch(() => {});
  }, []);

  const purpose = purposes.find((p) => p.purpose_code === code) || purposes[0];
  if (!purpose) return <div className="banner banner--deny">Aucune démarche n'est autorisée pour votre administration.</div>;

  const predicates = purpose.checks.flatMap((c) => c.predicates.map((p) => p.code));
  const attributes = purpose.checks.flatMap((c) => c.attributes.map((a) => a.code));
  const canOverreach = !attributes.includes("date_naissance");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!ident.trim()) return setError("Saisissez l'identifiant de l'usager.");
    const citizen = mode === "iue"
      ? { iue: ident.trim() }
      : { registry: "ETAT_CIVIL", local_reference: ident.trim() };
    const extra = overreach && canOverreach ? ["date_naissance"] : [];
    setBusy(true);
    try {
      await onSubmit({ citizen, purpose_code: purpose.purpose_code, predicates,
        attributes: [...attributes, ...extra], justification }, ident.trim(), purpose);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function pick(c) {
    if (c.iue) { setMode("iue"); setIdent(c.iue); } else { setMode("local"); setIdent(c.local_reference); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-purpose`}>Démarche</label>
        <select id={`${id}-purpose`} value={purpose.purpose_code}
          onChange={(e) => { setCode(e.target.value); setOverreach(false); }}>
          {purposes.map((p) => <option key={p.purpose_code} value={p.purpose_code}>{p.label}</option>)}
        </select>
      </div>

      <div className="purpose-box">
        {purpose.description && <p className="purpose-box__desc">{purpose.description}</p>}
        {purpose.replaces.length > 0 && (
          <>
            <h3 className="eyebrow">Pièces que l'usager n'a plus à fournir</h3>
            <ul className="docs">
              {purpose.replaces.map((r) => (
                <li key={r.document} className="doc"><FileText aria-hidden="true" size={14} /> {r.document}</li>
              ))}
            </ul>
          </>
        )}
        <h3 className="eyebrow">Informations obtenues directement</h3>
        <ul className="checks">
          {purpose.checks.map((c) => (
            <li key={c.policy_code}>
              <div className="checks__head">
                <b>{c.registry_name}</b>
                {c.requires_consent && <span className="tag tag--wait"><Hand aria-hidden="true" size={12} /> Consentement requis</span>}
              </div>
              <div className="items">
                {c.predicates.map((p) => <span key={p.code} className="item item--q">{p.label} ? <i>Oui/Non</i></span>)}
                {c.attributes.map((a) => <span key={a.code} className="item item--a">{a.label}</span>)}
              </div>
              <div className="basis">Base légale : {c.legal_basis}</div>
            </li>
          ))}
        </ul>
        {purpose.decision_note && (
          <div className="banner banner--info"><Scale aria-hidden="true" size={16} /> <span>{purpose.decision_note}</span></div>
        )}
      </div>

      <fieldset className="field">
        <legend>Identifiant de l'usager</legend>
        <div className="seg" role="radiogroup" aria-label="Type d'identifiant">
          <button type="button" role="radio" aria-checked={mode === "iue"} onClick={() => setMode("iue")}>IUE</button>
          <button type="button" role="radio" aria-checked={mode === "local"} onClick={() => setMode("local")}>Sans IUE (acte d'état civil)</button>
        </div>
        <input id={`${id}-ident`} aria-label="Identifiant de l'usager" className="mono-input" value={ident}
          onChange={(e) => setIdent(e.target.value)} autoComplete="off" spellCheck={false}
          placeholder={mode === "iue" ? "Ex. BF1998000123" : "Ex. EC-FDG-2001-000222"} />
        {demoCitizens.length > 0 && (
          <div className="chips" aria-label="Usagers de démonstration">
            {demoCitizens.map((c) => (
              <button type="button" key={c.label} className="chip" title={c.note} onClick={() => pick(c)}>{c.label}</button>
            ))}
          </div>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor={`${id}-just`}>Justification</label>
        <textarea id={`${id}-just`} value={justification} onChange={(e) => setJustification(e.target.value)} />
      </div>

      {canOverreach && (
        <label className="check">
          <input type="checkbox" checked={overreach} onChange={(e) => setOverreach(e.target.checked)} />
          <span>Demander aussi la date de naissance brute <span className="muted">(démonstration d'un refus)</span></span>
        </label>
      )}

      {error && <div className="banner banner--deny" role="alert">{error}</div>}
      <button className="btn btn--primary btn--block" disabled={busy}>
        {busy
          ? <><Loader2 className="spin" aria-hidden="true" size={18} /> Interrogation des registres…</>
          : <><Search aria-hidden="true" size={18} /> Lancer la vérification</>}
      </button>
    </form>
  );
}
