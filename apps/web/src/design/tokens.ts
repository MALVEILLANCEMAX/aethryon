// AETHRYON — SOURCE UNIQUE des jetons de design (proposition « chouette vectorielle », docs/DESIGN-SYSTEM.md).
//
// Consommateurs :
//  - scripts/tokens.mjs génère, à partir de ce module, le bloc @theme de Tailwind 4 (site, espace
//    personnel, Control Center), les variables de l'extension (popup et réglages, clair + sombre), un
//    export DTCG (outils de design) et le tableau des contrastes ;
//  - la chouette vectorielle (ui/brand/athena/geometry.ts) y prend toutes ses couleurs.
// Proposition : les feuilles actuelles (src/styles.css, extension/src/popup/popup.css) ne sont PAS encore
// branchées sur les fichiers générés ; `node scripts/tokens.mjs --check` prouve que les valeurs générées
// sont égales aux valeurs d'aujourd'hui pour chaque jeton qui existe déjà.
//
// Module pur (aucun effet de bord, aucune dépendance) : importable par Node (type stripping) et par Vite.

/** Les six couleurs de la planche officielle (brand/aethryon-kit/sources/official-art-direction.png). */
export const BRAND = {
  ivory: "#FAF8F3",
  champagne: "#D4AF7C", // « Antique Gold » sur la planche : accent rare, jamais du texte sur ivoire
  obsidian: "#0F0F10",
  graphite: "#2A2A2E",
  sand: "#E9E0D0",
  beige: "#D9D1C4",
} as const;

