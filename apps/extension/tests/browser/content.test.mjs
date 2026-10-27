// Tests navigateur des content scripts : Chromium (nouveau mode headless) avec l'extension de
// développement RÉELLEMENT chargée ; pages de plateformes FABRIQUÉES (tests/fixtures) servies sous les
// vrais noms d'hôte par interception ; aucune requête réseau (routeur fermé + DNS coupé).
// Lancement : node --test tests/browser/content.test.mjs   (PLAYWRIGHT_CORE=<chemin> si besoin)
//
// Ce qui est réel : injection des content scripts par Chrome, Shadow DOM, API Popover, observateurs,
// navigation (pushState, popstate, API Navigation), IntersectionObserver, plein écran, storage.sync,
// messages chrome.tabs.sendMessage → content script, chrome.runtime.sendMessage → service worker
// (stub dans cette branche : la réponse « pas de destinataire » est un vrai chemin d'erreur).
// Ce qui est simulé : le DOM des plateformes (fabriqué) et les job.update (envoyés par une page de
// l'extension au lieu du service worker).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { PLATFORM_HOST, buildDev, cdpFor, extensionPage, launch, waitFor } from "./helpers.mjs";
import { AXE_PATH } from "./ui-helpers.mjs";
import { CONSENT_VERSION } from "../support/browser.mjs";

const NBSP = " ";
const YT = "https://www.youtube.com";
const HINT_X = "Utilise le bouton AETHRYON sous la publication qui contient la vidéo.";
const NO_ANSWER = "L’extension AETHRYON ne répond pas. Recharge la page puis réessaie.";

let env;
let ext;

