// Captures de l'interface (Chromium, Playwright) avec la MAQUETTE de l'API Tauri, puis planches de comparaison
// côte à côte avec les maquettes approuvées de l'étape B. Usage : npm run build && node e2e/captures.mjs
// Variables : PLAYWRIGHT_CORE (chemin du module), MAQUETTES (dossier des PNG de l'étape B), AETHRYON_ECHANTILLONS
// (dossier contenant coucher.webm pour le lecteur ; Chromium de Playwright ne décode pas le H.264).
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
const sortie = join(ici, "captures");
const maquettes = process.env.MAQUETTES || "captures";
const echantillons = process.env.AETHRYON_ECHANTILLONS || "";
mkdirSync(sortie, { recursive: true });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  const f = join(dist, p === "/" ? "index.html" : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const port = serveur.address().port;
// Miniatures de la maquette (identifiants « 111…1 », « 222…2 »… de maquette-tauri.js).
const MINIATURES = { 1: "film-cartes.jpg", 2: "coucher-6s.jpg", 3: "coucher-vertical-169.jpg", 4: "coucher-passage-gif.jpg", 8: "film-tools.jpg", 9: "coucher-1s.jpg", a: "coucher-1s.jpg", b: "coucher-1s.jpg" };
const DEPOT = new Map();
const maquetteTauri = readFileSync(join(ici, "maquette-tauri.js"), "utf8");

const navigateur = await pw.chromium.launch();
const rapport = [];

async function page(scenario, { largeur = 1280, hauteur = 800, theme = "dark" } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: theme, reducedMotion: "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  await p.addInitScript(`window.__SCENARIO__ = ${JSON.stringify({ indexVide: true, ...scenario })};\n${maquetteTauri}`);
  // Protocole asset (Windows) : miniatures et médias servis depuis les fixtures.
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const depot = chemin.match(/^__depot\/([0-9a-f]{40})$/);
    if (depot) { DEPOT.set(depot[1], route.request().postData() || ""); return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } }); }
    const genere = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (genere && DEPOT.has(genere)) return route.fulfill({ body: Buffer.from(DEPOT.get(genere).split(",")[1], "base64"), contentType: "image/jpeg" });
    if (echantillons && /\.(mp3|wav)$/i.test(chemin)) {
      const f = join(echantillons, chemin.toLowerCase().endsWith(".wav") ? "nappe.wav" : "coucher.mp3");
      if (existsSync(f)) return route.fulfill({ path: f, contentType: chemin.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg", headers: { "Access-Control-Allow-Origin": "*" } });
    }
    const id = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (id && MINIATURES[id[0]]) return route.fulfill({ path: join(ici, "fixtures", MINIATURES[id[0]]), contentType: "image/jpeg" });
    if (/\.(mp4|webm)$/i.test(chemin) && echantillons && existsSync(join(echantillons, "coucher.webm"))) {
      return route.fulfill({ path: join(echantillons, "coucher.webm"), contentType: "video/webm", headers: { "Access-Control-Allow-Origin": "*" } });
    }
    return route.fulfill({ status: 404 });
  });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  return { p, ctx, erreurs };
}

async function capturer(nom, { p, ctx, erreurs }, attente = 450) {
  await p.waitForTimeout(attente);
  await p.screenshot({ path: join(sortie, `${nom}.png`) });
  rapport.push({ nom, erreurs: [...erreurs] });
  await ctx.close();
}

const SECTIONS = { "Accueil": "accueil", "Bibliothèque": "bibliotheque", "Transferts": "transferts", "Intégrations": "integrations", "Paramètres": "parametres" };
const aller = async (p, libelle) => { await p.locator(`a[data-section="${SECTIONS[libelle]}"]`).click(); await p.waitForTimeout(350); };

