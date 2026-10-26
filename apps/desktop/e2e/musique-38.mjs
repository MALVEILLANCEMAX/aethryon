// Banc de la section MUSIQUE (MUSIQUE-DESKTOP.md) : Chromium (Playwright), application construite (dist/), MAQUETTE de
// l'API Tauri (maquette-tauri.js + maquette-musique.js, formes exactes du cœur). Les sons et pochettes servis par
// `asset:` sont des fichiers d'essai produits par ffmpeg ; les CDN et lecteurs officiels (Spotify, Apple…) sont
// interceptés par des pages locales : AUCUNE requête ne sort. Les captures prouvent l'INTERFACE et le lecteur
// (vraie lecture audio par Chromium, vrai analyseur Web Audio) ; le cœur (étiquettes, imports, rapatriement) est
// essayé par `cargo test`, le relais par account/test/music.test.ts.
// Usage : npm run build && node e2e/musique-38.mjs   (SORTIE : dossier des captures)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const dist = join(dirname(ici), "dist");
const sortie = process.env.SORTIE || "captures";
mkdirSync(sortie, { recursive: true });
const maquette = readFileSync(join(ici, "maquette-tauri.js"), "utf8");
const maquetteMusique = readFileSync(join(ici, "maquette-musique.js"), "utf8");
const FIX = join(ici, "fixtures", "musique");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const servis = [];
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  servis.push(p);
  const f = join(dist, p === "/" ? "index.html" : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const port = serveur.address().port;

const navigateur = await pw.chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const essais = [];
const erreursConsole = [];
const captures = [];
const sortants = [];

async function ouvrir(scenario = {}, { largeur = 1280, hauteur = 800, theme = "dark", reduit = false } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: theme, reducedMotion: reduit ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  p.__erreurs = erreurs;
  await p.addInitScript([`window.__SCENARIO__ = ${JSON.stringify({ compte: "admin", indexVide: true, ...scenario })};`, maquette, maquetteMusique].join("\n"));
  // Tout ce qui sortirait est bloqué (enregistré EN PREMIER : Playwright essaie les routes les plus récentes d'abord).
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|asset\.localhost)/, (route) => { sortants.push(route.request().url()); return route.abort(); });
  // Fichiers locaux (asset:) : pochettes extraites et sons d'essai, avec l'en-tête CORS (visualisation).
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const poch = (chemin.match(/pochettes\\([0-9a-f]{32}\.jpg)$/) || [])[1];
    const pp = poch && (await p.evaluate((n) => window.__POCHETTES__?.[n], poch));
    if (pp) return route.fulfill({ path: join(FIX, pp), contentType: "image/jpeg" });
    const son = await p.evaluate((c) => window.__SONS__?.[c], chemin);
    if (son) {
      const corps = readFileSync(join(FIX, `${son}.mp3`));
      const plage = route.request().headers().range;
      const h = { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" };
      const m = plage && /bytes=(\d+)-(\d*)/.exec(plage);
      if (m) { const a = Number(m[1]), b = m[2] ? Number(m[2]) : corps.length - 1; return route.fulfill({ status: 206, headers: { ...h, "Content-Range": `bytes ${a}-${b}/${corps.length}`, "Content-Length": String(b - a + 1) }, body: corps.subarray(a, b + 1) }); }
      return route.fulfill({ status: 200, headers: { ...h, "Content-Length": String(corps.length) }, body: corps });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  // Écoute Cloud (lien signé du stockage) : son d'essai SANS en-tête CORS (comme un stockage dont on ignore le CORS).
  await p.route("https://*.backblazeb2.com/**", (route) => route.fulfill({ path: join(FIX, "nappe.mp3"), contentType: "audio/mpeg" }));
  // Lecteurs officiels et CDN : pages et images locales ; AUCUNE requête ne sort.
  await p.route(/^https:\/\/(open\.spotify\.com|embed\.music\.apple\.com|w\.soundcloud\.com|widget\.deezer\.com)\//, (route) => { sortants.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: "<!doctype html><body style='margin:0;background:#18181a;color:#b3a999;font:13px Inter,sans-serif;display:grid;place-items:center;height:100vh'>Lecteur officiel — remplacé par le banc (aucune requête vers le service)</body>" }); });
  await p.route(/^https:\/\/(i\.scdn\.co|[a-z0-9-]+\.mzstatic\.com)\//, (route) => route.fulfill({ path: join(FIX, "poch2.jpg"), contentType: "image/jpeg" }));
  await p.route(/^https:\/\/audio-ssl\.itunes\.apple\.com\//, (route) => route.fulfill({ path: join(FIX, "accord.mp3"), contentType: "audio/mpeg" }));
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForSelector(".win");
  return { p, ctx };
}

async function fermer({ p, ctx }) {
  erreursConsole.push(...p.__erreurs.filter((e) => !/404|Failed to load resource|net::ERR_FAILED|ERR_BLOCKED/.test(e)));
  await ctx.close();
}

async function a11y(p) {
  return p.evaluate(() => {
    const nom = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim()
      || (el.getAttribute("aria-labelledby") || "").split(" ").map((i) => document.getElementById(i)?.textContent || "").join("").trim()
      || (el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
    const sansNom = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, iframe, [role=menuitem], [role=option], [role=row][tabindex], li[tabindex]")]
      .filter((el) => !el.closest("[aria-hidden=true]") && el.getClientRects().length && !nom(el) && !(el.tagName === "INPUT" && (el.labels?.length || el.getAttribute("aria-label"))))
      .map((el) => el.outerHTML.slice(0, 90));
    const orphelins = [...document.querySelectorAll("[aria-activedescendant]")].filter((el) => !document.getElementById(el.getAttribute("aria-activedescendant"))).map((el) => el.outerHTML.slice(0, 90));
    return { sansNom, orphelins };
  });
}

async function capturer(p, nom) {
  const fichier = `musique-${nom}.png`;
  await p.waitForTimeout(450);
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
    essais.push({ nom, ok: false, detail: String(e?.stack || e).slice(0, 900), ms: Date.now() - t0 });
  }
}

const aller = async (p, section) => { await p.locator(`a[data-section="${section}"]`).click(); await p.waitForTimeout(350); };
const onglet = async (p, nom) => { await p.locator(".mu-ph .seg button", { hasText: nom }).click(); await p.waitForTimeout(250); };
const musique = async (p) => { await aller(p, "musique"); await p.waitForSelector(".mu-corps", { timeout: 5000 }); };
const position = (p) => p.evaluate(() => document.querySelector(".mu-mini .mu-temps .mu-chiffre")?.textContent ?? null);
const enSecondes = (t) => { const [m, s] = String(t).split(":").map(Number); return m * 60 + s; };
const appels = (p, prefixe = "musique_") => p.evaluate((x) => window.__maquette.appels.filter((a) => a.startsWith(x)), prefixe);

// ======================================================================================================================
await essai("navigation : « Musique » à sa place (après Bibliothèque), Ctrl 3, section ET mini-lecteur chargés à la demande", async () => {
  servis.length = 0;
  const s = await ouvrir();
  const ordre = await s.p.evaluate(() => [...document.querySelectorAll(".nav a")].map((a) => a.dataset.section));
  const avant = servis.filter((x) => /\/assets\/(Musique|MiniLecteur)-/.test(x)).length;
  await s.p.keyboard.press("Control+3");
  await s.p.waitForSelector(".mu-corps");
  const apres = servis.filter((x) => /\/assets\/Musique-/.test(x)).length;
  const mini = servis.filter((x) => /\/assets\/MiniLecteur-/.test(x)).length;
  const titre = await s.p.locator(".mu h1").textContent();
  await capturer(s.p, "01-accueil-musical");
  await fermer(s);
  return { ok: ordre[2] === "musique" && avant === 0 && apres >= 1 && mini === 0 && titre === "Musique", ordre, avant, apres, mini };
});

await essai("accueil musical : reprise, ajoutés récemment, albums, suggestions de SA bibliothèque, playlists, historique des imports", async () => {
  const s = await ouvrir();
  await musique(s.p);
  const t = await s.p.evaluate(() => ({
    reprise: document.querySelector(".mu-reprise-titre")?.textContent, sections: [...document.querySelectorAll(".mu-h2")].map((h) => h.textContent),
    sugg: document.querySelector(".mu-section[aria-label='Suggestions de ta bibliothèque'] .mu-note")?.textContent, hist: document.querySelectorAll(".mu-hist li").length,
  }));
  await fermer(s);
  const attendues = ["Ajoutés récemment", "Albums récents", "Suggestions de ta bibliothèque", "Playlists", "Historique des imports"];
  return { ok: t.reprise === "Les falaises" && attendues.every((x) => t.sections.includes(x)) && /tes seuls fichiers/.test(t.sugg) && t.hist === 2, t };
});

await essai("lecture RÉELLE : un clic lance le son, le temps avance, le mini-lecteur apparaît et reste dans toute la fenêtre", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await s.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile").first().hover();
  await s.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile-lire").first().click();
  await s.p.waitForSelector(".mu-mini", { timeout: 4000 });
  await s.p.waitForTimeout(2200);
  const t1 = enSecondes(await position(s.p));
  const titre = await s.p.locator(".mu-mini-titre").textContent();
  const etat = await s.p.locator(".mu-mini .mu-bt--lecture").getAttribute("aria-label");
  await capturer(s.p, "02-lecture-mini-lecteur");
  await aller(s.p, "bibliotheque");
  await s.p.waitForTimeout(1200);
  const toujours = await s.p.locator(".mu-mini").count();
  const t2 = enSecondes(await position(s.p));
  await capturer(s.p, "03-mini-lecteur-persistant-video");
  await fermer(s);
  return { ok: t1 >= 1 && t2 > t1 && toujours === 1 && etat === "Pause" && titre === "Clair de nuit", t1, t2, titre, etat };
});

await essai("scène : pochette et lune de progression, visualisation par le VRAI analyseur (pixels dessinés), file d'attente", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-ligne[role=row][data-id]").nth(0).dblclick();
  await s.p.waitForSelector(".mu-mini");
  await s.p.locator(".mu-mini-poch").click();
  await s.p.waitForSelector(".mu-scene");
  await s.p.waitForTimeout(1500);
  const visu = await s.p.evaluate(() => {
    const c = document.querySelector(".mu-scene .mu-visu");
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let allumes = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) allumes++;
    return { anime: c.dataset.anime !== undefined, allumes, total: d.length / 4 };
  });
  // Cadence : intervalles entre images pendant 2 s de lecture avec la visualisation (SwiftShader : plancher).
  const cadence = await s.p.evaluate(() => new Promise((ok) => { const t = []; let d = performance.now(); const f = (n) => { t.push(n - d); d = n; if (t.length < 120) requestAnimationFrame(f); else { t.sort((a, b) => a - b); ok({ mediane: t[60], p95: t[114] }); } }; requestAnimationFrame(f); }));
  const venir = await s.p.locator(".mu-file-ligne").count();
  await capturer(s.p, "04-scene-lecteur");
  await fermer(s);
  return { ok: visu.anime && visu.allumes > 200 && venir >= 5 && cadence.mediane < 20, visu, cadence, venir };
});

await essai("commandes : suivant, précédent (redémarre après 3 s), aléatoire, répétition (tout → un → non), volume", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-ligne[role=row][data-id]").nth(2).dblclick();
  await s.p.waitForSelector(".mu-mini");
  await s.p.waitForTimeout(600);
  const t0 = await s.p.locator(".mu-mini-titre").textContent();
  await s.p.getByRole("button", { name: "Morceau suivant" }).first().click();
  await s.p.waitForTimeout(500);
  const t1 = await s.p.locator(".mu-mini-titre").textContent();
  await s.p.getByRole("button", { name: "Morceau précédent" }).first().click();
  await s.p.waitForTimeout(500);
  const t2 = await s.p.locator(".mu-mini-titre").textContent();
  await s.p.waitForTimeout(3300);
  await s.p.getByRole("button", { name: "Morceau précédent" }).first().click();
  await s.p.waitForTimeout(300);
  const redemarre = enSecondes(await position(s.p)) <= 1 && (await s.p.locator(".mu-mini-titre").textContent()) === t2;
  const al = s.p.locator(".mu-mini .mu-bt[aria-label^='Lecture aléatoire']");
  await al.click();
  const alea = await al.getAttribute("aria-pressed");
  const rep = s.p.locator(".mu-mini .mu-bt--rep");
  const cycle = [];
  for (let i = 0; i < 3; i++) { await rep.click(); cycle.push(await rep.getAttribute("aria-label")); }
  await s.p.locator(".mu-mini .mu-curseur--vol").fill("0.3");
  const vol = await s.p.locator(".mu-mini .mu-curseur--vol").inputValue();
  await fermer(s);
  return { ok: t1 !== t0 && t2 === t0 && redemarre && alea === "true" && cycle.join("|") === "Répéter toute la file|Répéter ce morceau|Répétition désactivée" && vol === "0.3", t0, t1, t2, redemarre, alea, cycle, vol };
});

