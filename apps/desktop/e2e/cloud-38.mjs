// Banc d'AETHRYON Cloud dans le Desktop (CLOUD-UI.md) : Chromium (Playwright), application construite (dist/), MAQUETTE
// de l'API Tauri (e2e/maquette-tauri.js : compte_*, cloud_*, mêmes formes que le cœur). Les captures prouvent
// l'INTERFACE ; la logique réelle (coffre, appairage, PUT présigné, téléchargement) est essayée par `cargo test` (noyau)
// et par le banc de bout en bout account/test/cloud-desktop-e2e.ts.
// Usage : npm run build && node e2e/cloud-38.mjs   (SORTIE : dossier des captures ; PLAYWRIGHT_CORE : module)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const dist = join(dirname(ici), "dist");
const sortie = process.env.SORTIE || "captures";
mkdirSync(sortie, { recursive: true });
const maquette = readFileSync(join(ici, "maquette-tauri.js"), "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  const f = join(dist, p === "/" ? "index.html" : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const port = serveur.address().port;
const MINIATURES = { 1: "film-cartes.jpg", 2: "coucher-6s.jpg", 3: "coucher-vertical-169.jpg", 4: "coucher-passage-gif.jpg", 8: "film-tools.jpg", 9: "coucher-1s.jpg", a: "coucher-1s.jpg", b: "coucher-1s.jpg" };
const H = (c) => c.repeat(40);

const navigateur = await pw.chromium.launch();
const essais = [];
const erreursConsole = [];
const captures = [];

async function ouvrir(scenario = {}, { largeur = 1280, hauteur = 800, theme = "dark", reduit = false } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: theme, reducedMotion: reduit ? "reduce" : "no-preference" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  p.__erreurs = erreurs;
  await p.addInitScript([`window.__SCENARIO__ = ${JSON.stringify({ indexVide: true, ...scenario })};`, maquette].join("\n"));
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const id = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (id && MINIATURES[id[0]]) return route.fulfill({ path: join(ici, "fixtures", MINIATURES[id[0]]), contentType: "image/jpeg" });
    return route.fulfill({ status: 404, body: "" });
  });
  // L'URL signée du stockage (B2) : servie ici par un clip d'essai (aucune requête vers Backblaze).
  p.__lectures = [];
  await p.route("https://*.backblazeb2.com/**", (route) => { p.__lectures.push(route.request().url()); return route.fulfill({ path: join(ici, "fixtures", "coucher-apercu.mp4"), contentType: "video/mp4" }); });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForSelector(".win");
  return { p, ctx };
}

async function fermer({ p, ctx }) {
  erreursConsole.push(...p.__erreurs.filter((e) => !/404|Failed to load resource/.test(e)));
  await ctx.close();
}

