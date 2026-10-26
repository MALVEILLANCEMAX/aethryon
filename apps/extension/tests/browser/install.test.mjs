// Installation et mise à jour MANUELLES dans un vrai Chromium à l'interface en FRANÇAIS, avec le ZIP de production
// (build de production + scripts/zip.mjs, décompressé dans un dossier « AETHRYON ») — ce que fera un utilisateur de
// Chrome en suivant le guide de la page /extension :
//   - chrome://extensions : libellés exacts repris par le guide (« Mode développeur », « Charger l'extension non
//     empaquetée », « Actualiser », « Supprimer »), carte AETHRYON (nom, version affichée, identifiant stable) ;
//   - épinglage LU dans Chrome (chrome.action.getUserSettings) : page d'accueil « pas encore épinglée », puis
//     « C'est fait » quand l'icône est épinglée (préférence du profil, comme un clic sur la punaise) ;
//   - mise à jour : contenu du dossier remplacé par une version plus récente puis VRAI clic sur « Actualiser » →
//     nouvelle version chargée, accord, liaison et réglages conservés, aucune page d'accueil rouverte ; ou nouveau
//     dossier chargé comme par « Charger l'extension non empaquetée » (CDP Extensions.loadUnpacked) → il remplace
//     l'ancien (même identifiant), données conservées.
// Ce qui n'est PAS couvert : le sélecteur de dossier natif du bouton « Charger l'extension non empaquetée » (le
// chargement passe par --load-extension, puis par Extensions.loadUnpacked, le même installateur), la barre d'outils
// réelle (mode sans tête : l'épinglage est posé par la préférence du profil), Edge et Brave.
// Aucune requête réseau : tout nom d'hôte est introuvable (--host-resolver-rules) ; la liaison est factice.
//   node --test tests/browser/install.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VERSION, launchWithExtension, VERSION } from "../support/browser.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "tests", "out", "install");
const ID = "necpohicddjeaeaaomaakehcbccapabg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FR = { extraArgs: ["--lang=fr", "--enable-unsafe-extension-debugging", "--host-resolver-rules=MAP * ~NOTFOUND"], env: { LANGUAGE: "fr" } };
const DEV_MODE = { extensions: { ui: { developer_mode: true } } };
const [MAJOR, MINOR, PATCH] = VERSION.split(".").map(Number);
const NEXT1 = `${MAJOR}.${MINOR}.${PATCH + 1}`; // versions « plus récentes » fabriquées pour les essais de mise à jour
const NEXT2 = `${MAJOR}.${MINOR}.${PATCH + 2}`;
// Version DISTRIBUÉE aujourd'hui (ZIP publié le 2026-10-11, empreinte de son latest.json) : mise à jour réelle depuis elle.
const PREVIOUS_ZIP = process.env.PREVIOUS_ZIP ?? join(ROOT, "release", "aethryon-extension-1.0.0.zip");
const PREVIOUS_SHA256 = "66cc63c675f8669ff349b2694d32e0f306976ba9f512c1c1b2cfbf28666a0c23";

/** Carte d'une extension dans chrome://extensions (composants web à racines ouvertes de Chromium). */
async function extensionCard(page, id) {
  return page.evaluate((x) => {
    const mgr = document.querySelector("extensions-manager");
    const toolbar = mgr?.shadowRoot?.querySelector("extensions-toolbar")?.shadowRoot;
    const list = mgr?.shadowRoot?.querySelector("extensions-item-list")?.shadowRoot;
    const items = [...(list?.querySelectorAll("extensions-item") ?? [])];
    const r = items.find((it) => it.id === x)?.shadowRoot;
    const label = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      lang: document.documentElement.lang,
      devMode: label(toolbar?.querySelector("#devModeLabel")),
      devModeOn: toolbar?.querySelector("#devMode")?.checked ?? null,
      loadUnpacked: label(toolbar?.querySelector("#loadUnpacked")),
      count: items.length,
      card: r ? {
        name: label(r.querySelector("#name")), version: label(r.querySelector("#version")), idText: label(r.querySelector("#extension-id")),
        reload: r.querySelector("#dev-reload-button")?.getAttribute("aria-label") ?? null, details: label(r.querySelector("#detailsButton")),
        remove: label(r.querySelector("#removeButton")), enabled: r.querySelector("#enableToggle")?.checked ?? null,
      } : null,
    };
  }, id);
}

