// Banc « Nocturne » : coque, Accueil, Bibliothèque et chouette. Chromium (Playwright), application construite (dist/),
// MAQUETTE de l'API Tauri (e2e/maquette-tauri.js). Les captures prouvent l'INTERFACE ; rien ici n'est WebView2 ni un
// vrai Windows (NON DÉMONTRÉ). Les images par seconde sont des PLANCHERS (Chromium sans GPU, SwiftShader).
// Usage : npm run build && node e2e/nocturne.mjs   (SORTIE : dossier des captures ; PLAYWRIGHT_CORE : module)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const dist = process.env.DIST || join(dirname(ici), "dist");
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
const MINIATURES = { 1: "film-cartes.jpg", 2: "coucher-6s.jpg", 3: "coucher-vertical-169.jpg", 4: "coucher-passage-gif.jpg", 8: "film-tools.jpg", 9: "coucher-1s.jpg", a: "coucher-1s.jpg", b: "coucher-1s.jpg", e: "coucher-1s.jpg" };
const H = (c) => c.repeat(40);
const WEBM = join(ici, "..", "..", "extension-premiere", "maquette", "medias", "coucher.webm");

const navigateur = await pw.chromium.launch();
const essais = [];
const erreursConsole = [];
const captures = [];
const mesures = {};

async function ouvrir(scenario = {}, { largeur = 1280, hauteur = 800, theme = "dark", reduit = false, dpr = 1, avant } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: dpr, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: theme, reducedMotion: reduit ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  p.__erreurs = erreurs;
  const init = [`window.__SCENARIO__ = ${JSON.stringify({ indexVide: true, ...scenario })};`, maquette];
  if (avant) init.push(`(${avant})();`);
  await p.addInitScript(init.join("\n"));
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const id = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (id && MINIATURES[id[0]]) return route.fulfill({ path: join(ici, "fixtures", MINIATURES[id[0]]), contentType: "image/jpeg" });
    // Vidéo (aperçu au survol, Aperçu) : Chromium de Playwright ne lit pas le H.264 ; on sert l'échantillon WebM du
    // dépôt (extension-premiere/maquette/medias/coucher.webm). La lecture H.264 réelle relève de WebView2 : NON DÉMONTRÉE.
    if (/\.(mp4|m4v|mov|webm)$/i.test(chemin)) {
      if (existsSync(WEBM)) return route.fulfill({ path: WEBM, contentType: "video/webm", headers: { "Access-Control-Allow-Origin": "*" } });
      return;
    }
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
  // Les 404 des miniatures et vidéos absentes de la maquette ne sont pas des erreurs de l'application.
  erreursConsole.push(...p.__erreurs.filter((e) => !/404|Failed to load resource|NotSupportedError|no supported source/i.test(e)));
  await ctx.close();
}

/** Accessibilité automatique : aucun élément interactif sans nom, aucun aria-activedescendant orphelin. */
async function a11y(p) {
  return p.evaluate(() => {
    const nom = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim()
      || (el.getAttribute("aria-labelledby") || "").split(" ").map((i) => document.getElementById(i)?.textContent || "").join("").trim()
      || (el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
    const sansNom = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, [role=menuitem], [role=option], [role=switch], [role=slider]")]
      .filter((el) => !el.closest("[aria-hidden=true]") && el.getClientRects().length && !nom(el) && !(el.tagName === "INPUT" && (el.labels?.length || el.getAttribute("aria-label"))))
      .map((el) => el.outerHTML.slice(0, 90));
    const orphelins = [...document.querySelectorAll("[aria-activedescendant]")].filter((el) => !document.getElementById(el.getAttribute("aria-activedescendant"))).map((el) => el.outerHTML.slice(0, 90));
    return { sansNom, orphelins };
  });
}

async function capturer(p, nom, opts = {}) {
  const fichier = `${nom}.png`;
  if (opts.element) await p.locator(opts.element).first().screenshot({ path: join(sortie, fichier) });
  else await p.screenshot({ path: join(sortie, fichier), clip: opts.clip });
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

const aller = async (p, section) => { await p.locator(`a[data-section="${section}"]`).click(); await p.waitForTimeout(320); };
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const carte = (p, c) => p.locator(`.mcard[data-media="${H(c)}"]`);

/** Débordements : défilement horizontal (page, document) et éléments coupés au bord droit ou bas de la fenêtre. */
async function debordements(p) {
  return p.evaluate(() => {
    const pg = document.querySelector(".page");
    const coupes = [...document.querySelectorAll(".nav a, .tete button, .tete label, .acc-hero button, .acc-hero input, .bib-outils button, .bib-titre button, .acc-stat, .captions button")]
      .filter((el) => el.getClientRects().length)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > window.innerWidth + 0.5 || r.left < -0.5 || r.width < 1)
      .map(({ el }) => el.outerHTML.slice(0, 80));
    return { page: pg ? pg.scrollWidth - pg.clientWidth : 0, document: document.documentElement.scrollWidth - document.documentElement.clientWidth, coupes };
  });
}

/** Mesure de cadence (requestAnimationFrame) et longues tâches pendant `faire`. */
async function cadence(p, faire) {
  await p.evaluate(() => {
    window.__perf = { images: [], longues: [] };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longues.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false }); } catch { /* sans longtask */ }
    let t0 = performance.now();
    const boucle = (t) => { window.__perf.images.push(t - t0); t0 = t; if (!window.__perf.fin) requestAnimationFrame(boucle); };
    requestAnimationFrame(boucle);
  });
  await faire();
  return p.evaluate(() => {
    window.__perf.fin = true;
    const im = window.__perf.images.slice(2).sort((a, b) => a - b);
    const q = (x) => im[Math.min(im.length - 1, Math.floor(x * im.length))];
    return { images: im.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +im[im.length - 1].toFixed(1), ips: +(1000 / q(0.5)).toFixed(1), longues: window.__perf.longues };
  });
}
const fluide = (r) => r.p95 <= 17.5 && !r.longues.some((x) => x > 50);