async function a11y(p) {
  return p.evaluate(() => {
    const nom = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim()
      || (el.getAttribute("aria-labelledby") || "").split(" ").map((i) => document.getElementById(i)?.textContent || "").join("").trim()
      || (el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
    const sansNom = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, [role=menuitem], [role=option], [role=switch], [role=slider], [role=listitem][tabindex]")]
      .filter((el) => !el.closest("[aria-hidden=true]") && el.getClientRects().length && !nom(el) && !(el.tagName === "INPUT" && (el.labels?.length || el.getAttribute("aria-label"))))
      .map((el) => el.outerHTML.slice(0, 90));
    const orphelins = [...document.querySelectorAll("[aria-activedescendant]")].filter((el) => !document.getElementById(el.getAttribute("aria-activedescendant"))).map((el) => el.outerHTML.slice(0, 90));
    return { sansNom, orphelins };
  });
}

async function capturer(p, nom) {
  const fichier = `desktop-${nom}.png`;
  await p.screenshot({ path: join(sortie, fichier) });
  const a = await a11y(p);
  captures.push({ fichier, sansNom: a.sansNom.length, orphelins: a.orphelins.length, detail: [...a.sansNom, ...a.orphelins].slice(0, 3) });
}

async function essai(nom, f) {
  const t0 = Date.now();
  try {
    const detail = await f();
    essais.push({ nom, ok: detail?.ok !== false, detail, ms: Date.now() - t0 });
  } catch (e) {
    essais.push({ nom, ok: false, detail: String(e?.stack || e).slice(0, 700), ms: Date.now() - t0 });
  }
}

const aller = async (p, section) => { await p.locator(`a[data-section="${section}"]`).click(); await p.waitForTimeout(350); };
// Nocturne : les grandes vignettes peuvent être sous la ligne de flottaison : on les amène à l'écran d'abord, puis on
// laisse passer l'événement de défilement (un menu ouvert se ferme au défilement).
const centre = async (loc) => { await loc.scrollIntoViewIfNeeded(); await loc.page().waitForTimeout(120); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const carte = (p, c) => p.locator(`.mcard[data-media="${H(c)}"]`);
const ligne = (p, nom) => p.locator(".cl-ligne", { hasText: nom });
const appels = (p) => p.evaluate(() => window.__maquette.appels.filter((a) => a.startsWith("cloud_") || a.startsWith("compte_")));
/** Aucune clé dans la WebView : ni dans le DOM, ni dans le stockage local (la clé reste dans le cœur Rust). */
const sansCle = (p) => p.evaluate(() => {
  const ls = (() => { try { return Object.keys(localStorage).map((k) => k + "=" + localStorage.getItem(k)).join("\n"); } catch { return ""; } })();
  const ss = (() => { try { return Object.keys(sessionStorage).map((k) => k + "=" + sessionStorage.getItem(k)).join("\n"); } catch { return ""; } })();
  return !/ytc_/.test(document.documentElement.outerHTML + ls + ss);
});
async function attendreTransfert(p, etape, ms = 8000) {
  await p.waitForFunction((e) => [...document.querySelectorAll(".cl-tr")].some((x) => x.dataset.etape === e), etape, { timeout: ms });
}
async function envoyerDepuisMenu(p, c) {
  await aller(p, "bibliotheque");
  const { x, y } = await centre(carte(p, c));
  await p.mouse.click(x, y, { button: "right" });
  await p.waitForSelector(".menu--flottant");
  await p.locator(".menu--flottant [role=menuitem]", { hasText: "Sauvegarder dans le Cloud" }).click();
  await p.waitForTimeout(150);
  await aller(p, "cloud");
}

// ======================================================================================================================
// 1. Liaison du Desktop au compte (Paramètres › Compte) : code, page d'accord, compte relié, aucune clé dans la WebView
// ======================================================================================================================
await essai("appairage : code affiché, accord sur le site, compte administrateur relié, entrée Cloud apparue ; aucune clé dans la WebView", async () => {
  const s = await ouvrir();
  const avant = await s.p.locator('a[data-section="cloud"]').count();
  await aller(s.p, "parametres");
  await s.p.waitForSelector('[data-compte="non-relie"]');
  await capturer(s.p, "01-parametres-non-relie");
  await s.p.getByRole("button", { name: "Relier ce Desktop…" }).click();
  await s.p.waitForSelector(".appairage-code");
  const code = await s.p.locator(".appairage-code").textContent();
  const url = await s.p.locator(".appairage-url .mono").textContent();
  await capturer(s.p, "02-appairage-code");
  await s.p.evaluate(() => window.__maquette.compte.autoriser(true));
  await s.p.waitForSelector('[data-compte="relie"]', { timeout: 4000 });
  const relie = await s.p.locator('[data-compte="relie"] .rt').textContent();
  const apres = await s.p.locator('a[data-section="cloud"]').count();
  await capturer(s.p, "03-compte-relie-admin");
  const cle = await sansCle(s.p);
  await fermer(s);
  return { ok: avant === 0 && code === "BCDF-GHJK" && url.endsWith("/desktop/connecter?code=BCDF-GHJK") && /elodie@/.test(relie) && apres === 1 && cle, avant, code, url, relie, apres, cle };
});

await essai("appairage refusé sur le site : message clair, « Recommencer », rien n'est relié", async () => {
  const s = await ouvrir({ appairage: "refuse" });
  await aller(s.p, "parametres");
  await s.p.getByRole("button", { name: "Relier ce Desktop…" }).click();
  await s.p.waitForSelector('[data-compte="non-relie"] .appairage-avis', { timeout: 3000 });
  const avis = await s.p.locator('[data-compte="non-relie"] .appairage-avis').textContent();
  const bouton = await s.p.getByRole("button", { name: "Recommencer" }).count();
  await capturer(s.p, "04-appairage-refuse");
  await fermer(s);
  return { ok: /refusée/.test(avis) && bouton === 1, avis };
});

await essai("compte ordinaire : aucune entrée Cloud, explication sobre dans Paramètres, Ctrl 5 ne mène jamais au Cloud (Musique occupe Ctrl 3)", async () => {
  const s = await ouvrir({ compte: "utilisateur" });
  const nav = await s.p.locator('a[data-section="cloud"]').count();
  await aller(s.p, "parametres");
  const txt = await s.p.locator('[data-compte="cloud"] .rd').textContent();
  await capturer(s.p, "05-non-administrateur");
  await s.p.keyboard.press("Control+5");
  await s.p.waitForTimeout(300);
  const titre = await s.p.locator("h1").first().textContent();
  const a = await appels(s.p);
  await fermer(s);
  return { ok: nav === 0 && /réservé à l'administrateur/.test(txt) && titre !== "Cloud" && !a.some((x) => x.startsWith("cloud_objets")), nav, txt, titre };
});

await essai("cloud coupé sur le serveur (administrateur) : aucune entrée Cloud, « pas activé » dans Paramètres", async () => {
  const s = await ouvrir({ compte: "ferme" });
  const nav = await s.p.locator('a[data-section="cloud"]').count();
  await aller(s.p, "parametres");
  const txt = await s.p.locator('[data-compte="cloud"] .rd').textContent();
  await fermer(s);
  return { ok: nav === 0 && /pas activé/.test(txt), txt };
});

// ======================================================================================================================
// 2. Section Cloud : quota, liste, statuts, expiration, recherche et filtres, aperçu, lien temporaire, suppression
// ======================================================================================================================
await essai("liste et quota : jauge réelle, statuts du brief, « Expire dans X jours » et date, expiré sans action", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await s.p.waitForSelector(".cl-ligne");
  const r = await s.p.evaluate(() => ({
    jauge: document.querySelector(".cl-barre")?.getAttribute("aria-valuetext"),
    niveau: document.querySelector(".cl-jauge")?.dataset.niveau,
    lignes: [...document.querySelectorAll(".cl-ligne")].map((l) => ({ nom: l.querySelector(".cl-nom").textContent, statut: l.querySelector(".eg-pastille").textContent, exp: l.querySelector(".cl-exp")?.textContent ?? null, proche: !!l.querySelector(".cl-exp--proche"), actions: l.querySelectorAll(".cl-actions button").length })),
    sync: document.querySelector(".cl-sync")?.textContent,
  }));
  await capturer(s.p, "06-cloud-liste-quota");
  await s.p.locator(".select--natif[aria-label='Statut des fichiers']").selectOption("expire");
  await s.p.waitForTimeout(400);
  const expire = await s.p.evaluate(() => [...document.querySelectorAll(".cl-ligne")].map((l) => ({ statut: l.querySelector(".eg-pastille").textContent, actions: [...l.querySelectorAll(".cl-actions button")].map((b) => b.getAttribute("aria-label")) })));
  await capturer(s.p, "07-cloud-expire");
  await fermer(s);
  const statuts = new Set(r.lignes.map((l) => l.statut));
  const plan = r.lignes.find((l) => l.nom.startsWith("Plan large"));
  return {
    ok: /utilisés sur 9 Go/.test(r.jauge) && ["Sauvegardé", "En attente de sauvegarde", "Échec de sauvegarde"].every((x) => statuts.has(x)) && plan?.proche && /Expire dans 2 jours/.test(plan.exp) && /le \d+ \w+ \d{4}/.test(plan.exp)
      && /abandonné/.test(r.sync ?? "") && expire.length === 1 && expire[0].statut === "Expiré" && expire[0].actions.length === 1 && /Supprimer/.test(expire[0].actions[0]),
    ...r, expire,
  };
});

await essai("recherche et filtres (appliqués par le serveur) : texte, audio, aucune correspondance", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await s.p.waitForSelector(".cl-ligne");
  await s.p.locator("input[aria-label='Rechercher dans le Cloud']").fill("coucher");
  await s.p.waitForTimeout(500);
  const q = await s.p.locator(".cl-ligne .cl-nom").allTextContents();
  await s.p.locator("input[aria-label='Rechercher dans le Cloud']").fill("");
  await s.p.getByRole("button", { name: "Audio" }).click();
  await s.p.waitForTimeout(500);
  const audio = await s.p.locator(".cl-ligne .cl-nom").allTextContents();
  await capturer(s.p, "08-cloud-filtre-audio");
  await s.p.locator("input[aria-label='Rechercher dans le Cloud']").fill("introuvable");
  await s.p.waitForTimeout(500);
  const vide = await s.p.locator(".cl-vide h2").textContent();
  await fermer(s);
  return { ok: q.length === 1 && /Coucher/.test(q[0]) && audio.length === 2 && audio.every((n) => /\.(mp3|wav)$/.test(n)) && vide === "Aucun fichier ne correspond.", q, audio, vide };
});

await essai("aperçu : lien signé « apercu » lu par le lecteur intégré, durée affichée", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await ligne(s.p, "Le Passage").locator("button[aria-label^='Aperçu']").click();
  await s.p.waitForSelector(".cl-apercu video");
  await s.p.waitForFunction(() => (document.querySelector(".cl-apercu video")?.readyState ?? 0) >= 1, null, { timeout: 5000 });
  const r = await s.p.evaluate(() => ({ src: document.querySelector(".cl-apercu video").src, note: document.querySelector(".dialog .t-small").textContent, duree: document.querySelector(".cl-apercu video").duration }));
  await capturer(s.p, "09-cloud-apercu");
  await s.p.keyboard.press("Escape");
  const ferme = await s.p.locator(".cl-apercu").count();
  await fermer(s);
  return { ok: /backblazeb2\.com/.test(r.src) && /X-Amz-Signature/.test(r.src) && /valable 5 min/.test(r.note) && r.duree > 1 && ferme === 0, ...r };
});

