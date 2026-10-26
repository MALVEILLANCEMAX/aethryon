// Chouette d'Athéna vectorielle — SOURCE UNIQUE de sa géométrie (proposition, docs/DESIGN-SYSTEM.md §3).
// Utilisée par le composant React (AthenaOwl.tsx) ET par scripts/export-owl-svgs.mjs, qui écrit les
// fichiers de brand/aethryon-vector/ : le site et les SVG livrés ne peuvent pas diverger.
//
// Principe : un « rig » 2,5D qui ne bouge QUE par transform et opacity.
//  - Tout est dessiné de face dans un carré de 400 × 400 (viewBox), en tracés simples (M, L, C, A, Z),
//    cercles et ellipses ; couleurs : uniquement la palette de la planche et ses teintes dérivées
//    (design/tokens.ts, objet `owl`).
//  - La tête est faite de PLANS : deux disques faciaux inclinés de ±LOBE° de part et d'autre de l'arête
//    du bec, le bec un peu en avant, le crâne en ellipsoïde. Tourner la tête (lacet, tangage) revient à
//    une matrice affine par plan : c'est la projection orthographique exacte d'un plan, pas une
//    déformation. Incliner la tête = rotation autour du cou.
//  - Yeux : iris et pupille glissent dans l'orbite (découpe), paupières couleur du disque qui descendent
//    et montent (découpe), pommettes qui remontent (yeux rieurs), aigrettes qui pivotent à leur base,
//    aile proche qui se soulève, respiration et petit saut du corps entier.
//  - Le corps a trois poses dessinées (trois quarts, face, côté) avec les mêmes pièces et les mêmes noms.
// Module pur : aucune dépendance à React ni au DOM.
import { owl as C } from "../../../design/tokens.ts";

export const SIZE = 400;
export const PALETTE = C;

// ================================================================================================
// Types
// ================================================================================================
export type Expression = "neutral" | "curious" | "content" | "closed" | "focused" | "success" | "concerned" | "welcome";
export type Pose = "three-quarter" | "front" | "side";
export const EXPRESSIONS: readonly Expression[] = ["neutral", "curious", "content", "closed", "focused", "success", "concerned", "welcome"];
export const POSES: readonly Pose[] = ["three-quarter", "front", "side"];

/** État du rig. Angles en degrés, positions en unités du viewBox (400). */
export interface RigState {
  /** Lacet de la tête (+ = vers la droite de l'écran), en plus du lacet de base de la pose. */
  yaw: number;
  /** Tangage (+ = regarde vers le bas). */
  pitch: number;
  /** Inclinaison de la tête autour du cou (+ = sens horaire). */
  roll: number;
  /** Regard dans l'orbite, -1 → 1 (x : gauche → droite, y : haut → bas). */
  lookX: number;
  lookY: number;
  /** Paupière supérieure : 0 ouverte → 1 fermée. */
  lid: number;
  /** Bascule des paupières (+ = coins intérieurs abaissés : concentration ; − = relevés : inquiétude). */
  lidTilt: number;
  /** Paupière inférieure : 0 → 1 (rejoint la supérieure : œil clos). */
  lower: number;
  /** Pommettes remontées (yeux rieurs) : 0 → 1. */
  cheek: number;
  /** Échelle de la pupille (dilatation). */
  pupil: number;
  /** Aigrettes : + dressées, − rabattues (degrés). */
  ears: number;
  /** Aile proche soulevée (degrés, + = vers l'extérieur). */
  wing: number;
  /** Respiration : 0 → 1. */
  breath: number;
  /** Petit saut (unités vers le haut). */
  hop: number;
  /** Étincelle de réussite : 0 → 1. */
  sparkle: number;
}

export const REST: RigState = {
  yaw: 0, pitch: 0, roll: 0, lookX: 0, lookY: 0, lid: 0.2, lidTilt: 0, lower: 0, cheek: 0,
  pupil: 1, ears: 0, wing: 0, breath: 0, hop: 0, sparkle: 0,
};

/** Expressions : écarts au repos. Toutes calmes ; « concerned » reste discrète (jamais alarmante). */
export const EXPRESSION_STATE: Record<Expression, Partial<RigState>> = {
  neutral: {},
  curious: { roll: -10, yaw: -5, pitch: -3, lid: 0.04, pupil: 1.1, ears: 5, lookX: -0.35, lookY: -0.2 },
  content: { lid: 0.2, cheek: 0.82, roll: 3.5, ears: -1, lookY: 0.05 },
  closed: { lid: 1, lower: 1, pitch: 4, roll: 2, ears: -3 },
  focused: { lid: 0.46, lidTilt: 4, pitch: 4, lookY: 0.35, pupil: 0.92, ears: 1 },
  success: { lid: 0.12, cheek: 0.72, roll: -3, pitch: -4, ears: 6, wing: 9, sparkle: 1 },
  concerned: { lid: 0.34, lidTilt: -7, roll: 5, ears: -5, pupil: 0.88, lookX: 0.15, lookY: 0.12, lower: 0.1 },
  // Premier contact : tête inclinée vers le visiteur, yeux rieurs, aile à demi levée (un salut discret).
  welcome: { lid: 0.1, cheek: 0.55, roll: -6, yaw: -4, ears: 4, wing: 16, lookX: -0.15, lookY: -0.1 },
};

export function stateFor(expression: Expression, extra: Partial<RigState> = {}): RigState {
  return { ...REST, ...EXPRESSION_STATE[expression], ...extra };
}

// ================================================================================================
// Affine 2D (matrices SVG [a b c d e f])
// ================================================================================================
export type Mat = readonly [number, number, number, number, number, number];
export const I: Mat = [1, 0, 0, 1, 0, 0];
export const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const inv = (m: Mat): Mat => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};
export const tr = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const sc = (sx: number, sy: number, cx = 0, cy = 0): Mat => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
export const rot = (deg: number, cx = 0, cy = 0): Mat => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};
const isI = (m: Mat) => m.every((v, i) => Math.abs(v - I[i]!) < 5e-5);
/** Arrondi d'export : 2 décimales, zéros inutiles retirés. */
export const n2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
export const fmtMat = (m: Mat): string | undefined => {
  if (isI(m)) return undefined;
  if (Math.abs(m[0] - 1) < 5e-5 && Math.abs(m[3] - 1) < 5e-5 && Math.abs(m[1]) < 5e-5 && Math.abs(m[2]) < 5e-5) {
    return `translate(${n2(m[4])} ${n2(m[5])})`;
  }
  const f = (v: number) => String(Math.round(v * 10000) / 10000);
  return `matrix(${f(m[0])} ${f(m[1])} ${f(m[2])} ${f(m[3])} ${n2(m[4])} ${n2(m[5])})`;
};

// ================================================================================================
// Tracés : petites commandes absolues, symétrie gauche/droite exacte
// ================================================================================================
type P = readonly [number, number];
type Cmd =
  | readonly ["M", P] | readonly ["L", P] | readonly ["C", P, P, P] | readonly ["Q", P, P]
  | readonly ["A", number, number, 0, 0 | 1, 0 | 1, P] | readonly ["Z"];

const dOf = (cmds: readonly Cmd[]): string =>
  cmds.map((c) => {
    switch (c[0]) {
      case "M": case "L": return `${c[0]}${n2(c[1][0])} ${n2(c[1][1])}`;
      case "C": return `C${c.slice(1).map((p) => `${n2((p as P)[0])} ${n2((p as P)[1])}`).join(" ")}`;
      case "Q": return `Q${c.slice(1).map((p) => `${n2((p as P)[0])} ${n2((p as P)[1])}`).join(" ")}`;
      case "A": return `A${n2(c[1])} ${n2(c[2])} 0 ${c[4]} ${c[5]} ${n2(c[6][0])} ${n2(c[6][1])}`;
      default: return "Z";
    }
  }).join("");

const mx = (p: P, axis = SIZE / 2): P => [2 * axis - p[0], p[1]];
const mirrorCmds = (cmds: readonly Cmd[], axis = SIZE / 2): Cmd[] =>
  cmds.map((c): Cmd => {
    switch (c[0]) {
      case "M": case "L": return [c[0], mx(c[1], axis)];
      case "C": return ["C", mx(c[1], axis), mx(c[2], axis), mx(c[3], axis)];
      case "Q": return ["Q", mx(c[1], axis), mx(c[2], axis)];
      case "A": return ["A", c[1], c[2], 0, c[4], c[5] === 1 ? 0 : 1, mx(c[6], axis)];
      default: return c;
    }
  });

/** Orbite : cercle + trait de khôl vers l'extérieur (pointe `wing`) + coin intérieur vers le bec. */
function socket(e: P, r: number, wing: P): Cmd[] {
  const at = (deg: number): P => [e[0] + r * Math.cos((deg * Math.PI) / 180), e[1] + r * Math.sin((deg * Math.PI) / 180)];
  // Œil rond ; le trait part tangent au haut de l'œil (−112°) et revient vers 196° : courte pointe douce.
  const top = at(-112), back = at(196);
  return [
    ["M", wing],
    ["C", [wing[0] + (top[0] - wing[0]) * 0.5, wing[1] - 1.2], [top[0] - 5, top[1] + 0.2], top],
    ["A", r, r, 0, 1, 1, back],
    ["C", [back[0] - 2.4, back[1] - 1.2], [wing[0] + 3.4, wing[1] + 3.6], wing],
    ["Z"],
  ];
}

