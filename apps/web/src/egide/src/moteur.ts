// Moteur de thèmes Égide (THEME_ENGINE.md § 5 bis et § 11). Chaîne : document de thème -> résolution (base +
// graines + retouches) -> jetons complets (+ dérivés) -> contrôle des 27 contrastes -> correction automatique.
// Port TypeScript, sans changement de règle, de docs/design/demo-egide/src/js/01-themes.js. Fonctions pures.
import { contraste, estHex, hexVersOklch, melange, oklch, resoudre } from "./couleur.ts";
import {
  OFFICIELS, ROLES, estBase, type BaseId, type Contraste, type Couleurs, type Densite, type Derive, type DocTheme,
  type Effets, type Graines, type Mode, type Mouvement, type Role, type Typo,
} from "./themes.ts";

export interface Seuils { texte: number; ui: number }

/** Un thème résolu : tout ce qu'il faut pour poser les variables CSS et contrôler les contrastes. */
export interface ThemeResolu {
  base: BaseId;
  /** Vrai pour un thème officiel sans aucune retouche (appliqué par la seule feuille CSS, sans style en ligne). */
  officiel: boolean;
  mode: Mode;
  oled: boolean;
  contraste: Contraste;
  seuils: Seuils;
  c: Couleurs;
  panel: number;
  typo: Typo;
  echelle: number;
  densite: Densite;
  mouvement: Mouvement;
  /** L'utilisateur a choisi une intensité différente de celle de la base : elle prime sur le réglage du système. */
  mouvementExplicite: boolean;
  effets: Effets;
  medaille: readonly [string, string, string] | null;
}

export type ToutesCouleurs = Couleurs & Record<Derive, string>;

const sensDe = (mode: Mode): 1 | -1 => (mode === "sombre" ? 1 : -1);

/* ---------- Génération à partir des graines (OKLCH) ---------- */
function genererNeutres(mode: Mode, s: Graines, c: Couleurs, seuils: Seuils): void {
  const h = s.neutralHue ?? 60, ch = s.neutralChroma ?? 0.006, fond = s.background ?? 40;
  const sombre = mode === "sombre";
  const L = sombre ? 0.12 + (fond / 100) * 0.14 : 0.995 - (fond / 100) * 0.08;
  const k = (d: number) => oklch(L + (sombre ? d : -d), ch, h);
  c.canvas = k(0);
  c.surface = k(0.022);
  c.raised = sombre ? k(0.048) : oklch(Math.min(1, L + 0.012), ch * 0.6, h);
  c.sunken = k(-0.026);
  c.line = k(0.085);
  c["line-strong"] = k(0.16);
  const sens = sensDe(mode), ct = ch * 0.7;
  const fonds = [c.surface, c.raised, c.canvas, c.sunken];
  c.text = oklch(sombre ? 0.94 : 0.2, Math.min(ct, 0.02), h);
  c["text-2"] = resoudre(oklch(sombre ? 0.74 : 0.42, ct, h), fonds, Math.max(seuils.texte + 2, 7), sens);
  c["text-3"] = resoudre(oklch(sombre ? 0.6 : 0.55, ct, h), fonds, seuils.texte + 0.15, sens);
  c.control = resoudre(oklch(sombre ? 0.5 : 0.62, ct, h), [c.surface, c.raised, c.canvas], seuils.ui + 0.15, sens);
}

/** Texte sur l'accent : encre ou ivoire, selon le meilleur contraste sur l'accent ET l'accent survolé. */
function choisirSurAccent(c: Couleurs, seuils: Seuils): boolean {
  const H = hexVersOklch(c.accent)[2];
  const encre = oklch(0.17, 0.012, H), ivoire = "#FFFDF8";
  const pire = (x: string) => Math.min(contraste(x, c.accent), contraste(x, c["accent-hover"]));
  c["on-accent"] = pire(encre) >= pire(ivoire) ? encre : ivoire;
  return pire(c["on-accent"]) >= seuils.texte;
}

