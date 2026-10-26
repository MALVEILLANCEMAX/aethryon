// Chouette « Nocturne » : le dessin MAÎTRE du propriétaire (assets/brand/aethryon-master.svg), mêmes tracés au
// centième près (essai : lib/chouette.test.ts), éclairé en illusion de 3D. Rien n'est redessiné :
//  - relief : chaque surface garde sa couleur de référence, posée en dégradé (lumière en haut à gauche, ombre en bas à
//    droite) ; reflet spéculaire découpé DANS l'écusson (clipPath = le tracé de l'écusson) ; éclat doux autour des
//    reflets des yeux ;
//  - profondeur (≥ 72 px) : les tracés sont répartis sur 4 plans (écusson, faces, yeux, aigrettes et bec) dans le
//    même ordre de dessin ; une légère rotation 3D (perspective) les décale comme un vrai volume. Ombre portée douce,
//    halo et orbite discrète AUTOUR du dessin (jamais dessus).
// Mouvement : transform et opacity seulement, une seule boucle visible à la fois (respiration au repos, comète en
// chargement), réactions ponctuelles en WAAPI (réussite : petit saut, clin d'œil, balayage de lumière ; erreur :
// secousse amortie, halo terre cuite, regard baissé). Mouvement réduit ou présence « Muette » : dessin fixe, états
// lisibles par le halo et le regard. Aucun son, aucune bibliothèque 3D.
import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type Ref } from "react";
import { mouvementReduit } from "../lib/mouvement";

/** Tracés du dessin maître (copie exacte de aethryon-master.svg ; ordre de dessin d'origine). */
export const TRACES_CHOUETTE = {
  shell: "M8 23C8 10 20 7 32 7s24 3 24 16v15c0 12-13 17-24 23C21 55 8 50 8 38Z",
  faceLeft: "M32 28C22 13 9 14 8 30 6 48 21 47 32 57Z",
  faceRight: "M32 28C42 13 55 14 56 30 58 48 43 47 32 57Z",
  eyeLeft: "M13 26C23 24 28 29 28 37c-8 5-16 0-15-11Z",
  eyeRight: "M51 26C41 24 36 29 36 37c8 5 16 0 15-11Z",
  browLeft: "M32 39C26 21 8 24 3 5 12 15 26 11 32 26Z",
  browRight: "M32 39C38 21 56 24 61 5 52 15 38 11 32 26Z",
  browLine: "M4 7C13 20 25 16 32 31 39 16 51 20 60 7",
  beakLeft: "M32 36 27 42 32 51Z",
  beakRight: "M32 36 37 42 32 51Z",
} as const;
/** Reflets des yeux : cercles du dessin maître. */
export const REFLETS_CHOUETTE = [{ id: "glint-left", cx: 21, cy: 29, r: 1.8 }, { id: "glint-right", cx: 44, cy: 29, r: 1.8 }] as const;

/** Couleurs de référence (aethryon-master.svg) et leur éclairage : [clair, référence, ombre]. */
const RELIEF = {
  shell: ["#efe2cb", "#d7c2a5", "#9a7d56"],
  faceLeft: ["#ffffff", "#faf8f3", "#e2d6c3"],
  faceRight: ["#f8f2e7", "#f0e7d9", "#cdbca1"],
  eye: ["#2c2824", "#101010", "#040404"],
  brow: ["#f5e9d3", "#e8d5b7", "#c6aa7e"],
  beakLeft: ["#c0925d", "#ac8150", "#86602f"],
  beakRight: ["#ead6b1", "#dcc39b", "#c3a272"],
} as const;

type Plan = "ecusson" | "faces" | "yeux" | "avant";