/** Clic RÉEL sur « Actualiser » (bouton de rechargement d'une extension non empaquetée). */
async function clickReload(page, id) {
  const handle = await page.evaluateHandle((x) => document.querySelector("extensions-manager").shadowRoot.querySelector("extensions-item-list").shadowRoot
    .querySelector(`extensions-item#${x}`).shadowRoot.querySelector("#dev-reload-button"), id);
  await handle.asElement().click();
}

/** Copie du dossier extrait, numéro de version changé (même clé publique, donc même identifiant). */
function newerCopy(from, to, version) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  const m = JSON.parse(readFileSync(join(to, "manifest.json"), "utf8"));
  m.version = version;
  m.version_name = `${version} (test de mise à jour)`;
  writeFileSync(join(to, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);
}

describe("installation et mise à jour manuelles (Chromium en français, ZIP de production)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aethryon-install-"));
  const extracted = join(tmp, "zip-extrait");
  let zipName;

  before(() => {
    mkdirSync(OUT, { recursive: true });
    const dist = join(tmp, "dist");
    const out = join(tmp, "release");
    execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs"), "--target=prod", `--out=${dist}`], { cwd: ROOT, stdio: "pipe" });
    execFileSync(process.execPath, [join(ROOT, "scripts/zip.mjs"), `--dist=${dist}`, `--out=${out}`], { cwd: ROOT, stdio: "pipe" });
    zipName = JSON.parse(readFileSync(join(out, "latest.json"), "utf8")).file;
    execFileSync("unzip", ["-q", join(out, zipName), "-d", extracted]);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  test("chrome://extensions en français : libellés du guide, carte AETHRYON, identifiant stable ; épinglage lu dans Chrome", { timeout: 90_000 }, async (t) => {
    const folder = join(tmp, "AETHRYON");
    cpSync(extracted, folder, { recursive: true });
    const dl = mkdtempSync(join(tmp, "dl-"));
    let b = await launchWithExtension({ extDir: folder, downloadDir: dl, extensionId: ID, prefs: DEV_MODE, ...FR });
    try {
      const page = await b.context.newPage();
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.goto("chrome://extensions/");
      let info = null;
      for (let i = 0; i < 50 && !info?.card; i++) { await sleep(100); info = await extensionCard(page, ID); }
      t.diagnostic(`${b.version} : ${JSON.stringify(info)}`);
      assert.equal(info.lang, "fr");
      assert.equal(info.devMode, "Mode développeur");
      assert.equal(info.devModeOn, true);
      assert.equal(info.loadUnpacked, "Charger l'extension non empaquetée");
      assert.equal(info.count, 1);
      assert.deepEqual(info.card, {
        name: "AETHRYON", version: VERSION, idText: `ID : ${ID}`, reload: "Actualiser", details: "Détails", remove: "Supprimer", enabled: true,
      });
      await page.screenshot({ path: join(OUT, "chrome-extensions-fr.png") });
      // Épinglage : pas encore épinglée (profil neuf) → l'accueil le dit, sans rien supposer.
      const sw = await b.worker();
      assert.deepEqual(await sw.evaluate(() => chrome.action.getUserSettings()), { isOnToolbar: false });
      const welcome = b.context.pages().find((p) => p.url() === `chrome-extension://${ID}/welcome/welcome.html`);
      assert.ok(welcome, "page d'accueil ouverte au premier lancement");
      await welcome.waitForFunction(() => /pas encore épinglée/.test(document.querySelector("#pin-status")?.textContent ?? ""), null, { timeout: 10_000 });
      assert.equal(await welcome.locator("#epingler").getAttribute("data-state"), "current");
    } finally {
      await b.close();
    }
    // Icône épinglée dans Chrome (préférence du profil, comme après un clic sur la punaise du menu « Extensions »).
    b = await launchWithExtension({ extDir: folder, downloadDir: dl, extensionId: ID, prefs: { extensions: { ...DEV_MODE.extensions, pinned_extensions: [ID] } }, ...FR });
    try {
      const sw = await b.worker();
      assert.deepEqual(await sw.evaluate(() => chrome.action.getUserSettings()), { isOnToolbar: true });
      const welcome = await b.context.newPage();
      await welcome.goto(`chrome-extension://${ID}/welcome/welcome.html`);
      await welcome.waitForFunction(() => /C.est fait/.test(document.querySelector("#pin-status")?.textContent ?? ""), null, { timeout: 10_000 });
      assert.equal(await welcome.locator("#epingler").getAttribute("data-state"), "done");
    } finally {
      await b.close();
    }
  });

  test("mise à jour : contenu du dossier remplacé puis « Actualiser » (vrai clic), ou nouveau dossier chargé → nouvelle version, données conservées", { timeout: 120_000 }, async (t) => {
    const folder = join(tmp, "AETHRYON-maj");
    cpSync(extracted, folder, { recursive: true });
    const dl = mkdtempSync(join(tmp, "dl-"));
    const b = await launchWithExtension({ extDir: folder, downloadDir: dl, extensionId: ID, prefs: DEV_MODE, ...FR });
    try {
      let sw = await b.worker();
      // État local d'un utilisateur : accord à la notice, liaison (factice : aucune requête possible), réglage synchronisé.
      await sw.evaluate(async (version) => {
        await chrome.storage.local.set({
          consent: { version, at: "2026-10-11T08:00:00.000Z" },
          auth: { token: `ytc_${"a".repeat(64)}`, expiresAt: "2027-01-09T00:00:00.000Z", email: "maj@exemple.test", name: "", linkedAt: "2026-10-11T08:01:00.000Z" },
        });
        await chrome.storage.sync.set({ settings: { defaultFmt: "mp3" } });
      }, CONSENT_VERSION);
      const state = (w) => w.evaluate(async () => {
        const l = await chrome.storage.local.get(["consent", "auth"]);
        const s = await chrome.storage.sync.get("settings");
        return { version: chrome.runtime.getManifest().version, consent: l.consent?.at ?? null, auth: l.auth?.email ?? null, fmt: s.settings?.defaultFmt ?? null };
      });
      const page = await b.context.newPage();
      await page.goto("chrome://extensions/");
      await page.waitForFunction(() => !!document.querySelector("extensions-manager")?.shadowRoot?.querySelector("extensions-item-list"), null, { timeout: 10_000 });
      const welcomeTabs = () => b.context.pages().filter((p) => p.url().endsWith("/welcome/welcome.html")).length;
      assert.equal(welcomeTabs(), 1, "page d'accueil du premier lancement");
      // 1. Le guide : extraire la nouvelle archive À LA PLACE du contenu du dossier, puis « Actualiser ».
      newerCopy(extracted, folder, NEXT1);
      await clickReload(page, ID);
      let card = null;
      for (let i = 0; i < 60 && card?.version !== `${NEXT1} (test de mise à jour)`; i++) { await sleep(100); card = (await extensionCard(page, ID)).card; }
      assert.equal(card.version, `${NEXT1} (test de mise à jour)`);
      sw = await b.worker();
      for (let i = 0; i < 30 && (await state(sw).catch(() => null))?.version !== NEXT1; i++) { await sleep(100); sw = await b.worker(); }
      assert.deepEqual(await state(sw), { version: NEXT1, consent: "2026-10-11T08:00:00.000Z", auth: "maj@exemple.test", fmt: "mp3" }, "accord, liaison et réglages conservés");
      await sleep(500);
      // Le rechargement ferme les pages ouvertes de l'extension ; une mise à jour (onInstalled « update ») ne rouvre pas l'accueil.
      assert.equal(welcomeTabs(), 0, "aucune page d'accueil rouverte par la mise à jour");
      await page.screenshot({ path: join(OUT, "chrome-extensions-apres-actualiser.png") });
      // Pages de l'extension après la mise à jour : la page d'accueil lit la version du manifeste chargé ; le popup ne
      // redemande pas l'accord et garde la liaison (hors ligne ici : aucun nom ne se résout).
      const w = await b.context.newPage();
      await w.goto(`chrome-extension://${ID}/welcome/welcome.html`);
      await w.waitForFunction((v) => document.querySelector("#w-version")?.textContent === `Version ${v}`, NEXT1, { timeout: 10_000 });
      await w.close();
      const popup = await b.context.newPage();
      await popup.goto(`chrome-extension://${ID}/popup/popup.html`);
      await popup.waitForSelector("#conn:not([hidden])", { timeout: 15_000 });
      assert.equal(await popup.locator("#gate").count(), 0, "notice déjà acceptée : pas de carte « Bienvenue »");
      assert.notEqual((await popup.locator("#conn-label").textContent()).trim(), "Non connecté", "liaison conservée");
      await popup.close();
      // 2. Variante : nouvelle archive extraite dans un AUTRE dossier, chargée par « Charger l'extension non empaquetée »
      //    (même installateur, appelé par le protocole DevTools) : elle remplace l'ancienne (même identifiant).
      const other = join(tmp, `AETHRYON-${NEXT2}`);
      newerCopy(extracted, other, NEXT2);
      const cdp = await b.browser.newBrowserCDPSession();
      assert.deepEqual(await cdp.send("Extensions.loadUnpacked", { path: other }), { id: ID });
      await page.reload();
      let info = null;
      for (let i = 0; i < 60 && info?.card?.version !== `${NEXT2} (test de mise à jour)`; i++) { await sleep(100); info = await extensionCard(page, ID); }
      assert.equal(info.count, 1, "une seule extension AETHRYON");
      assert.equal(info.card.version, `${NEXT2} (test de mise à jour)`);
      sw = await b.worker();
      for (let i = 0; i < 30 && (await state(sw).catch(() => null))?.version !== NEXT2; i++) { await sleep(100); sw = await b.worker(); }
      assert.deepEqual(await state(sw), { version: NEXT2, consent: "2026-10-11T08:00:00.000Z", auth: "maj@exemple.test", fmt: "mp3" });
      t.diagnostic(`Actualiser → ${NEXT1} et nouveau dossier → ${NEXT2} : accord, liaison et réglages conservés`);
    } finally {
      await b.close();
    }
  });

  test("mise à jour RÉELLE depuis la version distribuée 1.0.0 (son ZIP) : dossier remplacé puis « Actualiser » → liaison et réglages conservés ; notice modifiée redemandée une fois, AUCUNE requête avant le nouvel accord", { timeout: 150_000 }, async (t) => {
    if (!existsSync(PREVIOUS_ZIP)) {
      t.skip(`ZIP 1.0.0 absent (${PREVIOUS_ZIP}) : copier celui de release/ du dépôt principal ou indiquer PREVIOUS_ZIP`);
      return;
    }
    assert.equal(createHash("sha256").update(readFileSync(PREVIOUS_ZIP)).digest("hex"), PREVIOUS_SHA256, "ZIP 1.0.0 identique à celui qui est distribué");
    const v1 = join(tmp, "zip-1.0.0");
    execFileSync("unzip", ["-q", PREVIOUS_ZIP, "-d", v1]);
    const folder = join(tmp, "AETHRYON-depuis-1.0.0");
    cpSync(v1, folder, { recursive: true });
    // Serveur HTTPS local à la place de raccourci.malvu.fr et api.malvu.fr : chaque requête est NOTÉE (méthode, hôte,
    // chemin, présence d'une clé) ; latest.json annonce la version publiée ; tout le reste est coupé, comme hors ligne.
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tmp, "key.pem"), "-out", join(tmp, "cert.pem"), "-days", "1",
      "-subj", "/CN=raccourci.malvu.fr", "-addext", "subjectAltName=DNS:raccourci.malvu.fr,DNS:api.malvu.fr"], { stdio: "ignore" });
    const hits = [];
    const server = createServer({ key: readFileSync(join(tmp, "key.pem")), cert: readFileSync(join(tmp, "cert.pem")) }, (req, res) => {
      hits.push({ method: req.method, host: req.headers.host, url: req.url, auth: !!req.headers.authorization });
      if (req.url === "/downloads/extension/latest.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ version: "1.0.0", file: "aethryon-extension-1.0.0.zip", sha256: PREVIOUS_SHA256, size: 256905, released: "2026-10-11", minChrome: 140, notes: [] }));
      }
      req.socket.destroy();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const dl = mkdtempSync(join(tmp, "dl-"));
    const b = await launchWithExtension({
      extDir: folder, downloadDir: dl, extensionId: ID, prefs: DEV_MODE, env: FR.env,
      extraArgs: ["--lang=fr", "--enable-unsafe-extension-debugging", "--ignore-certificate-errors",
        `--host-resolver-rules=MAP raccourci.malvu.fr 127.0.0.1:${port}, MAP api.malvu.fr 127.0.0.1:${port}, MAP * ~NOTFOUND`],
    });
    const state = (w) => w.evaluate(async () => {
      const l = await chrome.storage.local.get(["consent", "auth"]);
      const s = await chrome.storage.sync.get("settings");
      return { version: chrome.runtime.getManifest().version, consent: l.consent?.version ?? null, auth: l.auth?.email ?? null, fmt: s.settings?.defaultFmt ?? null };
    });
    const extPage = async (prefix) => {
      for (let i = 0; i < 100; i++) {
        const p = b.context.pages().find((x) => x.url().startsWith(`chrome-extension://${ID}/${prefix}`));
        if (p) return p;
        await sleep(100);
      }
      return null;
    };
    try {
      let sw = await b.worker();
      assert.equal(await sw.evaluate(() => chrome.runtime.getManifest().version), "1.0.0");
      // 1.0.0 : accord à SA notice par le vrai bouton « Accepter » de sa page d'accueil.
      const welcome = await extPage("welcome/welcome.html");
      assert.ok(welcome, "page d'accueil de la 1.0.0");
      await welcome.locator("[data-action=consent-accept]").click();
      await welcome.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done", null, { timeout: 10_000 });
      await welcome.close();
      for (let i = 0; i < 100 && !hits.length; i++) await sleep(100);
      assert.ok(hits.some((x) => x.url === "/downloads/extension/latest.json"), "la 1.0.0 vérifie sa mise à jour après l'accord");
      // Liaison (factice) et réglage synchronisé, comme chez un utilisateur de la 1.0.0.
      await sw.evaluate(async () => {
        await chrome.storage.local.set({ auth: { token: `ytc_${"a".repeat(64)}`, expiresAt: "2027-01-09T00:00:00.000Z", email: "maj@exemple.test", name: "", linkedAt: "2026-10-11T08:01:00.000Z" } });
        await chrome.storage.sync.set({ settings: { defaultFmt: "mp3" } });
      });
      assert.deepEqual(await state(sw), { version: "1.0.0", consent: 1, auth: "maj@exemple.test", fmt: "mp3" });
      await sleep(500);
      hits.length = 0;
      // Mise à jour comme le dit le guide : nouvelle archive extraite À LA PLACE du contenu du dossier, puis « Actualiser ».
      const page = await b.context.newPage();
      await page.goto("chrome://extensions/");
      await page.waitForFunction(() => !!document.querySelector("extensions-manager")?.shadowRoot?.querySelector("extensions-item-list"), null, { timeout: 10_000 });
      rmSync(folder, { recursive: true, force: true });
      cpSync(extracted, folder, { recursive: true });
      await clickReload(page, ID);
      let card = null;
      for (let i = 0; i < 60 && card?.version !== VERSION; i++) { await sleep(100); card = (await extensionCard(page, ID)).card; }
      assert.equal(card.version, VERSION);
      sw = await b.worker();
      for (let i = 0; i < 30 && (await state(sw).catch(() => null))?.version !== VERSION; i++) { await sleep(100); sw = await b.worker(); }
      assert.deepEqual(await state(sw), { version: VERSION, consent: 1, auth: "maj@exemple.test", fmt: "mp3" }, "liaison, réglages et ancien accord conservés tels quels");
      await sleep(500);
      assert.equal(b.context.pages().filter((p) => p.url().startsWith(`chrome-extension://${ID}/welcome/`)).length, 0, "aucune page d'accueil rouverte par la mise à jour");
      await page.screenshot({ path: join(OUT, "mise-a-jour-depuis-1.0.0.png") });
      // Popup : notice à relire, dite comme telle ; la connexion est gardée ; rien n'est envoyé.
      const popup = await b.context.newPage();
      await popup.goto(`chrome-extension://${ID}/popup/popup.html`);
      await popup.waitForFunction(() => document.querySelector("#hero-title")?.textContent === "La notice a changé", null, { timeout: 15_000 });
      assert.equal((await popup.locator("#conn-label").textContent()).trim(), "Notice à relire");
      assert.match(await popup.locator("#gate .hero-text").textContent(), /Ta connexion est gardée/);
      await popup.screenshot({ path: join(OUT, "popup-apres-mise-a-jour.png") });
      await sleep(1000);
      assert.deepEqual(hits, [], "aucune requête après la mise à jour tant que la nouvelle notice n'est pas acceptée");
      // « Lire la notice et accepter » (vrai clic) → page d'accueil sur la notice → « Accepter » (vrai clic).
      await popup.locator("[data-action=open-notice]").click();
      const notice = await extPage("welcome/welcome.html");
      assert.ok(notice, "notice ouverte depuis le popup");
      await notice.locator("[data-action=consent-accept]").waitFor({ timeout: 10_000 });
      assert.equal(await notice.locator("#consent-area .notice span").textContent(),
        `Cette notice a changé depuis ton accord (nouvelles fonctions de la version ${VERSION}) : relis-la, puis accepte-la pour continuer.`);
      await notice.screenshot({ path: join(OUT, "notice-a-relire.png"), fullPage: true });
      assert.deepEqual(hits, [], "toujours aucune requête");
      await notice.locator("[data-action=consent-accept]").click();
      await notice.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done", null, { timeout: 10_000 });
      assert.equal((await state(sw)).consent, CONSENT_VERSION, "nouvel accord enregistré");
      for (let i = 0; i < 100 && !hits.length; i++) await sleep(100);
      assert.ok(hits.length > 0, "les requêtes reprennent après le nouvel accord");
      assert.ok(hits.every((x) => ["raccourci.malvu.fr", "api.malvu.fr"].includes(x.host)), JSON.stringify(hits));
      // Popup rouvert : plus de notice ; liaison gardée (hors ligne ici : le compte n'est pas joignable).
      await popup.close().catch(() => undefined);
      const again = await b.context.newPage();
      await again.goto(`chrome-extension://${ID}/popup/popup.html`);
      await again.waitForSelector("#conn:not([hidden])", { timeout: 15_000 });
      assert.equal(await again.locator("#gate").count(), 0);
      const label = (await again.locator("#conn-label").textContent()).trim();
      assert.ok(!["Non connecté", "Notice à relire"].includes(label), `liaison conservée (${label})`);
      t.diagnostic(`1.0.0 → ${VERSION} : liaison et réglages conservés ; notice ${CONSENT_VERSION} redemandée ; requêtes avant le nouvel accord : 0, après : ${hits.map((x) => `${x.method} ${x.host}${x.url}`).join(", ")}`);
    } finally {
      await b.close();
      server.close();
    }
  });
});