before(async () => {
  env = await launch(buildDev());
  env.serve(/^https:\/\/www\.youtube\.com\/watch\?/, "youtube-watch.html");
  env.serve(/^https:\/\/www\.youtube\.com\/shorts\//, "youtube-shorts.html");
  env.serve(/^https:\/\/www\.youtube\.com\/$/, "<!doctype html><title>YouTube</title><ytd-app><ytd-page-manager id=page-manager></ytd-page-manager></ytd-app>");
  env.serve(/^https:\/\/www\.tiktok\.com\/(foryou|following)(\?.*)?$/, "tiktok-feed.html");
  env.serve(/^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/, "tiktok-video.html");
  env.serve(/^https:\/\/(x|twitter)\.com\//, "x.html");
  env.serve(/^https:\/\/www\.instagram\.com\//, "<!doctype html><title>Instagram</title><article><video></video></article>");
  ext = await extensionPage(env);
});

after(async () => {
  await env?.close();
});

beforeEach(async () => {
  await ext.clearSettings();
  for (const p of env.context.pages()) if (p !== ext.page) await p.close();
});

async function open(url) {
  const page = await env.context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const s = await cdpFor(page);
  return { page, s, errors };
}

/** Commandes (hôtes <aethryon-control>) de la page, état lu dans leurs racines fermées. */
const inline = (s) => s.controls("aethryon-control");
const panels = (s) => s.controls("aethryon-panel");

async function waitControls(s, n, message, pred = () => true, { timeout = 6000 } = {}) {
  return waitFor(async () => {
    const c = await inline(s);
    return c.length === n && pred(c) ? c : null;
  }, { timeout, message: `${message} (${n} commande(s) attendue(s))` });
}

async function detectOne() {
  const r = await ext.detect();
  assert.equal(r.length, 1, "une seule page avec content script ouverte");
  return r[0];
}

// ---- YouTube -------------------------------------------------------------------------------------
describe("YouTube", () => {
  test("watch : barre AETHRYON sous le lecteur, juste avant le titre ; Shadow DOM fermé ; detect.request", async () => {
    const { page, s, errors } = await open(`${YT}/watch?v=dQw4w9WgXcQ&title=Ma%20vid%C3%A9o%20de%20test`);
    const [c] = await waitControls(s, 1, "barre watch");
    assert.equal(c.parentId, "below");
    assert.equal(c.variant, "toolbar");
    assert.equal(c.shadowMode, "closed");
    assert.equal(c.ui.label, "AETHRYON");
    assert.equal(c.ui.aria, "Outils AETHRYON");
    assert.deepEqual(c.ui.toolbar.buttons.map((b) => b.label), ["Télécharger", "MP3", "Extrait", "Image", "Tools"]);
    assert.equal(c.ui.toolbar.folded, false);
    assert.equal(await page.evaluate(() => document.querySelector("aethryon-control").nextElementSibling.tagName), "YTD-WATCH-METADATA");
    assert.equal(c.ui.title, "Ma vidéo de test");
    assert.equal(c.ui.theme, "light");
    assert.match(c.ui.fontFamily, /Roboto/);
    // Les boutons natifs sont intacts, la racine est inaccessible à la page.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#top-level-buttons-computed > button")].map((b) => b.textContent)), ["J’aime", "Partager"]);
    assert.equal(await page.evaluate(() => document.querySelector("aethryon-control").shadowRoot), null);
    // detect.request (page de l'extension → content script)
    const d = await detectOne();
    assert.deepEqual(d, {
      media: { platform: "youtube", kind: "video", url: `${YT}/watch?v=dQw4w9WgXcQ`, id: "dQw4w9WgXcQ", title: "Ma vidéo de test", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" },
      hint: null,
    });
    // Les passages suivants ne créent pas de doublon.
    await page.waitForTimeout(600);
    assert.equal((await inline(s)).length, 1);
    assert.deepEqual(errors, []);
  });

  test("monde isolé du content script : seuls storage.sync.onChanged et runtime.onMessage sont écoutés", async () => {
    const { s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    await waitControls(s, 1, "bouton");
    // Inspection par le protocole DevTools dans le monde isolé de l'extension : aucun écouteur général
    // chrome.storage.onChanged (qui recevrait aussi les changements de storage.local, dont le jeton).
    const l = await s.evalInContentScript(env.extensionId, `({
      general: chrome.storage.onChanged.hasListeners(),
      local: chrome.storage.local.onChanged.hasListeners(),
      sync: chrome.storage.sync.onChanged.hasListeners(),
      messages: chrome.runtime.onMessage.hasListeners(),
      pageGlobals: typeof window.fx,
    })`);
    assert.deepEqual(l, { general: false, local: false, sync: true, messages: true, pageGlobals: "undefined" });
  });

  test("navigation SPA (pushState + yt-navigate-finish), re-rendu de la rangée, accueil, retour", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    await waitControls(s, 1, "bouton initial");
    await page.evaluate(() => window.fx.navigate("9bZkp7q19f0", "Deuxième vidéo"));
    await waitControls(s, 1, "bouton de la 2e vidéo", (c) => c[0].ui.title === "Deuxième vidéo");
    assert.equal((await detectOne()).media.id, "9bZkp7q19f0");
    // YouTube remplace la rangée : le bouton revient, une seule fois.
    await page.evaluate(() => window.fx.rerenderActions());
    const [c] = await waitControls(s, 1, "barre après re-rendu", (c) => c[0].parentId === "below");
    assert.equal(c.ui.title, "Deuxième vidéo");
    assert.equal(await page.evaluate(() => document.querySelectorAll("aethryon-control").length), 1);
    // Accueil : plus de bouton, detect sans vidéo.
    await page.evaluate(() => window.fx.goHome());
    await waitControls(s, 0, "aucun bouton à l'accueil");
    assert.deepEqual(await detectOne(), { media: null, hint: `Aucune vidéo sur cette page${NBSP}: ouvre une vidéo ou un Short.` });
    // Retour arrière (popstate) : de nouveau la 2e vidéo.
    await page.goBack();
    await waitControls(s, 1, "bouton après retour arrière");
    assert.equal((await detectOne()).media.id, "9bZkp7q19f0");
  });

  test("Shorts : bouton rond dans la colonne du Short actif, qui suit le défilement", async () => {
    const { page, s } = await open(`${YT}/shorts/sHoRt000001`);
    let [c] = await waitControls(s, 1, "bouton du Short 1");
    assert.equal(c.fixture, "reel-0");
    assert.equal(c.variant, "round");
    assert.equal(c.parentTag, "reel-action-bar-view-model");
    assert.equal(c.ui.title, "Short numéro 1");
    for (const i of [1, 2]) {
      await page.evaluate((n) => window.fx.scrollTo(n), i);
      [c] = await waitControls(s, 1, `bouton du Short ${i + 1}`, (cs) => cs[0].fixture === `reel-${i}`);
      assert.equal(c.ui.title, `Short numéro ${i + 1}`);
      const d = await detectOne();
      assert.equal(d.media.kind, "short");
      assert.equal(d.media.url, `${YT}/shorts/sHoRt00000${i + 1}`);
    }
  });

  test("thème : html[dark] suivi en direct", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    await waitControls(s, 1, "bouton", (c) => c[0].ui.theme === "light");
    await page.evaluate(() => window.fx.setDark(true));
    await waitControls(s, 1, "thème sombre", (c) => c[0].ui.theme === "dark");
    await page.evaluate(() => window.fx.setDark(false));
    await waitControls(s, 1, "thème clair", (c) => c[0].ui.theme === "light");
  });

  test("plein écran : commande masquée, puis réaffichée à la sortie", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    await waitControls(s, 1, "bouton");
    await page.click("#fx-fullscreen");
    await waitFor(() => page.evaluate(() => !!document.fullscreenElement), { message: "plein écran" });
    await waitControls(s, 1, "commande masquée", (c) => c[0].hidden && c[0].display === "none");
    await page.evaluate(() => document.exitFullscreen());
    await waitControls(s, 1, "commande réaffichée", (c) => !c[0].hidden && c[0].display !== "none");
  });
});

// ---- Popover, téléchargement, progression ----------------------------------------------------------
describe("Popover et progression", () => {
  test("non connecté : jamais « Échec » ; « Lire la notice » ouvre la notice, puis « Se connecter à AETHRYON » lance la VRAIE connexion", async () => {
    await ext.page.evaluate(() => chrome.storage.local.remove("consent"));
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    let [c] = await waitControls(s, 1, "bouton");
    // Égide (3.9.0) : la chouette maître telle quelle (dessin du fichier maître, jamais le « petit logo »), sans pastille.
    assert.deepEqual(c.ui.owl, { small: false, surface: "dark", size: "16" });
    await s.click(c.handle, ".tb-dl");
    [c] = await waitControls(s, 1, "menu ouvert", (cs) => cs[0].ui.open && cs[0].ui.view === "main");
    assert.deepEqual(c.ui.rows.map((r) => r.row), ["video", "audio", "clip", "frame", "thumb", "tools"]);
    assert.deepEqual(c.ui.rows.slice(0, 2).map((r) => [r.label, r.sub]), [["Télécharger la vidéo", "MP4 · meilleure disponible"], ["Extraire l’audio", `MP3 · 192${NBSP}kbit/s`]]);
    assert.equal(c.ui.videos, null, "une seule vidéo : aucun choix");
    assert.deepEqual(c.ui.quality.map((o) => o.label), ["Meilleure disponible", "1080p", "720p", "480p"]);
    assert.deepEqual(c.ui.bitrate.map((o) => o.label), [`128${NBSP}kbit/s`, `192${NBSP}kbit/s`, `320${NBSP}kbit/s`]);
    await s.click(c.handle, ".r-more[data-more=audio]");
    [c] = await waitControls(s, 1, "vue Débit", (cs) => cs[0].ui.view === "bitrate");
    await s.click(c.handle, ".choice", `320${NBSP}kbit/s`);
    [c] = await waitControls(s, 1, "retour au menu, 320 kbit/s", (cs) => cs[0].ui.view === "main" && cs[0].ui.rows[1].sub === `MP3 · 320${NBSP}kbit/s`);
    await s.click(c.handle, ".r-audio");
    // 1. Notice pas encore acceptée : explication et « Lire la notice » (le vrai service worker répond).
    [c] = await waitControls(s, 1, "notice à accepter", (cs) => cs[0].ui.status?.phase === "auth");
    assert.equal(c.ui.status.state, "Notice à accepter");
    assert.equal(c.ui.status.message, "Avant la première connexion, lis la notice sur les données et accepte-la.");
    assert.equal(c.ui.status.action, "Lire la notice");
    assert.equal(c.ui.status.retry, false);
    assert.equal(c.ui.toolbar.chip, "", "rien n'a échoué : jamais « Échec »");
    await s.click(c.handle, ".act");
    const welcome = await waitFor(() => env.context.pages().find((p) => p.url().startsWith(`chrome-extension://${env.extensionId}/welcome/welcome.html#donnees`)), { message: "page d'accueil ouverte sur la notice" });
    [c] = await waitControls(s, 1, "notice ouverte", (cs) => /La notice s’ouvre dans un nouvel onglet/.test(cs[0].ui.status?.message ?? ""));
    await welcome.close();
    // 2. Notice acceptée (comme sur la page d'accueil), pas encore connecté : « Se connecter à AETHRYON ».
    await ext.page.evaluate((version) => chrome.storage.local.set({ consent: { version, at: new Date().toISOString() } }), CONSENT_VERSION);
    await s.click(c.handle, ".r-audio");
    [c] = await waitControls(s, 1, "connexion requise", (cs) => cs[0].ui.status?.state === "Connexion requise");
    assert.equal(c.ui.status.message, "Connecte l'extension à ton compte AETHRYON pour télécharger.");
    assert.equal(c.ui.status.action, "Se connecter à AETHRYON");
    assert.equal(c.ui.status.role, "status");
    // 3. Clic : le service worker ouvre la VRAIE fenêtre de connexion du site (launchWebAuthFlow) ; la page
    //    attend honnêtement ; l'utilisateur ferme la fenêtre → la cause est dite, le bouton redevient utilisable.
    await s.click(c.handle, ".act");
    [c] = await waitControls(s, 1, "connexion en cours", (cs) => cs[0].ui.status?.phase === "signing");
    assert.equal(c.ui.status.message, `Une fenêtre AETHRYON s’ouvre${NBSP}: connecte-toi, puis autorise l’extension.`);
    assert.equal(c.ui.status.actionDisabled, true);
    const win = await waitFor(() => env.context.pages().find((p) => p.url().includes("/extension/autoriser?redirect_uri=")), { timeout: 15_000, message: "fenêtre de connexion" });
    const q = new URL(win.url()).searchParams;
    assert.equal(q.get("redirect_uri"), `https://${env.extensionId}.chromiumapp.org/aethryon`);
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.match(q.get("state"), /^[A-Za-z0-9_-]{43}$/);
    await win.close();
    [c] = await waitControls(s, 1, "fenêtre fermée", (cs) => cs[0].ui.status?.state === "Connexion impossible", { timeout: 15_000 });
    // Fenêtre fermée ET page du site injoignable (ce banc bloque tout le réseau, requêtes du service worker
    // comprises) : la cause réelle est dite, pas « Connexion annulée. » ni « Échec ».
    assert.equal(c.ui.status.message, `Impossible de joindre AETHRYON${NBSP}: vérifie ta connexion à Internet, puis réessaie.`);
    assert.ok(env.log.blocked.includes("http://localhost:18110/extension/autoriser"), "une seule requête simple vers la page (bloquée ici)");
    assert.equal(c.ui.status.action, "Se connecter à AETHRYON");
    assert.equal(c.ui.status.actionDisabled, false);
    // Échap ferme le popover.
    await page.keyboard.press("Escape");
    await waitControls(s, 1, "popover fermé", (cs) => !cs[0].ui.open);
    await ext.page.evaluate(() => chrome.storage.local.remove("consent"));
  });

  test("clavier : Tab jusqu'à la barre, Entrée ouvre le menu sur « Télécharger la vidéo », flèches entre les lignes, → ouvre le débit, Entrée choisit, Échap revient puis ferme et rend le focus", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    const [c0] = await waitControls(s, 1, "barre");
    // Élément actif dans la racine fermée (classe de l'élément), lu par le protocole DevTools.
    const focused = () => s.callOn({ backendNodeId: c0.handle.shadowBackend }, function () { return this.activeElement ? `${this.activeElement.tagName.toLowerCase()}.${[...this.activeElement.classList].join(".")}` : null; });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Tab"); // rien de focalisable avant la barre dans le lecteur fabriqué
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "AETHRYON-CONTROL");
    assert.match(await focused(), /tb-brand/);
    await page.keyboard.press("Tab");
    assert.match(await focused(), /tb-dl/);
    await page.keyboard.press("Enter");
    let [c] = await waitControls(s, 1, "menu ouvert au clavier", (cs) => cs[0].ui.open);
    assert.match(await focused(), /r-video/, "focus sur la première action");
    // Raccourcis clavier de la page (écouteur keydown sur document) : ils ne doivent rien recevoir.
    await page.evaluate(() => { window.fxKeys = 0; });
    await page.keyboard.press("ArrowDown");
    assert.match(await focused(), /r-audio/);
    await page.keyboard.press("ArrowRight");
    [c] = await waitControls(s, 1, "vue Débit", (cs) => cs[0].ui.view === "bitrate");
    assert.match(await focused(), /choice/);
    await page.keyboard.press("ArrowDown"); // 192 → 320
    await page.keyboard.press("Enter");
    [c] = await waitControls(s, 1, "320 kbit/s choisi", (cs) => cs[0].ui.view === "main" && cs[0].ui.rows[1].sub === `MP3 · 320${NBSP}kbit/s`);
    assert.match(await focused(), /r-audio/, "le focus revient sur la ligne");
    await page.keyboard.press("k"); // « k » = pause sur YouTube
    assert.equal(await page.evaluate(() => window.fxKeys), 0);
    // Échap dans une sous-vue : retour au menu ; dans le menu : fermeture, focus rendu au bouton d'origine.
    await page.keyboard.press("ArrowRight");
    await waitControls(s, 1, "vue Débit", (cs) => cs[0].ui.view === "bitrate");
    await page.keyboard.press("Escape");
    await waitControls(s, 1, "retour au menu", (cs) => cs[0].ui.open && cs[0].ui.view === "main");
    await page.keyboard.press("Escape");
    await waitControls(s, 1, "fermé", (cs) => !cs[0].ui.open);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "AETHRYON-CONTROL", "le focus revient à la barre");
    assert.match(await focused(), /tb-dl/);
  });

  test("responsive : barre étroite → pictogrammes seuls, sauf « Télécharger » ; repliée → pastille, réglage mémorisé", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    let [c] = await waitControls(s, 1, "barre large", (cs) => cs[0].ui.toolbar.buttons.every((b) => b.text));
    await page.setViewportSize({ width: 620, height: 800 });
    [c] = await waitControls(s, 1, "barre étroite", (cs) => cs[0].ui.toolbar.buttons.filter((b) => b.text).map((b) => b.label).join() === "Télécharger");
    await page.setViewportSize({ width: 1280, height: 800 });
    [c] = await waitControls(s, 1, "barre large de nouveau", (cs) => cs[0].ui.toolbar.buttons.every((b) => b.text));
    // Repliée : la pastille seule ; le choix est gardé (storage.sync) et appliqué au prochain chargement.
    await s.click(c.handle, ".tb-fold");
    [c] = await waitControls(s, 1, "repliée", (cs) => cs[0].ui.toolbar.folded);
    assert.ok(c.ui.toolbar.width < 220, `pastille étroite (${c.ui.toolbar.width} px)`);
    await waitFor(async () => (await ext.getSettings())?.ytToolbar === "collapsed", { message: "réglage enregistré" });
    await page.reload();
    await s.detach();
    const s2 = await cdpFor(page);
    [c] = await waitControls(s2, 1, "repliée après rechargement", (cs) => cs[0].ui.toolbar?.folded === true);
    await s2.click(c.handle, ".trigger"); // la pastille rouvre la barre (sans ouvrir le menu)
    [c] = await waitControls(s2, 1, "dépliée", (cs) => !cs[0].ui.toolbar.folded && !cs[0].ui.open);
    await waitFor(async () => (await ext.getSettings())?.ytToolbar === "open", { message: "réglage dépliée" });
  });

  test("job.update : En file → Conversion… 42 % → Téléchargement… 60 % → Enregistré (seulement à done) ; erreurs ; messages de la page ignorés", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    let [c] = await waitControls(s, 1, "bouton");
    const url = `${YT}/watch?v=dQw4w9WgXcQ`;
    let t = 1;
    const job = (state, extra = {}) => ({ key: "jobkey000001", url, platform: "youtube", fmt: "mp4", quality: "best", state, createdAt: 1, updatedAt: ++t, ...extra });
    const step = async (j, check, msg) => {
      await ext.jobUpdate(j);
      return (await waitControls(s, 1, msg, (cs) => check(cs[0])))[0];
    };
    c = await step(job("queued"), (x) => x.ui.toolbar.chip === "En file", "En file");
    assert.equal(c.ui.status.state, "En file");
    c = await step(job("converting", { progress: 42 }), (x) => x.ui.status?.state === `Conversion… 42${NBSP}%`, "Conversion 42 %");
    assert.equal(c.ui.toolbar.chip, `42${NBSP}%`);
    c = await step(job("converting", { progress: 100 }), (x) => x.ui.status?.state === `Conversion… 100${NBSP}%`, "conversion terminée ≠ enregistré");
    assert.notEqual(c.ui.toolbar.chip, "Enregistré");
    c = await step(job("downloading", { progress: 60 }), (x) => x.ui.status?.state === `Téléchargement… 60${NBSP}%`, "Téléchargement 60 %");
    c = await step(job("done", { progress: 100 }), (x) => x.ui.status?.phase === "done", "Enregistré");
    assert.equal(c.ui.status.state, "Enregistré");
    assert.equal(c.ui.toolbar.chip, "Enregistré");
    // Message de la page (window.postMessage) : ignoré.
    await page.evaluate((j) => window.postMessage({ type: "job.update", job: j }, "*"), job("error", { error: { code: "x", message: "Faux", retryable: true } }));
    await page.waitForTimeout(300);
    assert.equal((await inline(s))[0].ui.status.phase, "done");
    // Mise à jour périmée (updatedAt plus ancien) : ignorée.
    await ext.jobUpdate({ ...job("converting", { progress: 5 }), updatedAt: 0 + 2 });
    await page.waitForTimeout(300);
    assert.equal((await inline(s))[0].ui.status.phase, "done");
    // Erreur du serveur non relançable, puis relançable (nouveau job).
    const err = (retryable) => ({ ...job("error"), key: retryable ? "jobkey000003" : "jobkey000002", error: { code: "quota_exceeded", message: "Quota du jour atteint : reviens demain.", retryable } });
    c = await step(err(false), (x) => x.ui.status?.phase === "error" && x.ui.status.message === "Quota du jour atteint : reviens demain.", "erreur serveur");
    assert.equal(c.ui.status.retry, false);
    c = await step(err(true), (x) => x.ui.status?.phase === "error" && x.ui.status.retry === true, "erreur relançable");
    // URL hors périmètre : ignorée.
    await ext.jobUpdate({ ...job("done"), key: "jobkey000004", url: "https://www.instagram.com/reel/abc/" });
    await page.waitForTimeout(300);
    assert.equal((await inline(s))[0].ui.status.phase, "error");
  });
});

