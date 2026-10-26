// Chargement RÉEL du ZIP distribué (release/aethryon-extension-<version>.zip), comme le fera un utilisateur :
// archive construite (build de production + scripts/zip.mjs), décompressée dans un dossier temporaire, chargée
// par --load-extension dans Chromium. Vérifie : identifiant stable necpohicddjeaeaaomaakehcbccapabg, service
// worker démarré, page d'accueil ouverte au premier lancement, popup / réglages / accueil sans erreur,
// permissions exactement minimales, et l'avis de nouvelle version quand un latest.json de TEST annonce une
// version plus récente.
// Le paquet de production lit https://raccourci.malvu.fr/downloads/extension/latest.json : pour ce test SEUL, le
// navigateur résout raccourci.malvu.fr vers un serveur HTTPS local (--host-resolver-rules, certificat de test
// accepté par --ignore-certificate-errors) ; tout autre nom est introuvable (aucune requête ne sort, ni vers la
// production, ni vers une plateforme). L'adresse est donc configurable pour le test sans l'être dans le produit.
//   node --test tests/browser/release.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchWithExtension, VERSION } from "../support/browser.mjs";
import { axe, serious } from "./ui-helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASE_ID = "necpohicddjeaeaaomaakehcbccapabg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [MAJOR, MINOR] = VERSION.split(".").map(Number);
const NEWER = `${MAJOR}.${MINOR + 1}.0`; // annoncée par le latest.json de test

