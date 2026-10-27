// Tests navigateur du POPUP et de la page de RÉGLAGES (Chromium réel, extension de développement chargée).
// 3.9.0 (Égide) : popup v2 (360 px, sans défilement, la vidéo d'abord, formats en tuiles, un bouton qui devient la
// progression puis le sceau ; compte, thème et plateformes en vues), thèmes Égide (Obsidian par défaut, Ivory pour le
// second passage d'axe : le thème est un choix de l'utilisateur, plus le schéma de couleurs du système).
//   npm run build:dev && node --test tests/browser/popup.test.mjs      (SKIP_BUILD=1 : pas de reconstruction)
//
// Ce qui est RÉEL : Chromium et l'extension construite (pages, CSS, polices, mascotte, CSP du manifeste),
// chrome.storage.sync (réglages), la messagerie service worker → page pour les « job.update ».
// Ce qui est SIMULÉ : les RÉPONSES du service worker (bouchon dans cette branche) — chrome.runtime.sendMessage
// est remplacé dans la page avant ses scripts —, chrome.tabs.create, chrome.downloads.show,
// chrome.runtime.openOptionsPage et chrome.permissions.* (enregistreurs), et les miniatures (SVG local à la
// place des CDN). Aucune requête vers une plateforme, l'API ou le site.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, OUT, axe, calls, focusId, focusInfo, launch, layout, openPage, pushEvent, pushJob, sent, serious, shoot, shootFull, typography } from "./ui-helpers.mjs";
import { CONSENT_VERSION } from "../support/browser.mjs";

const NB = " ";
const NOW = Date.now();
const iso = (delta) => new Date(NOW + delta).toISOString();
const SITE = "http://localhost:18110"; // site de préproduction de la construction « dev » (scripts/build.mjs)

// ---- jeux de données (fictifs) ---------------------------------------------------------------------
const SETTINGS = { inlineButtons: true, platforms: { youtube: true, tiktok: true, twitter: true }, defaultFmt: "mp4", quality: "1080", bitrate: 192, floatingPanel: false, panelPosition: null, notifications: false };
const RECENT = [
  { createdAt: iso(-3 * 60e3), platform: "youtube", fmt: "mp4", state: "running", errorMessage: null },
  { createdAt: iso(-40 * 60e3), platform: "tiktok", fmt: "mp3", state: "done", errorMessage: null },
  { createdAt: iso(-2 * 3600e3), platform: "x", fmt: "mp4", state: "error", errorMessage: "Contenu privé ou supprimé." },
  { createdAt: iso(-5 * 3600e3), platform: "youtube", fmt: "mp3", state: "done", errorMessage: null },
  { createdAt: iso(-26 * 3600e3), platform: null, fmt: "mp4", state: "refunded", errorMessage: null },
  { createdAt: iso(-50 * 3600e3), platform: "youtube", fmt: "mp4", state: "cancelled", errorMessage: null },
];
const ACCOUNT = { connected: true, name: "Camille Martin", email: "camille.martin@example.com", today: { used: 7, limit: 10, remaining: 3, resetAt: "2026-10-10T22:00:00.000Z" }, activeJobs: 1, expiresAt: "2027-01-08T00:00:00.000Z", recent: RECENT };
const ACCOUNT_AFTER = { ...ACCOUNT, today: { ...ACCOUNT.today, used: 8, remaining: 2 }, activeJobs: 0 };
const UNLIMITED = { ...ACCOUNT, name: undefined, email: "admin@example.com", today: { used: 42, limit: null, remaining: null }, activeJobs: 0, stale: true };
const DISCONNECTED = { connected: false };

const YT = { platform: "youtube", kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ", title: "La nuit des chouettes — documentaire intégral en haute définition", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" };
const X2 = { platform: "twitter", kind: "post", url: "https://x.com/aethryon_demo/status/1790637656616943991", id: "1790637656616943991", title: "Deux angles du même lancer", thumbnail: "https://pbs.twimg.com/ext_tw_video_thumb/1790637656616943991/pu/img/demo.jpg", videoCount: 2 };

const KEY = "job_k8Fz2Qp1";
const job = (over = {}) => ({ key: KEY, jobId: "c0ffee01", url: YT.url, platform: "youtube", fmt: "mp4", quality: "1080", title: YT.title, state: "queued", createdAt: NOW - 90e3, updatedAt: NOW - 1e3, ...over });
const QUEUED = job();
const CONVERTING = job({ state: "converting", progress: 42 });
const DOWNLOADING = job({ state: "downloading", progress: 60, updatedAt: NOW + 1 });
const DONE = job({ state: "done", progress: 100, downloadId: 17, fileName: "La nuit des chouettes [dQw4w9WgXcQ].mp4", updatedAt: NOW + 2 });
const ERR = job({ key: "job_err0000001", platform: "tiktok", url: "https://www.tiktok.com/@atelier.pain/video/7301234567890123456", title: "Recette du pain au levain", fmt: "mp3", quality: undefined, bitrate: 192, state: "error", error: { code: "network", message: "Connexion au serveur interrompue. Réessaie dans un instant.", retryable: true } });
const ERR_FINAL = job({ key: "job_err0000002", platform: "twitter", url: X2.url, title: undefined, state: "error", error: { code: "private_content", message: `Contenu privé ou supprimé${NB}: impossible de le récupérer.`, retryable: false }, updatedAt: NOW - 120e3 });

const CONSENT = { accepted: true, version: CONSENT_VERSION, at: "2026-10-11T08:00:00.000Z" };
const NO_CONSENT = { accepted: false, version: CONSENT_VERSION };
const init = (over = {}) => ({ ok: true, data: { account: ACCOUNT, detected: YT, pageHint: null, jobs: [], settings: SETTINGS, version: "3.0.0", consent: CONSENT, update: null, ...over } });
const ok = (data = null) => ({ ok: true, data });

// ---- outils ----------------------------------------------------------------------------------------
let ext;
const report = { screenshots: [], axe: [], typography: [] };

before(async () => { ext = await launch(); });
after(async () => {
  await ext?.close();
  writeFileSync(join(OUT, "rapport-popup.json"), JSON.stringify(report, null, 2));
});

const popup = (fixture, opts) => openPage(ext, "popup/popup.html", fixture, opts);
async function options(fixture, opts) {
  const r = await openPage(ext, "options/options.html", fixture, opts);
  await r.page.setViewportSize({ width: 760, height: 900 });
  return r;
}

const text = (page, sel) => page.locator(sel).first().textContent();
const waitText = (page, sel, t) => page.waitForFunction(([s, x]) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(x)), [sel, t], { timeout: 5000 });
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const has = async (page, sel) => (await page.locator(sel).count()) > 0;

/** Accessibilité (axe, clair ET sombre), typographie, CSP, console, requêtes externes ; captures des deux thèmes. */
async function audit(page, errors, name, { full = false, defile = false } = {}) {
  const problems = [];
  // Égide : le thème est un CHOIX (Obsidian par défaut) ; second passage en Ivory (thème clair officiel).
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-eg-theme", t), scheme === "light" ? "ivory" : "obsidian");
    await page.waitForTimeout(450); // fondus et transitions de couleur terminés (≤ 320 ms)
    // Machine chargée : on attend en plus la fin réelle des transitions (pas la respiration infinie de la chouette,
    // ni une animation en pause — la chouette sous le pli du popup est mise en pause et ne finirait jamais).
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity && a.playState !== "paused")
      .map((a) => a.finished.catch(() => undefined))));
    const v = await axe(page);
    report.axe.push({ name, scheme, violations: v });
    const bad = serious(v);
    if (bad.length) problems.push(`${name}/${scheme} axe ${JSON.stringify(bad)}`);
    const label = scheme === "light" ? "clair" : "sombre";
    report.screenshots.push(await shoot(page, `${name}-${label}`));
    if (full) report.screenshots.push(await shootFull(page, `${name}-${label}-complet`));
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-eg-theme", "obsidian"));
  // Popup : contrôles d'au moins 32 px de haut, 360 px de large, 600 px de haut au plus, SANS défilement (Égide).
  // Réglages : cibles d'au moins 24 px (WCAG 2.5.8), aucun débordement horizontal.
  const isPopup = await page.evaluate(() => document.documentElement.classList.contains("popup"));
  const l = await layout(page, isPopup ? 32 : 24);
  if (l.small.length) problems.push(`${name} cibles trop petites ${JSON.stringify(l.small)}`);
  if (l.overflowX > 0) problems.push(`${name} débordement horizontal ${l.overflowX}px`);
  if (isPopup && (l.width !== 360 || l.height > 600)) problems.push(`${name} dimensions du popup ${l.width}×${l.height}`);
  if (isPopup && !defile) {
    const mesure = await page.evaluate(() => { const m = document.querySelector("main"); return m ? m.scrollHeight - m.clientHeight : 0; });
    if (mesure > 1) problems.push(`${name} défilement de ${mesure}px`);
  }
  const typo = await typography(page);
  report.typography.push({ name, typo });
  if (typo.length) problems.push(`${name} typographie ${JSON.stringify(typo)}`);
  const csp = await page.evaluate(() => window.__csp);
  if (csp.length) problems.push(`${name} CSP ${csp.join(" | ")}`);
  if (errors.length) problems.push(`${name} console ${errors.join(" | ")}`);
  if (ext.external.length) problems.push(`${name} requêtes externes ${ext.external.join(" ")}`);
  assert.deepEqual(problems, []);
}

const savedShown = (page) => page.evaluate(() => /Enregistr/i.test(document.body.innerText));
/** Égide : la chouette maître (une par vue) et son état réel (idle, curious, processing, success, error). */
const mood = (page) => page.evaluate(() => document.querySelector(".p-chouette")?.dataset.state ?? null);
const waitMood = (page, m) => page.waitForFunction((x) => document.querySelector(".p-chouette")?.dataset.state === x, m, { timeout: 5000 });
/** Ouvre une vue de la barre (compte, thème). */
const openView = async (page, id) => { await page.locator(`#${id}`).click(); await page.waitForSelector(".view-title"); };
const lastStart = async (page) => (await sent(page)).filter((m) => m.type === "job.start").at(-1);

