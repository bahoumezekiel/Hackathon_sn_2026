import { useEffect, useState } from "react";
import { api } from "../api";
import { purposeLabel } from "../labels";

export default function VerifyForm({ purposes, onSubmit }) {
  const [mode, setMode] = useState("iue");
  const [ident, setIdent] = useState("");
  const [purposeIdx, setPurposeIdx] = useState(0);
  const [justification, setJustification] = useState("Dossier n° 2026-118 — demande au guichet");
  const [overreach, setOverreach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoCitizens, setDemoCitizens] = useState([]);

  useEffect(() => {
    api.demoDirectory().then((d) => setDemoCitizens(d.citizens)).catch(() => {});
  }, []);

  const purpose = purposes[purposeIdx];

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!ident.trim()) return setError("Saisissez l'identifiant de l'usager.");
    const predicates = [...purpose.allowed_predicates];
    if (overreach && !predicates.includes("nationalite_burkinabe")) predicates.push("nationalite_burkinabe");
    const citizen = mode === "iue"
      ? { iue: ident.trim() }
      : { registry: "ETAT_CIVIL", local_reference: ident.trim() };
    setBusy(true);
    try {
      await onSubmit({ citizen, purpose_code: purpose.purpose_code, predicates, justification }, ident.trim());
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
    <form onSubmit={submit}>
      <label>Identifiant de l'usager</label>
      <div className="seg">
        <button type="button" className={mode === "iue" ? "on" : ""} onClick={() => setMode("iue")}>IUE</button>
        <button type="button" className={mode === "local" ? "on" : ""} onClick={() => setMode("local")}>Sans IUE (acte d'état civil)</button>
      </div>
      <input value={ident} onChange={(e) => setIdent(e.target.value)}
        placeholder={mode === "iue" ? "Ex. BF1998000123" : "Ex. EC-FDG-2001-000222"} />
      {demoCitizens.length > 0 && (
        <div className="chips">
          {demoCitizens.map((c) => (
            <button type="button" key={c.label} className="chip" title={c.note} onClick={() => pick(c)}>{c.label}</button>
          ))}
        </div>
      )}

      <label>Finalité</label>
      <select value={purposeIdx} onChange={(e) => setPurposeIdx(Number(e.target.value))}>
        {purposes.map((p, i) => (
          <option key={p.policy_code} value={i}>{purposeLabel(p.purpose_code)} — {p.registry_name}</option>
        ))}
      </select>
      {purpose && (
        <div className="meta-line">
          Information demandée : <b>{purpose.allowed_predicates.join(", ")}</b>
          {purpose.requires_consent && <span className="pill warn">consentement requis</span>}
          <br />Base légale : {purpose.legal_basis}
        </div>
      )}

      <label>Justification</label>
      <textarea value={justification} onChange={(e) => setJustification(e.target.value)} />

      <label className="check">
        <input type="checkbox" checked={overreach} onChange={(e) => setOverreach(e.target.checked)} />
        Tenter aussi d'obtenir la nationalité (démonstration d'un refus)
      </label>

      {error && <div className="banner bad">{error}</div>}
      <button className="btn" disabled={busy}>{busy ? "Interrogation du registre…" : "Vérifier"}</button>
    </form>
  );
}
