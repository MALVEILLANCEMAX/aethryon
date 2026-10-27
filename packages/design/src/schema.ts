// Validateur STRICT du format « aethryon-theme » v1 (THEME_ENGINE.md § 3), sans dépendance : aucun JavaScript, aucune
// URL (la seule adresse permise est celle du schéma, jamais chargée), aucune valeur CSS libre (couleurs #RRGGBB
// uniquement), nombres finis et bornés, listes fermées, clés inconnues refusées à chaque niveau, 16 Ko au plus.
// Messages en français, affichables tels quels (toujours rendus comme texte, jamais comme HTML).
import { estHex } from "./couleur.ts";
import { DENSITES, MOUVEMENTS, TYPOS } from "./jetons.ts";
import { MIGRATIONS, VERSION_SCHEMA, migrer, type DocBrut, type TableMigrations } from "./migrations.ts";
import { contrastesConformes, resoudreTheme, verifierContrastes, type MesureContraste, type ThemeResolu } from "./moteur.ts";
import { BASES, FORMAT, OFFICIELS, ROLES, SCHEMA_URL, TAILLE_MAX, estBase, type DocTheme } from "./themes.ts";

export type ResultatValidation =
  | { ok: true; doc: DocTheme; erreurs: []; rapport: string[] }
  | { ok: false; erreurs: string[] };

const CLES_RACINE = ["$schema", "format", "schemaVersion", "id", "name", "author", "base", "seeds", "tokens", "typography", "density", "motion", "effects"];
const CLES_GRAINES = ["accent", "neutralHue", "neutralChroma", "background", "contrast"];
const JETONS_COULEUR = new Set<string>(ROLES.map((r) => `c-${r}`));
/** Caractères de contrôle et de direction (usurpation de texte) refusés dans les textes libres. */
const CARACTERES_INTERDITS = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/;

