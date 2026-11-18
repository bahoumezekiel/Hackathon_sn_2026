import { useCallback, useEffect, useId, useState } from "react";
import { formatDateTime, plural } from "@fasolink/shared/format";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "./api";

const DAY = 86_400;

/** Exécute une action, expose busy / error, puis rafraîchit. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

const STATUS = {
  ACTIVE: { tone: "success", label: "Active" },
  SUSPENDED: { tone: "danger", label: "Suspendue" },
  REVOKED: { tone: "danger", label: "Révoquée" },
};

// ------------------------------------------------------------------ structures

function NewAdministration({ onCreated, onCancel }) {
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

function AdministrationList({ administrations, selected, onSelect, onNew }) {
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

// ------------------------------------------------------------------ agents

function Agents({ admin }) {
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

// ------------------------------------------------------------------ cas d'usage

/** État du formulaire à partir d'un cas d'usage existant (ou vide). */
function toForm(cas, catalogue) {
  const byCode = Object.fromEntries((cas?.registres ?? []).map((r) => [r.registry_code, r]));
  return {
    code: cas?.code ?? "",
    label: cas?.label ?? "",
    description: cas?.description ?? "",
    legal_basis: cas?.legal_basis ?? "",
    requires_justification: cas?.requires_justification ?? true,
    registres: Object.fromEntries(catalogue.registries.map((reg) => {
      const r = byCode[reg.code];
      return [reg.code, {
        enabled: Boolean(r),
        predicates: r?.allowed_predicates ?? reg.predicates.map((p) => p.code),
        requires_consent: r?.requires_consent ?? false,
        cache: r ? r.degraded_cache_ttl_s > 0 : reg.code !== "CASIER",
        categories: r?.parametres?.categories_incompatibles ?? [],
        ignorer_sursis: r?.parametres?.ignorer_sursis ?? false,
      }];
    })),
  };
}

function toPayload(form, catalogue, isNew) {
  const registres = catalogue.registries
    .filter((reg) => form.registres[reg.code].enabled)
    .map((reg) => {
      const r = form.registres[reg.code];
      return {
        registry_code: reg.code,
        predicates: r.predicates,
        requires_consent: r.requires_consent,
        degraded_cache_ttl_s: reg.code !== "CASIER" && r.cache ? DAY : 0,
        parametres: reg.code === "CASIER" ? { categories_incompatibles: r.categories, ignorer_sursis: r.ignorer_sursis } : null,
      };
    });
  const body = {
    label: form.label.trim(), description: form.description.trim() || null,
    legal_basis: form.legal_basis.trim(), requires_justification: form.requires_justification, registres,
  };
  return isNew ? { ...body, code: form.code.trim().toUpperCase() } : body;
}

