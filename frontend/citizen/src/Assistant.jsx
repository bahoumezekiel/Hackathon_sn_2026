import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { isDenied, isPending, purposeLabel, timeAgo } from "@fasolink/shared/format";
import { api } from "./api";

// Assistant à règles (prototype) : compréhension par mots-clés, réponses lues à voix haute.
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const SUGGESTIONS = [
  "Qui a consulté mes données ?",
  "Y a-t-il eu des refus ?",
  "Où en sont mes consentements ?",
  "Je veux signaler le dernier accès",
];

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

/** Phrase simple décrivant un accès. */
function describe(a) {
  const purpose = purposeLabel(a.purpose_code).toLowerCase();
  if (isDenied(a)) return `${a.administration} a tenté une ${purpose} ${timeAgo(a.created_at)}, mais l'accès a été refusé.`;
  if (isPending(a)) return `${a.administration} a demandé une ${purpose} ${timeAgo(a.created_at)} ; la réponse est en attente.`;
  const shared = a.shared.map((s) => s.display).join(", ") || "aucune information";
  return `${a.administration}, ${timeAgo(a.created_at)}, pour une ${purpose}. Information transmise : ${shared}.`;
}

/** Répond à partir des données à jour (jamais d'un état figé au moment de l'écoute). */
async function reply(question) {
  const q = normalize(question);
  const accesses = (await api.history()).accesses;

  if (/signal|alerte|plainte|abus|fraude|reconnais pas/.test(q)) {
    const last = accesses[0];
    if (!last) return { text: "Il n'y a aucun accès à signaler." };
    await api.report(last.id, `Signalement vocal : « ${question} »`, "VOICE");
    return {
      text: `C'est fait. J'ai signalé le dernier accès : ${describe(last)} Un délégué à la protection des données va l'examiner.`,
      changed: true,
    };
  }
  if (/consent|accord|autoris/.test(q)) {
    const consents = await api.consents();
    if (!consents.length) return { text: "Aucune vérification ne dépend de votre consentement." };
    const list = consents
      .map((c) => `${c.administration}, ${purposeLabel(c.purpose_code).toLowerCase()} : ${c.status === "GRANTED" ? "accordé" : "non accordé"}.`)
      .join(" ");
    return { text: `${list} Vous pouvez le modifier dans l'onglet Consentements.` };
  }
  if (/integr|falsifi|modifi|efface|confiance|journal/.test(q)) {
    const integrity = await api.integrity();
    return {
      text: integrity.intact
        ? `Le journal est intact : ${integrity.events} événements sont chaînés, aucun n'a été modifié ni supprimé.`
        : "Attention : une altération du journal a été détectée. La supervision en est informée.",
    };
  }
  if (/refus|bloque|rejet/.test(q)) {
    const denied = accesses.filter(isDenied);
    if (!denied.length) return { text: "Aucune demande n'a été refusée." };
    return { text: `${denied.length} demande${denied.length > 1 ? "s ont" : " a"} été refusée${denied.length > 1 ? "s" : ""}. La plus récente : ${describe(denied[0])}` };
  }
  if (/qui|consult|regard|acced|vu|donnees|historique/.test(q)) {
    if (!accesses.length) return { text: "Personne n'a consulté vos données." };
    return { text: `${accesses.length} demande${accesses.length > 1 ? "s" : ""} vous concerne${accesses.length > 1 ? "nt" : ""}. ${accesses.slice(0, 3).map(describe).join(" ")}` };
  }
  return {
    text: "Je peux vous dire qui a consulté vos données, s'il y a eu des refus, où en sont vos consentements, ou signaler un accès. Que souhaitez-vous ?",
  };
}

export default function Assistant({ onChange }) {
  const [messages, setMessages] = useState([
    { id: 0, from: "bot", text: "Bonjour. Posez votre question à voix haute ou par écrit : je vous réponds à partir de votre historique." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const recognition = useRef(null);
  const log = useRef(null);
  const nextId = useRef(1);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Quitter l'onglet coupe le micro et la voix
  useEffect(() => () => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  const push = (from, text) => setMessages((list) => [...list, { id: nextId.current++, from, text }]);

  async function ask(question) {
    const text = question.trim();
    if (!text || busy) return;
    push("me", text);
    setBusy(true);
    try {
      const answer = await reply(text);
      push("bot", answer.text);
      speak(answer.text);
      if (answer.changed) onChange();
    } catch (err) {
      push("bot", `Désolé, je n'ai pas pu répondre : ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    if (listening) return recognition.current?.stop();
    const rec = new Recognition();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.onresult = (e) => ask(e.results[0][0].transcript);
    rec.onerror = (e) => setMicError(e.error === "not-allowed" ? "Accès au micro refusé par le navigateur." : `Micro indisponible (${e.error}).`);
    rec.onend = () => setListening(false);
    recognition.current = rec;
    setMicError("");
    setListening(true);
    rec.start();
  }

  function submit(event) {
    event.preventDefault();
    ask(input);
    setInput("");
  }

  return (
    <div className="assistant card">
      <div className="chat" ref={log} role="log" aria-live="polite">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <m.p
              key={msg.id}
              className={`bubble from-${msg.from}`}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              {msg.text}
            </m.p>
          ))}
        </AnimatePresence>
        {busy && <p className="bubble from-bot typing" aria-label="L'assistant répond"><span /><span /><span /></p>}
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>
        ))}
      </div>

      <form className="composer" onSubmit={submit}>
        {Recognition && (
          <button
            type="button"
            className={`mic${listening ? " is-listening" : ""}`}
            onClick={listen}
            aria-pressed={listening}
          >
            <span className="mic-dot" aria-hidden="true" />
            {listening ? "J'écoute…" : "Parler"}
          </button>
        )}
        <label className="visually-hidden" htmlFor="assistant-input">Votre question</label>
        <input
          id="assistant-input"
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Écrivez votre question"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Envoyer</button>
      </form>
      <p className="hint assistant-hint">
        {micError || (Recognition
          ? "Appuyez sur « Parler », puis posez votre question en français."
          : "La reconnaissance vocale n'est pas disponible dans ce navigateur (Chrome ou Edge). La saisie écrite fonctionne.")}
      </p>
    </div>
  );
}