/** Capture de la chouette AVEC son orbite et son halo (boîte élargie de 45 % de chaque côté). */
async function capturerChouette(p, nom, selecteur = ".acc-chouette .c3d") {
  const b = await p.locator(selecteur).first().boundingBox();
  const v = p.viewportSize();
  const m = b.width * 0.45;
  const x = Math.max(0, b.x - m), y = Math.max(0, b.y - m * 0.6);
  await p.screenshot({ path: join(sortie, `${nom}.png`), clip: { x, y, width: Math.min(v.width - x, b.width + 2 * m), height: Math.min(v.height - y, b.height + 1.2 * m) } });
}

// ======================================================================================================================
// 1. Accueil : présentation, chouette, chiffres réels, derniers médias, état de Premiere discret
// ======================================================================================================================
await essai("Accueil : présentation, chouette en profondeur, chiffres RÉELS, derniers médias, Premiere dans l'en-tête", async () => {
  const s = await ouvrir({ compte: "utilisateur" });
  await s.p.waitForTimeout(500);
  const r = await s.p.evaluate(() => ({
    titre: document.querySelector(".acc-titre")?.textContent,
    chouette: document.querySelector(".acc-chouette .c3d")?.dataset.apparence,
    plans: document.querySelectorAll(".acc-chouette .c3d-plan").length,
    stats: [...document.querySelectorAll(".acc-stat")].map((b) => [b.querySelector(".acc-stat-n").textContent, b.querySelector(".acc-stat-l").textContent]),
    recents: document.querySelectorAll(".acc-carte").length,
    cols: getComputedStyle(document.querySelector(".acc-recents")).gridTemplateColumns.split(" ").length,
    premiere: document.querySelector(".puce-etat")?.dataset.ton,
    fil: document.querySelector(".fil b")?.textContent,
    nicheFixe: !document.querySelector(".niche .companion")?.hasAttribute("data-anime"),
    nicheVisible: !document.querySelector(".niche-boite")?.hasAttribute("data-masquee"),
    animees: document.querySelectorAll(".companion[data-anime]").length,
    encours: document.querySelector(".acc-encours-texte")?.textContent,
  }));
  await capturer(s.p, "accueil-1280x800");
  await s.p.locator(".acc-hero").screenshot({ path: join(sortie, "accueil-presentation.png") });
  await fermer(s);
  const attendus = [["11", "Dans la bibliothèque"], ["7", "Vidéos"], ["2", "Pistes audio"], ["2", "Images"]];
  return { ok: /Vos médias/.test(r.titre) && r.plans === 4 && r.chouette === "telechargement" && JSON.stringify(r.stats) === JSON.stringify(attendus) && r.recents === r.cols && r.premiere === "ok" && r.fil === "Accueil" && r.nicheFixe && r.nicheVisible && r.animees === 1 && /2\stransferts\sen cours · 51/.test(r.encours ?? ""), ...r };
});