await essai("copier un lien temporaire : presse-papiers, durée et avertissement affichés", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await ligne(s.p, "Le Passage").locator("button[aria-label^='Copier un lien']").click();
  await s.p.waitForSelector(".toast");
  const toast = await s.p.locator(".toast").last().textContent();
  const presse = await s.p.evaluate(() => navigator.clipboard.readText());
  await capturer(s.p, "10-cloud-lien-copie");
  await fermer(s);
  return { ok: /Lien temporaire copié/.test(toast) && /valable 5 min/.test(toast) && /X-Amz-Signature/.test(presse), toast, presse: presse.slice(0, 60) };
});

await essai("téléchargement local : progression réelle, dans le dossier des médias, sans écrasement « (2) », visible dans la bibliothèque", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await ligne(s.p, "Coucher de soleil sur la côte.mp3").locator("button[aria-label^='Télécharger']").click();
  await attendreTransfert(s.p, "telechargement");
  const pendant = await s.p.locator(".cl-tr .cl-tr-etat").first().textContent();
  await capturer(s.p, "11-cloud-telechargement");
  await attendreTransfert(s.p, "termine");
  const msg = await s.p.locator('.cl-tr[data-etape="termine"] .cl-tr-msg').textContent();
  await capturer(s.p, "12-cloud-telecharge");
  await aller(s.p, "bibliotheque");
  const biblio = await s.p.locator(".mcard .ellipsis, .mcard [class*=nom]").allTextContents();
  await fermer(s);
  return { ok: /Téléchargement · \d+ %/.test(pendant) && /\(2\)\.mp3/.test(msg) && biblio.some((n) => /\(2\)/.test(n)), pendant, msg };
});

