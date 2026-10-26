// Popup V3 dans Chromium réel (extension de développement chargée) : trois états — média trouvé (A), aucun média
// (B), travail en cours (C) — ; extrait instantané depuis l'instant de lecture (MP4, MP3, GIF) ; outils rapides
// (image, miniature, AETHRYON Tools) ; lien collé ; centre de téléchargements. Les RÉPONSES du service worker sont
// simulées comme dans popup.test.mjs ; le reste est réel (pages, CSS, polices, CSP, messagerie).
//   node --test tests/browser/popup-v3.test.mjs      (SKIP_BUILD=1 : pas de reconstruction)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, axe, launch, layout, openPage, sent, serious, shoot, shootFull, typography } from "./ui-helpers.mjs";
import { CONSENT_VERSION } from "../support/browser.mjs";

const NB = " ";
const NOW = Date.now();
const SETTINGS = { inlineButtons: true, platforms: { youtube: true, tiktok: true, twitter: true }, defaultFmt: "mp4", quality: "1080", bitrate: 192, floatingPanel: false, panelPosition: null, notifications: false, clipLength: 30, clipAnchor: "after", pageTools: true };
const ACCOUNT = { connected: true, name: "Camille Martin", email: "camille.martin@example.com", today: { used: 3, limit: 10, remaining: 7, resetAt: "2026-10-15T22:00:00.000Z" }, activeJobs: 0, recent: [], tools: true };
const YT = { platform: "youtube", kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ", title: "La nuit des chouettes — documentaire intégral", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", duration: 754, currentTime: 83.4 };
const TT = "https://www.tiktok.com/@nasa/video/7691727731800673549";
const CONSENT = { accepted: true, version: CONSENT_VERSION, at: "2026-10-11T08:00:00.000Z" };
const init = (over = {}) => ({ ok: true, data: { account: ACCOUNT, detected: YT, pageHint: null, jobs: [], settings: SETTINGS, version: "3.0.0", consent: CONSENT, update: null, ...over } });
const ok = (data = null) => ({ ok: true, data });
const item = (over = {}) => ({ key: "job_v3item0001", jobId: "c0ffee01", url: YT.url, platform: "youtube", fmt: "mp4", quality: "720", title: YT.title, state: "converting", progress: 42, createdAt: NOW - 30e3, updatedAt: NOW, ...over });

let ext;
const report = { screenshots: [], axe: [] };
before(async () => { ext = await launch(); });
after(async () => {
  await ext?.close();
  writeFileSync(join(OUT, "rapport-popup-v3.json"), JSON.stringify(report, null, 2));
});

const popup = (fixture, opts) => openPage(ext, "popup/popup.html", fixture, opts);
const text = (page, sel) => page.locator(sel).first().textContent();
const waitText = (page, sel, t) => page.waitForFunction(([s, x]) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(x)), [sel, t], { timeout: 5000 });
const lastSent = async (page, type) => (await sent(page)).filter((m) => m.type === type).at(-1);

/** axe (clair et sombre), typographie, cibles, dimensions, CSP, console, requêtes externes ; captures. */
async function audit(page, errors, name, { full = false } = {}) {
  const problems = [];
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(450);
    // Fondus de couleur terminés (une machine chargée peut les ralentir) : axe lit les couleurs finales.
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity && a.playState !== "paused") // la respiration de la chouette ne finit jamais
      .map((a) => a.finished.catch(() => undefined))));
    const v = await axe(page);
    report.axe.push({ name, scheme, violations: v });
    const bad = serious(v);
    if (bad.length) problems.push(`${name}/${scheme} axe ${JSON.stringify(bad)}`);
    const label = scheme === "light" ? "clair" : "sombre";
    report.screenshots.push(await shoot(page, `${name}-${label}`));
    if (full) report.screenshots.push(await shootFull(page, `${name}-${label}-complet`));
  }
  await page.emulateMedia({ colorScheme: "light" });
  const l = await layout(page, 32);
  if (l.small.length) problems.push(`${name} cibles trop petites ${JSON.stringify(l.small)}`);
  if (l.overflowX > 0) problems.push(`${name} débordement horizontal ${l.overflowX}px`);
  if (l.width !== 380 || l.height > 600) problems.push(`${name} dimensions ${l.width}×${l.height}`);
  const typo = await typography(page);
  if (typo.length) problems.push(`${name} typographie ${JSON.stringify(typo)}`);
  const csp = await page.evaluate(() => window.__csp);
  if (csp.length) problems.push(`${name} CSP ${csp.join(" | ")}`);
  if (errors.length) problems.push(`${name} console ${errors.join(" | ")}`);
  if (ext.external.length) problems.push(`${name} requêtes externes ${ext.external.join(" ")}`);
  assert.deepEqual(problems, []);
}

