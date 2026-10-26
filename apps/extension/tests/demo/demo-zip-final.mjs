// DÉMONSTRATION de l'extension AETHRYON 1.0.0 avec le VRAI ZIP FINAL, de bout en bout, contre la pile jetable ytc2-dx
// (site de la branche testée avec EXTENSION_DOWNLOAD=1, account avec la migration 004, ytapi à faux worker).
// Le navigateur de test résout raccourci.malvu.fr et api.malvu.fr vers le relais TLS local (dx-proxy.mjs) ; tout autre
// nom est introuvable (aucune requête vers la production ni vers une plateforme ; les pages YouTube/TikTok sont des
// pages FABRIQUÉES servies par interception). Seule étape non réelle : la connexion Google (session de test posée).
// Aucun secret affiché : cookie et jeton restent en mémoire.
//   node tests/demo/demo-zip-final.mjs   (pile dx et relais démarrés : voir README.md)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INTEG = new URL("../..", import.meta.url).pathname.replace(/\/$/, ""); // extension/
const { launchWithExtension } = await import(`${INTEG}/tests/support/browser.mjs`);
const { cdpFor, waitFor, FIXTURES } = await import(`${INTEG}/tests/browser/helpers.mjs`);
const { axe, serious } = await import(`${INTEG}/tests/browser/ui-helpers.mjs`);
const require = createRequire(import.meta.url);
const { chromium } = require("/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");

const DX = process.env.DX_STATE ?? "/tmp/aethryon-dx";          // mode.json et journal du relais
const OUT = process.env.DEMO_OUT ?? "demo-out";
const ID = "necpohicddjeaeaaomaakehcbccapabg";
const SITE = "https://raccourci.malvu.fr";
const RULES = ["--host-resolver-rules=MAP raccourci.malvu.fr 127.0.0.1:18199, MAP api.malvu.fr 127.0.0.1:18199, MAP * ~NOTFOUND", "--ignore-certificate-errors"];
const NB = " ";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const setMode = (m) => writeFileSync(join(DX, "mode.json"), JSON.stringify(m));
mkdirSync(OUT, { recursive: true });
// Seules les sorties de la démonstration sont remplacées (un rapport écrit à côté est conservé).
for (const f of readdirSync(OUT)) if (/^\d{2}-.+\.png$|^rapport-demo\.json$/.test(f)) rmSync(join(OUT, f), { force: true });