// ---- construction ---------------------------------------------------------------------------------
test("pages construites : aucun script en ligne, aucun style en ligne, aucun innerHTML", () => {
  for (const page of ["popup/popup.html", "options/options.html", "welcome/welcome.html"]) {
    const html = readFileSync(join(DIST, page), "utf8");
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${page} : attribut style`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${page} : script en ligne`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page} : gestionnaire en ligne`);
    assert.doesNotMatch(html, /(https?:)?\/\/(fonts\.|cdn|unpkg)/i, `${page} : ressource externe`);
  }
  for (const js of ["popup/popup.js", "options/options.js", "welcome/welcome.js"]) {
    const src = readFileSync(join(DIST, js), "utf8");
    assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/, `${js} : HTML injecté`);
  }
});

// ---- popup ----------------------------------------------------------------------------------------
test("non connecté : invitation à se connecter, téléchargement désactivé et expliqué", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ account: DISCONNECTED }) } });
  await waitText(page, "#conn-label", "Non connecté");
  assert.equal(await text(page, "#hero-title"), "Connecte-toi");
  assert.equal(await text(page, ".hero-text"), "Même compte et même quota que sur le site.");
  assert.ok(await page.locator("[data-action=login]").isEnabled());
  assert.equal(await page.locator("[data-action=login]").textContent(), "Se connecter à AETHRYON");
  // Égide : peu de texte, une seule action (se connecter) ; aucun réglage ni bouton de téléchargement inactif.
  assert.equal(await page.locator("[data-action=start]").count(), 0, "pas de bouton Télécharger avant la connexion");
  assert.equal(await page.locator('input[name="fmt"]').count(), 0, "pas de formats avant la connexion");
  assert.equal(await has(page, "#account"), false, "pas de section compte");
  assert.equal(await mood(page), "idle");
  // La vidéo de l'onglet reste visible : l'utilisateur voit ce qu'il pourra télécharger.
  assert.equal(await text(page, ".media-title"), YT.title);
  await audit(page, errors, "popup-non-connecte");
  await page.close();
});

test("connexion : attente honnête pendant la fenêtre AETHRYON, puis compte affiché", async () => {
  const { page, errors } = await popup({
    responses: { "popup.init": [init({ account: DISCONNECTED }), init()], "auth.login": ok(ACCOUNT) },
    delays: { "auth.login": 900 },
  });
  await page.locator("[data-action=login]").click();
  await waitText(page, ".login-status", "Une fenêtre AETHRYON s'ouvre");
  assert.equal(await page.locator("[data-action=login]").getAttribute("aria-busy"), "true");
  assert.equal(await text(page, "[data-action=login] .btn-label"), "Connexion en cours…");
  assert.equal(await text(page, ".login-status"), `Une fenêtre AETHRYON s'ouvre${NB}: connecte-toi, puis autorise l'extension.`);
  report.screenshots.push(await shoot(page, "popup-connexion-en-cours-clair"));
  await waitText(page, "#conn-label", "Connecté");
  // (Égide : la disponibilité des plateformes, platforms.get, est lue à part après l'accord ; elle ne compte pas ici.)
  const types = (await sent(page)).map((m) => m.type).filter((t) => t !== "platforms.get");
  assert.deepEqual(types, ["popup.init", "auth.login", "popup.init"]);
  assert.deepEqual((await sent(page)).find((m) => m.type === "auth.login"), { type: "auth.login" });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "start", "focus sur Télécharger");
  assert.deepEqual(errors, []);
  await page.close();
});

test("connexion refusée : message du service worker affiché, bouton à nouveau utilisable", async () => {
  const message = `Connexion annulée${NB}: la fenêtre a été fermée.`;
  const { page } = await popup({ responses: { "popup.init": init({ account: DISCONNECTED }), "auth.login": { ok: false, error: { code: "auth_cancelled", message, retryable: true } } } });
  await page.locator("[data-action=login]").click();
  await waitText(page, ".login [role=alert]", message);
  assert.ok(await page.locator("[data-action=login]").isEnabled());
  assert.equal(await page.locator("[data-action=login]").getAttribute("aria-busy"), null);
  assert.equal(await text(page, "[data-action=login] .btn-label"), "Se connecter à AETHRYON");
  await waitMood(page, "error");
  await page.close();
});

test("connecté + vidéo YouTube : carte, miniature sûre sans décalage, préférences, job.start exact", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init(), "job.start": ok(QUEUED) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await text(page, ".media-platform"), "YouTube · Vidéo");
  assert.equal(await text(page, ".media-title"), YT.title);
  assert.equal(await text(page, ".media-url"), "youtube.com/watch?v=dQw4w9WgXcQ");
  // Miniature : URL acceptée par safeThumbnail, boîte 16:9 fixe avant ET après chargement.
  const img = page.locator(".thumb-img");
  assert.equal(await img.getAttribute("src"), YT.thumbnail);
  assert.equal(await img.getAttribute("referrerpolicy"), "no-referrer");
  await page.waitForFunction(() => document.querySelector(".thumb")?.dataset.loaded === "true");
  const box = await page.locator(".thumb").boundingBox();
  assert.equal(Math.round(box.width), 112);
  assert.equal(Math.round(box.height), 63);
  // Préférences du compte (settings) : MP4 et 1080p présélectionnés ; débit masqué.
  assert.ok(await page.locator('input[name="fmt"][value="mp4"]').isChecked());
  assert.equal(await page.locator("#quality").inputValue(), "1080");
  assert.equal(await text(page, ".tuile-select .field-label"), "Qualité");
  assert.equal(await page.locator("#quality").getAttribute("aria-label"), "Qualité");
  assert.ok(await page.locator("#quality").isVisible());
  assert.equal(await page.locator("#bitrate").isVisible(), false);
  assert.equal(await page.locator("#quality option").allTextContents().then((t) => t.join(",")), "Auto,2160p,1440p,1080p,720p,480p,360p");
  assert.equal(await savedShown(page), false);
  await audit(page, errors, "popup-video-youtube", { full: true });

  await page.locator("[data-action=start]").click();
  await waitText(page, ".job-status-text", "En file d'attente");
  assert.deepEqual(await lastStart(page), { type: "job.start", url: YT.url, fmt: "mp4", quality: "1080", title: YT.title });
  assert.ok(await has(page, "li.job [data-action=cancel]"), "« Annuler » pour un job en file");
  assert.equal(await savedShown(page), false, "« Enregistré » jamais pour un job en file");
  await page.close();
});

test("3.5.1 : destination Premiere Pro — choix mémorisé, explication jusqu'au premier envoi, job.start avec dest ; Téléchargements inchangé", async () => {
  await ext.sw.evaluate(() => chrome.storage.sync.clear());
  // Le travail de cette vidéo prend la place du bouton : une réponse « done » libère le formulaire pour le second envoi.
  const { page, errors } = await popup({ responses: { "popup.init": init(), "job.start": ok({ ...DONE, dest: "premiere" }) }, permissions: { grant: true, initiallyGranted: true } });
  await waitText(page, "#conn-label", "Connecté");
  const sync = () => page.evaluate(async () => (await chrome.storage.sync.get("settings")).settings ?? {});
  assert.ok(await page.locator('input[name="dest"][value="downloads"]').isChecked(), "Téléchargements par défaut");
  assert.equal(await text(page, ".dest-field legend"), "Envoyer vers", "3.5.2 : « Envoyer vers » › « Premiere Pro »");
  assert.equal(await page.locator("#dest-note").isVisible(), false);
  assert.equal(await page.locator('#quality option[value="best"]').textContent(), "Auto");
  await page.locator('label.seg-opt:has(input[name="dest"][value="premiere"])').click();
  assert.ok(await page.locator('input[name="dest"][value="premiere"]').isChecked());
  // 3.8.1 : AETHRYON Desktop convertit et importe (texte changé par b0f407f ; l'essai était resté sur l'ancien : périmé).
  assert.equal(await text(page, "#dest-note span"), "AETHRYON Desktop convertit la vidéo, l'enregistre dans sa bibliothèque et l'importe dans Premiere Pro.");
  assert.equal(await page.locator('#quality option[value="best"]').textContent(), "Auto (≤ 1080p)");
  assert.equal(await text(page, "[data-action=start] .btn-label"), "Importer dans Premiere Pro", "le bouton dit où va le fichier");
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.destination === "premiere");
  await audit(page, errors, "popup-premiere");
  await page.locator("[data-action=start]").click();
  await waitText(page, ".job-status-text", "Importé dans Premiere Pro");
  assert.deepEqual(await lastStart(page), { type: "job.start", url: YT.url, fmt: "mp4", quality: "1080", title: YT.title, dest: "premiere" });
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.premiereHintSeen === true);
  assert.equal(await page.locator("#dest-note").isVisible(), true, "toujours lisible dans ce popup ; plus montrée au prochain");
  // Retour à Téléchargements : requête identique à la 3.5.0 (aucun champ dest).
  await page.locator('label.seg-opt:has(input[name="dest"][value="downloads"])').click();
  assert.equal(await page.locator("#dest-note").isVisible(), false);
  await page.locator("[data-action=start]").click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(200);
  const last = await lastStart(page);
  assert.equal("dest" in last, false);
  assert.equal((await sync()).destination, "downloads");
  await page.close();
  await ext.sw.evaluate(() => chrome.storage.sync.clear());
});

test("3.5.2 : « Premiere Pro » demande DANS le geste le lien avec AETHRYON Desktop ; refus → « Autoriser » (fichier quand même dans AETHRYON) ; envoi non suivi → ligne calme", async () => {
  await ext.sw.evaluate(() => chrome.storage.sync.clear());
  const { page, errors } = await popup({ responses: { "popup.init": init(), "job.start": ok(QUEUED) }, permissions: { grant: false } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.locator("#dest-link").isVisible(), false, "Téléchargements : rien à autoriser");
  assert.deepEqual((await calls(page)).permRequest, [], "rien demandé à l'ouverture");
  await page.locator('label.seg-opt:has(input[name="dest"][value="premiere"])').click();
  await page.waitForFunction(() => window.__calls.permRequest.length === 1);
  const c = await calls(page);
  assert.deepEqual(c.permRequest[0].req, { permissions: ["nativeMessaging"] });
  assert.equal(c.permRequest[0].userActivation, true, "demande faite dans le geste de l'utilisateur");
  await page.locator("#dest-link").waitFor({ state: "visible" });
  // 3.8.1 : texte changé par b0f407f (essai périmé jusqu'ici).
  assert.equal(await text(page, "#dest-link-text"), `Pour envoyer vers Premiere Pro, autorise le lien local avec AETHRYON Desktop${NB}: c'est lui qui convertit et importe.`);
  assert.ok(await page.locator('input[name="dest"][value="premiere"]').isChecked(), "refus : la destination reste Premiere Pro");
  assert.equal(await page.locator(".form-error").first().textContent(), "", "aucune erreur affichée");
  await audit(page, errors, "popup-premiere-autoriser");
  // « Autoriser » : nouvelle demande, accordée cette fois → la ligne disparaît.
  await page.evaluate(() => { window.__permGrant = true; });
  await page.locator("[data-action=desktop-allow]").click();
  await page.waitForFunction(() => window.__calls.permRequest.length === 2);
  assert.equal((await calls(page)).permRequest[1].userActivation, true);
  await page.locator("#dest-link").waitFor({ state: "hidden" });
  // Envoi vers Premiere que l'hôte du Desktop n'a pas reçu : une ligne calme, l'envoi reste « Enregistré ».
  await pushJob(ext, { ...DONE, key: "premiere-absent-1", dest: "premiere", desktop: "absent" });
  const li = page.locator('li.job[data-key="premiere-absent-1"]');
  await li.waitFor();
  assert.equal(await li.locator(".job-note").textContent(), "Installe AETHRYON Desktop pour suivre l'envoi");
  assert.equal(await li.locator(".job-status").getAttribute("data-tone"), "ok");
  assert.equal(await li.locator(".job-status-text").textContent(), "Importé dans Premiere Pro");
  await pushJob(ext, { ...DONE, key: "premiere-suivi-1", dest: "premiere", desktop: "suivi", updatedAt: NOW + 5 });
  await page.locator('li.job[data-key="premiere-suivi-1"]').waitFor();
  assert.equal(await page.locator('li.job[data-key="premiere-suivi-1"] .job-note').count(), 0, "suivi : aucune ligne de plus");
  // État chargé (explication du premier envoi vers Premiere Pro + deux envois terminés, chacun avec sa ligne « Installe
  // AETHRYON Desktop ») : le popup peut défiler ici, l'action et le résultat restent en haut. Mesuré : 53 px.
  await audit(page, errors, "popup-premiere-desktop-absent", { defile: true });
  await page.close();
  await ext.sw.evaluate(() => chrome.storage.sync.clear());
});