/** Orbite de l'œil gauche (agrandie de `grow` pour les découpes des paupières). */
function eyeSocket(grow: number): Cmd[] {
  const e = SPEC.eye.c, r = SPEC.eye.r + grow, f = SPEC.eye.flick;
  if (f <= 0) return circleCmds(e[0], e[1], r);
  return socket(e, r, [e[0] - r - f - grow * 0.6, e[1] - f * 2 - grow * 0.3]);
}

// ================================================================================================
// Graphe de scène (sérialisé en SVG par toSvg, rendu en React par AthenaOwl)
// ================================================================================================
export type RigKey =
  | "shadow" | "owl" | "torso" | "head" | "hood" | "face-left" | "face-right"
  | "beak-tl" | "beak-tr" | "beak-bl" | "beak-br"
  | "ear-left" | "ear-right" | "iris-left" | "iris-right" | "glint-left" | "glint-right"
  | "pupil-left" | "pupil-right" | "lid-left" | "lid-right" | "lower-left" | "lower-right"
  | "cheek-left" | "cheek-right" | "wing-left" | "wing-right" | "sparkle";

export interface Node {
  tag: "g" | "path" | "circle" | "ellipse" | "rect" | "clipPath" | "defs" | "title" | "desc";
  /** Nom lisible de la pièce : `id` dans les fichiers SVG, `data-part` dans le composant React. */
  part?: string;
  attrs?: Record<string, string | number | undefined>;
  children?: Node[];
  /** Groupe animé par le rig (transform/opacity calculés par rigTransforms). */
  rig?: RigKey;
  /** Référence de découpe (nom local, préfixé à l'export). */
  clip?: string;
  text?: string;
}

const path = (part: string | undefined, d: readonly Cmd[] | string, fill: string, extra: Node["attrs"] = {}): Node =>
  ({ tag: "path", part, attrs: { d: typeof d === "string" ? d : dOf(d), fill, ...extra } });
