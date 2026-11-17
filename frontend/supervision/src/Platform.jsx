import { plural } from "@fasolink/shared/format";

export default function Platform({ stack, integrity }) {
  return (
    <>
      <section className="card side-block" aria-labelledby="stack-title">
        <h2 id="stack-title" className="section-title">Socle technique</h2>
        <ul className="stack">
          {stack.components.map((c) => (
            <li key={c.component} className={c.up ? "is-up" : "is-down"}>
              <span className="stack-dot" aria-hidden="true" />
              <div>
                <p className="stack-name">{c.component}</p>
                <p className="stack-role">{c.role}</p>
              </div>
              <span className="stack-state">{c.up ? "Disponible" : "Indisponible"}</span>
            </li>
          ))}
        </ul>
        <p className="hint">File de relance Redis : {plural(stack.retry_queue_size, "demande")}</p>
      </section>

      <section className={`card side-block integrity ${integrity.intact ? "is-intact" : "is-broken"}`} aria-labelledby="audit-title">
        <h2 id="audit-title" className="section-title">Journal d'audit</h2>
        <p className="integrity-state">
          {integrity.intact ? "Intègre" : `Rompu à l'événement n° ${integrity.broken_at_seq}`}
        </p>
        <p className="hint">{plural(integrity.events, "événement chaîné", "événements chaînés")} par SHA-256, ajout seul (modification et suppression bloquées en base).</p>
        {integrity.head_hash && <p className="mono integrity-hash">{integrity.head_hash.slice(0, 32)}…</p>}
      </section>
    </>
  );
}