await essai("file d'attente au clavier : Alt+↓ déplace, Suppr retire ; Échap ferme la scène et rend le focus", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-ligne[role=row][data-id]").nth(0).dblclick();
  await s.p.waitForSelector(".mu-mini");
  await s.p.locator(".mu-mini .mu-bt[aria-label='File d\\'attente et lecteur']").click();
  await s.p.waitForSelector(".mu-file-ligne");
  const avant = await s.p.locator(".mu-file-ligne .mu-file-texte .ellipsis:first-child").allTextContents();
  await s.p.locator(".mu-file-ligne").first().focus();
  await s.p.keyboard.press("Alt+ArrowDown");
  await s.p.waitForTimeout(150);
  const apres = await s.p.locator(".mu-file-ligne .mu-file-texte .ellipsis:first-child").allTextContents();
  await s.p.locator(".mu-file-ligne").first().focus();
  await s.p.keyboard.press("Delete");
  await s.p.waitForTimeout(150);
  const retire = await s.p.locator(".mu-file-ligne").count();
  await s.p.keyboard.press("Escape");
  await s.p.waitForTimeout(400);
  const fermee = await s.p.locator(".mu-scene").count();
  await fermer(s);
  return { ok: apres[0] === avant[1] && apres[1] === avant[0] && retire === avant.length - 1 && fermee === 0, avant: avant.slice(0, 3), apres: apres.slice(0, 3), retire };
});

