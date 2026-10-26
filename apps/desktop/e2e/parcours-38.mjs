// Banc du parcours 3.8 (Flow, Companion, mouvement) : Chromium (Playwright), application construite (dist/), MAQUETTE
// de l'API Tauri (e2e/maquette-tauri.js) qui rejoue les événements de dépôt que Tauri enverrait. Les captures s'appellent
// « maquette-… » : elles prouvent l'INTERFACE, pas le glisser natif de Windows (OLE), qui reste NON DÉMONTRÉ ici.
// Usage : npm run build && node e2e/parcours-38.mjs   (SORTIE : dossier des captures ; PLAYWRIGHT_CORE : module)
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
const DM = "C:\\Users\\Élodie\\Videos\\AETHRYON";

const navigateur = await pw.chromium.launch();
const essais = [];
const erreursConsole = [];
const captures = [];

async function ouvrir(scenario = {}, { largeur = 1280, hauteur = 800, theme = "dark", reduit = false, presence, avant } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, timezoneId: "Europe/Paris", locale: "fr-FR", colorScheme: theme, reducedMotion: reduit ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", (e) => erreurs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  p.__erreurs = erreurs;
  const init = [`window.__SCENARIO__ = ${JSON.stringify({ indexVide: true, ...scenario })};`];
  if (presence) init.push(`try { localStorage.setItem("aethryon.chouette", ${JSON.stringify(presence)}); } catch {}`);
  init.push(maquette);
  if (avant) init.push(`(${avant})();`);
  await p.addInitScript(init.join("\n"));
  await p.route("http://asset.localhost/**", async (route) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const id = (chemin.match(/miniatures\\([0-9a-f]{40})\.jpg$/) || [])[1];
    if (id && MINIATURES[id[0]]) return route.fulfill({ path: join(ici, "fixtures", MINIATURES[id[0]]), contentType: "image/jpeg" });
    return route.fulfill({ status: 404, body: "" });
  });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForSelector(".win");
  return { p, ctx };
}

async function fermer({ p, ctx }) {
  // Les 404 des miniatures absentes de la maquette ne sont pas des erreurs de l'application.
  erreursConsole.push(...p.__erreurs.filter((e) => !/404|Failed to load resource/.test(e)));
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

async function capturer(p, nom, clip) {
  const fichier = `maquette-${nom}.png`;
  await p.screenshot({ path: join(sortie, fichier), clip });
  const a = await a11y(p);
  captures.push({ fichier, sansNom: a.sansNom.length, orphelins: a.orphelins.length, detail: [...a.sansNom, ...a.orphelins].slice(0, 3) });
}

async function essai(nom, f) {
  const t0 = Date.now();
  try {
    const detail = await f();
    essais.push({ nom, ok: detail?.ok !== false, detail, ms: Date.now() - t0 });
  } catch (e) {
    essais.push({ nom, ok: false, detail: String(e?.stack || e).slice(0, 600), ms: Date.now() - t0 });
  }
}

const aller = async (p, section) => { await p.locator(`a[data-section="${section}"]`).click(); await p.waitForTimeout(320); };
// Nocturne : les grandes vignettes peuvent être sous la ligne de flottaison : on les amène à l'écran d'abord, puis on
// laisse passer l'événement de défilement (un menu ouvert se ferme au défilement).
const centre = async (loc) => { await loc.scrollIntoViewIfNeeded(); await loc.page().waitForTimeout(120); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const carte = (p, c) => p.locator(`.mcard[data-media="${H(c)}"]`);
/** Démarre un glisser natif simulé depuis une carte : bouton tenu, 10 px de déplacement (seuil 6 px). */
async function glisserCarte(p, c) {
  // Saisie sur la miniature, comme un utilisateur (le bouton de lecture central compris).
  const { x, y } = await centre(carte(p, c).locator(".thumb"));
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + 4, y + 2);
  await p.mouse.move(x + 10, y + 4);
  await p.waitForFunction(() => window.__maquette.flux.glisser() !== null, null, { timeout: 2000 });
  await p.mouse.up();
  return p.evaluate(() => window.__maquette.flux.glisser());
}
const dockEtat = (p) => p.evaluate(() => { const d = document.querySelector(".dock"); return d ? { etat: d.dataset.etat, envoi: d.dataset.envoi ?? null, zone: d.dataset.zone ?? null, titre: d.querySelector(".dock-titre")?.textContent, sous: d.querySelector(".dock-sous")?.textContent ?? null } : null; });
async function attendreDock(p, etat, ms = 4000) {
  await p.waitForFunction((e) => document.querySelector(".dock")?.dataset.etat === e, etat, { timeout: ms });
  return dockEtat(p);
}

/** Glisser une carte jusqu'au dock et la déposer (événements Tauri simulés en coordonnées CSS). */
async function deposerSurDock(p, { attendre = "reussie", capturesEtapes = null } = {}) {
  await aller(p, "bibliotheque");
  const g = await glisserCarte(p, "2");
  await p.waitForSelector(".dock");
  const loin = { x: 300, y: 300 };
  await p.evaluate(([c, x, y]) => window.__maquette.flux.entrer(c, x, y), [g.chemins, loin.x, loin.y]);
  await p.waitForTimeout(80);
  const revelee = await dockEtat(p);
  if (capturesEtapes) await capturer(p, `${capturesEtapes}-revelee`);
  const { x, y, b } = await centre(p.locator(".dock"));
  await p.evaluate(([px, py]) => window.__maquette.flux.survoler(px, py), [x, b.y - 30]);
  await p.waitForTimeout(80);
  const proche = await p.evaluate(() => document.querySelector(".dock")?.hasAttribute("data-proche"));
  if (capturesEtapes) await capturer(p, `${capturesEtapes}-proche`);
  await p.evaluate(([px, py]) => window.__maquette.flux.survoler(px, py), [x, y]);
  await p.waitForTimeout(120);
  const survolee = await dockEtat(p);
  if (capturesEtapes) await capturer(p, `${capturesEtapes}-survolee`);
  await p.evaluate(([c, px, py]) => window.__maquette.flux.deposer(c, px, py), [g.chemins, x, y]);
  const enCours = await attendreDock(p, "en-cours", 1500).catch(() => null);
  if (capturesEtapes && enCours) await capturer(p, `${capturesEtapes}-en-cours`);
  const fin = attendre ? await attendreDock(p, attendre, 5000) : null;
  return { revelee, proche, survolee, enCours, fin };
}

// ======================================================================================================================
// 1. Bibliothèque : survol, lumière de bord, case, sélection multiple, menu contextuel (pointeur et clavier)
// ======================================================================================================================
await essai("survol d'une carte : montée de 2 px, lumière de bord, actions rapides", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  const { x, y } = await centre(carte(s.p, "2").locator(".thumb"));
  await s.p.mouse.move(x - 40, y - 10);
  await s.p.mouse.move(x + 30, y - 20, { steps: 4 });
  await s.p.waitForTimeout(450);
  const r = await carte(s.p, "2").evaluate((el) => ({ transform: getComputedStyle(el).transform, lumiere: getComputedStyle(el.querySelector(".mcard-lumiere")).opacity, mx: el.querySelector(".mcard-lumiere").style.getPropertyValue("--mx"), barre: getComputedStyle(el.querySelector(".hoverbar")).opacity }));
  await capturer(s.p, "biblio-survol-lumiere");
  await fermer(s);
  return { ok: r.transform.includes("-2") && r.lumiere === "1" && r.mx !== "" && r.barre === "1", ...r };
});

