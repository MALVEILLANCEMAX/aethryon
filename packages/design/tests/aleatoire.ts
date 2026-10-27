// Générateur pseudo-aléatoire déterministe (mulberry32) : les essais « 1 000 thèmes au hasard » sont reproductibles.
import { BASES, type DocTheme } from "../src/themes.ts";

export function prng(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hexAuHasard = (r: () => number): string =>
  "#" + [0, 0, 0].map(() => Math.floor(r() * 256).toString(16).padStart(2, "0")).join("").toUpperCase();

/** Thème GÉNÉRÉ au hasard (comme l'éditeur : base, accent, teinte, saturation, clarté, contraste). */
export function themeGenere(r: () => number, i: number): DocTheme {
  return {
    format: "aethryon-theme", schemaVersion: 1, id: `essai.${i}`, name: `Essai ${i}`,
    base: BASES[Math.floor(r() * BASES.length)] ?? "obsidian",
    seeds: {
      accent: hexAuHasard(r), neutralHue: Math.round(r() * 360), neutralChroma: Math.round(r() * 40) / 1000,
      background: Math.round(r() * 100), contrast: r() < 0.3 ? "eleve" : "standard",
    },
  };
}

/** Retouches LIBRES au hasard (accent et fond quelconques, posés à la main, comme la mesure de THEME_ENGINE.md § 11). */
export function themeRetouche(r: () => number, i: number): DocTheme {
  return {
    format: "aethryon-theme", schemaVersion: 1, id: `retouche.${i}`, name: `Retouche ${i}`,
    base: BASES[Math.floor(r() * BASES.length)] ?? "obsidian",
    tokens: { "c-accent": hexAuHasard(r), "c-canvas": hexAuHasard(r) },
  };
}
