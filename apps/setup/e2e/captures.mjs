// Captures de chaque écran d'AETHRYON Setup (Chromium, Playwright, 960 × 640) avec la maquette de l'API Tauri,
// nourrie par le vrai moteur (e2e/donnees, produites par `cargo run --example instantanes`). Puis planches côte à
// côte avec les maquettes approuvées de l'étape B. Usage : npm run build && node e2e/captures.mjs
// Variables : PLAYWRIGHT_CORE, MAQUETTES, SORTIE.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const racine = dirname(ici);
const dist = join(racine, "dist");
const sortie = process.env.SORTIE || join(ici, "captures");
const maquettes = process.env.MAQUETTES || "captures";
mkdirSync(sortie, { recursive: true });
const lire = (n) => JSON.parse(readFileSync(join(ici, "donnees", n), "utf8"));
const D = {
  installation: lire("etat-installation.json"),
  introuvable: lire("etat-introuvable.json"),
  maintenance: lire("etat-maintenance.json"),
  miseAJour: lire("etat-mise-a-jour.json"),
  avancements: lire("installation.json"),
  echec: lire("echec.json"),
  desinstallation: lire("desinstallation.json"),
  medias: lire("medias.json"),
  ancienneBeta: lire("etat-ancienne-beta.json"),
  avancementsBeta: lire("installation-ancienne-beta.json"),
};
const maquette = readFileSync(join(ici, "maquette-setup.js"), "utf8");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  const f = join(dist, p === "/" ? "index.html" : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const port = serveur.address().port;
const navigateur = await pw.chromium.launch();
const rapport = [];

// Index d'un avancement : étape `courante`, avec une sous-étape en cours ou des octets écrits.
const indice = (liste, f) => liste.findIndex(f);
const pCopie = indice(D.avancements, (a) => a.courante === 1 && a.etapes[1].fait > a.etapes[1].total * 0.35 && a.etapes[1].sous.some((s) => s.etat === "enCours"));
const pEnreg = indice(D.avancements, (a) => a.courante === 2 && a.etapes[2].sous.length === 2 && a.etapes[2].sous[1].etat === "enCours");
const pDes = indice(D.desinstallation, (a) => a.courante === 2 && a.etapes[2].sous.some((s) => s.etat === "enCours"));

async function ouvrir(scenario, { reduit = false } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: "dark", reducedMotion: reduit ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  await p.addInitScript(`window.__SCENARIO__ = ${JSON.stringify(scenario)};\n${maquette}`);
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForFunction(() => window.__PRET__ === true);
  await p.evaluate(() => document.fonts.ready);
  return { p, ctx, erreurs };
}

async function capture(nom, scenario, actions = async () => {}, opts = {}) {
  const { p, ctx, erreurs } = await ouvrir(scenario, opts);
  await actions(p);
  await p.waitForTimeout(opts.attente ?? 1300);
  const f = join(sortie, `${nom}.png`);
  await p.screenshot({ path: f });
  // Mesures : aucun débordement horizontal, et le contenu ne passe pas sous le pied.
  const mesure = await p.evaluate(() => {
    const corps = document.querySelector(".inst-body");
    const pied = document.querySelector(".inst-foot");
    const dernier = corps ? Array.from(corps.querySelectorAll("*")).reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0) : 0;
    return { debord: document.documentElement.scrollWidth > 960 || document.documentElement.scrollHeight > 640, chevauche: pied ? dernier > pied.getBoundingClientRect().top + 1 : false, blanc: getComputedStyle(document.documentElement).backgroundColor };
  });
  rapport.push({ nom, erreurs, ...mesure });
  await ctx.close();
  return f;
}

const clic = (texte) => async (p) => { await p.getByRole("button", { name: texte, exact: true }).first().click(); };
const radio = (debut) => async (p) => { await p.getByRole("radio", { name: new RegExp("^" + debut) }).first().click(); };
const suite = (...fs) => async (p) => { for (const f of fs) { await f(p); await p.waitForTimeout(500); } };

