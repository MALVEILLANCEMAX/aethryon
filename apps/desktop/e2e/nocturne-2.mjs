// Banc « Nocturne-2 » : Musique, Transferts, Intégrations, Paramètres, écran du scanner AETHRYON Index et Bibliothèque
// unifiée. Chromium (Playwright), application construite (dist/), MAQUETTE de l'API Tauri (maquette-tauri.js et
// maquette-musique.js ; scan, volumes et médias scannés de la maquette d'AETHRYON Index). Les captures prouvent
// l'INTERFACE ; rien ici n'est WebView2 ni un vrai Windows (NON DÉMONTRÉ). Le cœur (pause et reprise par plage
// d'octets, annulation, scanner) est essayé par `cargo test`.
// Usage : npm run build && node e2e/nocturne-2.mjs   (SORTIE : dossier des captures)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const dist = process.env.DIST || join(dirname(ici), "dist");
const sortie = process.env.SORTIE || "captures";
mkdirSync(sortie, { recursive: true });
const maquette = readFileSync(join(ici, "maquette-tauri.js"), "utf8");
const maquetteMusique = readFileSync(join(ici, "maquette-musique.js"), "utf8");
const FIX = join(ici, "fixtures");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
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

const navigateur = await pw.chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const essais = [];
const erreursConsole = [];
const captures = [];
const mesures = {};

async function ouvrir(scenario = {}, { largeur = 1280, hauteur = 800, theme = "dark", reduit = false, avant } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: theme, reducedMotion: reduit ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  p.__erreurs = erreurs;
  const init = [`window.__SCENARIO__ = ${JSON.stringify({ compte: "admin", ...scenario })};`, maquette, maquetteMusique];
  if (avant) init.push(`(${avant})();`);
  await p.addInitScript(init.join("\n"));
  // Rien ne sort (enregistré en premier : Playwright essaie les routes les plus récentes d'abord).
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|asset\.localhost)/, (route) => route.abort());
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const id = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (id && MINIATURES[id[0]]) return route.fulfill({ path: join(FIX, MINIATURES[id[0]]), contentType: "image/jpeg" });
    const poch = (chemin.match(/pochettes\\([0-9a-f]{32}\.jpg)$/) || [])[1];
    const pp = poch && (await p.evaluate((n) => window.__POCHETTES__?.[n], poch).catch(() => null));
    if (pp) return route.fulfill({ path: join(FIX, "musique", pp), contentType: "image/jpeg" });
    const son = await p.evaluate((c) => window.__SONS__?.[c], chemin).catch(() => null);
    if (son) {
      // Plages d'octets (206) comme le protocole asset: de Tauri : sans elles, Chromium ne sait pas chercher dans le son.
      const corps = readFileSync(join(FIX, "musique", `${son}.mp3`));
      const h = { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" };
      const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
      if (m) { const a = Number(m[1]), b = m[2] ? Number(m[2]) : corps.length - 1; return route.fulfill({ status: 206, headers: { ...h, "Content-Range": `bytes ${a}-${b}/${corps.length}`, "Content-Length": String(b - a + 1) }, body: corps.subarray(a, b + 1) }); }
      return route.fulfill({ status: 200, headers: { ...h, "Content-Length": String(corps.length) }, body: corps });
    }
    if (/\.(mp4|m4v|mov|webm|mkv)$/i.test(chemin) && existsSync(WEBM)) return route.fulfill({ path: WEBM, contentType: "video/webm", headers: { "Access-Control-Allow-Origin": "*" } });
    return route.fulfill({ status: 404, body: "" });
  });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForSelector(".win");
  await p.waitForTimeout(250);
  return { p, ctx };
}

async function fermer({ p, ctx }) {
  erreursConsole.push(...p.__erreurs.filter((e) => !/404|Failed to load resource|NotSupportedError|no supported source|ERR_FAILED|ERR_BLOCKED/i.test(e)));
  await ctx.close();
}

