// Outils des tests navigateur du popup et de la page de réglages.
// - Chromium RÉEL (Playwright) avec l'extension de développement chargée (dist-dev). Le mode sans tête
//   par défaut de Playwright (chromium-headless-shell) ne charge pas les extensions : on utilise le
//   nouveau mode sans tête de Chromium complet (channel « chromium »).
// - Le service worker de cette branche est un BOUCHON : ses réponses sont SIMULÉES dans la page (script
//   injecté avant ceux de la page qui remplace chrome.runtime.sendMessage et enregistre les requêtes).
//   Les messages poussés « job.update » passent, eux, par la vraie messagerie de Chrome depuis le
//   service worker (sw.evaluate → chrome.runtime.sendMessage).
// - chrome.tabs.create, chrome.downloads.show, chrome.runtime.openOptionsPage et chrome.permissions.*
//   sont remplacés par des enregistreurs (pas d'onglet vers la préproduction, pas de dialogue natif).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const PW_PATH = process.env.PW ?? "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core";
export const AXE_PATH = process.env.AXE ?? "e2e/node_modules/axe-core/axe.min.js";
const { chromium } = require(PW_PATH);
const AXE_SOURCE = readFileSync(AXE_PATH, "utf8");

export const ROOT = fileURLToPath(new URL("../../", import.meta.url)); // extension/
export const DIST = join(ROOT, "dist-dev");
export const OUT = join(ROOT, "tests", "out");
mkdirSync(OUT, { recursive: true });