// ---- Accessibilité des commandes (axe) -----------------------------------------------------------
// axe-core ne traverse pas les racines fantômes FERMÉES (« No elements found ») : la racine de chaque commande est
// copiée telle quelle (mêmes nœuds, même <style>, même thème, popover ouvert rendu visible) dans une racine OUVERTE
// insérée juste après l'hôte, auditée (WCAG 2.1 A/AA + bonnes pratiques, contraste compris), puis retirée aussitôt.
describe("Accessibilité des commandes intégrées (axe, clair et sombre)", () => {
  const AXE = readFileSync(AXE_PATH, "utf8");
  const COPY_AND_AUDIT = async function () {
    const host = document.createElement("aethryon-copie-axe");
    const open = host.attachShadow({ mode: "open" });
    for (const n of this.childNodes) open.appendChild(n.cloneNode(true));
    const pop = open.querySelector(".pop");
    const wasOpen = !!this.querySelector(".pop")?.matches(":popover-open");
    if (pop && wasOpen) { pop.removeAttribute("popover"); pop.style.position = "static"; }
    this.host.after(host);
    try {
      const r = await window.axe.run(open.querySelector(".aeth"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }, resultTypes: ["violations", "incomplete", "passes"],
      });
      const brief = (v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 2).map((n) => n.target.join(" ")), summary: (v.nodes[0]?.failureSummary ?? "").slice(0, 200) });
      return { open: wasOpen, violations: r.violations.map(brief), incomplete: r.incomplete.map(brief), contrast: r.passes.find((v) => v.id === "color-contrast")?.nodes.length ?? 0, names: r.passes.find((v) => v.id === "button-name")?.nodes.length ?? 0 };
    } finally {
      host.remove();
    }
  };
  const results = [];
  async function audit(page, s, c, label) {
    await page.evaluate(AXE);
    const r = await s.callOn({ backendNodeId: c.handle.shadowBackend }, COPY_AND_AUDIT);
    results.push({ label, ...r, violations: r.violations.length });
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    assert.deepEqual(bad, [], `${label} : violations axe graves`);
    assert.ok(r.names >= 1, `${label} : noms accessibles vérifiés`);
    assert.ok(r.contrast >= 1, `${label} : contraste vérifié`);
    // Menu ouvert : au moins 6 textes vérifiés ; pendant un travail, le menu se résume à son état (3 au moins).
    const busy = ["sending", "queued", "converting", "downloading", "signing"].includes(c.ui.status?.phase ?? "");
    if (r.open) assert.ok(r.contrast >= (busy ? 3 : 6), `${label} : contraste du popover vérifié (${r.contrast} nœuds)`);
    return r;
  }
  const openPop = async (s, c) => {
    await s.click(c.handle, ".trigger");
    return (await waitControls(s, 1, "popover ouvert", (cs) => cs[0].ui.open))[0];
  };
  after(() => { console.log(`# axe (commandes intégrées) : ${JSON.stringify(results.map((r) => `${r.label} ${r.violations}v/${r.contrast}c`))}`); });

  test("YouTube (vidéo) : fermé, popover, notice à accepter, conversion 42 %, Enregistré, erreur — clair et sombre", async () => {
    await ext.page.evaluate(() => chrome.storage.local.remove("consent"));
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ&title=Vid%C3%A9o%20de%20test`);
    const url = `${YT}/watch?v=dQw4w9WgXcQ`;
    let t = 10;
    let pass = 0;
    const job = (state, extra = {}) => ({ key: `jobaxe${pass}00001`, url, platform: "youtube", fmt: "mp4", quality: "best", state, createdAt: 1, updatedAt: ++t, ...extra });
    for (const dark of [false, true]) {
      pass += 1; // un nouveau job par passage (une commande suit le job le plus récent)
      await page.evaluate((d) => window.fx.setDark(d), dark);
      const theme = dark ? "sombre" : "clair";
      let [c] = await waitControls(s, 1, `thème ${theme}`, (cs) => cs[0].ui.theme === (dark ? "dark" : "light"));
      await audit(page, s, c, `youtube fermé ${theme}`);
      c = await openPop(s, c);
      await audit(page, s, c, `youtube popover ${theme}`);
      await s.click(c.handle, ".r-video");
      [c] = await waitControls(s, 1, "notice à accepter", (cs) => cs[0].ui.status?.phase === "auth");
      await audit(page, s, c, `youtube notice ${theme}`);
      for (const [j, name, check] of [
        [job("converting", { progress: 42 }), "conversion 42 %", (x) => /42/.test(x.ui.status?.state ?? "")],
        [job("done", { progress: 100 }), "Enregistré", (x) => x.ui.status?.phase === "done"],
        [{ ...job("error"), key: `jobaxe${pass}00002`, error: { code: "quota_exceeded", message: "Tu as atteint ta limite de conversions pour aujourd'hui.", retryable: false } }, "erreur", (x) => x.ui.status?.phase === "error"],
      ]) {
        await ext.jobUpdate(j);
        [c] = await waitControls(s, 1, name, (cs) => check(cs[0]));
        await audit(page, s, c, `youtube ${name} ${theme}`);
      }
      await page.keyboard.press("Escape");
      await waitControls(s, 1, "fermé", (cs) => !cs[0].ui.open);
    }
  });

  test("Shorts, TikTok, X (publication à deux vidéos) : bouton et popover, clair et sombre", async () => {
    // Shorts (thème de YouTube : html[dark])
    {
      const { page, s } = await open(`${YT}/shorts/sHoRt000001`);
      for (const dark of [false, true]) {
        // Thème sombre de YouTube : html[dark] ET fond de page sombre (#0f0f0f), comme sur youtube.com.
        await page.evaluate((d) => {
          const html = document.documentElement;
          if (d) html.setAttribute("dark", ""); else html.removeAttribute("dark");
          html.style.background = document.body.style.background = d ? "#0f0f0f" : "";
          html.style.color = document.body.style.color = d ? "#f1f1f1" : "";
        }, dark);
        let [c] = await waitControls(s, 1, "Short", (cs) => cs[0].ui.theme === (dark ? "dark" : "light"));
        await audit(page, s, c, `shorts fermé ${dark ? "sombre" : "clair"}`);
        c = await openPop(s, c);
        await audit(page, s, c, `shorts popover ${dark ? "sombre" : "clair"}`);
        await page.keyboard.press("Escape");
        await waitControls(s, 1, "fermé", (cs) => !cs[0].ui.open);
      }
      await page.close();
    }
    // TikTok (thème lu sur la luminance du fond)
    for (const dark of [false, true]) {
      const { page, s } = await open(`https://www.tiktok.com/foryou${dark ? "?theme=dark" : ""}`);
      let [c] = await waitControls(s, 1, "TikTok", (cs) => cs[0].ui.theme === (dark ? "dark" : "light"));
      await audit(page, s, c, `tiktok fermé ${dark ? "sombre" : "clair"}`);
      c = await openPop(s, c);
      await audit(page, s, c, `tiktok popover ${dark ? "sombre" : "clair"}`);
      await page.close();
    }
    // X : la publication à deux vidéos (choix « Vidéo 1 / Vidéo 2 » dans le popover)
    {
      const { page, s } = await open("https://x.com/home");
      for (const dark of [false, true]) {
        await page.evaluate((d) => window.fx.setTheme(d), dark);
        const all = await waitControls(s, 5, "X", (cs) => cs.every((x) => x.ui.theme === (dark ? "dark" : "light")));
        let c = all.find((x) => x.fixture === "x-C");
        await audit(page, s, c, `x fermé ${dark ? "sombre" : "clair"}`);
        await s.click(c.handle, ".trigger");
        c = (await waitControls(s, 5, "popover X", (cs) => cs.some((x) => x.fixture === "x-C" && x.ui.open))).find((x) => x.fixture === "x-C");
        assert.deepEqual(c.ui.videos.map((o) => o.label), ["Vidéo 1", "Vidéo 2"]);
        await audit(page, s, c, `x popover 2 vidéos ${dark ? "sombre" : "clair"}`);
        await page.keyboard.press("Escape");
        await waitControls(s, 5, "fermé", (cs) => !cs.find((x) => x.fixture === "x-C").ui.open);
      }
      await page.close();
    }
  });
});

