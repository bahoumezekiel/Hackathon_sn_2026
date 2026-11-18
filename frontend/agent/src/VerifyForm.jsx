import { useId, useState } from "react";
import { m } from "motion/react";
import { pieceLabel, plural } from "@fasolink/shared/format";
import { Spinner } from "@fasolink/shared/ui";

const MIN_JUSTIFICATION = 10; // même seuil que la politique OPA
const DEMO_JUSTIFICATION = "Dossier n° 2026-118, demande déposée au guichet";

const MODES = {
  iue: { label: "IUE", field: "Identifiant unique électronique (12 chiffres)", example: "482019736154" },
  local: { label: "Acte d'état civil", field: "Référence de l'acte d'état civil", example: "EC-FDG-2001-000222" },
};

function Segmented({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="Type d'identifiant">
      {Object.entries(MODES).map(([key, mode]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {value === key && <m.span layoutId="mode-thumb" className="segmented-thumb" transition={{ duration: 0.3 }} />}
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Un registre du cas d'usage = une pièce que l'usager n'a plus à fournir. */
function RegistryOption({ registre, predicateLabels, checked, onChange }) {
  const question = registre.allowed_predicates.map((p) => predicateLabels[p] ?? p).join(", ");
  return (
    <label className={`piece-option${checked ? " is-checked" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="piece-text">
        <span className="piece-name">{pieceLabel(registre.allowed_predicates[0])}</span>
        <span className="piece-meta">{question} ? · {registre.registry_name}</span>
      </span>
      {registre.requires_consent && <span className="piece-consent">Accord requis</span>}
    </label>
  );
}

const allRegistries = (cas) => new Set(cas?.registres.map((r) => r.registry_code) ?? []);

export default function VerifyForm({ casUsage, predicateLabels, demo, onSubmit }) {
  const ids = useId();
  const [mode, setMode] = useState("iue");
  const [identifier, setIdentifier] = useState("");
  const [picked, setPicked] = useState(null);
  const [casCode, setCasCode] = useState(casUsage[0]?.code);
  const cas = casUsage.find((c) => c.code === casCode) ?? casUsage[0];
  const [selected, setSelected] = useState(() => allRegistries(cas));
  const [justification, setJustification] = useState(demo ? DEMO_JUSTIFICATION : "");
  const [testRefusal, setTestRefusal] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (!cas) {
    return <p className="notice notice-warning desk-message">Aucun cas d'usage n'est actif pour votre administration.</p>;
  }

  const chosen = cas.registres.filter((r) => selected.has(r.registry_code));
  const allChosen = chosen.length === cas.registres.length;
  // Test de refus : une information qu'aucun registre de ce cas d'usage ne fournit
  const allowed = new Set(cas.registres.flatMap((r) => r.allowed_predicates));
  const outOfScope = Object.keys(predicateLabels).find((p) => !allowed.has(p));
  const justificationLength = justification.trim().length;
  const needsJustification = cas.requires_justification;

  function changeCas(code) {
    setCasCode(code);
    setSelected(allRegistries(casUsage.find((c) => c.code === code)));
    setTestRefusal(false);
    setErrors({});
  }

  function changeMode(next) {
    setMode(next);
    setIdentifier("");
    setPicked(null);
  }

  function pick(citizen) {
    setMode(citizen.iue ? "iue" : "local");
    setIdentifier(citizen.iue ?? citizen.local_reference);
    setPicked(citizen);
    setErrors({});
  }

  function toggle(code) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }

  async function submit(event) {
    event.preventDefault();
    const id = mode === "iue" ? identifier.replace(/\s/g, "") : identifier.trim().toUpperCase();
    const found = {
      identifier: id ? null : `Saisissez ${mode === "iue" ? "l'IUE" : "la référence de l'acte"} de l'usager.`,
      pieces: chosen.length ? null : "Cochez au moins un registre à consulter.",
      justification: !needsJustification || justificationLength >= MIN_JUSTIFICATION
        ? null
        : `Le motif doit compter au moins ${MIN_JUSTIFICATION} caractères.`,
    };
    setErrors(found);
    if (found.identifier || found.pieces || found.justification) return;

    const citizen = mode === "iue" ? { iue: id } : { registry: "ETAT_CIVIL", local_reference: id };
    const extra = demo && testRefusal && outOfScope ? outOfScope : null;
    // Une seule demande pour le cas d'usage : FasoLink la répartit entre les registres cochés
    const payload = {
      citizen,
      purpose_code: cas.code,
      predicates: [...chosen.flatMap((r) => r.allowed_predicates), ...(extra ? [extra] : [])],
      justification: justification.trim() || null,
    };
    setBusy(true);
    try {
      await onSubmit({
        citizen: { id, name: picked?.label }, justification: justification.trim(), cas, registres: chosen, extra, payload,
      });
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="desk-form" onSubmit={submit} noValidate>
      <div className="desk-body">
        <fieldset className="block">
          <legend className="block-title">Démarche</legend>
          {casUsage.length > 1 ? (
            <div className="field">
              <label className="label" htmlFor={`${ids}-cas`}>Cas d'usage traité</label>
              <select id={`${ids}-cas`} className="input" value={cas.code} onChange={(e) => changeCas(e.target.value)}>
                {casUsage.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          ) : (
            <p className="cas-name">{cas.label}</p>
          )}
          <p className="hint">{cas.description ? `${cas.description} ` : ""}Base légale : {cas.legal_basis}</p>
        </fieldset>

        <fieldset className="block">
          <legend className="block-title">Usager</legend>
          <Segmented value={mode} onChange={changeMode} />
          <div className="field">
            <label className="label" htmlFor={`${ids}-id`}>{MODES[mode].field}</label>
            <input
              id={`${ids}-id`}
              className="input input-id"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setPicked(null); }}
              placeholder={`Ex. ${MODES[mode].example}`}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              aria-invalid={Boolean(errors.identifier)}
              aria-describedby={errors.identifier ? `${ids}-id-error` : undefined}
            />
            {errors.identifier && <p id={`${ids}-id-error`} className="field-error">{errors.identifier}</p>}
          </div>

          {demo?.citizens?.length > 0 && (
            <div className="quick-pick">
              <p className="quick-label">Sélection rapide</p>
              <div className="chips">
                {demo.citizens.map((c) => (
                  <button key={c.label} type="button" className="chip" aria-pressed={picked?.label === c.label} onClick={() => pick(c)}>
                    {c.label}
                  </button>
                ))}
              </div>
              {picked?.note && <p className="hint">{picked.note}</p>}
            </div>
          )}
        </fieldset>

        <fieldset className="block">
          <legend className="block-title">
            Registres à consulter
            {cas.registres.length > 1 && (
              <button
                type="button"
                className="block-action"
                onClick={() => setSelected(allChosen ? new Set() : allRegistries(cas))}
              >
                {allChosen ? "Tout décocher" : "Tout cocher"}
              </button>
            )}
          </legend>
          <p className="hint">Ne cochez que ce que le dossier de cet usager exige.</p>
          <div className="piece-list">
            {cas.registres.map((r) => (
              <RegistryOption
                key={r.registry_code}
                registre={r}
                predicateLabels={predicateLabels}
                checked={selected.has(r.registry_code)}
                onChange={() => toggle(r.registry_code)}
              />
            ))}
          </div>
          {errors.pieces && <p className="field-error">{errors.pieces}</p>}
          {demo && outOfScope && (
            <label className="check test-refusal">
              <input type="checkbox" checked={testRefusal} onChange={(e) => setTestRefusal(e.target.checked)} />
              <span>
                Tester un refus : demander aussi « {predicateLabels[outOfScope]} », information que ce cas d'usage
                n'autorise pas.
              </span>
            </label>
          )}
        </fieldset>

        <fieldset className="block">
          <legend className="block-title">Motif{!needsJustification && " (facultatif)"}</legend>
          <div className="field">
            <label className="visually-hidden" htmlFor={`${ids}-why`}>Justification de la demande</label>
            <textarea
              id={`${ids}-why`}
              className="input"
              rows={2}
              maxLength={500}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Ex. numéro du dossier traité"
              aria-invalid={Boolean(errors.justification)}
              aria-describedby={`${ids}-why-hint`}
            />
            <p id={`${ids}-why-hint`} className={errors.justification ? "field-error" : "hint"}>
              {errors.justification ?? "Visible par l'usager dans son espace personnel."}
            </p>
          </div>
        </fieldset>
      </div>

      <div className="desk-foot">
        {errors.form && <p className="notice notice-danger" role="alert">{errors.form}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !chosen.length}>
          {busy
            ? <><Spinner /> Interrogation des registres…</>
            : chosen.length > 1 ? `Consulter les ${chosen.length} registres` : "Consulter le registre"}
        </button>
        <p className="desk-summary">{plural(chosen.length, "registre coché", "registres cochés")} sur {cas.registres.length}</p>
      </div>
    </form>
  );
}