/** Construit l'extension de développement (sauf SKIP_BUILD=1). */
export function buildDev() {
  if (process.env.SKIP_BUILD === "1" && existsSync(join(DIST, "manifest.json"))) return;
  execFileSync(process.execPath, [join(ROOT, "scripts", "build.mjs"), "--target=dev"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}

/** Miniature de test (SVG local) servie à la place des CDN des plateformes : aucune requête externe. */
export const THUMB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a2e"/><stop offset="0.55" stop-color="#5b4a33"/><stop offset="1" stop-color="#d4af7c"/></linearGradient>
<radialGradient id="m" cx="0.72" cy="0.3" r="0.35"><stop offset="0" stop-color="#faf8f3" stop-opacity="0.9"/><stop offset="1" stop-color="#faf8f3" stop-opacity="0"/></radialGradient></defs>
<rect width="320" height="180" fill="url(#g)"/><circle cx="230" cy="54" r="64" fill="url(#m)"/>
<path d="M0 150 C60 120 110 140 160 128 S260 110 320 132 V180 H0Z" fill="#0f0f10" opacity="0.55"/>
<circle cx="160" cy="90" r="24" fill="#0f0f10" opacity="0.45"/><path d="M152 78v24l20-12z" fill="#faf8f3"/></svg>`;

const THUMB_HOSTS = ["i.ytimg.com", "pbs.twimg.com"];

/** Lance Chromium avec l'extension ; renvoie le contexte, le service worker et l'identifiant. dpr : densité (2 par défaut). */
export async function launch({ dpr = 2 } = {}) {
  buildDev();
  // Chromium crée une socket Unix dans TMPDIR : chemin limité à ~107 caractères, d'où un dossier court.
  const base = tmpdir().length > 60 ? "/tmp" : tmpdir();
  const profile = mkdtempSync(join(base, "aethryon-ext-ui-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    env: { ...process.env, TMPDIR: base },
    viewport: { width: 380, height: 600 },
    deviceScaleFactor: dpr,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  const external = [];
  await context.route(/^https?:\/\//, (route) => {
    const u = new URL(route.request().url());
    if (THUMB_HOSTS.includes(u.hostname)) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: THUMB_SVG });
    external.push(u.href);
    return route.abort();
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const id = new URL(sw.url()).host;
  return {
    context, sw, id, external,
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * Script injecté AVANT ceux de la page : faux service worker (réponses par type de requête ; un tableau
 * = réponses successives, la dernière se répète ; absent ou "unreachable" = service worker injoignable ;
 * "never" = pas de réponse).
 */
function installMock(fixture) {
  const responses = fixture.responses ?? {};
  const delays = fixture.delays ?? {};
  const counters = {};
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  window.__sent = [];
  window.__calls = { tabs: [], downloads: [], options: 0, permRequest: [], permRemove: [] };
  chrome.runtime.sendMessage = (msg) => {
    window.__sent.push(clone(msg));
    const type = msg && msg.type;
    let r = responses[type];
    if (Array.isArray(r)) {
      const i = counters[type] ?? 0;
      counters[type] = i + 1;
      r = r[Math.min(i, r.length - 1)];
    }
    if (r === undefined || r === "unreachable") return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
    if (r === "never") return new Promise(() => {});
    return new Promise((resolve) => setTimeout(() => resolve(clone(r)), delays[type] ?? 0));
  };
  chrome.tabs.create = (props) => {
    window.__calls.tabs.push(props.url);
    return Promise.resolve({ id: 99 });
  };
  chrome.downloads.show = (downloadId) => {
    window.__calls.downloads.push(downloadId);
  };
  chrome.runtime.openOptionsPage = () => {
    window.__calls.options += 1;
    return Promise.resolve();
  };
  if (fixture.permissions) {
    const p = fixture.permissions;
    let granted = !!p.initiallyGranted;
    chrome.permissions.contains = () => Promise.resolve(granted);
    chrome.permissions.request = (req) => {
      window.__calls.permRequest.push({ req: clone(req), userActivation: navigator.userActivation ? navigator.userActivation.isActive : null });
      granted = window.__permGrant ?? !!p.grant; // un test peut changer la réponse suivante (window.__permGrant)
      return new Promise((resolve) => setTimeout(() => resolve(granted), 50));
    };
    chrome.permissions.remove = (req) => {
      window.__calls.permRemove.push(clone(req));
      granted = false;
      return Promise.resolve(true);
    };
  }
  // Épinglage de l'icône (page d'accueil) : état lu dans Chrome, simulé ici quand le test le fixe.
  if (fixture.pinned !== undefined && chrome.action) {
    const listeners = [];
    window.__pinned = fixture.pinned;
    chrome.action.getUserSettings = () => Promise.resolve({ isOnToolbar: window.__pinned });
    chrome.action.onUserSettingsChanged = { addListener: (f) => listeners.push(f), removeListener: () => undefined, hasListener: () => false };
    /** L'utilisateur épingle (ou retire) l'icône dans Chrome : l'événement réel est simulé. */
    window.__setPinned = (v) => {
      window.__pinned = v;
      for (const f of listeners) f({ isOnToolbar: v });
    };
  }
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
}

/** Ouvre une page de l'extension avec un faux service worker. */
export async function openPage(ext, path, fixture, { colorScheme = "light", reducedMotion = "no-preference" } = {}) {
  const page = await ext.context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.emulateMedia({ colorScheme, reducedMotion });
  await page.addInitScript(installMock, fixture);
  await page.goto(`chrome-extension://${ext.id}/${path}`);
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

/** Pousse un job.update par la VRAIE messagerie de Chrome, depuis le service worker. */
export async function pushJob(ext, job) {
  await ext.sw.evaluate((j) => chrome.runtime.sendMessage({ type: "job.update", job: j }).catch((e) => String(e)), job);
}

/** Pousse une annonce du service worker (auth.changed, update.changed) par la VRAIE messagerie de Chrome. */
export async function pushEvent(ext, msg) {
  await ext.sw.evaluate((m) => chrome.runtime.sendMessage(m).catch((e) => String(e)), msg);
}

export const sent = (page) => page.evaluate(() => window.__sent);
export const calls = (page) => page.evaluate(() => window.__calls);

/** axe-core (injecté par le protocole DevTools : non soumis à la CSP de l'extension). */
export async function axe(page) {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")), summary: (v.nodes[0]?.failureSummary ?? "").slice(0, 300) }));
  });
}

export const serious = (violations) => violations.filter((v) => v.impact === "serious" || v.impact === "critical");