describe("ZIP distribué : chargé tel quel dans Chromium", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aethryon-release-load-"));
  const hits = [];
  let server;
  let b;
  let zipName;
  let manifest;

  before(async () => {
    const dist = join(tmp, "dist");
    const out = join(tmp, "release");
    execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs"), "--target=prod", `--out=${dist}`], { cwd: ROOT, stdio: "pipe" });
    execFileSync(process.execPath, [join(ROOT, "scripts/zip.mjs"), `--dist=${dist}`, `--out=${out}`], { cwd: ROOT, stdio: "pipe" });
    zipName = JSON.parse(readFileSync(join(out, "latest.json"), "utf8")).file;
    const ext = join(tmp, "extension-decompressee");
    execFileSync("unzip", ["-q", join(out, zipName), "-d", ext]);
    manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
    // latest.json de TEST : une version plus récente que celle du ZIP.
    const latest = { version: NEWER, file: `aethryon-extension-${NEWER}.zip`, sha256: "b".repeat(64), size: 300000, released: "2026-11-02", minChrome: 140, notes: ["Version de test annoncée par un latest.json local.", "Rien n'est téléchargé ni installé par l'extension."] };
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tmp, "key.pem"), "-out", join(tmp, "cert.pem"), "-days", "1",
      "-subj", "/CN=raccourci.malvu.fr", "-addext", "subjectAltName=DNS:raccourci.malvu.fr"], { stdio: "ignore" });
    server = createServer({ key: readFileSync(join(tmp, "key.pem")), cert: readFileSync(join(tmp, "cert.pem")) }, (req, res) => {
      hits.push({ method: req.method, url: req.url, host: req.headers.host, auth: !!req.headers.authorization, cookie: !!req.headers.cookie });
      if (req.url === "/downloads/extension/latest.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(latest));
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("non");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    writeFileSync(join(tmp, "port"), String(port));
    b = await launchWithExtension({
      extDir: ext, downloadDir: tmp, extensionId: RELEASE_ID,
      extraArgs: [`--host-resolver-rules=MAP raccourci.malvu.fr 127.0.0.1:${port}, MAP * ~NOTFOUND`, "--ignore-certificate-errors"],
    });
  });

  after(async () => {
    await b?.close();
    server?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Page de l'extension : rendu sans erreur de console ni violation CSP, axe clair et sombre. */
  async function openExtPage(path, ready) {
    const page = await b.context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`chrome-extension://${RELEASE_ID}/${path}`);
    await page.waitForSelector(ready, { timeout: 15_000 });
    await page.waitForTimeout(500);
    const problems = [];
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      const bad = serious(await axe(page));
      if (bad.length) problems.push(`${path}/${scheme} ${JSON.stringify(bad)}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    return { page, errors, problems };
  }

  test(`identifiant stable necpohicddjeaeaaomaakehcbccapabg, service worker démarré, version ${VERSION} publique (sans « bêta »)`, async (t) => {
    const sw = await b.worker();
    assert.equal(sw.url(), `chrome-extension://${RELEASE_ID}/background.js`);
    const m = await sw.evaluate(() => chrome.runtime.getManifest());
    assert.equal(chrome_id(sw.url()), RELEASE_ID);
    assert.deepEqual([m.name, m.version, m.version_name], ["AETHRYON", VERSION, undefined], "aucun libellé de statut : Chrome montre la version seule");
    t.diagnostic(`navigateur ${b.version} ; archive ${zipName}`);
  });

  test("permissions exactement minimales (manifeste chargé et permissions accordées par Chrome)", async () => {
    assert.deepEqual(manifest.permissions, ["storage", "downloads", "identity", "alarms", "activeTab"]);
    // 3.5.2 : nativeMessaging FACULTATIVE (lien avec AETHRYON Desktop) : déclarée, jamais accordée à l'installation.
    assert.deepEqual(manifest.optional_permissions, ["notifications", "nativeMessaging"]);
    assert.deepEqual(manifest.host_permissions, ["https://api.malvu.fr/*", "https://raccourci.malvu.fr/*"]);
    const granted = await (await b.worker()).evaluate(() => chrome.permissions.getAll());
    assert.deepEqual([...granted.permissions].sort(), ["activeTab", "alarms", "downloads", "identity", "storage"]);
    assert.deepEqual([...granted.origins].sort(), [
      "https://api.malvu.fr/*", "https://m.youtube.com/*", "https://mobile.twitter.com/*", "https://raccourci.malvu.fr/*",
      "https://twitter.com/*", "https://www.tiktok.com/*", "https://www.youtube.com/*", "https://x.com/*",
    ], "hôtes : API, site, et les pages des trois plateformes (content scripts) seulement");
  });

  test("premier lancement : page d'accueil ouverte, rendue sans erreur ; popup et réglages sans erreur ; aucune requête avant l'accord", async () => {
    let welcome = null;
    for (let i = 0; i < 100 && !welcome; i++) {
      welcome = b.context.pages().find((p) => p.url() === `chrome-extension://${RELEASE_ID}/welcome/welcome.html`) ?? null;
      if (!welcome) await sleep(100);
    }
    assert.ok(welcome, "page d'accueil ouverte par onInstalled");
    await welcome.close();
    const w = await openExtPage("welcome/welcome.html", "[data-action=consent-accept]");
    assert.equal((await w.page.locator("#w-version").textContent()), `Version ${VERSION}`);
    assert.deepEqual([...w.errors, ...w.problems], []);
    await w.page.screenshot({ path: join(ROOT, "tests", "out", "release-accueil.png"), fullPage: true });
    const p = await openExtPage("popup/popup.html", "#gate");
    assert.equal(await p.page.locator("#hero-title").textContent(), "Bienvenue");
    assert.deepEqual([...p.errors, ...p.problems], []);
    await p.page.close();
    const o = await openExtPage("options/options.html", "#consent-actions button");
    assert.deepEqual([...o.errors, ...o.problems], []);
    await o.page.close();
    assert.deepEqual(hits, [], "aucune requête (pas même latest.json) avant l'accord à la notice");
    // « Accepter » (vrai clic) : première vérification de mise à jour, vers raccourci.malvu.fr (serveur de test).
    await w.page.locator("[data-action=consent-accept]").click();
    await w.page.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done", null, { timeout: 10_000 });
    for (let i = 0; i < 100 && !hits.length; i++) await sleep(100);
    assert.deepEqual(hits, [{ method: "GET", url: "/downloads/extension/latest.json", host: "raccourci.malvu.fr", auth: false, cookie: false }]);
    await w.page.close();
  });

  test(`latest.json de test annonce ${NEWER} : avis « Nouvelle version ${NEWER} disponible » dans le popup et les réglages ; rien n'est téléchargé`, async () => {
    const p = await openExtPage("popup/popup.html", "#update-title");
    assert.equal(await p.page.locator("#update-title").textContent(), `Nouvelle version ${NEWER} disponible`);
    assert.deepEqual(await p.page.locator(".update-notes li").allTextContents(), ["Version de test annoncée par un latest.json local.", "Rien n'est téléchargé ni installé par l'extension."]);
    assert.deepEqual([...p.errors, ...p.problems], []);
    await p.page.screenshot({ path: join(ROOT, "tests", "out", "release-popup-nouvelle-version.png") });
    await p.page.close();
    const o = await openExtPage("options/options.html", "#update-title");
    assert.equal(await o.page.locator("#update-title").textContent(), `Nouvelle version ${NEWER} disponible`);
    assert.deepEqual([...o.errors, ...o.problems], []);
    await o.page.close();
    assert.equal(hits.length, 1, "une seule vérification (au plus une par 12 h), aucun fichier demandé");
    const downloads = await (await b.worker()).evaluate(() => chrome.downloads.search({}));
    assert.deepEqual(downloads, [], "rien n'a été téléchargé");
  });
});

/** Identifiant de l'extension dans une URL chrome-extension://<id>/… */
function chrome_id(url) {
  return new URL(url).host;
}
