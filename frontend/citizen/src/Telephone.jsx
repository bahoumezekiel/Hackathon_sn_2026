import { useEffect, useId, useRef, useState } from "react";
import { usePolling } from "@fasolink/shared/hooks";
import { Spinner } from "@fasolink/shared/ui";
import { phone, signup } from "./api";

const clock = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const digits = (n) => (n ?? "").replace(/\D/g, "");

/** Démonstration : téléphone simple d'un usager sans accès au web.
 *  Il reçoit les SMS de FasoLink et y répond (1 = OUI, 2 = NON). */
export default function Telephone() {
  const ids = useId();
  const [owners, setOwners] = useState(null);
  const [owner, setOwner] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const screen = useRef(null);

  useEffect(() => {
    signup.demo().then((d) => {
      // Usagers sans accès au web d'abord : c'est pour eux que le SMS existe
      const list = (d?.citizens ?? []).filter((c) => c.telephone)
        .sort((a, b) => Number(b.sans_web) - Number(a.sans_web));
      setOwners(list);
      setOwner(list[0] ?? null);
    });
  }, []);

  usePolling(async () => {
    if (!owner) return;
    setMessages(await phone.inbox(digits(owner.telephone)));
  }, 2000, Boolean(owner), { background: true });

  useEffect(() => {
    screen.current?.scrollTo({ top: screen.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function send(value) {
    const body = value.trim();
    if (!body || !owner) return;
    setBusy(true);
    setError("");
    try {
      await phone.reply(digits(owner.telephone), body);
      setText("");
      setMessages(await phone.inbox(digits(owner.telephone)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!owners) return <main className="phone-page"><p><Spinner /> Chargement…</p></main>;
  if (!owners.length) {
    return <main className="phone-page"><p className="notice notice-warning">Téléphone simulé disponible uniquement en mode démonstration.</p></main>;
  }

  return (
    <main className="phone-page">
      <header className="phone-intro">
        <p className="eyebrow">Démonstration</p>
        <h1>Téléphone de l'usager</h1>
        <p>
          Un usager sans accès au web reçoit ici les SMS de FasoLink, au numéro associé à son identifiant unique.
          Aucun SMS réel n'est envoyé.
        </p>
        <div className="chips" role="group" aria-label="Téléphone de">
          {owners.map((o) => (
            <button key={o.telephone} type="button" className="chip" aria-pressed={owner?.telephone === o.telephone}
              onClick={() => { setOwner(o); setMessages([]); setError(""); }}>
              {o.label}{o.sans_web ? " · sans Internet" : ""}
            </button>
          ))}
        </div>
      </header>

      <section className="phone" aria-labelledby={`${ids}-num`}>
        <div className="phone-bar">
          <span id={`${ids}-num`} className="mono">{owner.telephone}</span>
          <span>{owner.label}</span>
        </div>
        <div ref={screen} className="phone-screen" aria-live="polite">
          {messages.length === 0 && <p className="phone-empty">Aucun SMS pour le moment.</p>}
          {messages.map((msg) => (
            <div key={`${msg.at}-${msg.direction}`} className={`sms is-${msg.direction === "in" ? "received" : "sent"}`}>
              <p>{msg.text}</p>
              <time>{clock.format(new Date(msg.at * 1000))}</time>
            </div>
          ))}
        </div>
        <div className="phone-quick">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send("1")}>1 · OUI</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => send("2")}>2 · NON</button>
        </div>
        <form className="phone-compose" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <label className="visually-hidden" htmlFor={`${ids}-sms`}>Répondre par SMS</label>
          <input id={`${ids}-sms`} className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="Écrire un SMS…" />
          <button type="submit" className="btn btn-secondary" disabled={busy || !text.trim()}>Envoyer</button>
        </form>
        {error && <p className="field-error">{error}</p>}
      </section>
    </main>
  );
}
