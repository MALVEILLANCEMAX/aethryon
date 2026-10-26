// Tête maître d'AETHRYON : le logo du propriétaire (brand/master/aethryon-master.svg), tracés et couleurs
// d'origine générés dans head.ts. UNE seule tête pour tout le site : logo, héros, mascotte, Control Center.
// - surface="light" (par défaut) : liseré champagne de 0,45 unité le long de l'écusson, validé pour les
//   fonds clairs (sinon la joue ivoire se fond dans le fond) ; surface="dark" : dessin strictement identique.
// - jusqu'à 24 px : petit logo (corrections optiques validées : yeux +6 %, reflets alignés sur la grille de
//   16 px, ligne du front retirée).
// - pad : marge intérieure en unités (la mascotte réserve de la place pour s'incliner ou rebondir).
// Les yeux sont de vrais éléments séparés : clignement (70 ms fermeture, 35 ms pause, 100 ms ouverture,
// toutes les 4 à 7 s), clin d'œil sur événement réel (wink) et regard qui suit le pointeur (follow) ou une
// cible (look) sont d'authentiques mouvements, jamais une déformation de la silhouette. Décorative
// (aria-hidden) ; en pause hors écran, onglet masqué, ou si l'utilisateur réduit les animations.
import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { HEAD, RIM, SMALL } from "./head.ts";

interface Props {
  size?: number;
  /** Clignement naturel occasionnel (4 à 7 s). */
  blink?: boolean;
  /** Les yeux suivent discrètement le pointeur (souris uniquement). */
  follow?: boolean;
  /** Direction du regard imposée (x et y entre -1 et 1), prioritaire sur `follow` : la chouette regarde
   *  une cible de l'interface (ex. l'onglet choisi). Même amplitude que le suivi du pointeur. */
  look?: { x: number; y: number } | null;
  /** Clignement unique, en réponse à un vrai événement : chaque nouvelle valeur non nulle déclenche un
   *  clignement (aucun en mouvement réduit). */
  wink?: number;
  /** Fond sur lequel la tête est posée : clair (liseré champagne) ou sombre (dessin identique au maître). */
  surface?: "light" | "dark";
  /** Marge intérieure, en unités de la grille de 64 (0 : la tête occupe tout le carré). */
  pad?: number;
  className?: string;
}

