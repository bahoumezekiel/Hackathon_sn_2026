import { useId, useState } from "react";
import { plural } from "@fasolink/shared/format";
import { Spinner } from "@fasolink/shared/ui";
import { api } from "../api";
import { useAction } from "./useAction";

/** Formulaire de création d'une structure de l'État (et de son groupe Keycloak). */
export function NewAdministration({ onCreated, onCancel }) {
  const ids = useId();
  const [form, setForm] = useState({ code: "", name: "", ministry: "" });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === "code" ? e.target.value.toUpperCase() : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const created = await run(() => api.createAdministration({ ...form, ministry: form.ministry || null }));
    if (created) onCreated(created.code);
  }

  return (
    <form className="ref-form card" onSubmit={submit}>
      <h3>Nouvelle structure de l'État</h3>
      <div className="field">
        <label className="label" htmlFor={`${ids}-code`}>Code</label>
        <input id={`${ids}-code`} className="input mono" value={form.code} onChange={set("code")} placeholder="Ex. CENI" maxLength={30} required pattern="[A-Z][A-Z0-9_]{1,29}" />
        <p className="hint">Majuscules, chiffres et _ : il devient le groupe Keycloak de ses agents.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-name`}>Nom</label>
        <input id={`${ids}-name`} className="input" value={form.name} onChange={set("name")} placeholder="Ex. Commission électorale nationale indépendante" maxLength={150} required minLength={3} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-min`}>Ministère de tutelle (facultatif)</label>
        <input id={`${ids}-min`} className="input" value={form.ministry} onChange={set("ministry")} maxLength={150} />
      </div>
      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      <div className="ref-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <><Spinner /> Création…</> : "Créer la structure"}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

/** Liste des structures, à gauche de la page. */
export function AdministrationList({ administrations, selected, onSelect, onNew }) {
  return (
    <nav className="card ref-list" aria-label="Structures de l'État">
      <div className="ref-list-head">
        <h2 className="section-title">Structures</h2>
        <button type="button" className="btn btn-secondary" onClick={onNew}>Nouvelle</button>
      </div>
      <ul>
        {administrations.map((a) => (
          <li key={a.code}>
            <button type="button" className="ref-item" aria-current={selected === a.code ? "true" : undefined} onClick={() => onSelect(a.code)}>
              <span className="ref-item-name">{a.name}</span>
              <span className="ref-item-meta">
                <span className="mono">{a.code}</span>
                {a.registries_held.length > 0
                  ? " · détient un registre"
                  : ` · ${plural(a.cas_usage_count, "cas d'usage", "cas d'usage")}`}
                {a.status !== "ACTIVE" && " · suspendue"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