await essai("Spotify : lien détecté, « Titre identifié », AUCUN import, « Ouvrir dans Spotify » et lecteur officiel ; restrictions dites", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Importer");
  await s.p.locator(".mu-universel input").fill("https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC");
  const detecte = await s.p.locator(".mu-detecte").textContent();
  await s.p.getByRole("button", { name: "Analyser" }).click();
  await s.p.waitForSelector(".mu-fiche");
  const t = await s.p.evaluate(() => ({ etat: document.querySelector(".mu-fiche .mu-etat")?.textContent, boutons: [...document.querySelectorAll(".mu-fiche-actions .btn")].map((b) => b.textContent.trim()), restr: document.querySelector(".mu-restrictions")?.textContent }));
  await s.p.getByRole("button", { name: "Lecteur officiel" }).click();
  await s.p.waitForSelector(".mu-officiel iframe");
  await s.p.waitForTimeout(400);
  await capturer(s.p, "05-fiche-spotify-identifie");
  await s.p.getByRole("button", { name: "Ouvrir dans Spotify" }).click();
  const ouverts = await s.p.evaluate(() => window.__maquette.liensOuverts || []);
  await fermer(s);
  return { ok: detecte === "Spotify" && t.etat === "Titre identifié" && !t.boutons.some((b) => /Importer/.test(b)) && t.boutons.includes("Ouvrir dans Spotify") && /aucun téléchargement/.test(t.restr) && ouverts.length === 1, detecte, t, ouverts };
});