// ---- Application ------------------------------------------------------------------------------------------------------
{
  const s = await page({});
  await capturer("desktop-1-accueil", s, 700);
}
{
  const s = await page({});
  await aller(s.p, "Bibliothèque");
  await s.p.locator("article.mcard").nth(7).click({ position: { x: 30, y: 30 } });
  await s.p.locator("article.mcard").nth(1).hover({ position: { x: 30, y: 30 } });
  await s.p.evaluate(() => document.querySelector(".page")?.scrollTo(0, 0));
  await s.p.locator("article.mcard").nth(1).locator("button[aria-label^='Importer']").hover();
  await capturer("desktop-2-bibliotheque", s, 900);
}
{
  const s = await page({});
  await aller(s.p, "Bibliothèque");
  await s.p.locator("article.mcard").nth(1).dblclick({ position: { x: 30, y: 30 } });
  await s.p.waitForTimeout(900);
  // Lecture réelle au clavier (L), puis pause (K) : vérifie aussi les raccourcis du lecteur.
  await s.p.keyboard.press("l");
  await s.p.waitForTimeout(1600);
  await s.p.keyboard.press("k");
  await s.p.waitForTimeout(300);
  const t = await s.p.evaluate(() => document.querySelector(".player video")?.currentTime ?? -1);
  console.log(`lecteur : position après L puis K = ${t.toFixed(2)} s`);
  const scrub = s.p.locator(".scrub");
  const b = await scrub.boundingBox();
  if (b) await s.p.mouse.move(b.x + b.width * 0.62, b.y + b.height / 2);
  await capturer("desktop-3-apercu", s, 900);
}
{
  const s = await page({});
  await aller(s.p, "Transferts");
  await capturer("desktop-4-transferts", s);
}
{
  const s = await page({});
  await aller(s.p, "Intégrations");
  await capturer("desktop-5-integrations", s);
}
{
  const s = await page({});
  await aller(s.p, "Paramètres");
  await capturer("desktop-6-parametres", s);
}
{
  const s = await page({}, { largeur: 900, hauteur: 700 });
  await aller(s.p, "Bibliothèque");
  await s.p.locator("article.mcard").nth(1).hover({ position: { x: 30, y: 30 } });
  await capturer("desktop-7-bibliotheque-900x700", s, 900);
}
{
  const s = await page({ theme: "clair" }, { theme: "light" });
  await capturer("desktop-8-accueil-clair", s, 700);
}
{
  const s = await page({});
  await aller(s.p, "Bibliothèque");
  await s.p.getByRole("button", { name: "Liste" }).click();
  await s.p.locator("article.lrow").nth(1).click();
  await s.p.locator("article.lrow").nth(2).click({ modifiers: ["Control"] });
  await capturer("desktop-9-bibliotheque-liste-selection", s);
}
{
  const s = await page({ vide: true, introuvable: true });
  await capturer("desktop-10-accueil-vide-sans-premiere", s, 700);
}
{
  const s = await page({});
  await aller(s.p, "Bibliothèque");
  await s.p.locator("article.mcard").nth(1).click({ position: { x: 30, y: 30 } });
  await s.p.keyboard.press("Control+i");
  await capturer("desktop-11-import-demande", s, 1400);
}

// ---- Parcours d'installation (fenêtre 960 × 640) ------------------------------------------------------------------------
const A = { mode: "assistant", assistantTermine: false };
{
  const s = await page(A, { largeur: 960, hauteur: 640 });
  await capturer("installateur-1-bienvenue", s, 1200);
}
{
  const s = await page(A, { largeur: 960, hauteur: 640 });
  await s.p.getByRole("button", { name: "Commencer" }).click();
  await s.p.getByText("Analyse terminée").waitFor();
  await capturer("installateur-2a-detection-compatible", s);
}
{
  const s = await page({ ...A, introuvable: true }, { largeur: 960, hauteur: 640 });
  await s.p.getByRole("button", { name: "Commencer" }).click();
  await s.p.getByText("Premiere Pro n'a pas été trouvé").first().waitFor();
  await capturer("installateur-2b-detection-introuvable", s);
}
{
  const s = await page(A, { largeur: 960, hauteur: 640 });
  await s.p.getByRole("button", { name: "Commencer" }).click();
  await s.p.getByText("Analyse terminée").waitFor();
  await s.p.getByRole("button", { name: "Continuer" }).click();
  await capturer("installateur-3-configuration", s);
}
{
  const s = await page({ ...A, pauseInstallation: true }, { largeur: 960, hauteur: 640 });
  await s.p.getByRole("button", { name: "Commencer" }).click();
  await s.p.getByText("Analyse terminée").waitFor();
  await s.p.getByRole("button", { name: "Continuer" }).click();
  await s.p.getByRole("button", { name: "Installer" }).click();
  await s.p.getByText("Démarrage avec Windows…").waitFor();
  await capturer("installateur-4-installation", s, 1500);
}
{
  const s = await page(A, { largeur: 960, hauteur: 640 });
  await s.p.getByRole("button", { name: "Commencer" }).click();
  await s.p.getByText("Analyse terminée").waitFor();
  await s.p.getByRole("button", { name: "Continuer" }).click();
  await s.p.getByRole("button", { name: "Installer" }).click();
  await s.p.getByText("AETHRYON est prêt.").waitFor({ timeout: 15000 });
  await capturer("installateur-5-termine", s, 1800);
}

// ---- Planches de comparaison : capture (gauche) et maquette approuvée (droite) -------------------------------------------
const planche = await navigateur.newPage();
for (const { nom } of rapport) {
  const m = join(maquettes, `${nom}.png`);
  if (!existsSync(m)) continue;
  const a = readFileSync(join(sortie, `${nom}.png`)).toString("base64");
  const b = readFileSync(m).toString("base64");
  await planche.setContent(`<body style="margin:0;background:#2a2a2e;display:flex;gap:12px;padding:12px;font:600 13px sans-serif;color:#eee">
    <div><div style="margin-bottom:6px">Application (maquette Tauri)</div><img id="a" src="data:image/png;base64,${a}"></div>
    <div><div style="margin-bottom:6px">Maquette approuvée (étape B)</div><img id="b" src="data:image/png;base64,${b}"></div></body>`);
  await planche.waitForTimeout(100);
  const t = await planche.evaluate(() => [document.body.scrollWidth, document.body.scrollHeight]);
  await planche.setViewportSize({ width: t[0], height: t[1] });
  await planche.screenshot({ path: join(sortie, `comparaison-${nom}.png`) });
}
await navigateur.close();
serveur.close();
writeFileSync(join(sortie, "rapport.json"), JSON.stringify(rapport, null, 2));
for (const r of rapport) console.log(`${r.nom} : ${r.erreurs.length ? r.erreurs.join(" | ") : "aucune erreur de console"}`);
