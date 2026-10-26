#!/usr/bin/env node
// Rendu SVG → PNG par Chromium (même moteur que le site) : taille exacte, fond transparent ou couleur.
//   node brand/master/tools/render.mjs <entrée.svg> <sortie.png> <taille> [fond=transparent|#RRGGBB] [marge=0..0.5]
// Plusieurs rendus en un appel : node render.mjs --batch fichier.json   ([{in,out,size,bg,pad}, …])
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "playwright");

const args = process.argv.slice(2);
const jobs = args[0] === "--batch"
  ? JSON.parse(readFileSync(args[1], "utf8"))
  : [{ in: args[0], out: args[1], size: Number(args[2]), bg: args[3] ?? "transparent", pad: Number(args[4] ?? 0) }];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  const svg = readFileSync(resolve(j.in), "utf8");
  const pad = Math.round((j.pad ?? 0) * j.size);
  await page.setViewportSize({ width: j.size, height: j.size });
  const bg = !j.bg || j.bg === "transparent" ? "transparent" : j.bg;
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${j.size}px;height:${j.size}px;background:${bg};overflow:hidden}
    .s{position:absolute;inset:${pad}px;display:grid;place-items:center}.s svg{width:100%;height:100%;display:block}</style></head>
    <body><div class="s">${svg.replace(/^<\?xml[^>]*>/, "")}</div></body></html>`);
  await page.screenshot({ path: resolve(j.out), omitBackground: bg === "transparent", clip: { x: 0, y: 0, width: j.size, height: j.size } });
}
await browser.close();
console.log(`${jobs.length} rendu(s)`);