/**
 * Typographie française du texte d'INTERFACE (les données — titres, liens, messages du serveur — sont
 * marquées data-raw et exclues) : espace insécable avant ? ! : ; % et dans « ».
 */
export async function typography(page) {
  return page.evaluate(() => {
    const bad = [];
    const check = (text, where) => {
      if (!text) return;
      if (/[ \t\n][?!:;»%]/.test(text)) bad.push(`${where} : espace ordinaire avant ponctuation : ${JSON.stringify(text)}`);
      if (/[\p{L}\p{N})][?!;»%]/u.test(text)) bad.push(`${where} : espace manquante avant ponctuation : ${JSON.stringify(text)}`);
      if (/\p{L}:/u.test(text)) bad.push(`${where} : espace manquante avant « : » : ${JSON.stringify(text)}`);
      if (/«(?! )/.test(text) || /(?<! )»/.test(text)) bad.push(`${where} : guillemets sans espace insécable : ${JSON.stringify(text)}`);
      if (/’/.test(text)) bad.push(`${where} : apostrophe typographique (le site utilise ') : ${JSON.stringify(text)}`);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("[data-raw], script, style")) continue;
      check(n.textContent, el.id || el.className || el.tagName);
    }
    for (const el of document.querySelectorAll("[aria-label], [title], [aria-valuetext], [placeholder]")) {
      if (el.closest("[data-raw]")) continue;
      for (const a of ["aria-label", "title", "aria-valuetext", "placeholder"]) check(el.getAttribute(a), `${el.tagName.toLowerCase()}@${a}`);
    }
    check(document.title, "title");
    return bad;
  });
}

/** Captures : fenêtre du popup, et contenu complet (défilement interne déroulé). */
export async function shoot(page, name) {
  await page.waitForTimeout(450); // fin des fondus (≤ 320 ms)
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export async function shootFull(page, name) {
  const file = join(OUT, `${name}.png`);
  // Le temps de la capture seulement : le popup est déroulé (plus de hauteur maximale ni de défilement interne).
  const tag = await page.addStyleTag({ content: "html.popup body{max-height:none!important;overflow:visible!important} .popup .scroll{overflow:visible!important}" });
  await page.waitForTimeout(100);
  await page.screenshot({ path: file, fullPage: true });
  await tag.evaluate((el) => el.remove());
  return file;
}

/**
 * Mise en page : cibles trop petites (hauteur < min px ; liens dans un paragraphe exemptés), débordement
 * horizontal, largeur et hauteur du document.
 */
export async function layout(page, min) {
  return page.evaluate((minH) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const small = [...document.querySelectorAll("button, a[href], select, input:not([type=hidden])")]
      .filter(vis)
      .filter((el) => !el.closest(".sr-only") && !(el.tagName === "A" && el.closest("p, li") && !el.classList.contains("btn") && el.closest(".prose")))
      .map((el) => ({ el: el.id || el.dataset.action || (el.textContent || "").trim().slice(0, 30) || el.tagName, h: Math.round(el.getBoundingClientRect().height * 10) / 10 }))
      .filter((x) => x.h < minH);
    return {
      small,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      width: Math.round(document.body.getBoundingClientRect().width),
      height: Math.round(document.body.getBoundingClientRect().height),
    };
  }, min);
}

/** Identifiant lisible de l'élément focalisé (pour vérifier l'ordre de tabulation). */
export const focusId = (f) => (f.type === "radio" ? `radio:${f.value}` : f.id || f.action || f.name);

/** Élément focalisé : description courte + anneau de focus visible ? */
export async function focusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    // Pastille segmentée : l'anneau est dessiné sur la pastille qui suit l'input (masqué).
    const ringEl = el.matches(".seg-opt input") ? el.nextElementSibling : el;
    const cs = getComputedStyle(ringEl);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      type: el.getAttribute("type"),
      value: el.value ?? null,
      action: el.dataset?.action ?? null,
      name: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().replace(/\s+/g, " ").slice(0, 60),
      ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2,
      ringColor: cs.outlineColor,
    };
  });
}