// ---- TikTok --------------------------------------------------------------------------------------
describe("TikTok", () => {
  test("fil : la commande suit la vidéo la plus visible (défilement)", async () => {
    const { page, s } = await open("https://www.tiktok.com/foryou");
    let [c] = await waitControls(s, 1, "bouton de la 1re vidéo", (cs) => cs[0].fixture === "tt-0");
    assert.equal(c.variant, "round");
    assert.equal(c.ui.ctx, "@alice.test");
    let d = await detectOne();
    assert.deepEqual(d.media, {
      platform: "tiktok", kind: "video", url: "https://www.tiktok.com/@alice.test/video/7300000000000000001", id: "7300000000000000001",
      title: "Première vidéo du fil #fyp", thumbnail: "https://p16-sign-va.tiktokcdn.com/obj/fixture-0.jpeg",
    });
    const expected = [
      ["tt-1", "https://www.tiktok.com/@bob_test/video/7300000000000000002"],
      ["tt-2", "https://www.tiktok.com/@carol/video/7300000000000000003"],
    ];
    for (const [i, [fx, url]] of expected.entries()) {
      await page.evaluate((n) => window.fx.scrollToItem(n), i + 1);
      [c] = await waitControls(s, 1, `bouton de ${fx}`, (cs) => cs[0].fixture === fx);
      d = await detectOne();
      assert.equal(d.media.url, url);
      assert.equal(d.media.thumbnail, undefined, "pas d'affiche : pas de miniature (og:image refusée dans le fil)");
    }
    // Retour à la première.
    await page.evaluate(() => window.fx.scrollToItem(0));
    await waitControls(s, 1, "retour à la 1re vidéo", (cs) => cs[0].fixture === "tt-0");
  });

  test("page vidéo : URL de la page, rangée horizontale, miniature og:image acceptée", async () => {
    const { s } = await open("https://www.tiktok.com/@alice.test/video/7300000000000000009?is_from_webapp=1");
    const [c] = await waitControls(s, 1, "bouton page vidéo");
    assert.equal(c.variant, "bar");
    const d = await detectOne();
    assert.deepEqual(d.media, {
      platform: "tiktok", kind: "video", url: "https://www.tiktok.com/@alice.test/video/7300000000000000009", id: "7300000000000000009",
      title: "Une vidéo en page détaillée", thumbnail: "https://p16-sign-va.tiktokcdn.com/obj/og-fixture.jpeg",
    });
  });

  test("page vidéo : actions et description hors du conteneur détaillé (repli sur les icônes browse-*)", async () => {
    const { page, s } = await open("https://www.tiktok.com/@alice.test/video/7300000000000000009?split=1");
    const [c] = await waitControls(s, 1, "bouton page vidéo (actions séparées)");
    assert.equal(c.variant, "bar");
    assert.equal(await page.evaluate(() => document.querySelector(".actions aethryon-control") !== null), true);
    assert.equal((await detectOne()).media.title, "Une vidéo en page détaillée");
  });

  test("thème sombre détecté par la luminance du fond, suivi en direct", async () => {
    const { page, s } = await open("https://www.tiktok.com/foryou?theme=dark");
    await waitControls(s, 1, "thème sombre", (c) => c[0].ui.theme === "dark");
    await page.evaluate(() => window.fx.setDark(false));
    await waitControls(s, 1, "thème clair", (c) => c[0].ui.theme === "light");
  });
});