function genererAccent(mode: Mode, hex: string, c: Couleurs, seuils: Seuils): void {
  const sombre = mode === "sombre", sens = sensDe(mode);
  const [L, C, H] = hexVersOklch(hex);
  c.accent = hex.toUpperCase();
  c["accent-hover"] = oklch(L + (sombre ? 0.06 : -0.06), C, H);
  c["accent-text"] = resoudre(hex, [c.surface, c.raised, c.canvas], seuils.texte + 0.15, sens);
  c.thread = resoudre(hex, [c.canvas, c.surface], seuils.ui + 0.2, sens);
  c.focus = c["accent-text"];
  choisirSurAccent(c, seuils);
}

function genererStatuts(mode: Mode, c: Couleurs, seuils: Seuils): void {
  const sombre = mode === "sombre", sens = sensDe(mode), fonds = [c.surface, c.raised, c.canvas];
  c.ok = resoudre(oklch(sombre ? 0.72 : 0.47, 0.08, 165), fonds, seuils.texte + 0.15, sens);
  c.warn = resoudre(oklch(sombre ? 0.76 : 0.5, 0.12, 75), fonds, seuils.texte + 0.15, sens);
  c.err = resoudre(oklch(sombre ? 0.72 : 0.5, 0.12, 35), fonds, seuils.texte + 0.15, sens);
}

const NEUTRES: readonly (keyof Graines)[] = ["neutralHue", "neutralChroma", "background"];

/** Vrai si le document ne retouche rien de sa base (aucune graine, aucun jeton, réglages = ceux de la base). */
export function estDocOfficielPur(doc: DocTheme): boolean {
  const b = OFFICIELS[doc.base];
  if (!b) return false;
  const s = doc.seeds ?? {}, t = doc.tokens ?? {}, ty = doc.typography ?? {}, e = doc.effects ?? {};
  return Object.values(s).every((v) => v == null) && Object.keys(t).length === 0
    && (ty.preset ?? b.typo) === b.typo && (ty.scale ?? 1) === 1 && (doc.density ?? b.densite) === b.densite
    && (doc.motion?.intensity ?? b.mouvement) === b.mouvement
    && (e.sheen ?? b.effets.sheen) === b.effets.sheen && (e.grain ?? b.effets.grain) === b.effets.grain;
}

/* ---------- Résolution : document -> jetons complets ---------- */
export function resoudreTheme(doc: DocTheme): ThemeResolu {
  const baseId: BaseId = estBase(doc.base) ? doc.base : "obsidian";
  const base = OFFICIELS[baseId];
  const mode = base.mode, s: Graines = doc.seeds ?? {};
  const eleve = s.contrast === "eleve";
  const seuils: Seuils = eleve ? { texte: 7, ui: 4.5 } : { texte: 4.5, ui: 3 };
  const c: Couleurs = { ...base.c };
  const neutres = NEUTRES.some((k) => s[k] != null);
  const sens = sensDe(mode);
  if (neutres) { genererNeutres(mode, s, c, seuils); genererStatuts(mode, c, seuils); }
  if (s.accent) genererAccent(mode, s.accent, c, seuils);
  else if (neutres) { // l'accent officiel reste, ses textes suivent les nouveaux fonds
    c["accent-text"] = resoudre(c["accent-text"], [c.surface, c.raised, c.canvas], seuils.texte + 0.15, sens);
    c.focus = resoudre(c.focus, [c.canvas, c.surface], seuils.ui + 0.2, sens);
  }
  if (eleve && !neutres) { // contraste élevé sur une base officielle : on relève seulement ce qui échoue
    const f = [c.surface, c.raised, c.canvas];
    for (const r of ["text-2", "text-3", "accent-text", "ok", "warn", "err"] as const) c[r] = resoudre(c[r], f, 7.1, sens);
    c.control = resoudre(c.control, f, 4.6, sens);
  }
  const t = doc.tokens ?? {};
  const rp = t["r-panel"];
  const panel = typeof rp === "number" && Number.isFinite(rp) ? rp : base.forme;
  const mouvement = doc.motion?.intensity ?? base.mouvement;
  const r: ThemeResolu = {
    base: baseId, officiel: estDocOfficielPur(doc), mode, oled: !!base.oled && !neutres, contraste: eleve ? "eleve" : "standard",
    seuils, c, panel, typo: doc.typography?.preset ?? base.typo, echelle: doc.typography?.scale ?? 1,
    densite: doc.density ?? base.densite, mouvement, mouvementExplicite: mouvement !== base.mouvement,
    effets: { ...base.effets, ...dropUndefined(doc.effects ?? {}) }, medaille: neutres || s.accent ? null : base.medaille,
  };
  // Ce qui est GÉNÉRÉ est garanti conforme par calcul ; les retouches explicites ne sont jamais corrigées en silence.
  if (neutres || s.accent || eleve) corrigerEnPlace(r);
  for (const role of ROLES) {
    const v = t[`c-${role}`];
    if (estHex(v)) c[role] = v.toUpperCase();
  }
  if (estHex(t["c-accent"]) && !s.accent) {
    const [L, C, H] = hexVersOklch(c.accent);
    if (!estHex(t["c-accent-hover"])) c["accent-hover"] = oklch(L + (mode === "sombre" ? 0.06 : -0.06), C, H);
    if (!estHex(t["c-on-accent"])) choisirSurAccent(c, seuils);
  }
  if (Object.keys(t).some((k) => k.startsWith("c-"))) r.medaille = null;
  return r;
}

function dropUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Jetons dérivés, calculés en hexadécimal (et non par color-mix) pour que axe et nos contrôles lisent des couleurs
 * réelles : survol, accent doux, fonds d'état, face et tranche de la médaille.
 */
export function derives(r: ThemeResolu): Record<Derive, string> {
  const c = r.c, sombre = r.mode === "sombre";
  const [hi, lo, rim] = r.medaille ?? (sombre
    ? [oklch(hexVersOklch(c.raised)[0] + 0.12, 0.02, hexVersOklch(c.accent)[2]), c.sunken, melange(c.accent, c["line-strong"], 0.55)]
    : ["#FFFFFF", melange(c["line-strong"], c.sunken, 0.35), melange(c.accent, c["line-strong"], 0.5)]);
  return {
    hover: melange(c.text, c.surface, sombre ? 0.07 : 0.06),
    "accent-soft": melange(c.accent, c.surface, sombre ? 0.16 : 0.12),
    "ok-soft": melange(c.ok, c.surface, 0.14),
    "err-soft": melange(c.err, c.surface, 0.12),
    "medal-hi": hi, "medal-lo": lo, "medal-rim": rim,
  };
}

export const couleursCompletes = (r: ThemeResolu): ToutesCouleurs => ({ ...r.c, ...derives(r) });

/* ---------- Contrôle des contrastes ---------- */
type Cle = Role | Derive;
/** Les 27 paires réellement utilisées (DESIGN_SYSTEM.md § 3.2) : [texte ou trait, fond, seuil standard]. */
export const PAIRES: readonly (readonly [Role, Cle, 4.5 | 3])[] = [
  ["text", "canvas", 4.5], ["text", "surface", 4.5], ["text", "raised", 4.5], ["text", "hover", 4.5], ["text", "accent-soft", 4.5],
  ["text-2", "surface", 4.5], ["text-2", "accent-soft", 4.5], ["text-2", "raised", 4.5], ["text-2", "sunken", 4.5], ["text-2", "hover", 4.5],
  ["text-3", "canvas", 4.5], ["text-3", "surface", 4.5], ["text-3", "raised", 4.5], ["text-3", "sunken", 4.5],
  ["accent-text", "surface", 4.5], ["accent-text", "raised", 4.5], ["on-accent", "accent", 4.5], ["on-accent", "accent-hover", 4.5],
  ["ok", "surface", 4.5], ["warn", "surface", 4.5], ["err", "surface", 4.5], ["err", "err-soft", 4.5],
  ["control", "canvas", 3], ["control", "surface", 3], ["thread", "canvas", 3], ["thread", "surface", 3], ["focus", "canvas", 3],
];

