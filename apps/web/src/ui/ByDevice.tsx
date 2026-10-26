// Contenu qui dépend de l'appareil (lib/device.ts). Dans le navigateur : la variante de l'appareil réel.
// Au pré-rendu (HTML statique), l'appareil est inconnu : les deux variantes sont écrites et styles.css
// ([data-device]) affiche la bonne avec les MÊMES critères que detectDevice(). Le premier rendu de
// l'application montre donc exactement ce que le HTML affichait (aucun contenu qui change, aucun saut).
import type { ReactNode } from "react";
import { useDevice } from "../lib/hooks.ts";
import { usePrerender } from "../lib/prerender.ts";

/** `desktop` : pointeur fin qui survole, hors appareils tactiles d'Apple ; `touch` : tout le reste. */
export function ByDevice({ desktop, touch }: { desktop?: ReactNode; touch?: ReactNode }) {
  const device = useDevice();
  const prerender = usePrerender();
  if (!prerender) return <>{device.desktop ? desktop : touch}</>;
  return (
    <>
      {desktop && <div data-device="desktop">{desktop}</div>}
      {touch && <div data-device="touch">{touch}</div>}
    </>
  );
}

/** Seulement hors des appareils tactiles d'Apple (ex. : « ce raccourci nécessite un iPhone »). */
export function NotAppleTouch({ children }: { children: ReactNode }) {
  const device = useDevice();
  const prerender = usePrerender();
  if (!prerender) return device.appleTouch ? null : <>{children}</>;
  return <div data-device="not-apple-touch">{children}</div>;
}
