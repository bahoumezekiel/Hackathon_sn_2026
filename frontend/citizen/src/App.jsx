import { useId, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { IDENTITY_STATUS, isDenied, plural } from "@fasolink/shared/format";
import { usePolling } from "@fasolink/shared/hooks";
import { Footer, PageHero, TopBar } from "@fasolink/shared/ui";
import { api, session } from "./api";
import AccessList from "./AccessList";
import Assistant from "./Assistant";
import Consents from "./Consents";
import { AlertBell, Toasts, useAccessAlerts } from "./Notifications";

const TABS = [
  { id: "accesses", label: "Mes accès" },
  { id: "assistant", label: "Assistant" },
  { id: "consents", label: "Consentements" },
];

function Summary({ history, integrity }) {
  if (!history || !integrity) return <div className="summary card reveal" aria-busy="true" />;
  const denied = history.accesses.filter(isDenied).length;
  return (
    <dl className="summary card reveal">
      <div>
        <dt>Consultations</dt>
        <dd>{history.accesses.length}{denied > 0 && <span className="summary-note"> dont {plural(denied, "refusée")}</span>}</dd>
      </div>
      <div>
        <dt>Identifiant</dt>
        <dd className={history.iue_hint ? "mono" : undefined}>
          {history.iue_hint ? `IUE ${history.iue_hint}` : IDENTITY_STATUS[history.identity_status] ?? "—"}
        </dd>
      </div>
      <div>
        <dt>Journal d'audit</dt>
        <dd className={integrity.intact ? "is-ok" : "is-broken"}>
          {integrity.intact ? `Intact · ${plural(integrity.events, "événement chaîné", "événements chaînés")}` : "Altération détectée"}
        </dd>
      </div>
    </dl>
  );
}

function Tabs({ value, onChange, idPrefix }) {
  function onKeyDown(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const index = (TABS.findIndex((t) => t.id === value) + step + TABS.length) % TABS.length;
    onChange(TABS[index].id);
    document.getElementById(`${idPrefix}-tab-${TABS[index].id}`)?.focus();
  }

  return (
    <div className="tabs" role="tablist" aria-label="Rubriques" onKeyDown={onKeyDown}>
      {TABS.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            id={`${idPrefix}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {selected && <m.span layoutId="tab-ink" className="tab-ink" transition={{ duration: 0.35 }} />}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const ids = useId();
  const [tab, setTab] = useState("accesses");
  const [history, setHistory] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState(null); // consultation à montrer depuis une notification
  const user = session.user();
  const alerts = useAccessAlerts(user.username);

  async function refresh() {
    try {
      const [h, i] = await Promise.all([api.history(), api.integrity()]);
      setHistory(h);
      alerts.track(h.accesses);
      setIntegrity(i);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  // Les consultations apparaissent en direct, et l'alerte part même onglet en arrière-plan
  usePolling(refresh, 3000, true, { background: true });

  function showAccess(id) {
    setTab("accesses");
    setFocus({ id, at: Date.now() });
  }

  const firstName = user.claims.given_name || user.name;

  return (
    <>
      <TopBar
        portal="Espace citoyen"
        session={session}
        actions={<AlertBell alerts={alerts} accesses={history?.accesses} onSelect={showAccess} />}
      />
      <PageHero
        eyebrow="Espace citoyen"
        title={`Bonjour ${firstName}`}
        titleId={`${ids}-welcome`}
        lead="Voici les administrations qui ont consulté vos données, quand et pourquoi. Aucune ne peut le faire sans laisser de trace."
      />

      <main className="page lift">
        <Summary history={history} integrity={integrity} />
        <Tabs value={tab} onChange={setTab} idPrefix={ids} />
        {error && <p className="notice notice-danger" role="alert">{error}</p>}

        <AnimatePresence mode="wait" initial={false}>
          <m.section
            key={tab}
            id={`${ids}-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-tab-${tab}`}
            className="panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28 }}
          >
            {tab === "accesses" && <AccessList accesses={history?.accesses} focus={focus} onChange={refresh} />}
            {tab === "assistant" && <Assistant onChange={refresh} />}
            {tab === "consents" && <Consents onChange={refresh} />}
          </m.section>
        </AnimatePresence>
      </main>
      <Footer portal="Espace citoyen" />
      <Toasts alerts={alerts} onSelect={showAccess} />
    </>
  );
}
