import { useEffect, useState } from "react";
import { purposeLabel } from "@fasolink/shared/format";
import { Spinner } from "@fasolink/shared/ui";
import { api } from "./api";

export default function Consents({ onChange }) {
  const [consents, setConsents] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null); // policy_code en cours de modification

  useEffect(() => {
    api.consents().then(setConsents, (err) => setError(err.message));
  }, []);

  async function toggle(consent) {
    setBusy(consent.policy_code);
    setError("");
    try {
      const { status } = await api.setConsent(consent.policy_code, consent.status !== "GRANTED");
      setConsents((list) => list.map((c) => (c.policy_code === consent.policy_code ? { ...c, status } : c)));
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="consents">
      <p className="consents-intro">
        Certaines vérifications exigent votre accord. Vous pouvez le retirer à tout moment. L'administration se
        verra alors refuser l'accès, et sa tentative apparaîtra dans votre historique.
      </p>
      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      {!consents && !error && <p className="panel-loading"><Spinner /> Chargement…</p>}
      {consents?.length === 0 && <p className="panel-empty">Aucune vérification ne dépend de votre consentement.</p>}

      {consents?.map((c) => {
        const granted = c.status === "GRANTED";
        const labelId = `consent-${c.policy_code}`;
        return (
          <div key={c.policy_code} className="card consent">
            <div>
              <p className="consent-title" id={labelId}>{c.administration}</p>
              <p className="consent-purpose">{purposeLabel(c.purpose_code, c.purpose_label)} · {c.registry}</p>
              <p className={`consent-state${granted ? " is-on" : ""}`}>
                {granted ? "Vous avez donné votre accord." : "Sans votre accord, l'accès sera refusé."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={granted}
              aria-labelledby={labelId}
              disabled={busy === c.policy_code}
              onClick={() => toggle(c)}
            >
              <span className="switch-thumb" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