const line = (part: string | undefined, d: readonly Cmd[], stroke: string, width: number, extra: Node["attrs"] = {}): Node =>
  ({ tag: "path", part, attrs: { d: dOf(d), fill: "none", stroke, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round", ...extra } });
const circle = (part: string | undefined, cx: number, cy: number, r: number, fill: string, extra: Node["attrs"] = {}): Node =>
  ({ tag: "circle", part, attrs: { cx, cy, r, fill, ...extra } });
const g = (part: string | undefined, children: Node[], more: Partial<Node> = {}): Node => ({ tag: "g", part, children, ...more });

// ================================================================================================
// Tête (dessinée de face ; repère du viewBox)
// ================================================================================================
/** Pivot du lacet/tangage (centre du crâne), cou (pivot de l'inclinaison), profondeurs des plans. */
export const HEAD = {
  cx: 200, cy: 118,
  neck: [200, 186] as P,
  /** Profondeur de l'arête des disques faciaux devant l'axe de rotation. */
  seam: 66,
  /** Inclinaison de chaque disque facial de part et d'autre de l'arête (degrés). */
  lobe: 25,
  /** Profondeur de la pointe du bec (un peu devant l'arête : il dépasse du profil). */
  beak: 70,
  /** Capuchon (crâne + aigrettes) : demi-largeur, demi-hauteur, demi-profondeur ; décalage latéral
   *  vers le côté où la tête tourne (fraction du sinus), pour accompagner le disque facial. */
  hood: { a: 102, b: 82, c: 66, follow: 14 },
};

/** CONSTRUCTION DE LA TÊTE — la seule chose à modifier pour recaler la chouette sur une référence.
 *  Moitié gauche (la droite est son miroir exact autour de x = 200) ; les poignées des courbes sont
 *  exprimées RELATIVEMENT à ces points : déplacer un point déplace ses courbes. Symbole, mascotte et
 *  versions monochromes sont tous calculés à partir d'ici. Version C2 (revue de direction artistique
 *  du 11/10) : V du front doux sans trait noir, aigrettes courtes en plumes évasées (~32°), yeux noirs
 *  plus petits, un seul reflet placé au même endroit dans les deux yeux. */
export const SPEC = {
  /** Œil gauche : centre, rayon ; `lid` = hauteur de la paupière au repos (fraction du rayon au-dessus du
   *  centre : 1 = œil rond, plus bas = regard posé, calme) ; `flick` = pointe extérieure (0 : aucune). */
  eye: { c: [153, 120] as P, r: 21, lid: 0.7, flick: 0 },
  disc: {
    /** V doux où les deux disques faciaux se rejoignent, au-dessus du bec. */
    v: [200, 100] as P,
    /** Sommet de l'arche du disque au-dessus de l'œil (disque centré sur l'œil). */
    apex: [151, 78] as P,
    /** Joue : l'arche redescend autour de l'œil jusqu'ici (bord du crâne). */
    cheek: [100, 125] as P,
    /** Mâchoire. */
    jaw: [139, 177] as P,
    /** Menton : pointe du cœur. */
    chin: [200, 194] as P,
  },
  /** Crâne : sommet, bord latéral (x) à la hauteur y, bas. */
  dome: { top: 24, side: 98, y: 118, bottom: 190 },
  /** Aigrette : position de sa base sur le bord du crâne (paramètres 0 → 1 de la courbe du crâne,
   *  du côté vers le sommet), longueur, élévation au-dessus de l'horizontale (degrés), cambrure. */
  tuft: { from: 0.24, to: 0.41, length: 58, elevation: 65, curl: 0 },
  beak: { top: [200, 127] as P, side: [188, 142] as P, bottom: [200, 171] as P },
  /** Filet du disque facial : bande en négatif (largeur au milieu, fraction conservée aux extrémités). */
  rim: { width: 3.2, taper: 0.25 },
};
const D = SPEC.disc, K = SPEC.dome;
const add = (p: P, dx: number, dy: number): P => [p[0] + dx, p[1] + dy];
const bez = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

const EYE = { l: SPEC.eye.c, r: SPEC.eye.r };
const EYE_R: P = mx(EYE.l);

// Crâne (moitié gauche : du côté à mi-hauteur jusqu'au sommet), puis contour complet.
const DOME_L: [P, P, P, P] = [[K.side, K.y], [K.side, 60], [140, K.top], [200, K.top]];
const DOME: Cmd[] = [
  ["M", [200, K.top]],
  ["C", mx(DOME_L[2]), mx(DOME_L[1]), mx(DOME_L[0])],
  ["C", [400 - K.side, 158], [282, 182], [240, K.bottom]],
  ["L", [160, K.bottom]],
  ["C", [118, 182], [K.side, 158], [K.side, K.y]],
  ["C", DOME_L[1], DOME_L[2], DOME_L[3]],
  ["Z"],
];
/** Aigrette gauche : naît sur le bord du crâne (entre deux points de sa courbe), s'évase vers
 *  l'extérieur à `elevation` degrés, pointe légèrement relevée ; bord intérieur adouci. */
const TUFT = (() => {
  const t = SPEC.tuft;
  const base = bez(...DOME_L, t.from), attach = bez(...DOME_L, t.to);
  const mid: P = [(base[0] + attach[0]) / 2, (base[1] + attach[1]) / 2];
  const el = (t.elevation * Math.PI) / 180;
  const tip: P = [mid[0] - t.length * Math.cos(el), mid[1] - t.length * Math.sin(el) - t.curl];
  return { base, attach, tip };
})();
/** Bord extérieur : deux plumes (une petite pointe secondaire, puis la pointe principale relevée). */
const TUFT_SECOND: P = [TUFT.base[0] + (TUFT.tip[0] - TUFT.base[0]) * 0.62, TUFT.base[1] + (TUFT.tip[1] - TUFT.base[1]) * 0.42 + 2];
const TUFT_NOTCH: P = [TUFT.base[0] + (TUFT.tip[0] - TUFT.base[0]) * 0.55, TUFT.base[1] + (TUFT.tip[1] - TUFT.base[1]) * 0.5 - 1];
const TUFT_OUTER_L: Cmd[] = [
  ["C", add(TUFT.base, -7, 0), add(TUFT_SECOND, 8, 3), TUFT_SECOND],
  ["C", add(TUFT_SECOND, 2, -2.5), add(TUFT_NOTCH, -3, 1), TUFT_NOTCH],
  ["C", add(TUFT_NOTCH, -4, -4), add(TUFT.tip, 8, 7), TUFT.tip],
];
const TUFT_INNER_L: Cmd = ["C", add(TUFT.tip, 9, -4), add(TUFT.attach, -13, -8), TUFT.attach];
/** Forme de l'aigrette pour la mascotte (pivote à sa base) : sa racine mord dans le crâne. */
const TUFT_L: Cmd[] = [["M", TUFT.base], ...TUFT_OUTER_L, TUFT_INNER_L, ["L", add(TUFT.attach, 9, 8)], ["L", add(TUFT.base, 10, 1)], ["Z"]];
export const EAR_BASE_L: P = [(TUFT.base[0] + TUFT.attach[0]) / 2 + 3, (TUFT.base[1] + TUFT.attach[1]) / 2 + 2];

/** Arche du disque facial : du V doux, par-dessus l'œil, puis autour de lui jusqu'à la joue. Le disque
 *  est à peu près centré sur l'œil : c'est la signature de la chouette, lisible même en une couleur. */
const BROW_EDGE_L: Cmd[] = [
  ["M", D.v],
  ["C", add(D.v, -12, -15), add(D.apex, 22, 0), D.apex],
  ["C", add(D.apex, -28, 0), add(D.cheek, 1, -29), D.cheek],
];
/** Bas du disque : joue → mâchoire → menton (c'est aussi le bas de la silhouette). */
const DISC_SIDE_L: Cmd[] = [
  ["C", add(D.cheek, 1, 25), add(D.jaw, -25, -9), D.jaw],
  ["C", add(D.jaw, 22, 8), add(D.chin, -20, -3), D.chin],
];
// Disque facial gauche (fermé par l'arête verticale) et disque entier en cœur (symbole).
const LOBE_L: Cmd[] = [...BROW_EDGE_L, ...DISC_SIDE_L, ["Z"]];
function heart(): Cmd[] {
  const half: Cmd[] = [...BROW_EDGE_L, ...DISC_SIDE_L];
  const right = reversePath(mirrorCmds(half));
  return [...half, ...right.slice(1), ["Z"]];
}

/** Contour extérieur complet (crâne + aigrettes + menton) : symbole et monochromes. */
const SILHOUETTE_L: Cmd[] = [
  ["M", D.chin],
  ["C", add(D.chin, -20, -3), add(D.jaw, 22, 8), D.jaw],
  ["C", add(D.jaw, -25, -9), [K.side, 156], [K.side, K.y]],
  // Le long du crâne jusqu'à la naissance de l'aigrette (sous-courbe exacte du crâne).
  ...(() => { const [, a1, a2] = splitBez(DOME_L, 0, SPEC.tuft.from); return [["C", a1, a2, TUFT.base] as Cmd]; })(),
  ...TUFT_OUTER_L,
  TUFT_INNER_L,
  ...(() => { const [, a1, a2] = splitBez(DOME_L, SPEC.tuft.to, 1); return [["C", a1, a2, [200, K.top]] as Cmd]; })(),
];
/** Sous-courbe d'une cubique entre t0 et t1 (de Casteljau). */
function splitBez(c: [P, P, P, P], t0: number, t1: number): [P, P, P, P] {
  const at = (t: number) => bez(...c, t);
  // Dérivées aux extrémités pour les poignées de la sous-courbe.
  const d = (t: number): P => {
    const u = 1 - t;
    return [
      3 * (u * u * (c[1][0] - c[0][0]) + 2 * u * t * (c[2][0] - c[1][0]) + t * t * (c[3][0] - c[2][0])),
      3 * (u * u * (c[1][1] - c[0][1]) + 2 * u * t * (c[2][1] - c[1][1]) + t * t * (c[3][1] - c[2][1])),
    ];
  };
  const k = (t1 - t0) / 3, p0 = at(t0), p3 = at(t1), d0 = d(t0), d1 = d(t1);
  return [p0, [p0[0] + d0[0] * k, p0[1] + d0[1] * k], [p3[0] - d1[0] * k, p3[1] - d1[1] * k], p3];
}
function silhouette(): Cmd[] {
  const right = mirrorCmds(SILHOUETTE_L);
  const back: Cmd[] = [];
  const end = (c: Cmd): P => (c[0] === "C" ? c[3] : c[0] === "Q" ? c[2] : c[0] === "A" ? c[6] : (c as readonly ["M" | "L", P])[1]);
  for (let i = right.length - 1; i > 0; i--) {
    const cur = right[i]!, prev = right[i - 1]!;
    back.push(cur[0] === "C" ? ["C", cur[2], cur[1], end(prev)] : ["L", end(prev)]);
  }
  return [...SILHOUETTE_L, ...back, ["Z"]];
}
// Bec : pyramide à quatre facettes (lumière en haut à gauche).
const BEAK = {
  t: SPEC.beak.top, l: SPEC.beak.side, b: SPEC.beak.bottom, r: mx(SPEC.beak.side),
  c: [200, SPEC.beak.side[1] + 1.5] as P,
};

// Paupières, en coordonnées locales de l'œil (origine = centre de l'œil, position « fermée »).
const LID_EDGE: Cmd[] = [["M", [-27, 1]], ["C", [-12, 7.5], [12, 7.5], [27, 1]]];
const LID: Cmd[] = [...LID_EDGE, ["L", [27, -34]], ["L", [-27, -34]], ["Z"]];
const LOWER: Cmd[] = [...LID_EDGE, ["L", [27, 31]], ["L", [-27, 31]], ["Z"]];
const CHEEK: Cmd[] = [["M", [-28, 31]], ["L", [-28, 11]], ["C", [-14, 2.5], [14, 2.5], [28, 11]], ["L", [28, 31]], ["Z"]];
const LASH: Cmd[] = [["M", [-21.5, 3]], ["C", [-11, 8], [11, 8], [21.5, 3]]];
// Course des paupières pour un œil de rayon SPEC.eye.r : ouvertes, elles sortent juste de la découpe.
const LID_OPEN = -(SPEC.eye.r + 4 + 6.5);
const LOWER_OPEN = SPEC.eye.r + 4;
const CHEEK_OPEN = SPEC.eye.r + 1;

type Side = "left" | "right";
const sideMirror = (side: Side, cmds: Cmd[]) => (side === "left" ? cmds : mirrorCmds(cmds));
const sideMirrorLocal = (side: Side, cmds: Cmd[]) => (side === "left" ? cmds : mirrorCmds(cmds, 0));

export interface Detail {
  /** Paupières et pommettes animables (inutiles dans un logo immobile). */
  lids: boolean;
}
export const FULL: Detail = { lids: true };
export const MARK: Detail = { lids: false };

/** Reflet de l'œil : MÊME position (haut à droite) dans les deux yeux, lumière venue d'un seul côté. */
const HIGHLIGHT = { dx: 0.36, dy: -0.28, r: 0.2 };
const highlightAt = (c: P, r: number): [number, number, number] => [c[0] + r * HIGHLIGHT.dx, c[1] + r * HIGHLIGHT.dy, r * HIGHLIGHT.r];

function eye(side: Side, faceFill: string, detail: Detail): Node {
  const e = side === "left" ? EYE.l : EYE_R;
  const sock = sideMirror(side, eyeSocket(0));
  const lidClip = sideMirror(side, eyeSocket(4));
  const sfx = `-${side}`;
  const [hx, hy, hr] = highlightAt(e, EYE.r);
  const local = (cmds: Cmd[]) => sideMirrorLocal(side, cmds);
  return g(`eye${sfx}`, [
    { tag: "clipPath", part: `clip-socket${sfx}`, children: [path(undefined, sock, "#000")] },
    ...(detail.lids ? [{ tag: "clipPath", part: `clip-lids${sfx}`, children: [path(undefined, lidClip, "#000")] } as Node] : []),
    path(`eye${sfx}-socket`, sock, C.obsidian),
    g(undefined, [
      g(`eye${sfx}-iris`, [
        circle(`eye${sfx}-iris-disc`, e[0], e[1], EYE.r * 0.8, C.graphite),
        g(`eye${sfx}-pupil`, [circle(undefined, e[0], e[1], EYE.r * 0.54, C.obsidian)], { rig: `pupil${sfx}` as RigKey }),
        g(`eye${sfx}-highlight`, [circle(undefined, hx, hy, hr, C.ivory)], { rig: `glint${sfx}` as RigKey }),
      ], { rig: `iris${sfx}` as RigKey }),
    ], { clip: `clip-socket${sfx}` }),
    ...(detail.lids ? [g(undefined, [
      g(`eye${sfx}-cheek`, [path(undefined, local(CHEEK), faceFill)], { rig: `cheek${sfx}` as RigKey }),
      g(`eye${sfx}-lid-upper`, [path(undefined, local(LID), faceFill)], { rig: `lid${sfx}` as RigKey }),
      // Le trait des cils est porté par la paupière inférieure : il n'apparaît que quand l'œil se ferme.
      g(`eye${sfx}-lid-lower`, [path(undefined, local(LOWER), faceFill), line(undefined, local(LASH), C.obsidian, 2.2)], { rig: `lower${sfx}` as RigKey }),
    ], { clip: `clip-lids${sfx}` })] : []),
  ]);
}

function face(side: Side, detail: Detail): Node {
  const sfx = `-${side}`;
  return g(`face${sfx}`, [
    path(`face${sfx}-disc`, sideMirror(side, LOBE_L), C.ivory),
    line(`face${sfx}-rim`, sideMirror(side, BROW_EDGE_L), C.beige, 2.6),
    eye(side, C.ivory, detail),
  ], { rig: `face${sfx}` as RigKey });
}

/** Bec : pyramide à quatre facettes ; chaque facette est un triangle avec sa propre projection exacte. */
const BEAK_FACETS = [
  { key: "beak-tl", part: "beak-facet-top-left", tri: ["t", "l", "c"], fill: C.champagne },
  { key: "beak-tr", part: "beak-facet-top-right", tri: ["t", "c", "r"], fill: C.champagne },
  { key: "beak-bl", part: "beak-facet-bottom-left", tri: ["l", "b", "c"], fill: C.champagneDeep },
  { key: "beak-br", part: "beak-facet-bottom-right", tri: ["c", "b", "r"], fill: C.champagneDeep },
] as const;
function beak(): Node {
  return g("beak", BEAK_FACETS.map((f) => g(undefined, [path(f.part, [["M", BEAK[f.tri[0]]], ["L", BEAK[f.tri[1]]], ["L", BEAK[f.tri[2]]], ["Z"]], f.fill)], { rig: f.key })));
}

function head(detail: Detail): Node {
  // Liseré beige discret autour du capuchon (sur fond ivoire, la tête claire garde un contour) : chaque
  // pièce est tracée une fois en trait sous son aplat ; l'aplat du crâne, posé en dernier, recouvre la
  // base des aigrettes, donc aucune couture n'apparaît.
  const edge = { stroke: C.rim, "stroke-width": 3.4, "stroke-linejoin": "round" } as const;
  const ear = (side: Side) => {
    const base = side === "left" ? EAR_BASE_L : mx(EAR_BASE_L);
    const d = sideMirror(side, TUFT_L);
    return g(`ear-${side}`, [path(undefined, d, "none", edge), path(`ear-${side}-tuft`, d, C.hood)], { rig: `ear-${side}` as RigKey, attrs: { "data-pivot": `${n2(base[0])} ${n2(base[1])}` } });
  };
  return g("head", [
    g("hood", [path(undefined, DOME, "none", edge), ear("left"), ear("right"), path("hood-dome", DOME, C.hood)], { rig: "hood" }),
    face("left", detail),
    face("right", detail),
    beak(),
  ], { rig: "head" });
}

// ================================================================================================
// Corps : trois poses dessinées, mêmes pièces
// ================================================================================================
interface BodyPose {
  /** Décalage de la tête et lacet de base (degrés). */
  head: { dx: number; dy: number; yaw: number };
  shell: Cmd[];
  chest: Cmd[];
  chestShade?: Cmd[];
  neckShadow: Cmd[];
  /** Plumage du plastron : 2–3 festons discrets (centre, demi-largeur, creux). */
  scallops: [number, number][];
  wings: { left?: WingDef; right?: WingDef };
  /** Aile située derrière le corps (dépasse seulement du bord) : dessinée avant lui. */
  wingBehind?: "left" | "right";
  tail?: Cmd[];
  legs: { x: number; y: number; w: number; h: number }[];
  feet: { root: P; toes: P[] }[];
  shadow: { cx: number; cy: number; rx: number; ry: number };
  sparkle: P;
}
interface WingDef {
  /** Aile : un seul plan graphite. */
  outline: Cmd[];
  /** Bord d'attaque : l'unique filet champagne de l'aile (absent sur l'aile lointaine). */
  band?: Cmd[];
  /** Épaule : pivot du soulèvement. */
  shoulder: P;
}

const mirrorWing = (w: WingDef): WingDef => ({ outline: mirrorCmds(w.outline), band: w.band && mirrorCmds(w.band), shoulder: mx(w.shoulder) });

// ---- Trois quarts (pose de référence de la marque : corps tourné vers la droite, tête vers nous) ----
const TQ_WING_L: WingDef = {
  outline: [
    ["M", [180, 183]],
    ["C", [205, 189], [223, 213], [225, 250]],
    ["C", [227, 289], [207, 322], [172, 343]],
    ["C", [146, 358], [112, 369], [72, 379]],
    ["C", [81, 347], [89, 303], [96, 264]],
    ["C", [103, 224], [135, 189], [180, 183]],
    ["Z"],
  ],
  band: [
    ["M", [180, 183]],
    ["C", [205, 189], [223, 213], [225, 250]],
    ["C", [227, 289], [207, 322], [172, 343]],
    ["L", [167, 335]],
    ["C", [196, 316], [212, 287], [211.5, 252]],
    ["C", [210.5, 222], [196, 201], [176, 195]],
    ["Z"],
  ],
  shoulder: [184, 196],
};
const TQ: BodyPose = {
  head: { dx: 8, dy: 0, yaw: 6 },
  shell: [
    ["M", [176, 176]],
    ["C", [134, 183], [104, 218], [99, 266]],
    ["C", [95, 310], [118, 344], [166, 352]],
    ["C", [206, 358], [258, 354], [288, 333]],
    ["C", [313, 315], [322, 276], [318, 242]],
    ["C", [314, 208], [292, 184], [258, 176]],
    ["C", [232, 170], [202, 171], [176, 176]],
    ["Z"],
  ],
  chest: [
    ["M", [190, 180]],
    ["C", [232, 172], [282, 180], [301, 214]],
    ["C", [313, 238], [314, 284], [298, 312]],
    ["C", [278, 340], [234, 352], [190, 350]],
    ["L", [150, 300]],
    ["Z"],
  ],
  chestShade: [
    ["M", [292, 196]],
    ["C", [309, 214], [316, 246], [314, 276]],
    ["C", [312, 300], [302, 322], [282, 336]],
    ["C", [298, 312], [308, 280], [306, 248]],
    ["C", [305, 226], [300, 208], [292, 196]],
    ["Z"],
  ],
  neckShadow: [
    ["M", [148, 186]],
    ["C", [170, 196], [196, 201], [216, 202]],
    ["C", [240, 202], [264, 196], [284, 186]],
    ["C", [262, 180], [236, 177], [212, 177]],
    ["C", [188, 177], [166, 180], [148, 186]],
    ["Z"],
  ],
  scallops: [[256, 232], [280, 256], [252, 280]],
  wings: {
    left: TQ_WING_L,
    right: {
      outline: [["M", [306, 212]], ["C", [330, 244], [334, 298], [308, 342]], ["C", [319, 302], [321, 258], [300, 222]], ["Z"]],
      shoulder: [306, 214],
    },
  },
  wingBehind: "right",
  tail: [["M", [156, 334]], ["C", [130, 350], [104, 364], [64, 382]], ["C", [100, 380], [134, 371], [166, 352]], ["Z"]],
  legs: [{ x: 169, y: 334, w: 16, h: 26 }, { x: 232, y: 332, w: 15, h: 26 }],
  feet: [
    { root: [177, 360], toes: [[157, 371], [176, 377], [196, 371]] },
    { root: [240, 358], toes: [[221, 369], [240, 375], [259, 369]] },
  ],
  shadow: { cx: 196, cy: 373, rx: 92, ry: 7.5 },
  sparkle: [322, 62],
};

// ---- Face ---------------------------------------------------------------------------------------
const FRONT_WING_L: WingDef = {
  outline: [
    ["M", [152, 185]],
    ["C", [124, 196], [103, 234], [99, 282]],
    ["C", [97, 312], [100, 340], [108, 362]],
    ["C", [121, 344], [141, 320], [153, 292]],
    ["C", [164, 263], [168, 216], [152, 185]],
    ["Z"],
  ],
  band: [
    ["M", [152, 185]],
    ["C", [168, 216], [164, 263], [153, 292]],
    ["C", [141, 320], [121, 344], [108, 362]],
    ["L", [107, 350]],
    ["C", [124, 330], [140, 305], [146, 282]],
    ["C", [155, 252], [156, 214], [146, 192]],
    ["Z"],
  ],
  shoulder: [150, 196],
};
const FRONT: BodyPose = {
  head: { dx: 0, dy: 0, yaw: 0 },
  shell: [
    ["M", [200, 171]],
    ["C", [249, 171], [289, 202], [294, 252]],
    ["C", [299, 300], [271, 344], [200, 351]],
    ["C", [129, 344], [101, 300], [106, 252]],
    ["C", [111, 202], [151, 171], [200, 171]],
    ["Z"],
  ],
  chest: [
    ["M", [200, 175]],
    ["C", [240, 175], [272, 196], [281, 236]],
    ["C", [290, 282], [268, 336], [200, 345]],
    ["C", [132, 336], [110, 282], [119, 236]],
    ["C", [128, 196], [160, 175], [200, 175]],
    ["Z"],
  ],
  chestShade: [
    ["M", [262, 196]],
    ["C", [284, 216], [292, 252], [288, 284]],
    ["C", [284, 314], [262, 336], [232, 344]],
    ["C", [262, 326], [280, 300], [282, 266]],
    ["C", [284, 238], [276, 214], [262, 196]],
    ["Z"],
  ],
  neckShadow: [
    ["M", [132, 186]],
    ["C", [156, 197], [178, 201], [200, 201]],
    ["C", [222, 201], [244, 197], [268, 186]],
    ["C", [246, 179], [224, 176], [200, 176]],
    ["C", [176, 176], [154, 179], [132, 186]],
    ["Z"],
  ],
  scallops: [[200, 232], [182, 258], [218, 258]],
  wings: { left: FRONT_WING_L, right: mirrorWing(FRONT_WING_L) },
  legs: [{ x: 156, y: 334, w: 16, h: 26 }, { x: 228, y: 334, w: 16, h: 26 }],
  feet: [
    { root: [164, 360], toes: [[145, 370], [163, 376], [182, 370]] },
    { root: [236, 360], toes: [[218, 370], [237, 376], [255, 370]] },
  ],
  shadow: { cx: 200, cy: 373, rx: 92, ry: 7.5 },
  sparkle: [320, 60],
};

// ---- Côté (profil vers la droite, même tête tournée à 60°) -----------------------------------------
const SIDE_WING_L: WingDef = {
  outline: [
    ["M", [214, 183]],
    ["C", [241, 193], [258, 220], [257, 257]],
    ["C", [256, 296], [233, 328], [198, 346]],
    ["C", [166, 361], [124, 372], [82, 382]],
    ["C", [94, 348], [104, 302], [114, 263]],
    ["C", [125, 222], [162, 186], [214, 183]],
    ["Z"],
  ],
  band: [
    ["M", [214, 183]],
    ["C", [241, 193], [258, 220], [257, 257]],
    ["C", [256, 296], [233, 328], [198, 346]],
    ["L", [193, 337]],
    ["C", [224, 319], [243, 290], [243.5, 258]],
    ["C", [244, 226], [230, 204], [210, 195]],
    ["Z"],
  ],
  shoulder: [214, 196],
};
const SIDE: BodyPose = {
  head: { dx: 22, dy: -1, yaw: 68 },
  shell: [
    ["M", [196, 175]],
    ["C", [241, 171], [284, 198], [292, 248]],
    ["C", [300, 300], [276, 343], [222, 351]],
    ["C", [180, 357], [140, 342], [125, 306]],
    ["C", [111, 273], [118, 227], [146, 197]],
    ["C", [160, 183], [178, 177], [196, 175]],
    ["Z"],
  ],
  chest: [
    ["M", [214, 178]],
    ["C", [252, 176], [282, 200], [289, 244]],
    ["C", [296, 290], [282, 330], [244, 346]],
    ["L", [200, 300]],
    ["Z"],
  ],
  chestShade: [
    ["M", [272, 200]],
    ["C", [288, 222], [294, 254], [290, 284]],
    ["C", [286, 310], [272, 330], [252, 342]],
    ["C", [270, 322], [282, 296], [282, 266]],
    ["C", [282, 240], [278, 218], [272, 200]],
    ["Z"],
  ],
  neckShadow: [
    ["M", [168, 186]],
    ["C", [196, 198], [222, 202], [246, 201]],
    ["C", [264, 200], [280, 194], [292, 186]],
    ["C", [270, 179], [244, 176], [222, 176]],
    ["C", [200, 176], [182, 180], [168, 186]],
    ["Z"],
  ],
  scallops: [[268, 236], [282, 262], [266, 286]],
  wings: { left: SIDE_WING_L },
  tail: [["M", [150, 336]], ["C", [124, 352], [98, 368], [60, 386]], ["C", [96, 384], [132, 374], [164, 354]], ["Z"]],
  legs: [{ x: 204, y: 334, w: 15, h: 26 }, { x: 226, y: 336, w: 15, h: 25 }],
  feet: [
    { root: [212, 360], toes: [[196, 369], [214, 376], [233, 371]] },
    { root: [234, 361], toes: [[220, 370], [238, 376], [256, 370]] },
  ],
  shadow: { cx: 196, cy: 374, rx: 88, ry: 7.5 },
  sparkle: [318, 60],
};

export const BODY: Record<Pose, BodyPose> = { "three-quarter": TQ, front: FRONT, side: SIDE };

function wing(side: Side, w: WingDef): Node {
  const sfx = `-${side}`;
  return g(`wing${sfx}`, [
    path(`wing${sfx}-plane`, w.outline, C.graphite),
    ...(w.band ? [path(`wing${sfx}-edge`, w.band, C.champagne)] : []),
  ], { rig: `wing${sfx}` as RigKey, attrs: { "data-pivot": `${w.shoulder[0]} ${w.shoulder[1]}` } });
}

/** Feston du plastron : arc creusé vers le bas (une plume vue de face). */
const scallop = ([x, y]: [number, number], w = 12, h = 8): Cmd[] => [["M", [x - w, y]], ["C", [x - w * 0.55, y + h], [x + w * 0.55, y + h], [x + w, y]]];

/** Doigt : triangle effilé de la racine à la pointe, serre recourbée au bout. */
function toe(root: P, tip: P, part: string): Node[] {
  const dx = tip[0] - root[0], dy = tip[1] - root[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  const w0 = 3.6, w1 = 1.3;
  const a: P = [root[0] + nx * w0, root[1] + ny * w0], b: P = [root[0] - nx * w0, root[1] - ny * w0];
  const t1: P = [tip[0] + nx * w1, tip[1] + ny * w1], t2: P = [tip[0] - nx * w1, tip[1] - ny * w1];
  const hook: P = [tip[0] + (dx / L) * 3.2, tip[1] + (dy / L) * 3.2 + 2.6];
  return [
    path(part, [["M", a], ["C", [a[0] + dx * 0.5, a[1] + dy * 0.5 - 1.5], t1, t1], ["L", t2], ["C", t2, [b[0] + dx * 0.5, b[1] + dy * 0.5 + 0.5], b], ["Z"]], C.champagne),
    path(`${part}-talon`, [["M", t1], ["Q", [hook[0] + nx * 1.2, hook[1] - 1.5], hook], ["Q", [tip[0], tip[1] + 1.2], t2], ["Z"]], C.champagneDeep),
  ];
}

function body(pose: Pose, detail: Detail): Node[] {
  const B = BODY[pose];
  const behind = B.wingBehind;
  const wingNodes = (["left", "right"] as const).filter((s) => B.wings[s]).map((s) => ({ side: s, node: wing(s, B.wings[s]!) }));
  const legs = g("legs", B.legs.map((l, i) => ({ tag: "rect", part: `leg-${i ? "right" : "left"}`, attrs: { x: l.x, y: l.y, width: l.w, height: l.h, rx: l.w / 2, fill: C.porcelain } } as Node)));
  const feet = g("feet", B.feet.map((f, i) => {
    const s = i ? "right" : "left";
    return g(`foot-${s}`, [
      ...f.toes.flatMap((t, k) => toe(f.root, t, `foot-${s}-toe-${k + 1}`)),
      { tag: "ellipse", part: `foot-${s}-pad`, attrs: { cx: f.root[0], cy: f.root[1] + 0.5, rx: 6.5, ry: 4.2, fill: C.champagne } },
    ]);
  }));
  const torso = g("torso", [
    ...(B.tail ? [path("tail", B.tail, C.graphite)] : []),
    ...wingNodes.filter((w) => w.side === behind).map((w) => w.node),
    g("body", [
      path("body-shell", B.shell, C.sand),
      path("body-front", B.chest, C.ivory),
      ...(B.chestShade ? [path("body-side", B.chestShade, C.porcelain)] : []),
      path("body-neck-shadow", B.neckShadow, C.sand),
      g("chest-feathers", B.scallops.map((c, i) => line(`chest-feather-${i + 1}`, scallop(c), C.sand, 2.4))),
    ]),
    ...wingNodes.filter((w) => w.side !== behind).map((w) => w.node),
    head(detail),
  ], { rig: "torso" });
  return [legs, torso, feet];
}

function sparkle(at: P): Node {
  const star = (c: P, s: number): Cmd[] => [
    ["M", [c[0], c[1] - s]],
    ["C", [c[0] + s * 0.09, c[1] - s * 0.28], [c[0] + s * 0.28, c[1] - s * 0.09], [c[0] + s, c[1]]],
    ["C", [c[0] + s * 0.28, c[1] + s * 0.09], [c[0] + s * 0.09, c[1] + s * 0.28], [c[0], c[1] + s]],
    ["C", [c[0] - s * 0.09, c[1] + s * 0.28], [c[0] - s * 0.28, c[1] + s * 0.09], [c[0] - s, c[1]]],
    ["C", [c[0] - s * 0.28, c[1] - s * 0.09], [c[0] - s * 0.09, c[1] - s * 0.28], [c[0], c[1] - s]],
    ["Z"],
  ];
  return g("sparkle", [
    path("sparkle-large", star(at, 15), C.champagne),
    path("sparkle-small", star([at[0] - 26, at[1] - 22], 7), C.champagne),
  ], { rig: "sparkle", attrs: { "data-pivot": `${at[0]} ${at[1]}` } });
}

/** Chouette entière (pose + détail), géométrie seule : les transformations viennent de rigTransforms. */
export function owlScene(pose: Pose, detail: Detail = FULL): Node[] {
  const B = BODY[pose];
  return [
    g("ground-shadow", [{ tag: "ellipse", attrs: { cx: B.shadow.cx, cy: B.shadow.cy, rx: B.shadow.rx, ry: B.shadow.ry, fill: C.beige, opacity: 0.7 } }], { rig: "shadow" }),
    g("owl", body(pose, detail), { rig: "owl" }),
    sparkle(B.sparkle),
  ];
}

// ================================================================================================
// Rig : état → transform / opacity de chaque groupe animé
// ================================================================================================
type V3 = readonly [number, number, number];
const DEG = Math.PI / 180;
function rotate3(v: V3, yaw: number, pitch: number): V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
  return [x1, v[1] * cp + z1 * sp, -v[1] * sp + z1 * cp];
}
interface Plane { o: V3; u: V3; v: V3 }
const planeOf = (o: V3, u: V3): Plane => ({ o, u, v: [0, 1, 0] });
const A = HEAD.lobe * DEG;
const PLANES = {
  left: planeOf([0, 0, HEAD.seam], [Math.cos(A), 0, Math.sin(A)]),
  right: planeOf([0, 0, HEAD.seam], [Math.cos(A), 0, -Math.sin(A)]),
};
function project(p: Plane, yaw: number, pitch: number): Mat {
  const o = rotate3(p.o, yaw, pitch), u = rotate3(p.u, yaw, pitch), v = rotate3(p.v, yaw, pitch);
  return [u[0], u[1], v[0], v[1], HEAD.cx + o[0], HEAD.cy + o[1]];
}
/** Matrice « dessin de face → vue tournée » d'un plan. */
function planeMatrix(p: Plane, yaw: number, pitch: number): Mat {
  return mul(project(p, yaw, pitch), inv(project(p, 0, 0)));
}
/** Composante vers l'observateur de la normale d'un plan (≤ 0 : vu de dos). */
function facing(p: Plane, yaw: number, pitch: number): number {
  const n: V3 = [p.u[1] * p.v[2] - p.u[2] * p.v[1], p.u[2] * p.v[0] - p.u[0] * p.v[2], p.u[0] * p.v[1] - p.u[1] * p.v[0]];
  return rotate3(n, yaw, pitch)[2];
}
/** Points du bec en 3D (repère du pivot de la tête) : base sur les disques faciaux, pointe en avant. */
const BEAK_3D: Record<"t" | "l" | "b" | "r" | "c", V3> = (() => {
  const at = (p: P, z: number): V3 => [p[0] - HEAD.cx, p[1] - HEAD.cy, z];
  const side = HEAD.seam - Math.abs(SPEC.beak.side[0] - 200) * Math.tan(A);
  return {
    t: at(BEAK.t, HEAD.seam), b: at(BEAK.b, HEAD.seam - 3), l: at(BEAK.l, side), r: at(BEAK.r, side),
    c: at(BEAK.c, HEAD.beak),
  };
})();
/** Matrice affine exacte qui envoie un triangle dessiné de face sur la projection de ses sommets 3D. */
function facetMatrix(front: [P, P, P], pts: [V3, V3, V3], yaw: number, pitch: number): Mat {
  const q = pts.map((v) => { const r = rotate3(v, yaw, pitch); return [HEAD.cx + r[0], HEAD.cy + r[1]] as P; });
  const F: Mat = [front[1][0] - front[0][0], front[1][1] - front[0][1], front[2][0] - front[0][0], front[2][1] - front[0][1], front[0][0], front[0][1]];
  const Q: Mat = [q[1]![0] - q[0]![0], q[1]![1] - q[0]![1], q[2]![0] - q[0]![0], q[2]![1] - q[0]![1], q[0]![0], q[0]![1]];
  // F et Q envoient le triangle unité sur chaque triangle : M = Q · F⁻¹.
  return mul(Q, inv(F));
}
/** Capuchon (crâne + aigrettes) : silhouette d'un ellipsoïde (largeur √(a²cos² + c²sin²)), qui glisse
 *  un peu du côté où la tête tourne pour accompagner le disque facial. */
function hoodMatrix(yaw: number, pitch: number): Mat {
  const { a, b, c, follow } = HEAD.hood;
  const hw = Math.sqrt((a * Math.cos(yaw)) ** 2 + (c * Math.sin(yaw)) ** 2);
  const hh = Math.sqrt((b * Math.cos(pitch)) ** 2 + (c * Math.sin(pitch)) ** 2);
  return mul(tr(follow * Math.sin(yaw), follow * Math.sin(pitch)), sc(hw / a, hh / b, HEAD.cx, HEAD.cy));
}

export interface RigOut { transform?: string; opacity?: number }

/** Transformations de chaque groupe animé pour une pose et un état. Fonction pure : appelée à chaque
 *  image par le composant React, une fois par fichier par l'export. */
export function rigTransforms(pose: Pose, s: RigState): Partial<Record<RigKey, RigOut>> {
  const B = BODY[pose];
  const yaw = (B.head.yaw + s.yaw) * DEG;
  const pitch = s.pitch * DEG;
  const out: Partial<Record<RigKey, RigOut>> = {};
  const set = (k: RigKey, m: Mat, opacity?: number) => { out[k] = { transform: fmtMat(m), opacity }; };

  const lift = Math.max(0, s.hop);
  set("shadow", sc(1 - lift / 70, 1 - lift / 90, B.shadow.cx, B.shadow.cy), 1 - Math.min(0.5, lift / 40));
  set("owl", tr(0, -s.hop));
  set("torso", sc(1 + 0.006 * s.breath, 1 + 0.013 * s.breath, 200, 362));
  set("head", mul(tr(B.head.dx, B.head.dy - 1.4 * s.breath), rot(s.roll, HEAD.neck[0], HEAD.neck[1])));
  set("hood", hoodMatrix(yaw, pitch));
  const vis = (p: Plane) => {
    const f = facing(p, yaw, pitch);
    return Math.max(0, Math.min(1, (f - 0.1) / 0.12));
  };
  for (const side of ["left", "right"] as const) {
    const pl = PLANES[side];
    const o = vis(pl);
    set(`face-${side}`, planeMatrix(pl, yaw, pitch), o < 1 ? Math.round(o * 1000) / 1000 : undefined);
    const e = side === "left" ? EYE.l : EYE_R;
    const sign = side === "left" ? 1 : -1;
    set(`iris-${side}`, tr(s.lookX * 4.6, s.lookY * 3.6));
    set(`glint-${side}`, tr(-s.lookX * 2.6, -s.lookY * 2));
    set(`pupil-${side}`, sc(s.pupil, s.pupil, e[0] + s.lookX * 0, e[1]));
    set(`lid-${side}`, mul(tr(e[0], e[1] + LID_OPEN * (1 - s.lid)), rot(sign * s.lidTilt)));
    set(`lower-${side}`, mul(tr(e[0], e[1] + LOWER_OPEN * (1 - s.lower)), rot(-sign * s.lidTilt * 0.3)));
    set(`cheek-${side}`, tr(e[0], e[1] + CHEEK_OPEN * (1 - s.cheek)));
    const base = side === "left" ? EAR_BASE_L : mx(EAR_BASE_L);
    set(`ear-${side}`, rot(sign * s.ears, base[0], base[1]));
    const w = B.wings[side];
    // Soulever l'aile = écarter sa pointe du corps (sens horaire pour l'aile gauche).
    if (w) set(`wing-${side}`, rot(sign * s.wing * (side === (B.wingBehind ?? "") ? 0.3 : 1), w.shoulder[0], w.shoulder[1]));
  }
  for (const f of BEAK_FACETS) set(f.key, facetMatrix(f.tri.map((k) => BEAK[k]) as [P, P, P], f.tri.map((k) => BEAK_3D[k]) as [V3, V3, V3], yaw, pitch));
  const sp = Math.max(0, Math.min(1, s.sparkle));
  set("sparkle", sc(0.55 + 0.45 * sp, 0.55 + 0.45 * sp, B.sparkle[0], B.sparkle[1]), sp);
  return out;
}

// ================================================================================================
// Identité (piste C2 retenue) : symbole, versions monochromes, tête de la mascotte
// ================================================================================================
export type Ground = "ivory" | "obsidian";

/** Cadre de la tête (pointes des aigrettes → menton), calculé depuis SPEC. */
export const HEAD_FRAME = (() => {
  const x = Math.min(TUFT.tip[0], K.side), y = Math.min(TUFT.tip[1], K.top);
  return { x, y, w: 400 - 2 * x, h: D.chin[1] - y };
})();

const endOf = (c: Cmd, prev: P): P => (c[0] === "C" ? c[3] : c[0] === "Q" ? c[2] : c[0] === "A" ? c[6] : c[0] === "Z" ? prev : c[1]);
/** Parcours inverse d'un tracé ouvert (M, L, C seulement). */
function reversePath(cmds: Cmd[]): Cmd[] {
  const ends: P[] = [];
  let cur: P = [0, 0];
  for (const c of cmds) { cur = endOf(c, cur); ends.push(cur); }
  const out: Cmd[] = [["M", ends[ends.length - 1]!]];
  for (let i = cmds.length - 1; i > 0; i--) {
    const c = cmds[i]!;
    out.push(c[0] === "C" ? ["C", c[2], c[1], ends[i - 1]!] : ["L", ends[i - 1]!]);
  }
  return out;
}
function circleCmds(cx: number, cy: number, r: number): Cmd[] {
  return [["M", [cx - r, cy]], ["A", r, r, 0, 0, 1, [cx + r, cy]], ["A", r, r, 0, 0, 1, [cx - r, cy]], ["Z"]];
}
function beakKite(scale = 1): Cmd[] {
  const c = BEAK.c, k = (p: P): P => [c[0] + (p[0] - c[0]) * scale, c[1] + (p[1] - c[1]) * scale];
  return [["M", k(BEAK.t)], ["L", k(BEAK.l)], ["L", k(BEAK.b)], ["L", k(BEAK.r)], ["Z"]];
}

export interface SymbolOptions {
  /** Version optique des petites tailles (≤ 32 px) : yeux et reflet agrandis. */
  small?: boolean;
  /** Médaillon obsidienne derrière la tête (l'obole d'Athènes) : obligatoire sur fond clair. */
  medallion?: boolean;
  /** Une seule couleur : le capuchon et le disque fusionnent, le bec devient un évidement. */
  mono?: boolean;
}
/** Version optique des petites tailles : yeux agrandis, paupière moins basse, médaillon resserré, bec
 *  un peu plus grand, pas de reflet (un pixel isolé serait du bruit). Même tête, même construction. */
export const SMALL = { eyeGrow: 4, lid: 0.86, beak: 1.18, medallionMargin: 5 };
const eyeGrow = (small: boolean) => (small ? SMALL.eyeGrow : 0);
/** Œil du symbole : disque noir dont le haut est coupé par la paupière au repos (regard posé). */
function lidded(c: P, r: number, small = false): Cmd[] {
  const h = r * (small ? SMALL.lid : SPEC.eye.lid);
  if (h >= r) return circleCmds(c[0], c[1], r);
  const dx = Math.sqrt(r * r - h * h);
  return [["M", [c[0] - dx, c[1] - h]], ["A", r, r, 0, 1, 0, [c[0] + dx, c[1] - h]], ["Q", [c[0], c[1] - h - r * 0.14], [c[0] - dx, c[1] - h]], ["Z"]];
}
const eyeHoles = (small: boolean): Cmd[][] => [EYE.l, EYE_R].map((c) => lidded(c, SPEC.eye.r + eyeGrow(small), small));
/** Reflet (même place dans les deux yeux), un peu plus gros dans la version optique. */
function glintCmds(c: P, small: boolean): Cmd[] {
  const r = SPEC.eye.r + eyeGrow(small);
  const [x, y, rr] = highlightAt(c, r);
  return circleCmds(x, y, rr * (small ? 1.3 : 1));
}
const glints = (small: boolean): Cmd[][] => (small ? [] : [glintCmds(EYE.l, small), glintCmds(EYE_R, small)]);

/** Filet du disque facial en négatif : bande effilée qui suit la double arche (joue → œil → V → œil → joue),
 *  posée juste à l'intérieur du disque. Un seul tracé continu (pas de recouvrement au V, donc aucun
 *  remplissage parasite en règle evenodd) ; échantillonné finement, coordonnées au dixième. */
function rimBand(small: boolean): Cmd[] {
  const w0 = SPEC.rim.width * (small ? 1.9 : 1), taper = SPEC.rim.taper, inset = 0.4;
  const sample = (cmds: Cmd[], n = 14): { p: P; t: P }[] => {
    const out: { p: P; t: P }[] = [];
    for (const sg of segsOf(cmds)) for (let i = out.length ? 1 : 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const p = bez(sg.a, sg.b, sg.c, sg.d, t);
      const d: P = [3 * (u * u * (sg.b[0] - sg.a[0]) + 2 * u * t * (sg.c[0] - sg.b[0]) + t * t * (sg.d[0] - sg.c[0])), 3 * (u * u * (sg.b[1] - sg.a[1]) + 2 * u * t * (sg.c[1] - sg.b[1]) + t * t * (sg.d[1] - sg.c[1]))];
      const L = Math.hypot(d[0], d[1]) || 1;
      out.push({ p, t: [d[0] / L, d[1] / L] });
    }
    return out;
  };
  const leftArch = sample(reversePath(BROW_EDGE_L)); // joue → sommet → V
  const rightArch = sample(mirrorCmds(BROW_EDGE_L)); // V → sommet → joue
  const pts = [...leftArch, ...rightArch.slice(1)];
  const iV = leftArch.length - 1;
  // V : normale = bissectrice des deux tangentes, longueur corrigée (onglet).
  const tin = leftArch[iV]!.t, tout = rightArch[0]!.t;
  const nIn: P = [-tin[1], tin[0]], nOut: P = [-tout[1], tout[0]];
  const bis: P = [(nIn[0] + nOut[0]) / 2, (nIn[1] + nOut[1]) / 2];
  const bl = Math.hypot(bis[0], bis[1]) || 1;
  const miter = 1 / Math.max(0.35, bl);
  let len = 0;
  const acc = pts.map((q, i) => (i ? (len += Math.hypot(q.p[0] - pts[i - 1]!.p[0], q.p[1] - pts[i - 1]!.p[1])) : 0));
  const total = len;
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const width = (s: number) => w0 * (taper + (1 - taper) * ease(s / (0.22 * total)) * ease((total - s) / (0.22 * total)));
  const side = (k: number) => pts.map((q, i) => {
    const n: P = i === iV ? [bis[0] / bl, bis[1] / bl] : [-q.t[1], q.t[0]];
    const m = i === iV ? miter : 1;
    const off = (inset + k * width(acc[i]!)) * m;
    return [q.p[0] + n[0] * off, q.p[1] + n[1] * off] as P;
  });
  const outer = side(0), inner = side(1).reverse();
  const r = (p: P): P => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  return [["M", r(outer[0]!)], ...outer.slice(1).map((p) => ["L", r(p)] as Cmd), ...inner.map((p) => ["L", r(p)] as Cmd), ["Z"]];
}

/** Symbole : tête de face. Deux aplats (capuchon sable, disque facial ivoire : le V du front naît de
 *  leur seule rencontre, sans trait), yeux évidés (ils prennent la couleur du médaillon ou du fond),
 *  un reflet, bec champagne — unique accent chaud. Sur fond clair : toujours sur médaillon. */
export function headNodes(ground: Ground, o: SymbolOptions = {}): Node[] {
  const small = !!o.small;
  const medal = o.medallion ?? ground === "ivory";
  const R = MEDALLION;
  const bk = small ? SMALL.beak : 1;
  if (o.mono) {
    const ink = ground === "ivory" ? C.obsidian : C.ivory;
    const d = [silhouette(), ...eyeHoles(small), ...glints(small), beakKite(bk), rimBand(small)].map(dOf).join("");
    return [g("head", [{ tag: "path", part: "head-solid", attrs: { d, fill: ink, "fill-rule": "evenodd" } }])];
  }
  const Rr = small ? R.rSmall : R.r;
  return [
    ...(medal ? [circle("medallion", R.cx, R.cy, Rr, C.obsidian)] : []),
    g("head", [
      { tag: "path", part: "hood", attrs: { d: [silhouette(), ...eyeHoles(small), rimBand(small)].map(dOf).join(""), fill: C.hood, "fill-rule": "evenodd" } },
      { tag: "path", part: "face", attrs: { d: [heart(), ...eyeHoles(small), ...glints(small), rimBand(small)].map(dOf).join(""), fill: C.ivory, "fill-rule": "evenodd" } },
      path("beak", beakKite(bk), C.champagne),
    ]),
  ];
}

/** Symbole monochrome sur médaillon (règle evenodd) : le médaillon est l'encre, la tête est réservée
 *  (couleur du support) ; yeux et bec restent à l'encre, le reflet est réservé. */
export function symbolMonoMedallionPath(small = false): string {
  const R = MEDALLION;
  return [circleCmds(R.cx, R.cy, small ? R.rSmall : R.r), silhouette(), ...eyeHoles(small), ...glints(small), beakKite(small ? SMALL.beak : 1), rimBand(small)].map(dOf).join("");
}

/** Points de construction calculés (schémas, guide d'usage, vocabulaire de mouvement). */
export const ANCHORS = {
  v: D.v, apex: D.apex, corner: TUFT.base, tip: TUFT.tip, attach: TUFT.attach, cheek: D.cheek, jaw: D.jaw, chin: D.chin,
  beak: SPEC.beak.top, eye: SPEC.eye.c, eyeR: SPEC.eye.r,
};
/** Contours nus (chaînes de tracé) : silhouette complète et disque facial en cœur. */
export function outlinePaths(): { silhouette: string; face: string; eyes: string; beak: string } {
  return { silhouette: dOf(silhouette()), face: dOf(heart()), eyes: eyeHoles(false).map(dOf).join(""), beak: dOf(beakKite()) };
}

// ---- Grammaire visuelle : mesures prises SUR la géométrie (le guide les affiche, rien n'est recopié) ----
type Seg = { a: P; b: P; c: P; d: P };
function segsOf(cmds: Cmd[]): Seg[] {
  const out: Seg[] = [];
  let cur: P = [0, 0], start: P = [0, 0];
  for (const c of cmds) {
    if (c[0] === "M") { cur = c[1]; start = c[1]; }
    else if (c[0] === "L") { out.push({ a: cur, b: cur, c: c[1], d: c[1] }); cur = c[1]; }
    else if (c[0] === "C") { out.push({ a: cur, b: c[1], c: c[2], d: c[3] }); cur = c[3]; }
    else if (c[0] === "Q") { const q = c[1], e = c[2]; out.push({ a: cur, b: [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], c: [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])], d: e }); cur = e; }
    else if (c[0] === "A") { out.push({ a: cur, b: cur, c: c[6], d: c[6] }); cur = c[6]; }
    else if (c[0] === "Z") { if (cur[0] !== start[0] || cur[1] !== start[1]) out.push({ a: cur, b: cur, c: start, d: start }); cur = start; }
  }
  return out;
}
/** Aire d'un contour fermé (polygone échantillonné ; les arcs de cercle sont traités à part). */
function areaOf(cmds: Cmd[]): number {
  const pts: P[] = [];
  let cur: P = [0, 0];
  for (const c of cmds) {
    if (c[0] === "M") { cur = c[1]; pts.push(cur); }
    else if (c[0] === "A") {
      // Arc de cercle : échantillonné finement à partir du centre déduit (rayon r, petit/grand arc, sens).
      const [, r, , , large, sweep, e] = c;
      const mx2 = (cur[0] + e[0]) / 2, my2 = (cur[1] + e[1]) / 2, dx = e[0] - cur[0], dy = e[1] - cur[1], q = Math.hypot(dx, dy);
      const h = Math.sqrt(Math.max(0, r * r - (q / 2) ** 2)) * ((large === sweep) ? -1 : 1);
      const cx = mx2 - (h * dy) / q, cy = my2 + (h * dx) / q;
      let a0 = Math.atan2(cur[1] - cy, cur[0] - cx), a1 = Math.atan2(e[1] - cy, e[0] - cx);
      if (sweep && a1 < a0) a1 += 2 * Math.PI;
      if (!sweep && a1 > a0) a1 -= 2 * Math.PI;
      for (let i = 1; i <= 96; i++) { const t = a0 + ((a1 - a0) * i) / 96; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
      cur = e;
    } else if (c[0] === "Z") { /* fermé */ }
    else {
      const sg = segsOf([["M", cur], c])[0]!;
      for (let i = 1; i <= 32; i++) pts.push(bez(sg.a, sg.b, sg.c, sg.d, i / 32));
      cur = sg.d;
    }
  }
  let A2 = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i]!, q = pts[(i + 1) % pts.length]!; A2 += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(A2) / 2;
}
/** Rayon de courbure d'une cubique au paramètre t. */
function curvatureRadius(sg: Seg, t: number): number {
  const u = 1 - t;
  const d1: P = [3 * (u * u * (sg.b[0] - sg.a[0]) + 2 * u * t * (sg.c[0] - sg.b[0]) + t * t * (sg.d[0] - sg.c[0])), 3 * (u * u * (sg.b[1] - sg.a[1]) + 2 * u * t * (sg.c[1] - sg.b[1]) + t * t * (sg.d[1] - sg.c[1]))];
  const d2: P = [6 * (u * (sg.c[0] - 2 * sg.b[0] + sg.a[0]) + t * (sg.d[0] - 2 * sg.c[0] + sg.b[0])), 6 * (u * (sg.c[1] - 2 * sg.b[1] + sg.a[1]) + t * (sg.d[1] - 2 * sg.c[1] + sg.b[1]))];
  const cross = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]);
  return cross < 1e-9 ? Infinity : Math.hypot(d1[0], d1[1]) ** 3 / cross;
}
const deg = (r: number) => (r * 180) / Math.PI;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Mesures de la grammaire visuelle (repère 400 ; angles en degrés, rapports sans unité). */
export function measure() {
  const tuftAxis: P = [TUFT.tip[0] - (TUFT.base[0] + TUFT.attach[0]) / 2, TUFT.tip[1] - (TUFT.base[1] + TUFT.attach[1]) / 2];
  const vTan = (BROW_EDGE_L[1] as readonly ["C", P, P, P])[1];
  const vSlope = deg(Math.atan2(D.v[1] - vTan[1], D.v[0] - vTan[0]));
  const chinTan: P = add(D.chin, -20, -3);
  const chinSlope = deg(Math.atan2(D.chin[1] - chinTan[1], D.chin[0] - chinTan[0]));
  const bw = BEAK.r[0] - BEAK.l[0], bh = BEAK.b[1] - BEAK.t[1];
  const beakBottom = 2 * deg(Math.atan2(bw / 2, BEAK.b[1] - BEAK.l[1]));
  const beakTop = 2 * deg(Math.atan2(bw / 2, BEAK.l[1] - BEAK.t[1]));
  const beakEdge = deg(Math.atan2(BEAK.b[1] - BEAK.l[1], bw / 2));
  const domeTop = curvatureRadius({ a: DOME_L[0], b: DOME_L[1], c: DOME_L[2], d: DOME_L[3] }, 1);
  const domeSide = curvatureRadius({ a: DOME_L[0], b: DOME_L[1], c: DOME_L[2], d: DOME_L[3] }, 0.02);
  const archSeg = segsOf(BROW_EDGE_L)[1]!;
  const cheek = curvatureRadius(archSeg, 0.6);
  const headW = 400 - 2 * K.side, headH = D.chin[1] - K.top;
  const silA = areaOf(silhouette()), faceA = areaOf(heart()), beakA = areaOf(beakKite());
  const eyeA = eyeHoles(false).reduce((n, e) => n + areaOf(e), 0);
  const hoodA = silA - faceA;
  return {
    tuftLean: r1(90 - deg(Math.atan2(-tuftAxis[1], -tuftAxis[0]))), // inclinaison de l'aigrette depuis la verticale
    tuftLength: r1(Math.hypot(...tuftAxis)),
    browV: r1(180 - 2 * vSlope), // ouverture du V du front (180 = plat)
    browSlope: r1(vSlope),
    chin: r1(180 - 2 * chinSlope), // ouverture de la pointe du menton
    beak: { width: r1(bw), height: r1(bh), ratio: r1((bw / bh) * 100) / 100, topAngle: r1(beakTop), bottomAngle: r1(beakBottom), edgeSlope: r1(beakEdge) },
    radii: { eye: SPEC.eye.r, cheek: r1(cheek), domeSide: r1(domeSide), domeTop: r1(domeTop), medallion: MEDALLION.r },
    proportions: {
      headWidth: headW, headHeight: headH, headRatio: r1((headW / headH) * 100) / 100,
      eyeToHead: r1(((2 * SPEC.eye.r) / headW) * 1000) / 1000, eyeSpacingToHead: r1(((EYE_R[0] - EYE.l[0]) / headW) * 1000) / 1000,
      beakToHead: r1((bh / headH) * 1000) / 1000, eyeLid: SPEC.eye.lid,
    },
    areas: {
      hood: Math.round(hoodA), face: Math.round(faceA - eyeA - beakA), eyes: Math.round(eyeA), beak: Math.round(beakA),
      ivoryToChampagne: Math.round((hoodA + faceA - eyeA - beakA) / beakA),
      champagneShare: r1((beakA / silA) * 1000) / 10, // % de la tête
      blackShare: r1((eyeA / silA) * 1000) / 10,
    },
  };
}