const report = { started: new Date().toISOString(), checks: [], shots: [], notes: [] };
function check(name, ok, detail = "") {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
}
async function shot(page, name, opts = {}) {
  const path = join(OUT, `${String(report.shots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path, ...opts });
  report.shots.push(path);
}
function probe(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", file]);
  return JSON.parse(out.toString()).streams.map((s) => `${s.codec_type}:${s.codec_name}`).sort();
}
/** Session de test sur la pile dx (l'outil refuse une PUBLIC_URL https : surchargée pour CE processus seulement ;
 *  même base, même secret). Nom de cookie « __Secure- » : celui qu'attend account en https. Jamais affiché. */
function demoSession(email) {
  const inner = `/tmp/${email.replace(/\W/g, "_")}.cookie`;
  execFileSync("docker", ["exec", "-e", "PUBLIC_URL=http://localhost:18190", "ytc2-dx-account", "node", "dist/tools/create-test-session.js", "--email", email, "--out", inner], { stdio: ["ignore", "ignore", "inherit"] });
  const raw = execFileSync("docker", ["exec", "ytc2-dx-account", "cat", inner]).toString().trim();
  execFileSync("docker", ["exec", "ytc2-dx-account", "rm", "-f", inner]);
  const i = raw.indexOf("=");
  const name = raw.slice(0, i);
  return { name: name.startsWith("__Secure-") ? name : `__Secure-${name}`, value: raw.slice(i + 1) };
}
const api = async (cookie, path, { method = "GET", body } = {}) => {
  const headers = { cookie: `${cookie.name}=${cookie.value}` };
  if (method !== "GET") Object.assign(headers, { origin: SITE, "content-type": "application/json" });
  const r = await fetch(`http://127.0.0.1:18190${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ───────────────────────── A. Aperçu de la page /extension, téléchargement réel du ZIP ─────────────────────────
console.log("A. page /extension de l'aperçu (EXTENSION_DOWNLOAD=1) et téléchargement");
const dlSite = mkdtempSync(join(tmpdir(), "dx-site-dl-"));
let zipPath;
{
  const browser = await chromium.launch({ args: RULES });
  for (const v of [{ name: "desktop", viewport: { width: 1440, height: 900 }, dpr: 1 }, { name: "mobile", viewport: { width: 390, height: 844 }, dpr: 2, mobile: true }]) {
    const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.mobile, hasTouch: !!v.mobile, acceptDownloads: true, locale: "fr-FR" });
    await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    // 401 attendu : visiteur anonyme (le site lit /api/me pour savoir s'il est connecté).
    page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    const res = await page.goto(`${SITE}/extension`, { waitUntil: "networkidle" });
    check(`/extension (${v.name}) : HTTP 200`, res.status() === 200, res.status());
    await page.waitForTimeout(800);
    await shot(page, `site-extension-${v.name}-premier-ecran`);
    await shot(page, `site-extension-${v.name}-page-entiere`, { fullPage: true });
    for (const scheme of ["dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await shot(page, `site-extension-${v.name}-sombre`);
      await page.emulateMedia({ colorScheme: "light" });
    }
    const bad = serious(await axe(page));
    check(`/extension (${v.name}) : axe sans violation grave`, bad.length === 0, JSON.stringify(bad));
    check(`/extension (${v.name}) : aucune violation CSP ni erreur`, (await page.evaluate(() => window.__csp)).length === 0 && errors.length === 0, JSON.stringify([...(await page.evaluate(() => window.__csp)), ...errors]));
    const shown = norm(await page.locator("[data-sha256]").first().textContent());
    if (v.name === "desktop") {
      // Guide d'installation : Chrome, Edge, Brave
      for (const [b, id] of [["Chrome", "chrome"], ["Microsoft Edge", "edge"], ["Brave", "brave"]]) {
        await page.getByRole("group", { name: "Navigateur" }).getByRole("button", { name: b, exact: true }).click();
        await page.waitForTimeout(250);
        const guide = page.locator("ol[data-guide]");
        check(`guide d'installation ${b} affiché`, (await guide.getAttribute("data-guide")) === id, await guide.getAttribute("data-guide"));
        await guide.scrollIntoViewIfNeeded();
        await shot(page, `site-guide-${id}`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      // Téléchargement RÉEL par le bouton de la page
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Télécharger l'extension" }).first().click()]);
      zipPath = join(dlSite, download.suggestedFilename());
      await download.saveAs(zipPath);
      const sum = sha(zipPath);
      // Lu PAR LE NAVIGATEUR (relais de démonstration) : jamais par Node, qui résoudrait le vrai nom (production).
      const latest = await page.evaluate(async () => (await fetch("/downloads/extension/latest.json", { cache: "no-store" })).json()).catch(() => null);
      check("ZIP téléchargé par le bouton : nom versionné", download.suggestedFilename() === "aethryon-extension-1.0.0.zip", download.suggestedFilename());
      check("SHA-256 du ZIP téléchargé = empreinte affichée sur la page", sum === shown, `${sum.slice(0, 16)}… / ${shown.slice(0, 16)}…`);
      report.zip = { file: download.suggestedFilename(), sha256: sum, size: statSync(zipPath).size };
      report.latest = latest;
      check("SHA-256 = latest.json servi, taille identique", latest && latest.sha256 === sum && latest.size === statSync(zipPath).size);
      // Archive attendue : la release reproductible construite depuis cette branche (extension/release).
      const expected = JSON.parse(readFileSync(join(INTEG, "release", "latest.json"), "utf8")).sha256;
      check(`SHA-256 = release construite depuis la branche (${expected.slice(0, 8)}…)`, sum === expected);
    }
    await ctx.close();
  }
  // En-têtes de latest.json et SHA256SUMS (l'extension exige une réponse JSON sans redirection), lus PAR LE NAVIGATEUR.
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/robots.txt`);
  const heads = await pg.evaluate(async () => {
    const out = {};
    for (const f of ["latest.json", "SHA256SUMS"]) {
      const r = await fetch(`/downloads/extension/${f}`, { redirect: "manual", cache: "no-store" });
      out[f] = { status: r.status, type: r.headers.get("content-type"), redirected: r.redirected, body: await r.text() };
    }
    return out;
  });
  check("latest.json : 200, application/json, sans redirection", heads["latest.json"].status === 200 && /application\/json/.test(heads["latest.json"].type ?? "") && !heads["latest.json"].redirected, `${heads["latest.json"].status} ${heads["latest.json"].type}`);
  const sums = heads.SHA256SUMS.body;
  check("SHA256SUMS servi et cohérent", heads.SHA256SUMS.status === 200 && sums.includes(report.zip.sha256) && sums.includes("aethryon-extension-1.0.0.zip"), sums.trim());
  await ctx.close();
  await browser.close();
}

// ───────────────────────── B. Contenu de l'archive ─────────────────────────
console.log("B. contenu de l'archive");
const extDir = mkdtempSync(join(tmpdir(), "dx-ext-"));
execFileSync("unzip", ["-q", zipPath, "-d", extDir]);
const files = execFileSync("unzip", ["-Z1", zipPath]).toString().trim().split("\n");
report.zip.files = files;
check(`archive : ${files.length} fichiers, aucun source/carte/test/secret`, !files.some((f) => /\.(map|ts|tsx|pem|key|env)$|(^|\/)(src|tests?|node_modules)\/|manifest-key|\.git/.test(f)), files.filter((f) => /\.(map|ts|pem|key|env)$/.test(f)).join(","));
const blob = files.filter((f) => !f.endsWith("/")).map((f) => readFileSync(join(extDir, f))).map((b) => b.toString("latin1")).join("\n");
// « ytc_ » seul est légitime (préfixe vérifié par le code) ; une VRAIE clé = ytc_ + 64 lettres.
const leaks = ["localhost", "127.0.0.1", "preprod", "sourceMappingURL", ".test/", "BEGIN PRIVATE", "dnllfjakdgmgfiompaheickmbjjlgjdc"].filter((s) => blob.includes(s));
if (/ytc_[A-Za-z]{64}/.test(blob)) leaks.push("clé ytc_ complète");
check("archive : aucune trace de développement (localhost, préproduction, carte source, clé, jeton)", leaks.length === 0, leaks.join(", "));
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
report.manifest = { name: manifest.name, version: manifest.version, version_name: manifest.version_name, permissions: manifest.permissions, optional_permissions: manifest.optional_permissions, host_permissions: manifest.host_permissions, content_scripts: manifest.content_scripts?.map((c) => c.matches), minimum_chrome_version: manifest.minimum_chrome_version, csp: manifest.content_security_policy };
check("manifeste : permissions exactes", JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "downloads", "identity", "alarms"]) && JSON.stringify(manifest.optional_permissions) === JSON.stringify(["notifications"]) && JSON.stringify(manifest.host_permissions) === JSON.stringify(["https://api.malvu.fr/*", "https://raccourci.malvu.fr/*"]), JSON.stringify([manifest.permissions, manifest.optional_permissions, manifest.host_permissions]));

// ───────────────────────── C. Extension chargée depuis le ZIP téléchargé ─────────────────────────
console.log("C. extension chargée depuis le ZIP téléchargé : connexion, conversions, quotas, révocation, erreurs");
setMode({});
const dl = mkdtempSync(join(tmpdir(), "dx-dl-"));
let b = await launchWithExtension({ extDir, downloadDir: dl, extensionId: ID, extraArgs: RULES });
const sw = await b.worker();
check("identifiant de l'extension chargée = necpohicddjeaeaaomaakehcbccapabg", new URL(sw.url()).host === ID, sw.url());
const granted = await sw.evaluate(() => chrome.permissions.getAll());
check("permissions accordées par Chrome = manifeste", JSON.stringify([...granted.permissions].sort()) === JSON.stringify(["alarms", "downloads", "identity", "storage"]), JSON.stringify(granted.permissions));
await b.context.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });

const proxyLog = () => readFileSync(join(DX, "proxy.log"), "utf8");
const logMark = proxyLog().length;
// 1. Accueil, notice, accord
const welcome = await waitFor(() => b.context.pages().find((p) => p.url() === `chrome-extension://${ID}/welcome/welcome.html`), { timeout: 15_000, message: "page d'accueil" });
await welcome.setViewportSize({ width: 1280, height: 860 });
await welcome.locator("[data-action=consent-accept]").waitFor({ timeout: 15_000 });
await welcome.waitForTimeout(600);
await shot(welcome, "extension-accueil-notice", { fullPage: true });
check("avant l'accord : aucune requête de l'extension", proxyLog().slice(logMark).trim() === "", proxyLog().slice(logMark).trim());
await welcome.locator("[data-action=consent-accept]").click();
await welcome.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done", null, { timeout: 10_000 });
await welcome.waitForTimeout(800);
await shot(welcome, "extension-accueil-accord-donne", { fullPage: true });
await waitFor(() => proxyLog().slice(logMark).includes("/downloads/extension/latest.json"), { timeout: 10_000, message: "vérification de version" });
check("après l'accord : une vérification de version (latest.json réel : 1.0.0, rien à signaler)", true, proxyLog().slice(logMark).trim().split("\n").at(-1));

async function popup(name, { scheme = "light" } = {}) {
  const page = await b.context.newPage();
  await page.setViewportSize({ width: 400, height: 640 });
  await page.emulateMedia({ colorScheme: scheme });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|503)|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to fetch/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(`chrome-extension://${ID}/popup/popup.html`);
  await page.waitForSelector("#hero-title, #conn-label", { timeout: 15_000 });
  await page.waitForTimeout(900);
  if (name) await shot(page, name);
  return { page, errors };
}
const txt = async (page, sel) => norm(await page.locator(sel).first().textContent({ timeout: 5000 }).catch(() => ""));

{ const { page } = await popup("popup-non-connecte"); check("popup non connecté : invitation à se connecter", /Connecte-toi|Bienvenue/.test(await txt(page, "#hero-title")), await txt(page, "#hero-title")); await page.close(); }

// 2. Connexion PKCE réelle (vraie fenêtre launchWebAuthFlow, vraie page de consentement)
const email = `demo-${Date.now().toString(36)}@demo.test`;
const cookie = demoSession(email);
await b.context.addCookies([{ name: cookie.name, value: cookie.value, domain: "raccourci.malvu.fr", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
async function login(label) {
  const { page } = await popup(null);
  await page.locator("[data-action=login]").click();
  const consent = await waitFor(() => b.context.pages().find((p) => p.url().startsWith(`${SITE}/extension/autoriser`)), { timeout: 20_000, message: "fenêtre d'autorisation" });
  await consent.getByRole("heading", { level: 1 }).waitFor({ timeout: 15_000 });
  const q = new URL(consent.url()).searchParams;
  if (label) {
    check("autorisation : redirect_uri chromiumapp.org de l'ID distribué, S256, state et challenge de 43 caractères",
      q.get("redirect_uri") === `https://${ID}.chromiumapp.org/aethryon` && q.get("code_challenge_method") === "S256" && /^[A-Za-z0-9_-]{43}$/.test(q.get("state")) && /^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge")), q.get("redirect_uri"));
    await consent.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await consent.waitForTimeout(500);
    await shot(consent, label, { fullPage: true });
    const t = norm(await consent.locator("main").innerText());
    check("consentement : appareil, adresse du compte, droits, révocation", t.includes(email) && t.includes("Elle n'aura aucun accès") && t.includes("Mes jetons"), t.slice(0, 120));
    check("consentement : aucune violation CSP", (await consent.evaluate(() => window.__csp ?? [])).length === 0);
  }
  await consent.getByRole("button", { name: "Autoriser", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#conn-label")?.textContent?.trim() === "Connecté", null, { timeout: 30_000 }).catch(() => {});
  await page.close();
}
await login("site-consentement-extension");
{
  const { page, errors } = await popup("popup-connecte-quota");
  check("popup connecté (compte réel, /api/extension/me)", (await txt(page, "#conn-label")) === "Connecté", await txt(page, "#conn-label"));
  check("quota du jour visible en haut : 10 sur 10", (await txt(page, "#quota-text")) === "10 conversions restantes sur 10", await txt(page, "#quota-text"));
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await shot(page, "popup-connecte-quota-sombre");
  check("popup : aucune erreur ni violation CSP", errors.length === 0 && (await page.evaluate(() => window.__csp ?? [])).length === 0, errors.join(" | "));
  await page.close();
}
const auth1 = await sw.evaluate(async () => (await chrome.storage.local.get("auth")).auth);
check("jeton d'extension ytc_ enregistré (jamais affiché), expiration à 30 jours", /^ytc_[A-Za-z]{64}$/.test(auth1?.token ?? "") && Math.abs((Date.parse(auth1.expiresAt) - Date.now()) / 86_400_000 - 30) < 0.1);

// 3. Conversions réelles par le bouton des pages (pages YouTube / TikTok FABRIQUÉES, faux worker)
await b.context.route(/^https:\/\/www\.youtube\.com\//, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(join(FIXTURES, "youtube-watch.html"), "utf8") }));
await b.context.route(/^https:\/\/www\.tiktok\.com\//, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(join(FIXTURES, "tiktok-video.html"), "utf8") }));
async function convertInPage(url, fmt, label) {
  const page = await b.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  const s = await cdpFor(page);
  let [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l.length ? l : null; }, { timeout: 15_000, message: "bouton AETHRYON" });
  await s.click(c.handle, ".trigger");
  [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l[0]?.ui.open ? l : null; }, { timeout: 10_000, message: "popover" });
  if (fmt === "mp3") await s.click(c.handle, "label.opt", "MP3");
  await page.waitForTimeout(300);
  await shot(page, `${label}-popover`);
  await s.click(c.handle, ".go");
  let mid = false;
  [c] = await waitFor(async () => {
    const l = await s.controls("aethryon-control");
    if (!mid && l[0]?.ui.phase && !["idle", "done", "error"].includes(l[0].ui.phase)) { mid = true; await shot(page, `${label}-en-cours`); }
    return ["done", "error"].includes(l[0]?.ui.phase) ? l : null;
  }, { timeout: 90_000, message: "conversion terminée", interval: 150 });
  await page.waitForTimeout(400);
  await shot(page, `${label}-termine`);
  await s.detach();
  await page.close();
  return c.ui;
}
const ui1 = await convertInPage("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "mp4", "page-youtube-mp4");
check("YouTube (page fabriquée) → MP4 : « Enregistré »", ui1.phase === "done" && ui1.status?.state === "Enregistré", JSON.stringify(ui1.status));
const ui2 = await convertInPage("https://www.tiktok.com/@demo/video/7400000000000000001", "mp3", "page-tiktok-mp3");
check("TikTok (page fabriquée) → MP3 : « Enregistré »", ui2.phase === "done" && ui2.status?.state === "Enregistré", JSON.stringify(ui2.status));
await sleep(1500);
const files2 = readdirSync(dl).filter((f) => !f.endsWith(".crdownload"));
const mp4 = files2.find((f) => f.endsWith(".mp4")), mp3 = files2.find((f) => f.endsWith(".mp3"));
check("fichiers réels écrits par Chrome : un MP4 (vidéo) et un MP3 (audio)", mp4 && mp3 && probe(join(dl, mp4)).some((x) => x.startsWith("video:")) && probe(join(dl, mp3)).includes("audio:mp3"), files2.join(", "));
report.files = files2.map((f) => ({ name: f, bytes: statSync(join(dl, f)).size, streams: probe(join(dl, f)) }));
{
  const { page } = await popup("popup-quota-apres-2-conversions");
  check("quota partagé décompté : 8 sur 10", (await txt(page, "#quota-text")) === "8 conversions restantes sur 10", await txt(page, "#quota-text"));
  await page.close();
}

// 4. « Mes jetons » sur le site : l'appareil, puis révocation (vrai clic) → l'extension l'apprend avec le motif
{
  const page = await b.context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/dashboard/cles`, { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Extensions connectées" });
  await section.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await shot(page, "site-mes-jetons-extension-connectee", { fullPage: true });
  check("Mes jetons : l'appareil est listé dans « Extensions connectées », 1 sur 3", norm(await section.innerText()).includes("1 sur 3 appareils"), norm(await section.innerText()).slice(0, 160));
  await section.getByRole("button", { name: /^Révoquer/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await shot(page, "site-mes-jetons-confirmation-revocation");
  await dialog.getByRole("button", { name: "Révoquer", exact: true }).click();
  await section.getByText("Révoquée").first().waitFor({ timeout: 10_000 });
  await shot(page, "site-mes-jetons-revoquee", { fullPage: true });
  await page.close();
}
{
  const { page } = await popup("popup-revoquee-motif");
  check("popup après révocation depuis Mes jetons : « Reconnecte-toi » avec le motif", (await txt(page, "#hero-title")) === "Reconnecte-toi" && /Mes jetons|révoqu/i.test(await txt(page, "#auth-notice")), `${await txt(page, "#hero-title")} / ${await txt(page, "#auth-notice")}`);
  await page.close();
}
const y1 = await fetch("http://127.0.0.1:18191/jobs/verif", { headers: { authorization: `Bearer ${auth1.token}` } });
check("ytapi refuse la clé révoquée (401)", y1.status === 401, y1.status);

// 5. Reconnexion, puis pannes : service indisponible (503), réseau coupé
await login(null);
setMode({ siteApiDown: 503 });
{
  const { page } = await popup("popup-service-indisponible");
  check("compte injoignable (503) : état dégradé, jamais « Connecté »", (await txt(page, "#conn-label")) !== "Connecté" && (await page.locator("#degraded-title").count()) === 1, `${await txt(page, "#conn-label")} / ${await txt(page, "#degraded-title")}`);
  setMode({});
  await page.locator("[data-action=reload]").first().click().catch(() => {});
  await page.waitForFunction(() => document.querySelector("#conn-label")?.textContent?.trim() === "Connecté", null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "popup-reessayer-retabli");
  check("« Réessayer » après rétablissement : connecté", (await txt(page, "#conn-label")) === "Connecté", await txt(page, "#conn-label"));
  await page.close();
}
await b.context.setOffline(true);
{
  const { page } = await popup("popup-hors-ligne");
  check("réseau coupé : « Hors ligne », dernier quota connu", (await txt(page, "#conn-label")) === "Hors ligne", `${await txt(page, "#conn-label")} / ${await txt(page, "#degraded-title")}`);
  await page.close();
}
await b.context.setOffline(false);
setMode({ apiDown: "close" });
const uiErr = await convertInPage("https://www.youtube.com/watch?v=aethryonDm2", "mp4", "page-youtube-api-injoignable");
check("serveur de conversion injoignable : erreur claire, pas « Échec » muet", uiErr.phase === "error", JSON.stringify(uiErr.status));
setMode({});

// 6. Déconnexion depuis le popup (vrai clic, confirmation) → clé révoquée côté serveur
const auth2 = await sw.evaluate(async () => (await chrome.storage.local.get("auth")).auth);
{
  const { page } = await popup(null);
  await page.locator("[data-action=logout]").click();
  await page.waitForTimeout(300);
  await shot(page, "popup-deconnexion-confirmation");
  await page.locator("[data-action=logout-confirm]").click();
  await page.waitForFunction(() => document.querySelector("#hero-title")?.textContent === "Connecte-toi", null, { timeout: 15_000 }).catch(() => {});
  await shot(page, "popup-deconnecte");
  check("déconnexion : popup « Connecte-toi », aucun motif affiché", (await txt(page, "#hero-title")) === "Connecte-toi" && (await page.locator("#auth-notice").count()) === 0);
  await page.close();
}
const keys = (await api(cookie, "/api/keys")).body?.keys?.filter((k) => k.kind === "extension") ?? [];
check("côté compte : toutes les clés d'extension révoquées", keys.length === 2 && keys.every((k) => k.status === "revoked"), keys.map((k) => k.status).join(","));
const y2 = await fetch("http://127.0.0.1:18191/jobs/verif", { headers: { authorization: `Bearer ${auth2.token}` } });
check("ytapi refuse la clé après déconnexion (401)", y2.status === 401, y2.status);
check("liste des téléchargements effacée", JSON.stringify((await b.send({ type: "jobs.list" })).data) === "[]");
await b.close();

// ───────────────────────── D. Avis de nouvelle version (profil neuf, latest.json de TEST 1.1.0) ─────────────────────────
console.log("D. avis de nouvelle version");
setMode({ latest: { version: "1.1.0", file: "aethryon-extension-1.1.0.zip", sha256: "b".repeat(64), size: 300000, released: "2026-11-02", minChrome: 140, notes: ["Version de TEST annoncée par un latest.json local (démonstration).", "Rien n'est téléchargé ni installé par l'extension."] } });
const dl2 = mkdtempSync(join(tmpdir(), "dx-dl2-"));
b = await launchWithExtension({ extDir, downloadDir: dl2, extensionId: ID, extraArgs: RULES });
{
  const w = await waitFor(() => b.context.pages().find((p) => p.url() === `chrome-extension://${ID}/welcome/welcome.html`), { timeout: 15_000, message: "accueil" });
  await w.locator("[data-action=consent-accept]").click();
  await w.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done", null, { timeout: 10_000 });
  await sleep(1500);
  const { page } = await popup("popup-nouvelle-version");
  check("avis « Nouvelle version 1.1.0 disponible » dans le popup", (await txt(page, "#update-title")) === "Nouvelle version 1.1.0 disponible", await txt(page, "#update-title"));
  await page.close();
  const o = await b.context.newPage();
  await o.setViewportSize({ width: 1280, height: 900 });
  await o.goto(`chrome-extension://${ID}/options/options.html`);
  await o.waitForSelector("#update-title", { timeout: 10_000 }).catch(() => {});
  await o.waitForTimeout(600);
  await shot(o, "reglages-nouvelle-version", { fullPage: true });
  check("avis aussi dans les réglages", norm(await o.locator("#update-title").textContent().catch(() => "")) === "Nouvelle version 1.1.0 disponible");
  check("rien n'a été téléchargé ni installé", JSON.stringify(await (await b.worker()).evaluate(() => chrome.downloads.search({}))) === "[]");
  await o.close();
}
await b.close();
setMode({});

// ───────────────────────── E. Cohérence du site publié (EXTENSION_DOWNLOAD=1) ─────────────────────────
// Le site entier dit la même chose que la page /extension : statuts de l'accueil, onglet « Extension », feuille de
// route, FAQ, confidentialité, guide « Bien démarrer » et « Mes jetons » (session de la partie C). Navigateur sans
// extension, mêmes règles de résolution (relais local).
console.log("E. cohérence du site publié : accueil, solutions, feuille de route, FAQ, confidentialité, espace personnel");
{
  const browser = await chromium.launch({ args: RULES });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: "raccourci.malvu.fr", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${SITE}/#solutions`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const access = (await page.locator("[data-access] li").allInnerTexts()).map(norm);
  check("accueil : statut « Extension disponible » dans le héros", access.includes("Extension disponible") && !access.some((a) => /Extension en développement/.test(a)), access.join(" | "));
  await page.locator('[role="tab"][data-solution="extension"]').click();
  await page.waitForTimeout(500);
  const panel = page.locator('[role="tabpanel"]:not([hidden])');
  const panelText = norm(await panel.innerText());
  const cta = panel.getByRole("link").first();
  check("accueil, onglet Extension : « Disponible », bouton « Télécharger l'extension » vers /extension, aucune mention « en développement »",
    /Disponible/.test(panelText) && !/en développement/i.test(panelText) && norm(await cta.innerText()) === "Télécharger l'extension" && (await cta.getAttribute("href")) === "/extension", panelText.slice(0, 160));
  const planned = norm(await page.locator("#feuille-de-route").innerText().catch(() => ""));
  check("feuille de route : l'extension n'est plus « en développement »", !/Extension navigateur/.test(planned) || !/En développement/.test(planned), planned.slice(0, 160));
  // FAQ : une réponse repliée n'est dans le document qu'une fois ouverte (après l'affichage de l'application).
  await page.locator("#faq").getByRole("button", { name: /^Sur quels appareils/ }).click();
  await page.waitForTimeout(500);
  const faq = norm(await page.locator("#faq").innerText());
  check("FAQ : l'extension s'installe depuis la page Extension (Chrome, Edge ou Brave), plus « en développement »",
    /l'extension AETHRYON s'installe depuis la page Extension \(Chrome, Edge ou Brave/.test(faq) && !/L'extension pour ordinateur est en développement/.test(faq), "");
  await page.goto(`${SITE}/confidentialite`, { waitUntil: "networkidle" });
  const privacy = norm(await page.locator("#extension").innerText().catch(() => ""));
  check("confidentialité : bloc « Extension navigateur » sans « (en développement) », avis de version décrit", /^Extension navigateur/.test(privacy) && !/en développement/i.test(privacy) && /dernière version/.test(privacy), privacy.slice(0, 160));
  await page.goto(`${SITE}/dashboard`, { waitUntil: "networkidle" });
  await page.locator('[data-guide="en-cours"], [data-guide="pret"]').first().waitFor({ timeout: 15_000 });
  // Guide replié (« Tout est prêt ») : on rouvre les étapes pour lire les façons d'utiliser AETHRYON.
  const reopen = page.locator('[data-guide="pret"] button[aria-controls="guide-etapes"]');
  if (await reopen.count()) await reopen.click();
  const step = page.locator('[data-step="acces"]');
  if ((await page.locator('[data-access="extension"]').count()) === 0 && (await step.count())) await step.getByRole("button").first().click().catch(() => {});
  await page.waitForTimeout(600);
  const row = page.locator('[data-access="extension"]').first();
  const rowText = norm(await row.innerText().catch(() => ""));
  const install = row.getByRole("link", { name: "Installer" });
  const dash = norm(await page.locator("main").innerText());
  check("espace personnel, « Bien démarrer » : extension « Disponible » avec « Installer » vers /extension, jamais « en préparation »",
    /Disponible/.test(rowText) && (await install.count()) === 1 && (await install.getAttribute("href")) === "/extension" && !/l'extension et le bot Discord sont en préparation/.test(dash), rowText.slice(0, 160) || "ligne absente");
  await page.goto(`${SITE}/dashboard/cles`, { waitUntil: "networkidle" });
  const keysText = norm(await page.getByRole("region", { name: "Extensions connectées" }).innerText().catch(() => ""));
  check("Mes jetons : « pour ordinateur (Chrome, Edge, Brave) », 30 jours annoncés (= durée réelle des clés)", /pour ordinateur \(Chrome, Edge, Brave\)/.test(keysText) && /30.jours/.test(keysText), keysText.slice(0, 160));
  await shot(page, "site-mes-jetons-apres-demo", { fullPage: true });
  await browser.close();
}

report.proxy = proxyLog().split("\n").filter(Boolean).slice(-400).map((l) => l.replace(/^\S+ /, ""));
report.ended = new Date().toISOString();
writeFileSync(join(OUT, "rapport-demo.json"), JSON.stringify(report, null, 2));
const ko = report.checks.filter((c) => !c.ok);
console.log(`\n${report.checks.length - ko.length}/${report.checks.length} contrôles réussis ; ${report.shots.length} captures dans ${OUT}`);
for (const d of [dlSite, extDir, dl, dl2]) rmSync(d, { recursive: true, force: true });
process.exit(ko.length ? 1 : 0);