await essai("Apple Music : « Aperçu de 30 s » TOUJOURS avec « Ouvrir dans Apple Music » à côté ; aucun import", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Importer");
  await s.p.locator(".mu-universel input").fill("https://music.apple.com/fr/album/essai/1?i=2");
  await s.p.getByRole("button", { name: "Analyser" }).click();
  await s.p.waitForSelector(".mu-apercu");
  const t = await s.p.evaluate(() => ({ libelle: document.querySelector(".mu-apercu .mu-sur")?.textContent, voisin: document.querySelector(".mu-apercu .btn")?.textContent.trim(), audio: !!document.querySelector(".mu-apercu audio[controls]"), importer: [...document.querySelectorAll(".mu-fiche-actions .btn")].some((b) => /Importer/.test(b.textContent)) }));
  await capturer(s.p, "06-fiche-apple-apercu");
  await fermer(s);
  return { ok: t.libelle === "Aperçu de 30 s" && t.voisin === "Ouvrir dans Apple Music" && t.audio && !t.importer, t };
});

await essai("YouTube Music et http:// refusés AVANT tout appel, avec la raison", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Importer");
  await s.p.locator(".mu-universel input").fill("https://music.youtube.com/watch?v=abc");
  const refus = await s.p.locator(".mu-detecte[data-refuse]").textContent();
  await s.p.getByRole("button", { name: "Analyser" }).click();
  await s.p.waitForSelector(".bandeau--erreur");
  const msg = await s.p.locator(".bandeau--erreur").textContent();
  const n = (await appels(s.p)).filter((a) => a === "musique_analyser").length;
  await capturer(s.p, "07-youtube-music-refuse");
  await fermer(s);
  return { ok: refus === "YouTube Music" && /ne télécharge pas le catalogue musical commercial/.test(msg) && n === 0, refus, msg, n };
});

