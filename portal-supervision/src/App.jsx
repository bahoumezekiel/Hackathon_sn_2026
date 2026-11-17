import { useCallback, useEffect, useState } from "react";
import {
  Activity, BellRing, Database, FileCheck2, FileText, Layers, LogOut, Mic, MessageSquare,
  Power, PowerOff, ShieldCheck, ShieldAlert, ShieldX, Timer,
} from "lucide-react";
import { api } from "./api";
import { hasRole, logout, switchAccount, username } from "./auth";
import { ALERT_STATUS, REGISTRY_STATE, ago, purposeLabel, time } from "./labels";
import { Logo } from "./components/ui/Logo";
import { StatusPill } from "./components/ui/StatusPill";

function Kpi({ label, value, tone, Icon }) {
  return (
    <div className={`kpi kpi--${tone || "neutral"}`}>
      <div className="kpi__top"><Icon aria-hidden="true" size={18} /><span className="kpi__label">{label}</span></div>
      <div className="kpi__value">{value}</div>
    </div>
  );
}

function Block({ title, Icon, children, className = "", aside }) {
  return (
    <section className={`block ${className}`}>
      <h2><Icon aria-hidden="true" size={16} /> {title}{aside && <span className="block__aside">{aside}</span>}</h2>
      {children}
    </section>
  );
}