await essai("Coller un lien : plateforme reconnue, conversion EXISTANTE appelée, réaction de réussite ; refus : réaction d'erreur distincte", async () => {
  const s = await ouvrir({ compte: "utilisateur" });
  const champ = s.p.getByLabel("Lien de la vidéo à convertir");
  await champ.click();
  await s.p.waitForTimeout(250);
  const regard = await s.p.evaluate(() => document.querySelector(".acc-chouette #eyes")?.style.transform || "");
  await champ.fill("https://www.youtube.com/watch?v=aethryon");
  const puce = await s.p.locator(".acc-plateforme").textContent();
  await capturer(s.p, "accueil-coller-un-lien", { element: ".acc-hero" });
  await s.p.getByRole("button", { name: "Convertir" }).click();
  await s.p.waitForSelector(".toast .tt");
  await s.p.waitForTimeout(120);
  const ok = await s.p.evaluate(() => ({
    toast: document.querySelector(".toast .tt")?.textContent, appel: window.__maquette.appels.includes("convertir_lien"),
    niche: document.querySelector(".niche-texte")?.textContent, apparence: document.querySelector(".acc-chouette .c3d")?.dataset.apparence, champ: document.querySelector(".acc-lien input")?.value,
  }));
  await capturerChouette(s.p, "chouette-reussite");
  await fermer(s);
  const e = await ouvrir({ compte: "utilisateur", conversionRefusee: "Quota du jour atteint : réessayez demain ou passez à l'offre annuelle." });
  await e.p.getByLabel("Lien de la vidéo à convertir").fill("https://www.tiktok.com/@aethryon/video/1");
  await e.p.getByRole("button", { name: "Convertir" }).click();
  await e.p.waitForSelector(".toast[role=alert]");
  await e.p.waitForTimeout(150);
  const ko = await e.p.evaluate(() => ({ toast: document.querySelector(".toast[role=alert] .tb")?.textContent, apparence: document.querySelector(".acc-chouette .c3d")?.dataset.apparence, regard: document.querySelector(".acc-chouette #eyes")?.style.transform, halo: getComputedStyle(document.querySelector(".acc-chouette .c3d-halo--erreur")).opacity }));
  await e.p.waitForTimeout(700);
  await capturerChouette(e.p, "chouette-erreur");
  await capturer(e.p, "accueil-conversion-refusee");
  await fermer(e);
  return { ok: /translate/.test(regard) && puce === "YouTube" && /Conversion lancée/.test(ok.toast ?? "") && ok.appel && /Conversion lancée/.test(ok.niche ?? "") && ok.apparence === "reussite" && ok.champ === ""
    && /Quota/.test(ko.toast ?? "") && ko.apparence === "erreur" && /translate/.test(ko.regard ?? "") && Number(ko.halo) > 0.5, regard, puce, ok, ko };
});

await essai("Compte non relié : rien n'est envoyé, « Relier mon compte » mène à Paramètres", async () => {
  const s = await ouvrir({ compte: "non-relie" });
  await s.p.getByLabel("Lien de la vidéo à convertir").fill("https://x.com/a/status/1");
  const puce = await s.p.locator(".acc-plateforme").textContent();
  await capturer(s.p, "accueil-non-relie", { element: ".acc-hero" });
  await s.p.getByRole("button", { name: "Relier mon compte" }).click();
  await s.p.waitForTimeout(350);
  const r = await s.p.evaluate(() => ({ fil: document.querySelector(".fil b")?.textContent, appel: window.__maquette.appels.includes("convertir_lien") }));
  await fermer(s);
  return { ok: puce === "X" && r.fil === "Paramètres" && !r.appel, puce, ...r };
});

await essai("Chiffres de l'Accueil : chaque tuile ouvre la Bibliothèque FILTRÉE ; « Voir tout » ; carte récente = aperçu", async () => {
  const s = await ouvrir();
  await s.p.locator(".acc-stat", { hasText: "Vidéos" }).click();
  await s.p.waitForTimeout(350);
  const filtre = await s.p.evaluate(() => ({ fil: document.querySelector(".fil b")?.textContent, presse: document.querySelector(".bib-outils .seg button[aria-pressed=true]")?.textContent, cartes: [...document.querySelectorAll(".mcard")].every((c) => !/\.(mp3|wav|png|gif)$/.test(c.querySelector(".mn")?.textContent ?? "")) }));
  await aller(s.p, "accueil");
  await s.p.locator(".acc-carte").first().click();
  await s.p.waitForTimeout(350);
  const apercu = await s.p.evaluate(() => ({ pv: !!document.querySelector(".pv"), fil: document.querySelector(".fil b")?.textContent }));
  await fermer(s);
  return { ok: filtre.fil === "Bibliothèque" && /^Vidéos/.test(filtre.presse ?? "") && filtre.cartes && apercu.pv && apercu.fil === "Aperçu", filtre, apercu };
});