test("clavier seul : MP3 aux flèches, débit au clavier, Entrée sur Télécharger → job.start (bitrate seulement)", async () => {
  const { page } = await popup({ responses: { "popup.init": init(), "job.start": ok(job({ fmt: "mp3", quality: undefined, bitrate: 320 })) } });
  await waitText(page, "#conn-label", "Connecté");
  await page.keyboard.press("Tab"); // Égide : Compte
  await page.keyboard.press("Tab"); // Thème
  await page.keyboard.press("Tab"); // Réglages
  await page.keyboard.press("Tab"); // groupe « Vidéo / Passage » (Vidéo cochée)
  let f = await focusInfo(page);
  assert.deepEqual([f.type, f.value], ["radio", "download"]);
  await page.keyboard.press("Tab"); // outil rapide : Image
  await page.keyboard.press("Tab"); // outil rapide : Miniature
  await page.keyboard.press("Tab"); // groupe Format (MP4 coché)
  f = await focusInfo(page);
  assert.equal(f.type, "radio");
  assert.equal(f.value, "mp4");
  assert.ok(f.ring, "anneau de focus visible sur la pastille");
  await page.keyboard.press("ArrowRight");
  assert.ok(await page.locator('input[name="fmt"][value="mp3"]').isChecked(), "MP3 choisi au clavier");
  assert.ok(await page.locator("#bitrate").isVisible());
  assert.equal(await page.locator("#quality").isVisible(), false);
  assert.equal(await text(page, ".tuile-select .field-label"), "Débit");
  assert.deepEqual(await page.locator("#bitrate option").allTextContents(), [`128${NB}kbit/s`, `192${NB}kbit/s`, `320${NB}kbit/s`]);
  await page.keyboard.press("Tab");
  f = await focusInfo(page);
  assert.equal(f.tag, "select");
  assert.ok(f.ring);
  await page.keyboard.press("ArrowDown"); // 192 → 320
  assert.equal(await page.locator("#bitrate").inputValue(), "320");
  await page.keyboard.press("Tab"); // 3.5.1 : groupe Destination (Téléchargements coché)
  f = await focusInfo(page);
  assert.deepEqual([f.type, f.value], ["radio", "downloads"]);
  assert.ok(f.ring);
  await page.keyboard.press("Tab");
  f = await focusInfo(page);
  assert.equal(f.action, "start");
  assert.ok(f.ring);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "job.start"));
  assert.deepEqual(await lastStart(page), { type: "job.start", url: YT.url, fmt: "mp3", bitrate: 320, title: YT.title });
  await page.close();
});

test("clavier seul : ordre de tabulation logique, anneaux visibles partout, Réglages au clavier", async () => {
  const { page } = await popup({ responses: { "popup.init": init({ jobs: [DONE] }) } });
  await waitText(page, "#conn-label", "Connecté");
  const seen = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const f = await focusInfo(page);
    assert.ok(f, `élément focalisé à l'étape ${i + 1}`);
    assert.ok(f.ring, `anneau visible : ${JSON.stringify(f)}`);
    seen.push(focusId(f));
  }
  // Égide : barre (compte, thème, réglages), Vidéo / Passage et les outils rapides en icônes sur la même ligne, formats,
  // qualité, destination ; le fichier prêt de cette vidéo (sceau) à la place du bouton avec ses actions (Afficher, Retirer,
  // Nouveau), puis « Télécharger » encore, et le pied (Aide, Droits).
  assert.deepEqual(seen, ["open-account", "open-theme", "open-settings", "radio:download", "frame", "thumb", "radio:mp4", "quality", "radio:downloads", "show", "dismiss", "hero-new", "start", "help-link", "rights-toggle"]);
  await page.keyboard.press("Shift+Tab");
  assert.equal((await focusInfo(page)).id, "help-link");
  // Anneau de focus Égide (non personnalisable) : or clair sur Obsidian.
  assert.equal((await focusInfo(page)).ringColor, "rgb(226, 197, 142)");
  // Réglages ouverts au clavier.
  await page.locator("#open-settings").focus();
  await page.keyboard.press("Enter");
  assert.equal((await calls(page)).options, 1);
  // Thème Ivory : anneau bronze.
  await page.evaluate(() => document.documentElement.setAttribute("data-eg-theme", "ivory"));
  await page.locator("#open-settings").focus();
  await page.keyboard.press("Tab");
  assert.equal((await focusInfo(page)).ringColor, "rgb(122, 95, 56)");
  await page.close();
});

test("publication X avec deux vidéos : choix « Vidéo 2 » envoyé dans job.start (index)", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ detected: X2 }), "job.start": ok(job({ key: "job_x2video02", platform: "twitter", url: X2.url, title: X2.title, index: 2 })) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await text(page, ".media-platform"), "X · Publication");
  assert.equal(await text(page, ".picker legend"), "Cette publication contient 2 vidéos");
  assert.deepEqual(await page.locator(".picker .seg-opt").allTextContents(), ["Vidéo 1", "Vidéo 2"]);
  assert.ok(await page.locator('input[name="video-index"][value="1"]').isChecked());
  await audit(page, errors, "popup-x-deux-videos");
  await page.locator(".picker .seg-opt", { hasText: "Vidéo 2" }).click();
  await page.locator("[data-action=start]").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "job.start"));
  assert.deepEqual(await lastStart(page), { type: "job.start", url: X2.url, fmt: "mp4", quality: "1080", index: 2, title: X2.title });
  await waitText(page, ".job-meta", "Vidéo 2");
  await page.close();
});

test("suivi en direct (vrais messages job.update du service worker) : 42 % → 60 % → Enregistré, mascotte", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ jobs: [CONVERTING] }), "account.refresh": ok(ACCOUNT_AFTER) } });
  await waitText(page, "#conn-label", "Connecté");
  // Conversion sur le serveur : 42 %.
  assert.equal(await text(page, ".job-status-text"), `Conversion sur le serveur…${NB}42${NB}%`);
  const bar = page.locator("li.job [role=progressbar]");
  assert.equal(await bar.getAttribute("aria-valuenow"), "42");
  assert.equal(await bar.getAttribute("aria-valuemin"), "0");
  assert.equal(await bar.getAttribute("aria-valuemax"), "100");
  assert.ok(await has(page, "li.job [data-action=cancel]"));
  assert.equal(await savedShown(page), false);
  // Égide : le bouton est devenu la progression (le nœud « en cours », le fil), les choix se résument en une ligne.
  assert.equal(await page.locator("#hero-slot li.job .eg-noeud[data-etat=cours]").count(), 1);
  assert.equal(await page.locator("[data-action=start]").isVisible(), false);
  assert.equal(await text(page, ".convert-summary"), "MP4 · 1080p → Téléchargements");
  assert.equal(await text(page, "#companion-line"), "Conversion en cours sur le serveur…");
  assert.equal(await page.locator("#companion-line").getAttribute("aria-live"), "polite");
  await audit(page, errors, "popup-conversion-42");

  // Téléchargement : 60 %, toujours pas « Enregistré ».
  await page.locator("li.job [data-action=cancel]").focus();
  await pushJob(ext, DOWNLOADING);
  await waitText(page, ".job-status-text", `Téléchargement…${NB}60${NB}%`);
  assert.equal(await bar.getAttribute("aria-valuenow"), "60");
  assert.equal(await savedShown(page), false, "« Enregistré » absent pendant le téléchargement");
  assert.equal(await text(page, "#companion-line"), "Le navigateur reçoit le fichier…");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "cancel", "le focus reste sur « Annuler »");
  await audit(page, errors, "popup-telechargement-60");

  // Fichier écrit sur le disque : « Enregistré dans Téléchargements », « Afficher », petit saut de joie.
  await page.locator("li.job [data-action=cancel]").focus();
  await pushJob(ext, DONE);
  await waitText(page, ".job-status-text", "Enregistré dans Téléchargements");
  assert.equal(await has(page, "li.job [role=progressbar]"), false);
  assert.equal(await has(page, "li.job [data-action=cancel]"), false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "show", "le focus passe à « Afficher »");
  // Égide : le sceau (chouette maître sur sa médaille) se frappe une fois, à la vraie fin ; le bouton revient.
  await waitMood(page, "success");
  assert.equal(await page.locator("#hero-slot .eg-sceau.eg-sceau--frappe img.eg-chouette").count(), 1);
  assert.equal(await page.locator("[data-action=start]").isVisible(), true);
  assert.equal(await text(page, "#companion-line"), "Fichier enregistré dans Téléchargements.");
  await page.locator("li.job [data-action=show]").click();
  assert.deepEqual((await calls(page)).downloads, [17]);
  // Le quota a changé côté serveur : le popup redemande le compte.
  await waitText(page, "#quota-text", "2 conversions restantes sur 10");
  assert.ok((await sent(page)).some((m) => m.type === "account.refresh"));
  await audit(page, errors, "popup-enregistre");
  await page.close();
});

