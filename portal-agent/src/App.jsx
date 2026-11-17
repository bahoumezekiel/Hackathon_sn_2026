import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Inbox, LogOut, UserRound } from "lucide-react";
import { api } from "./api";
import { hasRole, logout, switchAccount, username } from "./auth";
import VerifyForm from "./components/VerifyForm";
import DossierCard from "./components/AnswerCard";
import { Logo } from "./components/ui/Logo";

const isPending = (r) => r.status === "QUEUED" || r.status === "PROCESSING";

export default function App() {
  const [info, setInfo] = useState(null);       // { administration, purposes }
  const [error, setError] = useState("");
  const [dossiers, setDossiers] = useState([]); // [{ key, purpose, results, ident, identityStatus }]
  const dossiersRef = useRef(dossiers);
  dossiersRef.current = dossiers;

  useEffect(() => {
    if (!hasRole("agent")) return;
    api.purposes().then(setInfo).catch((e) => setError(e.message));
  }, []);

  // Rafraîchit les demandes en attente (registre en panne → relance automatique)
  useEffect(() => {
    const timer = setInterval(async () => {
      for (const d of dossiersRef.current) {
        for (const r of d.results.filter(isPending)) {
          try {
            const fresh = await api.request(r.request_id);
            if (!isPending(fresh)) {
              setDossiers((list) => list.map((x) => (x.key !== d.key ? x : {
                ...x, resolved: true,
                results: x.results.map((y) => (y.request_id === fresh.request_id ? fresh : y)),
              })));
            }
          } catch { /* nouvel essai au prochain tour */ }
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const onSubmit = useCallback(async (payload, ident, purpose) => {
    const res = await api.verify(payload);
    setDossiers((list) => [{
      key: res.results.map((r) => r.request_id).join("-"),
      purpose, ident, results: res.results, identityStatus: res.identity_status,
    }, ...list]);
  }, []);

  if (!hasRole("agent")) {
    return (
      <div className="gate">
        <Logo tag="Guichet" />
        <h1>Portail réservé aux agents des administrations</h1>
        <p>Vous êtes connecté en tant que <b>{username()}</b>, qui n'a pas le rôle « agent ».</p>
        <button className="btn btn--primary" onClick={switchAccount}>Se connecter avec un compte agent</button>
      </div>
    );
  }

  return (
    <>
      <a className="skip" href="#dossiers">Aller aux dossiers traités</a>
      <header className="topbar">
        <Logo tag="Guichet" />
        <div className="who">
          <span className="who__item"><Building2 aria-hidden="true" size={16} /> <b>{info?.administration || "…"}</b></span>
          <span className="who__item who__user"><UserRound aria-hidden="true" size={16} /> {username()}</span>
          <button className="btn btn--on-dark" onClick={logout}><LogOut aria-hidden="true" size={16} /> Se déconnecter</button>
        </div>
      </header>

      <main className="layout">
        <section className="panel" aria-labelledby="t-new">
          <h2 id="t-new">Nouvelle vérification</h2>
          <p className="hint">L'usager n'apporte aucune pièce : FasoLink interroge les registres et ne vous transmet que ce que la loi vous autorise à connaître.</p>
          {error && <div className="banner banner--deny" role="alert">{error}</div>}
          {info && <VerifyForm purposes={info.purposes} onSubmit={onSubmit} />}
        </section>

        <section className="panel" id="dossiers" aria-labelledby="t-done">
          <h2 id="t-done">Dossiers traités {dossiers.length > 0 && <span className="count">{dossiers.length}</span>}</h2>
          <p className="hint">Chaque réponse est une attestation signée, valable uniquement pour votre administration et la finalité déclarée.</p>
          <div aria-live="polite">
            {dossiers.length === 0
              ? (
                <div className="empty">
                  <Inbox aria-hidden="true" size={32} />
                  <p>Aucune vérification pour le moment.</p>
                  <span>Choisissez une démarche et un usager à gauche.</span>
                </div>
              )
              : dossiers.map((d) => <DossierCard key={d.key} {...d} />)}
          </div>
        </section>
      </main>
    </>
  );
}
