// Banc « Égide » (lot 2, Desktop) : captures des écrans principaux dans les six thèmes, axe-core, débordements,
// cadence pendant les animations (processeur ×4 simulé). Chromium (Playwright) + application construite (dist/) +
// MAQUETTE de l'API Tauri (e2e/maquette-tauri.js) : rien ici n'est WebView2 ni un vrai Windows (NON DÉMONTRÉ), et
// les images par seconde sont des PLANCHERS (Chromium sans GPU).
// Usage : npm run build && node e2e/egide.mjs
// Variables : DIST (dist/ à essayer, ex. la construction d'avant), SORTIE (captures), PREFIXE (« avant » / « apres »),
// THEMES (liste, défaut les six), TAILLES (« 1280x800,900x640 »), AXE (1 : axe-core), CADENCE (1 : mesures),
// ECRANS (liste), PLAYWRIGHT_CORE, AXE_PATH.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const dist = process.env.DIST || join(dirname(ici), "dist");
const sortie = process.env.SORTIE || "captures";
const prefixe = process.env.PREFIXE || "apres";
const THEMES = (process.env.THEMES || "obsidian,ivory,oled,midnight,minimal,custom").split(",").filter(Boolean);
const TAILLES = (process.env.TAILLES || "1280x800,900x640").split(",").map((t) => t.split("x").map(Number));
const AXE_SOURCE = process.env.AXE === "1" ? readFileSync(process.env.AXE_PATH || require.resolve("axe-core/axe.min.js"), "utf8") : null;
mkdirSync(sortie, { recursive: true });
const maquette = readFileSync(join(ici, "maquette-tauri.js"), "utf8");
const maquetteMusique = readFileSync(join(ici, "maquette-musique.js"), "utf8");
const FIX = join(ici, "fixtures", "musique");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  const f = join(dist, p === "/" ? "index.html" : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const port = serveur.address().port;
const MINIATURES = { 1: "film-cartes.jpg", 2: "coucher-6s.jpg", 3: "coucher-vertical-169.jpg", 4: "coucher-passage-gif.jpg", 8: "film-tools.jpg", 9: "coucher-1s.jpg", a: "coucher-1s.jpg", b: "coucher-1s.jpg", e: "coucher-1s.jpg" };
const WEBM = join(ici, "..", "..", "extension-premiere", "maquette", "medias", "coucher.webm");

const navigateur = await pw.chromium.launch();
const resultats = { captures: [], axe: {}, debordements: [], erreurs: [], cadence: {} };

/** Préférence d'apparence posée AVANT le premier script (même enregistrement que la persistance Égide). */
const preference = (theme) => `try { localStorage.setItem("aethryon.apparence.v1", JSON.stringify({ v: 1, actif: ${JSON.stringify(theme)}, perso: null, cache: null, maj: 1 })); } catch {}`;

async function ouvrir(scenario = {}, { largeur = 1280, hauteur = 800, theme = "obsidian", reduit = false, couleurs = "dark" } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: couleurs, reducedMotion: reduit ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  p.__erreurs = erreurs;
  await p.addInitScript([preference(theme), `window.__SCENARIO__ = ${JSON.stringify({ indexVide: true, ...scenario })};`, maquette, maquetteMusique].join("\n"));
  // Rien ne sort (lecteurs officiels, pochettes distantes) : bloqué.
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|asset\.localhost)/, (route) => route.abort());
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const id = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (id && MINIATURES[id[0]]) return route.fulfill({ path: join(ici, "fixtures", MINIATURES[id[0]]), contentType: "image/jpeg" });
    const poch = (chemin.match(/pochettes\\([0-9a-f]{32}\.jpg)$/) || [])[1];
    const pp = poch && (await p.evaluate((n) => window.__POCHETTES__?.[n], poch).catch(() => null));
    if (pp) return route.fulfill({ path: join(FIX, pp), contentType: "image/jpeg" });
    if (/\.(mp4|m4v|mov|webm)$/i.test(chemin) && existsSync(WEBM)) return route.fulfill({ path: WEBM, contentType: "video/webm", headers: { "Access-Control-Allow-Origin": "*" } });
    return route.fulfill({ status: 404, body: "" });
  });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForSelector(".win, .ins, .assistant, [data-assistant]", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(300);
  return { p, ctx };
}