async function a11y(p) {
  return p.evaluate(() => {
    const nom = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim()
      || (el.getAttribute("aria-labelledby") || "").split(" ").map((i) => document.getElementById(i)?.textContent || "").join("").trim()
      || (el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
    const sansNom = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, summary, [role=menuitem], [role=option], [role=switch], [role=slider], [role=progressbar]")]
      .filter((el) => !el.closest("[aria-hidden=true], [inert]") && el.getClientRects().length && !nom(el) && !(el.tagName === "INPUT" && (el.labels?.length || el.getAttribute("aria-label"))))
      .map((el) => el.outerHTML.slice(0, 90));
    const orphelins = [...document.querySelectorAll("[aria-activedescendant]")].filter((el) => !document.getElementById(el.getAttribute("aria-activedescendant"))).map((el) => el.outerHTML.slice(0, 90));
    return { sansNom, orphelins };
  });
}

async function capturer(p, nom, opts = {}) {
  const fichier = `${nom}.png`;
  await p.screenshot({ path: join(sortie, fichier), fullPage: false, clip: opts.clip });
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

const aller = async (p, section) => { await p.locator(`a[data-section="${section}"]`).click(); await p.waitForTimeout(450); };
const scanner = async (p) => { await aller(p, "accueil"); await p.getByRole("button", { name: "Scanner mes disques" }).first().click(); await p.waitForSelector(".sc"); await p.waitForTimeout(350); };
const onglet = async (p, nom) => { await p.locator(".mu-ph .seg button", { hasText: nom }).click(); await p.waitForTimeout(300); };
const appels = (p) => p.evaluate(() => window.__maquette.appels.slice());

/** Débordements : défilement horizontal de la page ou du document ; commandes coupées au bord de la fenêtre. */
async function debordements(p) {
  return p.evaluate(() => {
    const pg = document.querySelector(".page");
    const coupes = [...document.querySelectorAll(".page button, .page a[href], .page input, .page select, .nav a, .tete button")]
      .filter((el) => el.getClientRects().length && !el.closest(".mu-rangee, .bib-grille, [inert], .sc-erreurs ul"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > window.innerWidth + 0.5 || r.left < -0.5)
      .map(({ el }) => el.outerHTML.slice(0, 80));
    return { page: pg ? pg.scrollWidth - pg.clientWidth : 0, document: document.documentElement.scrollWidth - document.documentElement.clientWidth, coupes };
  });
}

// ======================================================================================================================
// 1. Transferts : suivi réel, pause / reprise / annulation (conversion du Desktop seulement), historique compact
// ======================================================================================================================
await essai("Transferts : bilan avec la chouette, cartes (octets, débit, étapes), pause → « En pause » → reprise, annulation", async () => {
  const s = await ouvrir({ pilotables: true });
  await aller(s.p, "transferts");
  const carte = s.p.locator('.xfp-carte[data-transfert="desk-maree"]');
  const avant = await carte.evaluate((c) => ({ mesures: c.querySelector(".xfp-mesures")?.textContent, etape: c.querySelector(".xfp-etape")?.textContent, boutons: [...c.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.textContent) }));
  const autres = await s.p.evaluate(() => [...document.querySelectorAll('.xfp-carte:not([data-transfert="desk-maree"])')].map((c) => [...c.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.textContent).join("|")));
  const pont = await s.p.evaluate(() => ({ chouette: !!document.querySelector(".xfp-pont .companion"), titre: document.querySelector(".xfp-pont-titre")?.textContent, chiffres: document.querySelectorAll(".xfp-chiffres dd").length }));
  await capturer(s.p, "transferts-1280");
  await carte.getByRole("button", { name: "Mettre en pause" }).click();
  await s.p.waitForSelector('.xfp-carte[data-transfert="desk-maree"][data-pause]');
  const pause = await carte.evaluate((c) => ({ etape: c.querySelector(".xfp-etape")?.textContent, vitesse: !!c.querySelector(".xfp-vitesse"), reprendre: !!c.querySelector("button.btn--primary"), noeud: c.querySelector(".pn[data-etat='en-cours'] .pn-detail")?.textContent }));
  await capturer(s.p, "transferts-pause");
  await carte.getByRole("button", { name: "Reprendre" }).click();
  await s.p.waitForFunction(() => !document.querySelector('.xfp-carte[data-transfert="desk-maree"][data-pause]'));
  const reprise = await carte.evaluate((c) => c.querySelector(".xfp-mesures b")?.textContent);
  // Menu (clavier) : pause et annulation proposées pour CE transfert seulement.
  await carte.focus();
  await s.p.keyboard.press("Shift+F10");
  await s.p.waitForSelector(".menu--flottant");
  const menu = await s.p.locator(".menu--flottant [role=menuitem]").allTextContents();
  await s.p.keyboard.press("Escape");
  await carte.getByRole("button", { name: "Annuler le transfert" }).click();
  await s.p.waitForFunction(() => !document.querySelector('.xfp-carte[data-transfert="desk-maree"]'));
  await s.p.waitForTimeout(300);
  const annule = await s.p.evaluate(() => ({ histo: [...document.querySelectorAll(".xfp-ligne")].find((l) => l.dataset.transfert === "desk-maree")?.querySelector(".xfp-issue")?.textContent, toast: document.querySelector(".toast")?.textContent }));
  const a = await appels(s.p);
  await capturer(s.p, "transferts-annule");
  await fermer(s);
  return {
    ok: /35\s?%/.test(avant.mesures) && /sur/.test(avant.mesures) && /Mo\/s/.test(avant.mesures) && avant.boutons.includes("Mettre en pause") && avant.boutons.includes("Annuler le transfert")
      && autres.every((b) => !/pause|Annuler le transfert/.test(b)) && pont.chouette && pont.chiffres === 4
      && /pause/i.test(pause.etape) && !pause.vitesse && pause.reprendre && /En pause/.test(pause.noeud ?? "") && /45\s?%/.test(reprise ?? "")
      && menu.includes("Mettre en pause") && menu.includes("Annuler le transfert") && /Annulé/.test(annule.histo ?? "") && /annulé/i.test(annule.toast ?? "")
      && a.filter((x) => x === "transfert_piloter").length === 3,
    avant, autres, pont, pause, reprise, menu, annule,
  };
});

await essai("Transferts : vide (chouette en profondeur, action réelle), mouvement réduit (aucune boucle hors chouette)", async () => {
  const s = await ouvrir({ vide: true });
  await aller(s.p, "transferts");
  const vide = await s.p.evaluate(() => ({ chouette: !!document.querySelector(".xfp-vide .companion--3d"), bouton: document.querySelector(".xfp-vide .btn--primary")?.textContent }));
  await capturer(s.p, "transferts-vide");
  await fermer(s);
  const r = await ouvrir({ pilotables: true }, { reduit: true });
  await aller(r.p, "transferts");
  await r.p.waitForTimeout(400);
  const boucles = await r.p.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === "running").map((a) => a.animationName || "waapi"));
  await capturer(r.p, "transferts-mouvement-reduit");
  await fermer(r);
  return { ok: vide.chouette && vide.bouton === "Coller un lien" && boucles.length === 0, vide, boucles };
});

// ======================================================================================================================
// 2. Musique : « En écoute », barre interactive, égaliseur réel, états lecture / pause, mini-lecteur effacé
// ======================================================================================================================
await essai("Musique : « Reprendre la lecture » puis « En écoute » (barre, commandes, à suivre) ; mini-lecteur effacé tant qu'elle est visible", async () => {
  const s = await ouvrir();
  await aller(s.p, "musique");
  await s.p.waitForSelector(".mu-ecoute");
  const reprise = await s.p.evaluate(() => ({ mode: document.querySelector(".mu-ecoute")?.dataset.mode, titre: document.querySelector(".mu-ecoute-titre")?.textContent, fond: !!document.querySelector(".mu-ecoute-fond") }));
  await capturer(s.p, "musique-reprise");
  await s.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile").first().hover();
  await s.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile-lire").first().click();
  await s.p.evaluate(() => document.querySelector(".page").scrollTo(0, 0));
  await s.p.waitForSelector(".mu-ecoute[data-lecture]", { timeout: 5000 });
  await s.p.waitForTimeout(1200);
  const lecture = await s.p.evaluate(() => ({
    sur: document.querySelector(".mu-ecoute-sur")?.textContent, eq: !!document.querySelector(".mu-ecoute-sur .mu-egaliseur[data-actif]"),
    mini: { efface: document.querySelector(".mu-mini")?.hasAttribute("data-efface"), inert: document.querySelector(".mu-mini")?.hasAttribute("inert") },
    suite: document.querySelectorAll(".mu-ecoute-suite li").length, tuile: !!document.querySelector(".mu-tuile[data-lecture] .mu-tuile-ecoute"),
  }));
  // Égaliseur RÉEL : les barres reçoivent les niveaux du spectre (transform écrit image par image).
  const niveaux = await s.p.evaluate(() => new Promise((ok) => setTimeout(() => ok([...document.querySelectorAll(".mu-ecoute-sur .mu-egaliseur i")].map((i) => i.style.transform)), 400)));
  await capturer(s.p, "musique-en-ecoute");
  // Pause : le bouton change de nom et de forme, la pochette recule, l'égaliseur se pose.
  await s.p.locator(".mu-ecoute .mu-bt--lecture").click();
  await s.p.waitForFunction(() => !document.querySelector(".mu-ecoute[data-lecture]"));
  const pause = await s.p.evaluate(() => ({ bouton: document.querySelector(".mu-ecoute .mu-bt--lecture")?.getAttribute("aria-label"), sur: document.querySelector(".mu-ecoute-sur")?.textContent, eq: document.querySelector(".mu-ecoute-sur .mu-egaliseur")?.hasAttribute("data-actif") }));
  await s.p.waitForTimeout(350);
  await capturer(s.p, "musique-pause");
  // Défiler sous la carte : la capsule revient.
  await s.p.evaluate(() => document.querySelector(".page").scrollTo(0, 1400));
  await s.p.waitForFunction(() => !document.querySelector(".mu-mini")?.hasAttribute("data-efface"), null, { timeout: 3000 });
  await s.p.waitForTimeout(300);
  await capturer(s.p, "musique-capsule-revient");
  await fermer(s);
  return {
    ok: reprise.mode === "reprise" && reprise.titre === "Les falaises" && reprise.fond && /En lecture/.test(lecture.sur) && lecture.eq && lecture.mini.efface && lecture.mini.inert
      && lecture.suite >= 1 && lecture.tuile && niveaux.some((t) => /scaleY/.test(t)) && pause.bouton === "Lecture" && /En pause/.test(pause.sur) && pause.eq === false,
    reprise, lecture, niveaux, pause,
  };
});

await essai("Musique : barre de lecture — clavier (→ +5 s, Début), glisser 1:1 et recherche au relâchement, bulle du temps au survol", async () => {
  const s = await ouvrir();
  await aller(s.p, "musique");
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-ligne[role=row][data-id]").nth(0).dblclick();
  await s.p.waitForSelector(".mu-mini .mu-bl:not([data-inactif])", { timeout: 5000 });
  await s.p.waitForTimeout(800);
  const pos = () => s.p.evaluate(() => { const t = document.querySelector(".mu-mini .mu-temps .mu-chiffre")?.textContent ?? "0:00"; const [m, x] = t.split(":").map(Number); return m * 60 + x; });
  const t0 = await pos();
  await s.p.locator(".mu-mini .mu-bl-natif").focus();
  await s.p.keyboard.press("ArrowRight");
  await s.p.waitForTimeout(250);
  const t1 = await pos();
  const boite = await s.p.locator(".mu-mini .mu-bl").boundingBox();
  await s.p.mouse.move(boite.x + boite.width * 0.6, boite.y + boite.height / 2);
  await s.p.waitForTimeout(150);
  const bulle = await s.p.evaluate(() => document.querySelector(".mu-mini .mu-bl-bulle")?.textContent ?? null);
  await capturer(s.p, "musique-barre-survol", { clip: { x: Math.max(0, boite.x - 120), y: boite.y - 60, width: Math.min(560, boite.width + 240), height: 120 } });
  await s.p.mouse.down();
  await s.p.mouse.move(boite.x + boite.width * 0.8, boite.y + boite.height / 2, { steps: 4 });
  const pendant = await s.p.evaluate(() => ({ glisse: document.querySelector(".mu-mini .mu-bl")?.hasAttribute("data-glisse"), rempli: document.querySelector(".mu-mini .mu-bl-rempli")?.style.transform }));
  await s.p.mouse.up();
  await s.p.waitForTimeout(300);
  const t2 = await pos();
  await s.p.locator(".mu-mini .mu-bl-natif").focus();
  await s.p.keyboard.press("Home");
  await s.p.waitForTimeout(250);
  const t3 = await pos();
  await fermer(s);
  return { ok: t1 >= t0 + 4 && !!bulle && pendant.glisse && /scaleX\(0\.[7-8]/.test(pendant.rempli ?? "") && t2 >= 26 && t3 <= 1, t0, t1, bulle, pendant, t2, t3 };
});

await essai("Musique : albums sur le fond de leur pochette, artistes ronds, playlists en mosaïques réelles, sources réelles dans Importer", async () => {
  const s = await ouvrir();
  await aller(s.p, "musique");
  const ronds = await s.p.locator(".mu-section[aria-label='Artistes'] .mu-tuile[data-rond]").count();
  const mosaique = await s.p.locator(".mu-pl-cartes .mu-mosaique img").count();
  await onglet(s.p, "Bibliothèque");
  await s.p.locator(".mu-outils .seg button", { hasText: "Albums" }).click();
  await s.p.locator(".mu-outils .seg button", { hasText: "Grille" }).click();
  await s.p.locator(".mu-tuile", { hasText: "Nocturnes" }).locator(".mu-tuile-poch").click();
  await s.p.waitForSelector(".mu-album");
  const album = await s.p.evaluate(() => ({ fond: !!document.querySelector(".mu-album-tete .mu-ecoute-fond"), titre: document.querySelector(".mu-album-titre")?.textContent }));
  await capturer(s.p, "musique-album");
  await onglet(s.p, "Playlists");
  await capturer(s.p, "musique-playlists");
  await onglet(s.p, "Importer");
  const sources = await s.p.locator(".mu-sources .mu-puce").allTextContents();
  await capturer(s.p, "musique-importer");
  await fermer(s);
  return { ok: ronds >= 2 && mosaique >= 4 && album.fond && album.titre === "Nocturnes" && sources.includes("Internet Archive") && sources.includes("Spotify"), ronds, mosaique, album, sources };
});

// ======================================================================================================================
// 3. Intégrations et Paramètres
// ======================================================================================================================
await essai("Intégrations : quatre cartes (état réel, une action), détails dépliables au clavier, action selon l'état", async () => {
  const s = await ouvrir();
  await aller(s.p, "integrations");
  const cartes = await s.p.evaluate(() => [...document.querySelectorAll(".int-carte")].map((c) => ({ titre: c.querySelector(".int-carte-titre")?.textContent, etat: c.querySelector(".pill")?.textContent, actions: c.querySelectorAll(".int-actions:not(.int-actions--details) .btn").length })));
  await s.p.locator(".int-carte--large summary").focus();
  await s.p.keyboard.press("Enter");
  const ouvert = await s.p.evaluate(() => document.querySelector(".int-carte--large details")?.open);
  const verifs = await s.p.locator(".int-carte--large .int-verif").count();
  await capturer(s.p, "integrations-1280");
  await fermer(s);
  const t = await ouvrir({ introuvable: true, compte: "non-relie" });
  await aller(t.p, "integrations");
  const introuvable = await t.p.evaluate(() => ({ premiere: [...document.querySelector(".int-carte--large .int-actions").querySelectorAll(".btn")].map((b) => b.textContent), compte: document.querySelector(".int-carte[data-statut='non-relie'] .btn--primary")?.textContent, cartes: document.querySelectorAll(".int-carte").length }));
  await capturer(t.p, "integrations-introuvable");
  await fermer(t);
  return {
    ok: cartes.length === 4 && cartes[0].titre === "Adobe Premiere Pro" && /Connecté/.test(cartes[0].etat) && cartes.every((c) => c.actions >= 1) && ouvert && verifs === 4
      && introuvable.premiere.includes("Réparer") && /Relier/.test(introuvable.compte ?? "") && introuvable.cartes === 3,
    cartes, ouvert, verifs, introuvable,
  };
});

await essai("Paramètres : catégories, navigation qui suit la lecture, la coque ne bouge pas, aides nommées, TOUTES les options", async () => {
  const s = await ouvrir({}, { largeur: 900, hauteur: 640 });
  await aller(s.p, "parametres");
  const categories = await s.p.locator(".reg-nav a").allTextContents();
  await capturer(s.p, "parametres-900x640");
  await s.p.locator(".reg-nav a", { hasText: "Mises à jour" }).click();
  await s.p.waitForTimeout(1000);
  const apres = await s.p.evaluate(() => ({ tete: Math.round(document.querySelector(".tete").getBoundingClientRect().top), courant: document.querySelector(".reg-nav a[aria-current]")?.textContent, defile: document.querySelector(".page").scrollTop }));
  await capturer(s.p, "parametres-mises-a-jour");
  const options = await s.p.evaluate(() => ({
    interrupteurs: [...document.querySelectorAll(".reg-page [role=switch]")].map((b) => b.getAttribute("aria-label")),
    segmentes: [...document.querySelectorAll(".reg-page .seg")].map((g) => g.getAttribute("aria-label")),
    boutons: [...document.querySelectorAll(".reg-page .btn")].map((b) => b.textContent.trim()),
    aides: [...document.querySelectorAll(".reg-aide")].every((b) => (b.getAttribute("aria-label") || "").startsWith("Aide : ")),
    presence: !!document.querySelector('[data-reglage="presence"] .rd--choix'),
  }));
  await fermer(s);
  const attendus = ["Surveiller ce dossier", "Média prêt", "Import réussi dans Premiere", "Erreurs", "Lancer au démarrage de Windows"];
  const segs = ["Thème", "Réduire les animations", "Présence de la chouette", "Chutier d'import", "Mode accéléré Everything"];
  const btns = ["Modifier…", "Ajouter…", "Rechercher les mises à jour", "Licences", "Ouvrir le dossier", "Exporter un rapport…", "Réparer", "Désinstaller…", "Déplacer…"];
  return {
    ok: categories.length === 9 && categories.includes("AETHRYON Index") && apres.tete === 0 && apres.courant === "Mises à jour" && apres.defile > 0
      && attendus.every((x) => options.interrupteurs.includes(x)) && segs.every((x) => options.segmentes.includes(x)) && btns.every((x) => options.boutons.includes(x)) && options.aides && options.presence,
    categories, apres, options,
  };
});

await essai("Paramètres › AETHRYON Index : exclusion ajoutée puis retirée (réglage du cœur), Everything automatique, emplacement", async () => {
  const s = await ouvrir();
  await aller(s.p, "parametres");
  await s.p.locator(".reg-nav a", { hasText: "AETHRYON Index" }).click();
  await s.p.waitForTimeout(700);
  await s.p.locator('[data-reglage="index-exclusions"] input').fill("Brouillons");
  await s.p.locator('[data-reglage="index-exclusions"] button', { hasText: "Exclure" }).click();
  await s.p.waitForTimeout(250);
  const ajoute = await s.p.evaluate(() => window.__maquette.index ? true : false) && await s.p.locator('[data-reglage="index-exclusions"] .reg-puce', { hasText: "Brouillons" }).count();
  await s.p.locator('[data-reglage="index-exclusions"] button[aria-label="Ne plus exclure Brouillons"]').click();
  await s.p.waitForTimeout(250);
  const retire = await s.p.locator('[data-reglage="index-exclusions"] .reg-puce', { hasText: "Brouillons" }).count();
  await s.p.locator('[data-reglage="index-everything"] button', { hasText: "Automatique" }).click();
  await s.p.waitForTimeout(250);
  const ev = await s.p.evaluate(() => ({ choisi: document.querySelector('[data-reglage="index-everything"] [aria-pressed="true"]')?.textContent, phrase: document.querySelector('[data-reglage="index-everything"] .rd--choix')?.textContent }));
  const emplacement = await s.p.locator('[data-reglage="index-emplacement"] .mono').textContent();
  await capturer(s.p, "parametres-index");
  await fermer(s);
  return { ok: ajoute === 1 && retire === 0 && ev.choisi === "Automatique" && /Everything/.test(ev.phrase ?? "") && /Index/.test(emplacement), ajoute, retire, ev, emplacement };
});

// ======================================================================================================================
// 4. AETHRYON Index : écran du scanner et Bibliothèque unifiée
// ======================================================================================================================
await essai("Scanner : disques (indisponibles dits), choix, scan RÉEL de la maquette (indéterminé, compteurs, chouette en analyse), annulation", async () => {
  const s = await ouvrir();
  await scanner(s.p);
  const volumes = await s.p.evaluate(() => [...document.querySelectorAll(".sc-volume")].map((v) => ({ nom: v.querySelector(".sc-volume-nom")?.textContent, actif: !v.disabled, coche: v.getAttribute("aria-pressed") })));
  const lancerAvant = await s.p.getByRole("button", { name: "Lancer le scan" }).isDisabled();
  await s.p.locator(".sc-volume", { hasText: "D:" }).click();
  await s.p.locator(".sc-volume", { hasText: "E:" }).click();
  await s.p.waitForTimeout(200);
  const resume = await s.p.locator(".sc-lancer-titre").textContent();
  await capturer(s.p, "scanner-choix");
  await s.p.getByRole("button", { name: "Lancer le scan" }).click();
  await s.p.waitForSelector(".sc-scan");
  await s.p.waitForTimeout(900);
  const pendant = await s.p.evaluate(() => ({
    pc: document.querySelector(".sc-barre")?.getAttribute("aria-valuenow"), indet: document.querySelector(".sc-barre")?.classList.contains("progress--indet"),
    medias: document.querySelector(".sc-scan-titre")?.textContent, chouette: document.querySelector(".sc-scan .companion")?.dataset.etat, niche: document.querySelector(".niche")?.dataset.etat,
    courant: document.querySelector(".sc-courant")?.textContent,
  }));
  await capturer(s.p, "scanner-en-cours");
  await s.p.getByRole("button", { name: "Annuler le scan" }).click();
  await s.p.waitForSelector(".sc-fin[data-etat='annule']", { timeout: 4000 });
  const annule = await s.p.evaluate(() => document.querySelector(".sc-fin .surtitre")?.textContent);
  await fermer(s);
  return {
    ok: volumes.length === 5 && volumes.filter((v) => !v.actif).length === 2 && lancerAvant && /D: · E:/.test(resume) && pendant.pc == null && pendant.indet && /\d/.test(pendant.medias)
      && pendant.chouette === "processing" && !!pendant.courant && annule === "Scan annulé",
    volumes, resume, pendant, annule,
  };
});

await essai("Scanner au CLAVIER : Tab jusqu'à un disque, Espace le coche (anneau de focus visible), Entrée lance, Entrée annule", async () => {
  const s = await ouvrir();
  await scanner(s.p);
  const d = s.p.locator(".sc-volume", { hasText: "D:" });
  await d.focus();
  await s.p.keyboard.press("Space");
  await s.p.waitForTimeout(200);
  const coche = await d.getAttribute("aria-pressed");
  // Anneau de focus du clavier (:focus-visible) : Tab vers l'avant puis Maj+Tab pour revenir dessus.
  await s.p.keyboard.press("Tab");
  await s.p.keyboard.press("Shift+Tab");
  const anneau = await d.evaluate((el) => { const c = getComputedStyle(el); return el === document.activeElement && c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2; });
  await s.p.getByRole("button", { name: "Lancer le scan" }).focus();
  await s.p.keyboard.press("Enter");
  await s.p.waitForSelector(".sc-scan");
  await s.p.getByRole("button", { name: "Annuler le scan" }).focus();
  await s.p.keyboard.press("Enter");
  await s.p.waitForSelector(".sc-fin[data-etat='annule']", { timeout: 4000 });
  await fermer(s);
  return { ok: coche === "true" && anneau, coche, anneau };
});

await essai("Scanner : scan jusqu'au bout (erreurs consultables), mode Everything mesurable, « Explorer les médias » → Bibliothèque « Scannés »", async () => {
  const s = await ouvrir({ indexErreurs: true, scanLent: 60 });
  await scanner(s.p);
  await s.p.locator(".sc-tous").click();
  await s.p.waitForTimeout(150);
  await s.p.getByRole("button", { name: "Lancer le scan" }).click();
  await s.p.waitForSelector(".sc-fin[data-etat='termine']", { timeout: 8000 });
  await s.p.locator(".sc-erreurs summary").click();
  const fin = await s.p.evaluate(() => ({ chiffres: [...document.querySelectorAll(".sc-chiffres--fin dd")].map((d) => d.textContent), erreurs: document.querySelectorAll(".sc-erreurs li").length, bilan: document.querySelector(".sc-fin .sc-scan-ligne")?.textContent }));
  await capturer(s.p, "scanner-fin");
  await s.p.getByRole("button", { name: "Explorer les médias" }).click();
  await s.p.waitForSelector(".bib-outils .seg[aria-label='Origine des médias']");
  await s.p.waitForTimeout(600);
  const bib = await s.p.evaluate(() => ({ origine: document.querySelector(".bib-outils .seg[aria-label='Origine des médias'] [aria-pressed='true']")?.textContent, pastilles: [...document.querySelectorAll(".mcard-pastille")].map((x) => x.textContent).slice(0, 3) }));
  await fermer(s);
  const e = await ouvrir({ everything: true, scanLent: 120 });
  await e.p.evaluate(() => window.__TAURI_INTERNALS__.invoke("index_reglages_modifier", { modif: { everything: "auto" } }));
  await scanner(e.p);
  await e.p.locator(".sc-volume", { hasText: "C:" }).click();
  await e.p.getByRole("button", { name: "Lancer le scan" }).click();
  await e.p.waitForSelector(".sc-scan");
  await e.p.waitForTimeout(1300);
  const mesurable = await e.p.evaluate(() => ({ pc: document.querySelector(".sc-barre")?.getAttribute("aria-valuenow"), sur: document.querySelector(".sc-scan .surtitre")?.textContent }));
  await capturer(e.p, "scanner-everything");
  await fermer(e);
  return {
    ok: fin.chiffres.length === 4 && fin.erreurs >= 1 && /nouveaux/.test(fin.bilan ?? "") && /Scannés/.test(bib.origine ?? "") && bib.pastilles.every((x) => /Scanné/.test(x)) && Number(mesurable.pc) > 0 && /Everything/.test(mesurable.sur ?? ""),
    fin, bib, mesurable,
  };
});

await essai("Bibliothèque unifiée : origine, décomptes réels, source sur la carte, « Surveiller ce dossier » au lieu d'importer, aperçu par l'index, recherche", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  await s.p.waitForSelector(".bib-outils .seg[aria-label='Origine des médias']");
  await s.p.waitForTimeout(500);
  const tout = await s.p.evaluate(() => ({ origine: [...document.querySelectorAll(".bib-outils .seg[aria-label='Origine des médias'] button")].map((b) => b.textContent), types: [...document.querySelectorAll(".bib-outils .seg[aria-label='Type de média'] button")].map((b) => b.textContent) }));
  await capturer(s.p, "bibliotheque-unifiee");
  await s.p.locator(".bib-outils .seg[aria-label='Origine des médias'] button", { hasText: "Scannés" }).click();
  await s.p.waitForTimeout(600);
  const premiere = s.p.locator(".mcard").first();
  await premiere.click();
  await s.p.keyboard.press("Alt+Enter");
  await s.p.waitForTimeout(400);
  const details = await s.p.evaluate(() => ({ bouton: document.querySelector(".bib-details .btn--primary")?.textContent, source: [...document.querySelectorAll(".bib-details dt")].some((d) => d.textContent === "Source"), importer: !!document.querySelector(".mcard .iconbtn[aria-label^='Importer']") }));
  await capturer(s.p, "bibliotheque-scannes-details");
  await s.p.locator(".bib-details .btn--primary").click();
  await s.p.waitForTimeout(300);
  // Ctrl I sur un média scanné : explication, aucune commande d'import.
  await premiere.focus();
  await s.p.keyboard.press("Control+i");
  await s.p.waitForTimeout(300);
  const toast = await s.p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
  // Aperçu d'une vidéo scannée : le cœur ouvre CE fichier (index_apercu), puis le lecteur commun.
  await s.p.keyboard.press("Escape");
  const video = s.p.locator(".mcard", { hasText: "Rushes" }).first();
  await video.scrollIntoViewIfNeeded();
  await video.dblclick();
  await s.p.waitForSelector(".pv", { timeout: 4000 });
  await s.p.waitForTimeout(600);
  const apercu = await s.p.evaluate(() => ({ video: !!document.querySelector(".pv video"), bouton: document.querySelector(".insp .btn--primary")?.textContent }));
  await capturer(s.p, "bibliotheque-apercu-scanne");
  await s.p.keyboard.press("Escape");
  await s.p.locator("#recherche-globale").fill("drone");
  await s.p.waitForTimeout(700);
  const recherche = await s.p.evaluate(() => [...document.querySelectorAll(".mcard .mn")].map((x) => x.textContent).slice(0, 8));
  const a = await appels(s.p);
  await fermer(s);
  return {
    ok: tout.origine.length === 3 && /Scannés\s*60/.test(tout.origine[2]) && /Tout/.test(tout.types[0]) && details.bouton === "Surveiller ce dossier" && details.source && !details.importer
      && /Médias scannés non importés/.test(toast) && !a.includes("importer") && a.includes("dossier_ajouter") && a.includes("index_apercu") && apercu.video && apercu.bouton === "Surveiller ce dossier"
      && recherche.length >= 1 && recherche.every((x) => /Drone/.test(x)) && a.includes("bibliotheque_requete"),
    tout, details, toast, apercu, recherche,
  };
});

// ======================================================================================================================
// 5. Tailles de fenêtre, thème clair, mouvement réduit, cadence
// ======================================================================================================================
await essai("Débordements : aucune barre horizontale ni commande coupée, de 900 × 640 à 2560 × 1440 (6 écrans)", async () => {
  const tailles = [[900, 640], [1024, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];
  const fautes = [];
  for (const [l, h] of tailles) {
    const s = await ouvrir({ pilotables: true }, { largeur: l, hauteur: h });
    for (const sec of ["transferts", "musique", "integrations", "parametres", "bibliotheque"]) {
      await aller(s.p, sec);
      if (sec === "musique") await s.p.waitForSelector(".mu-corps");
      const d = await debordements(s.p);
      if (d.page > 0 || d.document > 0 || d.coupes.length) fautes.push({ l, h, sec, ...d });
    }
    await scanner(s.p);
    const d = await debordements(s.p);
    if (d.page > 0 || d.document > 0 || d.coupes.length) fautes.push({ l, h, sec: "scanner", ...d });
    if (l === 900 || l === 2560) await capturer(s.p, `scanner-${l}x${h}`);
    if (l === 2560) { await aller(s.p, "transferts"); await capturer(s.p, "transferts-2560x1440"); await aller(s.p, "integrations"); await capturer(s.p, "integrations-2560x1440"); }
    if (l === 900) { await aller(s.p, "transferts"); await capturer(s.p, "transferts-900x640"); await aller(s.p, "musique"); await s.p.waitForSelector(".mu-corps"); await capturer(s.p, "musique-900x640"); }
    await fermer(s);
  }
  return { ok: fautes.length === 0, fautes: fautes.slice(0, 6) };
});

await essai("Thème clair et mouvement réduit (système ET réglage « Oui ») : pages lisibles, aucune boucle, rien ne se déplace", async () => {
  const c = await ouvrir({ theme: "clair", pilotables: true }, { theme: "light" });
  for (const [sec, nom] of [["transferts", "clair-transferts"], ["integrations", "clair-integrations"], ["parametres", "clair-parametres"]]) { await aller(c.p, sec); await capturer(c.p, nom); }
  await scanner(c.p);
  await capturer(c.p, "clair-scanner");
  await fermer(c);
  const resultats = [];
  for (const mode of ["systeme", "reglage"]) {
    // Réglage AETHRYON « Réduire les animations : Oui » (navigateur sans préférence) : posé dans l'état de la maquette.
    const r = mode === "systeme" ? await ouvrir({}, { reduit: true }) : await ouvrir({}, { avant: () => { window.__maquette.etat.config.reduireAnimations = "oui"; } });
    await scanner(r.p);
    await r.p.locator(".sc-volume", { hasText: "D:" }).click();
    await r.p.getByRole("button", { name: "Lancer le scan" }).click();
    await r.p.waitForSelector(".sc-scan");
    await r.p.waitForTimeout(500);
    const boucles = await r.p.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === "running").map((a) => a.animationName || "waapi"));
    const motion = await r.p.evaluate(() => document.documentElement.dataset.motion ?? null);
    if (mode === "systeme") await capturer(r.p, "mouvement-reduit-scanner");
    await r.p.getByRole("button", { name: "Annuler le scan" }).click();
    await fermer(r);
    resultats.push({ mode, boucles, motion });
  }
  return { ok: resultats.every((x) => x.boucles.length === 0), resultats };
});

