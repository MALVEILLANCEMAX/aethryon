// Connexion RÉELLE de l'extension au compte AETHRYON, de bout en bout, contre la PRÉPRODUCTION (account et
// site construits depuis cette branche, ytapi à faux worker) dans un vrai Chromium (Chrome for Testing,
// « new headless ») avec l'extension construite (build de développement, identifiant figé) :
//   popup → auth.login → chrome.identity.launchWebAuthFlow → VRAIE page /extension/autoriser du site,
//   dans la fenêtre ouverte par Chrome → contenu du consentement vérifié → clic « Autoriser » → retour
//   https://<id>.chromiumapp.org/aethryon intercepté par Chrome → échange PKCE réel (/api/extension/token)
//   → jeton d'extension dans storage.local → popup.init (/api/extension/me réel) → conversion réelle
//   (job.start → ytapi → fichier écrit par chrome.downloads) → clé listée dans « Mes jetons » comme
//   extension → auth.logout (révocation réelle) → ytapi refuse ensuite ce jeton (401).
// Puis : « Refuser » (refus signalé par l'extension, rien d'enregistré), retour après connexion
// (/connexion?suite=…), paramètres invalides (aucune redirection).
// Seule étape NON réelle : la connexion Google elle-même (non configurée en préproduction). La session de
// l'utilisateur de test vient de l'outil de session de préproduction et est posée dans le profil du
// navigateur (cookie HttpOnly de localhost), comme après une connexion Google.
// Aucun secret affiché : cookie et jeton restent en mémoire ; l'utilisateur de test est supprimé.
//   node --test tests/browser/login.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VERSION, EXTENSION_ID, launchWithExtension, VERSION } from "../support/browser.mjs";
import { cdpFor, FIXTURES, waitFor } from "./helpers.mjs";
import { readFileSync } from "node:fs";
import { ORIGIN, preprodAvailable, testSession, web, WEB, YTAPI } from "../support/preprod.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "tests", "out", "login");
const NB = " ";
const SEED = String(Date.now() % 100000).padStart(5, "0");
const TT = (n) => `https://www.tiktok.com/@e2e/video/7${SEED}${String(n).padStart(13, "0")}`;
const REDIRECT = `https://${EXTENSION_ID}.chromiumapp.org/aethryon`;
const PP = preprodAvailable();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Texte comparé espaces normalisées (\s couvre aussi l'espace insécable). */
const norm = (s) => s.replace(/\s+/g, " ").trim();

function build(out) {
  execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", `--out=${out}`], { cwd: ROOT, stdio: "ignore" });
  return join(ROOT, out);
}

/** Flux du fichier (ffprobe de l'hôte, sinon celui de l'image ytapi, sans réseau). */
function probe(file) {
  let out;
  try {
    out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", file], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    out = execFileSync("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", `${dirname(file)}:/d:ro`, "--entrypoint", "ffprobe", "ytc2-ytapi:reel",
      "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", `/d/${file.split("/").pop()}`]);
  }
  return JSON.parse(out.toString()).streams.map((s) => `${s.codec_type}:${s.codec_name}`).sort();
}