await essai("case de sélection et barre de sélection multiple", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  for (const c of ["2", "3", "8"]) {
    await carte(s.p, c).hover();
    await carte(s.p, c).locator(".mcard-case").click();
  }
  await s.p.mouse.move(5, 400);
  await s.p.waitForTimeout(400);
  const r = await s.p.evaluate(() => ({ choisis: document.querySelectorAll('.mcard[aria-selected="true"]').length, barre: document.querySelector(".barre-selection")?.textContent, apercu: !!document.querySelector(".pv") }));
  await capturer(s.p, "biblio-selection-multiple");
  // Menu d'une sélection : « Importer 3 médias dans Premiere », « Copier 3 chemins », « Tout désélectionner ».
  const { x, y } = await centre(carte(s.p, "3"));
  await s.p.mouse.click(x, y, { button: "right" });
  await s.p.waitForSelector(".menu--flottant");
  const menu = await s.p.evaluate(() => ({ libelle: document.querySelector(".menu--flottant").getAttribute("aria-label"), items: [...document.querySelectorAll(".menu--flottant [role=menuitem]")].map((e) => e.textContent) }));
  await capturer(s.p, "menu-selection-multiple");
  await fermer(s);
  return { ok: r.choisis === 3 && /3\s*sélectionnés/.test(r.barre ?? "") && !r.apercu && menu.items[0].startsWith("Importer 3 médias"), ...r, menu };
});

await essai("menu contextuel sous le pointeur (clic droit)", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  const { x, y } = await centre(carte(s.p, "8"));
  await s.p.mouse.click(x + 20, y + 10, { button: "right" });
  await s.p.waitForSelector(".menu--flottant");
  await s.p.waitForTimeout(200);
  const r = await s.p.evaluate(() => {
    const m = document.querySelector(".menu--flottant");
    const b = m.getBoundingClientRect();
    return { x: b.left, y: b.top, largeur: b.width, hauteur: b.height, origine: m.style.transformOrigin, libelle: m.getAttribute("aria-label"), actif: m.getAttribute("aria-activedescendant"), entete: m.querySelector(".menu-entete-meta")?.textContent, items: [...m.querySelectorAll("[role=menuitem]")].map((e) => e.textContent), raccourcis: [...m.querySelectorAll("[aria-keyshortcuts]")].map((e) => e.getAttribute("aria-keyshortcuts")) };
  });
  await capturer(s.p, "menu-sous-pointeur");
  await fermer(s);
  const dx = Math.abs(r.x - (x + 22));
  const dy = Math.abs(r.y - (y + 12));
  // Sous le pointeur (+2, +2), ou retourné à gauche s'il déborde (bord droit à x − 2).
  const retourne = r.origine.includes("right");
  const ecart = retourne ? Math.abs(r.x + r.largeur - (x + 18)) : dx;
  const ecartY = r.origine.includes("bottom") ? Math.abs(r.y + r.hauteur - (y + 8)) : dy;
  return { ok: ecart < 2 && ecartY < 2 && r.actif?.endsWith("-apercu") && r.libelle?.includes("AETHRYON Tools"), ecart, retourne, dy, ...r };
});

