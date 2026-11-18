import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "../api";
import { useAction } from "./useAction";

/** Comptes des agents d'une structure : création (mot de passe provisoire) et désactivation. */
export default function Agents({ admin }) {
  const ids = useId();
  const [agents, setAgents] = useState(null);
  const [form, setForm] = useState({ username: "", first_name: "", last_name: "", email: "" });
  const [created, setCreated] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useAction();
  const save = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === "username" ? e.target.value.toLowerCase() : e.target.value }));

  const refresh = useCallback(() => load.run(async () => setAgents(await api.agents(admin.code))), [admin.code, load.run]);
  useEffect(() => { setAgents(null); setCreated(null); refresh(); }, [refresh]);

  async function submit(e) {
    e.preventDefault();
    const result = await save.run(() => api.createAgent(admin.code, { ...form, email: form.email || null }));
    if (result) {
      setCreated(result);
      setForm({ username: "", first_name: "", last_name: "", email: "" });
      setOpen(false);
      refresh();
    }
  }

  async function toggle(agent) {
    await save.run(() => api.setAgentEnabled(admin.code, agent.id, !agent.enabled));
    refresh();
  }

  return (
    <section className="card ref-section" aria-labelledby={`${ids}-title`}>
      <div className="ref-section-head">
        <h3 id={`${ids}-title`}>Agents</h3>
        {!open && admin.status === "ACTIVE" && (
          <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); setCreated(null); }}>Nouvel agent</button>
        )}
      </div>

      {created && (
        <div className="notice notice-info ref-secret" role="status">
          <p>Agent <strong>{created.username}</strong> créé. Mot de passe provisoire, affiché une seule fois :</p>
          <p><code className="ref-password">{created.temporary_password}</code></p>
          <p>Remettez-le à l'agent : il devra le changer à sa première connexion au portail administration.</p>
        </div>
      )}

      {open && (
        <form className="ref-grid-form" onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor={`${ids}-u`}>Identifiant</label>
            <input id={`${ids}-u`} className="input mono" value={form.username} onChange={set("username")} placeholder="Ex. agent-ceni-1" required minLength={3} maxLength={60} pattern="[a-z0-9][a-z0-9._\-]+" />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${ids}-f`}>Prénom</label>
            <input id={`${ids}-f`} className="input" value={form.first_name} onChange={set("first_name")} required maxLength={80} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${ids}-l`}>Nom</label>
            <input id={`${ids}-l`} className="input" value={form.last_name} onChange={set("last_name")} required maxLength={80} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${ids}-e`}>E-mail (facultatif)</label>
            <input id={`${ids}-e`} className="input" type="email" value={form.email} onChange={set("email")} maxLength={150} />
          </div>
          <div className="ref-actions ref-span">
            <button type="submit" className="btn btn-primary" disabled={save.busy}>{save.busy ? <><Spinner /> Création…</> : "Créer l'agent"}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Annuler</button>
          </div>
        </form>
      )}
      {(save.error || load.error) && <p className="notice notice-danger" role="alert">{save.error || load.error}</p>}

      {!agents && !load.error && <p className="hint"><Spinner /> Chargement…</p>}
      {agents?.length === 0 && <p className="hint">Aucun agent rattaché à cette structure.</p>}
      {agents?.length > 0 && (
        <div className="table-wrap">
          <table className="ref-table">
            <thead><tr><th>Identifiant</th><th>Nom</th><th>État</th><th><span className="visually-hidden">Action</span></th></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.username}</td>
                  <td>{[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td>
                    {a.enabled
                      ? <Badge tone={a.must_change_password ? "warning" : "success"}>{a.must_change_password ? "Mot de passe à changer" : "Actif"}</Badge>
                      : <Badge tone="neutral">Désactivé</Badge>}
                  </td>
                  <td className="ref-cell-action">
                    <button type="button" className={`btn ${a.enabled ? "btn-danger" : "btn-secondary"}`} disabled={save.busy} onClick={() => toggle(a)}>
                      {a.enabled ? "Désactiver" : "Réactiver"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