test("« Enregistré » n'apparaît QUE pour l'état done", async () => {
  const cases = [
    ["queued", QUEUED],
    ["converting (avancement inconnu)", job({ state: "converting" })],
    ["converting", CONVERTING],
    ["downloading", DOWNLOADING],
    ["error", ERR],
    ["cancelled", job({ state: "cancelled" })],
    ["done", DONE],
  ];
  for (const [label, j] of cases) {
    const { page } = await popup({ responses: { "popup.init": init({ jobs: [j] }) } });
    await page.waitForSelector("li.job");
    assert.equal(await savedShown(page), j.state === "done", `${label} : « Enregistré » ${j.state === "done" ? "attendu" : "interdit"}`);
    if (label.includes("inconnu")) {
      const bar = page.locator("li.job [role=progressbar]");
      assert.equal(await bar.getAttribute("aria-valuenow"), null, "pas de valeur inventée");
      assert.equal(await bar.getAttribute("data-indeterminate"), "true");
      assert.equal(await text(page, ".job-status-text"), "Conversion sur le serveur…");
    }
    await page.close();
  }
});

test("erreur réessayable : message, « Réessayer » (job.retry) ; erreur définitive : « Retirer » (job.dismiss)", async () => {
  const { page, errors } = await popup({
    responses: { "popup.init": init({ jobs: [ERR, ERR_FINAL] }), "job.retry": ok(job({ ...ERR, state: "queued", error: undefined, updatedAt: NOW + 5 })), "job.dismiss": ok(null) },
  });
  await page.waitForSelector("li.job");
  const retryable = page.locator(`li.job[data-key="${ERR.key}"]`);
  const final = page.locator(`li.job[data-key="${ERR_FINAL.key}"]`);
  assert.equal(await retryable.locator(".job-status-text").textContent(), ERR.error.message);
  assert.equal(await retryable.locator(".job-status").getAttribute("data-tone"), "bad");
  assert.ok(await retryable.locator("[data-action=retry]").isVisible());
  assert.ok(await retryable.locator("[data-action=dismiss]").isVisible());
  assert.equal(await final.locator("[data-action=retry]").count(), 0, "pas de « Réessayer » si l'erreur n'est pas réessayable");
  assert.equal(await final.locator(".job-title").textContent(), "x.com/aethryon_demo/status/1790637656616943991", "sans titre : lien lisible");
  assert.equal(await savedShown(page), false);
  // Égide : le fil dit l'état par son nœud (anneau rouge), sans chouette dans une liste.
  assert.equal(await page.locator("li.job .eg-noeud[data-etat=err]").count(), 2);
  assert.equal(await text(page, "#companion-line"), "Le dernier téléchargement a échoué.");
  await audit(page, errors, "popup-erreur");

  await retryable.locator("[data-action=retry]").click();
  await waitText(page, `li.job[data-key="${ERR.key}"] .job-status-text`, "En file d'attente");
  assert.ok((await sent(page)).some((m) => m.type === "job.retry" && m.key === ERR.key && Object.keys(m).length === 2));
  await final.locator("[data-action=dismiss]").click();
  await page.waitForFunction((k) => !document.querySelector(`li.job[data-key="${k}"]`), ERR_FINAL.key);
  assert.ok((await sent(page)).some((m) => m.type === "job.dismiss" && m.key === ERR_FINAL.key));
  await page.close();
});

test("annulation : job.cancel envoyé, état « Annulé » et « Retirer »", async () => {
  const { page } = await popup({ responses: { "popup.init": init({ jobs: [CONVERTING] }), "job.cancel": ok(job({ state: "cancelled", updatedAt: NOW + 3 })) } });
  await page.locator("li.job [data-action=cancel]").click();
  await waitText(page, ".job-status-text", "Annulé");
  assert.deepEqual((await sent(page)).find((m) => m.type === "job.cancel"), { type: "job.cancel", key: KEY });
  assert.ok(await has(page, "li.job [data-action=dismiss]"));
  assert.equal(await savedShown(page), false);
  await page.close();
});

test("action refusée par le service worker : message lisible dans la ligne du job", async () => {
  const message = "Ce téléchargement est déjà terminé.";
  const { page } = await popup({ responses: { "popup.init": init({ jobs: [CONVERTING] }), "job.cancel": { ok: false, error: { code: "not_found", message, retryable: false } } } });
  await page.locator("li.job [data-action=cancel]").click();
  await waitText(page, "li.job [role=alert]", message);
  assert.ok(await page.locator("li.job [data-action=cancel]").isEnabled());
  await page.close();
});

test("compte : quota, conversions en cours, liens du site (chrome.tabs.create), 5 entrées récentes avec états", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init() } });
  await waitText(page, "#conn-label", "Connecté");
  // Égide : le compte est une vue ouverte depuis la barre (initiale), la vue principale reste à la vidéo.
  await openView(page, "open-account");
  assert.equal(await page.locator("#open-account").getAttribute("aria-pressed"), "true");
  assert.equal(await text(page, ".identity-name"), "Camille Martin");
  assert.equal(await text(page, ".identity-email"), "camille.martin@example.com");
  assert.equal(await text(page, "#quota-text"), "3 conversions restantes sur 10");
  assert.ok(await has(page, ".account-quota .quota-ring"));
  assert.match(await bodyText(page), /En cours sur le serveur\s*:\s*1 conversion/);
  assert.equal(await page.locator(".recent li").count(), 5, "5 entrées au plus");
  assert.deepEqual(await page.locator(".recent .badge").allTextContents(), ["En cours", "Terminée", "Échec", "Terminée", "Non démarrée"]);
  // Historique : pictogrammes neutres v3 (« x » du serveur = X), aucun pour une source inconnue ; jamais de logo de marque.
  assert.deepEqual(await page.locator(".recent li").evaluateAll((lis) => lis.map((li) => li.querySelector(".recent-main svg")?.dataset.glyph ?? null)),
    ["youtube", "tiktok", "twitter", "youtube", null]);
  assert.equal(await page.locator(".recent .recent-main svg[aria-hidden=true]").count(), 4, "pictogrammes décoratifs (le nom est écrit à côté)");
  assert.equal(await has(page, ".account .note"), false, "pas de note « non actualisées »");
  await page.getByRole("link", { name: "Tableau de bord (nouvel onglet)" }).click();
  await page.getByRole("link", { name: "Historique (nouvel onglet)" }).click();
  await page.getByRole("link", { name: "Aide (nouvel onglet)" }).click();
  assert.deepEqual((await calls(page)).tabs, [`${SITE}/dashboard`, `${SITE}/dashboard/activite`, `${SITE}/aide`]);
  assert.equal(page.url().startsWith("chrome-extension://"), true, "le popup ne navigue pas");
  await audit(page, errors, "popup-compte");
  // Retour : la vue principale, focus rendu au bouton du compte.
  await page.locator("[data-action=back]").click();
  await page.waitForSelector("#media");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "open-account");
  await page.close();
});

test("quota illimité et infos du compte non actualisées", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ account: UNLIMITED, jobs: [DONE] }) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await text(page, "#quota-ring b"), "∞", "anneau illimité dans la barre");
  await openView(page, "open-account");
  assert.equal(await text(page, "#quota-text"), "Illimité aucune limite quotidienne");
  assert.equal(await has(page, ".meter"), false, "pas de jauge sans limite");
  assert.equal(await has(page, "#quota-reset"), false);
  assert.equal(await text(page, ".identity-name"), "admin@example.com");
  assert.equal(await text(page, ".account .note"), "Infos du compte non actualisées");
  assert.match(await bodyText(page), /En cours sur le serveur\s*:\s*aucune conversion/);
  await audit(page, errors, "popup-illimite", { full: true });
  await page.close();
});

test("déconnexion : confirmation en ligne, Échap annule, confirmation → auth.logout puis écran de connexion", async () => {
  const { page } = await popup({ responses: { "popup.init": [init(), init({ account: DISCONNECTED })], "auth.logout": ok(null) } });
  await waitText(page, "#conn-label", "Connecté");
  await openView(page, "open-account");
  await page.locator("[data-action=logout]").click();
  await page.waitForSelector(".confirm");
  assert.equal(await text(page, "#logout-q"), `Se déconnecter de ce navigateur${NB}?`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "logout-cancel", "focus sur « Annuler »");
  await page.locator(".confirm").scrollIntoViewIfNeeded();
  report.screenshots.push(await shoot(page, "popup-deconnexion-confirmation-clair"));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".confirm", { state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "logout", "focus rendu au bouton");
  assert.equal((await sent(page)).some((m) => m.type === "auth.logout"), false, "rien envoyé sans confirmation");
  await page.locator("[data-action=logout]").click();
  await page.locator("[data-action=logout-confirm]").click();
  await waitText(page, "#conn-label", "Non connecté");
  assert.deepEqual((await sent(page)).find((m) => m.type === "auth.logout"), { type: "auth.logout" });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "login", "focus sur la connexion");
  await page.close();
});

test("aucune vidéo sur l'onglet (état B) : indication de la page, illustration atténuée, lien à coller", async () => {
  const hint = "Sur le fil X, utilise le bouton AETHRYON sous la publication qui contient la vidéo.";
  const { page, errors } = await popup({ responses: { "popup.init": init({ detected: null, pageHint: hint }) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await text(page, ".empty-title"), "Aucune vidéo ici");
  assert.equal(await text(page, ".empty-text"), hint);
  assert.ok(await has(page, ".empty .p-chouette .eg-medaille img.eg-chouette"), "état vide : la médaille (chouette maître)");
  assert.equal(await page.locator("[data-action=start]").count(), 0, "rien à télécharger : pas de bouton inactif");
  assert.ok(await page.locator("#paste-url").isVisible(), "V3 : coller le lien d'une vidéo");
  assert.equal(await text(page, "#companion-line"), "Aucun téléchargement pour l'instant.");
  await audit(page, errors, "popup-aucune-video");
  await page.close();

  // Sans indication : texte générique.
  const p2 = await popup({ responses: { "popup.init": init({ detected: null }) } });
  await waitText(p2.page, ".empty-text", "Ouvre une vidéo YouTube, TikTok ou X, ou colle un lien.");
  await p2.page.close();
});

test("miniature refusée (hôte inconnu) ou titre absent : aucune image, boîte fixe, « Titre indisponible »", async () => {
  const detected = { ...YT, title: undefined, thumbnail: "https://evil.example/pixel.jpg" };
  const { page } = await popup({ responses: { "popup.init": init({ detected }) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.locator(".thumb img").count(), 0);
  const box = await page.locator(".thumb").boundingBox();
  assert.equal(Math.round(box.width), 112);
  assert.equal(Math.round(box.height), 63);
  assert.equal(await text(page, ".media-title"), "Titre indisponible");
  assert.deepEqual(ext.external, [], "aucune requête vers l'hôte refusé");
  await page.locator("[data-action=start]").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "job.start"));
  assert.equal("title" in (await lastStart(page)), false, "pas de titre inventé dans job.start");
  await page.close();
});

test("service worker injoignable : message honnête et « Réessayer » qui recharge", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": ["unreachable", init()] } });
  await waitText(page, "#failure-title", "Chargement impossible");
  assert.equal(await text(page, ".failure-text"), "Le service de l'extension ne répond pas. Réessaie dans un instant.");
  assert.equal(await page.locator("#conn").isVisible(), false, "état de connexion inconnu : pas affiché");
  await audit(page, errors, "popup-injoignable");
  await page.locator("[data-action=reload]").click();
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "start");
  await page.close();
});

