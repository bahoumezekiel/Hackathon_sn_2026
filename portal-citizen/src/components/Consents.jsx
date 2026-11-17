import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { api } from "../api";
import { purposeLabel } from "../labels";

export default function Consents() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  const load = () => api.consents().then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function toggle(c) {
    setBusy(c.policy_code);
    try {
      await api.setConsent(c.policy_code, c.status !== "GRANTED");
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="banner banner--deny" role="alert">{error}</div>;
  if (!list) return <div className="empty">Chargement…</div>;
  return (
    <div className="consents">
      <p className="intro">Certaines vérifications exigent votre accord. Vous pouvez le retirer à tout moment :
        l'administration se verra alors refuser l'accès.</p>
      {list.length === 0 && <div className="empty">Aucune vérification soumise à consentement.</div>}
      {list.map((c) => {
        const on = c.status === "GRANTED";
        const labelId = `consent-${c.policy_code}`;
        return (
          <div className="consent" key={c.policy_code}>
            <div id={labelId}>
              <div className="who"><Building2 aria-hidden="true" size={18} /> {c.administration}</div>
              <div className="why">{c.purpose_label || purposeLabel(c.purpose_code)} · {c.registry}</div>
              <div className={`consent__state ${on ? "is-on" : ""}`}>{on ? "Accordé" : "Non accordé"}</div>
            </div>
            <button className="switch" role="switch" aria-checked={on} aria-labelledby={labelId}
              disabled={busy === c.policy_code} onClick={() => toggle(c)}>
              <span />
            </button>
          </div>
        );
      })}
    </div>
  );
}