await essai("Internet Archive : « Téléchargeable », choix des fichiers, import avec progression RÉELLE du serveur puis copie locale, morceau ajouté", async () => {
  const s = await ouvrir({ importLentMusique: true });
  await musique(s.p);
  await onglet(s.p, "Importer");
  await s.p.locator(".mu-universel input").fill("https://archive.org/details/essai-satie");
  await s.p.getByRole("button", { name: "Analyser" }).click();
  await s.p.waitForSelector(".mu-fiche .mu-piste-fiche input[type=checkbox]");
  const etat = await s.p.locator(".mu-fiche .mu-etat").textContent();
  await s.p.locator(".mu-piste-fiche input[type=checkbox]").nth(1).check();
  await capturer(s.p, "08-fiche-archive-choix");
  const bouton = await s.p.locator(".mu-fiche-actions .btn--primary").textContent();
  await s.p.locator(".mu-fiche-actions .btn--primary").click();
  await s.p.waitForFunction(() => [...document.querySelectorAll(".mu-import")].some((x) => x.dataset.etape === "telechargement"), null, { timeout: 6000 });
  const pendant = await s.p.evaluate(() => [...document.querySelectorAll(".mu-import")].map((x) => ({ etape: x.dataset.etape, texte: x.querySelector(".mu-import-etat").textContent, barre: x.querySelector(".mu-barre i")?.style.transform })));
  const niche = await s.p.evaluate(() => document.querySelector(".niche-boite")?.textContent ?? "");
  const badge = await s.p.locator('a[data-section="musique"] .count').textContent().catch(() => null);
  await capturer(s.p, "09-import-en-cours");
  await s.p.waitForFunction(() => [...document.querySelectorAll(".mu-import")].filter((x) => x.dataset.etape === "termine").length === 2, null, { timeout: 20000 });
  await s.p.waitForTimeout(500);
  const corps = await s.p.evaluate(() => window.__maquette.imports);
  await capturer(s.p, "10-import-termine");
  await onglet(s.p, "Bibliothèque");
  const ajoute = await s.p.locator(".mu-ligne", { hasText: "Gymnopédie n° 1" }).count();
  await fermer(s);
  return { ok: etat === "Téléchargeable" && /Importer 2 fichiers/.test(bouton) && pendant.some((x) => /%/.test(x.texte)) && corps.length === 2 && corps[0].fichier === "gymnopedie-1.flac" && corps[1].fichier === "gymnopedie-2.mp3" && ajoute >= 1 && badge === "2" && /imports? musica/i.test(niche),
    etat, bouton, pendant, corps, ajoute, badge, niche };
});

await essai("fichier audio direct : import impossible sans la déclaration de droits, puis corps « attestation: true »", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Importer");
  await s.p.locator(".mu-universel input").fill("https://exemple.fr/sons/ambiance-libre.mp3");
  await s.p.getByRole("button", { name: "Analyser" }).click();
  await s.p.waitForSelector(".mu-attest");
  const avant = await s.p.locator(".mu-fiche-actions .btn--primary").isDisabled();
  await capturer(s.p, "11-fichier-direct-declaration");
  await s.p.locator(".mu-attest input").check();
  const apres = await s.p.locator(".mu-fiche-actions .btn--primary").isDisabled();
  await s.p.locator(".mu-fiche-actions .btn--primary").click();
  await s.p.waitForTimeout(300);
  const corps = await s.p.evaluate(() => window.__maquette.imports?.[0]);
  await fermer(s);
  return { ok: avant && !apres && corps?.attestation === true && corps?.type === "fichier", avant, apres, corps };
});

await essai("annulation d'un import en cours ; échec de vérification montré tel quel", async () => {
  const s = await ouvrir({ importLentMusique: true });
  await musique(s.p);
  await onglet(s.p, "Importer");
  await s.p.locator(".mu-universel input").fill("https://archive.org/details/essai-satie");
  await s.p.getByRole("button", { name: "Analyser" }).click();
  await s.p.waitForSelector(".mu-fiche-actions .btn--primary");
  await s.p.locator(".mu-fiche-actions .btn--primary").click();
  await s.p.waitForSelector(".mu-import .btn");
  await s.p.locator(".mu-import .btn", { hasText: "Annuler" }).click();
  await s.p.waitForFunction(() => document.querySelector(".mu-import")?.dataset.etape === "annule", null, { timeout: 4000 });
  await fermer(s);
  const e = await ouvrir({ importEchec: true });
  await musique(e.p);
  await onglet(e.p, "Importer");
  await e.p.locator(".mu-universel input").fill("https://archive.org/details/essai-satie");
  await e.p.getByRole("button", { name: "Analyser" }).click();
  await e.p.waitForSelector(".mu-fiche-actions .btn--primary");
  await e.p.locator(".mu-fiche-actions .btn--primary").click();
  await e.p.waitForFunction(() => document.querySelector(".mu-import")?.dataset.etape === "echec", null, { timeout: 5000 });
  const msg = await e.p.locator(".mu-import .mu-petit.bad").textContent();
  await capturer(e.p, "12-import-echec-integrite");
  await fermer(e);
  return { ok: /empreinte publiée/.test(msg), msg };
});