test("mouvement réduit : la chouette ne bouge jamais ; le sceau apparaît sans déplacement, le fil saute sans glisser", async () => {
  const { page } = await popup({ responses: { "popup.init": init({ jobs: [DOWNLOADING] }) } }, { reducedMotion: "reduce" });
  await page.waitForSelector("#hero-slot li.job .progress");
  const fil = await page.evaluate(() => getComputedStyle(document.querySelector(".progress-fill")).transitionDuration);
  assert.equal(fil, "0s", "progression par sauts");
  await pushJob(ext, DONE);
  await waitMood(page, "success");
  const sceau = await page.evaluate(() => {
    const s = document.querySelector(".eg-sceau");
    const img = s.querySelector("img.eg-chouette");
    return { move: getComputedStyle(document.documentElement).getPropertyValue("--eg-move").trim(), imgAnim: getComputedStyle(img).animationName, imgTransform: getComputedStyle(img).transform };
  });
  assert.equal(sceau.move, "0", "aucun déplacement (frappe sans échelle ni rotation)");
  assert.equal(sceau.imgAnim, "none", "la chouette elle-même n'est jamais animée");
  assert.equal(sceau.imgTransform, "none");
  await page.close();
});

test("messages étrangers ignorés : job.update d'un format invalide n'est pas affiché", async () => {
  const { page } = await popup({ responses: { "popup.init": init() } });
  await waitText(page, "#conn-label", "Connecté");
  await ext.sw.evaluate(() => chrome.runtime.sendMessage({ type: "job.update", job: { key: "x", state: "done", title: "<img src=x onerror=alert(1)>" } }).catch(() => null));
  await page.waitForTimeout(300);
  assert.equal(await page.locator("li.job").count(), 0);
  // Titre piégé MAIS job valide : affiché comme du texte, jamais interprété.
  await pushJob(ext, job({ key: "job_html00001", state: "queued", title: "<img src=x onerror=alert(1)>" }));
  await waitText(page, ".job-title", "<img src=x onerror=alert(1)>");
  assert.equal(await page.locator("li.job img").count(), 0);
  await page.close();
});

// ---- réglages -------------------------------------------------------------------------------------
const OPT = (over = {}, permissions = { grant: false }) => ({ responses: { "popup.init": init(), "auth.logout": ok(null), "auth.login": ok(ACCOUNT), ...over }, permissions });
const stored = (page) => page.evaluate(() => chrome.storage.sync.get("settings").then((r) => r.settings ?? null));
const resetStorage = () => ext.sw.evaluate(() => chrome.storage.sync.clear());
const waitSaved = (page) => page.waitForFunction(() => {
  const s = document.getElementById("save-status");
  return s?.dataset.show === "true" && s.textContent.includes("Enregistré");
}, null, { timeout: 5000 });
const clearSaved = (page) => page.evaluate(() => { const s = document.getElementById("save-status"); s.dataset.show = "false"; s.textContent = ""; });

test("réglages : rendu des 8 sections, valeurs par défaut, accessibilité clair/sombre", async () => {
  await resetStorage();
  const { page, errors } = await options(OPT());
  await page.setViewportSize({ width: 760, height: 900 });
  await waitText(page, "#account-body", "Camille Martin");
  const titles = await page.locator("h2.group-title").allTextContents();
  assert.deepEqual(titles, ["Apparence", "Boutons dans les sites", "Format par défaut", "Envoyer vers", "Qualité MP4", "Débit MP3", "Extraits et outils rapides", "Panneau flottant", "Notifications", "Compte", "Données et confidentialité"]);
  // 3.5.1 : destination, Téléchargements par défaut ; Premiere Pro expliqué (dossier, format).
  assert.ok(await page.locator('input[name="destination"][value="downloads"]').isChecked());
  // 3.8.1 : AETHRYON Desktop convertit et importe (essai périmé jusqu'ici : il attendait le texte de la 3.5).
  assert.match(await text(page, "#d-dest"), /AETHRYON Desktop convertit la vidéo/);
  // Égide : les six thèmes, Obsidian choisi par défaut ; l'éditeur se monte à la demande.
  assert.deepEqual(await page.locator("#themes input[name=theme]").evaluateAll((l) => l.map((i) => `${i.value}${i.checked ? "*" : ""}`)), ["obsidian*", "ivory", "oled", "midnight", "minimal", "custom"]);
  assert.equal(await page.locator("#editor-host").innerHTML(), "");
  assert.equal(await page.locator("h1").textContent(), "Réglages");
  assert.ok(await page.locator("#inline-buttons").isChecked());
  for (const p of ["youtube", "tiktok", "twitter"]) assert.ok(await page.locator(`#pf-${p}`).isChecked());
  assert.ok(await page.locator('input[name="default-fmt"][value="mp4"]').isChecked());
  assert.equal(await page.locator("#quality").inputValue(), "best");
  assert.equal(await page.locator("#bitrate").inputValue(), "192");
  assert.equal(await page.locator("#floating-panel").isChecked(), false);
  assert.equal(await page.locator("#panel-reset").getAttribute("aria-disabled"), "true");
  assert.equal(await page.locator("#notifications").isChecked(), false);
  assert.equal(await text(page, "#save-status"), "", "rien d'affiché avant un changement");
  // Notice exacte (la même que la page d'accueil) : lien canonique + format envoyés au clic, appareil à la connexion.
  const facts = (await text(page, "#disclosure")).replace(/\s+/g, " ");
  for (const part of ["aucun cookie lu", "lien canonique de la vidéo que tu as choisie", "le format (MP4 ou MP3)", "le nom de l'appareil", "30 téléchargements les plus récents"]) {
    assert.ok(facts.includes(part), part);
  }
  assert.doesNotMatch(facts, /Seul le lien/);
  assert.match(await text(page, "#consent-status"), /Tu as accepté cette notice le 11 octobre 2026/);
  assert.match(await text(page, "#rights"), /installation hors store ne change rien aux conditions de YouTube, TikTok et X/);
  await audit(page, errors, "reglages", { full: true });
  await page.close();
});

test("réglages : chaque changement est enregistré aussitôt (storage.sync) avec « Enregistré »", async () => {
  await resetStorage();
  const { page, errors } = await options(OPT());
  await waitText(page, "#account-body", "Camille Martin");

  await page.locator("#inline-buttons").click();
  await waitSaved(page);
  assert.equal((await stored(page)).inlineButtons, false);
  assert.equal(await page.locator("#save-status").getAttribute("role"), "status");
  for (const p of ["youtube", "tiktok", "twitter"]) assert.ok(await page.locator(`#pf-${p}`).isDisabled(), "plateformes sans effet");
  report.screenshots.push(await shoot(page, "reglages-enregistre-clair"));

  await clearSaved(page);
  await page.locator("#inline-buttons").click();
  await waitSaved(page);
  await clearSaved(page);
  await page.locator("#pf-tiktok").click();
  await waitSaved(page);
  assert.deepEqual((await stored(page)).platforms, { youtube: true, tiktok: false, twitter: true });

  await clearSaved(page);
  await page.locator(".seg-opt", { hasText: "MP3 · Audio" }).click();
  await waitSaved(page);
  assert.equal((await stored(page)).defaultFmt, "mp3");

  // 3.5.1 : destination Premiere Pro, puis retour à Téléchargements. 3.5.2 : permission du lien avec AETHRYON
  // Desktop demandée dans le geste ; refus → ligne « Suivi par AETHRYON Desktop » avec « Autoriser ».
  await clearSaved(page);
  assert.equal(await page.locator("#dest-link-row").isVisible(), false);
  await page.locator(".seg-opt", { hasText: "Premiere Pro" }).click();
  await waitSaved(page);
  assert.equal((await stored(page)).destination, "premiere");
  await page.waitForFunction(() => window.__calls.permRequest.some((r) => r.req.permissions?.[0] === "nativeMessaging" && r.userActivation === true));
  await page.locator("#dest-link-row").waitFor({ state: "visible" });
  assert.match(await text(page, "#d-dest-link"), /^Pour envoyer vers Premiere Pro, autorise le lien local avec AETHRYON Desktop/);
  assert.equal(await page.locator("#dest-allow").isVisible(), true);
  await clearSaved(page);
  await page.locator(".seg-dest .seg-opt", { hasText: "Téléchargements" }).click();
  await waitSaved(page);
  assert.equal((await stored(page)).destination, "downloads");

  await clearSaved(page);
  await page.locator("#quality").selectOption("720");
  await waitSaved(page);
  assert.equal((await stored(page)).quality, "720");

  await clearSaved(page);
  await page.locator("#bitrate").selectOption("320");
  await waitSaved(page);
  assert.equal((await stored(page)).bitrate, 320);

  await clearSaved(page);
  await page.locator("#floating-panel").click();
  await waitSaved(page);
  assert.equal((await stored(page)).floatingPanel, true);

  // Position mémorisée par le panneau (écrite ailleurs) : la page suit, puis la réinitialise.
  await ext.sw.evaluate(() => chrome.storage.sync.get("settings").then((r) => chrome.storage.sync.set({ settings: { ...r.settings, panelPosition: { x: 40, y: 320 } } })));
  await waitText(page, "#panel-pos", "Position choisie en déplaçant le panneau.");
  assert.equal(await page.locator("#panel-reset").getAttribute("aria-disabled"), null);
  await clearSaved(page);
  await page.locator("#panel-reset").click();
  await waitSaved(page);
  assert.equal((await stored(page)).panelPosition, null);
  assert.equal(await text(page, "#panel-pos"), "Position par défaut.");
  assert.equal(await page.locator("#panel-reset").getAttribute("aria-disabled"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "panel-reset", "le focus reste sur le bouton");
  assert.deepEqual(errors, []);
  await page.close();
});

test("notifications : demande DANS le geste ; refus → reste désactivé et expliqué ; accord → activé ; coupure → permissions.remove", async () => {
  await resetStorage();
  // Refus
  let { page } = await options(OPT({}, { grant: false }));
  await waitText(page, "#account-body", "Camille Martin");
  await page.locator("#notifications").click();
  await waitText(page, "#notif-msg", "Autorisation refusée");
  let c = await calls(page);
  assert.equal(c.permRequest.length, 1);
  assert.deepEqual(c.permRequest[0].req, { permissions: ["notifications"] });
  assert.equal(c.permRequest[0].userActivation, true, "demande faite pendant le geste de l'utilisateur");
  assert.equal(await page.locator("#notifications").isChecked(), false);
  assert.equal(await text(page, "#notif-msg"), `Autorisation refusée${NB}: les notifications restent désactivées. Tu peux réessayer quand tu veux.`);
  assert.equal((await stored(page))?.notifications ?? false, false);
  report.screenshots.push(await shoot(page, "reglages-notifications-refusees-clair"));
  await page.close();

  // Accord puis coupure
  ({ page } = await options(OPT({}, { grant: true })));
  await waitText(page, "#account-body", "Camille Martin");
  await page.locator("#notifications").click();
  await waitText(page, "#notif-msg", "Notifications activées.");
  assert.ok(await page.locator("#notifications").isChecked());
  assert.equal((await stored(page)).notifications, true);
  await page.locator("#notifications").click();
  await page.waitForFunction(() => window.__calls.permRemove.length === 1);
  c = await calls(page);
  assert.deepEqual(c.permRemove[0], { permissions: ["notifications"] });
  await page.waitForFunction(() => chrome.storage.sync.get("settings").then((r) => r.settings.notifications === false));
  assert.equal(await page.locator("#notifications").isChecked(), false);
  await page.close();

  // Réglage « activé » mais permission retirée hors de la page : l'interface dit la vérité.
  await ext.sw.evaluate(() => chrome.storage.sync.set({ settings: { notifications: true } }));
  ({ page } = await options(OPT({}, { grant: false, initiallyGranted: false })));
  await waitText(page, "#notif-msg", "n'est plus accordée");
  assert.equal(await page.locator("#notifications").isChecked(), false);
  assert.equal((await stored(page)).notifications, false);
  await page.close();
});

test("réglages, compte : connecté (déconnexion confirmée), puis connexion ; lien de révocation sur le site", async () => {
  await resetStorage();
  const { page, errors } = await options(OPT({ "popup.init": [init(), init({ account: DISCONNECTED }), init()] }));
  await waitText(page, "#account-body", "Camille Martin");
  assert.equal(await text(page, "#account-body .badge"), "Connecté");
  assert.equal(await text(page, ".account-quota"), `Aujourd'hui${NB}: 3 conversions restantes sur 10 · Remise à zéro à 00:00`);
  assert.equal(await page.locator("#keys-link").getAttribute("href"), `${SITE}/dashboard/cles`);
  await page.locator("#keys-link").click();
  assert.deepEqual((await calls(page)).tabs, [`${SITE}/dashboard/cles`]);

  await page.locator("#account-body [data-action=logout]").click();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "logout-cancel");
  await page.locator("#account-body [data-action=logout-confirm]").click();
  await waitText(page, "#account-body", "L'extension n'est pas connectée.");
  assert.equal(await text(page, "#account-body .badge"), "Non connecté");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "login");
  await audit(page, errors, "reglages-non-connecte", { full: true });

  await page.locator("#account-body [data-action=login]").click();
  await waitText(page, "#account-body", "Camille Martin");
  assert.deepEqual((await sent(page)).map((m) => m.type), ["popup.init", "auth.logout", "popup.init", "auth.login", "popup.init"]);
  await page.close();
});