await essai("Accueil vide : invitation travaillée, aucune donnée inventée (0 partout)", async () => {
  const s = await ouvrir({ vide: true });
  await s.p.waitForTimeout(400);
  const r = await s.p.evaluate(() => ({ stats: [...document.querySelectorAll(".acc-stat-n")].map((n) => n.textContent), vide: document.querySelector(".acc-vide h2")?.textContent, chouette: document.querySelector(".acc-chouette .c3d")?.dataset.apparence, encours: !!document.querySelector(".acc-encours") }));
  await capturer(s.p, "accueil-vide");
  await capturerChouette(s.p, "chouette-repos");
  await fermer(s);
  return { ok: r.stats.every((n) => n === "0") && /premiers médias/.test(r.vide ?? "") && r.chouette === "repos" && !r.encours, ...r };
});

// ======================================================================================================================
// 2. Chouette : apparences, une seule boucle, chargement, mouvement réduit et « Muette »
// ======================================================================================================================
await essai("Chouette : repos = UNE boucle (respiration) ; chargement = comète ; suivi du pointeur ; pause hors de la vue", async () => {
  const s = await ouvrir({ vide: true, delaiPanneau: 6000 });
  await s.p.waitForTimeout(500);
  const boucles = () => s.p.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === "running").map((a) => a.animationName ?? a.id ?? "?"));
  const repos = await boucles();
  const { x, y } = await centre(s.p.locator(".acc-chouette"));
  await s.p.mouse.move(x - 300, y - 120, { steps: 4 });
  await s.p.mouse.move(x + 60, y - 40, { steps: 8 });
  await s.p.waitForTimeout(600);
  const pivot = await s.p.evaluate(() => document.querySelector(".acc-chouette .c3d-pivot").style.transform);
  await capturerChouette(s.p, "chouette-attention-pointeur");
  await s.p.mouse.move(5, 790);
  // Chargement : un envoi vers Premiere attend la réponse du panneau (6 s dans cette maquette).
  await aller(s.p, "bibliotheque");
  await aller(s.p, "accueil");
  await s.p.evaluate(() => window.__maquette.modifier((e) => { e.enAttente = ["essai"]; }));
  await s.p.waitForTimeout(500);
  const chargement = await s.p.evaluate(() => ({ apparence: document.querySelector(".acc-chouette .c3d")?.dataset.apparence, boucle: document.querySelector(".acc-chouette .c3d")?.dataset.boucle }));
  const bouclesChargement = await boucles();
  await capturerChouette(s.p, "chouette-chargement");
  await s.p.evaluate(() => window.__maquette.modifier((e) => { e.enAttente = []; }));
  // Hors de la vue : la page défile, l'animation se met en pause.
  // (on allonge la page de l'essai pour que la chouette sorte entièrement de la vue)
  await s.p.evaluate(() => { document.querySelector(".acc").style.paddingBottom = "1400px"; const pg = document.querySelector(".page"); pg.scrollTop = pg.scrollHeight; });
  await s.p.waitForTimeout(400);
  const pause = await s.p.evaluate(() => ({ attribut: document.querySelector(".acc-chouette .c3d")?.hasAttribute("data-pause"), etat: document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity).map((a) => a.playState) }));
  await fermer(s);
  return { ok: repos.length === 2 && repos.every((n) => /souffle/.test(n)) && /rotateX/.test(pivot) && chargement.apparence === "chargement" && chargement.boucle === "comete" && bouclesChargement.length >= 1 && bouclesChargement.every((n) => /tourne|regard-orbite/.test(n))
    && pause.attribut && pause.etat.every((x) => x === "paused"), repos, pivot, chargement, bouclesChargement, pause };
});

await essai("Mouvement réduit (Windows) : dessin fixe, aucune boucle, page en fondu sans déplacement", async () => {
  const s = await ouvrir({}, { reduit: true });
  await s.p.waitForTimeout(400);
  const r = await s.p.evaluate(() => ({
    anime: document.querySelector(".acc-chouette .c3d")?.hasAttribute("data-anime"), boucle: document.querySelector(".acc-chouette .c3d")?.dataset.boucle,
    infinies: document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === "running").length,
    arc: !!document.querySelector(".acc-chouette .c3d-arc"),
  }));
  await s.p.locator('a[data-section="bibliotheque"]').click();
  const page = await s.p.evaluate(() => { const a = document.querySelector(".entree-section").getAnimations()[0]; return a ? { nom: a.animationName, duree: a.effect.getTiming().duration } : null; });
  await s.p.waitForTimeout(300);
  await s.p.locator('a[data-section="accueil"]').click();
  await s.p.waitForTimeout(300);
  await capturer(s.p, "mouvement-reduit-accueil");
  await fermer(s);
  // Réglage AETHRYON « Réduire les animations : Oui » sans réglage système.
  const t = await ouvrir({}, { avant: () => { const o = window.__TAURI_INTERNALS__; const i = o.invoke; o.invoke = async (c, a) => { const r = await i(c, a); if (c === "etat") r.config.reduireAnimations = "oui"; return r; }; } });
  await t.p.waitForTimeout(400);
  const reglage = await t.p.evaluate(() => ({ motion: document.documentElement.dataset.motion, anime: document.querySelector(".acc-chouette .c3d")?.hasAttribute("data-anime"), infinies: document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === "running").length }));
  await fermer(t);
  return { ok: r.anime === false && r.boucle === "aucune" && r.infinies === 0 && r.arc && page?.nom === "apparait" && reglage.motion === "reduced" && reglage.anime === false && reglage.infinies === 0, r, page, reglage };
});