test("état A : durée et instant de lecture lus sur la vidéo, vidéo entière par défaut, outils rapides", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init() } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.evaluate(() => document.querySelector("main").dataset.view), "media");
  assert.equal(await text(page, ".media-url"), "12:34 · lecture à 1:23");
  assert.ok(await page.locator('input[name="mode"][value="download"]').isChecked());
  assert.deepEqual(await page.locator(".quick-row .btn").allTextContents(), ["Image", "Miniature", "Tools"]);
  await audit(page, errors, "popup-v3-media", { full: true });
  await page.close();
});

// 3.6.0 : l'onglet « Extrait » est l'éditeur partagé avec le menu des pages (réglette, loupe, champs HH:MM:SS.mmm,
// lecteur de l'onglet par le service worker, limites du serveur) ; banc réel : tests/browser/extraits.test.mjs.
const LIMITS = ok({ limits: { extraitDureeMaxMs: 600_000, parFormat: {}, sortieTailleMaxOctets: null, telechargementMaxOctets: null, traitementMaxS: null, simultanesMax: null, quotaJour: 10, restantAujourdhui: 7, extraitsActifs: true }, quota: { used: 3, limit: 10, remaining: 7 }, source: "serveur" });
const PLAYER = ok({ currentTime: 83.4, duration: 754, paused: true, previewing: false });

test("extrait : réglette et champs depuis l'instant de lecture, limites du serveur, GIF sans limite fixe, MP4, MP3 ou GIF", async () => {
  const { page, errors } = await popup({ responses: {
    "popup.init": init(), "limits.get": LIMITS, player: PLAYER,
    "job.start": ok(item({ key: "job_v3clip0001", kind: "gif", clip: { start: 83.4, end: 143.4 }, state: "queued", progress: undefined })),
  } });
  await waitText(page, "#conn-label", "Connecté");
  await page.locator(".seg-opt", { hasText: "Extrait" }).click();
  await page.waitForSelector(".ce .tl-h-start"); // 3.8.0 : champs dans le mode précis
  assert.equal(await page.inputValue(".ce-f-start input"), "00:01:23.400", "30 s à partir de 1:23.4 (réglage par défaut)");
  assert.equal(await page.inputValue(".ce-f-end input"), "00:01:53.400");
  // 3.8.0 (TimeLens) : plus de ligne de limite au repos ; quota affiché seulement à 3 exports restants ou moins.
  await page.waitForFunction(() => document.querySelector(".ce")?.getAttribute("data-limits") === "serveur");
  assert.equal(await page.isVisible(".ce-quota"), false, "7 exports restants : rien à dire");
  await page.waitForFunction(() => document.querySelector(".ce-now")?.textContent === "Lecteur 1:23.4");
  assert.equal(await page.getAttribute(".tl-h-start", "aria-valuetext"), `1${NB}minute 23,4${NB}secondes`);
  await page.click(".ce-fine"); // 3.8.0 : champs dans le mode précis
  await page.waitForTimeout(300);
  // GIF d'une minute : aucune limite fixe de 30 s (le serveur annonce 10 min).
  await page.fill(".ce-f-end input", "2:23.4");
  await page.press(".ce-f-end input", "Enter");
  await page.waitForFunction(() => document.querySelector(".ce-f-end input")?.value === "00:02:23.400");
  await page.locator(".ce-fmt .ce-opt", { hasText: "GIF" }).click();
  assert.equal(await text(page, ".ce-go"), "Exporter 1:00 en GIF");
  assert.equal(await page.locator(".ce-go").isDisabled(), false);
  await audit(page, errors, "popup-v3-extrait-gif", { full: true });
  await page.locator(".ce-go").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "job.start"));
  assert.deepEqual(await lastSent(page, "job.start"), { type: "job.start", url: YT.url, fmt: "mp4", clip: { start: 83.4, end: 143.4 }, gif: true, title: YT.title });
  await waitText(page, ".job-meta", "GIF");
  assert.equal(await text(page, ".job-meta"), `YouTube · GIF · 1${NB}min · 1:23${NB}→${NB}2:23`);
  await page.waitForSelector(".xp:not([hidden])");
  assert.equal(await text(page, ".xp-title"), "En attente du serveur", "en file : rien d'inventé");
  await page.close();
});

