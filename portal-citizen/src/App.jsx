import { useCallback, useEffect, useState } from "react";
import { FileCheck2, History, LogOut, MessageCircle, ShieldAlert, ShieldCheck, ToggleRight } from "lucide-react";
import { api } from "./api";
import { hasRole, keycloak, logout, switchAccount, username } from "./auth";
import AccessList from "./components/AccessList";
import Assistant from "./components/Assistant";
import Consents from "./components/Consents";
import { Logo } from "./components/ui/Logo";

const TABS = [
  { id: "acces", label: "Mes accès", Icon: History },
  { id: "assistant", label: "Assistant", Icon: MessageCircle },
  { id: "consentements", label: "Consentements", Icon: ToggleRight },
];

export default function App() {
  const [tab, setTab] = useState("acces");
  const [history, setHistory] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [h, i] = await Promise.all([api.history(), api.integrity()]);
      setHistory(h);
      setIntegrity(i);
      setError("");
    } catch (e) {
      setError(e.message);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!hasRole("citizen")) return undefined;
    refresh();
    const timer = setInterval(refresh, 3000);  // les accès apparaissent en direct
    return () => clearInterval(timer);
  }, [refresh]);

  if (!hasRole("citizen")) {
    return (
      <div className="gate">
        <Logo />
        <h1>Espace réservé aux citoyens</h1>
        <p>Vous êtes connecté en tant que <b>{username()}</b>.</p>
        <button className="btn btn--primary" onClick={switchAccount}>Me connecter avec mon identifiant citoyen</button>
      </div>
    );
  }

  const t = keycloak.tokenParsed || {};
  const name = [t.given_name, t.family_name].filter(Boolean).join(" ") || username();
  const avoided = history ? history.accesses.flatMap((a) => a.documents_avoided || []) : [];
  const idLine = history?.iue_hint ? `IUE ${history.iue_hint}`
    : history ? (history.identity_status === "NO_IUE" ? "Sans IUE" : "Enrôlement en cours") : null;

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__top">
          <Logo />
          <button className="btn btn--on-dark" onClick={logout}><LogOut aria-hidden="true" size={16} /> Déconnexion</button>
        </div>
        <h1>Bonjour {name}</h1>
        <p className="hero__sub">
          {history ? `${history.accesses.length} demande${history.accesses.length > 1 ? "s ont" : " a"} concerné vos données` : "Chargement…"}
          {idLine && <> · <span className="mono">{idLine}</span></>}
        </p>

        {avoided.length > 0 && (
          <div className="saved">
            <FileCheck2 aria-hidden="true" size={28} />
            <div>
              <b>{avoided.length} pièce{avoided.length > 1 ? "s" : ""} justificative{avoided.length > 1 ? "s" : ""}</b> que vous n'avez pas eu à fournir
              <span>Les administrations les ont obtenues directement, avec une traçabilité complète.</span>
            </div>
          </div>
        )}
        {integrity && (
          <div className={`integrity ${integrity.intact ? "" : "integrity--bad"}`}>
            {integrity.intact
              ? <><ShieldCheck aria-hidden="true" size={16} /> Journal d'audit intact : {integrity.events} événements chaînés, aucune ligne modifiée ni supprimée</>
              : <><ShieldAlert aria-hidden="true" size={16} /> Altération détectée dans le journal d'audit</>}
          </div>
        )}
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="panel"
            onClick={() => setTab(id)}>
            <Icon aria-hidden="true" size={20} /> <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="content" id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {error && <div className="banner banner--deny" role="alert">{error}</div>}
        {tab === "acces" && <AccessList accesses={history?.accesses} onReported={refresh} />}
        {tab === "assistant" && <Assistant history={history} integrity={integrity} refresh={refresh} />}
        {tab === "consentements" && <Consents />}
      </main>
    </div>
  );
}
