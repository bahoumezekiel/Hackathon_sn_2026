import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal } from "lucide-react";
import { api } from "../api";
import { describe, isDenied, purposeLabel } from "../labels";

// Assistant à règles (prototype) : compréhension par mots-clés, réponses parlées.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

async function answer(question, history, integrity) {
  const q = norm(question);
  const list = history?.accesses || [];
  const last = list[0];

  if (/signal|alerte|plainte|abus|fraude|reconnais pas/.test(q)) {
    if (!last) return "Il n'y a aucun accès à signaler.";
    await api.report(last.id, `Signalement vocal : « ${question} »`, "VOICE");
    return `C'est fait. J'ai signalé le dernier accès : ${describe(last)} Un délégué à la protection des données va l'examiner.`;
  }
  if (/piece|document|papier|evite|demarche/.test(q)) {
    const docs = list.flatMap((a) => a.documents_avoided || []);
    if (!docs.length) return "Pour l'instant, aucune pièce justificative n'a été obtenue directement pour vous.";
    const count = {};
    docs.forEach((d) => { count[d] = (count[d] || 0) + 1; });
    return `Vous n'avez pas eu à fournir ${docs.length} pièce(s) : `
      + Object.entries(count).map(([d, n]) => `${d}${n > 1 ? ` (${n} fois)` : ""}`).join(", ")
      + ". Les administrations les ont obtenues directement, et chaque échange est tracé.";
  }
  if (/consent|accord|autoris/.test(q)) {
    const c = await api.consents();
    if (!c.length) return "Aucune vérification ne dépend de votre consentement.";
    return c.map((x) => `${x.administration}, ${(x.purpose_label || purposeLabel(x.purpose_code)).toLowerCase()} : ${x.status === "GRANTED" ? "accordé" : "non accordé"}.`).join(" ")
      + " Vous pouvez le changer dans l'onglet Consentements.";
  }
  if (/integr|falsifi|modifi|efface|confiance/.test(q)) {
    return integrity?.intact
      ? `Le journal est intact : ${integrity.events} événements sont chaînés, aucune ligne n'a été modifiée ou supprimée.`
      : "Attention : une altération du journal a été détectée.";
  }
  if (/refus|bloque|rejet/.test(q)) {
    const denied = list.filter(isDenied);
    if (!denied.length) return "Aucune demande n'a été refusée.";
    return `${denied.length} demande(s) refusée(s). La plus récente : ${describe(denied[0])} Raison : ${denied[0].decision_reason}.`;
  }
  if (/combien|nombre/.test(q)) {
    const by = {};
    list.filter((a) => !isDenied(a)).forEach((a) => { by[a.administration] = (by[a.administration] || 0) + 1; });
    const parts = Object.entries(by).map(([k, v]) => `${k} : ${v}`);
    return parts.length ? `${list.length} demande(s) au total. Consultations autorisées — ${parts.join(", ")}.` : "Aucune consultation autorisée pour l'instant.";
  }
  if (/dernier|recent|derniere/.test(q)) return last ? `Le dernier accès : ${describe(last)}` : "Aucun accès pour le moment.";
  if (/qui|consult|regard|acced|vu|donnees/.test(q)) {
    if (!list.length) return "Personne n'a consulté vos données.";
    return `${list.length} demande(s) vous concernent. Les plus récentes : ${list.slice(0, 3).map(describe).join(" ")}`;
  }
  return "Je peux vous dire qui a consulté vos données, s'il y a eu des refus, l'état de vos consentements, ou signaler un accès. Que souhaitez-vous ?";
}

const SUGGESTIONS = ["Qui a consulté mes données ?", "Quelles pièces m'ont été évitées ?",
  "Y a-t-il eu des refus ?", "Je veux signaler le dernier accès"];

export default function Assistant({ history, integrity, refresh }) {
  const [messages, setMessages] = useState([
    { from: "bot", text: "Bonjour ! Je peux vous dire qui a consulté vos données, signaler un accès suspect ou expliquer vos consentements." },
  ]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const recRef = useRef(null);
  const logRef = useRef(null);
  const ctx = useRef({ history, integrity });
  ctx.current = { history, integrity };

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [messages]);

  async function ask(question) {
    if (!question.trim()) return;
    setMessages((m) => [...m, { from: "me", text: question }]);
    let reply;
    try {
      reply = await answer(question, ctx.current.history, ctx.current.integrity);
      refresh();
    } catch (e) {
      reply = `Désolé, une erreur est survenue : ${e.message}`;
    }
    setMessages((m) => [...m, { from: "bot", text: reply }]);
    speak(reply);
  }

  function listen() {
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.onresult = (e) => ask(e.results[0][0].transcript);
    rec.onerror = (e) => setMicError(`Micro : ${e.error}`);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setMicError("");
    setListening(true);
    rec.start();
  }

  return (
    <div className="assistant">
      <div className="log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation avec l'assistant">
        {messages.map((m, i) => <div key={i} className={`bubble bubble--${m.from}`}>{m.text}</div>)}
      </div>
      <div className="suggestions" aria-label="Questions suggérées">
        {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); setInput(""); }}>
        <button type="button" className={`mic ${listening ? "mic--listening" : ""}`} onClick={listen}
          disabled={!SpeechRecognition} aria-pressed={listening}
          aria-label={listening ? "Écoute en cours" : "Parler à l'assistant"}>
          {SpeechRecognition ? <Mic aria-hidden="true" size={24} /> : <MicOff aria-hidden="true" size={24} />}
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="…ou écrivez votre question"
          aria-label="Votre question" />
        <button className="send" aria-label="Envoyer"><SendHorizontal aria-hidden="true" size={20} /></button>
      </form>
      <div className="hint">
        {micError || (SpeechRecognition
          ? "Appuyez sur le micro et parlez en français."
          : "Reconnaissance vocale indisponible dans ce navigateur (Chrome ou Edge) : la saisie écrite fonctionne.")}
      </div>
    </div>
  );
}