await essai("Présence « Muette » : dessin fixe partout, l'état reste écrit", async () => {
  const s = await ouvrir({}, { avant: () => { try { localStorage.setItem("aethryon.chouette", "muette"); } catch { /* */ } } });
  await s.p.waitForTimeout(400);
  const r = await s.p.evaluate(() => ({ anime: document.querySelectorAll("[data-anime]").length, texte: document.querySelector(".niche-texte")?.textContent, infinies: document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === "running").length }));
  await fermer(s);
  return { ok: r.anime === 0 && /transferts? en cours/.test(r.texte ?? "") && r.infinies === 0, ...r };
});

// ======================================================================================================================
// 3. Coque : navigation, transitions, Ctrl K, en-tête
// ======================================================================================================================
await essai("Coque : transition de page au CLIC seulement (Ctrl 1-7 instantané), surbrillance glissante, Ctrl K, recherche → Bibliothèque", async () => {
  const s = await ouvrir({ compte: "utilisateur" });
  await s.p.locator('a[data-section="transferts"]').click();
  const clic = await s.p.evaluate(() => ({ instant: document.querySelector(".page").hasAttribute("data-instant"), anim: document.querySelector(".entree-section").getAnimations().map((a) => a.animationName), ind: document.querySelector(".nav-ind").getAnimations().length }));
  await s.p.waitForTimeout(350);
  await s.p.keyboard.press("Control+2");
  const clavier = await s.p.evaluate(() => ({ instant: document.querySelector(".page").hasAttribute("data-instant"), anim: document.querySelector(".entree-section").getAnimations().length, ind: document.querySelector(".nav-ind").getAnimations().length, fil: document.querySelector(".fil b")?.textContent, nav: document.querySelector(".nav").hasAttribute("data-instant") }));
  await s.p.keyboard.press("Control+1");
  await s.p.keyboard.press("Control+k");
  const focus = await s.p.evaluate(() => document.activeElement?.id);
  await s.p.keyboard.type("coucher");
  await s.p.waitForTimeout(300);
  const recherche = await s.p.evaluate(() => ({ fil: document.querySelector(".fil b")?.textContent, requete: document.querySelector(".bib-requete")?.textContent, cartes: document.querySelectorAll(".mcard").length }));
  await capturer(s.p, "coque-recherche");
  await s.p.keyboard.press("ArrowDown");
  const premiere = await s.p.evaluate(() => document.activeElement?.classList.contains("mcard"));
  const entete = await s.p.evaluate(() => ({ avatar: document.querySelector(".avatar")?.textContent, puces: [...document.querySelectorAll(".puce-etat")].map((b) => [b.dataset.ton, b.getAttribute("aria-label")]) }));
  await fermer(s);
  return { ok: !clic.instant && clic.anim.includes("entree-page") && clavier.instant && clavier.anim === 0 && clavier.nav && clavier.fil === "Bibliothèque" && focus === "recherche-globale" && recherche.fil === "Bibliothèque" && /«\s*coucher\s*»\s*·\s*7\s*résultats/.test(recherche.requete ?? "") && premiere && entete.avatar === "L" && entete.puces[0][0] === "ok", clic, clavier, focus, recherche, premiere, entete };
});

