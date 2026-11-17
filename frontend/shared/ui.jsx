import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig } from "motion/react";
import logo from "./img/logo.webp";

// Moteur d'animation chargé à part, après le premier rendu
const loadMotionFeatures = () => import("./motion-features.js").then((mod) => mod.default);

/** Courbe d'animation commune (sortie douce, sans rebond). */
const EASE_OUT = [0.22, 1, 0.36, 1];

/** Pictogrammes au trait (tracés Lucide, licence ISC), sans police d'icônes ni dépendance. */
const ICONS = {
  "user-search": <><circle cx="10" cy="7" r="4" /><path d="M10.3 15H7a4 4 0 0 0-4 4v2" /><circle cx="17" cy="17" r="3" /><path d="m21 21-1.9-1.9" /></>,
  "list-checks": <><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>,
  "shield-check": <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>,
  "eye-off": <><path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49" /><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" /><path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" /><path d="m2 2 20 20" /></>,
  "folder-check": <><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><path d="m9 13 2 2 4-4" /></>,
  "file-check": <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m9 15 2 2 4-4" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  bell: <><path d="M10.27 21a2 2 0 0 0 3.46 0" /><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
};

export function Icon({ name, className = "icon" }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[name]}</svg>;
}

function Brand({ portal }) {
  return (
    <span className="brand">
      <img className="brand-logo" src={logo} width="150" height="80" alt="" />
      <span className="brand-text">
        <span className="brand-name">FasoLink</span>
        {portal && <span className="brand-portal">{portal}</span>}
      </span>
    </span>
  );
}

const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function TopBar({ portal, session, actions }) {
  const { name } = session.user();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand portal={portal} />
        <div className="topbar-user">
          {actions}
          <span className="topbar-who">
            <span className="topbar-initials" aria-hidden="true">{initials(name)}</span>
            <span className="topbar-name">{name}</span>
          </span>
          <button type="button" className="btn btn-secondary" onClick={session.logout}>Se déconnecter</button>
        </div>
      </div>
    </header>
  );
}

/** Bandeau d'en-tête vert au monument, fermé par la vague rouge du drapeau. */
export function PageHero({ eyebrow, title, titleId, lead, aside, compact = false }) {
  return (
    <section className={`hero-band${compact ? " is-compact" : ""}`} aria-labelledby={titleId}>
      <div className="hero-inner">
        <div className="hero-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id={titleId}>{title}</h1>
          {lead && <p className="hero-lead">{lead}</p>}
        </div>
        {aside && <div className="hero-aside">{aside}</div>}
      </div>
      <svg className="ribbon" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
        <path className="ribbon-red" d="M0 10C420 52 980 50 1440 30V38C980 58 420 62 0 30Z" />
        <path className="ribbon-paper" d="M0 30C420 62 980 58 1440 38V61H0Z" />
      </svg>
    </section>
  );
}

export function Footer({ portal }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand portal={portal} />
          <p className="footer-about">
            Plateforme d'interopérabilité des administrations publiques du Burkina Faso : les informations
            circulent entre services, l'usager n'a plus à fournir les pièces que l'État détient déjà.
          </p>
        </div>
        <div>
          <p className="footer-title">Principes</p>
          <ul className="footer-list">
            <li>Dites-le-nous une fois</li>
            <li>Seule la réponse utile est transmise</li>
            <li>Chaque consultation est tracée</li>
          </ul>
        </div>
        <div>
          <p className="footer-title">Garanties</p>
          <ul className="footer-list">
            <li>Attestations signées et datées</li>
            <li>Journal d'audit infalsifiable</li>
            <li>Service maintenu en cas de panne</li>
          </ul>
        </div>
      </div>
      <p className="footer-legal">© {new Date().getFullYear()} FasoLink · Interopérabilité des administrations publiques</p>
    </footer>
  );
}

export function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Indicateur décoratif : il accompagne toujours un texte qui porte l'information. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function Screen({ portal, title, children }) {
  return (
    <main className="screen">
      <div className="screen-card">
        <Brand portal={portal} />
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Démarre un portail : connexion Keycloak, contrôle du rôle, puis rendu de l'application. */
export function mountPortal({ session, role, roleLabel, portal, App }) {
  const root = createRoot(document.getElementById("root"));
  const render = (node) =>
    root.render(
      <StrictMode>
        <LazyMotion features={loadMotionFeatures} strict>
          <MotionConfig reducedMotion="user" transition={{ duration: 0.45, ease: EASE_OUT }}>
            {node}
          </MotionConfig>
        </LazyMotion>
      </StrictMode>,
    );

  session
    .init()
    .then(() => {
      if (session.hasRole(role)) return render(<App />);
      return render(
        <Screen portal={portal} title="Accès réservé">
          <p>
            Ce portail est réservé {roleLabel}. Vous êtes connecté avec le compte{" "}
            <strong>{session.user().username}</strong>.
          </p>
          <div className="screen-actions">
            <button type="button" className="btn btn-primary" onClick={session.switchAccount}>Changer de compte</button>
            <button type="button" className="btn btn-secondary" onClick={session.logout}>Se déconnecter</button>
          </div>
        </Screen>,
      );
    })
    .catch(() =>
      render(
        <Screen portal={portal} title="Connexion impossible">
          <p>Le service d'authentification ne répond pas. Vérifiez que la plateforme est démarrée, puis réessayez.</p>
          <div className="screen-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Réessayer</button>
          </div>
        </Screen>,
      ),
    );
}