/** Dégradés d'un plan (identifiants préfixés par instance : plusieurs chouettes peuvent coexister). */
function Degrades({ p, plans }: { p: string; plans: readonly Plan[] }) {
  const has = (x: Plan) => plans.includes(x);
  const lin = (id: string, c: readonly string[], x1 = "0.1", y1 = "0.05", x2 = "0.9", y2 = "0.95") => (
    <linearGradient id={`${p}${id}`} x1={x1} y1={y1} x2={x2} y2={y2}>
      <stop offset="0" stopColor={c[0]} /><stop offset="0.5" stopColor={c[1]} /><stop offset="1" stopColor={c[2]} />
    </linearGradient>
  );
  return (
    <defs>
      {has("ecusson") && (
        <>
          <radialGradient id={`${p}shell`} cx="0.36" cy="0.2" r="0.95" fx="0.32" fy="0.14">
            <stop offset="0" stopColor={RELIEF.shell[0]} /><stop offset="0.48" stopColor={RELIEF.shell[1]} /><stop offset="1" stopColor={RELIEF.shell[2]} />
          </radialGradient>
          <radialGradient id={`${p}spec`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fffaf0" stopOpacity="0.85" /><stop offset="0.55" stopColor="#fffaf0" stopOpacity="0.22" /><stop offset="1" stopColor="#fffaf0" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${p}clip`}><path d={TRACES_CHOUETTE.shell} /></clipPath>
        </>
      )}
      {has("faces") && <>{lin("fl", RELIEF.faceLeft)}{lin("fr", RELIEF.faceRight, "0.05", "0.1", "0.95", "0.9")}</>}
      {has("yeux") && (
        <>
          <radialGradient id={`${p}eye`} cx="0.4" cy="0.3" r="0.85"><stop offset="0" stopColor={RELIEF.eye[0]} /><stop offset="0.55" stopColor={RELIEF.eye[1]} /><stop offset="1" stopColor={RELIEF.eye[2]} /></radialGradient>
          <radialGradient id={`${p}bloom`} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#fffaf0" stopOpacity="0.42" /><stop offset="1" stopColor="#fffaf0" stopOpacity="0" /></radialGradient>
        </>
      )}
      {has("avant") && (
        <>
          {lin("bl", RELIEF.brow, "0", "0", "0.75", "1")}
          {lin("br", RELIEF.brow, "1", "0", "0.25", "1")}
          {lin("kl", RELIEF.beakLeft, "0.2", "0", "0.8", "1")}
          {lin("kr", RELIEF.beakRight, "0.2", "0", "0.8", "1")}
          <linearGradient id={`${p}line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f3e9d8" /><stop offset="0.5" stopColor="#ffffff" /><stop offset="1" stopColor="#e9dcc6" />
          </linearGradient>
        </>
      )}
    </defs>
  );
}

/** Tracés d'un plan, dans l'ordre de dessin du maître. */
function Traces({ p, plan }: { p: string; plan: Plan }) {
  const T = TRACES_CHOUETTE;
  if (plan === "ecusson") {
    return (
      <g>
        <path id="shell" d={T.shell} fill={`url(#${p}shell)`} />
        {/* Reflet spéculaire : lumière DANS l'écusson (découpée par son propre tracé). */}
        <g clipPath={`url(#${p}clip)`} className="ch-spec">
          <ellipse cx="22" cy="13" rx="13" ry="6.5" transform="rotate(-18 22 13)" fill={`url(#${p}spec)`} />
        </g>
      </g>
    );
  }
  if (plan === "faces") {
    return (
      <g>
        <path id="face-left" d={T.faceLeft} fill={`url(#${p}fl)`} />
        <path id="face-right" d={T.faceRight} fill={`url(#${p}fr)`} />
      </g>
    );
  }
  if (plan === "yeux") {
    return (
      <g id="eyes">
        <path id="eye-left" d={T.eyeLeft} fill={`url(#${p}eye)`} />
        <path id="eye-right" d={T.eyeRight} fill={`url(#${p}eye)`} />
        {REFLETS_CHOUETTE.map((r) => <circle key={`b${r.id}`} cx={r.cx} cy={r.cy} r={r.r * 2.1} fill={`url(#${p}bloom)`} />)}
        {REFLETS_CHOUETTE.map((r) => <circle key={r.id} id={r.id} cx={r.cx} cy={r.cy} r={r.r} fill="#faf8f3" />)}
      </g>
    );
  }
  return (
    <g>
      <path id="brow-left" d={T.browLeft} fill={`url(#${p}bl)`} />
      <path id="brow-right" d={T.browRight} fill={`url(#${p}br)`} />
      <path id="brow-line" d={T.browLine} fill="none" stroke={`url(#${p}line)`} strokeWidth="1.4" />
      <path id="beak-left" d={T.beakLeft} fill={`url(#${p}kl)`} />
      <path id="beak-right" d={T.beakRight} fill={`url(#${p}kr)`} />
    </g>
  );
}

const PLANS: readonly Plan[] = ["ecusson", "faces", "yeux", "avant"];

function usePrefixe(): string {
  return `ch${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;
}

/** Chouette éclairée, un seul SVG (barre latérale, niche, petites tailles ≥ 24 px). */
export function ChouetteRelief({ taille, refSvg, className, titre = "AETHRYON" }: { taille: number; refSvg?: Ref<SVGSVGElement>; className?: string; titre?: string | null }) {
  const p = usePrefixe();
  return (
    <svg ref={refSvg} className={`owl owl--relief${className ? ` ${className}` : ""}`} width={taille} height={taille} viewBox="0 0 64 64"
      role={titre ? "img" : undefined} aria-label={titre ?? undefined} aria-hidden={titre ? undefined : true}>
      <Degrades p={p} plans={PLANS} />
      <g id="aethryon-head">{PLANS.map((x) => <Traces key={x} p={p} plan={x} />)}</g>
    </svg>
  );
}

// ---- Chouette en profondeur ---------------------------------------------------------------------------------------

/** Apparence : repos, attention (curieuse, astuce), chargement, analyse, téléchargement, réussite, erreur. */
export type Apparence = "repos" | "attention" | "chargement" | "scan" | "telechargement" | "reussite" | "erreur";

/** Décalage des plans en profondeur, en fraction de la taille (écusson au fond, aigrettes et bec devant). */
const PROFONDEUR: Record<Plan, number> = { ecusson: 0, faces: 0.03, yeux: 0.045, avant: 0.07 };
/** Inclinaison maximale (degrés) quand la chouette suit le pointeur. */
const INCLINAISON = { x: 7, y: 9 } as const;

export interface PropsChouette3D {
  taille: number;
  apparence: Apparence;
  /** Animer (présence non « Muette » et mouvement non réduit) ; sinon, dessin fixe et états lisibles. */
  anime: boolean;
  /** Déclencheur de la réaction (réussite, erreur) : la rejouer seulement s'il change. */
  cle?: string;
  /** Progression RÉELLE (0 à 1) d'un téléchargement ; null = inconnue (comète). */
  progression?: number | null;
  /** Suivre le pointeur dans cet élément (inclinaison et regard), sinon dans la chouette elle-même. */
  zoneSuivi?: React.RefObject<HTMLElement>;
  /** Regard imposé (unités du dessin, ± 1,4 et ± 0,98), par ex. vers le champ « Coller un lien ». */
  regard?: { x: number; y: number } | null;
  /** Incrémenter pour un hochement de tête (lien reconnu) : réaction ponctuelle, rare. */
  hochement?: number;
  refRacine?: (el: HTMLElement | null) => void;
  className?: string;
  style?: CSSProperties;
}

/** Applique le regard (déplacement de #eyes, borné, transition CSS). */
export function poserRegard(racine: Element | null, dx: number, dy: number): void {
  const yeux = racine?.querySelector<SVGGElement>("#eyes");
  if (!yeux) return;
  const x = Math.max(-1.4, Math.min(1.4, dx));
  const y = Math.max(-0.98, Math.min(0.98, dy));
  yeux.style.transform = x || y ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` : "";
}

/** Inclinaison et regard vers un point de l'écran (une écriture par image, sans rendu React). */
export function viser(racine: HTMLElement, pivot: HTMLElement, px: number, py: number): void {
  const r = racine.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const portee = Math.max(240, r.width * 2.2);
  const nx = Math.max(-1, Math.min(1, (px - cx) / portee));
  const ny = Math.max(-1, Math.min(1, (py - cy) / portee));
  pivot.style.transform = `rotateX(${(-ny * INCLINAISON.x).toFixed(2)}deg) rotateY(${(nx * INCLINAISON.y).toFixed(2)}deg)`;
  poserRegard(racine, nx * 1.4, ny * 0.98);
}

/** Demi-orbite : ellipse inclinée (SVG, trait uniforme), arc de progression RÉELLE, comète des chargements. */
function Orbite({ cote, pct }: { cote: "arriere" | "avant"; pct: number | null }) {
  // Arc supérieur (derrière la tête) ou inférieur (devant) de l'ellipse rx 49, ry 12 (repère 100 × 40).
  const d = cote === "arriere" ? "M1 20A49 12 0 0 1 99 20" : "M1 20A49 12 0 0 0 99 20";
  // Longueur de chaque moitié = 50 (pathLength) ; la progression parcourt l'arrière (0 → 50 %) puis l'avant.
  const part = pct == null ? null : cote === "arriere" ? Math.min(1, pct * 2) : Math.max(0, pct * 2 - 1);
  return (
    <span className={`c3d-orbite c3d-orbite--${cote}`}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="c3d-anneau">
        <path d={d} pathLength={50} className="c3d-anneau-trait" />
        {part != null && part > 0.01 && <path d={d} pathLength={50} className="c3d-arc" strokeDasharray={`${(part * 50).toFixed(2)} 60`} transform={cote === "arriere" ? undefined : "matrix(-1 0 0 1 100 0)"} />}
      </svg>
      <span className="c3d-comete"><i /></span>
    </span>
  );
}

export function Chouette3D({ taille, apparence, anime, cle, progression = null, zoneSuivi, regard, hochement = 0, refRacine, className, style }: PropsChouette3D) {
  const p = usePrefixe();
  const racine = useRef<HTMLSpanElement>(null);
  const pivot = useRef<HTMLSpanElement>(null);
  const saut = useRef<HTMLSpanElement>(null);
  const lumiere = useRef<HTMLSpanElement>(null);
  const reduit = !anime || mouvementReduit();

  // Pause hors de la vue (défilement, autre section) : aucune boucle ne tourne pour rien.
  useEffect(() => {
    const el = racine.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const o = new IntersectionObserver(([e]) => { el.dataset.pause = e.isIntersecting ? "" : "1"; if (e.isIntersecting) delete el.dataset.pause; });
    o.observe(el);
    return () => o.disconnect();
  }, []);

  // Suivi du pointeur : inclinaison ± 7° / ± 9° et regard ; une écriture par image ; retour au centre en sortant.
  useEffect(() => {
    const el = racine.current;
    const pv = pivot.current;
    if (!el || !pv || reduit || !["repos", "attention"].includes(apparence) || regard) return;
    const zone = zoneSuivi?.current ?? el;
    let image: number | null = null;
    let dernier: { x: number; y: number } | null = null;
    const bouger = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      dernier = { x: e.clientX, y: e.clientY };
      if (image != null) return;
      image = requestAnimationFrame(() => { image = null; if (dernier) viser(el, pv, dernier.x, dernier.y); });
    };
    const sortir = () => { dernier = null; pv.style.transform = ""; poserRegard(el, 0, 0); };
    zone.addEventListener("pointermove", bouger, { passive: true });
    zone.addEventListener("pointerleave", sortir);
    return () => {
      zone.removeEventListener("pointermove", bouger);
      zone.removeEventListener("pointerleave", sortir);
      if (image != null) cancelAnimationFrame(image);
      sortir();
    };
  }, [reduit, apparence, zoneSuivi, regard]);

  // Regard imposé (champ « Coller un lien » au focus) : la tête se tourne légèrement vers lui.
  useLayoutEffect(() => {
    const el = racine.current;
    const pv = pivot.current;
    if (!el || !pv || !regard) return;
    poserRegard(el, regard.x, regard.y);
    if (!reduit) pv.style.transform = `rotateX(${(-regard.y * 3).toFixed(2)}deg) rotateY(${(regard.x * 4.5).toFixed(2)}deg)`;
    return () => { pv.style.transform = ""; poserRegard(el, 0, 0); };
  }, [regard?.x, regard?.y, reduit]);

  // Regard baissé pendant un téléchargement et après une erreur (lisible aussi en mouvement réduit).
  useLayoutEffect(() => {
    if (regard) return;
    if (apparence === "telechargement") poserRegard(racine.current, 0, 0.9);
    else if (apparence === "erreur") poserRegard(racine.current, 0, 0.98);
    else if (apparence !== "repos" && apparence !== "attention") poserRegard(racine.current, 0, 0);
  }, [apparence, regard]);

  // Réactions ponctuelles (WAAPI, interruptibles) : réussite et erreur sont DISTINCTES.
  useEffect(() => {
    if (reduit || !cle) return;
    const s = saut.current;
    const l = lumiere.current;
    if (!s || typeof s.animate !== "function") return;
    const anims: Animation[] = [];
    if (apparence === "reussite") {
      // Petit saut en ressort (montée vive, retombée amortie), balayage de lumière sur l'écusson, clin d'œil.
      anims.push(s.animate([
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-6%) scale(1.03)", offset: 0.32 },
        { transform: "translateY(1%) scale(0.995)", offset: 0.62 },
        { transform: "translateY(0) scale(1)" },
      ], { duration: 620, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }));
      if (l) anims.push(l.animate([{ transform: "translateX(-70%) skewX(-16deg)", opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { transform: "translateX(70%) skewX(-16deg)", opacity: 0 }], { duration: 760, easing: "cubic-bezier(0.77, 0, 0.175, 1)" }));
      racine.current?.classList.remove("cligne");
      void racine.current?.getBoundingClientRect();
      racine.current?.classList.add("cligne");
      const t = window.setTimeout(() => racine.current?.classList.remove("cligne"), 260);
      return () => { window.clearTimeout(t); anims.forEach((a) => a.cancel()); };
    }
    if (apparence === "erreur") {
      // Secousse amortie (non, de la tête), courte : 460 ms.
      anims.push(s.animate([
        { transform: "rotate(0deg)" }, { transform: "rotate(-5deg)", offset: 0.18 }, { transform: "rotate(4deg)", offset: 0.4 },
        { transform: "rotate(-2.2deg)", offset: 0.62 }, { transform: "rotate(1deg)", offset: 0.82 }, { transform: "rotate(0deg)" },
      ], { duration: 460, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }));
      return () => anims.forEach((a) => a.cancel());
    }
  }, [cle, apparence, reduit]);

  // Hochement (« compris ») : 520 ms, rotation sur X autour du menton ; jamais en mouvement réduit.
  useEffect(() => {
    const s = saut.current;
    if (!hochement || reduit || !s || typeof s.animate !== "function") return;
    const a = s.animate([
      { transform: "rotateX(0deg)" }, { transform: "rotateX(14deg)", offset: 0.3 }, { transform: "rotateX(-4deg)", offset: 0.62 }, { transform: "rotateX(0deg)" },
    ], { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    return () => a.cancel();
  }, [hochement, reduit]);

  const lier = (el: HTMLSpanElement | null) => {
    (racine as { current: HTMLSpanElement | null }).current = el;
    refRacine?.(el);
  };
  const pct = progression != null ? Math.max(0, Math.min(1, progression)) : null;
  const boucle = apparence === "repos" ? "souffle" : apparence === "chargement" || apparence === "scan" || (apparence === "telechargement" && pct == null) ? "comete" : "aucune";

  return (
    <span ref={lier} className={`c3d${className ? ` ${className}` : ""}`} data-apparence={apparence} data-boucle={reduit ? "aucune" : boucle}
      data-anime={reduit ? undefined : ""} aria-hidden="true"
      style={{ ...style, width: taille, height: taille, ["--t" as string]: `${taille}px`, ["--p" as string]: pct ?? 0 }}>
      <span className="c3d-ombre" />
      <span className="c3d-halo" />
      <span className="c3d-halo c3d-halo--erreur" />
      {/* Orbite : moitié arrière sous le dessin, moitié avant par-dessus (illusion d'un anneau qui l'entoure). */}
      <Orbite cote="arriere" pct={pct} />
      <span className="c3d-souffle">
        <span className="c3d-saut" ref={saut}>
          <span className="c3d-pivot" ref={pivot}>
            {PLANS.map((plan) => (
              <svg key={plan} className={`c3d-plan c3d-plan--${plan}`} viewBox="0 0 64 64" width={taille} height={taille}
                style={{ transform: `translateZ(${(PROFONDEUR[plan] * taille).toFixed(1)}px)` }}>
                <Degrades p={`${p}${plan}`} plans={[plan]} />
                <Traces p={`${p}${plan}`} plan={plan} />
              </svg>
            ))}
            <span className="c3d-balayage"><span ref={lumiere} /></span>
          </span>
        </span>
      </span>
      <Orbite cote="avant" pct={pct} />
    </span>
  );
}