await essai("menu contextuel au clavier : Maj F10, éléments désactivés sautés, Début/Fin, lettre, Échap rend le focus", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  // « Le Passage » est en cours : Prévisualiser, Ouvrir et Importer sont désactivés.
  await carte(s.p, "1").focus();
  await s.p.keyboard.press("Shift+F10");
  await s.p.waitForSelector(".menu--flottant");
  const lire = () => s.p.evaluate(() => { const m = document.querySelector(".menu--flottant"); const a = m?.getAttribute("aria-activedescendant"); return { actif: a ? document.getElementById(a)?.querySelector(".mi-lbl")?.textContent : null, focus: document.activeElement === m, instantane: m?.classList.contains("menu--instantane"), anim: m ? getComputedStyle(m).animationName : null }; });
  const initial = await lire();
  await capturer(s.p, "menu-clavier-desactives");
  await s.p.keyboard.press("ArrowDown"); const bas = await lire();
  await s.p.keyboard.press("ArrowDown"); const boucle = await lire();
  await s.p.keyboard.press("End"); const fin = await lire();
  await s.p.keyboard.press("Home"); const debut = await lire();
  await s.p.keyboard.press("c"); const lettre = await lire();
  await s.p.keyboard.press("Escape");
  await s.p.waitForTimeout(100);
  const apres = await s.p.evaluate(() => ({ ouvert: !!document.querySelector(".menu--flottant"), focus: document.activeElement?.getAttribute("data-media") }));
  // Entrée exécute : « Copier le chemin » (lettre c) sur une carte disponible.
  await carte(s.p, "2").focus();
  await s.p.keyboard.press("ContextMenu");
  await s.p.waitForSelector(".menu--flottant");
  const initial2 = await lire();
  await s.p.keyboard.press("c");
  await s.p.keyboard.press("Enter");
  await s.p.waitForTimeout(250);
  const toast = await s.p.evaluate(() => document.querySelector(".toast .tt")?.textContent);
  await fermer(s);
  // Nocturne : « Détails » (panneau de détails) termine le menu d'un média.
  const ok = initial.actif === "Afficher dans l'Explorateur" && initial.instantane && initial.anim === "none" && bas.actif === "Copier le chemin" && boucle.actif === "Détails"
    && fin.actif === "Détails" && debut.actif === "Afficher dans l'Explorateur" && lettre.actif === "Copier le chemin" && !apres.ouvert && apres.focus === H("1")
    && initial2.actif === "Prévisualiser" && /Chemin copié|Copie impossible/.test(toast ?? "");
  return { ok, initial, bas, boucle, fin, debut, lettre, apres, initial2, toast };
});

// ======================================================================================================================
// 2. Dock « Envoyer vers Premiere Pro » : états révélée, proche, survolée, en cours, et les cinq états réels d'un envoi
// ======================================================================================================================
await essai("envoi vers Premiere : envoyé puis IMPORTÉ (réponse du panneau)", async () => {
  const s = await ouvrir({ delaiPanneau: 1400 });
  const r = await deposerSurDock(s.p, { capturesEtapes: "dock", attendre: null });
  const fin = await attendreDock(s.p, "reussie", 4000);
  await s.p.waitForTimeout(60);
  await capturer(s.p, "dock-reussie");
  const niche = await s.p.evaluate(() => ({ etat: document.querySelector(".niche")?.dataset.etat, texte: document.querySelector(".niche-texte")?.textContent }));
  await capturer(s.p, "niche-success", { x: 0, y: 380, width: 232, height: 420 });
  const source = await s.p.evaluate(() => document.querySelectorAll('[data-glisser="source"]').length);
  await s.p.waitForTimeout(1800);
  const cache = await dockEtat(s.p);
  await fermer(s);
  return { ok: r.revelee?.etat === "revelee" && r.proche && r.survolee?.etat === "survolee" && r.survolee.zone === "premiere" && r.enCours?.envoi === "envoye" && fin.envoi === "importe" && niche.etat === "success" && source === 0 && cache === null, ...r, fin, niche, cache };
});

for (const [nom, scenario, attendu] of [
  ["échec (Aucun projet ouvert, réponse du panneau)", { envoiEchec: true, delaiPanneau: 300 }, "echec"],
  ["non connecté (battement de plus de 15 s : rien n'est envoyé)", { premiereDeconnecte: true }, "non-connecte"],
  ["expiré (2 minutes sans réponse)", { envoiExpire: true, delaiPanneau: 300 }, "expire"],
]) {
  await essai(`envoi vers Premiere : ${nom}`, async () => {
    const s = await ouvrir(scenario);
    const r = await deposerSurDock(s.p, { attendre: "echec" });
    await capturer(s.p, `dock-${attendu}`);
    const niche = await s.p.evaluate(() => document.querySelector(".niche")?.dataset.etat);
    await fermer(s);
    return { ok: r.fin.envoi === attendu && niche === "error", fin: r.fin, niche };
  });
}