await essai("bibliothèque : liste (qualité RÉELLE, durées, formats), recherche sans accents, filtres, tri, grille", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  await s.p.waitForSelector(".mu-ligne[data-id]");
  const n = await s.p.locator(".mu-ligne[data-id]").count();
  const q24 = await s.p.locator(".mu-ligne", { hasText: "Clair de nuit" }).locator(".mu-ligne-qualite").textContent();
  await capturer(s.p, "13-bibliotheque-liste");
  await s.p.locator(".mu-recherche input").fill("maree");
  await s.p.waitForTimeout(150);
  const recherche = await s.p.locator(".mu-ligne[data-id]").allTextContents();
  await s.p.locator(".mu-recherche input").fill("");
  await s.p.locator("select[aria-label='Filtrer par qualité']").selectOption("hires");
  const hires = await s.p.locator(".mu-ligne[data-id]").count();
  await s.p.locator("select[aria-label='Filtrer par qualité']").selectOption("");
  await s.p.locator("select[aria-label='Trier les titres']").selectOption("duree");
  const premier = await s.p.locator(".mu-ligne[data-id] .mu-piste-texte .ellipsis").first().textContent();
  await s.p.locator(".mu-outils .seg button", { hasText: "Grille" }).click();
  await s.p.waitForTimeout(300);
  await capturer(s.p, "14-bibliotheque-grille");
  await fermer(s);
  return { ok: n === 15 && /FLAC · 24 bits · 96 kHz/.test(q24) && recherche.length === 1 && /Marée basse/.test(recherche[0]) && hires === 2 && premier === "Nuit d'été", n, q24, recherche: recherche.length, hires, premier };
});

await essai("albums : grille, détail (pochette, titres rangés, « Sans perte »), retour ; artistes", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-outils .seg button", { hasText: "Albums" }).click();
  await s.p.locator(".mu-outils .seg button", { hasText: "Grille" }).click();
  await s.p.waitForTimeout(300);
  await capturer(s.p, "15-albums-grille");
  await s.p.locator(".mu-tuile", { hasText: "Nocturnes" }).locator(".mu-tuile-poch").click();
  await s.p.waitForSelector(".mu-album");
  const t = await s.p.evaluate(() => ({ titre: document.querySelector(".mu-album-titre").textContent, meta: document.querySelector(".mu-album .mu-fiche-meta").textContent, pistes: [...document.querySelectorAll(".mu-album .mu-ligne[data-id] .mu-piste-texte .ellipsis:first-child")].map((x) => x.textContent) }));
  await s.p.waitForTimeout(400);
  await capturer(s.p, "16-album-detail");
  await s.p.locator(".mu-retour").click();
  await s.p.locator(".mu-outils .seg button", { hasText: "Artistes" }).click();
  const arts = await s.p.locator(".mu-grille .mu-tuile").count();
  await fermer(s);
  return { ok: t.titre === "Nocturnes" && /Sans perte/.test(t.meta) && t.pistes.join("|") === "Clair de nuit|Ivoire|Obsidienne|Lumière champagne" && arts >= 6, t, arts };
});

await essai("menu contextuel (clic droit et clavier) : lire ensuite, ajouter à une playlist, informations (licence, attribution)", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  const ligne = s.p.locator(".mu-ligne", { hasText: "Gymnopédie n° 1 (essai)" });
  await ligne.scrollIntoViewIfNeeded();
  await s.p.waitForTimeout(400);
  await ligne.click({ button: "right" });
  await s.p.waitForSelector(".menu--flottant");
  const elements = await s.p.locator(".menu--flottant [role=menuitem]").allTextContents();
  await capturer(s.p, "17-menu-contextuel");
  await s.p.locator(".menu--flottant [role=menuitem]", { hasText: "Informations" }).click();
  await s.p.waitForSelector(".mu-infos");
  const infos = await s.p.locator(".mu-infos").textContent();
  await capturer(s.p, "18-informations-licence");
  await s.p.keyboard.press("Escape");
  await s.p.waitForTimeout(200);
  await ligne.focus();
  await s.p.waitForTimeout(300);
  await s.p.keyboard.press("Shift+F10");
  await s.p.waitForSelector(".menu--flottant");
  await s.p.locator(".menu--flottant [role=menuitem]", { hasText: "Ajouter à une playlist" }).click();
  await s.p.locator(".mu-pl-choix .mu-pl-nom", { hasText: "Montage — ambiances" }).click();
  await s.p.waitForTimeout(200);
  const pl = await s.p.evaluate(() => window.__maquette.musique.playlists()[0].pistes.length);
  await fermer(s);
  return { ok: elements.some((e) => /Lire ensuite/.test(e)) && elements.some((e) => /Sauvegarder dans le Cloud/.test(e)) && /CC0/.test(infos) && /Internet Archive/.test(infos) && pl === 6, elements, pl };
});