// ======================================================================================================================
// 4. Bibliothèque : grille, liste, détails, survol, menu, sélection, grand volume
// ======================================================================================================================
await essai("Bibliothèque : grandes vignettes (format, durée, état), infos au survol, panneau de détails (Alt Entrée), liste", async () => {
  const s = await ouvrir({ compte: "utilisateur" });
  await aller(s.p, "bibliotheque");
  await capturer(s.p, "bibliotheque-1280x800");
  const repos = await carte(s.p, "2").evaluate((el) => ({ mm: getComputedStyle(el.querySelector(".mm")).opacity, fmt: el.querySelector(".badge--fmt")?.textContent, dur: el.querySelector(".badge--dur")?.textContent, largeur: Math.round(el.querySelector(".thumb").getBoundingClientRect().width) }));
  const { x, y } = await centre(carte(s.p, "2").locator(".thumb"));
  await s.p.mouse.move(x, y, { steps: 4 });
  await s.p.waitForTimeout(300);
  const survol = await carte(s.p, "2").evaluate((el) => ({ mm: getComputedStyle(el.querySelector(".mm")).opacity, barre: getComputedStyle(el.querySelector(".hoverbar")).opacity }));
  await capturer(s.p, "bibliotheque-survol");
  // Aperçu vidéo au survol (450 ms d'intention) : élément <video> muet sur la miniature, retiré en sortant.
  await s.p.waitForTimeout(400);
  await s.p.waitForFunction((id) => document.querySelector(`.mcard[data-media="${id}"] video.pic-video[data-lecture]`), H("2"), { timeout: 4000 }).catch(() => {});
  await s.p.waitForTimeout(250);
  const video = await carte(s.p, "2").evaluate((el) => { const v = el.querySelector("video.pic-video"); return v ? { muet: v.muted, src: /asset\.localhost/.test(v.src), lecture: v.hasAttribute("data-lecture"), opacite: getComputedStyle(v).opacity } : null; });
  await capturer(s.p, "bibliotheque-apercu-video-survol");
  await s.p.mouse.move(5, 790);
  await s.p.waitForTimeout(100);
  const apres = await carte(s.p, "2").evaluate((el) => !!el.querySelector("video.pic-video"));
  // Détails : focus clavier sur une carte, Alt Entrée.
  await carte(s.p, "8").focus();
  await s.p.keyboard.press("Alt+Enter");
  await s.p.waitForTimeout(300);
  const details = await s.p.evaluate(() => ({ titre: document.querySelector(".bib-details h2")?.textContent, champs: [...document.querySelectorAll(".bib-details dt")].map((d) => d.textContent) }));
  await capturer(s.p, "bibliotheque-details");
  await s.p.keyboard.press("Alt+Enter");
  await s.p.getByRole("button", { name: "Liste" }).click();
  await s.p.waitForTimeout(300);
  const liste = await s.p.evaluate(() => ({ lignes: document.querySelectorAll(".lrow").length, tete: !!document.querySelector(".bib-liste-tete") }));
  await capturer(s.p, "bibliotheque-liste");
  await s.p.getByRole("button", { name: "Grille" }).click();
  await fermer(s);
  return { ok: repos.mm === "0" && repos.fmt === "MP4" && repos.dur === "0:12" && repos.largeur >= 236 && survol.mm === "1" && survol.barre === "1" && video?.muet && video?.src && video?.lecture && !apres
    && /AETHRYON Tools — extrait/.test(details.titre ?? "") && ["Format", "Durée", "Définition", "Taille", "Chemin"].every((c) => details.champs.includes(c)) && liste.lignes === 11 && liste.tete, repos, survol, video, apres, details, liste };
});

await essai("Bibliothèque : menu contextuel, sélection multiple (case, Ctrl + clic), import dans Premiere (Ctrl I)", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  await carte(s.p, "2").click({ button: "right" });
  await s.p.waitForSelector(".menu--flottant");
  await s.p.waitForTimeout(220);
  const menu = await s.p.evaluate(() => [...document.querySelectorAll(".menu--flottant [role=menuitem]")].map((m) => m.textContent.trim()));
  await capturer(s.p, "bibliotheque-menu");
  await s.p.keyboard.press("Escape");
  await carte(s.p, "3").click({ modifiers: ["Control"] });
  await carte(s.p, "8").click({ modifiers: ["Control"] });
  await s.p.waitForTimeout(200);
  const sel = await s.p.evaluate(() => ({ n: document.querySelectorAll('.mcard[aria-selected="true"]').length, barre: document.querySelector(".barre-selection")?.textContent }));
  await capturer(s.p, "bibliotheque-selection");
  await carte(s.p, "8").focus();
  await s.p.keyboard.press("Control+i");
  await s.p.waitForTimeout(200);
  const importe = await s.p.evaluate(() => window.__maquette.appels.filter((a) => a === "importer").length);
  await fermer(s);
  return { ok: menu.some((m) => /Importer dans Premiere/.test(m)) && menu.some((m) => /Détails/.test(m)) && sel.n === 3 && /3\s*sélectionnés/.test(sel.barre ?? "") && importe === 1, menu, sel, importe };
});