// ---- X / Twitter ---------------------------------------------------------------------------------
describe("X", () => {
  const byFixture = (cs) => Object.groupBy(cs, (c) => `${c.fixture}${c.variant === "quote" ? ":quote" : ""}`);

  test("fil : un bouton par publication avec vidéo, aucun sans vidéo ; citée → lien cité ; 2 vidéos → menu", async () => {
    const { page, s } = await open("https://x.com/home");
    const cs = await waitControls(s, 5, "5 commandes (A, C, D citée, G, G citée)");
    const m = byFixture(cs);
    assert.deepEqual(Object.keys(m).sort(), ["x-A", "x-C", "x-D:quote", "x-G", "x-G:quote"]);
    assert.equal(m["x-A"][0].ui.aria, "Télécharger la vidéo (@alice) avec AETHRYON");
    assert.equal(m["x-A"][0].parentTag, "div");
    assert.equal(m["x-C"][0].ui.ctx, "@carol · 2 vidéos");
    assert.deepEqual(m["x-C"][0].ui.videos.map((o) => o.label), ["Vidéo 1", "Vidéo 2"]);
    assert.equal(m["x-D:quote"][0].ui.ctx, "Publication citée · @dave");
    assert.equal(m["x-D:quote"][0].afterQuote, true, "sous la carte citée, hors du bloc cliquable");
    assert.equal(m["x-G"][0].ui.ctx, "@hana");
    assert.equal(m["x-G:quote"][0].ui.ctx, "Publication citée · @ivan");
    for (const c of cs) assert.ok(!["x-B", "x-E", "x-F"].includes(c.fixture), `aucun bouton dans ${c.fixture}`);
    // Les barres d'actions ne contiennent qu'un bouton AETHRYON chacune.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role="group"]')].map((g) => g.querySelectorAll("aethryon-control").length)), [1, 0, 1, 0, 0, 0, 1]);
    // Clic sur le bouton : le popover s'ouvre, la publication (clic sur l'article) ne s'ouvre pas.
    await s.click(m["x-C"][0].handle, ".trigger");
    let [c] = (await waitControls(s, 5, "popover C", (all) => all.some((x) => x.fixture === "x-C" && x.ui.open))).filter((x) => x.fixture === "x-C");
    assert.equal(await page.evaluate(() => window.fxArticleClicks), 0);
    await s.click(c.handle, ".opt", "Vidéo 2");
    [c] = (await waitControls(s, 5, "Vidéo 2 choisie", (all) => all.find((x) => x.fixture === "x-C").ui.videos[1].checked)).filter((x) => x.fixture === "x-C");
    assert.equal(c.ui.videos[0].checked, false);
    assert.equal(await page.evaluate(() => window.fxArticleClicks), 0);
    // Fil : pas de vidéo « courante » pour le popup.
    assert.deepEqual(await detectOne(), { media: null, hint: HINT_X });
    // Preuve de la liaison : un job.update pour l'URL de la publication CITÉE (dave/…044) s'affiche sur
    // la commande de la citation ; un job.update pour la publication qui cite (dan/…004) ne s'affiche nulle part.
    const upd = (key, url, progress) => ext.jobUpdate({ key, url, platform: "twitter", fmt: "mp4", state: "converting", progress, createdAt: 1, updatedAt: 2 });
    await upd("jobkeyquote1", "https://x.com/dave/status/1790000000000000044", 10);
    const after = await waitControls(s, 5, "progression sur la citation", (all) => all.find((x) => x.fixture === "x-D").ui.label === `10${NBSP}%`);
    assert.deepEqual(after.filter((x) => x.ui.phase !== "idle").map((x) => `${x.fixture}:${x.variant}`), ["x-D:quote"]);
    await upd("jobkeyouter1", "https://x.com/dan/status/1790000000000000004", 20);
    await page.waitForTimeout(300);
    assert.deepEqual((await inline(s)).filter((x) => x.ui.phase !== "idle").map((x) => `${x.fixture}:${x.variant}`), ["x-D:quote"]);
  });

  test("twitter.com : même comportement que x.com (URL canonique x.com)", async () => {
    const { s } = await open("https://twitter.com/home");
    const cs = await waitControls(s, 5, "5 commandes sur twitter.com");
    assert.equal(cs.find((x) => x.fixture === "x-A").ui.ctx, "@alice");
    await ext.jobUpdate({ key: "jobkeytwttr1", url: "https://twitter.com/alice/status/1790000000000000001", platform: "twitter", fmt: "mp3", state: "queued", createdAt: 1, updatedAt: 2 });
    await waitControls(s, 5, "job.update twitter.com → commande de @alice", (all) => all.find((x) => x.fixture === "x-A").ui.label === "En file");
  });

  test("nœud recyclé : nouvelle liaison quand le lien change en place ; retrait quand la vidéo disparaît", async () => {
    const { page, s } = await open("https://x.com/home");
    await waitControls(s, 5, "état initial");
    await page.evaluate(() => window.fx.recycle("A", { handle: "zoe", status: "1790000000000000111", videos: 1, text: "Recyclée" }));
    let cs = await waitControls(s, 5, "A relié à @zoe", (all) => all.some((x) => x.fixture === "x-A" && x.ui.ctx === "@zoe"));
    assert.ok(!cs.some((x) => x.ui.ctx === "@alice"), "plus aucune commande liée à l'ancienne publication");
    assert.equal(cs.find((x) => x.fixture === "x-A").ui.title, "Recyclée");
    await page.evaluate(() => window.fx.recycle("A", { handle: "yan", status: "1790000000000000222", videos: 0 }));
    cs = await waitControls(s, 4, "A sans vidéo : bouton retiré", (all) => !all.some((x) => x.fixture === "x-A"));
    await page.evaluate(() => window.fx.recycle("B", { handle: "bob", status: "1790000000000000002", videos: 2 }));
    cs = await waitControls(s, 5, "B avec vidéos : bouton ajouté", (all) => all.some((x) => x.fixture === "x-B"));
    assert.equal(cs.find((x) => x.fixture === "x-B").ui.ctx, "@bob · 2 vidéos");
  });

  test("page d'une publication : detect → publication principale (videoCount) ; sans vidéo → indice", async () => {
    let { s } = await open("https://x.com/alice/status/1790000000000000001");
    await waitControls(s, 2, "publication + réponse");
    assert.deepEqual((await detectOne()).media, {
      platform: "twitter", kind: "post", url: "https://x.com/alice/status/1790000000000000001", id: "1790000000000000001",
      title: "Publication principale", thumbnail: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/fixture.jpg", videoCount: 1,
    });
    for (const p of env.context.pages()) if (p !== ext.page) await p.close();
    ({ s } = await open("https://x.com/alice/status/1790000000000000001?novideo=1"));
    await waitControls(s, 1, "réponse seulement");
    assert.deepEqual(await detectOne(), { media: null, hint: HINT_X });
  });

  test("thème : fond du body (style en ligne) suivi en direct", async () => {
    const { page, s } = await open("https://x.com/home");
    await waitControls(s, 5, "clair", (c) => c.every((x) => x.ui.theme === "light"));
    await page.evaluate(() => window.fx.setTheme(true));
    await waitControls(s, 5, "sombre", (c) => c.every((x) => x.ui.theme === "dark"));
  });
});

