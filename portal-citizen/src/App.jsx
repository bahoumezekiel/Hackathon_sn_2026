import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { hasRole, keycloak, logout, switchAccount, username } from "./auth";
import AccessList from "./components/AccessList";
import Assistant from "./components/Assistant";
import Consents from "./components/Consents";

const TABS = [
  { id: "acces", label: "Mes accès", icon: "👁" },
  { id: "assistant", label: "Assistant", icon: "🎤" },
  { id: "consentements", label: "Consentements", icon: "✋" },
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
        <h1>Espace réservé aux citoyens</h1>
        <p>Vous êtes connecté en tant que <b>{username()}</b>.</p>
        <button className="btn" onClick={switchAccount}>Me connecter avec mon identifiant citoyen</button>
      </div>
    );
  }

  const t = keycloak.tokenParsed || {};
  const name = [t.given_name, t.family_name].filter(Boolean).join(" ") || username();

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-top">
          <span className="brand"><span className="star">★</span> FasoLink</span>
          <button className="ghost-light" onClick={logout}>Déconnexion</button>
        </div>
        <h1>Bonjour {name}</h1>
        <p>{history ? `${history.accesses.length} demande(s) ont concerné vos données` : "Chargement…"}
          {history?.iue_hint && <> · IUE {history.iue_hint}</>}
          {history && !history.iue_hint && <> · {history.identity_status === "NO_IUE" ? "sans IUE" : "enrôlement en cours"}</>}
        </p>
        {integrity && (
          <div className={`integrity ${integrity.intact ? "ok" : "bad"}`}>
            {integrity.intact
              ? `✔ Journal d'audit intact — ${integrity.events} événements chaînés, aucune ligne modifiée ni supprimée`
              : "⚠ Altération détectée dans le journal d'audit"}
          </div>
        )}
      </header>

      <nav className="tabs">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
            <span aria-hidden="true">{x.icon}</span> {x.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {error && <div className="banner bad">{error}</div>}
        {tab === "acces" && <AccessList accesses={history?.accesses} onReported={refresh} />}
        {tab === "assistant" && <Assistant history={history} integrity={integrity} refresh={refresh} />}
        {tab === "consentements" && <Consents />}
      </main>
    </div>
  );
}