/** Mélange sRGB de deux couleurs hexadécimales : t = 0 → a, t = 1 → b (canaux arrondis). */
export function mix(a: string, b: string, t: number): string {
  const ca = hex(a), cb = hex(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function hex(h: string): number[] {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

// ---- Couleurs nommées (toutes celles des interfaces actuelles) -------------------------------------
// Dérivés : ce sont les valeurs déjà en service (src/styles.css, popup.css), avec leur rôle.
export const color = {
  // Planche
  ivory: BRAND.ivory,
  sand: BRAND.sand,
  beige: BRAND.beige,
  obsidian: BRAND.obsidian,
  graphite: BRAND.graphite,
  gold: BRAND.champagne,
  // Surfaces et filets (clair)
  pearl: "#F4EFE7", // surface posée sur l'ivoire (cartes)
  line: "#E2D8C9", // filets décoratifs
  lineStrong: "#CFBFA7", // filets des contrôles
  field: "#9A8E7C", // bord des champs : ≥ 3:1 sur ivoire (WCAG 1.4.11)
  white: "#FFFFFF",
  // Texte (clair)
  ink: "#141413",
  inkSoft: "#4A463F",
  muted: "#6B6459",
  goldText: "#7A5F38", // or lisible sur clair
  // Sombres
  night: "#18181A", // surface posée sur l'obsidienne
  nightLine: "#2E2C29",
  mist: "#B3A999", // texte secondaire sur sombre
  nightRaised: "#202023",
  nightSurface2: "#232326",
  nightLineStrong: "#45413B",
  nightField: "#7D7468",
  nightThumb: "#3A3A3F",
  // Or
  goldLight: "#E3CDA6", // reflets ; or lisible sur sombre
  goldDeep: "#A8834F",
  // États (tons chauds)
  ok: "#2F6B47",
  okBg: "#E6EFE6",
  warn: "#8A5A12",
  warnBg: "#F5E9D2",
  bad: "#A3372B",
  badBg: "#F6E3DE",
  okOnDark: "#8FC7A2",
  warnOnDark: "#E2B66B",
  badOnDark: "#F0A395",
  // Contrôles
  primaryHover: "#1C1C1E",
  segTrack: "#EBE3D6",
  track: "#E6DCCB",
} as const;

// ---- Chouette vectorielle : teintes dérivées, TOUTES ici -------------------------------------------
// Uniquement des couleurs de la planche et des mélanges explicites de celles-ci (formule en commentaire,
// valeur calculée). Gris chauds « pierre » = graphite → sable : ailes et queue, sans effet métallique.
export const owl = {
  ivory: BRAND.ivory, // disque facial éclairé, facettes claires
  porcelain: mix(BRAND.ivory, BRAND.sand, 0.45), // ivoire 55 % + sable 45 % : volumes à mi-ombre
  hood: mix(BRAND.ivory, BRAND.sand, 0.3), // ivoire 70 % + sable 30 % : capuchon (crâne et aigrettes), à peine plus soutenu que le disque
  sand: BRAND.sand, // crâne, côté ombré
  shade: mix(BRAND.sand, BRAND.beige, 0.6), // sable 40 % + beige 60 % : ombres portées (sous la tête)
  beige: BRAND.beige, // ombre au sol (transparente), filet du disque facial de la mascotte
  rim: color.lineStrong, // liseré du capuchon de la mascotte (jeton existant) : la tête claire tient sur fond clair
  champagne: BRAND.champagne, // aigrettes, bec, filets, une rémige d'accent
  champagneLight: color.goldLight, // facettes éclairées de l'or (jeton existant)
  champagneDeep: color.goldDeep, // facettes ombrées de l'or (jeton existant)
  stone500: mix(BRAND.graphite, BRAND.sand, 0.5), // graphite 50 % + sable 50 % : rémige claire
  stone700: mix(BRAND.graphite, BRAND.sand, 0.25), // graphite 75 % + sable 25 % : couvertures de l'aile
  graphite: BRAND.graphite, // aile (base), iris, ombre sous les aigrettes
  obsidian: BRAND.obsidian, // orbite, pupille, trait des paupières, rémiges sombres
} as const;

// ---- Typographie ----------------------------------------------------------------------------------
export const font = {
  sans: '"Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  display: '"Playfair Display Variable", "Iowan Old Style", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  // Extension : mêmes familles, fichiers intégrés sous un autre nom (extension/src/assets/fonts).
  extSans: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  extDisplay: '"Playfair Display", "Iowan Old Style", Georgia, serif',
} as const;

/** Échelle typographique. `display`, `title`, `lead` existent aujourd'hui ; les autres crans sont la
 *  PROPOSITION qui remplacera, page après page, les 21 tailles arbitraires relevées dans src/. */
export const text = {
  display: { size: "clamp(2.6rem, 1.75rem + 3.6vw, 4.9rem)", lineHeight: "1.02", letterSpacing: "-0.018em" },
  title: { size: "clamp(2.05rem, 1.55rem + 2.1vw, 3.35rem)", lineHeight: "1.07", letterSpacing: "-0.012em" },
  lead: { size: "clamp(1.1rem, 1.04rem + 0.32vw, 1.3rem)", lineHeight: "1.58" },
  // Proposés (nouveaux) :
  heading: { size: "1.5rem", lineHeight: "1.25", letterSpacing: "-0.01em" }, // 24 px : titres de carte/panneau
  subhead: { size: "1.0625rem", lineHeight: "1.45" }, // 17 px semi-gras : intitulés
  body: { size: "1.0625rem", lineHeight: "1.6" }, // 17 px : texte courant (corps actuel)
  ui: { size: "0.9375rem", lineHeight: "1.5" }, // 15 px : contrôles, listes
  small: { size: "0.875rem", lineHeight: "1.5" }, // 14 px : aides, métadonnées
  caption: { size: "0.8125rem", lineHeight: "1.45" }, // 13 px : légendes, badges
  micro: { size: "0.75rem", lineHeight: "1.35", letterSpacing: "0.02em" }, // 12 px : étiquettes rares
} as const;

// ---- Rayons, espacements, élévation, mouvement ----------------------------------------------------
/** Hiérarchie : plus l'objet est grand et « posé », plus son rayon est grand ; contrôles en pilule. */
export const radius = {
  chip: "10px",
  control: "14px",
  card: "22px",
  panel: "28px",
  device: "48px",
  // Proposés (nouveaux) :
  field: "12px", // champs du Control Center
  tile: "16px", // vignettes, tuiles d'icône
  pill: "999px", // boutons, badges, interrupteurs
} as const;

/** Grille de 4 px (Tailwind : --spacing = 0.25rem). Crans recommandés, en px. */
export const space = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128] as const;

export const ease = {
  soft: "cubic-bezier(0.22, 0.8, 0.26, 1)", // sortie douce : entrées, survols
  calm: "cubic-bezier(0.65, 0, 0.35, 1)", // aller-retour : changements d'état
  exit: "cubic-bezier(0.32, 0, 0.67, 0)", // sorties (ease-in), toujours plus courtes que l'entrée
} as const;

/** Durées (ms). Site : src/lib/motion.ts (180 / 340 / 620). L'extension utilise 320 ms pour les
 *  composants : écart signalé par --check, à aligner sur 340 lors du branchement. */
export const duration = { micro: 180, exit: 160, component: 340, reveal: 620, extComponent: 320, blink: 205, breath: 4200 } as const;

export const shadow = {
  card: "0 1px 2px rgb(52 40 22 / 0.05), 0 12px 32px -20px rgb(52 40 22 / 0.24)",
  raised: "0 2px 6px rgb(52 40 22 / 0.06), 0 30px 64px -30px rgb(52 40 22 / 0.34)",
  button: "inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 1px rgb(15 15 16 / 0.28), 0 12px 24px -14px rgb(15 15 16 / 0.7)",
  float: "0 1px 0 rgb(255 255 255 / 0.7) inset, 0 24px 60px -28px rgb(15 15 16 / 0.42), 0 0 0 1px rgb(15 15 16 / 0.05)",
  night: "inset 0 1px 0 rgb(255 255 255 / 0.05), 0 30px 70px -30px rgb(0 0 0 / 0.9)",
  // Extension (popup : plus compact)
  extCard: "0 1px 2px rgb(52 40 22 / 0.05), 0 12px 32px -22px rgb(52 40 22 / 0.28)",
  extButton: "inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 1px rgb(15 15 16 / 0.28), 0 10px 22px -14px rgb(15 15 16 / 0.7)",
  extThumb: "0 1px 2px rgb(52 40 22 / 0.12), 0 4px 10px -6px rgb(52 40 22 / 0.3)",
  extCardDark: "inset 0 1px 0 rgb(255 255 255 / 0.03), 0 16px 36px -24px rgb(0 0 0 / 0.9)",
  extButtonDark: "inset 0 1px 0 rgb(255 255 255 / 0.6), 0 10px 26px -14px rgb(0 0 0 / 0.9)",
  extThumbDark: "0 1px 2px rgb(0 0 0 / 0.4), 0 6px 14px -8px rgb(0 0 0 / 0.8)",
} as const;

// ---- Sorties par plateforme -----------------------------------------------------------------------
/** Site (Tailwind 4, bloc @theme) : nom de variable → valeur. Ordre = ordre d'écriture. */
export const webTheme: ReadonlyArray<readonly [string, string]> = [
  ["--font-sans", font.sans],
  ["--font-display", font.display],
  ["--font-mono", font.mono],
  ["--color-ivory", color.ivory],
  ["--color-pearl", color.pearl],
  ["--color-sand", color.sand],
  ["--color-beige", color.beige],
  ["--color-line", color.line],
  ["--color-line-strong", color.lineStrong],
  ["--color-field", color.field],
  ["--color-ink", color.ink],
  ["--color-ink-soft", color.inkSoft],
  ["--color-muted", color.muted],
  ["--color-gold-text", color.goldText],
  ["--color-obsidian", color.obsidian],
  ["--color-night", color.night],
  ["--color-graphite", color.graphite],
  ["--color-night-line", color.nightLine],
  ["--color-mist", color.mist],
  ["--color-gold", color.gold],
  ["--color-gold-light", color.goldLight],
  ["--color-ok", color.ok],
  ["--color-ok-bg", color.okBg],
  ["--color-warn", color.warn],
  ["--color-warn-bg", color.warnBg],
  ["--color-bad", color.bad],
  ["--color-bad-bg", color.badBg],
  // Nouveaux (proposition, additifs) : or profond et gris chauds « pierre » de la chouette.
  ["--color-gold-deep", color.goldDeep],
  ["--color-stone-500", owl.stone500],
  ["--color-stone-700", owl.stone700],
  ["--radius-chip", radius.chip],
  ["--radius-control", radius.control],
  ["--radius-card", radius.card],
  ["--radius-panel", radius.panel],
  ["--radius-device", radius.device],
  ["--radius-field", radius.field],
  ["--radius-tile", radius.tile],
  ["--radius-pill", radius.pill],
  ["--text-display", text.display.size],
  ["--text-display--line-height", text.display.lineHeight],
  ["--text-display--letter-spacing", text.display.letterSpacing],
  ["--text-title", text.title.size],
  ["--text-title--line-height", text.title.lineHeight],
  ["--text-title--letter-spacing", text.title.letterSpacing],
  ["--text-lead", text.lead.size],
  ["--text-lead--line-height", text.lead.lineHeight],
  ["--text-heading", text.heading.size],
  ["--text-heading--line-height", text.heading.lineHeight],
  ["--text-heading--letter-spacing", text.heading.letterSpacing],
  ["--text-subhead", text.subhead.size],
  ["--text-subhead--line-height", text.subhead.lineHeight],
  ["--text-body", text.body.size],
  ["--text-body--line-height", text.body.lineHeight],
  ["--text-ui", text.ui.size],
  ["--text-ui--line-height", text.ui.lineHeight],
  ["--text-small", text.small.size],
  ["--text-small--line-height", text.small.lineHeight],
  ["--text-caption", text.caption.size],
  ["--text-caption--line-height", text.caption.lineHeight],
  ["--text-micro", text.micro.size],
  ["--text-micro--line-height", text.micro.lineHeight],
  ["--text-micro--letter-spacing", text.micro.letterSpacing],
  ["--ease-soft", ease.soft],
  ["--ease-calm", ease.calm],
  ["--ease-exit", ease.exit],
  // Transitions Tailwind sans durée explicite (transition-colors…) : nos 180 ms et notre courbe, pas 150 ms.
  ["--default-transition-duration", `${duration.micro}ms`],
  ["--default-transition-timing-function", ease.soft],
  ["--shadow-card", shadow.card],
  ["--shadow-raised", shadow.raised],
  ["--shadow-button", shadow.button],
  ["--shadow-float", shadow.float],
  ["--shadow-night", shadow.night],
];

/** Extension (popup + réglages) : variable → [clair, sombre]. Sombre = null : même valeur. */
export const extensionTheme: ReadonlyArray<readonly [string, string, string | null]> = [
  ["--font-sans", font.extSans, null],
  ["--font-display", font.extDisplay, null],
  ["--bg", color.ivory, color.obsidian],
  ["--surface", color.pearl, color.night],
  ["--surface-2", color.sand, color.nightSurface2],
  ["--raised", color.white, color.nightRaised],
  ["--line", color.line, color.nightLine],
  ["--line-strong", color.lineStrong, color.nightLineStrong],
  ["--field", color.field, color.nightField],
  ["--ink", color.ink, color.ivory],
  ["--ink-soft", color.inkSoft, color.beige],
  ["--muted", color.muted, color.mist],
  ["--gold", color.gold, null],
  ["--gold-deep", color.goldDeep, null],
  ["--gold-text", color.goldText, color.goldLight],
  ["--primary-bg", color.obsidian, color.ivory],
  ["--primary-fg", color.ivory, color.obsidian],
  ["--primary-hover", color.primaryHover, color.white],
  ["--focus", color.obsidian, color.gold],
  ["--seg-track", color.segTrack, color.nightSurface2],
  ["--seg-thumb", color.white, color.nightThumb],
  ["--track", color.track, color.nightLine],
  ["--dot-off", color.field, color.nightField],
  ["--ok", color.ok, color.okOnDark],
  ["--ok-bg", color.okBg, "rgb(47 107 71 / 0.26)"],
  ["--warn", color.warn, color.warnOnDark],
  ["--warn-bg", color.warnBg, "rgb(138 90 18 / 0.26)"],
  ["--bad", color.bad, color.badOnDark],
  ["--bad-bg", color.badBg, "rgb(163 55 43 / 0.26)"],
  ["--badge-gold-bg", "rgb(212 175 124 / 0.16)", "rgb(212 175 124 / 0.14)"],
  ["--badge-neutral-bg", "rgb(233 224 208 / 0.7)", "rgb(255 255 255 / 0.06)"],
  ["--radius-card", "20px", null],
  ["--radius-control", radius.pill, null],
  ["--ease-soft", ease.soft, null],
  ["--ease-calm", ease.calm, null],
  ["--dur-micro", `${duration.micro}ms`, null],
  ["--dur-comp", `${duration.extComponent}ms`, null],
  ["--shadow-card", shadow.extCard, shadow.extCardDark],
  ["--shadow-button", shadow.extButton, shadow.extButtonDark],
  ["--shadow-thumb", shadow.extThumb, shadow.extThumbDark],
];

/** Paires texte/fond vérifiées (WCAG 2.1) : [texte, fond, minimum, usage]. 3 = non-texte ou grand texte. */
export const contrastPairs: ReadonlyArray<readonly [keyof typeof color, keyof typeof color, number, string]> = [
  ["ink", "ivory", 4.5, "texte principal"],
  ["inkSoft", "ivory", 4.5, "texte secondaire"],
  ["muted", "ivory", 4.5, "métadonnées"],
  ["muted", "pearl", 4.5, "métadonnées sur carte"],
  ["goldText", "ivory", 4.5, "or lisible (liens, étiquettes)"],
  ["goldText", "sand", 4.5, "or lisible sur sable"],
  ["ok", "okBg", 4.5, "succès"],
  ["warn", "warnBg", 4.5, "avertissement"],
  ["bad", "badBg", 4.5, "erreur"],
  ["ivory", "obsidian", 4.5, "texte sur obsidienne"],
  ["mist", "obsidian", 4.5, "texte secondaire sur obsidienne"],
  ["mist", "night", 4.5, "texte secondaire sur nuit"],
  ["goldLight", "night", 4.5, "or lisible sur sombre"],
  ["gold", "obsidian", 4.5, "accent or sur obsidienne"],
  ["field", "ivory", 3, "bord des champs (non-texte)"],
  ["nightField", "night", 3, "bord des champs, sombre (non-texte)"],
  ["gold", "ivory", 0, "or sur ivoire : INTERDIT pour le texte (décor seulement)"],
];