await essai("playlists : glisser-déposer RÉEL à la souris (poignée), Alt+↑ au clavier, ordre enregistré par le cœur ; titres « sans fichier »", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Playlists");
  await s.p.waitForSelector(".mu-pl-ligne");
  const avant = await s.p.evaluate(() => window.__maquette.musique.playlists()[0].pistes.slice());
  const poignee = s.p.locator(".mu-pl-ligne").nth(0).locator(".mu-poignee");
  const b = await poignee.boundingBox();
  await s.p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await s.p.mouse.down();
  for (let k = 1; k <= 12; k++) await s.p.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + k * 10);
  await capturer(s.p, "19-playlist-glisser");
  await s.p.mouse.up();
  await s.p.waitForTimeout(500);
  const souris = await s.p.evaluate(() => window.__maquette.musique.playlists()[0].pistes.slice());
  await s.p.locator(".mu-pl-ligne").nth(2).focus();
  await s.p.keyboard.press("Alt+ArrowUp");
  await s.p.waitForTimeout(400);
  const clavier = await s.p.evaluate(() => window.__maquette.musique.playlists()[0].pistes.slice());
  const annonce = await s.p.locator(".mu-pl-detail .cache[aria-live]").textContent();
  await capturer(s.p, "20-playlist");
  await s.p.locator(".mu-pl-nom", { hasText: "Soirée Nocturnes" }).click();
  const sans = await s.p.locator(".mu-sans-liste li").count();
  await capturer(s.p, "21-playlist-synchronisee-sans-fichier");
  await fermer(s);
  const permut = (x) => [...x].sort().join() === [...avant].sort().join();
  return { ok: souris[2] === avant[0] && souris[0] === avant[1] && permut(souris) && clavier[1] === souris[2] && /position 2/.test(annonce) && sans === 2, avant, souris, clavier, annonce, sans };
});

await essai("Cloud (administrateur) : morceau sauvegardé écouté par lien signé (sans visualisation), EXPIRÉ : fiche gardée + « Réimporter »", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-outils .seg button", { hasText: "Cloud" }).click();
  await s.p.waitForSelector(".mu-cloud-ligne");
  const lignes = await s.p.locator(".mu-cloud-ligne").allTextContents();
  await capturer(s.p, "22-cloud-musique-expire");
  await s.p.locator(".mu-cloud-ligne[data-dispo] .btn", { hasText: "Écouter" }).click();
  await s.p.waitForSelector(".mu-mini");
  await s.p.waitForTimeout(1500);
  const t = enSecondes(await position(s.p));
  await s.p.locator(".mu-mini-poch").click();
  const note = await s.p.locator(".mu-visu-note").textContent();
  await s.p.keyboard.press("Escape");
  await s.p.waitForTimeout(300);
  await s.p.locator(".mu-cloud-ligne:not([data-dispo]) .btn", { hasText: "Réimporter" }).click();
  await s.p.waitForSelector(".mu-fiche");
  const champ = await s.p.locator(".mu-universel input").inputValue();
  await fermer(s);
  return { ok: lignes.some((l) => /Expire dans 28.jours/.test(l)) && lignes.some((l) => /Audio expiré · fiche gardée/.test(l)) && t >= 1 && /Cloud/.test(note) && champ === "https://archive.org/details/essai-satie", lignes, t, note, champ };
});

await essai("non relié : la bibliothèque et le lecteur marchent ; l'import demande la liaison, champ inactif ; relais fermé : message clair", async () => {
  const s = await ouvrir({ compte: "non-relie" });
  await musique(s.p);
  await onglet(s.p, "Importer");
  const avis = await s.p.locator(".mu-liaison").textContent();
  const inactif = await s.p.locator(".mu-universel input").isDisabled();
  await capturer(s.p, "23-non-relie");
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-ligne[role=row][data-id]").nth(1).dblclick();
  await s.p.waitForSelector(".mu-mini");
  await fermer(s);
  const f = await ouvrir({ musiqueFerme: true });
  await musique(f.p);
  await onglet(f.p, "Importer");
  await f.p.locator(".mu-universel input").fill("https://archive.org/details/essai-satie");
  await f.p.getByRole("button", { name: "Analyser" }).click();
  await f.p.waitForSelector(".bandeau--erreur");
  const ferme = await f.p.locator(".bandeau--erreur").textContent();
  await fermer(f);
  return { ok: /Relie AETHRYON Desktop/.test(avis) && inactif && /pas encore ouvert/.test(ferme), avis, ferme };
});

await essai("reprise de lecture : la file du cœur revient SANS son, puis reprend à 0:14 sur « Les falaises »", async () => {
  const s = await ouvrir();
  await musique(s.p);
  await s.p.locator(".mu-reprise").click();
  await s.p.waitForSelector(".mu-mini");
  await s.p.waitForTimeout(1500);
  const titre = await s.p.locator(".mu-mini-titre").textContent();
  const pos = enSecondes(await position(s.p));
  const enregistre = await s.p.evaluate(() => window.__maquette.lectures || 0);
  await fermer(s);
  return { ok: titre === "Les falaises" && pos >= 14 && pos <= 18 && enregistre >= 1, titre, pos, enregistre };
});

