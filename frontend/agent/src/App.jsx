import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { isOpenRequest } from "@fasolink/shared/format";
import { usePolling } from "@fasolink/shared/hooks";
import { Footer, PageHero, Spinner, TopBar } from "@fasolink/shared/ui";
import { api, session } from "./api";
import Dossier from "./Dossier";
import { Procedure, SessionStats } from "./Overview";
import VerifyForm from "./VerifyForm";

/** Registres dans l'ordre du catalogue (acte de naissance, nationalité, casier), pas dans celui des codes. */
function withSortedRegistries(context) {
  const rank = Object.keys(context.predicates);
  const order = (r) => rank.indexOf(r.allowed_predicates[0]);
  return {
    ...context,
    cas_usage: context.cas_usage.map((c) => ({ ...c, registres: [...c.registres].sort((a, b) => order(a) - order(b)) })),
  };
}

/** Identifiants des demandes encore ouvertes : registre indisponible ou accord SMS attendu. */
const pendingIds = (dossiers) =>
  dossiers.flatMap((d) => d.items).filter((i) => i.result && isOpenRequest(i.result)).map((i) => i.result.request_id);

export default function App() {
  const ids = useId();
  const [context, setContext] = useState(null); // { administration, purposes, predicates }
  const [contextError, setContextError] = useState("");
  const [demo, setDemo] = useState(undefined); // undefined : en cours · null : hors démonstration
  const [dossiers, setDossiers] = useState([]);
  const [openId, setOpenId] = useState(null);
  const results = useRef(null);

  useEffect(() => {
    api.context().then((c) => setContext(withSortedRegistries(c)), (err) => setContextError(err.message));
    api.demo().then(setDemo);
  }, []);

  // Registre en panne : la pièce reste « en attente » jusqu'à la relance automatique
  const waiting = pendingIds(dossiers);
  usePolling(async () => {
    const fresh = await Promise.all(waiting.map((id) => api.request(id).catch(() => null)));
    const done = new Map(fresh.filter((r) => r && !isOpenRequest(r)).map((r) => [r.request_id, r]));
    if (!done.size) return;
    setDossiers((list) => list.map((d) => ({
      ...d,
      items: d.items.map((i) => (done.has(i.result?.request_id) ? { ...i, result: done.get(i.result.request_id), resolved: true } : i)),
    })));
  }, 2000, waiting.length > 0);

  /** Une demande pour le cas d'usage ; FasoLink répond registre par registre, le dossier regroupe les réponses. */
  async function submit({ citizen, justification, cas, registres, extra, payload }) {
    const started = performance.now();
    const response = await api.verify(payload);
    const durationMs = performance.now() - started;

    const items = response.results.map((result) => {
      const registre = registres.find((r) => r.registry_code === result.registry.code) ?? {
        // Registre hors du cas d'usage (test de refus) : OPA a refusé l'accès
        registry_code: result.registry.code, registry_name: result.registry.name, allowed_predicates: [extra],
      };
      return { key: result.request_id, purpose: { ...registre, purpose_code: cas.code, purpose_label: cas.label }, result };
    });
    const id = crypto.randomUUID();
    setDossiers((list) => [{
      id, at: new Date().toISOString(), durationMs, citizen, justification, cas: cas.label,
      identityStatus: response.identity_status, items,
    }, ...list]);
    setOpenId(id);
    // Sur mobile, les résultats sont sous le formulaire : on y amène l'agent
    if (matchMedia("(max-width: 63.99rem)").matches) {
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }));
    }
  }

  return (
    <>
      <TopBar portal="Portail administration" session={session} />
      <PageHero
        compact
        eyebrow={context?.administration ?? "Administration"}
        title="Vérification de pièces"
        titleId={`${ids}-title`}
      />

      <main className="page lift workspace">
        <section className="card desk reveal" aria-label="Nouvelle vérification">
          {contextError && <p className="notice notice-danger desk-message">{contextError}</p>}
          {!contextError && (!context || demo === undefined) && (
            <p className="desk-message desk-loading"><Spinner /> Chargement de vos habilitations…</p>
          )}
          {context && demo !== undefined && (
            <VerifyForm casUsage={context.cas_usage} predicateLabels={context.predicates} demo={demo} onSubmit={submit} />
          )}
        </section>

        <section ref={results} className="results reveal" style={{ "--i": 1 }} aria-labelledby={`${ids}-results`}>
          <header className="results-head">
            <h2 id={`${ids}-results`} className="section-title">{dossiers.length ? "Dossiers vérifiés" : "Comment vérifier un dossier"}</h2>
            {dossiers.length > 0 && <span className="results-count">{dossiers.length}</span>}
          </header>

          {dossiers.length === 0 ? <Procedure /> : <SessionStats dossiers={dossiers} />}
          <div className="results-list" aria-live="polite">
            <AnimatePresence initial={false}>
              {dossiers.map((d) => (
                <Dossier
                  key={d.id}
                  dossier={d}
                  predicateLabels={context?.predicates ?? {}}
                  open={openId === d.id}
                  onToggle={() => setOpenId((current) => (current === d.id ? null : d.id))}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>
      </main>
      <Footer portal="Portail administration" />
    </>
  );
}