export function OwlMark({ size = 28, blink = false, follow = false, look = null, wink = 0, surface = "light", pad = 0, className }: Props) {
  const calm = useReducedMotion() ?? false;
  const root = useRef<SVGSVGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const [blinking, setBlinking] = useState(false);
  const rim = `owl-rim-${useId().replace(/[^\w-]/g, "")}`;
  // Taille réelle de la tête (sans la marge) : c'est elle qui décide du petit logo.
  const small = size * (64 / (64 + 2 * pad)) <= SMALL.maxPx;

  // Clignement unique demandé par la page (ex. première conversion détectée), après un court temps de pose.
  useEffect(() => {
    if (!wink || calm) return;
    let end = 0;
    const start = window.setTimeout(() => {
      setBlinking(true);
      end = window.setTimeout(() => setBlinking(false), 240);
    }, 650);
    return () => { window.clearTimeout(start); window.clearTimeout(end); };
  }, [wink, calm]);

  // Clignement : seulement visible à l'écran et onglet actif.
  useEffect(() => {
    if (!blink || calm) return;
    const el = root.current;
    let onScreen = true;
    let timer = 0;
    const io = typeof IntersectionObserver === "undefined" || !el ? null : new IntersectionObserver(([e]) => { onScreen = !!e?.isIntersecting; });
    if (el) io?.observe(el);
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (onScreen && !document.hidden) {
          setBlinking(true);
          window.setTimeout(() => setBlinking(false), 240);
        }
        schedule();
      }, 4000 + Math.random() * 3000);
    };
    schedule();
    return () => { window.clearTimeout(timer); io?.disconnect(); };
  }, [blink, calm]);

  // Regard imposé : appliqué directement (transition CSS de .owl-eyes), sans dépendre du pointeur.
  const hasLook = look !== null;
  const lx = look ? Math.max(-1, Math.min(1, look.x)) : null;
  const ly = look ? Math.max(-1, Math.min(1, look.y)) : null;
  useEffect(() => {
    const g = eyes.current;
    if (!g) return;
    if (lx === null || ly === null) { if (!follow) g.style.translate = ""; return; }
    g.style.translate = calm ? "" : `${(lx * 1.4).toFixed(2)}px ${(ly * 1.4 * 0.7).toFixed(2)}px`;
  }, [lx, ly, calm, follow]);

  // Regard : décalage de 1,4 unité au plus (sur 64), vers le pointeur.
  useEffect(() => {
    if (!follow || hasLook || calm || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const svg = root.current, g = eyes.current;
        if (!svg || !g) return;
        const r = svg.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 320) * 1.4;
        g.style.translate = `${((dx / d) * k).toFixed(2)}px ${((dy / d) * k * 0.7).toFixed(2)}px`;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); if (frame) window.cancelAnimationFrame(frame); };
  }, [follow, hasLook, calm]);

  const light = surface === "light";
  const [elx, ely] = SMALL.eyeLeftCenter;
  const [erx, ery] = SMALL.eyeRightCenter;
  const k = SMALL.eyeScale;
  return (
    <svg
      ref={root}
      viewBox={`${-pad} ${-pad} ${64 + 2 * pad} ${64 + 2 * pad}`}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("owl-mark shrink-0", className)}
      data-blink={blinking || undefined}
      data-surface={surface}
      data-small={small || undefined}
    >
      {light && (
        <defs>
          <mask id={rim} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
            <path d={HEAD.shell.d} fill="#fff" />
            <path d={HEAD.shell.d} fill="none" stroke="#000" strokeWidth={RIM * 2} />
          </mask>
        </defs>
      )}
      <g className="owl-head">
        <path d={HEAD.shell.d} fill={HEAD.shell.fill} />
        <g mask={light ? `url(#${rim})` : undefined}>
          <path d={HEAD.faceLeft.d} fill={HEAD.faceLeft.fill} />
          <path d={HEAD.faceRight.d} fill={HEAD.faceRight.fill} />
        </g>
        <g ref={eyes} className="owl-eyes">
          {small ? (
            <>
              <path d={HEAD.eyeLeft.d} fill={HEAD.eyeLeft.fill} transform={`translate(${elx} ${ely}) scale(${k}) translate(${-elx} ${-ely})`} />
              <path d={HEAD.eyeRight.d} fill={HEAD.eyeRight.fill} transform={`translate(${erx} ${ery}) scale(${k}) translate(${-erx} ${-ery})`} />
              <rect {...SMALL.glintLeft} fill={HEAD.glintLeft.fill} />
              <rect {...SMALL.glintRight} fill={HEAD.glintRight.fill} />
            </>
          ) : (
            <>
              <path d={HEAD.eyeLeft.d} fill={HEAD.eyeLeft.fill} />
              <path d={HEAD.eyeRight.d} fill={HEAD.eyeRight.fill} />
              <circle cx={HEAD.glintLeft.cx} cy={HEAD.glintLeft.cy} r={HEAD.glintLeft.r} fill={HEAD.glintLeft.fill} />
              <circle cx={HEAD.glintRight.cx} cy={HEAD.glintRight.cy} r={HEAD.glintRight.r} fill={HEAD.glintRight.fill} />
            </>
          )}
        </g>
        <path d={HEAD.browLeft.d} fill={HEAD.browLeft.fill} />
        <path d={HEAD.browRight.d} fill={HEAD.browRight.fill} />
        {!small && <path d={HEAD.browLine.d} stroke={HEAD.browLine.stroke} strokeWidth={HEAD.browLine.strokeWidth} />}
        <path d={HEAD.beakLeft.d} fill={HEAD.beakLeft.fill} />
        <path d={HEAD.beakRight.d} fill={HEAD.beakRight.fill} />
      </g>
    </svg>
  );
}