/** Promesse avec délai : un auth.login qui ne revient jamais doit faire échouer le test, pas le bloquer. */
function within(p, ms, what) {
  return Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} : pas de réponse en ${ms / 1000} s`); })]);
}

describe("préproduction : connexion réelle de l'extension (launchWebAuthFlow → consentement → PKCE)", { skip: PP ? false : "préproduction arrêtée" }, () => {
  let b;
  let dl;
  let cookie;      // en-tête Cookie de la session de test (jamais affiché)
  let cookieObj;   // même cookie, pour le profil du navigateur
  let token;       // jeton d'extension obtenu par la vraie connexion (jamais affiché)
  const email = `ext-login-${Date.now().toString(36)}@preprod.test`;

  /** Fenêtre ouverte par launchWebAuthFlow (page ordinaire du profil, visible par CDP). */
  async function authWindow(path, { timeoutMs = 20_000 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const p = b.context.pages().find((x) => x.url().startsWith(`${ORIGIN}${path}`));
      if (p) return p;
      if (Date.now() > end) throw new Error(`fenêtre ${path} introuvable (pages : ${b.context.pages().map((x) => x.url().split("?")[0]).join(", ")})`);
      await sleep(100);
    }
  }

  /** Erreurs de page et de console (les violations CSP sont relevées par le script d'initialisation). */
  function watch(page) {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    return errors;
  }

  const extensionKeys = async () => (await web(cookie, "/api/keys")).body.keys.filter((k) => k.kind === "extension");

  before(async () => {
    mkdirSync(OUT, { recursive: true });
    const ext = build("tests/out/dist-login"); // site http://localhost:18110, API http://127.0.0.1:18111
    dl = mkdtempSync(join(tmpdir(), "aethryon-dl-login-"));
    cookie = testSession(email);
    const i = cookie.indexOf("=");
    cookieObj = { name: cookie.slice(0, i), value: cookie.slice(i + 1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" };
    b = await launchWithExtension({ extDir: ext, downloadDir: dl });
    await b.worker();
    // Violations CSP relevées dès le chargement de chaque page (y compris la fenêtre de connexion).
    await b.context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    // Session du compte dans le profil du navigateur (comme après la connexion Google).
    await b.context.addCookies([cookieObj]);
  });

  after(async () => {
    await b?.close();
    if (cookie) await web(cookie, "/api/auth/delete-user", { method: "POST", body: {} });
    if (dl) rmSync(dl, { recursive: true, force: true });
  });

  test("premier lancement : page d'accueil ouverte ; avant l'accord, connexion refusée sans fenêtre ; « Accepter » (vrai clic) enregistre l'accord", { timeout: 60_000 }, async () => {
    const welcome = await waitFor(() => b.context.pages().find((p) => p.url() === `chrome-extension://${EXTENSION_ID}/welcome/welcome.html`), { timeout: 15_000, message: "page d'accueil ouverte par onInstalled" });
    const errors = watch(welcome);
    await welcome.locator("[data-action=consent-accept]").waitFor({ timeout: 15_000 });
    assert.ok(norm(await welcome.locator("#w-lead").innerText()).startsWith(`Version ${VERSION}, chargée par ton navigateur.`));
    // Avant l'accord : aucune fenêtre, aucune requête de connexion.
    const refused = await b.send({ type: "auth.login" });
    assert.deepEqual(refused?.error?.code, "consent_required");
    await sleep(500);
    assert.equal(b.context.pages().some((p) => p.url().startsWith(`${ORIGIN}/extension/autoriser`)), false, "aucune fenêtre de connexion");
    assert.ok(await welcome.locator("#login-area [data-action=login]").isDisabled(), "connexion verrouillée sur la page d'accueil");
    await welcome.screenshot({ path: join(OUT, "accueil-avant-accord.png"), fullPage: true });
    await welcome.locator("[data-action=consent-accept]").click();
    await welcome.waitForFunction(() => document.querySelector("#donnees")?.dataset.state === "done", null, { timeout: 10_000 });
    const consent = await b.page.evaluate(async () => (await chrome.storage.local.get("consent")).consent);
    assert.equal(consent.version, CONSENT_VERSION);
    assert.ok(Math.abs(Date.parse(consent.at) - Date.now()) < 60_000);
    assert.ok(await welcome.locator("#login-area [data-action=login]").isEnabled(), "connexion possible après l'accord");
    assert.deepEqual(errors, []);
    await welcome.close();
  });

  test("« Autoriser » dans la vraie fenêtre launchWebAuthFlow → jeton d'extension, compte connecté", { timeout: 90_000 }, async (t) => {
    t.diagnostic(`navigateur : ${b.version}, extension ${EXTENSION_ID}`);
    const login = b.send({ type: "auth.login" });
    const page = await authWindow("/extension/autoriser");
    const errors = watch(page);
    const q = new URL(page.url()).searchParams;
    assert.equal(q.get("redirect_uri"), REDIRECT);
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.match(q.get("state"), /^[A-Za-z0-9_-]{43}$/);
    assert.match(q.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
    const device = q.get("appareil");
    assert.match(device, /^(Chrome|Chromium) · Linux$/);

    // Contenu du consentement (texte réel de la page)
    const h1 = page.getByRole("heading", { level: 1 });
    await h1.waitFor({ timeout: 15_000 });
    assert.equal(await h1.textContent(), `Autoriser l'extension AETHRYON sur cet appareil${NB}?`);
    const limit = (await web(cookie, "/api/me")).body.today.limit;
    const text = norm(await page.locator("main").innerText());
    for (const part of [device, email, "Elle pourra", "Convertir des vidéos avec ton compte", `Utiliser le même quota que le raccourci (${limit} conversions par jour)`,
      "Voir ton quota et ton historique récent de conversions", "Elle n'aura aucun accès", "À tes cookies", "À ton historique de navigation", "À ton compte Google",
      `Tu peux révoquer cet accès à tout moment dans «${NB}Mes jetons${NB}»`]) {
      assert.ok(text.includes(norm(part)), `texte attendu : ${part}`);
    }
    await page.screenshot({ path: join(OUT, "consentement.png"), fullPage: true });
    assert.deepEqual(await page.evaluate(() => window.__csp ?? []), [], "aucune violation CSP");

    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    const r = await within(login, 30_000, "auth.login");
    assert.equal(r?.ok, true, `auth.login : ${r?.error?.code ?? "sans réponse"} ${r?.error?.message ?? ""}`);
    assert.equal(r.data.connected, true);
    assert.equal(r.data.email, email);
    assert.equal(r.data.today.limit, limit);
    assert.equal(r.data.today.used, 0);
    assert.deepEqual(errors, [], "aucune erreur dans la page de consentement");
    for (let i = 0; i < 50 && !page.isClosed(); i++) await sleep(100);
    t.diagnostic(`fenêtre d'autorisation fermée par Chrome après le retour : ${page.isClosed()}`);

    // storage.local : liaison présente (jeton ytc_ jamais affiché)
    assert.equal(await b.hasAuth(), true);
    const auth = await (await b.worker()).evaluate(async () => (await chrome.storage.local.get("auth")).auth);
    token = auth.token;
    assert.match(token, /^ytc_[A-Za-z]{64}$/);
    assert.equal(auth.email, email);
    const days = (Date.parse(auth.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `expiration à 30 jours (${days.toFixed(2)})`); // S1 : EXTENSION_KEY_DAYS

    // Côté compte : une clé de type « extension », appareil et nom attendus
    const keys = await extensionKeys();
    assert.equal(keys.length, 1);
    assert.deepEqual([keys[0].status, keys[0].deviceLabel, keys[0].name], ["active", device, `Extension Chrome · ${device}`]);
    assert.ok(!JSON.stringify(keys).includes(token));
  });

  test("popup.init : compte connecté avec le bon e-mail (/api/extension/me réel)", { timeout: 30_000 }, async () => {
    const r = await b.send({ type: "popup.init" });
    assert.equal(r.ok, true);
    assert.equal(r.data.account.connected, true);
    assert.equal(r.data.account.email, email);
    assert.equal(r.data.account.stale, undefined);
    assert.equal(r.data.account.today.limit, (await web(cookie, "/api/me")).body.today.limit);
    assert.equal(r.data.account.activeJobs, 0);
    assert.deepEqual(r.data.account.recent, []);
  });

  test("conversion par l'extension avec ce jeton → ytapi de préproduction → fichier réel écrit par le navigateur", { timeout: 120_000 }, async () => {
    const start = await b.send({ type: "job.start", url: TT(1), fmt: "mp4" });
    assert.equal(start?.ok, true, `job.start : ${start?.error?.code ?? "sans réponse"}`);
    const j = await b.waitJob(start.data.key, (x) => ["done", "error", "cancelled"].includes(x.state), { timeoutMs: 90_000 });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""} ${j.error?.message ?? ""}`);
    const file = join(dl, j.fileName);
    assert.ok(existsSync(file), "fichier présent dans le dossier de téléchargement du navigateur");
    assert.ok(statSync(file).size > 1000);
    assert.equal(statSync(file).size, j.bytes);
    const streams = probe(file);
    assert.ok(streams.includes("video:h264") || streams.includes("video:hevc"), streams.join(","));
    // Même compte, même quota : la conversion est dans l'historique du compte et dans /me
    await sleep(1500); // événements d'usage envoyés par ytapi de façon asynchrone
    const acc = await b.send({ type: "account.refresh" });
    assert.equal(acc.ok, true);
    assert.equal(acc.data.today.used, 1);
    assert.deepEqual(acc.data.recent.map((x) => `${x.platform}:${x.fmt}:${x.state}`), ["tiktok:mp4:done"]);
    const act = await web(cookie, "/api/activity?limit=5");
    assert.deepEqual(act.body.items.map((x) => `${x.fmt}:${x.state}`), ["mp4:done"]);
  });

  test("« Mes jetons » : l'appareil apparaît dans « Extensions connectées », pas parmi les jetons du raccourci", { timeout: 60_000 }, async () => {
    const page = await b.context.newPage();
    const errors = watch(page);
    await page.goto(`${ORIGIN}/dashboard/cles`, { waitUntil: "networkidle" });
    const section = page.getByRole("region", { name: "Extensions connectées" });
    await section.waitFor({ timeout: 15_000 });
    const keys = await extensionKeys();
    assert.ok((await section.innerText()).includes(keys[0].deviceLabel));
    assert.ok((await section.innerText()).includes("Connectée"));
    assert.ok((await section.innerText()).includes("1 sur 3 appareils"));
    assert.equal(await section.getByRole("button", { name: /^Révoquer/ }).count(), 1);
    const shortcuts = page.getByRole("region", { name: "Jetons du compte" });
    assert.ok((await shortcuts.innerText()).includes("Aucun jeton pour l'instant"));
    await page.screenshot({ path: join(OUT, "mes-jetons.png"), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.__csp ?? []), [], "aucune violation CSP");
    await page.close();
  });

  test("déconnexion : révocation réelle, puis ytapi refuse ce jeton (401)", { timeout: 60_000 }, async () => {
    const out = await b.send({ type: "auth.logout" });
    assert.deepEqual(out, { ok: true, data: { connected: false } });
    assert.equal(await b.hasAuth(), false);
    const keys = await extensionKeys();
    assert.equal(keys[0].status, "revoked");
    const res = await fetch(`${YTAPI}/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: TT(2), fmt: "mp4" }),
    });
    assert.equal(res.status, 401, "ytapi refuse le jeton révoqué");
    await res.body?.cancel();
    const me = await fetch(`${WEB}/api/extension/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.status, 401);
    await me.body?.cancel();
  });

  test("bouton de la page (TikTok fabriquée) : « Se connecter à AETHRYON » → vraie fenêtre → « Autoriser » → « Connecté » → Télécharger → fichier réel", { timeout: 150_000 }, async () => {
    assert.equal(await b.hasAuth(), false, "déconnecté (test précédent)");
    const fixture = readFileSync(join(FIXTURES, "tiktok-video.html"), "utf8");
    // Seule la page TikTok est fabriquée (aucune requête vers TikTok) ; le site et l'API sont ceux de la pile de test.
    await b.context.route(/^https:\/\/www\.tiktok\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture }));
    const page = await b.context.newPage();
    const pageErrors = watch(page);
    await page.goto(TT(3));
    const s = await cdpFor(page);
    let [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l.length === 1 ? l : null; }, { timeout: 15_000, message: "bouton AETHRYON" });
    await s.click(c.handle, ".trigger");
    [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l[0]?.ui.open ? l : null; }, { timeout: 10_000, message: "popover ouvert" });
    await s.click(c.handle, ".r-video");
    [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l[0]?.ui.status && l[0].ui.status.phase !== "sending" ? l : null; }, { timeout: 15_000, message: "réponse du service worker" });
    assert.equal(c.ui.status.state, "Connexion requise", JSON.stringify(c.ui.status));
    assert.equal(c.ui.status.action, "Se connecter à AETHRYON");
    assert.equal(c.ui.label, "Télécharger", "jamais « Échec »");
    await page.screenshot({ path: join(OUT, "page-connexion-requise.png") });
    await s.click(c.handle, ".act");
    const consent = await authWindow("/extension/autoriser");
    assert.equal(new URL(consent.url()).searchParams.get("redirect_uri"), REDIRECT);
    await consent.getByRole("button", { name: "Autoriser", exact: true }).click();
    [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l[0]?.ui.status?.phase === "linked" ? l : null; }, { timeout: 30_000, message: "connecté depuis la page" });
    assert.equal(c.ui.status.state, "Connecté");
    assert.equal(c.ui.status.message, "Tu peux maintenant télécharger cette vidéo.");
    assert.equal(await b.hasAuth(), true);
    await s.click(c.handle, ".r-video");
    [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return ["done", "error"].includes(l[0]?.ui.phase) ? l : null; }, { timeout: 90_000, message: "téléchargement terminé" });
    assert.equal(c.ui.phase, "done", JSON.stringify(c.ui.status));
    assert.equal(c.ui.status.state, "Enregistré");
    const jobs = (await b.send({ type: "jobs.list" })).data;
    const file = join(dl, jobs[0].fileName);
    assert.ok(existsSync(file) && statSync(file).size > 1000, "fichier réel écrit par le navigateur");
    assert.deepEqual(pageErrors, []);
    await s.detach();
    await page.close();
    await b.context.unroute(/^https:\/\/www\.tiktok\.com\//);
    assert.deepEqual(await b.send({ type: "auth.logout" }), { ok: true, data: { connected: false } });
    assert.deepEqual((await b.send({ type: "jobs.list" })).data, [], "liste effacée à la déconnexion");
  });

  test("« Refuser » → l'extension signale le refus, rien n'est enregistré", { timeout: 60_000 }, async () => {
    const before = (await web(cookie, "/api/keys")).body.keys.length;
    const login = b.send({ type: "auth.login" });
    const page = await authWindow("/extension/autoriser");
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    const r = await within(login, 30_000, "auth.login");
    assert.equal(r?.ok, false);
    assert.deepEqual(r.error, { code: "auth_denied", message: `Autorisation refusée${NB}: l'extension n'est pas connectée à ton compte.`, retryable: true });
    assert.equal(await b.hasAuth(), false, "aucune liaison enregistrée");
    assert.equal((await web(cookie, "/api/keys")).body.keys.length, before, "aucune clé créée");
  });

  test("sans session : /connexion?suite=<page d'autorisation>, puis retour au consentement après la connexion", { timeout: 90_000 }, async () => {
    await b.context.clearCookies();
    const login = b.send({ type: "auth.login" });
    const page = await authWindow("/connexion");
    const suite = new URL(page.url()).searchParams.get("suite");
    assert.ok(suite.startsWith("/extension/autoriser?redirect_uri="), suite.split("?")[0]);
    const back = new URLSearchParams(suite.split("?")[1]);
    assert.equal(back.get("redirect_uri"), REDIRECT);
    assert.equal(back.get("code_challenge_method"), "S256");
    // Google n'est pas configuré en préproduction : la session est posée comme après la connexion,
    // puis la page /connexion (rechargée) renvoie vers la page d'autorisation, sans autre intervention.
    await b.context.addCookies([cookieObj]);
    await page.reload();
    await page.waitForURL((u) => u.pathname === "/extension/autoriser", { timeout: 15_000 });
    assert.equal(new URL(page.url()).searchParams.get("state"), back.get("state"));
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    const r = await within(login, 30_000, "auth.login");
    assert.equal(r?.ok, true, `auth.login : ${r?.error?.code ?? "sans réponse"}`);
    assert.equal(r.data.email, email);
    assert.equal(await b.hasAuth(), true);
    // nettoyage : déconnexion (révocation) de cette seconde liaison
    assert.deepEqual(await b.send({ type: "auth.logout" }), { ok: true, data: { connected: false } });
    assert.ok((await extensionKeys()).every((k) => k.status === "revoked"));
  });

  test("paramètres invalides ou extension inconnue : message clair, AUCUNE redirection", { timeout: 60_000 }, async () => {
    const page = await b.context.newPage();
    const s = "s".repeat(43), c = "c".repeat(43);
    // 1. demande mal formée (URI de retour étrangère) : refusée par la page avant tout appel
    await page.goto(`${ORIGIN}/extension/autoriser?redirect_uri=${encodeURIComponent("https://evil.test/aethryon")}&state=${s}&code_challenge=${c}&code_challenge_method=S256`, { waitUntil: "networkidle" });
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Demande d'autorisation invalide");
    assert.equal(await page.getByRole("button", { name: "Autoriser" }).count(), 0);
    // 2. identifiant d'extension bien formé mais non autorisé : le serveur refuse, la page reste en place
    const unknown = `https://${"abcdefghijklmnop".repeat(2)}.chromiumapp.org/aethryon`;
    const url = `${ORIGIN}/extension/autoriser?redirect_uri=${encodeURIComponent(unknown)}&state=${s}&code_challenge=${c}&code_challenge_method=S256&appareil=Test`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    const alert = page.getByRole("alert");
    await alert.waitFor({ timeout: 10_000 });
    assert.equal((await alert.innerText()).trim(), `Adresse de retour non autorisée${NB}: cette extension n'est pas reconnue par AETHRYON.`);
    assert.equal(page.url(), url, "aucune redirection");
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    await sleep(800);
    assert.equal(page.url(), url, "refus impossible vers une URI non autorisée : aucune redirection");
    await page.close();
  });
});
