#!/usr/bin/env node
// Image de partage (Open Graph, 1200 × 630) : logo horizontal maître (tête + logotype Marcellus) sur
// obsidienne avec le halo doré du site, et la phrase du héros en Playfair Display (police des titres).
//   node brand/master/tools/og.mjs <sortie.png>
import { createRequire } from "node:module";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "playwright");
const here = dirname(fileURLToPath(import.meta.url));
const M = resolve(here, "..");
const out = resolve(process.argv[2] ?? join(M, "png", "og-image.png"));
const lockup = readFileSync(join(M, "variantes", "aethryon-horizontal-marcellus-encre-ivoire.svg"), "utf8").replace(/^<\?xml[^>]*>/, "");

const dir = mkdtempSync(join(tmpdir(), "og-"));
copyFileSync(join(M, "..", "explorations", "fonts", "playfair-display.woff2"), join(dir, "playfair.woff2"));
writeFileSync(join(dir, "og.html"), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@font-face { font-family: "Playfair OG"; src: url("playfair.woff2") format("woff2"); font-weight: 400 900; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #0F0F10; }
body { display: grid; place-items: center; background:
  radial-gradient(420px 300px at 50% 46%, rgb(212 175 124 / 0.17), transparent 72%), #0F0F10; }
.stack { display: grid; justify-items: center; gap: 30px; }
.stack svg { width: 640px; height: auto; display: block; }
p { margin: 0; font: 500 40px/1.15 "Playfair OG", Georgia, serif; color: #E9E2D6; letter-spacing: -0.005em; }
</style></head><body><div class="stack">${lockup}<p>Un service. Plusieurs façons de l’utiliser.</p></div></body></html>`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(join(dir, "og.html")).href);
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: out });
await b.close();
rmSync(dir, { recursive: true, force: true });
console.log("og-image :", out);