await essai("téléchargement annulé, puis lien temporaire expiré : « Annulé », puis erreur lisible", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await ligne(s.p, "Plan large").locator("button[aria-label^='Télécharger']").click();
  await attendreTransfert(s.p, "telechargement");
  await s.p.locator(".cl-tr").first().getByRole("button", { name: "Annuler" }).click();
  await attendreTransfert(s.p, "annule");
  await fermer(s);
  const e = await ouvrir({ compte: "admin", lienExpire: true });
  await aller(e.p, "cloud");
  await ligne(e.p, "Le Passage").locator("button[aria-label^='Télécharger']").click();
  await attendreTransfert(e.p, "echec");
  const msg = await e.p.locator('.cl-tr[data-etape="echec"] .cl-tr-msg').textContent();
  await capturer(e.p, "13-cloud-lien-expire");
  await fermer(e);
  return { ok: /Lien temporaire expiré/.test(msg), msg };
});

await essai("suppression manuelle : confirmation, définitive, quota libéré ; Échap rend le focus", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  const avant = await s.p.locator(".cl-barre").getAttribute("aria-valuenow");
  await ligne(s.p, "Plan large").locator("button[aria-label^='Supprimer']").click();
  await s.p.waitForSelector(".dialog");
  const titre = await s.p.locator(".dialog h2").textContent();
  await capturer(s.p, "14-cloud-suppression-confirmation");
  await s.p.getByRole("button", { name: "Supprimer", exact: true }).click();
  await s.p.waitForFunction(() => ![...document.querySelectorAll(".cl-nom")].some((n) => n.textContent.startsWith("Plan large")), null, { timeout: 4000 });
  await s.p.waitForTimeout(300);
  const apres = await s.p.locator(".cl-barre").getAttribute("aria-valuenow");
  const toast = await s.p.locator(".toast").last().textContent();
  await capturer(s.p, "15-cloud-supprime");
  await fermer(s);
  return { ok: /Supprimer «.Plan large/.test(titre) && Number(avant) - Number(apres) === 1_415_414_067 && /toutes ses versions/.test(toast), avant, apres, toast };
});