test("extrait sans durée connue : champs seuls (le serveur vérifiera), lecteur indisponible dit, export possible", async () => {
  const { page } = await popup({ responses: { "popup.init": init({ detected: { ...YT, currentTime: undefined, duration: undefined } }), "limits.get": LIMITS } });
  await waitText(page, "#conn-label", "Connecté");
  await page.locator(".seg-opt", { hasText: "Extrait" }).click();
  await page.waitForSelector(".ce .ce-input");
  assert.equal(await page.isVisible(".ce .tl"), false, "pas de réglette sans durée");
  await waitText(page, ".ce-keys", "Durée de la vidéo inconnue");
  assert.equal(await text(page, ".ce-now"), "Lecteur indisponible");
  await page.fill(".ce-f-start input", "1:00");
  await page.press(".ce-f-start input", "Enter");
  await page.fill(".ce-f-end input", "1:30.5");
  await page.press(".ce-f-end input", "Enter");
  await page.waitForFunction(() => document.querySelector(".ce-f-end input")?.value === "00:01:30.500");
  assert.equal(await page.locator(".ce-go").isDisabled(), false);
  assert.equal(await text(page, ".media-url"), "youtube.com/watch?v=dQw4w9WgXcQ");
  await page.close();
});

test("outils rapides : image (refus DRM expliqué puis réussite), miniature, Tools — résultats dans le centre de téléchargements", async () => {
  const frameDone = item({ key: "job_v3frame001", jobId: undefined, kind: "frame", quality: undefined, state: "done", progress: 100, downloadId: 21, fileName: "La nuit des chouettes (image 1m23s).png" });
  const { page, errors } = await popup({
    responses: {
      "popup.init": init(),
      "frame.capture": [{ ok: false, error: { code: "drm", message: `Image noire${NB}: cette vidéo est protégée (DRM), sa capture n'est pas possible.`, retryable: false } }, ok(frameDone)],
      "thumb.save": ok(item({ key: "job_v3thumb001", jobId: undefined, kind: "thumb", quality: undefined, state: "downloading", progress: 0 })),
      "tools.open": ok({ opened: true }),
    },
  });
  await waitText(page, "#conn-label", "Connecté");
  await page.locator("[data-action=frame]").click();
  await waitText(page, "#tools-error", "protégée (DRM)");
  await page.locator("[data-action=frame]").click();
  await waitText(page, ".job-meta", "Image de la vidéo");
  assert.equal(await page.locator("#tools-error").textContent(), "");
  await page.locator("[data-action=thumb]").click();
  await waitText(page, ".job-meta", "Miniature");
  assert.deepEqual(await lastSent(page, "thumb.save"), { type: "thumb.save", url: YT.url, thumbnail: YT.thumbnail, title: YT.title });
  await page.locator("[data-action=tools]").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "tools.open"));
  assert.deepEqual(await lastSent(page, "tools.open"), { type: "tools.open", url: YT.url });
  await audit(page, errors, "popup-v3-outils");
  await page.close();
});