// ---- Panneau flottant et réglages ------------------------------------------------------------------
describe("Panneau flottant et réglages", () => {
  test("ancrage absent → panneau de secours ; glisser, clavier, position mémorisée, réinitialisée hors écran", async () => {
    const watch = `${YT}/watch?v=dQw4w9WgXcQ&noanchor=1&title=Sans%20ancrage`;
    let { page, s } = await open(watch);
    const [p] = await waitFor(async () => {
      const ps = await panels(s);
      return ps.length === 1 ? ps : null;
    }, { message: "panneau de secours", timeout: 8000 });
    assert.equal((await inline(s)).length, 0);
    assert.equal(p.ui.panelTitle, "Sans ancrage");
    assert.equal(p.ui.label, "Télécharger");
    assert.equal(p.parentTag, "html", "panneau hors de la page (enfant de <html>)");
    // Position par défaut : en bas à gauche (marge 16 px).
    assert.equal(p.rect.x, 16);
    // Glisser (pointeur réel).
    const grip = await s.centerOf(p.handle, ".grip");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 120, grip.y - 200, { steps: 6 });
    await page.mouse.up();
    const saved = await waitFor(async () => (await ext.getSettings())?.panelPosition ?? null, { message: "position enregistrée" });
    assert.equal(saved.x, 16 + 120);
    const moved = (await panels(s))[0];
    assert.equal(moved.rect.x, saved.x);
    assert.equal(moved.rect.y, saved.y);
    // Clavier : flèche droite (+10 px), enregistrée.
    await s.click(moved.handle, ".grip");
    await page.keyboard.press("ArrowRight");
    await waitFor(async () => (await ext.getSettings())?.panelPosition?.x === saved.x + 10, { message: "déplacement clavier enregistré" });
    // Rechargement : position restaurée.
    await page.reload();
    await s.detach();
    s = await cdpFor(page);
    const [again] = await waitFor(async () => {
      const ps = await panels(s);
      return ps.length === 1 ? ps : null;
    }, { message: "panneau après rechargement", timeout: 8000 });
    assert.deepEqual({ x: again.rect.x, y: again.rect.y }, { x: saved.x + 10, y: saved.y });
    // Position hors écran (autre écran, fenêtre réduite) : position par défaut, réglage effacé.
    await ext.setSettings({ ...(await ext.getSettings()), panelPosition: { x: 5000, y: 4000 } });
    await page.reload();
    await s.detach();
    s = await cdpFor(page);
    const [reset] = await waitFor(async () => {
      const ps = await panels(s);
      return ps.length === 1 ? ps : null;
    }, { message: "panneau replacé", timeout: 8000 });
    assert.equal(reset.rect.x, 16);
    await waitFor(async () => (await ext.getSettings())?.panelPosition === null, { message: "position effacée" });
    // Le popover du panneau s'ouvre (au-dessus : le panneau est en bas de la fenêtre).
    await s.click(reset.handle, ".trigger");
    const [opened] = await waitFor(async () => {
      const ps = await panels(s);
      return ps[0]?.ui.open ? ps : null;
    }, { message: "popover du panneau" });
    assert.equal(opened.ui.title, "Sans ancrage");
    await page.keyboard.press("Escape");
    // Plein écran : panneau masqué.
    await page.click("#fx-fullscreen");
    await waitFor(async () => (await panels(s))[0]?.hidden === true, { message: "panneau masqué en plein écran" });
    await page.evaluate(() => document.exitFullscreen());
    await waitFor(async () => (await panels(s))[0]?.hidden === false, { message: "panneau réaffiché" });
  });

  test("X en mode panneau : le panneau suit la publication à vidéo la plus visible", async () => {
    await ext.setSettings({ inlineButtons: true, platforms: { youtube: true, tiktok: true, twitter: true }, defaultFmt: "mp4", quality: "best", bitrate: 192, floatingPanel: true, panelPosition: null, notifications: false });
    const { page, s } = await open("https://x.com/home");
    const [first] = await waitFor(async () => {
      const ps = await panels(s);
      return ps.length === 1 ? ps : null;
    }, { message: "panneau X" });
    assert.equal((await inline(s)).length, 0, "aucun bouton intégré en mode panneau");
    // Plusieurs publications entièrement visibles : la plus proche du centre de la fenêtre l'emporte.
    assert.ok(["Une vidéo", "Deux vidéos dans la même publication"].includes(first.ui.panelTitle), first.ui.panelTitle);
    await page.evaluate(() => document.querySelector('[data-fixture="x-G"]').scrollIntoView({ block: "center" }));
    await waitFor(async () => (await panels(s))[0]?.ui.panelTitle === "Ma vidéo et une vidéo citée", { message: "panneau sur la publication G" });
    await page.evaluate(() => document.querySelector('[data-fixture="x-C"]').scrollIntoView({ block: "center" }));
    const [c] = await waitFor(async () => {
      const ps = await panels(s);
      return ps[0]?.ui.panelTitle === "Deux vidéos dans la même publication" ? ps : null;
    }, { message: "panneau sur la publication C" });
    assert.equal(c.ui.ctx, "@carol · 2 vidéos");
  });

  test("réglages en direct : plateforme, boutons intégrés, panneau forcé (une seule commande), présélection", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    await waitControls(s, 1, "bouton");
    const base = { inlineButtons: true, platforms: { youtube: true, tiktok: true, twitter: true }, defaultFmt: "mp4", quality: "best", bitrate: 192, floatingPanel: false, panelPosition: null, notifications: false };
    await ext.setSettings({ ...base, platforms: { ...base.platforms, youtube: false } });
    await waitControls(s, 0, "YouTube désactivé");
    assert.equal((await panels(s)).length, 0);
    await ext.setSettings(base);
    await waitControls(s, 1, "YouTube réactivé");
    await ext.setSettings({ ...base, inlineButtons: false });
    await waitControls(s, 0, "boutons intégrés désactivés");
    assert.equal((await panels(s)).length, 0);
    // Panneau forcé : la vidéo est dans le panneau, sans bouton intégré (une seule commande).
    await ext.setSettings({ ...base, floatingPanel: true });
    await waitFor(async () => (await panels(s)).length === 1, { message: "panneau forcé" });
    assert.equal((await inline(s)).length, 0);
    // Présélection MP3 320 kbit/s et qualité 360p proposée en plus.
    await ext.setSettings({ ...base, defaultFmt: "mp3", bitrate: 320, quality: "360" });
    let [c] = await waitControls(s, 1, "bouton intégré de retour");
    await s.click(c.handle, ".trigger");
    [c] = await waitControls(s, 1, "popover", (cs) => cs[0].ui.open);
    assert.deepEqual(c.ui.rows.slice(0, 2).map((r) => r.sub), ["MP4 · 360p", `MP3 · 320${NBSP}kbit/s`]);
    assert.equal(c.ui.bitrate.find((o) => o.checked).label, `320${NBSP}kbit/s`);
    assert.deepEqual(c.ui.quality.map((o) => o.label), ["Meilleure disponible", "1080p", "720p", "480p", "360p"]);
    await page.keyboard.press("Escape");
  });
});

