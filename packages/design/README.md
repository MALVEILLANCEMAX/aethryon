# Égide — AETHRYON design system and theme engine

**Égide** is the shared design foundation of AETHRYON: design tokens, the theme engine, the CSS layers, the icon set,
the master owl and a few framework-free DOM components. It is one source for the website (`apps/web`, React 19), AETHRYON
Desktop (`apps/desktop`, Tauri + React 18) and the browser extension (`apps/extension`, esbuild, Shadow DOM), and later
for the Premiere panel and mobile apps (`genere/tokens.json`).

TypeScript + CSS, **no framework and no runtime dependency**. Code comments and user-facing messages are in French,
like the rest of the code base.

## Rules that do not change

- **A theme is data**, never code and never a URL: a strict validator refuses unknown keys, non-`#RRGGBB` colours,
  out-of-range numbers, control and bidirectional characters, and files larger than 16 KB.
- Everything goes through `--eg-*` tokens; nothing is inline (the website CSP is `script-src 'self'`, `style-src 'self'`).
- Plugging Égide in changes **no** existing screen: every rule targets `.eg-*` or `data-eg-*` and lives in the
  `theme`, `base` and `components` cascade layers (the same layers as Tailwind 4; checked by `tests/feuille.test.ts`).
- Contrast is computed, not hoped for: every theme (including generated ones) passes 27 WCAG 2.x contrast pairs, and
  the engine corrects a custom theme that would not.

## Contents

| Path | Role |
|---|---|
| `src/couleur.ts` | sRGB ↔ OKLCH, WCAG 2.x contrast, APCA (informative), mixing |
| `src/jetons.ts` | static tokens: spacing, font families, text sizes, sizes × density, radii, borders, durations × motion, easings, shadows, layers |
| `src/themes.ts` | 19 colour roles, 7 derived colours, the 5 official themes (+ Custom), the `aethryon-theme` v1 format, 8 accents |
| `src/moteur.ts` | seeds → tokens (OKLCH), resolution, derived colours, 27 contrast pairs, automatic correction |
| `src/schema.ts` | strict validator, normalisation, import and export of theme files |
| `src/migrations.ts` | format versions and step-by-step migration |
| `src/variables.ts`, `src/appliquer.ts` | resolved theme → `--eg-*` variables and `data-eg-*` attributes, applied to a document, a Shadow DOM root or a preview |
| `src/persistance.ts` | local storage with an in-memory fallback, versioned key `aethryon.apparence.v1`, revalidated on read |
| `src/boot.ts` → `genere/theme-boot.js` | flash-free theme start-up, a small standalone external script |
| `src/icones.ts` | 57 in-house icons (data) and their sprite; no brand logo is drawn |
| `src/dom/*.ts` | DOM helpers, the owl (medal, idle, seal, empty state), components, the theme editor, Shadow DOM root |
| `css/*.css` | CSS sources (fonts, base, components, editor) |
| `fonts/` | Marcellus, Hanken Grotesk, Geist Mono (SIL OFL 1.1, Fontsource 5.3.0 files as published), licences next to them |
| `assets/aethryon-master.svg` | the master owl, a byte-for-byte copy of `packages/brand/master` (checked) |
| `genere/`, `src/genere/`, `themes/`, `schema/` | **generated** by `scripts/build.mjs`: `egide.css`, `egide-shadow.css`, `theme-boot.js`, `icones.svg`, `tokens.json` (DTCG), contrast table, size report, example theme files, JSON Schema v1 |
| `tests/` | unit tests (`node --test`), theme fixtures kept forever, browser tests |

## Commands

```sh
cd packages/design && npm ci
node scripts/build.mjs           # regenerate genere/, src/genere/, themes/, schema/
node scripts/build.mjs --sync    # same + copy the package into apps/web/src/egide (the website's Docker context)
node scripts/build.mjs --check   # fail if a generated file, the website copy or the owl differs, or a size budget is exceeded
npm run typecheck                # tsc --noEmit (union of the website, Desktop and extension compiler options)
npm test                         # unit tests: engine, 1,000 random themes, schema, migrations, persistence, boot, stylesheet, icons
npm run test:navigateur          # Chromium tests under the strict CSP (needs playwright-core and axe-core installed locally)
make test-design                 # from the repository root: --check + typecheck + unit tests
```