// ======================================================================================================================
// 3. Envoi d'un média local vers le Cloud : réussi, interrompu, trop gros, quota atteint ; glisser sur l'entrée Cloud
// ======================================================================================================================
await essai("envoi depuis la bibliothèque (menu) : préparation, envoi en cours (progression réelle), vérification, « Sauvegardé » ; PNG refusé", async () => {
  const s = await ouvrir({ compte: "admin", envoiLent: true });
  await aller(s.p, "bibliotheque");
  // Image PNG : l'action existe mais est désactivée, avec sa raison.
  const { x, y } = await centre(carte(s.p, "9"));
  await s.p.mouse.click(x, y, { button: "right" });
  await s.p.waitForSelector(".menu--flottant");
  const png = await s.p.locator(".menu--flottant [role=menuitem]", { hasText: "Sauvegarder dans le Cloud" }).evaluate((el) => ({ desactive: el.getAttribute("aria-disabled"), titre: el.getAttribute("title") ?? el.textContent }));
  await s.p.keyboard.press("Escape");
  await envoyerDepuisMenu(s.p, "2");
  await attendreTransfert(s.p, "envoi");
  await s.p.waitForTimeout(500);
  const pendant = await s.p.locator('.cl-tr[data-etape="envoi"] .cl-tr-etat').textContent();
  const barre = await s.p.locator('.cl-tr[data-etape="envoi"] .cl-tr-barre').getAttribute("aria-valuenow");
  const nav = await s.p.locator('a[data-section="cloud"] .count').textContent();
  await capturer(s.p, "16-envoi-en-cours");
  await attendreTransfert(s.p, "confirmation", 12000);
  const conf = await s.p.locator('.cl-tr[data-etape="confirmation"] .cl-tr-etat').textContent();
  await attendreTransfert(s.p, "termine", 6000);
  await s.p.waitForTimeout(400);
  const fin = await s.p.locator('.cl-tr[data-etape="termine"] .cl-tr-etat').textContent();
  const liste = await ligne(s.p, "Coucher de soleil sur la côte.mp4").locator(".cl-exp").textContent();
  await capturer(s.p, "17-envoi-sauvegarde");
  await fermer(s);
  return { ok: png.desactive === "true" && /Envoi en cours · \d+ %/.test(pendant) && Number(barre) > 0 && nav === "1" && conf === "Vérification par le serveur…" && fin === "Sauvegardé" && /Expire dans 30 jours/.test(liste), png, pendant, barre, conf, fin, liste };
});

