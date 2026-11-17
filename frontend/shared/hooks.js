import { useEffect, useEffectEvent, useRef, useState } from "react";

/** Exécute `task` à intervalle régulier, sans chevauchement d'appels.
 *  Par défaut, se met en pause quand l'onglet est masqué (reprise immédiate au retour) ;
 *  `background` maintient la boucle onglet masqué (alertes en temps réel). */
export function usePolling(task, intervalMs, enabled = true, { background = false } = {}) {
  const run = useEffectEvent(task);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    let running = false;
    let stopped = false;

    const tick = async () => {
      clearTimeout(timer);
      if (running || stopped || (!background && document.hidden)) return;
      running = true;
      try {
        await run();
      } catch (err) {
        console.error(err); // la tâche affiche ses propres erreurs ; on garde la boucle en vie
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(tick, intervalMs);
      }
    };
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : tick());

    if (!background) document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, background]);
}

/** Valeur numérique qui défile jusqu'à sa cible (compteurs d'indicateurs). */
export function useCountUp(target, durationMs = 900) {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : durationMs;
    const origin = current.current;
    const start = performance.now();
    let frame;
    const step = (now) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      current.current = Math.round(origin + (target - origin) * (1 - (1 - t) ** 3));
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