const propre = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nombre = (v: unknown, a: number, b: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
const dans = (liste: object, v: unknown): boolean => typeof v === "string" && propre(liste, v);
const court = (s: string, n = 30): string => (s.length > n ? s.slice(0, n) + "…" : s);

function clesInconnues(o: Record<string, unknown>, permises: readonly string[], ou: string, E: string[]): void {
  const x = Object.keys(o).filter((k) => !permises.includes(k));
  if (x.length) E.push(`Clé${x.length > 1 ? "s" : ""} inconnue${x.length > 1 ? "s" : ""} ${ou} : ${x.slice(0, 6).map((k) => court(k)).join(", ")}.`);
}

function texteLibre(v: unknown, nom: string, min: number, max: number, E: string[]): void {
  if (typeof v !== "string" || v.trim().length < min || v.length > max) {
    E.push(min ? `« ${nom} » : texte de ${min} à ${max} caractères.` : `« ${nom} » : texte de ${max} caractères au plus.`);
  } else if (CARACTERES_INTERDITS.test(v)) E.push(`« ${nom} » : caractères de contrôle ou de direction interdits.`);
}

/** Valide un objet déjà analysé (après migration éventuelle). */
export function validerObjet(d: unknown): ResultatValidation {
  if (!estObjet(d)) return { ok: false, erreurs: ["Le fichier doit contenir un objet JSON."] };
  const E: string[] = [];
  clesInconnues(d, CLES_RACINE, "à la racine", E);
  if (d.$schema !== undefined && d.$schema !== SCHEMA_URL) E.push("« $schema » : seule l'adresse du schéma AETHRYON est permise.");
  if (d.format !== FORMAT) E.push("« format » doit valoir « aethryon-theme ».");
  if (typeof d.schemaVersion === "number" && d.schemaVersion > 1) return { ok: false, erreurs: [`Ce thème vient d'une version plus récente d'AETHRYON (schemaVersion ${d.schemaVersion}).`] };
  if (d.schemaVersion !== 1) E.push("« schemaVersion » doit valoir 1.");
  if (typeof d.id !== "string" || !/^[a-z0-9.-]{3,64}$/.test(d.id)) E.push("« id » : 3 à 64 caractères parmi a-z, 0-9, point et tiret.");
  texteLibre(d.name, "name", 1, 40, E);
  if (d.author !== undefined) texteLibre(d.author, "author", 0, 60, E);
  if (!estBase(d.base)) E.push("« base » doit être l'un de : " + BASES.join(", ") + ".");
  if (d.seeds !== undefined) {
    if (!estObjet(d.seeds)) E.push("« seeds » doit être un objet.");
    else {
      const s = d.seeds;
      clesInconnues(s, CLES_GRAINES, "dans « seeds »", E);
      if (s.accent !== undefined && !estHex(s.accent)) E.push("« seeds.accent » : couleur #RRGGBB.");
      if (s.neutralHue !== undefined && !nombre(s.neutralHue, 0, 360)) E.push("« seeds.neutralHue » : nombre de 0 à 360.");
      if (s.neutralChroma !== undefined && !nombre(s.neutralChroma, 0, 0.04)) E.push("« seeds.neutralChroma » : nombre de 0 à 0,04.");
      if (s.background !== undefined && !nombre(s.background, 0, 100)) E.push("« seeds.background » : nombre de 0 à 100.");
      if (s.contrast !== undefined && s.contrast !== "standard" && s.contrast !== "eleve") E.push("« seeds.contrast » : « standard » ou « eleve ».");
    }
  }
  if (d.tokens !== undefined) {
    if (!estObjet(d.tokens)) E.push("« tokens » doit être un objet.");
    else for (const [k, v] of Object.entries(d.tokens)) {
      if (k === "r-panel") { if (!nombre(v, 0, 20)) E.push("« r-panel » : nombre de 0 à 20."); }
      else if (!JETONS_COULEUR.has(k)) E.push(`Jeton non personnalisable : « ${court(k)} ».`);
      else if (!estHex(v)) E.push(`« ${k} » : couleur #RRGGBB uniquement (ni url(), ni var(), ni mot-clé CSS).`);
    }
  }
  if (d.typography !== undefined) {
    if (!estObjet(d.typography)) E.push("« typography » doit être un objet.");
    else {
      clesInconnues(d.typography, ["preset", "scale"], "dans « typography »", E);
      if (d.typography.preset !== undefined && !dans(TYPOS, d.typography.preset)) E.push("« typography.preset » : egide, sobre ou lecture.");
      if (d.typography.scale !== undefined && !nombre(d.typography.scale, 0.9, 1.25)) E.push("« typography.scale » : de 0,9 à 1,25.");
    }
  }
  if (d.density !== undefined && !dans(DENSITES, d.density)) E.push("« density » : compacte, standard ou aeree.");
  if (d.motion !== undefined) {
    if (!estObjet(d.motion)) E.push("« motion » doit être un objet.");
    else {
      clesInconnues(d.motion, ["intensity"], "dans « motion »", E);
      if (!dans(MOUVEMENTS, d.motion.intensity)) E.push("« motion.intensity » : complete, douce, reduite ou aucune.");
    }
  }
  if (d.effects !== undefined) {
    if (!estObjet(d.effects)) E.push("« effects » doit être un objet.");
    else {
      clesInconnues(d.effects, ["sheen", "grain"], "dans « effects »", E);
      for (const k of ["sheen", "grain"]) if (d.effects[k] !== undefined && typeof d.effects[k] !== "boolean") E.push(`« effects.${k} » : vrai ou faux.`);
    }
  }
  return E.length ? { ok: false, erreurs: E } : { ok: true, doc: d as unknown as DocTheme, erreurs: [], rapport: [] };
}

/** Valide le TEXTE d'un fichier de thème : taille, JSON, migration éventuelle, puis validation stricte. */
export function validerTexte(texte: string, migrations: TableMigrations = MIGRATIONS): ResultatValidation {
  if (typeof texte !== "string") return { ok: false, erreurs: ["Le contenu du thème doit être du texte."] };
  const octets = new TextEncoder().encode(texte).length;
  if (octets > TAILLE_MAX) return { ok: false, erreurs: [`Fichier trop lourd : ${Math.ceil(octets / 1024)} Ko (16 Ko au plus).`] };
  let d: unknown;
  try { d = JSON.parse(texte); } catch (e) {
    return { ok: false, erreurs: ["Ce n'est pas du JSON valide (" + court(String((e as Error).message), 80) + ")."] };
  }
  if (!estObjet(d)) return { ok: false, erreurs: ["Le fichier doit contenir un objet JSON."] };
  if (d.format !== FORMAT) return validerObjet(d);
  const m = migrer(d as DocBrut, migrations);
  if (!m.ok) return { ok: false, erreurs: [m.erreur] };
  const v = validerObjet(m.doc);
  if (!v.ok) return v;
  return { ...v, rapport: m.depuis !== VERSION_SCHEMA ? [`Thème mis à jour depuis la version ${m.depuis}.`, ...m.rapport] : m.rapport };
}

/** Document complet : chaque section présente, valeurs par défaut prises dans la base. */
export function normaliserDoc(doc: DocTheme): DocTheme {
  const b = OFFICIELS[doc.base];
  const graines = Object.fromEntries(Object.entries(doc.seeds ?? {}).filter(([, v]) => v !== undefined && v !== null));
  return {
    format: FORMAT, schemaVersion: 1, id: doc.id, name: doc.name, author: doc.author ?? "", base: doc.base,
    seeds: graines, tokens: { ...(doc.tokens ?? {}) },
    typography: { preset: doc.typography?.preset ?? b.typo, scale: doc.typography?.scale ?? 1 },
    density: doc.density ?? b.densite, motion: { intensity: doc.motion?.intensity ?? b.mouvement },
    effects: { sheen: doc.effects?.sheen ?? b.effets.sheen, grain: doc.effects?.grain ?? b.effets.grain },
  };
}

/** Texte JSON lisible d'un document (ordre de clés fixe), à enregistrer en « *.aethryon-theme.json ». */
export function exporterTheme(doc: DocTheme): string {
  const n = normaliserDoc(doc);
  const sortie: Record<string, unknown> = { $schema: SCHEMA_URL, format: FORMAT, schemaVersion: 1, id: n.id, name: n.name, author: n.author, base: n.base };
  if (Object.keys(n.seeds ?? {}).length) sortie.seeds = n.seeds;
  if (Object.keys(n.tokens ?? {}).length) sortie.tokens = n.tokens;
  sortie.typography = n.typography;
  sortie.density = n.density;
  sortie.motion = n.motion;
  sortie.effects = n.effects;
  return JSON.stringify(sortie, null, 2) + "\n";
}

/** Nom de fichier proposé à l'export. */
export const nomFichierTheme = (doc: DocTheme): string => (doc.id.replace(/^(perso|officiel|exemple)\./, "") || "theme") + ".aethryon-theme.json";

/** Identifiant « perso.<nom> » à partir d'un nom saisi. */
export function idDepuisNom(nom: string): string {
  const s = nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "perso." + (s || "mon-theme").slice(0, 50);
}

export type ResultatImport =
  | { ok: true; doc: DocTheme; theme: ThemeResolu; contrastes: MesureContraste[]; applicable: boolean; rapport: string[] }
  | { ok: false; erreurs: string[] };

/**
 * Import d'un fichier : validation stricte, résolution, contrôle des 27 contrastes. Un thème invalide est refusé ; un
 * thème valide mais en échec de contraste n'est PAS applicable tant qu'il n'est pas corrigé.
 */
export function importerTheme(texte: string, migrations: TableMigrations = MIGRATIONS): ResultatImport {
  const v = validerTexte(texte, migrations);
  if (!v.ok) return v;
  const doc = normaliserDoc(v.doc);
  const theme = resoudreTheme(doc);
  const contrastes = verifierContrastes(theme);
  return { ok: true, doc, theme, contrastes, applicable: contrastesConformes(theme), rapport: v.rapport };
}