await essai("20 000 médias : grille VIRTUALISÉE (peu de nœuds), fin atteinte au clavier (Fin), Ctrl A, recherche, défilement fluide", async () => {
  const s = await ouvrir({ nombreMedias: 20000 }, { largeur: 1440, hauteur: 900 });
  await aller(s.p, "bibliotheque");
  await s.p.waitForTimeout(300);
  const debut = await s.p.evaluate(() => ({ cartes: document.querySelectorAll(".mcard").length, noeuds: document.querySelectorAll(".bib-grille *").length, hauteur: document.querySelector(".bib-grille").offsetHeight, total: document.querySelector(".bib-titre .sub b")?.textContent }));
  await capturer(s.p, "bibliotheque-20000");
  // Défilement soutenu et rapide (6 000 px/s pendant 2 s, comme une molette lancée), sur 20 011 médias.
  const perf = await cadence(s.p, () => s.p.evaluate(async () => {
    const pg = document.querySelector(".page");
    const t0 = performance.now();
    await new Promise((ok) => { const pas = (t) => { const u = Math.min(1, (t - t0) / 2000); pg.scrollTop = 12000 * u; if (u < 1) requestAnimationFrame(pas); else ok(); }; requestAnimationFrame(pas); });
  }));
  const pendant = await s.p.evaluate(() => document.querySelectorAll(".mcard").length);
  await s.p.locator(".mcard").first().focus();
  await s.p.keyboard.press("End");
  await s.p.waitForTimeout(300);
  const fin = await s.p.evaluate(() => ({ nom: document.activeElement?.querySelector(".mn")?.textContent, pos: document.activeElement?.getAttribute("aria-posinset"), taille: document.activeElement?.getAttribute("aria-setsize"), visible: (() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })() }));
  await capturer(s.p, "bibliotheque-20000-fin");
  await s.p.keyboard.press("Home");
  await s.p.keyboard.press("Control+a");
  await s.p.waitForTimeout(250);
  const tout = await s.p.evaluate(() => document.querySelector(".barre-selection")?.textContent);
  await s.p.keyboard.press("Escape");
  const t0 = Date.now();
  await s.p.keyboard.press("Control+k");
  await s.p.keyboard.type("charge 1999");
  // « charge 1999 » : 01999, 11999 et 19990 à 19999 → 12 médias.
  await s.p.waitForFunction(() => /12\s*résultats/.test(document.querySelector(".bib-requete")?.textContent ?? ""), null, { timeout: 4000 });
  const recherche = { ms: Date.now() - t0, cartes: await s.p.evaluate(() => document.querySelectorAll(".mcard").length) };
  await fermer(s);
  mesures.virtualisation = { debut, perf, pendant, fin, tout, recherche };
  return { ok: debut.cartes < 120 && debut.noeuds < 2500 && pendant < 120 && fin.pos === "20011" && fin.visible && /20\s*011\s*sélectionnés/.test((tout ?? "").replace(/ /g, " ")) && recherche.cartes === 12 && fluide(perf), debut, perf, pendant, fin, tout, recherche };
});

await essai("Bibliothèque vide : la chouette en profondeur, une phrase, des actions réelles", async () => {
  const s = await ouvrir({ vide: true });
  await aller(s.p, "bibliotheque");
  await s.p.waitForTimeout(400);
  const r = await s.p.evaluate(() => ({ titre: document.querySelector(".bib-vide h2")?.textContent, chouette: !!document.querySelector(".bib-vide .c3d"), nicheMasquee: document.querySelector(".niche-boite")?.hasAttribute("data-masquee"), boutons: [...document.querySelectorAll(".bib-vide .vide-actions button")].map((b) => b.textContent) }));
  await capturer(s.p, "bibliotheque-vide");
  await fermer(s);
  return { ok: /vide/.test(r.titre ?? "") && r.chouette && r.nicheMasquee && r.boutons.length >= 2, ...r };
});