function Registry({ r, onToggle }) {
  const [tone, label] = REGISTRY_STATE[r.status] || ["wait", r.status];
  const [busy, setBusy] = useState(false);
  const down = r.status !== "UP";
  return (
    <div className={`registry registry--${tone}`}>
      <div className="registry__head">
        <div>
          <div className="registry__name">{r.name}</div>
          <div className="faint mono">{r.code}</div>
        </div>
        <StatusPill tone={tone} size="sm">{label}</StatusPill>
      </div>
      <dl className="metrics">
        <div><dt>Disjoncteur</dt><dd>{r.circuit_open ? `ouvert · ${ago(r.circuit_opened_at)}` : "fermé"}</dd></div>
        <div><dt>Échecs</dt><dd className="num">{r.consecutive_failures} / {r.failure_threshold}</dd></div>
        <div><dt>En file</dt><dd className={`num ${r.queued ? "is-warn" : ""}`}>{r.queued}</dd></div>
        <div><dt>Contrôle</dt><dd>il y a {ago(r.last_health_check)}</dd></div>
      </dl>
      <button className={`action ${down ? "action--restore" : "action--break"}`} disabled={busy}
        onClick={async () => { setBusy(true); await onToggle(r.code, !down); setBusy(false); }}>
        {down ? <><Power aria-hidden="true" size={16} /> Rétablir le registre</> : <><PowerOff aria-hidden="true" size={16} /> Simuler une panne</>}
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
        <Logo tag="Supervision" />
        <h1>Portail réservé à la supervision</h1>
        <p>Vous êtes connecté en tant que <b>{username()}</b>, qui n'a pas le rôle « supervisor ».</p>
        <button className="btn btn--primary" onClick={switchAccount}>Se connecter avec le compte superviseur</button>
      </div>
    );
  }

  const reqs = data?.requests || [];
  const openAlerts = (data?.alerts || []).filter((a) => a.status === "OPEN" || a.status === "IN_REVIEW");
  const stackUp = (data?.stack.components || []).filter((c) => c.up).length;

  return (
    <div className="shell">
      <header className="bar">
        <Logo tag="Supervision" />
        <div className="bar__right">
          <span className="live"><span className="live__dot" /> En direct</span>
          <span className="faint">{username()}</span>
          <button className="btn btn--ghost" onClick={logout}><LogOut aria-hidden="true" size={16} /> Déconnexion</button>
        </div>
      </header>

      {error && <div className="error" role="alert">{error}</div>}
      {!data ? <div className="loading">Chargement du tableau de bord…</div> : (
        <main className="grid">
          <section className="kpis" aria-label="Indicateurs clés">
            <Kpi Icon={FileCheck2} label="Pièces justificatives évitées aux citoyens" value={data.impact.documents_avoided} tone="impact" />
            <Kpi Icon={ShieldX} label="Refusées par OPA" value={reqs.filter((q) => q.decision === "DENY").length} tone="deny" />
            <Kpi Icon={Timer} label="Servies en mode dégradé" value={reqs.filter((q) => q.service_mode !== "NORMAL").length} tone="wait" />
            <Kpi Icon={BellRing} label="Alertes citoyennes ouvertes" value={openAlerts.length} tone={openAlerts.length ? "deny" : "neutral"} />
            <Kpi Icon={Layers} label="Composants du socle" value={`${stackUp}/${data.stack.components.length}`}
              tone={stackUp === data.stack.components.length ? "ok" : "deny"} />
          </section>

          <Block title="Registres connectés" Icon={Database} className="registries">
            <div className="registry-grid">
              {data.registries.map((r) => (
                <Registry key={r.code} r={r} onToggle={(code, down) => api.simulate(code, down).then(refresh)} />
              ))}
            </div>
          </Block>

          <Block title="Flux des demandes" Icon={Activity} className="feed" aside="aucune identité de citoyen">
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Heure</th><th scope="col">Administration</th><th scope="col">Finalité</th><th scope="col">Registre</th><th scope="col">État</th></tr></thead>
                <tbody>
                  {reqs.map((q) => (
                    <tr key={q.id}>
                      <td className="mono">{time(q.created_at)}</td>
                      <td>{q.administration}</td>
                      <td>{q.purpose_label || purposeLabel(q.purpose_code)}</td>
                      <td className="mono">{q.registry}</td>
                      <td><StatusPill result={q} size="sm" count={q.retry_count} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <aside className="side">
            <Block title="Impact « Dites-le nous une fois »" Icon={FileCheck2} className="impact">
              {data.impact.by_document.length === 0 && <div className="faint">Aucune pièce évitée pour l'instant.</div>}
              {data.impact.by_document.map((d) => (
                <div className="row" key={d.document}>
                  <span className="row__label"><FileText aria-hidden="true" size={14} /> {d.document}</span>
                  <b className="impact__num">{d.avoided}</b>
                </div>
              ))}
              {data.impact.by_purpose.length > 0 && <h3 className="sub">Par démarche</h3>}
              {data.impact.by_purpose.map((p) => (
                <div className="row" key={p.purpose}>
                  <span>{p.purpose}</span><span className="faint num">{p.completed}/{p.requests} abouties</span>
                </div>
              ))}
            </Block>

            <Block title="Socle technique" Icon={Layers}>
              {data.stack.components.map((c) => (
                <div className="row stack-row" key={c.component}>
                  <div><b>{c.component}</b><div className="faint">{c.role}</div></div>
                  <StatusPill tone={c.up ? "ok" : "deny"} size="sm">{c.up ? "OK" : "Hors ligne"}</StatusPill>
                </div>
              ))}
              <div className="faint small">File de relance Redis : {data.stack.retry_queue_size} demande(s)</div>
            </Block>

            <Block title="Journal d'audit" Icon={data.integrity.intact ? ShieldCheck : ShieldAlert}
              className={`integrity integrity--${data.integrity.intact ? "ok" : "deny"}`}>
              <div className="integrity__big">{data.integrity.intact ? "Intègre" : `Rompu à #${data.integrity.broken_at_seq}`}</div>
              <div className="faint">{data.integrity.events} événements chaînés (SHA-256)</div>
              <div className="mono faint hash">{(data.integrity.head_hash || "").slice(0, 32)}…</div>
            </Block>

            <Block title="Alertes citoyennes" Icon={BellRing} aside={openAlerts.length ? `${openAlerts.length} ouverte(s)` : null}>
              <div aria-live="polite">
                {data.alerts.length === 0 && <div className="faint">Aucune alerte.</div>}
                {data.alerts.map((a) => {
                  const open = a.status === "OPEN" || a.status === "IN_REVIEW";
                  const [tone, label] = ALERT_STATUS[a.status] || ["wait", a.status];
                  const Channel = a.channel === "VOICE" ? Mic : MessageSquare;
                  return (
                    <div className={`alert ${open ? "alert--open" : ""}`} key={a.id}>
                      <div className="alert__head">
                        <span className="alert__who">
                          <Channel aria-label={a.channel === "VOICE" ? "Signalement vocal" : "Signalement écrit"} size={15} />
                          <b>{a.contested_administration || "Accès non précisé"}</b>
                        </span>
                        <StatusPill tone={tone} size="sm">{label}</StatusPill>
                      </div>
                      <div className="faint">{purposeLabel(a.contested_purpose)} · il y a {ago(a.created_at)}</div>
                      <div className="alert__text">{a.description}</div>
                      {open && (
                        <div className="alert__actions">
                          {a.status === "OPEN" && <button onClick={() => api.updateAlert(a.id, "IN_REVIEW").then(refresh)}>Prendre en charge</button>}
                          <button onClick={() => api.updateAlert(a.id, "RESOLVED").then(refresh)}>Résoudre</button>
                          <button onClick={() => api.updateAlert(a.id, "REJECTED").then(refresh)}>Rejeter</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Block>
          </aside>
        </main>
      )}
    </div>
  );
}