test("réglages au clavier : interrupteurs à la barre d'espace, ordre logique, anneaux visibles", async () => {
  await resetStorage();
  const { page } = await options(OPT());
  await waitText(page, "#account-body", "Camille Martin");
  const seen = [];
  for (let i = 0; i < 21; i++) {
    await page.keyboard.press("Tab");
    const f = await focusInfo(page);
    assert.ok(f?.ring, `anneau visible : ${JSON.stringify(f)}`);
    seen.push(focusId(f));
  }
  // Égide : l'apparence d'abord (groupe des six thèmes, éditeur) ; V3 : durée et placement de l'extrait ; 3.5.1 : destination.
  assert.deepEqual(seen, ["radio:obsidian", "editor-toggle", "inline-buttons", "pf-youtube", "pf-tiktok", "pf-twitter", "radio:mp4", "radio:downloads", "quality", "bitrate", "radio:30", "radio:after", "page-tools", "floating-panel", "panel-reset", "notifications", "logout", "keys-link", "consent-withdraw", "privacy-link", "help-link"]);
  // Interrupteur au clavier : focus sur le premier, Espace → enregistré.
  await page.locator("#inline-buttons").focus();
  await page.keyboard.press("Space");
  await waitSaved(page);
  assert.equal((await stored(page)).inlineButtons, false);
  await page.close();
});

// ---- déconnexion imposée par le serveur, compte suspendu (docs/EXTENSION.md §7) ---------------------
const LOST_ADMIN = { reason: "revoked_admin", message: "Un administrateur AETHRYON a révoqué l'accès de cette extension. Reconnecte-la pour continuer.", at: NOW };
const LOST_EXPIRED = { reason: "expired", message: `Connexion expirée (30 jours)${NB}: reconnecte-toi.`, at: NOW };
const LOST_USER = { reason: "revoked_user", message: `Cette extension a été déconnectée de ton compte depuis «${NB}Mes jetons${NB}». Reconnecte-la pour continuer.`, at: NOW };

test("déconnecté par le serveur : motif exact (administrateur, expiration, « Mes jetons »), « Reconnecte-toi », bouton décrit par le motif ; 1x et 2x", async () => {
  for (const [notice, name] of [[LOST_ADMIN, "popup-motif-admin"], [LOST_EXPIRED, "popup-motif-expire"], [LOST_USER, "popup-motif-jetons"]]) {
    const { page, errors } = await popup({ responses: { "popup.init": init({ account: { connected: false, notice } }) } });
    await waitText(page, "#conn-label", "Non connecté");
    assert.equal(await text(page, "#hero-title"), "Reconnecte-toi");
    assert.equal(await text(page, "#auth-notice"), notice.message);
    const login = page.locator("[data-action=login]");
    assert.equal(await login.getAttribute("aria-describedby"), "auth-notice", "motif lu au focus du bouton");
    assert.ok(await login.isEnabled());
    assert.equal(await page.locator("[data-action=start]").count(), 0, "rien à télécharger avant la reconnexion");
    assert.equal(await mood(page), "curious");
    if (notice === LOST_ADMIN) {
      await audit(page, errors, name);
    } else {
      assert.deepEqual(await typography(page), []);
    }
    await page.close();
  }
});

test("compte suspendu : liaison gardée, téléchargement désactivé et expliqué, avis dans la carte du compte", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ account: { ...ACCOUNT, suspended: true } }) } });
  await waitText(page, "#conn-label", "Connecté");
  const start = page.locator("[data-action=start]");
  assert.ok(await start.isDisabled());
  assert.equal(await text(page, "#convert-hint"), `Ton compte AETHRYON est suspendu${NB}: les conversions sont refusées.`);
  assert.equal(await text(page, "#quota .notice"), `Ton compte AETHRYON est suspendu par un administrateur${NB}: les conversions sont refusées.`);
  await start.click({ force: true });
  assert.equal(await lastStart(page), undefined, "aucun job.start");
  await audit(page, errors, "popup-suspendu", { full: true });
  await page.close();
});