/** Tête de la mascotte (mêmes aplats que le symbole, avec paupières), pour les fichiers et avatars. */
export function mascotHead(detail: Detail = FULL): Node {
  return head(detail);
}

/** Médaillon : l'obole d'Athènes (la chouette sur la monnaie), cercle seul, centré sur la tête. */
export const MEDALLION = (() => {
  const cx = 200, cy = HEAD_FRAME.y + HEAD_FRAME.h / 2 + 3;
  const reach = Math.hypot(cx - TUFT.tip[0], cy - TUFT.tip[1]);
  return { cx, cy, r: Math.round(reach + 16), rSmall: Math.round(reach + SMALL.medallionMargin) };
})();

/** viewBox carré du symbole (tête seule), marge comprise. */
export function symbolViewBox(o: SymbolOptions = {}): string {
  if (o.medallion ?? true) {
    const R = MEDALLION, r = o.small ? R.rSmall : R.r;
    return `${n2(R.cx - r)} ${n2(R.cy - r)} ${n2(2 * r)} ${n2(2 * r)}`;
  }
  const side = HEAD_FRAME.w + (o.small ? 12 : 40);
  const cy = HEAD_FRAME.y + HEAD_FRAME.h / 2;
  return `${n2(200 - side / 2)} ${n2(cy - side / 2)} ${n2(side)} ${n2(side)}`;
}