export interface MesureContraste {
  a: Role;
  b: Cle;
  /** Seuil appliqué (7 / 4,5 en contraste élevé). */
  seuil: number;
  /** Rapport mesuré, arrondi au centième. */
  v: number;
  ok: boolean;
  /** APCA (Lc), à titre d'information seulement. */
  apca?: number;
}

export function verifierContrastes(r: ThemeResolu): MesureContraste[] {
  const tout = couleursCompletes(r);
  const eleve = r.seuils.texte > 4.5;
  return PAIRES.map(([a, b, s]) => {
    const seuil = eleve ? (s === 4.5 ? 7 : 4.5) : s;
    const v = contraste(tout[a], tout[b]);
    return { a, b, seuil, v: Math.round(v * 100) / 100, ok: v >= seuil - 0.005 };
  });
}

export const contrastesConformes = (r: ThemeResolu): boolean => verifierContrastes(r).every((m) => m.ok);

export interface Correction { role: Role; avant: string; apres: string }

/**
 * Correction automatique : on déplace la luminosité du TEXTE fautif, jamais celle de l'accent choisi quand c'est
 * évitable ; le texte sur l'accent bascule entre encre et ivoire ; en dernier recours l'accent s'éclaircit ou
 * s'assombrit (et, au troisième tour, le fond sous un texte principal). Modifie `r`.
 */
function corrigerEnPlace(r: ThemeResolu): Correction[] {
  const avant: Couleurs = { ...r.c }, sens = sensDe(r.mode);
  for (let tour = 0; tour < 3; tour++) {
    const echecs = verifierContrastes(r).filter((x) => !x.ok);
    if (!echecs.length) break;
    for (const e of echecs) {
      const tout = couleursCompletes(r);
      if (e.a === "on-accent") {
        if (!choisirSurAccent(r.c, r.seuils)) {
          r.c.accent = resoudre(r.c.accent, [r.c["on-accent"]], e.seuil + 0.1, r.c["on-accent"] === "#FFFDF8" ? -1 : 1);
        }
        r.c["accent-hover"] = r.c.accent;
        continue;
      }
      if (e.a === "text" && (e.b === "canvas" || e.b === "surface" || e.b === "raised") && tour === 2) {
        r.c[e.b] = resoudre(r.c[e.b], [r.c.text], e.seuil + 0.1, sens === 1 ? -1 : 1);
      } else {
        r.c[e.a] = resoudre(r.c[e.a], [tout[e.b]], e.seuil + 0.15, sens);
      }
    }
  }
  return ROLES.filter((k) => avant[k] !== r.c[k]).map((k) => ({ role: k, avant: avant[k], apres: r.c[k] }));
}

/** Correction automatique SANS modifier l'entrée : renvoie le thème corrigé et la liste des couleurs changées. */
export function corrigerContrastes(r: ThemeResolu): { theme: ThemeResolu; corrections: Correction[] } {
  const copie: ThemeResolu = { ...r, c: { ...r.c }, seuils: { ...r.seuils }, effets: { ...r.effets } };
  const corrections = corrigerEnPlace(copie);
  if (corrections.length) copie.medaille = null;
  return { theme: copie, corrections };
}

/** Noms français des rôles (éditeur, rapports de contraste). */
export const NOMS_ROLES: Readonly<Record<Cle, string>> = {
  canvas: "fond", surface: "panneau", raised: "élément choisi", sunken: "creux", hover: "survol", "accent-soft": "accent doux",
  text: "texte", "text-2": "texte secondaire", "text-3": "métadonnées", "accent-text": "texte or", "on-accent": "texte sur accent",
  accent: "accent", "accent-hover": "accent survolé", ok: "succès", warn: "avertissement", err: "erreur", "err-soft": "fond d'erreur",
  "ok-soft": "fond de succès", control: "bord de contrôle", thread: "fil", focus: "anneau de focus", line: "filet", "line-strong": "filet fort",
  "medal-hi": "face de la médaille", "medal-lo": "ombre de la médaille", "medal-rim": "tranche de la médaille",
};
