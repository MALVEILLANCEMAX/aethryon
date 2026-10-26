// Essai de fumée du paquet CEP construit, ouvert en file:// comme le fait CEP : le script classique, la feuille de
// style et la CSP se chargent sans erreur ; hors de Premiere, le panneau le dit (aucune maquette de secours).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ici = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const page0 = pathToFileURL(join(ici, "..", "..", "sortie", "fr.aethryon.premiere", "client", "index.html")).href;
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 480, height: 300 } });
const erreurs = [];
p.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
p.on("pageerror", (e) => erreurs.push(e.message));
await p.goto(page0);
await p.waitForTimeout(800);
const texte = await p.textContent("#app");
const css = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
await p.screenshot({ path: join(ici, "rendus", "fumee-cep-hors-premiere.png") });
await b.close();
const ok = /Premiere Pro/.test(texte) && css === "rgb(24, 24, 26)" && !erreurs.length;
console.log(`${ok ? "ok" : "ÉCHEC"} · paquet CEP en file:// · « ${texte.trim()} » · fond ${css}${erreurs.length ? " · " + erreurs.join(" | ") : ""}`);
process.exit(ok ? 0 : 1);