// ================================================================================================
// Sérialisation SVG (export) — le composant React rend le même graphe
// ================================================================================================
export interface SvgOptions {
  /** Préfixe des identifiants (plusieurs chouettes dans une même page). */
  idPrefix?: string;
  title?: string;
  desc?: string;
  /** Transformations du rig (sinon : aucune). */
  rig?: Partial<Record<RigKey, RigOut>>;
  viewBox?: string;
  width?: number;
  height?: number;
  /** Contenu ajouté avant la chouette (fond d'icône…). */
  before?: string;
  /** Transformation globale du contenu (cadrage d'une icône). */
  wrap?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function nodeToSvg(n: Node, o: SvgOptions, depth: number): string {
  const pad = "  ".repeat(depth);
  const pre = o.idPrefix ?? "";
  const attrs: Record<string, string | number | undefined> = {};
  if (n.part) attrs.id = pre + n.part;
  const r = n.rig ? o.rig?.[n.rig] : undefined;
  Object.assign(attrs, n.attrs ?? {});
  delete attrs["data-pivot"];
  if (r?.transform) attrs.transform = r.transform;
  if (r?.opacity !== undefined) attrs.opacity = n2(r.opacity);
  if (n.clip) attrs["clip-path"] = `url(#${pre}${n.clip})`;
  const a = Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(typeof v === "number" ? n2(v) : String(v))}"`).join("");
  if (n.tag === "title" || n.tag === "desc") return `${pad}<${n.tag}${a}>${esc(n.text ?? "")}</${n.tag}>`;
  if (!n.children?.length) return `${pad}<${n.tag}${a}/>`;
  const kids = n.children.map((c) => nodeToSvg(c, o, depth + 1)).join("\n");
  return `${pad}<${n.tag}${a}>\n${kids}\n${pad}</${n.tag}>`;
}