async function fermer({ p, ctx }) {
  resultats.erreurs.push(...p.__erreurs.filter((e) => !/404|Failed to load resource|NotSupportedError|no supported source/i.test(e)));
  await ctx.close();
}

const aller = async (p, section) => { await p.locator(`a[data-section="${section}"]`).first().click(); await p.waitForTimeout(380); };

async function debordements(p) {
  return p.evaluate(() => {
    const coupes = [...document.querySelectorAll("button, a[href], input, select, [role=tab]")]
      .filter((el) => el.getClientRects().length && !el.closest(".mu-rangee, .bib-grille, [inert], .sc-erreurs ul, [aria-hidden=true], .eg-ed-apercu"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5))
      .map(({ el }) => el.outerHTML.slice(0, 90));
    return { document: document.documentElement.scrollWidth - document.documentElement.clientWidth, coupes };
  });
}

async function axe(p) {
  if (!AXE_SOURCE) return null;
  if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(AXE_SOURCE);
  return p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target).join(" | ")}`));
}

/** Écrans : nom, scénario, préparation (navigation et gestes). */
const ECRANS = [
  ["accueil", {}, async () => {}],
  ["accueil-lien", { compte: "utilisateur" }, async (p) => {
    const champ = p.locator("input[type=url]").first();
    await champ.fill("https://bsky.app/profile/marais.exemple/post/3l2demo");
    await p.waitForTimeout(400);
  }],
  ["accueil-refusee", { compte: "utilisateur" }, async (p) => {
    await p.locator("input[type=url]").first().fill("https://open.spotify.com/track/exemple");
    await p.waitForTimeout(400);
  }],
  ["bibliotheque", { indexVide: false }, async (p) => aller(p, "bibliotheque")],
  ["transferts", { pilotables: true }, async (p) => aller(p, "transferts")],
  ["musique", { compte: "admin" }, async (p) => { await aller(p, "musique"); await p.waitForTimeout(700); }],
  ["cloud", { compte: "admin" }, async (p) => { await aller(p, "cloud"); await p.waitForTimeout(500); }],
  ["integrations", {}, async (p) => aller(p, "integrations")],
  ["parametres", {}, async (p) => aller(p, "parametres")],
  ["apparence", {}, async (p) => {
    await aller(p, "parametres");
    const lien = p.locator('a[href="#reg-apparence"]');
    if (await lien.count()) { await lien.first().click(); await p.waitForTimeout(500); }
  }],
  ["scanner", {}, async (p) => {
    const b = p.getByRole("button", { name: /Scanner/ }).first();
    if (await b.count()) { await b.click(); await p.waitForTimeout(500); }
  }],
  ["apercu", { indexVide: false }, async (p) => {
    await aller(p, "bibliotheque");
    const c = p.locator("[data-media]").first();
    await c.focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(500);
  }],
  ["assistant", { assistantTermine: false }, async (p) => { await p.waitForTimeout(400); }],
];
const choisis = (process.env.ECRANS || "").split(",").filter(Boolean);

for (const [l, h] of TAILLES) {
  for (const theme of THEMES) {
    for (const [nom, scenario, preparer] of ECRANS) {
      if (choisis.length && !choisis.includes(nom)) continue;
      // Hors 1280 × 800 : seulement les écrans principaux (largeur minimale de la fenêtre).
      if (l !== 1280 && !["accueil", "accueil-lien", "bibliotheque", "transferts", "parametres", "apparence", "musique", "scanner"].includes(nom)) continue;
      const s = await ouvrir(scenario, { largeur: l, hauteur: h, theme, couleurs: theme === "ivory" || theme === "minimal" ? "light" : "dark" });
      try {
        await preparer(s.p);
        const fichier = `${prefixe}-${nom}-${theme}-${l}x${h}.png`;
        await s.p.screenshot({ path: join(sortie, fichier) });
        resultats.captures.push(fichier);
        const d = await debordements(s.p);
        if (d.document > 0 || d.coupes.length) resultats.debordements.push({ nom, theme, l, h, ...d });
        const v = await axe(s.p);
        if (v) resultats.axe[`${nom}-${theme}-${l}x${h}`] = v;
      } catch (e) {
        resultats.erreurs.push(`${nom} ${theme} ${l}x${h} : ${String(e).slice(0, 300)}`);
      }
      await fermer(s);
    }
  }
}

// ---- Cadence pendant les animations, processeur ×4 (CDP) ---------------------------------------------------------
async function cadence(p, faire, ms = 2500) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.evaluate(() => {
    window.__images = []; window.__longues = 0;
    try { new PerformanceObserver((l) => { window.__longues += l.getEntries().filter((e) => e.duration > 50).length; }).observe({ type: "longtask", buffered: false }); } catch {}
    let t0 = performance.now();
    const boucle = (t) => { window.__images.push(t - t0); t0 = t; if (window.__images.length < 100000) requestAnimationFrame(boucle); };
    requestAnimationFrame(boucle);
  });
  await faire();
  await p.waitForTimeout(ms);
  const r = await p.evaluate(() => {
    const im = window.__images.slice(2);
    const tri = [...im].sort((a, b) => a - b);
    const total = im.reduce((s, x) => s + x, 0);
    return { ips: Math.round((im.length / total) * 1000 * 10) / 10, p95: Math.round(tri[Math.floor(tri.length * 0.95)] * 10) / 10, pire: Math.round(tri[tri.length - 1] * 10) / 10, longues: window.__longues };
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  return r;
}

if (process.env.CADENCE === "1") {
  const s = await ouvrir({ pilotables: true });
  // Le fil : deux transferts qui avancent (événements « changement » de la maquette, progression interpolée).
  resultats.cadence.fil = await cadence(s.p, async () => {
    await s.p.evaluate(() => {
      const m = window.__maquette; let n = 0;
      const t = setInterval(() => { n += 1; for (const x of m.etat.transferts) if (x.etat === "telechargement" || x.etat === "conversion") x.progression = Math.min(0.99, (x.progression ?? 0) + 0.01); m.emettre("changement", "transferts"); if (n > 40) clearInterval(t); }, 250);
    });
  });
  // Navigation au clic (indicateur qui glisse) puis survols de la bibliothèque.
  resultats.cadence.navigation = await cadence(s.p, async () => {
    for (const sec of ["bibliotheque", "transferts", "parametres", "accueil"]) { await s.p.locator(`a[data-section="${sec}"]`).first().click(); await s.p.waitForTimeout(260); }
  }, 600);
  // Changement de thème (fondu View Transitions) depuis Paramètres › Apparence.
  await aller(s.p, "parametres");
  resultats.cadence.theme = await cadence(s.p, async () => {
    const b = s.p.locator('.eg-ed-base[data-base="ivory"]');
    if (await b.count()) { await b.first().click(); await s.p.waitForTimeout(150); const a = s.p.getByRole("button", { name: "Appliquer" }); if (await a.count()) await a.first().click(); }
  }, 1200);
  await fermer(s);
}

writeFileSync(join(sortie, `${prefixe}-resultats.json`), JSON.stringify(resultats, null, 1));
const nbAxe = Object.values(resultats.axe).reduce((n, v) => n + v.length, 0);
console.log(`${resultats.captures.length} captures ; axe : ${AXE_SOURCE ? nbAxe + " violation(s)" : "non lancé"} ; débordements : ${resultats.debordements.length} ; erreurs : ${resultats.erreurs.length}`);
if (nbAxe) for (const [k, v] of Object.entries(resultats.axe)) if (v.length) console.log(" axe", k, v.join(" ; "));
for (const d of resultats.debordements) console.log(" débordement", JSON.stringify(d).slice(0, 300));
for (const e of resultats.erreurs.slice(0, 20)) console.log(" erreur", e.slice(0, 300));
if (resultats.cadence && Object.keys(resultats.cadence).length) console.log(" cadence", JSON.stringify(resultats.cadence));
await navigateur.close();
serveur.close();
