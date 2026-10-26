// 3.6.1 : mise à jour en un clic, de bout en bout, dans un VRAI Chromium (Chrome for Testing de Playwright, new
// headless) :
// - le VRAI hôte Native Messaging d'AETHRYON Desktop (exemple `banc` du noyau construit avec `--features essais` par
//   tests/support/desktop-host.sh : même code que `aethryon-desktop.exe --nm`, seule la SOURCE des mises à jour change,
//   lue dans AETHRYON_ESSAI_MAJ_BASE / _CA / _ID ; en production elle est figée sur raccourci.malvu.fr) ;
// - un serveur HTTPS local (autorité et certificat d'essai produits par openssl) qui sert latest.json et l'archive
//   d'une version 3.8.99, faite par scripts/zip.mjs (deterministicZip) depuis la construction de développement ;
// - l'avis de l'extension (latest.json, AETHRYON_UPDATE_URL du build de dev) sur un petit serveur HTTP local ;
// - permission FACULTATIVE « nativeMessaging » accordée en écrivant dans le profil ce que Chrome y écrit quand
//   l'utilisateur accepte (la demande ne peut pas être cliquée sans tête).
// Trois parcours : extension chargée depuis un AUTRE dossier (version inchangée → explication avec le chemin exact),
// chargée depuis le DOSSIER GÉRÉ (nouvelle version après le rechargement, version précédente gardée), et repli sans
// Desktop. Ce banc ne remplace PAS l'essai sous Windows (registre, %LOCALAPPDATA%, Chrome, Edge, Brave).
//   AETHRYON_NM_EXE=/chemin/banc node --test tests/browser/mise-a-jour.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, launchWithExtension, VERSION } from "../support/browser.mjs";
import { startFakeServer } from "../support/fake-api.mjs";
import { deterministicZip } from "../../scripts/zip.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXE = process.env.AETHRYON_NM_EXE ?? "";
const HOST = "fr.aethryon.desktop";
const NEW = "3.8.99";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// « Mode développeur » activé, comme chez quiconque a chargé une extension non empaquetée : sans lui, Chromium 153
// ne recharge pas une extension non empaquetée (chrome.runtime.reload() la fait disparaître de chrome://extensions,
// essai fait le 2026-10-21) — d'où la consigne affichée par l'extension.
const PREFS = { extensions: { ui: { developer_mode: true } } };