// ======================================================================================================================
// 5. Tailles de fenêtre, thème clair, cadence des animations
// ======================================================================================================================
const TAILLES = [[900, 640], [1024, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];
await essai("Aucun défilement horizontal ni élément coupé de 900 × 640 à 2560 × 1440 (Accueil, Bibliothèque, détails ouverts)", async () => {
  const resultats = [];
  for (const [l, h] of TAILLES) {
    const s = await ouvrir({ compte: "utilisateur" }, { largeur: l, hauteur: h });
    await s.p.waitForTimeout(300);
    const a = await debordements(s.p);
    if ([900, 1280, 2560].includes(l)) await capturer(s.p, `accueil-${l}x${h}`);
    await aller(s.p, "bibliotheque");
    const b = await debordements(s.p);
    if ([900, 2560].includes(l)) await capturer(s.p, `bibliotheque-${l}x${h}`);
    await s.p.locator(".mcard").first().focus();
    await s.p.keyboard.press("Alt+Enter");
    await s.p.waitForTimeout(250);
    const c = await debordements(s.p);
    if (l === 900) await capturer(s.p, `bibliotheque-details-${l}x${h}`);
    await fermer(s);
    resultats.push({ taille: `${l}×${h}`, accueil: a, bibliotheque: b, details: c });
  }
  const ok = resultats.every((r) => [r.accueil, r.bibliotheque, r.details].every((x) => x.page <= 0 && x.document <= 0 && x.coupes.length === 0));
  return { ok, resultats: ok ? resultats.map((r) => r.taille) : resultats };
});

await essai("Thème clair : coque, Accueil et Bibliothèque lisibles (jetons clairs)", async () => {
  const s = await ouvrir({ theme: "clair", compte: "utilisateur" }, { theme: "light" });
  await s.p.waitForTimeout(300);
  const r = await s.p.evaluate(() => ({ theme: document.documentElement.dataset.theme, fond: getComputedStyle(document.querySelector(".win")).backgroundColor, hero: getComputedStyle(document.querySelector(".acc-hero")).backgroundColor === "rgb(255, 253, 249)" }));
  await capturer(s.p, "accueil-clair");
  await aller(s.p, "bibliotheque");
  await capturer(s.p, "bibliotheque-clair");
  await fermer(s);
  return { ok: r.theme === "light" && r.hero, ...r };
});

await essai("Cadence (plancher headless) : respiration et suivi du pointeur de la chouette, transitions de page", async () => {
  const s = await ouvrir({ vide: true });
  await s.p.waitForTimeout(300);
  const respiration = await cadence(s.p, () => s.p.waitForTimeout(2000));
  const { x, y } = await centre(s.p.locator(".acc-hero"));
  const pointeur = await cadence(s.p, async () => { for (let k = 0; k < 4; k++) { await s.p.mouse.move(x - 400, y - 60, { steps: 20 }); await s.p.mouse.move(x + 400, y + 60, { steps: 20 }); } });
  const pages = await cadence(s.p, async () => { for (const sec of ["bibliotheque", "transferts", "accueil", "parametres", "accueil"]) { await s.p.locator(`a[data-section="${sec}"]`).click(); await s.p.waitForTimeout(300); } });
  await fermer(s);
  mesures.cadence = { respiration, pointeur, pages };
  return { ok: fluide(respiration) && fluide(pointeur) && pages.p95 <= 34 && !pages.longues.some((d) => d > 120), respiration, pointeur, pages };
});

await essai("Zoom ×2 de la chouette (états réels) pour la revue visuelle", async () => {
  const s = await ouvrir({}, { dpr: 2, reduit: true });
  await s.p.waitForTimeout(300);
  await capturerChouette(s.p, "chouette-telechargement-x2");
  await s.p.locator(".side-marque").screenshot({ path: join(sortie, "marque-barre-x2.png") });
  await s.p.locator(".niche").screenshot({ path: join(sortie, "niche-x2.png") });
  await fermer(s);
  return { ok: true };
});

await navigateur.close();
serveur.close();

// Poids du JS de démarrage (fragment « index », taille sur disque), à comparer à master (0d34b98 : 326 381 o).
const assets = join(dist, "assets");
const js = readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f)).map((f) => ({ f, o: statSync(join(assets, f)).size }));
const css = readdirSync(assets).filter((f) => /^index-.*\.css$/.test(f)).map((f) => ({ f, o: statSync(join(assets, f)).size }));
mesures.poids = { js, css };

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
writeFileSync(join(sortie, "nocturne.json"), JSON.stringify(bilan, null, 2));
for (const e of essais) console.log(`${e.ok ? "OK " : "ÉCHEC"} ${e.nom}${e.ok ? "" : ` → ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail).slice(0, 900)}`}`);
console.log(`${bilan.reussis}/${bilan.total} essais ; ${captures.length} captures ; accessibilité : ${bilan.a11y.sansNom} sans nom, ${bilan.a11y.orphelins} orphelins ; console : ${erreursConsole.length} erreur(s) ; JS de démarrage ${js.map((x) => x.o).join(", ")} o`);
if (erreursConsole.length) console.log(erreursConsole.slice(0, 5).join("\n"));
for (const c of captures.filter((c) => c.sansNom || c.orphelins)) console.log("a11y", c.fichier, JSON.stringify(c.detail));
process.exit(bilan.reussis === bilan.total && erreursConsole.length === 0 && bilan.a11y.sansNom === 0 ? 0 : 1);
