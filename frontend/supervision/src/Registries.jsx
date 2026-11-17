import { useState } from "react";
import { plural, timeAgo } from "@fasolink/shared/format";
import { Badge, Spinner } from "@fasolink/shared/ui";
import { api } from "./api";

const STATE = {
  UP: { tone: "success", label: "Opérationnel" },
  DEGRADED: { tone: "warning", label: "Instable" },
  DOWN: { tone: "danger", label: "En panne" },
  MAINTENANCE: { tone: "neutral", label: "Maintenance" },
};

/** Échecs consécutifs avant ouverture du disjoncteur, en segments. */
function FailureMeter({ failures, threshold }) {
  return (
    <span className="meter" role="img" aria-label={`${plural(failures, "échec")} sur ${threshold}`}>
      {Array.from({ length: threshold }, (_, i) => (
        <span key={i} className={i < failures ? "is-on" : undefined} />
      ))}
    </span>
  );
}

function Registry({ registry: r, demo, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = STATE[r.status] ?? { tone: "neutral", label: r.status };
  const down = r.status !== "UP";

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api.simulate(r.code, !down);
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`card registry tone-${state.tone}`}>
      <header className="registry-head">
        <div>
          <h3>{r.name}</h3>
          <p className="mono registry-code">{r.code}</p>
        </div>
        <Badge tone={state.tone}>{state.label}</Badge>
      </header>

      <dl className="registry-metrics">
        <div>
          <dt>Disjoncteur</dt>
          <dd>{r.circuit_open ? `Ouvert ${timeAgo(r.circuit_opened_at)}` : "Fermé"}</dd>
        </div>
        <div>
          <dt>Échecs consécutifs</dt>
          <dd><FailureMeter failures={Math.min(r.consecutive_failures, r.failure_threshold)} threshold={r.failure_threshold} /></dd>
        </div>
        <div>
          <dt>En file de relance</dt>
          <dd className={r.queued ? "is-queued" : undefined}>{r.queued}</dd>
        </div>
        <div>
          <dt>Dernier contrôle</dt>
          <dd>{timeAgo(r.last_health_check)}</dd>
        </div>
      </dl>

      {demo && (
        <button type="button" className={`btn btn-block ${down ? "btn-primary" : "btn-secondary"}`} onClick={toggle} disabled={busy}>
          {busy ? <><Spinner /> En cours…</> : down ? "Rétablir le registre" : "Simuler une panne"}
        </button>
      )}
      {error && <p className="field-error">{error}</p>}
    </article>
  );
}

export default function Registries({ registries, demo, onChange }) {
  return (
    <section aria-labelledby="registries-title">
      <h2 id="registries-title" className="section-title">Registres connectés</h2>
      <div className="registries">
        {registries.map((r) => (
          <div key={r.code} className="registry-slot">
            <Registry registry={r} demo={demo} onChange={onChange} />
          </div>
        ))}
      </div>
    </section>
  );
}
