import { useEffect, useState } from "react";
import { api } from "../api";
import { purposeLabel } from "../labels";

export default function Consents() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  const load = () => api.consents().then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function toggle(c) {
    await api.setConsent(c.policy_code, c.status !== "GRANTED");
    load();
  }

  if (error) return <div className="banner bad">{error}</div>;
  if (!list) return <div className="empty">Chargement…</div>;
  return (
    <div className="consents">
      <p className="intro">Certaines vérifications exigent votre accord. Vous pouvez le retirer à tout moment :
        l'administration se verra alors refuser l'accès.</p>
      {list.length === 0 && <div className="empty">Aucune vérification soumise à consentement.</div>}
      {list.map((c) => {
        const on = c.status === "GRANTED";
        return (
          <div className="consent" key={c.policy_code}>
            <div>
              <div className="who">{c.administration}</div>
              <div className="why">{purposeLabel(c.purpose_code)} · {c.registry}</div>
            </div>
            <button className={`switch ${on ? "on" : ""}`} onClick={() => toggle(c)} aria-pressed={on}
              aria-label={on ? "Retirer mon consentement" : "Donner mon consentement"}>
              <span />
            </button>
          </div>
        );
      })}
    </div>
  );
}
