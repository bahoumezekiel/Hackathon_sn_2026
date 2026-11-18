import { useCallback, useEffect, useId, useState } from "react";
import { formatDateTime } from "@fasolink/shared/format";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "../api";
import { useAction } from "./useAction";

const DAY = 86_400;

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

/** Cas d'usage d'une structure : chacun ouvre l'accès à un ou plusieurs registres. */
export default function CasUsages({ admin, catalogue }) {
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
