import { m } from "motion/react";
import { isDenied, isOpenRequest } from "@fasolink/shared/format";
import { useCountUp } from "@fasolink/shared/hooks";
import { Icon } from "@fasolink/shared/ui";

const STEPS = [
  {
    icon: "user-search",
    title: "Identifier l'usager",
    text: "Par son IUE ou, à défaut, la référence de son acte d'état civil. Aucune pièce papier n'est demandée.",
  },
  {
    icon: "list-checks",
    title: "Cocher les registres",
    text: "Parmi ceux de votre cas d'usage, seulement ceux qu'exige le dossier de cet usager. Le motif est tracé.",
  },
  {
    icon: "shield-check",
    title: "Recevoir les réponses",
    text: "Oui ou Non pour chaque pièce, dans une attestation signée et horodatée, vérifiable à tout moment.",
  },
];

const enter = (i) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay: 0.25 + i * 0.09 },
});

/** Procédure affichée tant qu'aucun dossier n'a été vérifié. */
export function Procedure() {
  return (
    <div className="procedure">
      <div className="procedure-cards">
        {STEPS.map((step, i) => (
          <m.article key={step.title} className="guide-card" {...enter(i)}>
            <span className="guide-icon"><Icon name={step.icon} /></span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </m.article>
        ))}
      </div>
      <m.p className="guide-note" {...enter(3)}>
        <Icon name="eye-off" />
        <span>
          <strong>Vous ne voyez jamais les données elles-mêmes</strong> (date de naissance, nationalité,
          condamnations) : seulement la réponse à votre question. L'usager est informé de chaque consultation.
        </span>
      </m.p>
    </div>
  );
}

function Stat({ icon, label, value, format = String, index }) {
  const shown = useCountUp(value);
  return (
    <m.div className="stat-card" {...enter(index)}>
      <span className="guide-icon"><Icon name={icon} /></span>
      <div>
        <p className="stat-value">{format(shown)}</p>
        <p className="stat-label">{label}</p>
      </div>
    </m.div>
  );
}

const seconds = (ms) => `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;

/** Indicateurs de la session : ce que le guichet a évité à l'usager. */
export function SessionStats({ dossiers }) {
  const items = dossiers.flatMap((d) => d.items);
  const answered = items.filter((i) => i.result && !isDenied(i.result) && !isOpenRequest(i.result) && i.result.status !== "FAILED");
  const averageMs = Math.round(dossiers.reduce((sum, d) => sum + d.durationMs, 0) / dossiers.length);

  return (
    <div className="stats">
      <Stat index={0} icon="folder-check" label="Dossiers vérifiés" value={dossiers.length} />
      <Stat index={1} icon="file-check" label="Pièces que l'usager n'a pas eu à fournir" value={answered.length} />
      <Stat index={2} icon="clock" label="Délai moyen de réponse" value={averageMs} format={seconds} />
    </div>
  );
}