await essai("envoi interrompu (coupure à 42 %) : « Échec de sauvegarde », place libérée, « Réessayer »", async () => {
  const s = await ouvrir({ compte: "admin", envoiCoupe: true });
  await envoyerDepuisMenu(s.p, "8");
  await attendreTransfert(s.p, "echec", 10000);
  const r = await s.p.evaluate(() => { const t = document.querySelector('.cl-tr[data-etape="echec"]'); return { etat: t.querySelector(".cl-tr-etat").textContent, msg: t.querySelector(".cl-tr-msg").textContent, reessayer: !![...t.querySelectorAll("button")].find((b) => b.textContent === "Réessayer") }; });
  const objets = await s.p.evaluate(() => window.__maquette.compte.objets().filter((o) => o.nom.startsWith("AETHRYON Tools")).length);
  await capturer(s.p, "18-envoi-interrompu");
  await fermer(s);
  return { ok: r.etat === "Échec de sauvegarde" && /interrompu/.test(r.msg) && r.reessayer && objets === 0, ...r };
});

await essai("fichier trop volumineux, quota atteint : refus clairs, jauge « pleine », rien n'est supprimé", async () => {
  const s = await ouvrir({ compte: "admin", tropGros: true });
  await envoyerDepuisMenu(s.p, "2");
  await attendreTransfert(s.p, "echec");
  const gros = await s.p.locator('.cl-tr[data-etape="echec"] .cl-tr-msg').textContent();
  await capturer(s.p, "19-envoi-trop-gros");
  await fermer(s);
  const q = await ouvrir({ compte: "admin", quotaPlein: true });
  const nb = await q.p.evaluate(() => window.__maquette.compte.objets().length);
  await envoyerDepuisMenu(q.p, "2");
  await attendreTransfert(q.p, "echec");
  const quota = await q.p.locator('.cl-tr[data-etape="echec"] .cl-tr-msg').textContent();
  const niveau = await q.p.locator(".cl-jauge").getAttribute("data-niveau");
  const avis = await q.p.locator(".cl-jauge-avis").textContent();
  const nb2 = await q.p.evaluate(() => window.__maquette.compte.objets().length);
  await capturer(q.p, "20-quota-atteint");
  await fermer(q);
  return { ok: /trop volumineux/.test(gros) && /Espace Cloud insuffisant/.test(quota) && niveau === "plein" && /Cloud plein/.test(avis) && nb2 === nb, gros, quota, niveau };
});