await capture("01-bienvenue", { etat: D.installation });
await capture("02a-detection-compatible", { etat: D.installation }, clic("Commencer"));
await capture("02b-detection-introuvable", { etat: D.introuvable }, clic("Commencer"));
await capture("02c-detection-ancienne-beta", { etat: D.ancienneBeta }, clic("Commencer"));
await capture("03-configuration", { etat: D.installation }, suite(clic("Commencer"), clic("Continuer")));
await capture("04a-installation-copie", { etat: D.installation, avancements: D.avancements, pause: pCopie }, suite(clic("Commencer"), clic("Continuer"), clic("Installer")));
await capture("04b-installation-enregistrement", { etat: D.installation, avancements: D.avancements, pause: pEnreg }, suite(clic("Commencer"), clic("Continuer"), clic("Installer")));
await capture("04c-installation-echec-retour-arriere", { etat: D.installation, avancements: D.echec }, suite(clic("Commencer"), clic("Continuer"), clic("Installer")), { attente: 2500 });
await capture("05-termine", { etat: D.installation, avancements: D.avancements }, suite(clic("Commencer"), clic("Continuer"), clic("Installer")), { attente: 3200 });
await capture("05b-termine-animations-reduites", { etat: D.installation, avancements: D.avancements }, suite(clic("Commencer"), clic("Continuer"), clic("Installer")), { attente: 1500, reduit: true });
await capture("05c-termine-ancienne-beta-remplacee", { etat: D.ancienneBeta, avancements: D.avancementsBeta }, suite(clic("Commencer"), clic("Continuer"), clic("Installer")), { attente: 3200 });
await capture("06a-maintenance-reparer", { etat: D.maintenance });
await capture("06b-maintenance-mettre-a-jour", { etat: D.miseAJour });
await capture("06c-reparation-terminee", { etat: D.maintenance, avancements: D.avancements.map((a) => ({ ...a, operation: "reparer" })) }, clic("Réparer"), { attente: 3200 });
await capture("07a-desinstallation-confirmer", { etat: D.maintenance, medias: D.medias }, suite(radio("Désinstaller"), clic("Désinstaller…")));
await capture("07b-desinstallation-supprimer-medias", { etat: D.maintenance, medias: D.medias }, suite(radio("Désinstaller"), clic("Désinstaller…"), radio("Supprimer aussi mes médias")));
await capture("08-desinstallation-en-cours", { etat: D.maintenance, medias: D.medias, desinstallation: D.desinstallation, pauseDes: pDes }, suite(radio("Désinstaller"), clic("Désinstaller…"), async (p) => { await p.locator(".inst-foot").getByRole("button", { name: "Désinstaller", exact: true }).click(); }));
await capture("09-desinstalle", { etat: D.maintenance, medias: D.medias, desinstallation: D.desinstallation }, suite(radio("Désinstaller"), clic("Désinstaller…"), async (p) => { await p.locator(".inst-foot").getByRole("button", { name: "Désinstaller", exact: true }).click(); }), { attente: 2500 });

// Planches côte à côte : maquette approuvée (étape B) | écran réel.
const PAIRES = [
  ["01-bienvenue", "installateur-1-bienvenue"],
  ["02a-detection-compatible", "installateur-2a-detection-compatible"],
  ["02b-detection-introuvable", "installateur-2b-detection-introuvable"],
  ["03-configuration", "installateur-3-configuration"],
  ["04b-installation-enregistrement", "installateur-4-installation"],
  ["05-termine", "installateur-5-termine"],
];
for (const [cap, maq] of PAIRES) {
  const a = join(maquettes, `${maq}.png`);
  if (!existsSync(a)) continue;
  const b64 = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
  const ctx = await navigateur.newContext({ viewport: { width: 1960, height: 690 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#202022;font:600 13px Inter,system-ui,sans-serif;color:#d9d1c4;display:flex;gap:20px;padding:12px 13px">
    <figure style="margin:0"><figcaption style="height:24px">Maquette approuvée (étape B) · ${maq}</figcaption><img src="${b64(a)}" width="960" height="640"></figure>
    <figure style="margin:0"><figcaption style="height:24px">AETHRYON Setup (Chromium, maquette de l'API nourrie par le vrai moteur) · ${cap}</figcaption><img src="${b64(join(sortie, cap + ".png"))}" width="960" height="640"></figure></body>`);
  await p.screenshot({ path: join(sortie, `comparaison-${cap}.png`) });
  await ctx.close();
}

writeFileSync(join(sortie, "rapport.json"), JSON.stringify(rapport, null, 1));
await navigateur.close();
serveur.close();
const ko = rapport.filter((r) => r.erreurs.length || r.debord || r.chevauche);
for (const r of rapport) console.log(`${r.erreurs.length || r.debord || r.chevauche ? "PROBLÈME" : "ok      "} ${r.nom}${r.erreurs.length ? " erreurs : " + r.erreurs.join(" | ") : ""}${r.debord ? " débordement" : ""}${r.chevauche ? " chevauchement du pied" : ""} (fond ${r.blanc})`);
console.log(`${rapport.length} écrans, ${ko.length} problème(s).`);
process.exit(ko.length ? 1 : 0);