test("Tools absent quand le serveur ne l'a pas ouvert ; image impossible sans la vidéo de l'onglet", async () => {
  const { page } = await popup({ responses: { "popup.init": init({ account: { ...ACCOUNT, tools: false } }) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.deepEqual(await page.locator(".quick-row .btn").allTextContents(), ["Image", "Miniature"]);
  await page.close();
});

test("état C : un travail en cours passe en premier (popup rouvert), extrait et GIF lisibles, Tools sur le média du serveur", async () => {
  const gif = item({ key: "job_v3gif00001", kind: "gif", clip: { start: 5, end: 15 }, stage: "gif" });
  const clip = item({ key: "job_v3clip0002", jobId: "c0ffee02", clip: { start: 83, end: 113 }, quality: "1080", state: "done", progress: 100, downloadId: 9, fileName: "x.mp4", updatedAt: NOW - 5e3 });
  const { page, errors } = await popup({ responses: { "popup.init": init({ jobs: [gif, clip] }), "tools.open": ok({ opened: true }) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.evaluate(() => document.querySelector("main").dataset.view), "progress");
  const order = await page.evaluate(() => [...document.querySelector("main").children].map((e) => e.id || e.className));
  assert.ok(order.indexOf("jobs") < order.indexOf("media"), `ordre : ${order.join(", ")}`);
  assert.deepEqual(await page.locator(".job-meta").allTextContents(), [
    `YouTube · GIF · 10${NB}s · 0:05${NB}→${NB}0:15`,
    `YouTube · Extrait 1:23${NB}→${NB}1:53 · MP4 · 1080p`,
  ]);
  assert.equal(await text(page, ".job-status-text"), "Fabrication du GIF…");
  await page.locator("li.job[data-key=job_v3clip0002] [data-action=tools]").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "tools.open"));
  assert.deepEqual(await lastSent(page, "tools.open"), { type: "tools.open", key: "job_v3clip0002" });
  await audit(page, errors, "popup-v3-en-cours", { full: true });
  await page.close();
});

test("état B : lien collé validé sur l'appareil → carte du média ; effacé → retour ; AETHRYON Tools proposé", async () => {
  const { page, errors } = await popup({ responses: { "popup.init": init({ detected: null }), "job.start": ok(item({ key: "job_v3paste001", url: TT, platform: "tiktok", title: undefined, state: "queued", progress: 0 })) } });
  await waitText(page, "#conn-label", "Connecté");
  assert.equal(await page.evaluate(() => document.querySelector("main").dataset.view), "empty");
  assert.ok(await page.getByRole("link", { name: /Ouvrir AETHRYON Tools/ }).isVisible());
  await audit(page, errors, "popup-v3-aucun-media");
  await page.fill("#paste-url", "https://vimeo.com/76979871");
  await page.press("#paste-url", "Enter");
  await waitText(page, "#paste-error", "pas pris en charge");
  await page.fill("#paste-url", `${TT}?is_from_webapp=1`);
  await page.press("#paste-url", "Enter");
  await waitText(page, "#media-title", "Lien collé");
  assert.equal(await page.locator("[data-action=frame]").isDisabled(), true, "une image demande la vidéo de l'onglet");
  await page.locator("[data-action=start]").click();
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "job.start"));
  assert.deepEqual(await lastSent(page, "job.start"), { type: "job.start", url: TT, fmt: "mp4", quality: "1080" });
  await page.locator("[data-action=clear-pasted]").click();
  await page.waitForSelector("#paste-url");
  await page.close();
});

test("mise à jour : notice changée depuis l'accord → « La notice a changé », connexion gardée et dite, rien d'envoyé ; réglages pareil", async () => {
  const OUTDATED = { accepted: false, version: CONSENT_VERSION, outdated: true };
  const { page, errors } = await popup({ responses: { "popup.init": init({ consent: OUTDATED }) } });
  await waitText(page, "#hero-title", "La notice a changé");
  assert.equal((await text(page, "#conn-label")).trim(), "Notice à relire");
  assert.equal(await text(page, "#gate .hero-text"),
    `Cette version fait plus de choses (extraits, GIF, image de la vidéo, AETHRYON Tools)${NB}: relis ce que l'extension fait de tes données, puis accepte-le. Ta connexion est gardée${NB}; rien ne part vers un serveur avant.`);
  assert.equal(await page.locator("[data-action=start]").isDisabled(), true, "rien ne part avant le nouvel accord");
  await audit(page, errors, "popup-v3-notice-changee");
  await page.close();
  // Jamais connecté : pas de « connexion gardée ».
  const r = await popup({ responses: { "popup.init": init({ consent: OUTDATED, account: { connected: false } }) } });
  await waitText(r.page, "#hero-title", "La notice a changé");
  assert.match(await text(r.page, "#gate .hero-text"), /accepte-le\. Rien ne part vers un serveur avant\.$/);
  await r.page.close();
  const o = await openPage(ext, "options/options.html", { responses: { "popup.init": init({ consent: OUTDATED }) } });
  await o.page.waitForFunction(() => document.querySelector("#account-body .badge")?.textContent === "Notice à relire", null, { timeout: 5000 });
  assert.match(await o.page.locator("#account-body .row-desc").textContent(), /^La notice sur les données a changé avec la mise à jour/);
  assert.match(await o.page.locator("#consent-status").textContent(), /^Cette notice a changé depuis ton accord \(nouvelles fonctions de la version \d+\.\d+\.\d+\)/);
  assert.deepEqual(o.errors, []);
  await o.page.close();
});
