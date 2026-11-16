import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { hasRole, logout, switchAccount, username } from "./auth";
import VerifyForm from "./components/VerifyForm";
import AnswerCard from "./components/AnswerCard";

const isPending = (r) => r.status === "QUEUED" || r.status === "PROCESSING";

export default function App() {
  const [info, setInfo] = useState(null);       // { administration, purposes }
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState([]);   // [{ key, result, ident, identityStatus }]
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    if (!hasRole("agent")) return;
    api.purposes().then(setInfo).catch((e) => setError(e.message));
  }, []);

  // Rafraîchit les demandes en attente (registre en panne → relance automatique)
  useEffect(() => {
    const timer = setInterval(async () => {
      const pending = answersRef.current.filter((a) => isPending(a.result));
      for (const a of pending) {
        try {
          const fresh = await api.request(a.result.request_id);
          if (!isPending(fresh)) {
            setAnswers((list) => list.map((x) => (x.key === a.key ? { ...x, result: fresh, resolved: true } : x)));
          }
        } catch { /* nouvel essai au prochain tour */ }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const onSubmit = useCallback(async (payload, ident) => {
    const res = await api.verify(payload);
    const created = res.results.map((result) => ({
      key: result.request_id, result, ident, identityStatus: res.identity_status,
    }));
    setAnswers((list) => [...created, ...list]);
  }, []);

  if (!hasRole("agent")) {
    return (
      <div className="gate">
        <h1>Portail réservé aux agents des administrations</h1>
        <p>Vous êtes connecté en tant que <b>{username()}</b>, qui n'a pas le rôle « agent ».</p>
        <button className="btn" onClick={switchAccount}>Se connecter avec un compte agent</button>
      </div>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="star">★</span> FasoLink <span className="tag">Guichet</span></div>
        <div className="who">
          <span className="admin">{info?.administration || "…"}</span>
          <span className="user">{username()}</span>
          <button className="link" onClick={logout}>Se déconnecter</button>
        </div>
      </header>
      <main className="layout">
        <section className="panel">
          <h2>Nouvelle vérification</h2>
          <p className="hint">L'usager n'apporte aucune pièce : FasoLink interroge le registre et ne vous transmet que la réponse utile.</p>
          {error && <div className="banner bad">{error}</div>}
          {info && <VerifyForm purposes={info.purposes} onSubmit={onSubmit} />}
        </section>
        <section className="panel">
          <h2>Réponses reçues</h2>
          <p className="hint">Chaque réponse est une attestation signée, valable uniquement pour votre administration et la finalité déclarée.</p>
          {answers.length === 0
            ? <div className="empty">Aucune vérification pour le moment.</div>
            : answers.map((a) => <AnswerCard key={a.key} {...a} />)}
        </section>
      </main>
    </>
  );
}
