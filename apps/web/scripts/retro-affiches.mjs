#!/usr/bin/env node
// Affiches fixes des objets rétro (public/media/retro/<objet>.png) : image de repli sans WebGL et contenu du HTML
// pré-rendu, rendue par le MÊME moteur (src/ui/retro) au même instant que l'image fixe du mouvement réduit.
//   npm run dev   (serveur de développement sur 127.0.0.1:18122), puis : node scripts/retro-affiches.mjs [objet…]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const out = join(dirname(fileURLToPath(import.meta.url)), "../public/media/retro");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.goto(process.env.LABO ?? "http://127.0.0.1:18122/scripts/retro-labo.html", { waitUntil: "networkidle" });
// Objets choisis en arguments (node scripts/retro-affiches.mjs cookie), sinon tous.
const ALL = ["cube", "disquette", "disque", "sablier", "cookie"];
for (const kind of process.argv.slice(2).length ? process.argv.slice(2).filter((k) => ALL.includes(k)) : ALL) {
  const url = await page.evaluate((k) => window.retroPoster(k, 100), kind);
  const png = Buffer.from(url.replace(/^data:image\/png;base64,/, ""), "base64");
  writeFileSync(join(out, `${kind}.png`), png);
  console.log(`${kind}.png : ${png.length} octets`);
}
await browser.close();
