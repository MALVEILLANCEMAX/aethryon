// Essais du socle Égide dans Chromium (Playwright), sous la CSP STRICTE du site (script-src 'self', style-src 'self').
//   node packages/design/tests/navigateur/essais.mjs [<dossier des captures>]
// Dépendances déjà présentes sur la machine (comme les essais de la démonstration) : playwright-core et axe-core,
// chemins par PLAYWRIGHT_CORE et AXE_PATH. Vérifie : aucune violation de CSP ni erreur de console, aucune requête
// externe ; valeurs calculées des six thèmes = moteur ; axe-core 0 violation sur les six thèmes ; démarrage SANS
// flash (thème posé avant que le module de la page ne s'exécute) ; éditeur (créer, appliquer, recharger, importer
// refusé, exporter copier + télécharger, tout réinitialiser + Annuler) ; racine Shadow DOM fermée face à une page
// hostile ; menu au clavier ; infobulle ; mouvement réduit ; téléphone 360 px sans débordement, marges de 16 px.
import { build } from "esbuild";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ICI = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(ICI, "..", "..");
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const AXE = readFileSync(process.env.AXE_PATH || require.resolve("axe-core/axe.min.js"), "utf8");
const { chromium } = require(PW);
const SORTIE = process.argv[2] || null;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });

const js = (await build({ entryPoints: [join(ICI, "galerie.ts")], bundle: true, write: false, format: "esm", target: "chrome120", minify: false })).outputFiles[0].text;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const FICHIERS = {
  "/": [join(ICI, "galerie.html"), "text/html; charset=utf-8"],
  "/galerie.css": [join(ICI, "galerie.css"), "text/css"],
  "/egide.css": [join(DESIGN, "genere/egide.css"), "text/css"],
  "/theme-boot.js": [join(DESIGN, "genere/theme-boot.js"), "text/javascript"],
  "/assets/aethryon-master.svg": [join(DESIGN, "assets/aethryon-master.svg"), "image/svg+xml"],
};
let retardModule = 0;
const srv = createServer((q, r) => {
  const chemin = decodeURIComponent(q.url.split("?")[0]);
  const envoyer = (corps, type) => { r.writeHead(200, { "Content-Type": type, "Content-Security-Policy": CSP, "Cache-Control": "no-store" }); r.end(corps); };
  if (chemin === "/galerie.js") return setTimeout(() => envoyer(js, "text/javascript"), retardModule);
  if (chemin.startsWith("/fonts/") && /^[a-z0-9.-]+\.woff2$/.test(chemin.slice(7)) && existsSync(join(DESIGN, chemin))) return envoyer(readFileSync(join(DESIGN, chemin)), "font/woff2");
  const f = FICHIERS[chemin];
  if (!f) { r.writeHead(404); return r.end(); }
  envoyer(readFileSync(f[0]), f[1]);
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${srv.address().port}/`;

const navigateur = await chromium.launch();
const R = { essais: [], themes: {}, erreurs: [], externes: [], violationsCsp: [] };
const echecs = [];
const verifier = (nom, ok, detail = "") => { R.essais.push({ nom, ok, detail }); if (!ok) echecs.push(`${nom}${detail ? " : " + detail : ""}`); console.log(`${ok ? "ok    " : "ÉCHEC "} ${nom}${detail ? " — " + detail : ""}`); };

async function ouvrir(ctx, url = BASE) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => R.erreurs.push(String(e).slice(0, 200)));
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) R.erreurs.push(m.text().slice(0, 200)); });
  await p.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await p.goto(url, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  return p;
}
async function contexte(options = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR", acceptDownloads: true, ...options });
  ctx.on("request", (q) => { if (!q.url().startsWith(BASE)) R.externes.push(q.url()); });
  return ctx;
}
// axe-core injecté par le protocole de débogage (évaluation directe) : la CSP de la page interdit un script en ligne.
const axe = async (p) => { if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(AXE); return p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)); };
const capture = async (p, nom, pleine = true) => { if (SORTIE) await p.screenshot({ path: join(SORTIE, `${nom}.png`), fullPage: pleine }); };

// ---- 1. Premier chargement : Obsidian, CSP, requêtes ----------------------------------------------------------
{
  const ctx = await contexte();
  const p = await ouvrir(ctx);
  const fond = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  verifier("premier chargement : Obsidian sans préférence (fond #101113)", fond === "rgb(16, 17, 19)", fond);
  // ---- 2. Les six thèmes : valeurs calculées = moteur, axe-core 0 violation ----------------------------------
  for (const t of ["obsidian", "ivory", "oled", "midnight", "minimal", "custom"]) {
    await p.click(`#g-themes button[data-valeur="${t}"]`);
    await p.mouse.move(2, 2);
    await p.waitForTimeout(450); // fin des transitions de couleur (160 ms) avant de mesurer
    const ecarts = await p.evaluate((t) => {
      const E = window.__egide, el = document.documentElement;
      const doc = t === "custom" ? null : E.docOfficiel(t);
      const r = doc ? E.resoudreTheme(doc) : null;
      const attendu = r ? E.variablesTheme(r).vars : Object.fromEntries([...el.style].filter((k) => k.startsWith("--eg-")).map((k) => [k, el.style.getPropertyValue(k)]));
      const cs = getComputedStyle(el);
      const ecarts = Object.entries(attendu).filter(([k, v]) => cs.getPropertyValue(k).trim().toUpperCase() !== String(v).toUpperCase()).map(([k, v]) => `${k}=${cs.getPropertyValue(k).trim()}≠${v}`);
      return { ecarts, theme: el.dataset.egTheme, n: Object.keys(attendu).length, enLigne: [...el.style].filter((k) => k.startsWith("--eg-")).length };
    }, t);
    const violations = await axe(p);
    R.themes[t] = { ...ecarts, axe: violations };
    verifier(`thème ${t} : variables calculées = moteur (${ecarts.n})${t === "custom" ? "" : ", aucune en ligne"}`, ecarts.theme === t && ecarts.ecarts.length === 0 && (t === "custom" || ecarts.enLigne === 0), ecarts.ecarts.slice(0, 3).join(" ; "));
    verifier(`thème ${t} : axe-core 0 violation (galerie complète, éditeur compris)`, violations.length === 0, violations.join(" | "));
    await capture(p, `galerie-1280-${t}`);
  }
  // ---- 3. Menu au clavier, infobulle, dialogue (focus rendu), toast ----------------------------------------------
  await p.click('#g-themes button[data-valeur="obsidian"]');
  await p.focus("#g-menu");
  await p.keyboard.press("ArrowDown");
  const premier = await p.evaluate(() => document.activeElement?.textContent);
  await p.keyboard.press("ArrowDown");
  const second = await p.evaluate(() => document.activeElement?.textContent);
  await p.keyboard.press("Escape");
  const apres = await p.evaluate(() => ({ focus: document.activeElement?.id, ferme: document.querySelector(".eg-menu:not([hidden])") === null, expanded: document.getElementById("g-menu")?.getAttribute("aria-expanded") }));
  verifier("menu : flèches, Échap ferme et rend le focus au déclencheur", premier?.includes("Ouvrir le dossier") && second?.includes("Copier le lien") && apres.focus === "g-menu" && apres.ferme && apres.expanded === "false", JSON.stringify({ premier, second, apres }));
  await p.focus("#g-dialogue");
  await p.keyboard.press("Enter");
  const ouvert = await p.evaluate(() => document.querySelector("dialog.eg-dialogue")?.open);
  await p.keyboard.press("Escape");
  const retour = await p.evaluate(() => document.activeElement?.id);
  verifier("dialogue : modal natif, Échap ferme, focus rendu", ouvert === true && retour === "g-dialogue", `${ouvert} ${retour}`);
  await p.focus("#g-dialogue");
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  await p.focus("#g-reglages");
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  const bulle = await p.evaluate(() => { const b = [...document.querySelectorAll(".eg-infobulle")].find((x) => !x.hidden); return b ? { texte: b.textContent, role: b.getAttribute("role") } : null; });
  verifier("infobulle : visible au focus clavier, role=tooltip", bulle?.texte === "Réglages" && bulle?.role === "tooltip", JSON.stringify(bulle));
  await p.click("#g-toast");
  const t = await p.evaluate(() => document.querySelector(".eg-toast")?.getAttribute("role"));
  verifier("toast : région « Notifications », role=status", t === "status");
  // ---- 4. Racine Shadow DOM fermée face à une page hostile ------------------------------------------------------
  const ombre = await p.evaluate(() => {
    const { enveloppe, appliquerTheme } = window.__egide;
    const cs = getComputedStyle(enveloppe);
    const avant = { couleur: cs.color, fond: cs.backgroundColor, police: cs.fontFamily, espacement: cs.letterSpacing, text: cs.getPropertyValue("--eg-c-text").trim() };
    appliquerTheme(enveloppe, "ivory");
    const ivory = getComputedStyle(enveloppe).backgroundColor;
    appliquerTheme(enveloppe, "obsidian");
    return { avant, ivory };
  });
  verifier("Shadow DOM : la page hôte n'entre pas (couleur, fond, police, interlettrage, variables)",
    ombre.avant.couleur === "rgb(238, 232, 220)" && ombre.avant.fond === "rgb(16, 17, 19)" && ombre.avant.police.startsWith('"Hanken Grotesk"') && ombre.avant.espacement === "normal" && ombre.avant.text.toUpperCase() === "#EEE8DC",
    JSON.stringify(ombre.avant));
  verifier("Shadow DOM : thème appliqué à la racine de l'ombre (Ivory)", ombre.ivory === "rgb(250, 248, 243)", ombre.ivory);
  // Menu dans l'ombre : un clic DANS le menu ne le ferme pas avant l'action ; un clic dehors le ferme.
  const host = await p.$("#g-hote");
  await host.scrollIntoViewIfNeeded();
  const boite = await host.boundingBox();
  await p.evaluate(() => window.__egide.ombre.getElementById("g-menu-ombre").click());
  const ouvertOmbre = await p.evaluate(() => !window.__egide.ombre.querySelector(".eg-menu").hidden);
  const item = await p.evaluate(() => { const r = window.__egide.ombre.querySelector('.eg-menu [role="menuitem"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(item.x, item.y);
  const choix = await p.evaluate(() => window.__choixOmbre ?? 0);
  await p.evaluate(() => window.__egide.ombre.getElementById("g-menu-ombre").click());
  await p.mouse.click(5, 5);
  const fermeDehors = await p.evaluate(() => window.__egide.ombre.querySelector(".eg-menu").hidden);
  verifier("Shadow DOM fermée : menu (clic dedans = action, clic dehors = fermé)", ouvertOmbre && choix === 1 && fermeDehors, JSON.stringify({ ouvertOmbre, choix, fermeDehors, boite: !!boite }));
  verifier("aucune violation de CSP", (await p.evaluate(() => window.__csp)).length === 0, (await p.evaluate(() => window.__csp)).join(" | "));
  await ctx.close();
}

// ---- 5. Éditeur : créer, appliquer, recharger SANS flash, importer refusé, exporter, réinitialiser ---------------
{
  const ctx = await contexte();
  const p = await ouvrir(ctx);
  const ed = "#g-editeur";
  await p.click(`${ed} [data-accent="#5E8FB8"]`);
  await p.focus(`${ed} input[data-cle="neutralHue"]`);
  for (let i = 0; i < 160; i++) await p.keyboard.press("ArrowRight"); // teinte des fonds : +160°
  await p.fill(`${ed} .eg-ed-nom-input`, "Égée (essai)");
  await p.click(`${ed} .eg-seg button[data-valeur="aeree"]`);
  const ctOk = await p.evaluate(() => document.querySelector("#g-editeur .eg-ed-ct-tete b")?.textContent);
  verifier("éditeur : 27 contrastes vérifiés à chaque geste", ctOk === "27 paires vérifiées, toutes conformes", ctOk);
  await p.click(`${ed} .eg-ed-pied .eg-btn--principal`);
  await p.waitForTimeout(300);
  const applique = await p.evaluate(() => ({ theme: document.documentElement.dataset.egTheme, accent: document.documentElement.style.getPropertyValue("--eg-c-accent"), stocke: JSON.parse(localStorage.getItem("aethryon.apparence.v1") || "{}") }));
  verifier("éditeur : « Appliquer » pose le thème sur toute la page et l'enregistre", applique.theme === "custom" && applique.accent === "#5E8FB8" && applique.stocke.perso?.name === "Égée (essai)", JSON.stringify({ t: applique.theme, a: applique.accent }));
  // Rechargement avec le module de la page RETARDÉ : seul theme-boot.js a pu agir.
  retardModule = 1500;
  await p.goto(BASE, { waitUntil: "commit" });
  // Document analysé, feuille chargée, module de la page PAS ENCORE exécuté (il retarde DOMContentLoaded).
  await p.waitForFunction(() => document.readyState === "interactive" && document.styleSheets.length >= 2 && !!document.body);
  if (SORTIE) await p.screenshot({ path: join(SORTIE, "demarrage-avant-module.png") });
  const sansFlash = await p.evaluate(() => {
    const hex = (c) => "#" + c.match(/\d+/g).slice(0, 3).map((x) => (+x).toString(16).padStart(2, "0")).join("").toUpperCase();
    const cache = JSON.parse(localStorage.getItem("aethryon.apparence.v1")).cache.vars;
    return { theme: document.documentElement.dataset.egTheme, accent: getComputedStyle(document.documentElement).getPropertyValue("--eg-c-accent").trim(),
      fond: hex(getComputedStyle(document.body).backgroundColor), fondAttendu: cache["--eg-c-canvas"], module: !!window.__egide };
  });
  retardModule = 0;
  verifier("démarrage sans flash : thème personnel posé AVANT le module de la page (theme-boot.js externe)", sansFlash.theme === "custom" && sansFlash.accent.toUpperCase() === "#5E8FB8" && !sansFlash.module && sansFlash.fond === sansFlash.fondAttendu, JSON.stringify(sansFlash));
  await p.waitForFunction(() => !!window.__egide);
  // Import refusé
  await p.click(`${ed} .eg-ed-pied button:has-text("Importer")`);
  await p.fill("dialog[open] textarea", JSON.stringify({ format: "aethryon-theme", schemaVersion: 1, id: "perso.x", name: "X", base: "obsidian", tokens: { "c-accent": "url(https://exemple.test/a)" } }));
  await p.click('dialog[open] button:has-text("Vérifier")');
  const refus = await p.evaluate(() => [...document.querySelectorAll("dialog[open] .eg-erreurs li")].map((li) => li.textContent));
  const toujours = await p.evaluate(() => document.documentElement.style.getPropertyValue("--eg-c-accent"));
  verifier("import d'un thème invalide : refusé avec la raison, rien d'appliqué", refus.some((x) => x.includes("#RRGGBB")) && toujours === "#5E8FB8", refus.join(" / "));
  await p.keyboard.press("Escape");
  const focusImport = await p.evaluate(() => document.activeElement?.textContent);
  verifier("import : Échap ferme, focus rendu au bouton « Importer »", focusImport?.includes("Importer"), focusImport);
  // Export : copier ET télécharger
  await p.click(`${ed} .eg-ed-pied button:has-text("Exporter")`);
  const texte = await p.evaluate(() => document.querySelector("dialog[open] textarea")?.value);
  const [telechargement] = await Promise.all([p.waitForEvent("download"), p.click('dialog[open] button:has-text("Télécharger")')]);
  const chemin = await telechargement.path();
  const fichier = readFileSync(chemin, "utf8");
  const boutonsExport = await p.evaluate(() => [...document.querySelectorAll("dialog[open] .eg-dialogue-pied button")].map((b) => b.textContent));
  verifier("export : texte copiable + fichier téléchargé identiques et valides", fichier === texte && JSON.parse(fichier).name === "Égée (essai)" && telechargement.suggestedFilename() === "egee-essai.aethryon-theme.json" && boutonsExport.some((b) => b.includes("Copier")),
    `${telechargement.suggestedFilename()} ${boutonsExport.join(",")}`);
  await p.keyboard.press("Escape");
  // Tout réinitialiser + Annuler
  await p.click(`${ed} .eg-ed-pied button:has-text("Tout réinitialiser")`);
  await p.waitForTimeout(250);
  const raz = await p.evaluate(() => ({ theme: document.documentElement.dataset.egTheme, stocke: localStorage.getItem("aethryon.apparence.v1") }));
  await p.click('.eg-toast button:has-text("Annuler")');
  await p.waitForTimeout(250);
  const annule = await p.evaluate(() => ({ theme: document.documentElement.dataset.egTheme, nom: JSON.parse(localStorage.getItem("aethryon.apparence.v1") || "{}").perso?.name }));
  verifier("« Tout réinitialiser » : Obsidian et préférence oubliée ; « Annuler » rend le thème", raz.theme === "obsidian" && raz.stocke === null && annule.theme === "custom" && annule.nom === "Égée (essai)", JSON.stringify({ raz, annule }));
  // Contraste en échec : « Appliquer » bloqué, « Corriger automatiquement » répare
  await p.click(`${ed} .eg-ed-precises summary`);
  await p.$eval(`${ed} input[data-token="c-text-3"]`, (i) => { i.value = "#2a2b30"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(300);
  const bloque = await p.evaluate(() => document.querySelector("#g-editeur .eg-ed-pied .eg-btn--principal")?.getAttribute("aria-disabled"));
  await p.click(`${ed} button:has-text("Corriger automatiquement")`);
  const corrige = await p.evaluate(() => ({ ct: document.querySelector("#g-editeur .eg-ed-ct-tete b")?.textContent, ok: document.querySelector("#g-editeur .eg-ed-pied .eg-btn--principal")?.getAttribute("aria-disabled") }));
  verifier("contraste retouché en échec : « Appliquer » bloqué, « Corriger automatiquement » répare", bloque === "true" && corrige.ct === "27 paires vérifiées, toutes conformes" && corrige.ok === null, JSON.stringify({ bloque, corrige }));
  await capture(p, "editeur-1280-egee", false);
  verifier("éditeur : aucune violation de CSP", (await p.evaluate(() => window.__csp)).length === 0);
  await ctx.close();
}

// ---- 6. Mouvement réduit du système ------------------------------------------------------------------------------
{
  const ctx = await contexte({ reducedMotion: "reduce" });
  const p = await ouvrir(ctx);
  const m = await p.evaluate(() => {
    const v = () => getComputedStyle(document.documentElement).getPropertyValue("--eg-motion-scale").trim();
    const a = v();
    window.__egide.appliquerTheme(document.documentElement, "midnight");
    const b = v();
    return { obsidian: a, midnight: b, duree: getComputedStyle(document.documentElement).getPropertyValue("--eg-d-court").trim() };
  });
  verifier("mouvement réduit du système : --eg-motion-scale 0,5 (Obsidian et Midnight « douce »)", m.obsidian === "0.5" && m.midnight === "0.5", JSON.stringify(m));
  // Lot 3 : les boucles décoratives s'ARRÊTENT (image fixe lisible), elles n'accélèrent pas ; le fil avance par sauts ;
  // un thème personnel au mouvement « complète » choisi explicitement garde ses boucles.
  const boucles = await p.evaluate(() => {
    const lire = () => ({
      veille: getComputedStyle(document.querySelector(".eg-veille-anneau")).animationName,
      meandre: getComputedStyle(document.querySelector(".eg-meandre path")).animationName,
      tirets: getComputedStyle(document.querySelector(".eg-meandre path")).strokeDasharray,
      fil: getComputedStyle(document.querySelector(".eg-fil-run")).transitionDuration,
    });
    window.__egide.appliquerTheme(document.documentElement, "obsidian");
    const officiel = lire();
    // base Minimal (mouvement « réduite ») portée à « complète » : choix explicite de l'utilisateur
    const doc = { ...window.__egide.CUSTOM_EXEMPLE, base: "minimal", motion: { intensity: "complete" } };
    window.__egide.appliquerTheme(document.documentElement, doc);
    const explicite = { ...lire(), attr: document.documentElement.getAttribute("data-eg-motion-explicite") };
    window.__egide.appliquerTheme(document.documentElement, "obsidian");
    return { officiel, explicite };
  });
  verifier("mouvement réduit du système : veille et méandre arrêtés sur une image fixe, fil par sauts", boucles.officiel.veille === "none" && boucles.officiel.meandre === "none" && boucles.officiel.tirets === "none" && boucles.officiel.fil === "0s", JSON.stringify(boucles.officiel));
  verifier("mouvement réduit du système : un thème personnel « complète » explicite garde ses boucles", boucles.explicite.attr === "1" && boucles.explicite.veille !== "none", JSON.stringify(boucles.explicite));
  await ctx.close();
}

// ---- 7. Téléphone 360 px : aucun débordement, marges de 16 px -----------------------------------------------------
for (const [l, hauteur] of [[360, 800], [390, 844]]) {
  const ctx = await contexte({ viewport: { width: l, height: hauteur }, hasTouch: true, isMobile: true });
  const p = await ouvrir(ctx);
  await p.click("#g-toast");
  const m = await p.evaluate(() => {
    const larges = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !e.closest(".eg-seg, dialog, .eg-fil"); }).map((e) => e.className || e.tagName).slice(0, 5);
    const zone = document.querySelector(".eg-toasts").getBoundingClientRect();
    return { defile: document.documentElement.scrollWidth > innerWidth, larges, gauche: Math.round(zone.left), droite: Math.round(innerWidth - zone.right) };
  });
  verifier(`téléphone ${l} px : aucun débordement horizontal, toasts à 16 px des bords`, !m.defile && m.larges.length === 0 && m.gauche === 16 && m.droite === 16, JSON.stringify(m));
  const violations = await axe(p);
  verifier(`téléphone ${l} px : axe-core 0 violation`, violations.length === 0, violations.join(" | "));
  await capture(p, `galerie-${l}-obsidian`);
  await ctx.close();
}

verifier("aucune erreur ni avertissement de console", R.erreurs.length === 0, R.erreurs.slice(0, 3).join(" | "));
verifier("aucune requête hors de 127.0.0.1", R.externes.length === 0, R.externes.slice(0, 3).join(" | "));
await navigateur.close();
srv.close();
if (SORTIE) writeFileSync(join(SORTIE, "essais-navigateur.json"), JSON.stringify(R, null, 2));
console.log(`\n${R.essais.filter((e) => e.ok).length}/${R.essais.length} essais réussis`);
if (echecs.length) { console.error("ÉCHECS :\n- " + echecs.join("\n- ")); process.exit(1); }