async function waitFor(fn, { timeoutMs = 20_000, every = 50, what = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`);
    await sleep(every);
  }
}

function grantInProfile(profile, permission) {
  const f = join(profile, "Default", "Preferences");
  const prefs = JSON.parse(readFileSync(f, "utf8"));
  const s = prefs.extensions?.settings?.[EXTENSION_ID];
  if (!s) throw new Error("réglages de l'extension introuvables dans le profil");
  for (const k of ["granted_permissions", "active_permissions"]) {
    s[k] = s[k] ?? {};
    s[k].api = [...new Set([...(s[k].api ?? []), permission])];
  }
  writeFileSync(f, JSON.stringify(prefs));
}

const version = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).version;
  } catch {
    return null;
  }
};

describe("Mise à jour en un clic : vrai Chromium, vrai hôte Native Messaging, serveur HTTPS local", { skip: !EXE || !existsSync(EXE) ? "AETHRYON_NM_EXE absent (tests/support/desktop-host.sh)" : false }, () => {
  let fake;
  let work;
  let https;
  let http;
  let base;
  let zip;
  let latest;
  const dist = join(ROOT, "tests/out/dist-maj");
  const served = [];

  before(async () => {
    work = mkdtempSync(join(tmpdir(), "aethryon-maj-e2e-"));
    // Autorité et certificat d'essai (127.0.0.1), jetables.
    const o = (...a) => execFileSync("openssl", a, { cwd: work, stdio: "ignore" });
    o("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=AETHRYON essai", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
    o("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "srv.key", "-out", "srv.csr", "-subj", "/CN=127.0.0.1");
    writeFileSync(join(work, "ext.cnf"), "subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n");
    o("x509", "-req", "-in", "srv.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "srv.pem", "-days", "2", "-extfile", "ext.cnf");
    https = createHttpsServer({ key: readFileSync(join(work, "srv.key")), cert: readFileSync(join(work, "srv.pem")) }, (req, res) => {
      served.push(req.url);
      if (req.url === "/latest.json") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(latest));
      if (req.url === `/aethryon-extension-${NEW}.zip`) return res.writeHead(200, { "content-type": "application/zip", "content-length": zip.length }).end(zip);
      res.writeHead(404).end();
    });
    await new Promise((r) => https.listen(0, "127.0.0.1", r));
    http = createHttpServer((req, res) => {
      if (req.url === "/latest.json") return res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }).end(JSON.stringify(latest));
      res.writeHead(404).end();
    });
    await new Promise((r) => http.listen(0, "127.0.0.1", r));
    fake = await startFakeServer({});
    execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", `--out=${dist}`], {
      cwd: ROOT, stdio: "ignore",
      env: { ...process.env, AETHRYON_API: fake.apiBase, AETHRYON_SITE: fake.siteBase, AETHRYON_UPDATE_URL: `http://127.0.0.1:${http.address().port}/latest.json` },
    });
    // Nouvelle version : la même construction, version 3.8.99 (clé de développement : AETHRYON_ESSAI_MAJ_ID).
    const neuve = join(work, "neuve");
    cpSync(dist, neuve, { recursive: true });
    const m = JSON.parse(readFileSync(join(neuve, "manifest.json"), "utf8"));
    m.version = NEW;
    m.name = "AETHRYON"; // l'hôte n'installe que l'extension nommée AETHRYON (le build de dev s'appelle « AETHRYON (dev) »)
    delete m.version_name;
    writeFileSync(join(neuve, "manifest.json"), JSON.stringify(m, null, 2));
    zip = deterministicZip(neuve);
    latest = { version: NEW, file: `aethryon-extension-${NEW}.zip`, sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length, released: "2026-10-21", minChrome: 116, notes: ["Version d'essai du banc."] };
  });

  after(async () => {
    await fake?.close();
    https?.close();
    http?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  /** Profil prêt : notice acceptée, permission « nativeMessaging » accordée, hôte déclaré (sauf `sansHote`). */
  async function prepare(extDir, { sansHote = false } = {}) {
    base = mkdtempSync(join(work, "profil-"));
    const env = {
      AETHRYON_BASE: base,
      AETHRYON_ESSAI_MAJ_BASE: `https://127.0.0.1:${https.address().port}/`,
      AETHRYON_ESSAI_MAJ_CA: join(work, "ca.pem"),
      AETHRYON_ESSAI_MAJ_ID: EXTENSION_ID,
    };
    const nativeHosts = sansHote ? {} : { [HOST]: { name: HOST, description: "AETHRYON Desktop (banc Linux)", path: EXE, type: "stdio", allowed_origins: [`chrome-extension://${EXTENSION_ID}/`] } };
    const dl = join(base, "Downloads");
    mkdirSync(dl, { recursive: true });
    let b = await launchWithExtension({ extDir, downloadDir: dl, env, nativeHosts, prefs: PREFS });
    await b.worker();
    assert.equal((await b.acceptConsent())?.ok, true);
    await b.close({ keepProfile: true });
    grantInProfile(b.profile, "nativeMessaging");
    b = await launchWithExtension({ extDir, downloadDir: dl, env, nativeHosts, profile: b.profile });
    assert.equal(await b.page.evaluate(() => chrome.permissions.contains({ permissions: ["nativeMessaging"] })), true);
    return b;
  }

  /** Popup rouvert : avis « Nouvelle version 3.8.99 » et bouton « Mettre à jour ». */
  async function openPopup(b) {
    await b.page.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`);
    await waitFor(() => b.page.$("[data-action=update-install]"), { what: "bouton « Mettre à jour »" });
    assert.match(await b.page.textContent("#update-title"), new RegExp(`Nouvelle version ${NEW.replace(/\./g, "\\.")} disponible`));
  }

  /** Clic, puis relevé des étapes affichées jusqu'au rechargement (la page se ferme avec l'extension). */
  async function clickAndWatch(b) {
    const shown = [];
    await b.page.click("[data-action=update-install]");
    for (let i = 0; i < 400; i++) {
      let s = null;
      try {
        s = await b.page.evaluate(() => document.querySelector(".update-step[data-state=en-cours]")?.dataset.step ?? document.querySelector(".form-error")?.textContent ?? null);
      } catch {
        break; // page fermée par le rechargement de l'extension
      }
      if (s && shown.at(-1) !== s) shown.push(s);
      if (s && !["telechargement", "verification", "installation", "redemarrage"].includes(s)) break;
      await sleep(25);
    }
    return shown;
  }

  /** Nouvelle page de l'extension après le rechargement : version chargée. */
  async function reopened(b) {
    let last = "";
    try {
      return await waitFor(async () => {
        const p = await b.context.newPage();
        try {
          await p.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`, { timeout: 3_000 });
          const v = await p.evaluate(() => chrome.runtime.getManifest().version);
          return { p, v };
        } catch (e) {
          last = String(e?.message ?? e).split("\n")[0];
          await p.close().catch(() => {});
          return null;
        }
      }, { timeoutMs: 20_000, every: 300, what: "extension rechargée" });
    } catch (e) {
      const cibles = (await b.cdp.send("Target.getTargets")).targetInfos.map((x) => `${x.type} ${x.url}`).join(" | ");
      throw new Error(`${e.message} (dernière erreur : ${last} ; cibles : ${cibles})`);
    }
  }

  test("chargée depuis un AUTRE dossier : Desktop installe 3.8.99 dans le dossier géré, l'extension redémarre, version inchangée → explication unique avec le chemin exact", { timeout: 120_000 }, async (t) => {
    const b = await prepare(dist);
    try {
      t.diagnostic(`navigateur : ${b.version} ; hôte : ${EXE}`);
      await openPopup(b);
      const shown = await clickAndWatch(b);
      t.diagnostic(`étapes vues dans le popup : ${shown.join(" → ")}`);
      assert.ok(shown.includes("redemarrage"), `étapes : ${shown.join(" → ")}`);
      assert.ok(shown.indexOf("redemarrage") > 0, "au moins une étape réelle avant le redémarrage");
      const geree = join(base, "Local", "AETHRYON", "extension");
      assert.equal(version(geree), NEW, "dossier géré : 3.8.99 installée par le vrai hôte");
      assert.equal(served.filter((u) => u === `/aethryon-extension-${NEW}.zip`).length >= 1, true, "archive lue sur le serveur HTTPS local");
      const { p, v } = await reopened(b);
      assert.equal(v, VERSION, "le navigateur charge toujours l'autre dossier : version inchangée");
      await waitFor(() => p.$("#update-hint"), { what: "explication du chargement unique" });
      assert.equal(await p.textContent("#update-hint-title"), "Charge l'extension depuis le dossier AETHRYON (une seule fois)");
      assert.equal(await p.textContent("[data-role=load-folder]"), geree, "chemin EXACT donné par Desktop");
      assert.equal(await p.$("[data-action=update-install]"), null, "l'explication remplace le bouton tant que ce n'est pas réglé");
      await p.click("[data-action=hint-dismiss]");
      await waitFor(async () => (await p.$("#update-hint")) === null, { what: "explication masquée" });
    } finally {
      await b.close();
    }
  });

  test("chargée depuis le DOSSIER GÉRÉ : après le clic, chrome.runtime.reload() charge 3.8.99 ; 3.8.0 gardée comme précédente ; aucune explication", { timeout: 120_000 }, async (t) => {
    // Le dossier géré contient d'abord la version actuelle (comme après AETHRYON Setup), et c'est lui qui est chargé.
    const pre = mkdtempSync(join(work, "pre-"));
    const geree = join(pre, "Local", "AETHRYON", "extension");
    mkdirSync(dirname(geree), { recursive: true });
    cpSync(dist, geree, { recursive: true });
    const b0 = await prepareAt(pre, geree);
    try {
      await openPopup(b0);
      const shown = await clickAndWatch(b0);
      t.diagnostic(`étapes : ${shown.join(" → ")}`);
      const { p, v } = await reopened(b0);
      assert.equal(v, NEW, "la version chargée a changé : nouveaux fichiers lus dans le même dossier");
      assert.equal(version(geree), NEW);
      assert.equal(version(join(pre, "Local", "AETHRYON", "extension-precedente")), VERSION, "version précédente gardée pour le retour arrière");
      await sleep(500);
      assert.equal(await p.$("#update-hint"), null, "aucune explication : c'est réglé");
      assert.equal(await p.$("[data-action=update-install]"), null, "plus d'avis : 3.8.99 est la dernière");
    } finally {
      await b0.close();
    }
  });

  test("repli sans AETHRYON Desktop : message clair, « Page de téléchargement » mise en avant, rien d'installé", { timeout: 90_000 }, async () => {
    const b = await prepare(dist, { sansHote: true });
    try {
      await openPopup(b);
      const shown = await clickAndWatch(b);
      const err = await waitFor(() => b.page.textContent(".update .form-error").then((x) => x?.trim() || null), { what: "message de repli" });
      assert.match(err, /AETHRYON Desktop n'est pas installé/);
      assert.ok(!shown.includes("redemarrage"));
      assert.match(await b.page.getAttribute("[data-action=update-open]", "class"), /btn-primary/);
      assert.equal(existsSync(join(base, "Local", "AETHRYON", "extension")), false);
    } finally {
      await b.close();
    }
  });

  /** Comme prepare(), mais pour un profil dont la base et le dossier de l'extension sont donnés. */
  async function prepareAt(pre, extDir) {
    base = pre;
    const env = { AETHRYON_BASE: pre, AETHRYON_ESSAI_MAJ_BASE: `https://127.0.0.1:${https.address().port}/`, AETHRYON_ESSAI_MAJ_CA: join(work, "ca.pem"), AETHRYON_ESSAI_MAJ_ID: EXTENSION_ID };
    const nativeHosts = { [HOST]: { name: HOST, description: "AETHRYON Desktop (banc Linux)", path: EXE, type: "stdio", allowed_origins: [`chrome-extension://${EXTENSION_ID}/`] } };
    const dl = join(pre, "Downloads");
    mkdirSync(dl, { recursive: true });
    let b = await launchWithExtension({ extDir, downloadDir: dl, env, nativeHosts, prefs: PREFS });
    await b.worker();
    assert.equal((await b.acceptConsent())?.ok, true);
    await b.close({ keepProfile: true });
    grantInProfile(b.profile, "nativeMessaging");
    b = await launchWithExtension({ extDir, downloadDir: dl, env, nativeHosts, profile: b.profile });
    return b;
  }
});
