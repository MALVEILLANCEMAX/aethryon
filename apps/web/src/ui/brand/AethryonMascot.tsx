// Mascotte AETHRYON : la tête maître elle-même (OwlMark, tracés du logo), animée par ses propres éléments,
// regard, clignement, inclinaison, respiration, petit rebond. Aucune autre tête, aucune image.
//
// États, décidés par l'application à partir d'événements RÉELS (job, réponse de l'API), jamais d'un minuteur :
//   idle        respiration lente, clignement occasionnel, regard qui suit le pointeur (souris) ;
//   curious     tête inclinée vers `look`, regard levé de ce côté ;
//   processing  le regard balaie lentement de gauche à droite (concentration), sans clignement ;
//   success     clin d'œil et petit rebond, rejoués à chaque nouvelle valeur de `replayKey` ;
//   error       regard baissé, inclinaison interrogative.
// Carré réservé par les attributs width/height du SVG (aucun style en ligne), plafonné à 100 % du parent ;
// la tête occupe 72 % du carré (place pour s'incliner et rebondir). En pause hors écran et onglet masqué ;
// immobile si l'utilisateur réduit les animations. Décorative par défaut : le statut doit être donné en texte.
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { OwlMark } from "./OwlMark.tsx";

export type MascotState = "idle" | "curious" | "processing" | "success" | "error";
export type MascotPose = "three-quarter" | "front" | "profile";

/** Marge intérieure (unités) : 64 / (64 + 2 × 12,4) ≈ 72 % du carré pour la tête. */
const PAD = 12.4;

function lookOf(state: MascotState, side: -1 | 1, pose: MascotPose): { x: number; y: number } | null {
  if (state === "curious") return { x: 0.6 * side, y: -0.7 };
  if (state === "success") return { x: 0, y: -0.35 };
  if (state === "error") return { x: 0.25 * side, y: 0.9 };
  if (pose === "profile") return { x: side, y: -0.1 };
  if (pose === "front") return { x: 0, y: 0.2 };
  return null;
}

interface Props {
  state?: MascotState;
  /** Côté du carré réservé, en px (plafonné à 100 % du parent). */
  size?: number;
  /** Nom accessible ; vide = décorative (masquée aux lecteurs d'écran). */
  label?: string;
  className?: string;
  /** Conservé pour compatibilité (anciennes images) : sans objet en vectoriel. */
  priority?: boolean;
  paused?: boolean;
  /** Incrémenter pour rejouer « success » avec le même état. */
  replayKey?: string | number;
  /** Côté vers lequel la chouette s'incline et regarde : -1 à gauche, 1 à droite. */
  look?: -1 | 1;
  /** Petite instance immobile (aucune animation, aucun suivi du pointeur). */
  still?: boolean;
  /** Direction du regard des instances immobiles : repos, vers le visiteur ou vers le côté. */
  pose?: MascotPose;
}

export function AethryonMascot({
  state = "idle", size = 256, label = "", className, paused = false,
  replayKey = 0, look = -1, still = false, pose = "three-quarter",
}: Props) {
  const root = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    if (still) return;
    const el = root.current;
    const vis = () => setTabVisible(!document.hidden);
    vis();
    document.addEventListener("visibilitychange", vis);
    const io = typeof IntersectionObserver === "undefined" || !el ? null
      : new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { threshold: 0.01 });
    if (el) io?.observe(el);
    return () => { io?.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, [still]);

  const live = !still && !paused && onScreen && tabVisible;
  return (
    <span
      ref={root}
      className={cn("mascot-owl", className)}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-state={still ? "still" : state}
      data-look={look}
      data-paused={!live || undefined}
    >
      <span className="mascot-owl-motion" key={state === "success" ? `s-${replayKey}` : "m"}>
        <OwlMark
          size={size}
          pad={PAD}
          blink={live && (state === "idle" || state === "curious")}
          follow={live && state === "idle" && pose === "three-quarter"}
          look={lookOf(state, look, pose)}
          wink={live && state === "success" ? Number(replayKey) || 1 : 0}
          className="mascot-owl-svg"
        />
      </span>
    </span>
  );
}