test("clé refusée pendant que le popup est ouvert (job.update auth_required) : retour immédiat à la connexion avec le motif, focus sur « Se connecter »", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": [init({ jobs: [CONVERTING] }), init({ account: { connected: false, notice: LOST_USER }, jobs: [] })] } });
  await waitText(page, "#conn-label", "Connecté");
  await pushJob(ext, { ...CONVERTING, state: "error", progress: undefined, updatedAt: NOW + 50, error: { code: "auth_required", message: LOST_USER.message, retryable: false } });
  await waitText(page, "#hero-title", "Reconnecte-toi");
  assert.equal(await text(page, "#auth-notice"), LOST_USER.message);
  await page.waitForFunction(() => document.activeElement?.dataset?.action === "login", null, { timeout: 5000 });
  assert.equal((await sent(page)).filter((m) => m.type === "popup.init").length, 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test("réglages, compte : motif de la déconnexion imposée ; compte suspendu signalé", async () => {
  let r = await options({ responses: { "popup.init": init({ account: { connected: false, notice: LOST_ADMIN } }) } });
  await r.page.waitForSelector("#auth-notice");
  assert.equal(await text(r.page, "#auth-notice"), LOST_ADMIN.message);
  assert.equal(await r.page.locator("[data-action=login]").getAttribute("aria-describedby"), "auth-notice");
  await audit(r.page, r.errors, "reglages-motif-admin");
  await r.page.close();
  r = await options({ responses: { "popup.init": init({ account: { ...ACCOUNT, suspended: true } }) } });
  await waitText(r.page, "#account-body .notice", "suspendu");
  assert.equal(await text(r.page, "#account-body .notice"), `Ton compte AETHRYON est suspendu par un administrateur${NB}: les conversions sont refusées.`);
  await audit(r.page, r.errors, "reglages-suspendu");
  await r.page.close();
});

test("densité 1x (écran standard) : popup connecté, motif de déconnexion, compte suspendu, réglages — axe clair/sombre, captures", async () => {
  // Second navigateur à 1 pixel par pixel CSS (le profil principal est en 2x) : rendu réel, pas une réduction.
  const ext1 = await launch({ dpr: 1 });
  try {
    const cases = [
      ["popup/popup.html", init({ jobs: [CONVERTING, DONE, ERR] }), "popup-connecte-1x"],
      ["popup/popup.html", init({ account: { connected: false, notice: LOST_ADMIN } }), "popup-motif-admin-1x"],
      ["popup/popup.html", init({ account: { ...ACCOUNT, suspended: true } }), "popup-suspendu-1x"],
      ["options/options.html", init(), "reglages-1x"],
    ];
    const problems = [];
    for (const [path, data, name] of cases) {
      const { page, errors } = await openPage(ext1, path, { responses: { "popup.init": data } });
      if (path.startsWith("options")) await page.setViewportSize({ width: 760, height: 900 });
      await page.waitForSelector(path.startsWith("options") ? "#account-body .badge" : "#conn:not([hidden])");
      assert.equal(await page.evaluate(() => devicePixelRatio), 1);
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(450);
        const bad = serious(await axe(page));
        if (bad.length) problems.push(`${name}/${scheme} axe ${JSON.stringify(bad)}`);
        report.screenshots.push(await shoot(page, `${name}-${scheme === "light" ? "clair" : "sombre"}`));
      }
      if (errors.length) problems.push(`${name} console ${errors.join(" | ")}`);
      await page.close();
    }
    if (ext1.external.length) problems.push(`requêtes externes ${ext1.external.join(" ")}`);
    assert.deepEqual(problems, []);
  } finally {
    await ext1.close();
  }
});

test("quota visible sans défiler : restant / limite et heure de remise à zéro EN HAUT ; quota atteint → téléchargement désactivé et expliqué ; illimité ; hors ligne : jamais bloqué", async () => {
  // 3 restantes sur 10 : Égide, l'anneau de la barre (en haut, toujours visible), et sa phrase pour les lecteurs d'écran.
  let { page, errors } = await popup({ responses: { "popup.init": init() } });
  await waitText(page, "#quota-text", "3 conversions restantes sur 10");
  const box = await page.locator("#quota-ring").boundingBox();
  assert.ok(box && box.y < 48 && box.height >= 28, `anneau du quota dans la barre (${JSON.stringify(box)})`);
  assert.equal(await text(page, "#quota-ring b"), "3");
  assert.equal(await page.locator("#quota-ring").getAttribute("aria-label"), "3 conversions restantes sur 10 aujourd'hui. Remise à zéro à 00:00.");
  assert.equal(await text(page, "#quota-reset"), "Remise à zéro à 00:00");
  assert.ok(await page.locator("[data-action=start]").isEnabled());
  await page.close();
  // quota atteint (infos à jour) : bouton désactivé, raison et heure de remise à zéro
  const full = { ...ACCOUNT, today: { used: 10, limit: 10, remaining: 0, resetAt: "2026-10-10T22:00:00.000Z" } };
  ({ page, errors } = await popup({ responses: { "popup.init": init({ account: full }) } }));
  await waitText(page, "#quota-note", "Quota du jour atteint");
  assert.equal(await page.locator("#quota").getAttribute("data-tone"), "bad");
  assert.ok(await page.locator("[data-action=start]").isDisabled());
  assert.equal(await text(page, "#convert-hint"), `Quota du jour atteint${NB}: nouvelles conversions possibles à 00:00.`);
  await page.locator("[data-action=start]").click({ force: true });
  assert.equal(await lastStart(page), undefined, "aucun job.start");
  await audit(page, errors, "popup-quota-atteint");
  await page.close();
  // dernier état connu (non actualisé) : jamais bloqué, le serveur reste seul juge
  ({ page, errors } = await popup({ responses: { "popup.init": init({ account: { ...full, stale: true } }) } }));
  await waitText(page, "#quota-text", "0 conversion restante sur 10");
  assert.ok(await page.locator("[data-action=start]").isEnabled());
  await page.close();
  // illimité
  ({ page, errors } = await popup({ responses: { "popup.init": init({ account: UNLIMITED }) } }));
  await waitText(page, "#quota-text", "Illimité");
  assert.deepEqual(errors, []);
  await page.close();
});

test("statut honnête : publique depuis le 2026-10-18 (plus de « bêta ») ; build de préproduction : « préproduction »", async () => {
  const { page } = await popup({ responses: { "popup.init": init() } });
  await waitText(page, "#version", "Version");
  assert.equal(await text(page, "#version"), "Version 3.0.0 · préproduction");
  assert.doesNotMatch(await bodyText(page), /publiée?|Chrome Web Store/i);
  await page.close();
  const m = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  assert.equal(m.version_name, "3.9.0 (préproduction)");
  assert.equal(m.version, "3.9.0");
  assert.doesNotMatch(readFileSync(join(DIST, "popup", "popup.js"), "utf8"), /bêta/);
});

// ---- notice sur les données, état dégradé, révocation en direct, nouvelle version, accueil ------------
const UPDATE = { version: "1.1.0", notes: ["Nouvelle mise en page du popup.", "Corrections de la connexion."], released: "2026-11-02", url: `${SITE}/extension` };

test("notice pas encore acceptée : carte « Bienvenue », connexion et téléchargement verrouillés, « Lire la notice et accepter » ouvre la notice", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ consent: NO_CONSENT, account: DISCONNECTED }), "welcome.open": ok({ opened: true }) } });
  await waitText(page, "#hero-title", "Bienvenue");
  assert.equal(await text(page, "#conn-label"), "Non connecté");
  assert.equal(await page.locator("[data-action=login]").count(), 0, "pas de connexion avant l'accord");
  assert.equal(await page.locator("[data-action=start]").count(), 0, "rien à télécharger avant l'accord");
  assert.equal(await text(page, ".hero-text"), `Lis ce que l'extension fait de tes données, puis accepte${NB}: rien ne part avant.`);
  assert.equal(await page.locator("#jobs").isVisible(), false);
  assert.match(await text(page, "#rights"), /installation hors store ne change rien aux conditions de YouTube, TikTok et X/);
  // Rien ne part avant l'accord, pas même la miniature (serveurs d'images des plateformes) : pictogramme seul.
  assert.equal(await page.locator(".media-row img").count(), 0, "aucune miniature avant l'accord");
  assert.equal(await page.locator(".media-row .thumb svg[data-glyph=youtube]").count(), 1);
  assert.deepEqual(await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((u) => !u.startsWith("chrome-extension://"))), [], "aucune requête");
  await audit(page, errors, "popup-notice-a-accepter");
  await page.locator("[data-action=open-notice]").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "welcome.open"));
  assert.deepEqual((await sent(page)).find((m) => m.type === "welcome.open"), { type: "welcome.open", section: "donnees" });
  assert.equal((await sent(page)).filter((m) => m.type !== "popup.init" && m.type !== "welcome.open").length, 0, "aucune autre requête");
  await page.close();
});

test("service du compte indisponible (404, 503, réseau) : jamais « Connecté », carte expliquée, « Réessayer » recharge", async () => {
  const cases = [
    [{ reason: "missing", status: 404 }, "Service indisponible", "Service pas encore disponible", "popup-service-absent"],
    [{ reason: "unavailable", status: 503 }, "Service indisponible", "Service momentanément indisponible", "popup-service-503"],
    [{ reason: "network" }, "Hors ligne", "AETHRYON injoignable", "popup-hors-ligne"],
  ];
  for (const [degraded, pill, title, name] of cases) {
    const account = { connected: true, email: ACCOUNT.email, name: ACCOUNT.name, degraded, ...(degraded.reason === "network" ? { today: ACCOUNT.today, stale: true } : {}) };
    const { page, errors } = await popup({ responses: { "popup.init": [init({ account }), init()] } });
    await waitText(page, "#conn-label", pill);
    assert.notEqual(await text(page, "#conn-label"), "Connecté");
    assert.equal(await page.locator("#conn").getAttribute("data-state"), "warn");
    assert.equal(await text(page, "#degraded-title"), title);
    if (degraded.status === 503) assert.match(await text(page, ".strip-text"), /\(503\)/);
    assert.match(await text(page, ".strip-hint"), /L'extension reste liée à ton compte \(camille\.martin@example\.com\)/);
    if (degraded.reason === "network") assert.match(await text(page, ".strip-hint"), /Dernier quota connu/);
    assert.equal(await page.locator(".strip-num").count(), 0, "aucun quota présenté comme à jour");
    if (name === "popup-service-absent") await audit(page, errors, name);
    await page.locator("#quota [data-action=reload]").click();
    await waitText(page, "#conn-label", "Connecté");
    await waitText(page, "#quota-text", "3 conversions restantes sur 10");
    await page.close();
  }
});

test("révocation annoncée en direct (auth.changed du service worker) : retour immédiat à « Reconnecte-toi » avec le motif, liste vidée, focus sur « Se connecter »", async () => {
  const lostInit = init({ account: { connected: false, notice: LOST_USER }, jobs: [] });
  const { page, errors } = await popup({ responses: { "popup.init": [init({ jobs: [DONE, ERR] }), lostInit] } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.locator("li.job").count(), 2);
  await pushEvent(ext, { type: "auth.changed", connected: false, reason: "revoked_user", message: LOST_USER.message });
  await waitText(page, "#hero-title", "Reconnecte-toi");
  assert.equal(await text(page, "#auth-notice"), LOST_USER.message);
  assert.equal(await page.locator("li.job").count(), 0, "liste vidée");
  assert.equal(await text(page, "#conn-label"), "Non connecté");
  await page.waitForFunction(() => document.activeElement?.dataset?.action === "login", null, { timeout: 5000 });
  report.screenshots.push(await shoot(page, "popup-revoque-en-direct-clair"));
  assert.deepEqual(errors, []);
  await page.close();
  // Expiration après 30 jours : même chemin, motif exact.
  const r = await popup({ responses: { "popup.init": [init(), init({ account: { connected: false, notice: LOST_EXPIRED } })] } });
  await waitText(r.page, "#conn-label", "Connecté");
  await pushEvent(ext, { type: "auth.changed", connected: false, reason: "expired", message: LOST_EXPIRED.message });
  await waitText(r.page, "#auth-notice", "Connexion expirée (30 jours)");
  assert.equal(await text(r.page, "#auth-notice"), `Connexion expirée (30 jours)${NB}: reconnecte-toi.`);
  await r.page.close();
  // Déconnexion faite ailleurs (réglages) : la phrase est dite une fois, sans motif serveur.
  const s2 = await popup({ responses: { "popup.init": [init(), init({ account: DISCONNECTED })] } });
  await waitText(s2.page, "#conn-label", "Connecté");
  await pushEvent(ext, { type: "auth.changed", connected: false, reason: "signed_out" });
  await waitText(s2.page, "#auth-notice", "Déconnecté de ce navigateur");
  assert.equal(await text(s2.page, "#hero-title"), "Connecte-toi");
  await s2.page.close();
});

test("avis de nouvelle version : carte calme en haut, notes, « Ouvrir la page de téléchargement » (onglet), « Masquer » pour cette version ; annonce en direct", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ update: UPDATE }), "update.dismiss": ok({ update: null }) } });
  await waitText(page, "#update-title", "Nouvelle version 1.1.0 disponible");
  assert.deepEqual(await page.locator(".update-notes li").allTextContents(), UPDATE.notes);
  assert.equal(await text(page, ".update-date"), "Publiée le 2 novembre 2026");
  const box = await page.locator("#update").boundingBox();
  assert.ok(box.y < 80, "en haut du popup");
  await audit(page, errors, "popup-nouvelle-version");
  await page.locator("[data-action=update-open]").click();
  assert.deepEqual((await calls(page)).tabs, [`${SITE}/extension`]);
  await page.locator("[data-action=update-dismiss]").click();
  await page.waitForSelector("#update", { state: "detached" });
  assert.deepEqual((await sent(page)).find((m) => m.type === "update.dismiss"), { type: "update.dismiss", version: "1.1.0" });
  // annonce en direct (vérification faite pendant que le popup est ouvert)
  await pushEvent(ext, { type: "update.changed", update: { ...UPDATE, version: "1.2.0" } });
  await waitText(page, "#update-title", "Nouvelle version 1.2.0 disponible");
  await pushEvent(ext, { type: "update.changed", update: null });
  await page.waitForSelector("#update", { state: "detached" });
  // une URL hors du site est refusée (aucun avis affiché)
  await pushEvent(ext, { type: "update.changed", update: { ...UPDATE, url: "https://evil.example/extension" } });
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#update").count(), 0);
  await page.close();
});