await essai("dock invalide : aucun projet ouvert (le dépôt n'envoie rien)", async () => {
  const s = await ouvrir({}, { avant: () => { window.__maquette.etat.liaison.panneau.projetOuvert = false; } });
  await aller(s.p, "bibliotheque");
  const g = await glisserCarte(s.p, "2");
  await s.p.waitForSelector(".dock");
  const { x, y } = await centre(s.p.locator(".dock"));
  await s.p.evaluate(([c, px, py]) => { window.__maquette.flux.entrer(c, px, py); window.__maquette.flux.survoler(px, py); }, [g.chemins, x, y]);
  await s.p.waitForTimeout(150);
  const d = await dockEtat(s.p);
  await capturer(s.p, "dock-invalide-sans-projet");
  await s.p.evaluate(([c, px, py]) => window.__maquette.flux.deposer(c, px, py), [g.chemins, x, y]);
  await s.p.waitForTimeout(500);
  const envois = await s.p.evaluate(() => window.__maquette.appels.filter((a) => a === "envoyer_vers_premiere").length);
  await fermer(s);
  return { ok: d.etat === "invalide" && d.titre === "Aucun projet ouvert" && d.zone === null && envois === 0, d, envois };
});

await essai("dock invalide : panneau non connecté (horloge ambre)", async () => {
  const s = await ouvrir({}, { avant: () => { window.__maquette.etat.liaison.connecte = false; } });
  await aller(s.p, "bibliotheque");
  await glisserCarte(s.p, "2");
  await s.p.waitForSelector(".dock");
  await s.p.waitForTimeout(250);
  const d = await dockEtat(s.p);
  await capturer(s.p, "dock-invalide-panneau-ferme");
  await s.p.evaluate(() => window.__maquette.flux.relacher());
  await fermer(s);
  return { ok: d.etat === "invalide" && /pas connecté/.test(d.titre), d };
});

await essai("glisser hors de la fenêtre (vers une autre application) : aucune conclusion inventée", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  await glisserCarte(s.p, "8");
  const source = await s.p.evaluate(() => document.querySelector(`.mcard[data-media="${"8".repeat(40)}"]`).dataset.glisser);
  await capturer(s.p, "glisser-source");
  await s.p.evaluate(() => window.__maquette.flux.deposerAilleurs("Adobe Premiere Pro.exe"));
  await s.p.waitForTimeout(500);
  const r = await s.p.evaluate(() => ({ dock: !!document.querySelector(".dock"), source: document.querySelectorAll('[data-glisser="source"]').length, toasts: [...document.querySelectorAll(".toast .tt")].map((t) => t.textContent) }));
  await fermer(s);
  return { ok: source === "source" && !r.dock && r.source === 0 && !r.toasts.some((t) => /Importé/.test(t)), source, ...r };
});

// ======================================================================================================================
// 3. Fichiers externes : calque d'ajout, import avec progression RÉELLE et annulation, refus, dossier à surveiller
// ======================================================================================================================
const EXTERNES = ["C:\\Users\\Élodie\\Desktop\\Plage au matin.mp4", "C:\\Users\\Élodie\\Desktop\\Ville la nuit.mov", "C:\\Users\\Élodie\\Desktop\\Vagues.mp3"];
await essai("calque d'ajout puis import avec progression, emplacements réservés, Nouveau, Success", async () => {
  const s = await ouvrir({ importLent: true });
  await aller(s.p, "bibliotheque");
  await s.p.evaluate((c) => window.__maquette.flux.entrer(c, 640, 400), EXTERNES);
  await s.p.waitForSelector(".calque-depot");
  await s.p.evaluate(() => window.__maquette.flux.survoler(650, 410));
  await s.p.waitForTimeout(200);
  const calque = await s.p.evaluate(() => ({ titre: document.querySelector(".calque-titre")?.textContent, sous: document.querySelector(".calque-sous")?.textContent, nombre: document.querySelector(".calque-nombre")?.textContent, curieuse: document.querySelector(".calque-depot .companion")?.dataset.etat, nicheMasquee: document.querySelector(".niche-boite")?.hasAttribute("data-masquee") }));
  await capturer(s.p, "calque-ajout");
  await s.p.evaluate((c) => window.__maquette.flux.deposer(c, 650, 410), EXTERNES);
  await s.p.waitForSelector(".plateau .op[data-op=import]");
  await s.p.waitForTimeout(700);
  const pendant = await s.p.evaluate(() => ({ emplacements: document.querySelectorAll(".emplacement").length, pct: document.querySelector(".plateau .progress")?.getAttribute("aria-valuenow"), detail: document.querySelector(".op-detail")?.textContent, niche: document.querySelector(".niche-texte")?.textContent }));
  await capturer(s.p, "import-progression-emplacements");
  await s.p.waitForFunction(() => /fichiers? copiés?/.test([...document.querySelectorAll(".toast .tt")].map((t) => t.textContent).join("|")), null, { timeout: 12000 });
  await s.p.waitForTimeout(200);
  const apres = await s.p.evaluate(() => ({ nouveaux: document.querySelectorAll(".point-nouveau").length, niche: document.querySelector(".niche")?.dataset.etat, nicheTexte: document.querySelector(".niche-texte")?.textContent, toast: [...document.querySelectorAll(".toast .tt")].map((t) => t.textContent) }));
  await capturer(s.p, "import-termine-nouveau");
  await fermer(s);
  return { ok: /Déposez pour ajouter/.test(calque.titre) && /3\s*fichiers/.test(calque.nombre ?? "") && calque.curieuse === "curious" && calque.nicheMasquee && pendant.emplacements >= 1 && Number(pendant.pct) > 0 && apres.nouveaux >= 1, calque, pendant, apres };
});