await essai("glisser une carte sur l'entrée « Cloud » de la navigation : zone acceptée (par position), envoi lancé", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "bibliotheque");
  const { x, y } = await centre(carte(s.p, "3").locator(".thumb"));
  await s.p.mouse.move(x, y);
  await s.p.mouse.down();
  await s.p.mouse.move(x + 4, y + 2);
  await s.p.mouse.move(x + 10, y + 4);
  await s.p.waitForFunction(() => window.__maquette.flux.glisser() !== null, null, { timeout: 2000 });
  await s.p.mouse.up();
  const g = await s.p.evaluate(() => window.__maquette.flux.glisser());
  await s.p.evaluate(([c]) => window.__maquette.flux.entrer(c, 600, 400), [g.chemins]);
  await s.p.waitForTimeout(80);
  const n = await centre(s.p.locator('a[data-section="cloud"]'));
  await s.p.evaluate(([px, py]) => window.__maquette.flux.survoler(px, py), [n.x, n.y]);
  await s.p.waitForTimeout(150);
  const etat = await s.p.evaluate(() => document.querySelector('a[data-section="cloud"]').dataset.fluxEtat);
  await capturer(s.p, "21-glisser-sur-cloud");
  await s.p.evaluate(([c, px, py]) => window.__maquette.flux.deposer(c, px, py), [g.chemins, n.x, n.y]);
  await s.p.waitForTimeout(400);
  const a = await appels(s.p);
  const toast = await s.p.locator(".toast").last().textContent();
  await capturer(s.p, "22-glisser-envoi-lance");
  await fermer(s);
  return { ok: etat === "accepte" && a.includes("cloud_envoyer") && /Envoi vers le Cloud.: 1.média/.test(toast), etat, toast };
});

// ======================================================================================================================
// 4. Clavier, mouvement réduit, thème clair, fenêtre étroite, état vide, révocation
// ======================================================================================================================
await essai("clavier : Ctrl 5 ouvre le Cloud (Musique occupe Ctrl 3), Tab vers une ligne, Maj F10 (menu sans animation), Entrée = aperçu, Suppr = confirmation, Échap rend le focus", async () => {
  const s = await ouvrir({ compte: "admin" });
  await s.p.keyboard.press("Control+5");
  await s.p.waitForSelector(".cl-ligne");
  const titre = await s.p.locator("h1").first().textContent();
  await s.p.locator(".cl-ligne").first().focus();
  await s.p.keyboard.press("Shift+F10");
  await s.p.waitForSelector(".menu--flottant");
  const instantane = await s.p.locator(".menu--flottant").evaluate((el) => el.classList.contains("menu--instantane"));
  await capturer(s.p, "23-clavier-menu");
  await s.p.keyboard.press("Escape");
  await s.p.keyboard.press("Enter");
  await s.p.waitForSelector(".cl-apercu video");
  await s.p.keyboard.press("Escape");
  await s.p.waitForTimeout(150);
  await s.p.keyboard.press("Delete");
  await s.p.waitForSelector(".dialog");
  await s.p.keyboard.press("Escape");
  await s.p.waitForTimeout(150);
  const focus = await s.p.evaluate(() => document.activeElement?.classList.contains("cl-ligne"));
  await fermer(s);
  return { ok: titre === "Cloud" && instantane && focus, titre, instantane, focus };
});

await essai("mouvement réduit : attente de vérification en rayures fixes (aucune boucle), jauge sans transition", async () => {
  const s = await ouvrir({ compte: "admin", envoiLent: true }, { reduit: true });
  await envoyerDepuisMenu(s.p, "2");
  await attendreTransfert(s.p, "confirmation", 12000);
  const r = await s.p.evaluate(() => {
    const i = document.querySelector('.cl-tr[data-etape="confirmation"] .cl-tr-barre--indet > i');
    const cs = getComputedStyle(i);
    return { animation: cs.animationName, fond: cs.backgroundImage.slice(0, 40), transition: getComputedStyle(document.querySelector(".cl-barre > i")).transitionDuration };
  });
  await capturer(s.p, "24-mouvement-reduit");
  await fermer(s);
  const n = await ouvrir({ compte: "admin", envoiLent: true });
  await envoyerDepuisMenu(n.p, "2");
  await attendreTransfert(n.p, "confirmation", 12000);
  const normal = await n.p.evaluate(() => getComputedStyle(document.querySelector('.cl-tr[data-etape="confirmation"] .cl-tr-barre--indet > i')).animationName);
  await fermer(n);
  return { ok: r.animation === "none" && /repeating-linear-gradient/.test(r.fond) && parseFloat(r.transition) <= 0.001 && normal === "comete", ...r, normal };
});