To change anything: edit `src/` or `css/`, run `node scripts/build.mjs --sync`, then `--check`. Never edit `genere/`,
`src/genere/`, `themes/`, `schema/` or `apps/web/src/egide/` by hand.

## How each app consumes it

- **Website** (`apps/web`): the Docker build context is `apps/web`, so the site reads the **copy** in
  `apps/web/src/egide` (made by `--sync`, verified by `--check`). Entry point: `apps/web/src/lib/egide.ts`;
  `src/main.tsx` imports `./egide/genere/egide.css` after `styles.css`; `vite.config.ts` emits `theme-boot.js` as a
  hashed asset at the top of `<head>`, and `scripts/check-dist.mjs` verifies it in every pre-rendered page.
- **Desktop** (`apps/desktop`): no copy. `src/lib/egide.ts` re-exports `packages/design/src/index.ts` through a
  relative path, `main.tsx` imports `genere/egide.css`, and `vite.config.ts` allows `packages/design` in `server.fs.allow`.
- **Extension** (`apps/extension`): `src/shared/egide.ts` re-exports the package (esbuild, `tsc` and `node --test`
  resolve the relative path); `scripts/build.mjs` copies `genere/egide.css`, `fonts/` and the owl into `dist/egide/`.
  The injected menu uses a **closed** Shadow DOM root with an adopted stylesheet (accepted by strict page CSPs).

Why DOM functions rather than Web Components: `customElements` does not exist in the isolated world of Chrome content
scripts; classes and plain functions work everywhere, including static pre-rendering.

## CSS variables and attributes

| Prefix | Contents |
|---|---|
| `--eg-c-<role>` | 19 roles (`canvas`, `surface`, `raised`, `sunken`, `line`, `line-strong`, `control`, `text`, `text-2`, `text-3`, `accent`, `accent-hover`, `on-accent`, `accent-text`, `thread`, `ok`, `warn`, `err`, `focus`) + 7 derived colours |
| `--eg-r-*` | radii (panel, control, media, sheet, pill) |
| `--eg-s-1` … `--eg-s-12` | spacing, 2 to 96 px |
| `--eg-f-*`, `--eg-fs-*`, `--eg-lh-body` | font families and text sizes |
| `--eg-h-*`, `--eg-pad`, `--eg-gap` | control heights and gaps (× density) |
| `--eg-d-*`, `--eg-move`, `--eg-e-*` | durations, distance and easings (× motion intensity) |
| `--eg-b-*`, `--eg-shadow-*`, `--eg-z-*` | borders (focus ring not customisable), shadows, layers |

Attributes set on the scope: `data-eg-theme` (`obsidian`, `ivory`, `oled`, `midnight`, `minimal`, `custom`),
`data-eg-mode`, `data-eg-motion` (`complete`, `douce`, `reduite`, `aucune`), `data-eg-typo`, `data-eg-sheen`,
`data-eg-grain`, `data-eg-oled`, `data-eg-contrast`. The system "reduce motion" setting halves durations, removes
movement and stops decorative loops unless a custom theme explicitly asks otherwise.

## Size budgets

Measured by `scripts/build.mjs` (`genere/taille.json`) and enforced by `--check`: document stylesheet ≤ 12 KiB gzip,
Shadow DOM stylesheet ≤ 10 KiB gzip, `theme-boot.js` ≤ 1 KiB, engine JS ≤ 8 KiB gzip, whole package JS ≤ 24 KiB gzip.

## Usage rights

The code is covered by the repository license. The fonts keep their own licence (SIL OFL 1.1). The owl in
`assets/aethryon-master.svg` is part of the AETHRYON brand and is **not** covered by the code license
(see [`TRADEMARK.md`](../../TRADEMARK.md)).