await essai("import : annulation (aucun fichier partiel)", async () => {
  const s = await ouvrir({ importLent: true });
  await aller(s.p, "bibliotheque");
  await s.p.evaluate((c) => { window.__maquette.flux.entrer(c, 640, 400); }, EXTERNES);
  await s.p.waitForSelector(".calque-depot");
  await s.p.evaluate((c) => window.__maquette.flux.deposer(c, 640, 400), EXTERNES);
  await s.p.waitForSelector(".plateau .op[data-op=import] button");
  await s.p.waitForTimeout(500);
  await s.p.locator(".plateau .op[data-op=import] button", { hasText: "Annuler" }).click();
  await s.p.waitForFunction(() => [...document.querySelectorAll(".toast .tt")].some((t) => /annulé|copié/.test(t.textContent)), null, { timeout: 8000 });
  await s.p.waitForTimeout(700);
  const r = await s.p.evaluate(() => ({ toasts: [...document.querySelectorAll(".toast .tt")].map((t) => t.textContent), reste: [...document.querySelectorAll(".mcard.is-arrivee, .emplacement")].filter((c) => /Plage au matin|Ville la nuit|Vagues/.test(c.textContent)).length, appels: window.__maquette.appels.filter((a) => a === "importer_annuler").length }));
  await capturer(s.p, "import-annule");
  await fermer(s);
  return { ok: r.appels === 1 && r.reste === 0, ...r };
});

await essai("dépôt invalide (type non pris en charge) : refus dit, rien de copié", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  const c = ["C:\\Users\\Élodie\\Desktop\\notes.txt"];
  await s.p.evaluate((c) => window.__maquette.flux.entrer(c, 640, 400), c);
  await s.p.waitForSelector(".calque-depot");
  await s.p.evaluate(() => window.__maquette.flux.survoler(660, 420));
  await s.p.waitForTimeout(200);
  const refus = await s.p.evaluate(() => ({ attr: document.querySelector(".calque-depot")?.hasAttribute("data-refus"), sous: document.querySelector(".calque-sous")?.textContent }));
  await capturer(s.p, "calque-refus");
  await s.p.evaluate((c) => window.__maquette.flux.deposer(c, 660, 420), c);
  await s.p.waitForTimeout(400);
  const r = await s.p.evaluate(() => ({ toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent), imports: window.__maquette.appels.filter((a) => a === "importer_fichiers").length }));
  await fermer(s);
  return { ok: refus.attr && /non pris en charge/.test(refus.sous) && r.imports === 0 && r.toasts.some((t) => /Dépôt refusé/.test(t)), refus, ...r };
});

await essai("dossier déposé : « Surveiller ce dossier » (jamais copié)", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  const c = ["D:\\Rushes\\Plage"];
  await s.p.evaluate((c) => window.__maquette.flux.entrer(c, 640, 400), c);
  await s.p.waitForSelector(".calque-depot");
  await s.p.waitForTimeout(150);
  const titre = await s.p.evaluate(() => document.querySelector(".calque-titre")?.textContent);
  await s.p.evaluate((c) => window.__maquette.flux.deposer(c, 640, 400), c);
  await s.p.waitForSelector(".op[data-op=surveiller]");
  await capturer(s.p, "surveiller-dossier");
  await s.p.locator(".op[data-op=surveiller] button", { hasText: "Surveiller ce dossier" }).click();
  await s.p.waitForSelector('.op[data-op=surveiller][data-etat="acceptee"]');
  const r = await s.p.evaluate(() => ({ appels: window.__maquette.appels.filter((a) => a === "dossier_ajouter").length, copies: window.__maquette.appels.filter((a) => a === "importer_fichiers").length, texte: document.querySelector(".op[data-op=surveiller] .op-titre")?.textContent }));
  await fermer(s);
  return { ok: /surveiller ce dossier/.test(titre) && r.appels === 1 && r.copies === 0, titre, ...r };
});

await essai("zone secondaire : l'élément « Transferts » de la navigation accepte les fichiers", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  const { x, y } = await centre(s.p.locator('a[data-section="transferts"]'));
  await s.p.evaluate(([c, px, py]) => { window.__maquette.flux.entrer(c, px, py); window.__maquette.flux.survoler(px, py); }, [EXTERNES.slice(0, 1), x, y]);
  await s.p.waitForTimeout(200);
  const etat = await s.p.evaluate(() => document.querySelector('a[data-section="transferts"]').dataset.fluxEtat);
  await capturer(s.p, "nav-transferts-zone");
  await s.p.evaluate(([c, px, py]) => window.__maquette.flux.deposer(c, px, py), [EXTERNES.slice(0, 1), x, y]);
  await s.p.waitForTimeout(400);
  const imports = await s.p.evaluate(() => window.__maquette.appels.filter((a) => a === "importer_fichiers").length);
  await fermer(s);
  return { ok: etat === "accepte" && imports === 1, etat, imports };
});

