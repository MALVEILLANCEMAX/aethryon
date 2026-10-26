// Lancement d'un VRAI Chromium (Chrome for Testing de Playwright) avec l'extension construite, en mode
// sans tête « new headless » (le seul qui charge les extensions), piloté par CDP.
// - téléchargements : comportement NORMAL du navigateur (Browser.setDownloadBehavior « default ») vers
//   le dossier fixé dans les préférences du profil de test (download.default_directory), sans boîte
//   « Enregistrer sous » ; Playwright n'intercepte donc pas les fichiers ;
// - --no-sandbox : nécessaire sous root sur ce serveur (navigateur de test jetable, pages locales).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const PW = process.env.PW ?? "playwright-core";
const { chromium } = require(PW);
export const CHROME = process.env.CHROME ?? join(homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome");
export const EXTENSION_ID = "dnllfjakdgmgfiompaheickmbjjlgjdc";
const ROOT = join(import.meta.dirname, "..", "..");
/** Version construite (package.json, recopiée dans le manifeste) et version de la notice sur les données (source). */
export const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
export const CONSENT_VERSION = Number(/export const CONSENT_VERSION = (\d+);/.exec(readFileSync(join(ROOT, "src/shared/consent.ts"), "utf8"))?.[1]);
if (!Number.isInteger(CONSENT_VERSION)) throw new Error("CONSENT_VERSION introuvable dans src/shared/consent.ts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `prefs` : préférences du profil ajoutées (ex. extensions.ui.developer_mode, extensions.pinned_extensions) ;
 * `env` : variables d'environnement du navigateur (ex. LANGUAGE=fr avec --lang=fr pour l'interface en français) ;
 * `profile` (3.5.2) : profil existant à rouvrir (gardé par `close({ keepProfile: true })`) ; `nativeHosts` (3.5.2) :
 * manifestes d'hôtes Native Messaging écrits dans <profil>/NativeMessagingHosts/<nom>.json (Chromium sous Linux
 * les y lit, en plus de ~/.config/chromium/NativeMessagingHosts).
 */
export async function launchWithExtension({ extDir, downloadDir, extensionId = EXTENSION_ID, extraArgs = [], prefs = {}, env = {}, profile: reuse = null, nativeHosts = {} }) {
  const profile = reuse ?? mkdtempSync(join(tmpdir(), "aethryon-profile-"));
  if (!reuse) {
    mkdirSync(join(profile, "Default"), { recursive: true });
    writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({
      download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true },
      savefile: { default_directory: downloadDir },
      safebrowsing: { enabled: false },
      ...prefs,
    }));
  }
  for (const [name, manifest] of Object.entries(nativeHosts)) {
    mkdirSync(join(profile, "NativeMessagingHosts"), { recursive: true });
    writeFileSync(join(profile, "NativeMessagingHosts", `${name}.json`), JSON.stringify(manifest, null, 2));
  }
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const args = [
    "--headless", "--no-sandbox", `--user-data-dir=${profile}`, "--remote-debugging-port=0",
    `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-sync",
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
    "--metrics-recording-only", "--password-store=basic", ...extraArgs, "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...env } });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
  let port = null;
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100);
    const f = join(profile, "DevToolsActivePort");
    if (existsSync(f)) port = readFileSync(f, "utf8").split("\n")[0];
  }
  if (!port) {
    proc.kill("SIGKILL");
    throw new Error(`Chromium n'a pas démarré : ${stderr.slice(-800)}`);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
  const version = (await cdp.send("Browser.getVersion")).product;

  const worker = async () => {
    for (let i = 0; i < 200; i++) {
      const sw = context.serviceWorkers().find((w) => w.url() === `chrome-extension://${extensionId}/background.js`);
      if (sw) return sw;
      await sleep(50);
    }
    throw new Error("service worker de l'extension introuvable");
  };
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  // Annonces du service worker reçues par cette page (job.update, auth.changed, update.changed) : un job
  // effacé à la déconnexion n'est plus dans jobs.list, son dernier état annoncé reste lisible ici.
  await page.evaluate(() => {
    window.__events = [];
    chrome.runtime.onMessage.addListener((m, sender) => { if (!sender.tab && m && typeof m.type === "string") window.__events.push(m); });
  });

  return {
    browser, context, cdp, page, version, profile,
    worker,
    /** Message au service worker depuis une page de l'extension (comme le popup). */
    send: (msg) => page.evaluate((m) => chrome.runtime.sendMessage(m), msg),
    /** Lit storage.session depuis la page (sans réveiller le service worker). */
    sessionJobs: () => page.evaluate(async () => (await chrome.storage.session.get("jobs")).jobs ?? []),
    hasAuth: () => page.evaluate(async () => Boolean((await chrome.storage.local.get("auth")).auth)),
    /** Annonces reçues du service worker par la page de test (voir ci-dessus). */
    events: (type) => page.evaluate((t) => window.__events.filter((m) => !t || m.type === t), type),
    /** Accord à la notice sur les données, par le vrai chemin (comme le bouton « Accepter » de l'accueil). */
    acceptConsent: () => page.evaluate((version) => chrome.runtime.sendMessage({ type: "consent.accept", version }), CONSENT_VERSION),
    async waitJob(key, pred, { timeoutMs = 60_000, viaSession = false } = {}) {
      const end = Date.now() + timeoutMs;
      let last = null;
      for (;;) {
        const list = viaSession ? await this.sessionJobs() : (await this.send({ type: "jobs.list" }))?.data ?? [];
        last = list.find((j) => j.key === key) ?? null;
        // Retiré de la liste (déconnexion, clé refusée) : son dernier état annoncé.
        if (!last) last = await page.evaluate((k) => window.__events.filter((m) => m.type === "job.update" && m.job.key === k).at(-1)?.job ?? null, key);
        if (last && pred(last)) return last;
        if (Date.now() > end) throw new Error(`job ${key} : état attendu non atteint (dernier : ${last ? `${last.state} ${last.error?.code ?? ""}` : "absent"})`);
        await sleep(250);
      }
    },
    async close({ keepProfile = false } = {}) {
      try { await browser.close(); } catch { /* déjà fermé */ }
      if (keepProfile) {
        // Fermeture propre (préférences du profil écrites sur le disque), puis arrêt forcé si besoin.
        proc.kill("SIGTERM");
        for (let i = 0; i < 50 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(100);
      }
      proc.kill("SIGKILL");
      await sleep(200);
      if (!keepProfile) rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Arrête le service worker de l'extension (comme Chrome après 30 s d'inactivité) via CDP. */
export async function stopExtensionWorker(context, page) {
  const s = await context.newCDPSession(page);
  const versions = [];
  s.on("ServiceWorker.workerVersionUpdated", (e) => versions.push(...e.versions));
  await s.send("ServiceWorker.enable");
  for (let i = 0; i < 40 && !versions.some((v) => v.scriptURL.endsWith("/background.js")); i++) await sleep(50);
  const running = versions.filter((v) => v.scriptURL === `chrome-extension://${EXTENSION_ID}/background.js` && v.runningStatus === "running");
  for (const v of running) await s.send("ServiceWorker.stopWorker", { versionId: v.versionId });
  await s.detach();
  return running.length;
}
