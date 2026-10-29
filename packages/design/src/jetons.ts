// Jetons STATIQUES d'Égide (indépendants du thème) : espacements, typographie, rayons, bordures, ombres, durées et
// courbes de mouvement. Les couleurs et les réglages par thème viennent du moteur (themes.ts, moteur.ts).
// Référence : docs/design/DESIGN_SYSTEM.md § 2, 4–7 et MOTION_GUIDELINES.md § 2. Toutes les variables CSS sont
// préfixées « --eg- » (aucune collision avec les feuilles existantes du site, de Desktop ou de l'extension).

export const PREFIXE = "--eg-";

/** Espacements, base 4 px (`--eg-s-1` 2 px … `--eg-s-12` 96 px). La densité ne les change pas. */
export const ESPACEMENTS = { 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 20, 7: 24, 8: 32, 9: 40, 10: 48, 11: 64, 12: 96 } as const;

/** Familles (OFL, embarquées une seule fois : design/fonts). */
export const FAMILLES = {
  display: '"Marcellus", Georgia, "Times New Roman", serif',
  ui: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Tailles de texte en px, multipliées par `--eg-t-scale` (réglage « taille du texte » × préréglage). */
/** Échelle du texte (« Le Passage », 2026-10-28) : note 12-13, interface 15, corps 17, sous-titre 20, titres 22 et 30 ;
 *  les titres d'affiche sont fluides (TITRE_HEROS, --text-display du site). */
export const TAILLES_TEXTE = { xs: 12, s: 13, m: 15, l: 17, xl: 20, "d-s": 22, "d-m": 30 } as const;
/** Titre du héros du site (fluide), hors échelle. */
export const TITRE_HEROS = "clamp(44px, 5.4vw, 86px)";

/** Hauteurs et marges internes en px, multipliées par `--eg-density`. */
export const DIMENSIONS = { "h-ctl": 38, "h-seg": 32, "h-row": 36, "h-etabli": 52, "h-mini": 28, pad: 16, gap: 12 } as const;

/** Rayons dérivés de `--eg-r-panel` (0 à 20 px), proportions gardées (DESIGN_SYSTEM.md § 6). */
export const RAPPORTS_RAYONS = { control: 0.67, media: 0.5, sheet: 1.34 } as const;
export const RAYON_PASTILLE = "999px";

/** Bordures. Le focus garde toujours sa présence et son épaisseur (non personnalisable). */
export const BORDURES = { fine: "1px", forte: "1.5px", focus: "2px", "focus-decalage": "2px", fil: "2px", "fil-epais": "4px" } as const;

/** Ressorts de « Le Passage » (MOTION_GUIDELINES.md § 2) : durée perçue (s) et rebond (0 : aucun dépassement). La
 *  pastille (petits objets qui changent de forme) dépasse d'environ 3 % ; la feuille (panneaux, tiroirs) se pose sans
 *  rebond. Mêmes valeurs que les préréglages Motion du site (RESSORT dans web/src/lib/motion.ts). */
export const RESSORTS = { pastille: { duree: 0.45, rebond: 0.25 }, feuille: { duree: 0.5, rebond: 0 } } as const;

/** Ressort amorti normalisé (0 → 1) : position à l'instant t (s). */
export function positionRessort(t: number, duree: number, rebond: number): number {
  const z = 1 - rebond, w = (2 * Math.PI) / duree;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/** Durée (ms) jusqu'au repos (écart < 0,3 % tenu 50 ms) et courbe CSS linear() échantillonnée (49 points). */
export function courbeRessort(duree: number, rebond: number): { ms: number; css: string } {
  const x = (t: number) => positionRessort(t, duree, rebond);
  let T = duree * 0.6;
  while (T < 2.5 && (Math.abs(1 - x(T)) > 0.003 || Math.abs(1 - x(T + 0.05)) > 0.003)) T += 0.01;
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) pts.push(i === 48 ? "1" : String(Math.round(x((T * i) / 48) * 10000) / 10000));
  return { ms: Math.round(T * 1000), css: `linear(${pts.join(", ")})` };
}
const PASTILLE = courbeRessort(RESSORTS.pastille.duree, RESSORTS.pastille.rebond);
const FEUILLE = courbeRessort(RESSORTS.feuille.duree, RESSORTS.feuille.rebond);

/** Durées de base en ms, multipliées par `--eg-motion-scale` (1 complète, 1,25 douce, 0,5 réduite, 0 aucune). */
export const DUREES = { micro: 120, court: 160, moyen: 220, long: 320, fil: 260, recit: 700, pastille: PASTILLE.ms, feuille: FEUILLE.ms } as const;

/** Courbes (MOTION_GUIDELINES.md § 2) ; « pastille » et « feuille » : ressorts échantillonnés (navigateurs sans
 *  linear() : la déclaration est ignorée, la courbe « out » prend le relais dans les composants). */
export const COURBES = {
  out: "cubic-bezier(.23, 1, .32, 1)",
  move: "cubic-bezier(.77, 0, .175, 1)",
  sheet: "cubic-bezier(.32, .72, 0, 1)",
  pastille: PASTILLE.css,
  feuille: FEUILLE.css,
} as const;

/** Intensités de mouvement : [--eg-motion-scale, --eg-move]. */
export const MOUVEMENTS = { complete: [1, 1], douce: [1.25, 0.6], reduite: [0.5, 0], aucune: [0, 0] } as const;
/** Densités : --eg-density. */
export const DENSITES = { compacte: 0.86, standard: 1, aeree: 1.12 } as const;
/** Préréglages typographiques. */
export const TYPOS = { egide: "Égide", sobre: "Sobre", lecture: "Lecture" } as const;

/** Ombres et voiles par mode (le thème OLED n'a pas d'ombre : un bord seulement). */
export const EFFETS_MODE = {
  sombre: {
    sheen: "linear-gradient(180deg, rgba(255, 255, 255, .045), rgba(255, 255, 255, 0) 38%)",
    "shadow-pop": "0 18px 50px rgba(0, 0, 0, .5)",
    "shadow-1": "0 1px 2px rgba(0, 0, 0, .4)",
    scrim: "rgba(0, 0, 0, .56)",
  },
  clair: {
    sheen: "linear-gradient(180deg, rgba(255, 255, 255, .7), rgba(255, 255, 255, 0) 40%)",
    "shadow-pop": "0 16px 40px rgba(60, 48, 30, .16)",
    "shadow-1": "0 1px 2px rgba(60, 48, 30, .12)",
    scrim: "rgba(40, 34, 24, .28)",
  },
} as const;

/** Couches de superposition. */
export const PLANS = { menu: 40, dialogue: 50, toast: 60, infobulle: 70 } as const;
