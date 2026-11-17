import { useId, useState } from "react";
import { m } from "motion/react";
import { pieceLabel, plural } from "@fasolink/shared/format";
import { Spinner } from "@fasolink/shared/ui";

const MIN_JUSTIFICATION = 10; // même seuil que la politique OPA
const DEMO_JUSTIFICATION = "Dossier n° 2026-118, demande déposée au guichet";

const MODES = {
  iue: { label: "IUE", field: "Identifiant unique de l'usager", example: "BF1998000123" },
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

/** Une finalité autorisée = une pièce que l'usager n'a plus à fournir. */
function PieceOption({ purpose, predicateLabels, checked, onChange }) {
  const question = purpose.allowed_predicates.map((p) => predicateLabels[p] ?? p).join(", ");
  return (
    <label className={`piece-option${checked ? " is-checked" : ""}`} title={`Base légale : ${purpose.legal_basis}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="piece-text">
        <span className="piece-name">{pieceLabel(purpose.allowed_predicates[0])}</span>
        <span className="piece-meta">{question} ? · {purpose.registry_name}</span>
      </span>
      {purpose.requires_consent && <span className="piece-consent">Accord requis</span>}
    </label>
  );
}

export default function VerifyForm({ purposes, predicateLabels, demo, onSubmit }) {
  const ids = useId();
  const [mode, setMode] = useState("iue");
  const [identifier, setIdentifier] = useState("");
  const [picked, setPicked] = useState(null);
  const [selected, setSelected] = useState(() => new Set(purposes.map((p) => p.policy_code)));
  const [justification, setJustification] = useState(demo ? DEMO_JUSTIFICATION : "");
  const [testRefusal, setTestRefusal] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (!purposes.length) {
    return <p className="notice notice-warning desk-message">Aucune politique d'accès n'est active pour votre administration.</p>;
  }

  const chosen = purposes.filter((p) => selected.has(p.policy_code));
  const allChosen = chosen.length === purposes.length;
  // Test de refus : une information que la première finalité cochée n'autorise pas
  const outOfScope = chosen[0] && Object.keys(predicateLabels).find((p) => !chosen[0].allowed_predicates.includes(p));
  const justificationLength = justification.trim().length;

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
    const id = identifier.trim().toUpperCase();
    const found = {
      identifier: id ? null : `Saisissez ${mode === "iue" ? "l'IUE" : "la référence de l'acte"} de l'usager.`,
      pieces: chosen.length ? null : "Cochez au moins une pièce à vérifier.",
      justification: justificationLength >= MIN_JUSTIFICATION
        ? null
        : `Le motif doit compter au moins ${MIN_JUSTIFICATION} caractères.`,
    };
    setErrors(found);
    if (found.identifier || found.pieces || found.justification) return;

    const citizen = mode === "iue" ? { iue: id } : { registry: "ETAT_CIVIL", local_reference: id };
    const requests = chosen.map((purpose, index) => ({
      purpose,
      payload: {
        citizen,
        purpose_code: purpose.purpose_code,
        predicates: [...purpose.allowed_predicates, ...(index === 0 && demo && testRefusal && outOfScope ? [outOfScope] : [])],
        justification: justification.trim(),
      },
    }));
    setBusy(true);
    try {
      await onSubmit({ citizen: { id, name: picked?.label }, justification: justification.trim(), requests });
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
            Pièces à vérifier
            {purposes.length > 1 && (
              <button
                type="button"
                className="block-action"
                onClick={() => setSelected(new Set(allChosen ? [] : purposes.map((p) => p.policy_code)))}
              >
                {allChosen ? "Tout décocher" : "Tout cocher"}
              </button>
            )}
          </legend>
          <div className="piece-list">
            {purposes.map((p) => (
              <PieceOption
                key={p.policy_code}
                purpose={p}
                predicateLabels={predicateLabels}
                checked={selected.has(p.policy_code)}
                onChange={() => toggle(p.policy_code)}
              />
            ))}
          </div>
          {errors.pieces && <p className="field-error">{errors.pieces}</p>}
          {demo && outOfScope && (
            <label className="check test-refusal">
              <input type="checkbox" checked={testRefusal} onChange={(e) => setTestRefusal(e.target.checked)} />
              <span>
                Tester un refus : demander aussi « {predicateLabels[outOfScope]} », information que cette finalité
                n'autorise pas.
              </span>
            </label>
          )}
        </fieldset>

        <fieldset className="block">
          <legend className="block-title">Motif</legend>
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
            : chosen.length > 1 ? `Vérifier les ${chosen.length} pièces` : "Vérifier la pièce"}
        </button>
        <p className="desk-summary">{plural(chosen.length, "pièce cochée", "pièces cochées")} sur {purposes.length}</p>
      </div>
    </form>
  );
}