await essai("mouvement réduit : aucune boucle (comète, visualisation), pas de soulèvement ; vide avec la chouette ; thème clair ; 900 × 640", async () => {
  const r = await ouvrir({ analyseLente: true }, { reduit: true });
  await musique(r.p);
  await onglet(r.p, "Importer");
  await r.p.locator(".mu-universel input").fill("https://archive.org/details/essai-satie");
  await r.p.getByRole("button", { name: "Analyser" }).click();
  await r.p.waitForSelector(".mu-comete");
  const comete = await r.p.evaluate(() => getComputedStyle(document.querySelector(".mu-comete"), "::after").animationName);
  await capturer(r.p, "24-mouvement-reduit-analyse");
  await onglet(r.p, "Bibliothèque");
  await r.p.locator(".mu-ligne[role=row][data-id]").nth(0).dblclick();
  await r.p.waitForSelector(".mu-mini");
  await r.p.locator(".mu-mini-poch").click();
  await r.p.waitForTimeout(800);
  const visu = await r.p.evaluate(() => document.querySelector(".mu-scene .mu-visu").dataset.anime !== undefined);
  await fermer(r);
  const v = await ouvrir({ musiqueVide: true });
  await musique(v.p);
  const vide = await v.p.evaluate(() => ({ h2: document.querySelector(".mu-vide h2")?.textContent, chouette: !!document.querySelector(".mu-vide .companion svg") }));
  await capturer(v.p, "25-vide-chouette");
  await fermer(v);
  const c = await ouvrir({}, { theme: "light" });
  await c.p.evaluate(() => window.__maquette.modifier((e) => { e.config.theme = "clair"; }));
  await musique(c.p);
  await onglet(c.p, "Bibliothèque");
  await c.p.locator(".mu-ligne[role=row][data-id]").nth(0).dblclick();
  await c.p.waitForSelector(".mu-mini");
  await capturer(c.p, "26-theme-clair");
  await fermer(c);
  const e = await ouvrir({}, { largeur: 900, hauteur: 640 });
  await e.p.locator('a[data-section="musique"]').click();
  await e.p.waitForSelector(".mu-corps");
  await e.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile-poch").first().dblclick();
  await e.p.waitForSelector(".mu-mini");
  const deborde = await e.p.evaluate(() => document.querySelector(".page").scrollWidth > document.querySelector(".page").clientWidth + 1);
  await capturer(e.p, "27-900x640");
  await fermer(e);
  return { ok: comete === "none" && !visu && vide.h2 === "Ta musique t'attend" && vide.chouette && !deborde, comete, visu, vide, deborde };
});

await navigateur.close();
serveur.close();

const jsDemarrage = readdirSync(join(dist, "assets")).filter((f) => /^index-.*\.js$/.test(f)).map((f) => statSync(join(dist, "assets", f)).size)[0];
const chunks = Object.fromEntries(readdirSync(join(dist, "assets")).filter((f) => /^(Musique|MiniLecteur|ui)-.*\.(js|css)$/.test(f)).map((f) => [f, statSync(join(dist, "assets", f)).size]));
const bilan = {
  le: new Date().toISOString(),
  essais: essais.map((e) => ({ nom: e.nom, ok: e.ok, ms: e.ms, detail: e.detail })),
  reussis: essais.filter((e) => e.ok).length,
  total: essais.length,
  captures,
  a11y: { sansNom: captures.reduce((n, c) => n + c.sansNom, 0), orphelins: captures.reduce((n, c) => n + c.orphelins, 0) },
  erreursConsole,
  requetesSortantes: sortants.filter((u) => !/^https:\/\/(open\.spotify\.com|embed\.music\.apple\.com|w\.soundcloud\.com|widget\.deezer\.com)\//.test(u)),
  jsDemarrage, chunks,
};
writeFileSync(join(sortie, "musique-38.json"), JSON.stringify(bilan, null, 2));
for (const e of essais) console.log(`${e.ok ? "OK " : "ÉCHEC"} ${e.nom}${e.ok ? "" : ` → ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail).slice(0, 700)}`}`);
console.log(`${bilan.reussis}/${bilan.total} essais ; ${captures.length} captures ; accessibilité : ${bilan.a11y.sansNom} sans nom, ${bilan.a11y.orphelins} orphelins ; console : ${erreursConsole.length} erreur(s) ; sortantes bloquées : ${bilan.requetesSortantes.length} ; JS de démarrage ${jsDemarrage} o`);
if (erreursConsole.length) console.log(erreursConsole.slice(0, 6).join("\n"));
for (const c of captures.filter((c) => c.sansNom || c.orphelins)) console.log(c.fichier, JSON.stringify(c.detail));
process.exit(bilan.reussis === bilan.total && erreursConsole.length === 0 ? 0 : 1);
