import { useCallback, useEffect, useState } from "react";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "../api";
import Agents from "./Agents";
import CasUsages from "./CasUsages";
import { AdministrationList, NewAdministration } from "./Structures";
import { useAction } from "./useAction";

const STATUS = {
  ACTIVE: { tone: "success", label: "Active" },
  SUSPENDED: { tone: "danger", label: "Suspendue" },
  REVOKED: { tone: "danger", label: "Révoquée" },
};

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

/** Référentiel (rôle platform_admin) : structures, agents et cas d'usage. */
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
