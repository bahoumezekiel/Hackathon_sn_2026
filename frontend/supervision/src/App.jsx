import { useEffect, useId, useState } from "react";
import { isDenied, isPending } from "@fasolink/shared/format";
import { useCountUp, usePolling } from "@fasolink/shared/hooks";
import { Footer, PageHero, Spinner, TopBar } from "@fasolink/shared/ui";
import { api, session } from "./api";
import Alerts, { isOpen } from "./Alerts";
import Platform from "./Platform";
import Registries from "./Registries";
import RequestFeed from "./RequestFeed";

function Count({ value }) {
  return useCountUp(value);
}

function Kpis({ data }) {
  const { requests, alerts, stack } = data;
  const up = stack.components.filter((c) => c.up).length;
  const items = [
    { label: "Dernières demandes", value: requests.length },
    { label: "Refusées par la politique", value: requests.filter(isDenied).length, tone: "danger" },
    {
      label: "Touchées par une panne",
      value: requests.filter((r) => isPending(r) || r.service_mode !== "NORMAL").length,
      tone: "warning",
    },
    { label: "Alertes citoyennes ouvertes", value: alerts.filter(isOpen).length, tone: "danger" },
    {
      label: "Composants du socle",
      value: up,
      total: stack.components.length,
      tone: up < stack.components.length ? "danger" : "success",
    },
  ];
  return (
    <dl className="kpis card reveal">
      {items.map((k) => (
        <div key={k.label} className={k.tone && k.value !== 0 ? `is-${k.tone}` : undefined}>
          <dt>{k.label}</dt>
          <dd><Count value={k.value} />{k.total !== undefined && <span className="kpi-total">/{k.total}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function App() {
  const ids = useId();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [demo, setDemo] = useState(false);

  async function refresh() {
    try {
      setData(await api.overview());
      setUpdatedAt(new Date());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  usePolling(refresh, 2000);
  useEffect(() => { api.demo().then(setDemo); }, []);

  return (
    <>
      <TopBar portal="Supervision" session={session} />
      <PageHero
        eyebrow="Supervision et protection des données"
        title="Tableau de bord"
        titleId={`${ids}-title`}
        lead="Registres, flux des demandes et signalements des citoyens, mis à jour en continu."
        aside={
          <p className={`live${error ? " is-stale" : ""}`} aria-live="polite">
            <span className="live-dot" aria-hidden="true" />
            {error
              ? "Connexion perdue, nouvelle tentative…"
              : updatedAt ? `En direct · ${updatedAt.toLocaleTimeString("fr-FR")}` : "Connexion…"}
          </p>
        }
      />
      <main className="page lift">
        {error && data && <p className="notice notice-danger" role="alert">{error}</p>}
        {!data && !error && <p className="dash-loading card"><Spinner /> Chargement du tableau de bord…</p>}
        {!data && error && <p className="notice notice-danger" role="alert">{error}</p>}

        {data && (
          <>
            <Kpis data={data} />
            <div className="dash-grid reveal" style={{ "--i": 1 }}>
              <div className="dash-main">
                <Registries registries={data.registries} demo={demo} onChange={refresh} />
                <RequestFeed requests={data.requests} registries={data.registries} />
              </div>
              <aside className="dash-side">
                <Alerts alerts={data.alerts} onChange={refresh} />
                <Platform stack={data.stack} integrity={data.integrity} />
              </aside>
            </div>
          </>
        )}
      </main>
      <Footer portal="Supervision" />
    </>
  );
}