// ---- V3.5 : menu, extrait sur le lecteur de la page, capacités, état du travail ------------------------------
describe("V3.5 : menu, extrait, capacités", () => {
  const VIDEO = readFileSync(new URL("../fixtures/media/extrait-20s.webm", import.meta.url));
  const TT_VIDEO = "https://www.tiktok.com/@alice.test/video/7300000000000000009";
  before(async () => {
    // Vraie vidéo (20 s) servie avec plages d'octets : le navigateur peut y sauter, comme sur une plateforme.
    await env.context.route(/\/__media\/extrait\.webm$/, (route) => {
      const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
      if (!m) return route.fulfill({ status: 200, contentType: "video/webm", headers: { "accept-ranges": "bytes" }, body: VIDEO });
      const a = Number(m[1]);
      const b = m[2] ? Math.min(Number(m[2]), VIDEO.length - 1) : VIDEO.length - 1;
      return route.fulfill({ status: 206, contentType: "video/webm", headers: { "accept-ranges": "bytes", "content-range": `bytes ${a}-${b}/${VIDEO.length}` }, body: VIDEO.subarray(a, b + 1) });
    });
  });
  /** Espion dans le monde isolé du content script : messages envoyés au service worker, réponses forcées. */
  async function spy(s, { caps = null, swallow = [] } = {}) {
    return s.evalInContentScript(env.extensionId, `(() => {
      globalThis.__sent = [];
      globalThis.__caps = ${JSON.stringify(caps)};
      globalThis.__swallow = ${JSON.stringify(swallow)};
      if (!globalThis.__orig) globalThis.__orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (m) => {
        globalThis.__sent.push(JSON.parse(JSON.stringify(m)));
        if (m && m.type === "caps.get" && globalThis.__caps) return Promise.resolve({ ok: true, data: globalThis.__caps });
        if (m && globalThis.__swallow.includes(m.type)) return Promise.resolve({ ok: true, data: { opened: true, shown: true } });
        return globalThis.__orig(m);
      };
      return true;
    })()`);
  }
  const sent = (s) => s.evalInContentScript(env.extensionId, "globalThis.__sent");
  async function withVideo(page, origin, at) {
    await page.evaluate(async ([o, t]) => {
      const v = document.querySelector("video");
      v.removeAttribute("preload");
      v.muted = true;
      v.src = `${o}/__media/extrait.webm`;
      await new Promise((r) => { v.addEventListener("loadeddata", r, { once: true }); v.load(); });
      v.currentTime = t;
      await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
    }, [origin, at]);
  }
  const seekTo = (page, t) => page.evaluate(async (x) => {
    const v = document.querySelector("video");
    v.currentTime = x;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  }, t);

  // 3.6.0 : la vue Extrait est l'éditeur partagé (src/extrait) ; banc détaillé : tests/browser/extraits.test.mjs.
  test("extrait : le lecteur de la page sert de mini-lecteur ; bornes au clavier, « Début = lecteur », « Fin = lecteur », lecture du passage, export avec le passage réglé", async () => {
    const { page, s, errors } = await open(TT_VIDEO);
    let [c] = await waitControls(s, 1, "bouton");
    await withVideo(page, "https://www.tiktok.com", 6);
    await spy(s, { swallow: ["job.start"] });
    await s.click(c.handle, ".trigger");
    await waitControls(s, 1, "menu", (cs) => cs[0].ui.open);
    await s.click(c.handle, ".r-clip");
    [c] = await waitControls(s, 1, "vue Extrait", (cs) => cs[0].ui.view === "clip" && cs[0].ui.clip.empty === false);
    // Réglages par défaut : 30 s à partir de l'instant de lecture (6 s), bornés à la vidéo (20,008 s : à la ms près).
    assert.deepEqual(c.ui.clip.handles, [0, 20.008]);
    assert.equal(c.ui.clip.times, "00:00:00.000 → 00:00:20.008");
    assert.equal(c.ui.clip.len, "0:20");
    assert.equal(c.ui.clip.out, "MP4");
    // Poignée de fin au clavier (Maj+← : − 1 s) : la vidéo de la page montre l'image de la borne.
    await s.click(c.handle, ".tl-h-end");
    await page.keyboard.press("Shift+ArrowLeft");
    [c] = await waitControls(s, 1, "fin à 19,008 s", (cs) => cs[0].ui.clip.handles[1] === 19.008);
    await waitFor(() => page.evaluate(() => Math.abs(document.querySelector("video").currentTime - 19.008) < 0.05), { message: "image de la borne montrée" });
    // « Début = position du lecteur » et « Fin = position du lecteur ».
    await seekTo(page, 4);
    await s.click(c.handle, ".ce-mark-start");
    [c] = await waitControls(s, 1, "début à 4 s", (cs) => cs[0].ui.clip.handles[0] === 4);
    assert.equal(c.ui.clip.len, "0:15");
    await seekTo(page, 5.5);
    await s.click(c.handle, ".ce-mark-end");
    [c] = await waitControls(s, 1, "fin à 5,5 s", (cs) => cs[0].ui.clip.handles[1] === 5.5);
    assert.equal(c.ui.clip.len, "0:01.5");
    // Lecture du passage : elle part du début et s'arrête d'elle-même à la fin.
    await s.click(c.handle, ".ce-play");
    await waitControls(s, 1, "lecture en cours", (cs) => cs[0].ui.clip.playing);
    await waitControls(s, 1, "lecture arrêtée à la fin", (cs) => !cs[0].ui.clip.playing, { timeout: 8000 });
    const t = await page.evaluate(() => ({ t: document.querySelector("video").currentTime, paused: document.querySelector("video").paused }));
    assert.ok(t.paused && t.t >= 5.3 && t.t <= 5.8, `arrêt à la fin du passage (${JSON.stringify(t)})`);
    // GIF : la note le dit (aucune limite fixe : celle du serveur) ; export : le passage réglé part tel quel au service worker.
    await s.click(c.handle, ".ce-fmt .ce-opt", "GIF");
    [c] = await waitControls(s, 1, "GIF choisi", (cs) => cs[0].ui.clip.out === "GIF");
    assert.equal(c.ui.clip.note, "Image animée, sans son.");
    await page.waitForTimeout(300);
    await s.click(c.handle, ".ce-go");
    const m = await waitFor(async () => (await sent(s)).find((x) => x.type === "job.start"), { message: "job.start envoyé" });
    assert.deepEqual({ clip: m.clip, gif: m.gif, fmt: m.fmt, url: m.url }, { clip: { start: 4, end: 5.5 }, gif: true, fmt: "mp4", url: TT_VIDEO });
    assert.deepEqual(errors, []);
  });

  test("capacités : plateforme en pause côté serveur → explication et actions du serveur grisées ; Tools fermé → caché", async () => {
    const { s } = await open(TT_VIDEO);
    let [c] = await waitControls(s, 1, "bouton");
    await spy(s, { caps: { tools: false, paused: ["tiktok"] } });
    await s.click(c.handle, ".trigger");
    [c] = await waitControls(s, 1, "menu avec les capacités", (cs) => cs[0].ui.open && cs[0].ui.paused !== null);
    assert.match(c.ui.paused, /^TikTok est en pause côté serveur/);
    assert.deepEqual(Object.fromEntries(c.ui.rows.map((r) => [r.row, r.disabled])), { video: true, audio: true, clip: true, frame: false, thumb: false });
    assert.ok((await sent(s)).some((m) => m.type === "caps.get"));
  });

  test("état du travail : le menu se résume à la conversion (« Annuler »), puis « Afficher » une fois enregistré", async () => {
    const { s } = await open(TT_VIDEO);
    let [c] = await waitControls(s, 1, "bouton");
    await spy(s, { swallow: ["job.cancel", "download.show"] });
    const job = (state, extra = {}) => ({ key: "jobkeyv35a01", url: TT_VIDEO, platform: "tiktok", fmt: "mp4", quality: "best", state, createdAt: 1, updatedAt: Date.now(), ...extra });
    await ext.jobUpdate(job("converting", { progress: 30 }));
    await s.click(c.handle, ".trigger");
    [c] = await waitControls(s, 1, "menu : état seul", (cs) => cs[0].ui.open && cs[0].ui.status?.cancel === true);
    assert.equal(c.ui.rows.length, 0, "pendant un travail, aucune ligne grisée");
    assert.equal(c.ui.status.state, `Conversion… 30${NBSP}%`);
    await s.click(c.handle, ".sbtn.cancel");
    await waitFor(async () => (await sent(s)).some((m) => m.type === "job.cancel" && m.key === "jobkeyv35a01"), { message: "job.cancel envoyé" });
    await ext.jobUpdate(job("done", { progress: 100 }));
    [c] = await waitControls(s, 1, "enregistré : Afficher", (cs) => cs[0].ui.status?.show === true && cs[0].ui.status.cancel === false);
    assert.ok(c.ui.rows.length >= 4, "les actions reviennent");
    await s.click(c.handle, ".sbtn.show");
    await waitFor(async () => (await sent(s)).some((m) => m.type === "download.show" && m.key === "jobkeyv35a01"), { message: "download.show envoyé" });
  });

  test("YouTube : « Tools » de la barre ouvre la vidéo dans AETHRYON Tools, « Continuer dans Tools » de l'extrait garde le passage", async () => {
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    let [c] = await waitControls(s, 1, "barre");
    await withVideo(page, YT, 3);
    await spy(s, { swallow: ["tools.open"] });
    await s.click(c.handle, ".tb-tools");
    let m = await waitFor(async () => (await sent(s)).find((x) => x.type === "tools.open"), { message: "tools.open" });
    assert.deepEqual(m, { type: "tools.open", url: `${YT}/watch?v=dQw4w9WgXcQ` });
    await s.click(c.handle, ".tb-clip");
    [c] = await waitControls(s, 1, "vue Extrait depuis la barre", (cs) => cs[0].ui.open && cs[0].ui.view === "clip" && !cs[0].ui.clip.empty);
    assert.equal(c.ui.clip.tools, true);
    await s.evalInContentScript(env.extensionId, "globalThis.__sent.length = 0");
    await s.click(c.handle, ".ce-tools");
    m = await waitFor(async () => (await sent(s)).find((x) => x.type === "tools.open"), { message: "tools.open avec le passage" });
    // 30 s à partir de 3 s dans une vidéo de 20,008 s : le passage glisse pour garder sa durée → toute la vidéo (à la ms).
    assert.deepEqual(m, { type: "tools.open", url: `${YT}/watch?v=dQw4w9WgXcQ`, clip: { start: 0, end: 20.008 } });
  });
});

// ---- Périmètre et réseau ---------------------------------------------------------------------------
describe("Périmètre", () => {
  test("Instagram : aucun content script, aucune commande", async () => {
    const { page, s } = await open("https://www.instagram.com/reel/Cxyz123/");
    await page.waitForTimeout(800);
    assert.equal((await s.controls()).length, 0);
    assert.deepEqual(await ext.detect(), []);
  });

  test("aucune requête n'a atteint le réseau : pages fabriquées servies, tout le reste bloqué", () => {
    const fixtureHosts = /^https:\/\/(www\.youtube\.com|www\.tiktok\.com|x\.com|twitter\.com|www\.instagram\.com)\//;
    for (const u of env.log.served) assert.match(u, fixtureHosts, u);
    // Tout ce qui visait une plateforme sans être un fixture (affiches, CDN) a été bloqué.
    const blockedPlatform = env.log.blocked.filter((u) => {
      try {
        return PLATFORM_HOST.test(new URL(u).hostname);
      } catch {
        return false;
      }
    });
    assert.ok(env.log.served.length > 10);
    assert.ok(blockedPlatform.length > 0, "les affiches pbs.twimg.com / tiktokcdn.com ont bien été bloquées");
  });
});