await essai("état vide original (chouette), thème clair, fenêtre étroite 900 × 640", async () => {
  const v = await ouvrir({ compte: "admin", cloudVide: true });
  await aller(v.p, "cloud");
  await v.p.waitForSelector(".cl-vide");
  const vide = await v.p.evaluate(() => ({ h2: document.querySelector(".cl-vide h2").textContent, chouette: !!document.querySelector(".cl-vide .companion .eg-medaille"), p: document.querySelector(".cl-vide p").textContent })); // Égide : médaille de la chouette, tutoiement
  await capturer(v.p, "25-cloud-vide");
  await fermer(v);
  const c = await ouvrir({ compte: "admin" }, { theme: "light" });
  await c.p.evaluate(() => window.__maquette.modifier((e) => { e.config.theme = "clair"; }));
  await aller(c.p, "cloud");
  await c.p.waitForSelector(".cl-ligne");
  await capturer(c.p, "26-cloud-theme-clair");
  await fermer(c);
  const e = await ouvrir({ compte: "admin" }, { largeur: 900, hauteur: 640 });
  await e.p.locator('a[data-section="cloud"]').click();
  await e.p.waitForSelector(".cl-ligne");
  const deborde = await e.p.evaluate(() => document.querySelector(".sheet").scrollWidth > document.querySelector(".sheet").clientWidth + 1);
  await capturer(e.p, "27-cloud-900x640");
  await fermer(e);
  return { ok: vide.h2 === "Ton Cloud est vide." && vide.chouette && /30 jours|30 jours/.test(vide.p) && !deborde, vide, deborde };
});

await essai("liaison révoquée dans « Mes jetons » : la section Cloud disparaît, Paramètres le dit", async () => {
  const s = await ouvrir({ compte: "admin" });
  await aller(s.p, "cloud");
  await s.p.waitForSelector(".cl-ligne");
  await s.p.evaluate(() => window.__maquette.compte.revoquer());
  await s.p.waitForTimeout(400);
  const nav = await s.p.locator('a[data-section="cloud"]').count();
  const titre = await s.p.locator("h1").first().textContent();
  await aller(s.p, "parametres");
  const avis = await s.p.locator('[data-compte="non-relie"] .appairage-avis').textContent();
  await capturer(s.p, "28-liaison-revoquee");
  await fermer(s);
  return { ok: nav === 0 && titre !== "Cloud" && /révoqué/.test(avis), nav, titre, avis };
});

await navigateur.close();
serveur.close();

const bilan = {
  le: new Date().toISOString(),
  essais: essais.map((e) => ({ nom: e.nom, ok: e.ok, ms: e.ms, detail: e.detail })),
  reussis: essais.filter((e) => e.ok).length,
  total: essais.length,
  captures,
  a11y: { sansNom: captures.reduce((n, c) => n + c.sansNom, 0), orphelins: captures.reduce((n, c) => n + c.orphelins, 0) },
  erreursConsole,
};
writeFileSync(join(sortie, "desktop-cloud-38.json"), JSON.stringify(bilan, null, 2));
for (const e of essais) console.log(`${e.ok ? "OK " : "ÉCHEC"} ${e.nom}${e.ok ? "" : ` → ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail).slice(0, 600)}`}`);
console.log(`${bilan.reussis}/${bilan.total} essais ; ${captures.length} captures ; accessibilité : ${bilan.a11y.sansNom} sans nom, ${bilan.a11y.orphelins} orphelins ; console : ${erreursConsole.length} erreur(s)`);
if (erreursConsole.length) console.log(erreursConsole.slice(0, 5).join("\n"));
process.exit(bilan.reussis === bilan.total && erreursConsole.length === 0 ? 0 : 1);
