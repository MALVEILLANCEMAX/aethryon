// Les thèmes officiels et le format « aethryon-theme » v1 (THEME_ENGINE.md § 3 et 4). Un thème est une DONNÉE :
// jamais de code, jamais d'URL. Valeurs reprises telles quelles de la démonstration validée (01-themes.js).
import type { DENSITES, MOUVEMENTS, TYPOS } from "./jetons.ts";

/** Les 19 rôles de couleur, seuls lus par les composants (`--eg-c-<rôle>`). */
export const ROLES = [
  "canvas", "surface", "raised", "sunken", "line", "line-strong", "control", "text", "text-2", "text-3",
  "accent", "accent-hover", "on-accent", "accent-text", "thread", "ok", "warn", "err", "focus",
] as const;
export type Role = (typeof ROLES)[number];
export type Couleurs = Record<Role, string>;

/** Jetons dérivés, calculés en hexadécimal par le moteur (jamais de color-mix dans les composants). */
export const DERIVES = ["hover", "accent-soft", "ok-soft", "err-soft", "medal-hi", "medal-lo", "medal-rim"] as const;
export type Derive = (typeof DERIVES)[number];

export const BASES = ["obsidian", "ivory", "oled", "midnight", "minimal"] as const;
export type BaseId = (typeof BASES)[number];
export type ThemeId = BaseId | "custom";
/** Ordre d'affichage des six thèmes. */
export const ORDRE_THEMES: readonly ThemeId[] = ["obsidian", "ivory", "oled", "midnight", "minimal", "custom"];

export type Mode = "sombre" | "clair";
export type Contraste = "standard" | "eleve";
export type Typo = keyof typeof TYPOS;
export type Densite = keyof typeof DENSITES;
export type Mouvement = keyof typeof MOUVEMENTS;
export interface Effets { sheen: boolean; grain: boolean }

export interface ThemeOfficiel {
  nom: string;
  mode: Mode;
  c: Couleurs;
  forme: number;
  densite: Densite;
  typo: Typo;
  effets: Effets;
  mouvement: Mouvement;
  medaille: readonly [string, string, string];
  oled?: true;
}

export const OFFICIELS: Readonly<Record<BaseId, ThemeOfficiel>> = {
  obsidian: {
    nom: "Obsidian", mode: "sombre", c: {
      canvas: "#101113", surface: "#16171A", raised: "#1D1E22", sunken: "#0B0C0E", line: "#2A2B30", "line-strong": "#3D3E44",
      control: "#6F6A61", text: "#EEE8DC", "text-2": "#ACA597", "text-3": "#8E887C", accent: "#C2A066", "accent-hover": "#D3B57F",
      "on-accent": "#19140B", "accent-text": "#D9C08E", thread: "#C9A86B", ok: "#74B39A", warn: "#D7A64A", err: "#E3896F", focus: "#E2C58E",
    },
    forme: 12, densite: "standard", typo: "egide", effets: { sheen: true, grain: false }, mouvement: "complete",
    medaille: ["#3A332A", "#0E0D0B", "#7A6440"],
  },
  ivory: {
    nom: "Ivory", mode: "clair", c: {
      canvas: "#FAF8F3", surface: "#F3EEE5", raised: "#FFFDF9", sunken: "#ECE6DA", line: "#E2D9CA", "line-strong": "#B8AC97",
      control: "#8C806D", text: "#17150F", "text-2": "#4D473D", "text-3": "#6B6459", accent: "#7E6034", "accent-hover": "#6C5129",
      "on-accent": "#FFFDF8", "accent-text": "#7A5F38", thread: "#A4814A", ok: "#2F6B57", warn: "#8A5A12", err: "#A3372B", focus: "#7A5F38",
    },
    forme: 12, densite: "standard", typo: "egide", effets: { sheen: true, grain: true }, mouvement: "complete",
    medaille: ["#FFFFFF", "#DCD0BC", "#B3976A"],
  },
  oled: {
    nom: "OLED", mode: "sombre", c: {
      canvas: "#000000", surface: "#000000", raised: "#0B0B0B", sunken: "#000000", line: "#262626", "line-strong": "#3C3C3C",
      control: "#6A6A6A", text: "#F2EEE6", "text-2": "#ADA79D", "text-3": "#8A857C", accent: "#D2B27A", "accent-hover": "#E0C391",
      "on-accent": "#120E06", "accent-text": "#DCC18F", thread: "#D2B27A", ok: "#74B39A", warn: "#D7A64A", err: "#E3896F", focus: "#E2C58E",
    },
    forme: 8, densite: "standard", typo: "egide", effets: { sheen: false, grain: false }, mouvement: "complete",
    medaille: ["#000000", "#000000", "#5B4A2E"], oled: true,
  },
  midnight: {
    nom: "Midnight", mode: "sombre", c: {
      canvas: "#0E1220", surface: "#131829", raised: "#1A2033", sunken: "#0A0D18", line: "#263049", "line-strong": "#3A4664",
      control: "#66729A", text: "#E7EAF2", "text-2": "#A9B1C6", "text-3": "#8C95AE", accent: "#D9C08C", "accent-hover": "#E7D2A6",
      "on-accent": "#15120A", "accent-text": "#E1CB9C", thread: "#C9D3E8", ok: "#7DBDA6", warn: "#D7A64A", err: "#E8907A", focus: "#C9D3E8",
    },
    forme: 12, densite: "standard", typo: "egide", effets: { sheen: true, grain: false }, mouvement: "douce",
    medaille: ["#2C3550", "#0A0D18", "#8C96B0"],
  },
  minimal: {
    nom: "Minimal", mode: "clair", c: {
      canvas: "#FBFBFA", surface: "#FFFFFF", raised: "#FFFFFF", sunken: "#F3F3F1", line: "#E7E7E4", "line-strong": "#C8C8C3",
      control: "#8E8E89", text: "#111111", "text-2": "#4A4A47", "text-3": "#6A6A66", accent: "#111111", "accent-hover": "#2B2B2B",
      "on-accent": "#FFFFFF", "accent-text": "#111111", thread: "#A8864F", ok: "#2E6B55", warn: "#855A14", err: "#A2382B", focus: "#111111",
    },
    forme: 6, densite: "compacte", typo: "sobre", effets: { sheen: false, grain: false }, mouvement: "reduite",
    medaille: ["#F3F3F1", "#F3F3F1", "#C8C8C3"],
  },
};