await essai("Cadence (plancher headless) : Musique en lecture (égaliseur et visualisation réels), Transferts, scanner en cours", async () => {
  const s = await ouvrir({ pilotables: true, scanLent: 100 });
  const mesurer = (faire) => s.p.evaluate(async (ms) => {
    const t = []; let d = performance.now();
    await new Promise((ok) => { const f = (n) => { t.push(n - d); d = n; if (t.length < ms) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
    t.sort((a, b) => a - b);
    return { mediane: Math.round(t[Math.floor(t.length / 2)] * 10) / 10, p95: Math.round(t[Math.floor(t.length * 0.95)] * 10) / 10 };
  }, faire);
  await aller(s.p, "musique");
  await s.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile").first().hover();
  await s.p.locator(".mu-section[aria-label='Ajoutés récemment'] .mu-tuile-lire").first().click();
  await s.p.evaluate(() => document.querySelector(".page").scrollTo(0, 0));
  await s.p.waitForTimeout(800);
  const musique = await mesurer(120);
  await aller(s.p, "transferts");
  const transferts = await mesurer(90);
  await scanner(s.p);
  await s.p.locator(".sc-volume", { hasText: "D:" }).click();
  await s.p.getByRole("button", { name: "Lancer le scan" }).click();
  await s.p.waitForSelector(".sc-scan");
  const scan = await mesurer(120);
  await fermer(s);
  mesures.cadence = { musique, transferts, scan };
  return { ok: musique.mediane < 20 && transferts.mediane < 20 && scan.mediane < 20, musique, transferts, scan };
});

await navigateur.close();
serveur.close();

const assets = join(dist, "assets");
const js = readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f)).map((f) => ({ f, o: statSync(join(assets, f)).size }));
const morceaux = readdirSync(assets).filter((f) => /^(Transferts|Integrations|Parametres|Musique|EcranScanner|MiniLecteur)-.*\.js$/.test(f)).map((f) => ({ f, o: statSync(join(assets, f)).size }));
mesures.poids = { demarrage: js, aLaDemande: morceaux, budget: 326381 + 40960 };

const bilan = {
  le: new Date().toISOString(),
  essais: essais.map((e) => ({ nom: e.nom, ok: e.ok, ms: e.ms, detail: e.detail })),
  reussis: essais.filter((e) => e.ok).length,
  total: essais.length,
  captures,
  a11y: { sansNom: captures.reduce((n, c) => n + c.sansNom, 0), orphelins: captures.reduce((n, c) => n + c.orphelins, 0) },
  erreursConsole,
  mesures,
};
writeFileSync(join(sortie, "nocturne-2.json"), JSON.stringify(bilan, null, 2));
for (const e of essais) console.log(`${e.ok ? "OK " : "ÉCHEC"} ${e.nom}${e.ok ? "" : ` → ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail).slice(0, 1200)}`}`);
console.log(`${bilan.reussis}/${bilan.total} essais ; ${captures.length} captures ; accessibilité : ${bilan.a11y.sansNom} sans nom, ${bilan.a11y.orphelins} orphelins ; console : ${erreursConsole.length} erreur(s) ; JS de démarrage ${js.map((x) => x.o).join("+")} o (budget ${326381 + 40960} o)`);
if (erreursConsole.length) console.log(erreursConsole.slice(0, 5).join("\n"));
for (const c of captures.filter((c) => c.sansNom || c.orphelins)) console.log("a11y", c.fichier, JSON.stringify(c.detail));
process.exit(bilan.reussis === bilan.total && erreursConsole.length === 0 && bilan.a11y.sansNom === 0 ? 0 : 1);