// ======================================================================================================================
// 4. Transferts en pipeline, niche, présence, astuce
// ======================================================================================================================
await essai("transferts en pipeline (attente, conversion, téléchargement, prêt, erreur)", async () => {
  const s = await ouvrir();
  await aller(s.p, "transferts");
  await s.p.waitForTimeout(300);
  const r = await s.p.evaluate(() => [...document.querySelectorAll(".pipeline")].map((p) => ({ aria: p.getAttribute("aria-label"), etats: [...p.querySelectorAll(".pn")].map((n) => n.dataset.etat).join(",") })));
  const bandeau = await s.p.evaluate(() => document.querySelector(".xf-bandeau")?.textContent);
  await capturer(s.p, "transferts-pipeline");
  // Le téléchargement « Le Passage » échoue PENDANT la session : l'erreur se place sur son nœud.
  await s.p.evaluate(() => window.__maquette.modifier((e) => { const t = e.transferts.find((x) => x.id === "passage"); t.etat = "erreur"; t.erreur = "Connexion interrompue à 64 %"; }));
  await s.p.waitForTimeout(500);
  const erreur = await s.p.evaluate(() => [...document.querySelectorAll(".xf")].find((x) => x.dataset.transfert === "passage")?.querySelector(".pipeline")?.getAttribute("aria-label"));
  const niche = await s.p.evaluate(() => ({ etat: document.querySelector(".niche")?.dataset.etat, texte: document.querySelector(".niche-texte")?.textContent }));
  await capturer(s.p, "transferts-erreur-sur-noeud");
  await fermer(s);
  // Nocturne-2 : l'historique est compact (étapes montrées pour les transferts actifs et interrompus) : 3 au moins.
  return { ok: r.length >= 3 && r.some((x) => x.etats === "fait,attente,a-venir,a-venir,a-venir") && r.some((x) => x.etats.startsWith("fait,fait,en-cours")) && !!bandeau && /Téléchargement/.test(erreur ?? "") && niche.etat === "error", r, bandeau, erreur, niche };
});

await essai("niche : Idle, Processing, Curious ; menu contextuel d'un transfert", async () => {
  const s = await ouvrir({ vide: true });
  await s.p.waitForTimeout(300);
  const idle = await s.p.evaluate(() => ({ etat: document.querySelector(".niche")?.dataset.etat, texte: document.querySelector(".niche-texte")?.textContent, role: document.querySelector(".niche-texte")?.getAttribute("role") }));
  await capturer(s.p, "niche-idle", { x: 0, y: 380, width: 232, height: 420 });
  await aller(s.p, "transferts");
  const vide = await s.p.evaluate(() => ({ titre: document.querySelector(".vide h2")?.textContent, chouette: !!document.querySelector(".vide .companion"), nicheMasquee: document.querySelector(".niche-boite")?.hasAttribute("data-masquee") }));
  await capturer(s.p, "transferts-vide");
  await fermer(s);
  const t = await ouvrir();
  await t.p.waitForTimeout(300);
  const processing = await t.p.evaluate(() => ({ etat: document.querySelector(".niche")?.dataset.etat, texte: document.querySelector(".niche-texte")?.textContent }));
  await capturer(t.p, "niche-processing", { x: 0, y: 380, width: 232, height: 420 });
  await aller(t.p, "accueil");
  await t.p.evaluate(() => { window.__maquette.flux.entrer(["C:\\x\\a.mp4"], 20, 30); });
  await t.p.waitForTimeout(150);
  const curious = await t.p.evaluate(() => document.querySelector(".companion")?.dataset.etat);
  await t.p.evaluate(() => window.__maquette.flux.sortir());
  await aller(t.p, "transferts");
  const ligne = t.p.locator(".xf").filter({ hasText: "Coucher de soleil sur la côte" }).first();
  await ligne.focus();
  await t.p.keyboard.press("Shift+F10");
  await t.p.waitForSelector(".menu--flottant");
  const items = await t.p.evaluate(() => [...document.querySelectorAll(".menu--flottant [role=menuitem]")].map((e) => e.textContent));
  await capturer(t.p, "transferts-menu");
  await fermer(t);
  return { ok: idle.etat === "idle" && /Tout est calme/.test(idle.texte) && idle.role === "status" && vide.chouette && vide.nicheMasquee && processing.etat === "processing" && /transferts? en cours|Import demandé/.test(processing.texte) && items.includes("Ouvrir le journal"), idle, vide, processing, curious, items };
});

