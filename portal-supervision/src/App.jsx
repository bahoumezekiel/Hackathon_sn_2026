import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { hasRole, logout, switchAccount, username } from "./auth";
import { ALERT_STATUS, REGISTRY_STATE, ago, purposeLabel, requestState, time } from "./labels";

function Kpi({ label, value, tone }) {
  return (
    <div className={`kpi ${tone || ""}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function Registry({ r, onToggle }) {
  const [tone, label] = REGISTRY_STATE[r.status] || ["warn", r.status];
  const [busy, setBusy] = useState(false);
  const down = r.status !== "UP";
  return (
    <div className={`registry ${tone}`}>
      <div className="registry-head">
        <span className="dot" />
        <div>
          <div className="registry-name">{r.name}</div>
          <div className="faint">{r.code}</div>
        </div>
        <span className={`state ${tone}`}>{label}</span>
      </div>
      <div className="metrics">
        <div><span>Disjoncteur</span><b>{r.circuit_open ? `ouvert (${ago(r.circuit_opened_at)})` : "fermé"}</b></div>
        <div><span>Échecs</span><b>{r.consecutive_failures} / {r.failure_threshold}</b></div>
        <div><span>En file</span><b className={r.queued ? "warn-text" : ""}>{r.queued}</b></div>
        <div><span>Contrôle</span><b>il y a {ago(r.last_health_check)}</b></div>
      </div>
      <button className={`action ${down ? "restore" : "break"}`} disabled={busy}
        onClick={async () => { setBusy(true); await onToggle(r.code, !down); setBusy(false); }}>
        {down ? "Rétablir le registre" : "Simuler une panne"}
      </button>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => api.overview().then((d) => { setData(d); setError(""); })
    .catch((e) => setError(e.message)), []);

  useEffect(() => {
    if (!hasRole("supervisor")) return undefined;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!hasRole("supervisor")) {
    return (
      <div className="gate">
        <h1>Portail réservé à la supervision</h1>
        <p>Vous êtes connecté en tant que <b>{username()}</b>, qui n'a pas le rôle « supervisor ».</p>
        <button onClick={switchAccount}>Se connecter avec le compte superviseur</button>
      </div>
    );
  }

  const reqs = data?.requests || [];
  const openAlerts = (data?.alerts || []).filter((a) => a.status === "OPEN" || a.status === "IN_REVIEW");
  const stackUp = (data?.stack.components || []).filter((c) => c.up).length;

  return (
    <div className="shell">
      <header className="bar">
        <div className="brand"><span className="star">★</span> FasoLink <span className="faint">/ Supervision</span></div>
        <div className="bar-right">
          <span className="live"><span className="pulse" /> en direct</span>
          <span className="faint">{username()}</span>
          <button className="link" onClick={logout}>Déconnexion</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {!data ? <div className="loading">Chargement du tableau de bord…</div> : (
        <main className="grid">
          <section className="kpis">
            <Kpi label="Demandes récentes" value={reqs.length} />
            <Kpi label="Refusées par OPA" value={reqs.filter((q) => q.decision === "DENY").length} tone="down" />
            <Kpi label="Servies en mode dégradé" value={reqs.filter((q) => q.service_mode !== "NORMAL").length} tone="warn" />
            <Kpi label="Alertes citoyennes ouvertes" value={openAlerts.length} tone={openAlerts.length ? "down" : ""} />
            <Kpi label="Composants du socle" value={`${stackUp}/${data.stack.components.length}`} tone={stackUp === data.stack.components.length ? "up" : "down"} />
          </section>

          <section className="block registries">
            <h2>Registres connectés</h2>
            <div className="registry-grid">
              {data.registries.map((r) => (
                <Registry key={r.code} r={r} onToggle={(code, down) => api.simulate(code, down).then(refresh)} />
              ))}
            </div>
          </section>

          <section className="block feed">
            <h2>Flux des demandes <span className="faint">— aucune identité de citoyen</span></h2>
            <table>
              <thead><tr><th>Heure</th><th>Administration</th><th>Finalité</th><th>Registre</th><th>État</th></tr></thead>
              <tbody>
                {reqs.map((q) => {
                  const [tone, label] = requestState(q);
                  return (
                    <tr key={q.id}>
                      <td className="mono">{time(q.created_at)}</td>
                      <td>{q.administration}</td>
                      <td>{purposeLabel(q.purpose_code)}</td>
                      <td className="mono">{q.registry}</td>
                      <td><span className={`badge ${tone}`}>{label}</span>{q.retry_count > 0 && <span className="faint"> ×{q.retry_count}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <aside className="side">
            <section className="block">
              <h2>Socle technique</h2>
              {data.stack.components.map((c) => (
                <div className="stack-row" key={c.component}>
                  <span className={`dot ${c.up ? "up" : "down"}`} />
                  <div><b>{c.component}</b><div className="faint">{c.role}</div></div>
                </div>
              ))}
              <div className="faint small">File de relance Redis : {data.stack.retry_queue_size} demande(s)</div>
            </section>

            <section className={`block integrity ${data.integrity.intact ? "up" : "down"}`}>
              <h2>Journal d'audit</h2>
              <div className="big">{data.integrity.intact ? "Intègre" : `Rompu à #${data.integrity.broken_at_seq}`}</div>
              <div className="faint">{data.integrity.events} événements chaînés (SHA-256)</div>
              <div className="mono faint">{(data.integrity.head_hash || "").slice(0, 32)}…</div>
            </section>

            <section className="block">
              <h2>Alertes citoyennes</h2>
              {data.alerts.length === 0 && <div className="faint">Aucune alerte.</div>}
              {data.alerts.map((a) => {
                const open = a.status === "OPEN" || a.status === "IN_REVIEW";
                return (
                  <div className={`alert ${open ? "open" : ""}`} key={a.id}>
                    <div className="alert-head">
                      <span>{a.channel === "VOICE" ? "🎤" : "💬"} <b>{a.contested_administration || "Accès non précisé"}</b></span>
                      <span className="faint">{ALERT_STATUS[a.status]}</span>
                    </div>
                    <div className="faint">{purposeLabel(a.contested_purpose)} · il y a {ago(a.created_at)}</div>
                    <div className="alert-text">{a.description}</div>
                    {open && (
                      <div className="alert-actions">
                        {a.status === "OPEN" && <button onClick={() => api.updateAlert(a.id, "IN_REVIEW").then(refresh)}>Prendre en charge</button>}
                        <button onClick={() => api.updateAlert(a.id, "RESOLVED").then(refresh)}>Résoudre</button>
                        <button onClick={() => api.updateAlert(a.id, "REJECTED").then(refresh)}>Rejeter</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </aside>
        </main>
      )}
    </div>
  );
}
