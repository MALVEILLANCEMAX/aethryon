// Fabrique les icônes du panneau (23 × 23, chouette officielle « petit logo », jamais redessinée) avec Chromium.
// À lancer une fois ; les PNG sont versionnés dans cep/icons/.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ici = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const svg = readFileSync(join(ici, "..", "src", "assets", "marque", "aethryon-petit.svg"), "utf8");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 23, height: 23 }, deviceScaleFactor: 1 });
for (const [nom, opacite] of [["panneau-clair", 0.82], ["panneau-clair-survol", 1], ["panneau-sombre", 0.82], ["panneau-sombre-survol", 1]]) {
  await p.setContent(`<html><body style="margin:0;background:transparent"><div style="width:23px;height:23px;opacity:${opacite}">${svg.replace("<svg ", '<svg style="width:23px;height:23px" ')}</div></body></html>`);
  await p.screenshot({ path: join(ici, "..", "cep", "icons", `${nom}.png`), omitBackground: true });
}
await b.close();
console.log("icônes écrites dans cep/icons/");