await essai("Paramètres › Présence de la chouette (Discrète par défaut), astuce en Expressive", async () => {
  // Rien en cours (sinon Processing passe avant l'astuce, priorité du §B.6).
  const s = await ouvrir({}, { avant: () => { const e = window.__maquette.etat; e.transferts = e.transferts.filter((t) => t.etat === "pret" || t.etat === "erreur"); for (const m of e.index.medias) if (m.etat === "en-cours") m.etat = "disponible"; } });
  await aller(s.p, "parametres");
  const defaut = await s.p.evaluate(() => ({ choix: document.querySelector('[data-reglage="presence"] [aria-pressed="true"]')?.textContent, phrase: document.querySelector('[data-reglage="presence"] .rd--choix')?.textContent }));
  await s.p.locator('[data-reglage="presence"] button', { hasText: "Expressive" }).click();
  await s.p.waitForTimeout(250);
  await capturer(s.p, "parametres-presence");
  const stocke = await s.p.evaluate(() => localStorage.getItem("aethryon.chouette"));
  // Trois imports d'un seul média en moins de 60 s → astuce « Ctrl + clic ».
  await aller(s.p, "bibliotheque");
  for (const c of ["2", "3", "8"]) { await carte(s.p, c).focus(); await s.p.keyboard.press("Control+i"); await s.p.waitForTimeout(120); }
  await s.p.waitForTimeout(4200);
  const astuce = await s.p.evaluate(() => document.querySelector(".astuce p")?.textContent ?? null);
  if (astuce) await capturer(s.p, "niche-astuce", { x: 0, y: 300, width: 520, height: 500 });
  await s.p.locator('a[data-section="parametres"]').click();
  await s.p.waitForTimeout(300);
  await s.p.locator('[data-reglage="presence"] button', { hasText: "Muette" }).click();
  await s.p.waitForTimeout(200);
  const muette = await s.p.evaluate(() => ({ anime: document.querySelector(".niche .companion")?.hasAttribute("data-anime"), phrase: document.querySelector('[data-reglage="presence"] .rd--choix')?.textContent }));
  await fermer(s);
  return { ok: defaut.choix === "Discrète" && stocke === "expressive" && !!astuce && muette.anime === false, defaut, stocke, astuce, muette };
});

// ======================================================================================================================
// 5. Mouvement réduit (système et réglage), thème clair, 900 × 640
// ======================================================================================================================
await essai("mouvement réduit du SYSTÈME : rayures fixes pleine largeur et « en cours » (corrige D5)", async () => {
  // Un téléchargement du NAVIGATEUR (taille finale inconnue) : progression indéterminée.
  const s = await ouvrir({}, { reduit: true, avant: () => { const e = window.__maquette.etat; const m = structuredClone(e.index.medias[1]); Object.assign(m, { id: "d".repeat(40), nom: "Interview brute", chemin: e.config.dossierMedias + "\\Interview brute.mp4", etat: "en-cours", miniature: null, taille: 52428800 }); e.index.medias.unshift(m); } });
  await aller(s.p, "transferts");
  await s.p.waitForTimeout(300);
  const r = await s.p.evaluate(() => {
    const i = document.querySelector(".pc > i.comete");
    const cs = i ? getComputedStyle(i) : null;
    return { trouve: !!i, comete: !!document.querySelector(".pc > i.comete"), transform: cs?.transform, anim: cs?.animationName, fond: cs?.backgroundImage?.slice(0, 40), largeur: i ? Math.round(i.getBoundingClientRect().width) : 0, parent: i ? Math.round(i.parentElement.getBoundingClientRect().width) : 0, texte: [...document.querySelectorAll(".indet-txt")].filter((e) => getComputedStyle(e).display !== "none").length };
  });
  await capturer(s.p, "mouvement-reduit-transferts");
  await aller(s.p, "bibliotheque");
  await s.p.waitForTimeout(250);
  const runline = await s.p.evaluate(() => { const i = document.querySelector(".runline > i.indet"); if (!i) return null; const cs = getComputedStyle(i); return { transform: cs.transform, largeur: Math.round(i.getBoundingClientRect().width), parent: Math.round(i.parentElement.getBoundingClientRect().width), fond: cs.backgroundImage.slice(0, 30) }; });
  const g = await glisserCarte(s.p, "2");
  const { x, y } = await centre(s.p.locator(".dock"));
  await s.p.evaluate(([c, px, py]) => { window.__maquette.flux.entrer(c, px, py); window.__maquette.flux.survoler(px, py); }, [g.chemins, x, y]);
  await s.p.waitForTimeout(200);
  const dock = await s.p.evaluate(() => getComputedStyle(document.querySelector(".dock")).transform);
  await capturer(s.p, "mouvement-reduit-dock");
  await fermer(s);
  return { ok: r.trouve && r.anim === "none" && r.transform === "none" && /repeating-linear/.test(r.fond) && r.largeur === r.parent && (!r.comete || r.texte > 0) && (!runline || (runline.transform === "none" && runline.largeur === runline.parent)) && dock === "none", r, runline, dock };
});

await essai("réglage « Réduire les animations : Oui » (sans réglage système)", async () => {
  const s = await ouvrir({}, { avant: () => { window.__maquette.etat.config.reduireAnimations = "oui"; } });
  await s.p.waitForTimeout(250);
  const r = await s.p.evaluate(() => ({ motion: document.documentElement.dataset.motion, anime: document.querySelector(".niche .companion")?.hasAttribute("data-anime") }));
  await fermer(s);
  return { ok: r.motion === "reduced" && r.anime === false, ...r };
});

