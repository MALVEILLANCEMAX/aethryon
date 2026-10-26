// Banc e2e du flux (glisser-déposer) dans Chromium (Playwright) : le VRAI module src/lib/flux.ts, le VRAI
// @tauri-apps/api, la maquette de l'API Tauri (e2e/maquette-tauri.js) qui rejoue les événements de dépôt de Tauri, et
// de vraies zones DOM `data-zone` à une mise à l'échelle de 150 % (pixels physiques ≠ pixels CSS).
// Ce banc ne démontre PAS le glisser natif de Windows (OLE) : il vérifie le chemin interface ↔ commandes ↔ événements.
// Usage : node e2e/flux-banc.mjs   (PLAYWRIGHT_CORE : chemin du module playwright-core)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const esbuild = require("esbuild");
const ici = dirname(fileURLToPath(import.meta.url));
const maquette = readFileSync(join(ici, "maquette-tauri.js"), "utf8");
const paquet = await esbuild.build({ entryPoints: [join(ici, "flux-banc-entree.ts")], bundle: true, format: "iife", platform: "browser", target: "chrome110", write: false, logLevel: "error" });
const flux = paquet.outputFiles[0].text;

// Zones : « premiere » en haut à gauche, « bibliotheque » à droite (avec une carte imbriquée), « vide » ailleurs.
const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1000px; height: 700px; font: 14px sans-serif; }
  [data-zone] { position: absolute; box-sizing: border-box; border: 1px dashed #999; }
  #premiere { left: 0; top: 0; width: 200px; height: 200px; }
  #bibliotheque { left: 200px; top: 0; width: 600px; height: 600px; }
  .carte { position: absolute; left: 40px; top: 40px; width: 160px; height: 90px; background: #ddd; }
</style></head><body>
  <div id="premiere" data-zone="premiere">Premiere</div>
  <div id="bibliotheque" data-zone="bibliotheque">Bibliothèque<div class="carte" id="carte">Carte</div></div>
</body></html>`;

const navigateur = await pw.chromium.launch();
const resultats = [];
const erreursConsole = [];

async function page(scenario) {
  const ctx = await navigateur.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1.5, locale: "fr-FR" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursConsole.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreursConsole.push(m.text()); });
  await p.addInitScript(`window.__SCENARIO__ = ${JSON.stringify({ indexVide: true, ...scenario })};\n${maquette}\n${flux}`);
  // Page servie par une route (les scripts d'initialisation s'appliquent à une vraie navigation).
  await p.route("http://banc.localhost/**", (r) => r.fulfill({ body: PAGE, contentType: "text/html; charset=utf-8" }));
  await p.goto("http://banc.localhost/");
  return { p, ctx };
}

async function essai(nom, scenario, corps) {
  const { p, ctx } = await page(scenario);
  try {
    const detail = await p.evaluate(corps);
    resultats.push({ nom, ok: detail.ok, detail });
  } catch (e) {
    resultats.push({ nom, ok: false, detail: String(e) });
  }
  await ctx.close();
}

// 1. Glisser natif d'AETHRYON (simulé) : survol des zones à 150 %, dépôt sur « premiere », import confirmé par le panneau.
await essai("glisser interne vers Premiere (150 %)", {}, async () => {
  const attendre = (f, ms = 4000) => new Promise((ok, ko) => { const t0 = Date.now(); const i = setInterval(() => { if (f()) { clearInterval(i); ok(); } else if (Date.now() - t0 > ms) { clearInterval(i); ko(new Error("délai dépassé")); } }, 20); });
  const image = () => new Promise((r) => requestAnimationFrame(() => r()));
  const M = window.__maquette;
  const f = window.__fluxBanc.creerFlux({ contexte: () => ({ premiereConnecte: true, medias: M.etat.index.medias }) });
  await f.demarrer();
  const ecouteursActifs = M.flux.ecouteurs();
  const id = "2".repeat(40);
  const chemin = M.etat.index.medias.find((m) => m.id === id).chemin;
  await f.glisserMedias([id]);
  M.flux.entrer([chemin], 300, 300); // sur la carte, dans la bibliothèque
  await image();
  const surCarte = { zone: f.etat().survol.zone, verdict: f.etat().survol.verdict, attr: document.getElementById("bibliotheque").getAttribute("data-flux-etat"), html: document.documentElement.getAttribute("data-flux"), glisser: document.documentElement.hasAttribute("data-flux-glisser") };
  M.flux.survoler(100, 100);
  await image();
  const surPremiere = { zone: f.etat().survol.zone, attr: document.getElementById("premiere").getAttribute("data-flux-etat"), ancienne: document.getElementById("bibliotheque").getAttribute("data-flux-etat") };
  M.flux.deposer([chemin], 100, 100);
  await attendre(() => f.etat().operations.some((o) => o.type === "envoi" && o.envoi.etat === "importe"));
  await attendre(() => f.etat().glisser === null);
  const op = f.etat().operations.find((o) => o.type === "envoi");
  const apres = { survol: f.etat().survol.actif, attrs: [...document.querySelectorAll("[data-flux-etat]")].length, html: document.documentElement.getAttribute("data-flux") };
  await f.arreter();
  await new Promise((r) => setTimeout(r, 50));
  const ok = surCarte.zone === "bibliotheque" && surCarte.attr === "refuse" && surCarte.html === "aethryon" && surCarte.glisser
    && surPremiere.zone === "premiere" && surPremiere.attr === "accepte" && surPremiere.ancienne === null
    && op.envoi.message.startsWith("1 importé") && !apres.survol && apres.attrs === 0 && apres.html === null
    && ecouteursActifs === 6 && M.flux.ecouteurs() === 0;
  return { ok, ecouteursActifs, ecouteursApresArret: M.flux.ecouteurs(), surCarte, surPremiere, envoi: op.envoi, apres };
});

// 2. Fichiers et dossier externes déposés sur la bibliothèque : import avec progression, média « en cours » puis
//    « disponible », dossier proposé à la surveillance (jamais copié), type refusé.
await essai("fichiers et dossier externes sur la bibliothèque", {}, async () => {
  const attendre = (f, ms = 5000) => new Promise((ok, ko) => { const t0 = Date.now(); const i = setInterval(() => { if (f()) { clearInterval(i); ok(); } else if (Date.now() - t0 > ms) { clearInterval(i); ko(new Error("délai dépassé")); } }, 20); });
  const M = window.__maquette;
  const f = window.__fluxBanc.creerFlux();
  await f.demarrer();
  const chemins = ["E:\\Tournage\\Clip nuit.mov", "E:\\Tournage\\notes.txt", "E:\\Tournage\\Jour 2"];
  M.flux.entrer(chemins, 500, 400);
  await attendre(() => f.etat().survol.verdict && !f.etat().survol.verdict.enAttente);
  const verdict = f.etat().survol.verdict;
  const classement = f.etat().survol.classement;
  const etapes = [];
  const enCoursVu = [];
  M.flux.deposer(chemins, 500, 400);
  await attendre(() => f.etat().operations.some((o) => o.type === "import"));
  const opId = f.etat().operations.find((o) => o.type === "import").id;
  await attendre(() => {
    const o = f.etat().operations.find((x) => x.id === opId);
    if (o.progression) etapes.push(o.progression.etape);
    const m = M.etat.index.medias.find((x) => x.nom === "Clip nuit");
    if (m) enCoursVu.push(m.etat);
    return o.bilan;
  });
  const imp = f.etat().operations.find((x) => x.id === opId);
  const prop = f.etat().operations.find((o) => o.type === "surveiller");
  await f.accepterProposition(prop.id);
  const propApres = f.etat().operations.find((o) => o.id === prop.id);
  await f.arreter();
  // Seuls les fichiers importables partent au cœur : le .txt est refusé dès le survol, le dossier est proposé.
  const ok = verdict.acceptable && verdict.actions.join(",") === "importer,surveiller" && classement.refuses.length === 1 && classement.refuses[0].nom === "notes.txt"
    && imp.bilan.importes === 1 && imp.bilan.fichiers.length === 1
    && etapes.includes("copie") && enCoursVu.includes("en-cours") && enCoursVu.at(-1) === "disponible"
    && propApres.etat === "acceptee" && M.etat.config.dossiersSurveilles.includes("E:\\Tournage\\Jour 2") && M.flux.ecouteurs() === 0;
  return { ok, verdict, refuses: classement.refuses, bilan: imp.bilan, etapes: [...new Set(etapes)], enCoursVu: [...new Set(enCoursVu)], proposition: propApres };
});

// 3. Premiere non connecté : la zone le dit au survol, rien n'est envoyé au dépôt ; envoi direct → « non-connecte ».
await essai("Premiere non connecté", { premiereDeconnecte: true }, async () => {
  const M = window.__maquette;
  const f = window.__fluxBanc.creerFlux({ contexte: () => ({ premiereConnecte: false }) });
  await f.demarrer();
  const id = "2".repeat(40);
  const chemin = M.etat.index.medias.find((m) => m.id === id).chemin;
  await f.glisserMedias([id]);
  M.flux.entrer([chemin], 100, 100);
  const raison = f.etat().survol.verdict.raison;
  M.flux.deposer([chemin], 100, 100);
  await new Promise((r) => setTimeout(r, 100));
  const refus = f.etat().operations[0];
  const suivi = window.__fluxBanc.envoyerVersPremiere([id]);
  const fin = await suivi.fin;
  await f.arreter();
  await new Promise((r) => setTimeout(r, 50));
  const ok = raison.includes("n'est pas connecté") && refus.type === "refus" && fin.etat === "non-connecte" && M.flux.ecouteurs() === 0;
  return { ok, raison, refus, fin };
});

// 4. Glisser natif déposé dans une autre application, puis glisser relâché hors de toute cible.
await essai("glisser vers une autre application, puis relâché", {}, async () => {
  const attendre = (f, ms = 3000) => new Promise((ok, ko) => { const t0 = Date.now(); const i = setInterval(() => { if (f()) { clearInterval(i); ok(); } else if (Date.now() - t0 > ms) { clearInterval(i); ko(new Error("délai dépassé")); } }, 20); });
  const M = window.__maquette;
  const f = window.__fluxBanc.creerFlux();
  await f.demarrer();
  const id = "8".repeat(40);
  const chemin = M.etat.index.medias.find((m) => m.id === id).chemin;
  await f.glisserMedias([id]);
  M.flux.entrer([chemin], 300, 300);
  M.flux.deposerAilleurs("Adobe Premiere Pro.exe");
  await attendre(() => f.etat().glisser === null);
  const op = f.etat().operations.find((o) => o.type === "glisser");
  await f.glisserMedias([id]);
  M.flux.relacher();
  await attendre(() => f.etat().glisser === null);
  let refus = null;
  try { await f.glisserMedias(["1".repeat(40)]); } catch (e) { refus = e.message; } // média « en cours »
  await f.arreter();
  const ok = op && op.fin.application === "Adobe Premiere Pro.exe" && op.fin.resultat === "depose" && f.etat().operations.length === 1 && refus && refus.includes("n'est pas disponible");
  return { ok, fin: op && op.fin, refus };
});

await navigateur.close();
mkdirSync(join(ici, "resultats"), { recursive: true });
writeFileSync(join(ici, "resultats", "flux-banc.json"), JSON.stringify({ le: new Date().toISOString(), resultats, erreursConsole }, null, 2));
for (const r of resultats) console.log(`${r.ok ? "OK " : "KO "} ${r.nom}${r.ok ? "" : ` : ${JSON.stringify(r.detail).slice(0, 600)}`}`);
console.log(`${resultats.filter((r) => r.ok).length}/${resultats.length} scénarios verts ; erreurs de console : ${erreursConsole.length}`);
process.exit(resultats.every((r) => r.ok) && erreursConsole.length === 0 ? 0 : 1);
