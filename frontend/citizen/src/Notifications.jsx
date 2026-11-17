import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { purposeLabel, requestState, timeAgo } from "@fasolink/shared/format";
import { Badge, Icon } from "@fasolink/shared/ui";

const TOAST_MS = 9000;
const SUPPORTED = typeof Notification !== "undefined";

// Date de la dernière consultation lue, mémorisée sur cet appareil uniquement
function readSeen(key) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function writeSeen(key, iso) {
  try { localStorage.setItem(key, iso); } catch { /* stockage indisponible : le compteur repart à chaque visite */ }
}

const summary = (a) => `${a.administration} · ${purposeLabel(a.purpose_code)}`;

/** Alertes de consultation : non lues depuis la dernière visite, et notification pour chaque nouvelle. */
export function useAccessAlerts(userKey) {
  const storageKey = `fasolink:vu:${userKey}`;
  const [seenAt, setSeenAt] = useState(() => readSeen(storageKey));
  const [toasts, setToasts] = useState([]);
  const [permission, setPermission] = useState(SUPPORTED ? Notification.permission : "unsupported");
  const known = useRef(null); // consultations déjà connues ; null avant le premier chargement

  /** Appelé à chaque rafraîchissement de l'historique. */
  function track(accesses) {
    if (known.current === null) {
      known.current = new Set(accesses.map((a) => a.id));
      return;
    }
    const fresh = accesses.filter((a) => !known.current.has(a.id));
    if (!fresh.length) return;
    for (const a of fresh) known.current.add(a.id);
    setToasts((list) => [...fresh, ...list].slice(0, 3));
    // Onglet en arrière-plan : notification du système, si le citoyen l'a autorisée
    if (SUPPORTED && Notification.permission === "granted" && document.hidden) {
      for (const a of fresh) {
        const n = new Notification("Consultation de vos données", { body: summary(a), icon: "/favicon.png", tag: a.id });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }
  }

  function markRead(accesses) {
    const newest = accesses[0]?.created_at;
    if (!newest || newest <= seenAt) return;
    setSeenAt(newest);
    writeSeen(storageKey, newest);
  }

  async function enableDevice() {
    setPermission(await Notification.requestPermission());
  }

  const dismiss = (id) => setToasts((list) => list.filter((a) => a.id !== id));

  return { seenAt, toasts, permission, track, markRead, enableDevice, dismiss };
}

const DEVICE_STATUS = {
  granted: "Alertes activées sur cet appareil, même onglet fermé en arrière-plan.",
  denied: "Alertes bloquées par le navigateur : autorisez-les dans les réglages du site.",
  unsupported: "Ce navigateur ne permet pas les alertes de l'appareil.",
};

export function AlertBell({ alerts, accesses, onSelect }) {
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState(""); // repère « nouveau » figé à l'ouverture du panneau
  const root = useRef(null);
  const list = accesses ?? [];
  const unread = list.filter((a) => a.created_at > alerts.seenAt).length;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onClick = (e) => !root.current?.contains(e.target) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onClick);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      setSince(alerts.seenAt);
      alerts.markRead(list);
    }
    setOpen((v) => !v);
  }

  return (
    <div className="bell-wrap" ref={root}>
      <button
        type="button"
        className={`bell${unread ? " has-unread" : ""}`}
        aria-expanded={open}
        aria-controls="alert-panel"
        aria-label={unread ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
        onClick={toggle}
      >
        <Icon name="bell" />
        <AnimatePresence>
          {unread > 0 && (
            <m.span key={unread} className="bell-count" initial={{ scale: 0.4 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              {unread > 9 ? "9+" : unread}
            </m.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            id="alert-panel"
            className="alert-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <p className="alert-panel-title">Consultations de vos données</p>
            {list.length === 0 ? (
              <p className="alert-panel-empty">Aucune consultation pour le moment.</p>
            ) : (
              <ul className="alert-panel-list">
                {list.slice(0, 6).map((a) => {
                  const state = requestState(a);
                  return (
                    <li key={a.id}>
                      <button type="button" onClick={() => { setOpen(false); onSelect(a.id); }}>
                        {a.created_at > since && <span className="new-dot" aria-label="Nouveau" />}
                        <span className="alert-panel-text">
                          <strong>{a.administration}</strong>
                          <span>{purposeLabel(a.purpose_code)} · {timeAgo(a.created_at)}</span>
                        </span>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="alert-panel-device">
              {alerts.permission === "default" ? (
                <button type="button" className="btn btn-secondary btn-block" onClick={alerts.enableDevice}>
                  Recevoir les alertes sur cet appareil
                </button>
              ) : (
                <p>{DEVICE_STATUS[alerts.permission]}</p>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Toast({ access, onSelect, onDismiss }) {
  const state = requestState(access);

  // Fermeture automatique : le délai ne repart pas à chaque rafraîchissement de la page
  const close = useEffectEvent(onDismiss);
  useEffect(() => {
    const timer = setTimeout(() => close(), TOAST_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <m.div
      layout
      className={`toast tone-${state.tone}`}
      initial={{ opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 48, transition: { duration: 0.2 } }}
    >
      <span className="toast-icon"><Icon name="bell" /></span>
      <div className="toast-body">
        <p className="toast-title">Nouvelle consultation de vos données</p>
        <p className="toast-text">{summary(access)}</p>
        <div className="toast-foot">
          <Badge tone={state.tone}>{state.label}</Badge>
          <button type="button" className="btn btn-quiet" onClick={() => { onSelect(access.id); onDismiss(); }}>Voir le détail</button>
        </div>
      </div>
      <button type="button" className="toast-close" aria-label="Fermer la notification" onClick={onDismiss}>
        <Icon name="x" />
      </button>
    </m.div>
  );
}

export function Toasts({ alerts, onSelect }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {alerts.toasts.map((a) => (
          <Toast key={a.id} access={a} onSelect={onSelect} onDismiss={() => alerts.dismiss(a.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