/** Jetons retouchables dans un thème : les 19 rôles (« c-<rôle> », #RRGGBB) et « r-panel » (0 à 20). */
export const JETONS_PERSO = [...ROLES.map((r) => `c-${r}` as const), "r-panel"] as const;
export type JetonPerso = (typeof JETONS_PERSO)[number];
export type JetonsTheme = { [K in `c-${Role}`]?: string } & { "r-panel"?: number };

export const FORMAT = "aethryon-theme";
export const SCHEMA_URL = "https://raccourci.malvu.fr/schemas/aethryon-theme.v1.json";
/** Taille maximale d'un fichier de thème (octets UTF-8). */
export const TAILLE_MAX = 16384;

export interface Graines {
  accent?: string;
  neutralHue?: number;
  neutralChroma?: number;
  background?: number;
  contrast?: Contraste;
}

/** Document « aethryon-theme » v1 (le seul format accepté à l'import, à l'export et dans le stockage). */
export interface DocTheme {
  $schema?: string;
  format: typeof FORMAT;
  schemaVersion: 1;
  id: string;
  name: string;
  author?: string;
  base: BaseId;
  seeds?: Graines;
  tokens?: JetonsTheme;
  typography?: { preset?: Typo; scale?: number };
  density?: Densite;
  motion?: { intensity: Mouvement };
  effects?: Partial<Effets>;
}

/** Document d'un thème officiel, sans aucune retouche. */
export function docOfficiel(base: BaseId): DocTheme {
  const o = OFFICIELS[base];
  return {
    format: FORMAT, schemaVersion: 1, id: "officiel." + base, name: o.nom, author: "AETHRYON", base,
    seeds: {}, tokens: {}, typography: { preset: o.typo, scale: 1 }, density: o.densite,
    motion: { intensity: o.mouvement }, effects: { ...o.effets },
  };
}

/** Thème personnalisé d'exemple (« Vert-de-gris »), proposé tant que l'utilisateur n'en a pas créé. */
export const CUSTOM_EXEMPLE: Readonly<DocTheme> = Object.freeze({
  format: FORMAT, schemaVersion: 1, id: "exemple.vert-de-gris", name: "Vert-de-gris", author: "", base: "obsidian",
  seeds: { accent: "#7DB59E", neutralHue: 200, neutralChroma: 0.008, background: 40, contrast: "standard" },
  tokens: { "r-panel": 18 }, typography: { preset: "egide", scale: 1 }, density: "aeree",
  motion: { intensity: "complete" }, effects: { sheen: true, grain: false },
} satisfies DocTheme);

/** Huit accents proposés par l'éditeur (DESIGN_SYSTEM.md, THEME_ENGINE.md § 6). */
export const ACCENTS: readonly (readonly [string, string])[] = [
  ["#C2A066", "Or patiné"], ["#7DB59E", "Vert-de-gris"], ["#B07A4F", "Bronze"], ["#AEB8CC", "Argent lunaire"],
  ["#8FA66A", "Laurier"], ["#B5544B", "Grenat"], ["#5E8FB8", "Bleu égéen"], ["#E9DFC9", "Ivoire"],
];

export const estBase = (v: unknown): v is BaseId => typeof v === "string" && (BASES as readonly string[]).includes(v);
export const estThemeId = (v: unknown): v is ThemeId => v === "custom" || estBase(v);

/** Copie profonde d'un document (données JSON seulement). */
export const cloner = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