test("échec de connexion : la cause du service worker est dite, avec l'action utile (« Mes jetons », « Lire la notice »)", async () => {
  const TOO_MANY = { code: "too_many_extensions", message: `Limite atteinte${NB}: 3 extensions au plus peuvent être connectées à un même compte. Révoque un appareil dans «${NB}Mes jetons${NB}», puis reconnecte-toi.`, retryable: false };
  const { page, errors } = await popup({ responses: { "popup.init": init({ account: DISCONNECTED }), "auth.login": { ok: false, error: TOO_MANY } } });
  await page.locator("[data-action=login]").click();
  await waitText(page, ".login [role=alert]", "Limite atteinte");
  const link = page.locator(".login-actions a");
  assert.equal(await link.getAttribute("href"), `${SITE}/dashboard/cles`);
  assert.match(await link.textContent(), /Ouvrir «\u00a0Mes jetons\u00a0»/);
  await audit(page, errors, "popup-connexion-trop-d-extensions");
  await link.click();
  assert.deepEqual((await calls(page)).tabs, [`${SITE}/dashboard/cles`]);
  await page.close();
  const MISSING = { code: "service_missing", message: "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard.", retryable: true };
  const r = await popup({ responses: { "popup.init": init({ account: DISCONNECTED }), "auth.login": { ok: false, error: MISSING } } });
  await r.page.locator("[data-action=login]").click();
  await waitText(r.page, ".login [role=alert]", "pas encore disponible");
  assert.doesNotMatch(await text(r.page, ".login [role=alert]"), /vérifie ta connexion/);
  assert.equal(await r.page.locator(".login-actions > *").count(), 0);
  report.screenshots.push(await shoot(r.page, "popup-connexion-service-absent-clair"));
  await r.page.close();
});

// ---- page d'accueil (premier lancement) ---------------------------------------------------------
async function welcome(fixture, opts) {
  const r = await openPage(ext, "welcome/welcome.html", fixture, opts);
  await r.page.setViewportSize({ width: 900, height: 1000 });
  return r;
}

test("accueil : installation confirmée (version réelle), épinglage lu dans Chrome, notice puis « Accepter », connexion ensuite seulement", async () => {
  const { page, errors } = await welcome({
    pinned: false,
    responses: {
      "popup.init": [init({ consent: NO_CONSENT, account: DISCONNECTED }), init({ account: DISCONNECTED }), init()],
      "consent.accept": ok({ accepted: true, version: CONSENT_VERSION, at: "2026-10-11T09:00:00.000Z" }),
      "auth.login": ok(ACCOUNT),
    },
  });
  await waitText(page, "#w-title", "L'extension AETHRYON est installée");
  // Version du manifeste (essai périmé avant le lot 3 : il attendait encore la 3.8.0 après la 3.8.1).
  assert.match(await text(page, "#w-lead"), /^Version 3\.9\.0, chargée par ton navigateur\./);
  assert.equal(await text(page, "#w-version"), "Version 3.9.0 · préproduction");
  assert.equal(await page.locator("#epingler").getAttribute("data-state"), "current");
  await waitText(page, "#pin-status", "pas encore épinglée");
  // notice : la même que les réglages, et le rappel des droits
  const facts = (await text(page, "#disclosure")).replace(/\s+/g, " ");
  for (const part of ["jeton ytc_", "lien canonique de la vidéo", "le nom de l'appareil", "30 téléchargements les plus récents", "stockage synchronisé", "aucune publicité"]) assert.ok(facts.includes(part), part);
  assert.match(await text(page, "#rights"), /installation hors store ne change rien/);
  // connexion verrouillée tant que la notice n'est pas acceptée
  const login = page.locator("#login-area [data-action=login]");
  assert.ok(await login.isDisabled());
  assert.equal(await login.getAttribute("aria-describedby"), "login-locked");
  assert.equal(await page.locator("#connexion").getAttribute("data-state"), "todo");
  await audit(page, errors, "accueil-notice", { full: true });
  // épinglage fait dans Chrome : l'étape se coche d'elle-même
  await page.evaluate(() => window.__setPinned(true));
  await waitText(page, "#pin-status", "est épinglée");
  assert.equal(await page.locator("#epingler").getAttribute("data-state"), "done");
  // Accepter → consent.accept (version exacte), puis la connexion devient possible et reçoit le focus
  await page.locator("[data-action=consent-accept]").click();
  await page.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done");
  assert.deepEqual((await sent(page)).find((m) => m.type === "consent.accept"), { type: "consent.accept", version: CONSENT_VERSION });
  assert.match(await text(page, "#consent-area"), /Accord enregistré le 11 octobre 2026/);
  await page.waitForFunction(() => document.activeElement?.dataset?.action === "login");
  assert.equal(await page.locator("#connexion").getAttribute("data-state"), "current");
  await page.locator("#login-area [data-action=login]").click();
  await page.waitForFunction(() => document.querySelector("#connexion")?.dataset.state === "done");
  assert.match(await text(page, "#login-area"), /Connecté à camille\.martin@example\.com\./);
  assert.equal(await page.locator("#w-next").isVisible(), true);
  // « Tout est prêt » : les plateformes avec leurs pictogrammes neutres v3 (comme le popup et les pages).
  assert.deepEqual(await page.locator("#w-platforms li").evaluateAll((lis) => lis.map((li) => `${li.querySelector("svg")?.dataset.glyph}:${li.textContent}`)),
    ["youtube:YouTube", "tiktok:TikTok", "twitter:X"]);
  assert.match(await text(page, "#epingler .w-text"), /^Ton navigateur range les nouvelles extensions/);
  assert.match(await text(page, "#devmode-hint"), /^Garde le «\u00a0Mode développeur\u00a0» activé/);
  assert.deepEqual((await sent(page)).map((m) => m.type), ["popup.init", "consent.accept", "popup.init", "auth.login", "popup.init"]);
  report.screenshots.push(await shootFull(page, "accueil-pret-clair"));
  assert.deepEqual(errors, []);
  await page.close();
});

test("accueil : ouverte sur #donnees (depuis le popup ou une page), le clavier part de la notice (Tab → « Accepter ») ; thème sombre accessible", async () => {
  const r = await openPage(ext, "welcome/welcome.html#donnees", { pinned: true, responses: { "popup.init": init({ consent: NO_CONSENT, account: DISCONNECTED }) } }, { colorScheme: "dark" });
  await r.page.setViewportSize({ width: 900, height: 1000 });
  await r.page.bringToFront();
  // Point de départ de la navigation au clavier : le titre de la notice (focus posé à l'ouverture) ;
  // Tab mène directement à « Accepter ».
  await r.page.waitForFunction(() => document.querySelector("#consent-area [data-action=consent-accept]"));
  await r.page.keyboard.press("Tab");
  assert.equal(await r.page.evaluate(() => document.activeElement?.dataset?.action), "consent-accept");
  assert.ok((await focusInfo(r.page)).ring, "anneau de focus visible");
  const v = serious(await axe(r.page));
  assert.deepEqual(v, []);
  assert.deepEqual(await typography(r.page), []);
  await r.page.close();
});

test("réglages : notice non acceptée → compte verrouillé ; accord retiré avec confirmation (consent.withdraw) → message, plus rien d'envoyé", async () => {
  await resetStorage();
  let r = await options({ responses: { "popup.init": init({ consent: NO_CONSENT, account: DISCONNECTED }), "welcome.open": ok({ opened: true }) } });
  await waitText(r.page, "#consent-status", "Tu n'as pas encore accepté cette notice");
  assert.equal(await r.page.locator("#account-body [data-action=login]").count(), 0);
  await r.page.locator("#account-body [data-action=open-notice]").click();
  await r.page.waitForFunction(() => window.__sent.some((m) => m.type === "welcome.open"));
  await audit(r.page, r.errors, "reglages-notice-a-accepter");
  await r.page.close();
  r = await options({ responses: { "popup.init": [init(), init({ consent: NO_CONSENT, account: DISCONNECTED })], "consent.withdraw": ok({ accepted: false, version: CONSENT_VERSION }) } });
  await waitText(r.page, "#account-body", "Camille Martin");
  await r.page.locator("[data-action=consent-withdraw]").click();
  assert.equal(await r.page.evaluate(() => document.activeElement?.dataset.action), "consent-withdraw-cancel", "focus sur l'option sans conséquence");
  await r.page.keyboard.press("Escape");
  assert.equal(await r.page.evaluate(() => document.activeElement?.dataset.action), "consent-withdraw");
  await r.page.locator("[data-action=consent-withdraw]").click();
  await r.page.locator("[data-action=consent-withdraw-confirm]").click();
  await waitText(r.page, "#consent-status", "Tu n'as pas encore accepté cette notice");
  assert.deepEqual((await sent(r.page)).filter((m) => m.type === "consent.withdraw"), [{ type: "consent.withdraw" }]);
  await r.page.close();
});

test("fenêtre étroite (320 et 400 px) : réglages et accueil sans débordement, cibles ≥ 24 px, axe Obsidian et Ivory, aucune violation CSP ; popup toujours 360 px", async () => {
  // Les réglages et l'accueil s'ouvrent dans un onglet : ils doivent tenir dans une fenêtre réduite. Le popup, lui,
  // a une largeur fixe de 360 px (Égide ; Chrome dimensionne sa fenêtre sur son contenu) : vérifié par audit() partout.
  for (const width of [320, 400]) {
    const o = await openPage(ext, "options/options.html", OPT());
    await o.page.setViewportSize({ width, height: 900 });
    await o.page.waitForTimeout(300);
    await audit(o.page, o.errors, `reglages-${width}px`);
    await o.page.close();
    const w = await openPage(ext, "welcome/welcome.html", { pinned: false, responses: { "popup.init": init({ consent: NO_CONSENT, account: DISCONNECTED }) } });
    await w.page.setViewportSize({ width, height: 900 });
    await w.page.waitForTimeout(300);
    await audit(w.page, w.errors, `accueil-${width}px`);
    await w.page.close();
  }
});