function RegistryEditor({ reg, value, catalogue, onChange }) {
  const ids = useId();
  const set = (patch) => onChange({ ...value, ...patch });
  const toggleIn = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const isCasier = reg.code === "CASIER";

  return (
    <div className={`ref-registry${value.enabled ? " is-on" : ""}`}>
      <label className="check ref-registry-toggle">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span><strong>{reg.name}</strong> <span className="hint">· tenu par {reg.owner}</span></span>
      </label>

      {value.enabled && (
        <div className="ref-registry-body">
          <fieldset className="ref-fieldset">
            <legend className="label">Informations transmises (Oui / Non)</legend>
            {reg.predicates.map((p) => (
              <label key={p.code} className="check">
                <input type="checkbox" checked={value.predicates.includes(p.code)} onChange={() => set({ predicates: toggleIn(value.predicates, p.code) })} />
                <span>{p.label}</span>
              </label>
            ))}
          </fieldset>

          {isCasier && (
            <fieldset className="ref-fieldset">
              <legend className="label">Condamnations incompatibles avec ce cas d'usage</legend>
              <div className="ref-chips">
                {catalogue.casier_categories.map((c) => (
                  <label key={c.code} className={`ref-chip${value.categories.includes(c.code) ? " is-on" : ""}`}>
                    <input type="checkbox" checked={value.categories.includes(c.code)} onChange={() => set({ categories: toggleIn(value.categories, c.code) })} />
                    {c.label}
                  </label>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={value.ignorer_sursis} onChange={(e) => set({ ignorer_sursis: e.target.checked })} />
                <span>Ne pas tenir compte des peines assorties du sursis</span>
              </label>
            </fieldset>
          )}

          <label className="check">
            <input id={`${ids}-c`} type="checkbox" checked={value.requires_consent} onChange={(e) => set({ requires_consent: e.target.checked })} />
            <span>Consentement de l'usager requis</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={!isCasier && value.cache} disabled={isCasier} onChange={(e) => set({ cache: e.target.checked })} />
            <span>
              Registre en panne : réutiliser une réponse de moins de 24 h
              {isCasier && <span className="hint"> (interdit pour le casier)</span>}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function CasUsageForm({ admin, cas, catalogue, onSaved, onCancel }) {
  const ids = useId();
  const isNew = !cas;
  const [form, setForm] = useState(() => toForm(cas, catalogue));
  const { busy, error, run, setError } = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const payload = toPayload(form, catalogue, isNew);
    if (!payload.registres.length) return setError("Cochez au moins un registre consultable.");
    const saved = await run(() => (isNew ? api.createCasUsage(admin.code, payload) : api.updateCasUsage(cas.id, payload)));
    if (saved) onSaved();
    return undefined;
  }

  return (
    <form className="ref-cas-form" onSubmit={submit}>
      <h4>{isNew ? "Nouveau cas d'usage" : `Modifier « ${cas.label} »`}</h4>
      {!isNew && <p className="hint">Les politiques en cours seront closes et remplacées : les accès passés restent liés à l'ancienne version.</p>}
      <div className="ref-grid-form">
        {isNew && (
          <div className="field">
            <label className="label" htmlFor={`${ids}-code`}>Code</label>
            <input id={`${ids}-code`} className="input mono" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="Ex. INSCRIPTION_LISTE_ELECTORALE" required minLength={3} maxLength={50} pattern="[A-Z][A-Z0-9_]{2,49}" />
          </div>
        )}
        <div className={`field${isNew ? "" : " ref-span"}`}>
          <label className="label" htmlFor={`${ids}-label`}>Libellé (visible par l'usager)</label>
          <input id={`${ids}-label`} className="input" value={form.label} onChange={set("label")} placeholder="Ex. Inscription sur la liste électorale" required minLength={3} maxLength={150} />
        </div>
        <div className="field ref-span">
          <label className="label" htmlFor={`${ids}-basis`}>Base légale</label>
          <input id={`${ids}-basis`} className="input" value={form.legal_basis} onChange={set("legal_basis")} placeholder="Ex. Code électoral, article …" required minLength={5} maxLength={150} />
        </div>
        <div className="field ref-span">
          <label className="label" htmlFor={`${ids}-desc`}>Description (facultatif)</label>
          <textarea id={`${ids}-desc`} className="input" rows={2} value={form.description} onChange={set("description")} maxLength={1000} />
        </div>
        <label className="check ref-span">
          <input type="checkbox" checked={form.requires_justification} onChange={set("requires_justification")} />
          <span>Motif obligatoire pour chaque consultation</span>
        </label>
      </div>

      <fieldset className="ref-fieldset">
        <legend className="label">Registres que la structure peut consulter pour ce cas d'usage</legend>
        <p className="hint">L'agent cochera, selon l'usager, ceux dont le dossier a besoin.</p>
        {catalogue.registries.map((reg) => (
          <RegistryEditor
            key={reg.code}
            reg={reg}
            catalogue={catalogue}
            value={form.registres[reg.code]}
            onChange={(v) => setForm((f) => ({ ...f, registres: { ...f.registres, [reg.code]: v } }))}
          />
        ))}
      </fieldset>

      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      <div className="ref-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <><Spinner /> Enregistrement…</> : "Enregistrer"}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

function CasUsageCard({ cas, catalogue, onEdit, onDeactivate, busy }) {
  const labels = Object.fromEntries(catalogue.registries.flatMap((r) => r.predicates.map((p) => [p.code, p.label])));
  const categories = Object.fromEntries(catalogue.casier_categories.map((c) => [c.code, c.label]));
  return (
    <article className={`ref-cas${cas.is_active ? "" : " is-inactive"}`}>
      <header className="ref-cas-head">
        <div>
          <h4>{cas.label}</h4>
          <p className="hint"><span className="mono">{cas.code}</span> · {cas.legal_basis}</p>
        </div>
        {cas.is_active ? (
          <div className="ref-actions">
            <button type="button" className="btn btn-quiet" onClick={onEdit}>Modifier</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={onDeactivate}>Désactiver</button>
          </div>
        ) : <Badge tone="neutral">Désactivé</Badge>}
      </header>
      {cas.registres.length > 0 && (
        <ul className="ref-cas-registries">
          {cas.registres.map((r) => (
            <li key={r.policy_code}>
              <strong>{r.registry_name}</strong>
              <span>{r.allowed_predicates.map((p) => labels[p] ?? p).join(", ")}</span>
              <span className="ref-tags">
                {r.requires_consent && <Badge tone="warning">Consentement</Badge>}
                {r.degraded_cache_ttl_s > 0 && <Badge tone="neutral">Cache 24 h en panne</Badge>}
                {r.parametres?.categories_incompatibles?.length > 0 && (
                  <Badge tone="neutral">
                    Exclut : {r.parametres.categories_incompatibles.map((c) => categories[c] ?? c).join(", ")}
                    {r.parametres.ignorer_sursis && " (hors sursis)"}
                  </Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cas.is_active && cas.registres[0] && (
        <p className="hint">Version en vigueur depuis le {formatDateTime(cas.registres[0].valid_from)}</p>
      )}
    </article>
  );
}

function CasUsages({ admin, catalogue }) {
  const ids = useId();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // null · "new" · cas
  const load = useAction();
  const act = useAction();

  const refresh = useCallback(() => load.run(async () => setList(await api.casUsage(admin.code))), [admin.code, load.run]);
  useEffect(() => { setList(null); setEditing(null); refresh(); }, [refresh]);

  async function deactivate(cas) {
    if (!window.confirm(`Désactiver « ${cas.label} » ? Les agents ne pourront plus l'invoquer.`)) return;
    await act.run(() => api.deactivateCasUsage(cas.id));
    refresh();
  }

  return (
    <section className="card ref-section" aria-labelledby={`${ids}-title`}>
      <div className="ref-section-head">
        <h3 id={`${ids}-title`}>Cas d'usage et registres consultables</h3>
        {!editing && admin.status === "ACTIVE" && (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing("new")}>Nouveau cas d'usage</button>
        )}
      </div>
      {editing && (
        <CasUsageForm
          key={editing === "new" ? "new" : editing.id}
          admin={admin}
          cas={editing === "new" ? null : editing}
          catalogue={catalogue}
          onSaved={() => { setEditing(null); refresh(); }}
          onCancel={() => setEditing(null)}
        />
      )}
      {(load.error || act.error) && <p className="notice notice-danger" role="alert">{load.error || act.error}</p>}
      {!list && !load.error && <p className="hint"><Spinner /> Chargement…</p>}
      {list?.length === 0 && !editing && <p className="hint">Aucun cas d'usage : cette structure ne peut encore consulter aucun registre.</p>}
      <div className="ref-cas-list">
        {list?.map((cas) => (
          <CasUsageCard key={cas.id} cas={cas} catalogue={catalogue} busy={act.busy} onEdit={() => setEditing(cas)} onDeactivate={() => deactivate(cas)} />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ page

function AdministrationDetail({ admin, catalogue, onChange }) {
  const status = STATUS[admin.status] ?? { tone: "neutral", label: admin.status };
  const { busy, error, run } = useAction();
  const suspended = admin.status !== "ACTIVE";

  async function toggleStatus() {
    if (!suspended && !window.confirm(`Suspendre ${admin.name} ? Toutes ses demandes seront refusées.`)) return;
    await run(() => api.setAdministrationStatus(admin.code, suspended ? "ACTIVE" : "SUSPENDED"));
    onChange();
  }

  return (
    <div className="ref-detail">
      <header className="card ref-detail-head">
        <div>
          <p className="mono ref-code">{admin.code}</p>
          <h2>{admin.name}</h2>
          <p className="hint">
            {admin.ministry ? `Tutelle : ${admin.ministry}` : "Tutelle non renseignée"}
            {admin.registries_held.length > 0 && ` · Détient : ${admin.registries_held.join(", ")}`}
          </p>
        </div>
        <div className="ref-detail-side">
          <Badge tone={status.tone}>{status.label}</Badge>
          <button type="button" className={`btn ${suspended ? "btn-primary" : "btn-danger"}`} disabled={busy} onClick={toggleStatus}>
            {suspended ? "Réactiver" : "Suspendre"}
          </button>
        </div>
      </header>
      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      <Agents admin={admin} />
      <CasUsages admin={admin} catalogue={catalogue} />
    </div>
  );
}

export default function Referentiel() {
  const [catalogue, setCatalogue] = useState(null);
  const [administrations, setAdministrations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const { error, run } = useAction();

  const refresh = useCallback(() => run(async () => {
    const [cat, admins] = await Promise.all([api.catalogue(), api.administrations()]);
    setCatalogue(cat);
    setAdministrations(admins);
    setSelected((s) => s ?? admins.find((a) => a.registries_held.length === 0)?.code ?? admins[0]?.code);
  }), [run]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!administrations) {
    return error
      ? <p className="notice notice-danger" role="alert">{error}</p>
      : <p className="dash-loading card"><Spinner /> Chargement du référentiel…</p>;
  }
  const admin = administrations.find((a) => a.code === selected);

  return (
    <div className="ref-layout">
      <AdministrationList
        administrations={administrations}
        selected={creating ? null : selected}
        onSelect={(code) => { setCreating(false); setSelected(code); }}
        onNew={() => setCreating(true)}
      />
      {creating ? (
        <NewAdministration
          onCreated={async (code) => { setCreating(false); setSelected(code); await refresh(); }}
          onCancel={() => setCreating(false)}
        />
      ) : admin && (
        <AdministrationDetail key={admin.code} admin={admin} catalogue={catalogue} onChange={refresh} />
      )}
    </div>
  );
}
