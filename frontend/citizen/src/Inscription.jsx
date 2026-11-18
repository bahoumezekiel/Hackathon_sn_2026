import { useEffect, useId, useState } from "react";
import { Screen, Spinner } from "@fasolink/shared/ui";
import { signup } from "./api";

const PORTAL = "Espace citoyen";
const MIN_PASSWORD = 10; // même règle que la passerelle

/** Étape 1 : IUE et date de naissance, vérifiés auprès du registre de l'identifiant unique. */
function IdentityStep({ onSent }) {
  const ids = useId();
  const [iue, setIue] = useState("");
  const [birth, setBirth] = useState("");
  const [demo, setDemo] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    signup.demo().then((d) => setDemo(d?.citizens?.filter((c) => c.iue && !c.has_account && !c.sans_web) ?? []));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const id = iue.replace(/\s/g, "");
      onSent({ iue: id, ...(await signup.start(id, birth)) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="signup-form" onSubmit={submit}>
      <p>
        Saisissez votre identifiant unique électronique (IUE), le numéro à 12 chiffres reçu lors de votre
        enrôlement, et votre date de naissance. FasoLink les vérifie auprès du registre de l'identifiant unique,
        puis envoie un code au téléphone que vous y avez déclaré.
      </p>
      <div className="field">
        <label className="label" htmlFor={`${ids}-iue`}>Identifiant unique électronique (IUE)</label>
        <input id={`${ids}-iue`} className="input mono" value={iue} onChange={(e) => setIue(e.target.value.replace(/[^\d ]/g, ""))} placeholder="Ex. 128475906331" inputMode="numeric" autoComplete="username" spellCheck={false} maxLength={15} required />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-birth`}>Date de naissance</label>
        <input id={`${ids}-birth`} className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} required max={new Date().toISOString().slice(0, 10)} />
      </div>
      {demo.length > 0 && (
        <div className="quick-pick">
          <p className="hint">Démonstration : usagers sans compte</p>
          <div className="chips">
            {demo.map((c) => (
              <button key={c.iue} type="button" className="chip" aria-pressed={iue === c.iue} onClick={() => { setIue(c.iue); setBirth(c.birth_date ?? ""); setError(""); }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? <><Spinner /> Vérification de l'IUE…</> : "Vérifier mon IUE"}
      </button>
    </form>
  );
}

/** Étape 2 : code reçu par SMS et choix du mot de passe. */
function CodeStep({ pending, onDone, onRestart }) {
  const ids = useId();
  const [code, setCode] = useState(pending.demo_code ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    if (password.length < MIN_PASSWORD || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return setError(`Au moins ${MIN_PASSWORD} caractères, dont des lettres et des chiffres.`);
    }
    setError("");
    setBusy(true);
    try {
      onDone(await signup.confirm(pending.token, code.trim(), password));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <form className="signup-form" onSubmit={submit}>
      <p>
        IUE <strong className="mono">{pending.iue}</strong> vérifié. Un code à 6 chiffres a été envoyé au{" "}
        <strong>{pending.telephone}</strong>. Il est valable {Math.round(pending.expires_in / 60)} minutes.
      </p>
      {pending.demo_code && (
        <p className="notice notice-info">Démonstration : pas d'envoi de SMS réel. Code reçu : <strong className="mono">{pending.demo_code}</strong></p>
      )}
      <div className="field">
        <label className="label" htmlFor={`${ids}-code`}>Code reçu par SMS</label>
        <input id={`${ids}-code`} className="input mono signup-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-pw`}>Mot de passe</label>
        <input id={`${ids}-pw`} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={MIN_PASSWORD} />
        <p className="hint">Au moins {MIN_PASSWORD} caractères, dont des lettres et des chiffres.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-pw2`}>Confirmer le mot de passe</label>
        <input id={`${ids}-pw2`} className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </div>
      {error && <p className="notice notice-danger" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? <><Spinner /> Création du compte…</> : "Créer mon compte"}
      </button>
      <button type="button" className="btn btn-quiet btn-block" onClick={onRestart}>Recommencer</button>
    </form>
  );
}

export default function Inscription() {
  const [pending, setPending] = useState(null);
  const [account, setAccount] = useState(null);

  if (account) {
    return (
      <Screen portal={PORTAL} title="Compte créé">
        <p>
          Bienvenue, <strong>{account.name}</strong>. Connectez-vous avec votre IUE (
          <strong className="mono">{account.username}</strong>) et le mot de passe que vous venez de
          choisir : vous verrez qui consulte vos données, et pourquoi.
        </p>
        <div className="screen-actions">
          <a className="btn btn-primary" href="/">Se connecter</a>
        </div>
      </Screen>
    );
  }

  return (
    <Screen portal={PORTAL} title="Créer mon compte citoyen">
      <ol className="signup-steps" aria-label="Étapes">
        <li aria-current={!pending ? "step" : undefined}>Vérification de l'IUE</li>
        <li aria-current={pending ? "step" : undefined}>Code et mot de passe</li>
      </ol>
      {pending
        ? <CodeStep pending={pending} onDone={setAccount} onRestart={() => setPending(null)} />
        : <IdentityStep onSent={setPending} />}
      <p className="signup-login">Déjà inscrit ? <a href="/">Se connecter</a></p>
    </Screen>
  );
}
