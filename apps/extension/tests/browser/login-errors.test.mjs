// Connexion qui échoue, dans un VRAI Chromium (launchWebAuthFlow réel) contre un serveur LOCAL qui répond comme
// un site AETHRYON sans les routes de l'extension (404, la production d'aujourd'hui), en panne (503) ou dont la
// page de consentement reste ouverte (l'utilisateur ferme la fenêtre) : chaque cause a sa phrase, jamais
// « vérifie ta connexion » à tort. Puis compte lié dont le service répond 404 / 503 : état dégradé dans le
// VRAI popup, jamais « Connecté ».   node --test tests/browser/login-errors.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, launchWithExtension } from "../support/browser.mjs";
import { axe, serious } from "./ui-helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "tests", "out", "login-errors");
const NB = " ";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("connexion impossible : causes distinguées dans un vrai navigateur ; service du compte en panne", () => {
  let server;
  let port;
  let b;
  let dl;
  const state = { page: 404, me: 404, hits: [] };

  before(async () => {
    mkdirSync(OUT, { recursive: true });
    server = createServer((req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      state.hits.push(`${req.method} ${path} auth=${req.headers.authorization ? "oui" : "non"}`);
      if (path === "/extension/autoriser") {
        res.writeHead(state.page, { "content-type": "text/html; charset=utf-8" });
        return res.end(state.page === 200 ? "<!doctype html><title>Consentement (test)</title><h1>Autoriser l'extension ?</h1>" : `<!doctype html><title>${state.page}</title><h1>${state.page}</h1>`);
      }
      if (path === "/api/extension/me") {
        res.writeHead(state.me, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: state.me === 404 ? "not_found" : "unavailable" }));
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
    const out = "tests/out/dist-login-errors";
    execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", `--out=${out}`], {
      cwd: ROOT, stdio: "ignore",
      env: { ...process.env, AETHRYON_SITE: `http://localhost:${port}`, AETHRYON_API: `http://127.0.0.1:${port}/media` },
    });
    dl = mkdtempSync(join(tmpdir(), "aethryon-dl-err-"));
    b = await launchWithExtension({ extDir: join(ROOT, out), downloadDir: dl });
    await b.worker();
    assert.equal((await b.acceptConsent())?.ok, true);
  });

  after(async () => {
    await b?.close();
    server?.close();
    if (dl) rmSync(dl, { recursive: true, force: true });
  });

  /** Popup réel (service worker réel) dans un onglet de 380 × 600 ; capture claire et sombre, axe. */
  async function popupShot(name, action) {
    const page = await b.context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`);
    await page.waitForSelector("#conn:not([hidden])", { timeout: 15_000 });
    if (action) await action(page);
    const problems = [];
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      const bad = serious(await axe(page));
      if (bad.length) problems.push(`${name}/${scheme} ${JSON.stringify(bad)}`);
      await page.screenshot({ path: join(OUT, `${name}-${scheme === "light" ? "clair" : "sombre"}.png`) });
    }
    assert.deepEqual([...problems, ...errors], []);
    return page;
  }

  test("site sans les routes de l'extension (404, comme la production aujourd'hui) : « pas encore disponible », jamais « vérifie ta connexion »", { timeout: 60_000 }, async () => {
    state.page = 404;
    const r = await b.send({ type: "auth.login" });
    assert.deepEqual(r.error, { code: "service_missing", message: "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard.", retryable: true });
    // Popup réel : le message s'affiche sous le bouton, qui reste utilisable.
    const page = await popupShot("popup-connexion-404", async (p) => {
      await p.locator("[data-action=login]").click();
      await p.waitForFunction(() => /pas encore disponible/.test(document.querySelector(".login [role=alert]")?.textContent ?? ""), null, { timeout: 15_000 });
    });
    assert.ok(await page.locator("[data-action=login]").isEnabled());
    await page.close();
  });

  test("site en panne (503) : « momentanément indisponible (erreur 503) »", { timeout: 60_000 }, async () => {
    state.page = 503;
    const r = await b.send({ type: "auth.login" });
    assert.deepEqual(r.error, { code: "service_unavailable", message: "Le site AETHRYON est momentanément indisponible (erreur 503). Réessaie dans quelques minutes.", retryable: true });
  });

  test("page de consentement ouverte puis fenêtre fermée par l'utilisateur : « Connexion annulée. »", { timeout: 60_000 }, async () => {
    state.page = 200;
    const login = b.send({ type: "auth.login" });
    let win = null;
    for (let i = 0; i < 100 && !win; i++) {
      win = b.context.pages().find((p) => p.url().startsWith(`http://localhost:${port}/extension/autoriser`)) ?? null;
      if (!win) await sleep(100);
    }
    assert.ok(win, "fenêtre de connexion ouverte");
    await sleep(300);
    await win.close();
    const r = await login;
    assert.deepEqual(r.error, { code: "auth_cancelled", message: "Connexion annulée.", retryable: true });
  });

  test("serveur injoignable pendant la tentative : « Impossible de joindre AETHRYON »", { timeout: 60_000 }, async () => {
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
    const r = await b.send({ type: "auth.login" });
    assert.deepEqual(r.error, { code: "network", message: `Impossible de joindre AETHRYON${NB}: vérifie ta connexion à Internet, puis réessaie.`, retryable: true });
    await new Promise((r2) => server.listen(port, "127.0.0.1", r2));
  });

  test("compte lié, service du compte en 404 puis en 503 : état dégradé dans le vrai popup, jamais « Connecté »", { timeout: 60_000 }, async () => {
    const sw = await b.worker();
    await sw.evaluate((auth) => chrome.storage.local.set({ auth }), {
      token: `ytc_${"T".repeat(64)}`, expiresAt: null, email: "demo@example.test", name: "Démo", linkedAt: new Date().toISOString(),
    });
    state.me = 404;
    let init = await b.send({ type: "popup.init" });
    assert.deepEqual([init.data.account.connected, init.data.account.degraded], [true, { reason: "missing", status: 404 }]);
    let page = await popupShot("popup-service-404");
    assert.equal(await page.locator("#conn-label").textContent(), "Service indisponible");
    assert.equal(await page.locator("#degraded-title").textContent(), "Service pas encore disponible");
    await page.close();
    state.me = 503;
    init = await b.send({ type: "popup.init" });
    assert.deepEqual(init.data.account.degraded, { reason: "unavailable", status: 503 });
    page = await popupShot("popup-service-503");
    assert.match(await page.locator(".strip-text").textContent(), /\(503\)/);
    await page.close();
    assert.equal(await b.hasAuth(), true, "liaison gardée");
    assert.ok(state.hits.every((h) => !h.includes("/media/")), "aucune conversion demandée");
    await sw.evaluate(() => chrome.storage.local.remove("auth"));
  });
});