await essai("thème clair : dock et menu sur #FFFDF9", async () => {
  const s = await ouvrir({ theme: "clair" }, { theme: "light", avant: () => { window.__maquette.etat.config.theme = "clair"; } });
  await aller(s.p, "bibliotheque");
  const g = await glisserCarte(s.p, "2");
  await s.p.evaluate(([c]) => window.__maquette.flux.entrer(c, 300, 300), [g.chemins]);
  await s.p.waitForTimeout(400);
  const fond = await s.p.evaluate(() => getComputedStyle(document.querySelector(".dock")).backgroundColor);
  await capturer(s.p, "theme-clair-dock");
  await s.p.evaluate(() => window.__maquette.flux.relacher());
  await s.p.waitForTimeout(300);
  const { x, y } = await centre(carte(s.p, "3"));
  await s.p.mouse.click(x, y, { button: "right" });
  await s.p.waitForSelector(".menu--flottant");
  await s.p.waitForTimeout(200);
  await capturer(s.p, "theme-clair-menu");
  await fermer(s);
  return { ok: /255, 253, 249/.test(fond), fond };
});

await essai("fenêtre de 900 × 640 : dock de 300 px, calque à 12 px", async () => {
  const s = await ouvrir({}, { largeur: 900, hauteur: 640 });
  await aller(s.p, "bibliotheque");
  const g = await glisserCarte(s.p, "2");
  await s.p.evaluate(([c]) => window.__maquette.flux.entrer(c, 300, 300), [g.chemins]);
  await s.p.waitForTimeout(400);
  const dock = await s.p.evaluate(() => Math.round(document.querySelector(".dock").getBoundingClientRect().width));
  await capturer(s.p, "etroit-900x640-dock");
  await s.p.evaluate(() => window.__maquette.flux.relacher());
  await s.p.waitForTimeout(300);
  await s.p.evaluate((c) => window.__maquette.flux.entrer(c, 500, 300), EXTERNES);
  await s.p.waitForSelector(".calque-depot");
  await s.p.waitForTimeout(200);
  const marge = await s.p.evaluate(() => { const c = document.querySelector(".calque-depot").getBoundingClientRect(); const f = document.querySelector(".sheet").getBoundingClientRect(); return Math.round(c.left - f.left); });
  await capturer(s.p, "etroit-900x640-calque");
  await fermer(s);
  return { ok: dock === 300 && marge === 12, dock, marge };
});

// ======================================================================================================================
// 6. Performance : survol de 12 cartes, puis glisser simulé (survols à 120 Hz) et ouverture du dock
// ======================================================================================================================
await essai("performance : images par seconde pendant un glisser simulé (plancher headless)", async () => {
  const s = await ouvrir();
  await aller(s.p, "bibliotheque");
  await s.p.evaluate(() => {
    window.__perf = { images: [], longues: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longues.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false });
    let t0 = performance.now();
    const boucle = (t) => { window.__perf.images.push(t - t0); t0 = t; if (!window.__perf.fin) requestAnimationFrame(boucle); };
    requestAnimationFrame(boucle);
  });
  const cartes = await s.p.locator(".mcard").all();
  for (const c of cartes.slice(0, 12)) { const { x, y } = await centre(c); await s.p.mouse.move(x, y, { steps: 6 }); }
  const g = await glisserCarte(s.p, "2");
  const d = await centre(s.p.locator(".dock"));
  await s.p.evaluate(async ([c, dx, dy]) => {
    window.__maquette.flux.entrer(c, 100, 100);
    const n = 240; // 2 s à 120 Hz : diagonale de la grille puis le dock
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      window.__maquette.flux.survoler(100 + (dx - 100) * u, 100 + (dy - 100) * u);
      await new Promise((r) => setTimeout(r, 8));
    }
  }, [g.chemins, d.x, d.y]);
  const r = await s.p.evaluate(() => {
    window.__perf.fin = true;
    const im = window.__perf.images.slice(2).sort((a, b) => a - b);
    const q = (p) => im[Math.min(im.length - 1, Math.floor(p * im.length))];
    return { images: im.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +im[im.length - 1].toFixed(1), ips: +(1000 / q(0.5)).toFixed(1), longues: window.__perf.longues };
  });
  await s.p.evaluate(() => window.__maquette.flux.relacher());
  await fermer(s);
  return { ok: r.p95 <= 17.5 && !r.longues.some((x) => x > 50), ...r };
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
writeFileSync(join(sortie, "parcours-38.json"), JSON.stringify(bilan, null, 2));
for (const e of essais) console.log(`${e.ok ? "OK " : "ÉCHEC"} ${e.nom}${e.ok ? "" : ` → ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail).slice(0, 500)}`}`);
console.log(`${bilan.reussis}/${bilan.total} essais ; ${captures.length} captures ; accessibilité : ${bilan.a11y.sansNom} sans nom, ${bilan.a11y.orphelins} orphelins ; console : ${erreursConsole.length} erreur(s)`);
if (erreursConsole.length) console.log(erreursConsole.slice(0, 5).join("\n"));
process.exit(bilan.reussis === bilan.total && erreursConsole.length === 0 ? 0 : 1);