// ---- 3.5.1 : destination Premiere Pro (3.5.2 : « Envoyer vers » › « Premiere Pro ») ------------------------
describe("3.5.1 : destination Premiere Pro dans le menu", () => {
  // 3.8.1 : l'envoi vers Premiere Pro passe par AETHRYON Desktop (texte du menu changé par b0f407f ; cet essai, resté
  // sur l'ancien texte, échouait depuis — essai périmé, corrigé au lot 3 d'Égide).
  const HINT = "AETHRYON Desktop convertit la vidéo, l’enregistre dans sa bibliothèque et l’importe dans Premiere Pro.";

  test("menu : Téléchargements par défaut ; Premiere Pro au clic et aux flèches, mémorisé ; explication jusqu'au premier envoi ; job.start avec dest", async () => {
    await ext.clearSettings();
    const sw = env.context.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
    assert.ok(sw, "service worker de l'extension");
    // Requêtes job.start reçues par le VRAI service worker (écouteur de test ajouté, sans réponse).
    await sw.evaluate(() => {
      self.__starts = [];
      chrome.runtime.onMessage.addListener((m) => { if (m && m.type === "job.start") self.__starts.push(m); });
    });
    const starts = () => sw.evaluate(() => self.__starts);
    const { page, s, errors } = await open(`${YT}/watch?v=dQw4w9WgXcQ&title=Ma%20vid%C3%A9o%20de%20test`);
    let [c] = await waitControls(s, 1, "barre");
    await s.click(c.handle, ".tb-dl");
    [c] = await waitControls(s, 1, "menu ouvert", (cs) => cs[0].ui.open && cs[0].ui.view === "main");
    const d0 = c.ui.dest;
    assert.equal(d0.shown, true);
    assert.equal(d0.role, "radiogroup");
    assert.equal(d0.legend, "Envoyer vers");
    assert.deepEqual(d0.options, [
      { label: "Téléchargements", role: "radio", checked: true, tabindex: "0" },
      { label: "Premiere Pro", role: "radio", checked: false, tabindex: "-1" },
    ]);
    assert.equal(d0.note, null);
    assert.deepEqual(d0.describedBy, []);
    assert.equal(c.ui.rows[0].sub, "MP4 · meilleure disponible");

    // Clic : Premiere Pro choisi, mémorisé (storage.sync), explication montrée, vidéo en H.264.
    await s.click(c.handle, ".d-seg .opt", "Premiere Pro");
    [c] = await waitControls(s, 1, "Premiere Pro choisi", (cs) => cs[0].ui.dest.options[1].checked);
    assert.equal(c.ui.open, true, "le menu reste ouvert");
    assert.equal(c.ui.dest.note, HINT);
    assert.deepEqual(c.ui.dest.describedBy, [HINT], "explication liée au groupe (lue avec le choix)");
    assert.equal(c.ui.rows[0].sub, "MP4 H.264 · auto, jusqu’à 1080p");
    assert.equal(c.ui.rows[1].sub, `MP3 · 192${NBSP}kbit/s`);
    await waitFor(async () => (await ext.getSettings())?.destination === "premiere", { message: "destination enregistrée" });

    // Clavier : un seul arrêt de tabulation, ← → pour changer (sans toucher aux raccourcis de la page).
    const focused = () => s.callOn({ backendNodeId: c.handle.shadowBackend }, function () { return this.activeElement ? `${this.activeElement.tagName.toLowerCase()}.${[...this.activeElement.classList].join(".")}[${this.activeElement.getAttribute("data-dest")}]` : null; });
    assert.equal(await focused(), "button.opt[premiere]", "le focus reste sur le choix");
    await page.keyboard.press("ArrowLeft");
    [c] = await waitControls(s, 1, "retour à Téléchargements", (cs) => cs[0].ui.dest.options[0].checked);
    assert.equal(await focused(), "button.opt[downloads]");
    assert.equal(c.ui.dest.note, null);
    await waitFor(async () => (await ext.getSettings())?.destination === "downloads", { message: "Téléchargements enregistré" });
    await page.keyboard.press("ArrowRight");
    [c] = await waitControls(s, 1, "Premiere Pro aux flèches", (cs) => cs[0].ui.dest.options[1].checked && cs[0].ui.dest.options[1].tabindex === "0");
    await waitFor(async () => (await ext.getSettings())?.destination === "premiere", { message: "Premiere enregistré" });

    // « Télécharger la vidéo » : job.start avec dest « premiere » ; l'explication a servi.
    await s.click(c.handle, ".r-video");
    const premiere = await waitFor(async () => (await starts()).at(-1) ?? null, { message: "job.start reçu" });
    assert.deepEqual(premiere, { type: "job.start", url: `${YT}/watch?v=dQw4w9WgXcQ`, fmt: "mp4", quality: "best", title: premiere.title, dest: "premiere" });
    await waitFor(async () => (await ext.getSettings())?.premiereHintSeen === true, { message: "explication marquée vue" });
    // Hors connexion dans ce banc : « Connexion requise », menu de nouveau utilisable.
    [c] = await waitControls(s, 1, "état affiché", (cs) => cs[0].ui.status && !["sending"].includes(cs[0].ui.status.phase), { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await waitControls(s, 1, "fermé", (cs) => !cs[0].ui.open);
    await s.click(c.handle, ".tb-au");
    [c] = await waitControls(s, 1, "menu rouvert", (cs) => cs[0].ui.open);
    assert.equal(c.ui.dest.options[1].checked, true, "choix gardé");
    assert.equal(c.ui.dest.note, null, "explication plus montrée après le premier envoi");

    // Téléchargements : requête identique à la 3.5.0 (aucun champ dest).
    await s.click(c.handle, ".d-seg .opt", "Téléchargements");
    [c] = await waitControls(s, 1, "Téléchargements", (cs) => cs[0].ui.dest.options[0].checked);
    await s.click(c.handle, ".r-audio");
    const normal = await waitFor(async () => { const l = await starts(); return l.length >= 2 ? l.at(-1) : null; }, { message: "second job.start" });
    assert.equal("dest" in normal, false);
    assert.equal(normal.fmt, "mp3");
    assert.deepEqual(errors, []);
    await s.detach();
    await page.close();
    await ext.clearSettings();
  });

  test("Premiere Pro + 2160p (qualité des réglages) : avertissement de réencodage ; réglages appliqués aux menus ouverts ensuite", async () => {
    await ext.setSettings({ destination: "premiere", premiereHintSeen: true, quality: "2160" });
    const { page, s } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    let [c] = await waitControls(s, 1, "barre");
    await s.click(c.handle, ".tb-dl");
    [c] = await waitControls(s, 1, "menu ouvert", (cs) => cs[0].ui.open);
    assert.equal(c.ui.dest.options[1].checked, true);
    assert.equal(c.ui.dest.note, null);
    assert.equal(c.ui.dest.warn, `Au-delà de 1080p, le serveur réencode la vidéo en H.264 pour Premiere${NBSP}: c’est plus long.`);
    assert.equal(c.ui.rows[0].sub, "MP4 H.264 · 2160p");
    assert.deepEqual(c.ui.quality.map((q) => q.label), ["Auto, jusqu’à 1080p", "2160p", "1080p", "720p", "480p"]);
    await page.close();
    await ext.clearSettings();
  });
});

// ---- Dernier test : il désactive l'extension ---------------------------------------------------------
describe("Extension rechargée (contexte invalidé)", () => {
  test("chrome.runtime.reload() : l'ancienne interface est démontée en silence (aucune erreur dans la page)", async () => {
    const { page, s, errors } = await open(`${YT}/watch?v=dQw4w9WgXcQ`);
    await waitControls(s, 1, "bouton avant rechargement");
    // Rechargement RÉEL de l'extension : le content script déjà injecté devient orphelin
    // (chrome.runtime.id → undefined). Dans ce Chromium de test (extension non empaquetée,
    // --load-extension), l'extension ne revient pas après rechargement : ce test est donc le dernier.
    await ext.page.evaluate(() => setTimeout(() => chrome.runtime.reload(), 10));
    await waitFor(async () => (await s.controls()).length === 0, { timeout: 5000, message: "démontage après rechargement" });
    assert.equal(await page.evaluate(() => document.querySelectorAll("aethryon-control, aethryon-panel").length), 0);
    // Plus aucune réaction : navigation SPA, mutations, plein écran…
    await page.evaluate(() => window.fx.navigate("9bZkp7q19f0", "Après rechargement"));
    await page.evaluate(() => window.fx.rerenderActions());
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.querySelectorAll("aethryon-control, aethryon-panel").length), 0);
    assert.deepEqual(errors, [], "démontage silencieux");
  });
});
