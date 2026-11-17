import { AnimatePresence, m } from "motion/react";
import { formatTime, plural, purposeLabel, requestState } from "@fasolink/shared/format";
import { Badge } from "@fasolink/shared/ui";

// Une nouvelle demande apparaît en surbrillance verte, qui s'estompe
const ROW_ENTER = {
  initial: { opacity: 0, backgroundColor: "rgba(232, 243, 236, 1)" },
  animate: { opacity: 1, backgroundColor: "rgba(232, 243, 236, 0)" },
  transition: { duration: 1.2 },
};

export default function RequestFeed({ requests, registries }) {
  const registryName = Object.fromEntries(registries.map((r) => [r.code, r.name]));

  return (
    <section className="card feed" aria-labelledby="feed-title">
      <header className="feed-head">
        <h2 id="feed-title" className="section-title">Flux des demandes</h2>
        <p className="hint">Aucune identité de citoyen n'est affichée ici.</p>
      </header>

      {requests.length === 0 ? (
        <p className="feed-empty">Aucune demande pour le moment.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Administration</th>
                <th scope="col">Finalité</th>
                <th scope="col">Registre</th>
                <th scope="col">État</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {requests.map((q) => {
                  const state = requestState(q);
                  return (
                    <m.tr key={q.id} {...ROW_ENTER}>
                      <td className="mono cell-time">{formatTime(q.created_at)}</td>
                      <td className="cell-admin">{q.administration}</td>
                      <td className="cell-purpose">{purposeLabel(q.purpose_code)}</td>
                      <td className="cell-registry">{registryName[q.registry] ?? q.registry}</td>
                      <td className="cell-state">
                        <Badge tone={state.tone}>{state.label}</Badge>
                        {q.retry_count > 0 && <span className="retries"> {plural(q.retry_count, "relance")}</span>}
                      </td>
                    </m.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