/** Déplace les <clipPath> dans un <defs> unique en tête (fichiers plus lisibles dans les éditeurs). */
export function hoistClips(nodes: Node[]): { defs: Node[]; rest: Node[] } {
  const defs: Node[] = [];
  const walk = (list: Node[]): Node[] => list.flatMap((n) => {
    if (n.tag === "clipPath") { defs.push(n); return []; }
    return [n.children ? { ...n, children: walk(n.children) } : n];
  });
  return { defs, rest: walk(nodes) };
}

export function toSvg(nodes: Node[], o: SvgOptions = {}): string {
  const { defs, rest } = hoistClips(nodes);
  const vb = o.viewBox ?? `0 0 ${SIZE} ${SIZE}`;
  const head = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${o.width ?? SIZE}" height="${o.height ?? SIZE}" role="img"${o.title ? ` aria-labelledby="${o.idPrefix ?? ""}title"` : ""}>`,
    ...(o.title ? [`  <title id="${o.idPrefix ?? ""}title">${esc(o.title)}</title>`] : []),
    ...(o.desc ? [`  <desc>${esc(o.desc)}</desc>`] : []),
  ];
  const body = [
    ...(defs.length ? [`  <defs>\n${defs.map((d) => nodeToSvg(d, o, 2)).join("\n")}\n  </defs>`] : []),
    ...(o.before ? [o.before] : []),
    ...(o.wrap ? [`  <g transform="${o.wrap}">`] : []),
    ...rest.map((n) => nodeToSvg(n, o, o.wrap ? 2 : 1)),
    ...(o.wrap ? ["  </g>"] : []),
  ];
  return [...head, ...body, "</svg>", ""].join("\n");
}
