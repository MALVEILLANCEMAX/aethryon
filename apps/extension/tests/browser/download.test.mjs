// Tests navigateur RÉELS du service worker : Chromium (Chrome for Testing 1.63/1243) en « new headless »,
// extension construite chargée, vrais chrome.downloads / launchWebAuthFlow / alarms / storage.
//   node --test tests/browser/download.test.mjs
// Partie 1 — PRÉPRODUCTION réelle (ytapi à faux worker qui produit de vrais petits MP4/MP3, compte réel) :
//   vrais fichiers écrits par le navigateur, vérifiés par ffprobe ; quota et activité du compte ;
//   /api/extension/me réel ; annulation réelle ; révocation réelle. La LIAISON est écrite dans
//   storage.local (même forme qu'AuthState) avec un VRAI jeton d'extension obtenu par le contrat serveur
//   (consentement HTTP + échange PKCE) ; la fenêtre de connexion elle-même est couverte par
//   login.test.mjs.
// Partie 2 — serveur LOCAL de test (tests/support/fake-api.mjs) et un second build pointé dessus :
//   connexion PKCE de bout en bout dans le vrai navigateur, coupure en plein transfert, 410, 429, 401,
//   arrêt du service worker puis reprise par l'alarme, déconnexion.
// Aucun secret affiché : clé et cookie restent en mémoire ; l'utilisateur de test est supprimé.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, launchWithExtension, stopExtensionWorker } from "../support/browser.mjs";
import { startFakeServer } from "../support/fake-api.mjs";
import { extensionToken, preprodAvailable, testSession, web } from "../support/preprod.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NB = " ";
// Identifiants TikTok propres à ce lancement (le cache de résultats de ytapi servirait sinon les fichiers
// d'un lancement précédent).
const SEED = String(Date.now() % 100000).padStart(5, "0");
const TT = (n, user = "e2e") => `https://www.tiktok.com/@${user}/video/7${SEED}${String(n).padStart(13, "0")}`;
const REDIRECT = `https://${EXTENSION_ID}.chromiumapp.org/aethryon`;

function build(out, env = {}) {
  execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", `--out=${out}`], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
  return join(ROOT, out);
}

/** Flux du fichier : « video:h264 », « audio:aac »… (ffprobe de l'hôte, sinon celui de l'image ytapi). */
function probe(file) {
  let out;
  try {
    out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", file]);
  } catch {
    out = execFileSync("docker", ["run", "--rm", "-v", `${dirname(file)}:/d:ro`, "--network", "none", "--entrypoint", "ffprobe", "ytc2-ytapi:reel",
      "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", `/d/${file.split("/").pop()}`]);
  }
  return JSON.parse(out.toString()).streams.map((s) => `${s.codec_type}:${s.codec_name}`).sort();
}

async function startAndWait(b, msg, pred = (j) => ["done", "error", "cancelled"].includes(j.state), opts) {
  const r = await b.send(msg);
  assert.equal(r?.ok, true, `job.start refusé : ${r?.error?.code ?? "sans réponse"}`);
  return b.waitJob(r.data.key, pred, opts);
}

const PP = preprodAvailable();

describe("préproduction réelle : fichiers écrits par chrome.downloads, ffprobe, quota, révocation", { skip: PP ? false : "préproduction arrêtée" }, () => {
  let b;
  let dl;
  let cookie;
  let key;
  const email = `ext-bg-${Date.now().toString(36)}@preprod.test`;

  before(async () => {
    const ext = build("tests/out/dist-preprod"); // API http://127.0.0.1:18111, site http://localhost:18110
    dl = mkdtempSync(join(tmpdir(), "aethryon-dl-pp-"));
    cookie = testSession(email);
    // Vrai jeton d'extension (clé ytc_ de type « extension ») obtenu par le contrat serveur.
    const grant = await extensionToken(cookie);
    const listed = (await web(cookie, "/api/keys")).body.keys.filter((k) => k.kind === "extension");
    assert.equal(listed.length, 1, "clé d'extension créée");
    key = { secret: grant.token, id: listed[0].id };
    assert.match(key.secret.slice(0, 4), /^ytc_$/);
    b = await launchWithExtension({ extDir: ext, downloadDir: dl });
    const sw = await b.worker();
    // Liaison écrite comme le ferait auth.login (même forme qu'AuthState), avec ce vrai jeton d'extension.
    // Notice sur les données acceptée, par le vrai chemin (comme « Accepter » sur la page d'accueil).
    assert.equal((await b.acceptConsent())?.ok, true);
    await sw.evaluate((auth) => chrome.storage.local.set({ auth }), {
      token: key.secret, expiresAt: grant.expiresAt, email: grant.user.email, name: grant.user.name, linkedAt: new Date().toISOString(),
    });
  });

  after(async () => {
    await b?.close();
    if (cookie) await web(cookie, "/api/auth/delete-user", { method: "POST", body: {} });
    if (dl) rmSync(dl, { recursive: true, force: true });
  });

  test("MP4 : conversion ytapi → chrome.downloads (jeton en en-tête) → fichier H.264 + AAC sur le disque", { timeout: 120_000 }, async () => {
    const j = await startAndWait(b, { type: "job.start", url: TT(1), fmt: "mp4" });
    assert.equal(j.state, "done", `état ${j.state} ${j.error?.code ?? ""} ${j.error?.message ?? ""}`);
    assert.match(j.fileName, /^Démonstration préproduction \[7\d+\]( \(\d+\))?\.mp4$/);
    const file = join(dl, j.fileName);
    assert.ok(existsSync(file), "fichier présent dans le dossier de téléchargement du navigateur");
    assert.ok(statSync(file).size > 1000);
    assert.equal(statSync(file).size, j.bytes);
    const streams = probe(file);
    assert.ok(streams.includes("video:h264") || streams.includes("video:hevc"), streams.join(","));
    assert.ok(streams.includes("audio:aac"), streams.join(","));
    assert.equal(j.progress, 100);
  });

  test("MP3 : fichier audio MP3 réel", { timeout: 120_000 }, async () => {
    const j = await startAndWait(b, { type: "job.start", url: TT(2), fmt: "mp3", bitrate: 128 });
    assert.equal(j.state, "done", `état ${j.state} ${j.error?.code ?? ""}`);
    assert.match(j.fileName, /\.mp3$/);
    const file = join(dl, j.fileName);
    assert.ok(statSync(file).size > 1000);
    assert.deepEqual(probe(file), ["audio:mp3"]);
  });

  test("popup.init : /api/extension/me réel → compte, quota du jour, conversions récentes", { timeout: 30_000 }, async () => {
    const r = await b.send({ type: "popup.init" });
    assert.equal(r.ok, true);
    assert.equal(r.data.account.connected, true);
    assert.equal(r.data.account.email, email);
    assert.equal(r.data.account.stale, undefined);
    assert.equal(r.data.account.today.limit, 10, "quota du compte (DAILY_CONVERSIONS de préproduction)");
    assert.ok(r.data.account.today.used >= 2, `conversions comptées (${r.data.account.today.used})`);
    assert.ok(r.data.account.recent.length >= 2 && r.data.account.recent.length <= 5);
    assert.deepEqual(r.data.account.recent.slice(0, 2).map((x) => `${x.fmt}:${x.state}`), ["mp3:done", "mp4:done"]);
    assert.equal(r.data.detected, null, "onglet sans content script");
    assert.equal(r.data.pageHint, `Ouvre une vidéo YouTube, TikTok ou X pour la télécharger. Si elle est déjà ouverte, recharge la page.`);
    assert.ok(r.data.jobs.length >= 2);
    assert.equal(r.data.jobs[0].fmt, "mp3", "plus récent d'abord");
  });

  test("annulation réelle pendant une conversion lente (DELETE ytapi)", { timeout: 60_000 }, async () => {
    const r = await b.send({ type: "job.start", url: TT(3, "slow-test"), fmt: "mp3" });
    assert.equal(r.ok, true);
    await b.waitJob(r.data.key, (j) => Boolean(j.jobId), { timeoutMs: 15_000 });
    const c = await b.send({ type: "job.cancel", key: r.data.key });
    assert.equal(c.data.state, "cancelled");
    const after = await b.waitJob(r.data.key, (j) => j.state === "cancelled", { timeoutMs: 5_000 });
    assert.equal(after.downloadId, undefined);
  });

  test("même compte, même quota : les conversions de l'extension sont dans l'activité du site", { timeout: 30_000 }, async () => {
    await new Promise((res) => setTimeout(res, 1500)); // événements d'usage envoyés par une file asynchrone
    const act = await web(cookie, "/api/activity?limit=20");
    assert.equal(act.status, 200);
    const fmts = act.body.items.map((i) => `${i.fmt}:${i.state}`);
    assert.ok(fmts.includes("mp4:done") && fmts.includes("mp3:done"), fmts.join(" "));
    const me = await web(cookie, "/api/me");
    assert.ok(me.body.today.used >= 3, `quota du jour décompté (${me.body.today.used})`);
  });

  test("révocation de la clé sur le site → job refusé (401) : auth_required avec le motif (« Mes jetons »), liaison effacée", { timeout: 60_000 }, async () => {
    const rev = await web(cookie, `/api/keys/${key.id}/revoke`, { method: "POST" });
    assert.equal(rev.status, 200);
    const j = await startAndWait(b, { type: "job.start", url: TT(4), fmt: "mp4" });
    assert.equal(j.state, "error");
    assert.deepEqual(j.error, { code: "auth_required", message: `Cette extension a été déconnectée de ton compte depuis «${NB}Mes jetons${NB}». Reconnecte-la pour continuer.`, retryable: false });
    assert.equal(await b.hasAuth(), false, "liaison effacée");
    const again = await b.send({ type: "job.start", url: TT(5), fmt: "mp4" });
    assert.equal(again.error.code, "auth_required");
  });
});

describe("serveur de test local : connexion PKCE réelle, coupure, 410, 429, 401, reprise du worker", () => {
  let fake;
  let b;
  let dl;

  before(async () => {
    fake = await startFakeServer();
    const ext = build("tests/out/dist-test", { AETHRYON_API: fake.apiBase, AETHRYON_SITE: fake.siteBase });
    dl = mkdtempSync(join(tmpdir(), "aethryon-dl-fake-"));
    b = await launchWithExtension({ extDir: ext, downloadDir: dl });
    await b.worker();
    // Avant l'accord à la notice : connexion refusée, aucune fenêtre, aucune requête au serveur de test.
    const refused = await b.send({ type: "auth.login" });
    assert.equal(refused?.error?.code, "consent_required");
    assert.equal(fake.state.authorizeQueries.length + fake.state.tokenRequests.length, 0);
    assert.equal((await b.acceptConsent())?.ok, true);
  });

  /** Raison d'interruption rapportée par Chrome lui-même (lue depuis une page de l'extension). */
  const chromeReason = (downloadId) => b.page.evaluate(async (id) => (await chrome.downloads.search({ id }))[0]?.error ?? null, downloadId);

  after(async () => {
    await b?.close();
    await fake?.close();
    if (dl) rmSync(dl, { recursive: true, force: true });
  });

  test("connexion : vrai launchWebAuthFlow → page d'autorisation → retour chromiumapp.org → échange PKCE → liaison", { timeout: 60_000 }, async (t) => {
    t.diagnostic(`navigateur : ${b.version}, mode --headless (new headless), extension ${EXTENSION_ID}`);
    const r = await b.send({ type: "auth.login" });
    assert.equal(r?.ok, true, `auth.login : ${r?.error?.code ?? "sans réponse"}`);
    assert.equal(r.data.connected, true);
    assert.equal(r.data.email, "test@fake.test");
    assert.equal(r.data.today.limit, 10);
    const q = fake.state.authorizeQueries.at(-1);
    assert.equal(q.redirect_uri, REDIRECT);
    assert.equal(q.code_challenge_method, "S256");
    assert.match(q.state, /^[A-Za-z0-9_-]{43}$/);
    assert.match(q.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.match(q.appareil, /^(Chrome|Chromium) · Linux$/);
    const tr = fake.state.tokenRequests.at(-1);
    assert.deepEqual(tr.keys, ["code", "code_verifier", "redirect_uri"]);
    assert.equal(tr.hadAuthorization, false);
    assert.equal(tr.hadCookie, false);
    assert.equal(tr.origin, `chrome-extension://${EXTENSION_ID}`, "origine envoyée par le navigateur (à accepter côté serveur)");
    assert.equal(await b.hasAuth(), true);
    // storage.local réservé aux contextes de confiance (setAccessLevel accepté par ce Chromium)
    const level = await (await b.worker()).evaluate(async () => {
      try { await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }); return "ok"; } catch (e) { return String(e.message); }
    });
    assert.equal(level, "ok");
  });

  test("content script réel (page YouTube fabriquée, servie localement) : jeton illisible, demandes limitées et revalidées", { timeout: 60_000 }, async (t) => {
    const yt = await b.context.newPage();
    // Aucune requête ne part vers YouTube : la page est fournie par l'interception de Playwright.
    await yt.route("**/*", (route) => (route.request().url().startsWith("https://www.youtube.com/")
      ? route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Page de test</title><p>page de test</p>" })
      : route.abort()));
    const s = await b.context.newCDPSession(yt);
    const contexts = [];
    s.on("Runtime.executionContextCreated", (e) => contexts.push(e.context));
    await s.send("Runtime.enable");
    await yt.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    let ctx = null;
    for (let i = 0; i < 50 && !ctx; i++) {
      ctx = contexts.find((c) => c.auxData?.type === "isolated" && c.origin === `chrome-extension://${EXTENSION_ID}`) ?? null;
      if (!ctx) await new Promise((res) => setTimeout(res, 100));
    }
    assert.ok(ctx, "monde isolé du content script de l'extension");
    const { result } = await s.send("Runtime.evaluate", {
      contextId: ctx.id, awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const out = {};
        try { await chrome.storage.local.get("auth"); out.local = "lisible"; } catch (e) { out.local = "refusé"; }
        try { await chrome.storage.sync.get("settings"); out.sync = "lisible"; } catch (e) { out.sync = "refusé"; }
        out.list = await chrome.runtime.sendMessage({ type: "jobs.list" });
        try { out.login = (await chrome.runtime.sendMessage({ type: "auth.login" })) ?? "sans réponse"; } catch (e) { out.login = "sans réponse"; }
        try { out.init = (await chrome.runtime.sendMessage({ type: "popup.init" })) ?? "sans réponse"; } catch (e) { out.init = "sans réponse"; }
        out.evil = await chrome.runtime.sendMessage({ type: "job.start", url: "https://evil.test/watch?v=dQw4w9WgXcQ", fmt: "mp4" });
        out.other = await chrome.runtime.sendMessage({ type: "job.start", url: ${JSON.stringify(TT(19))}, fmt: "mp4" });
        return out;
      })()`,
    });
    const out = result.value;
    // Témoin : le refus vient bien de setAccessLevel (sinon storage.local est lisible par les content scripts).
    const readLocal = async () => (await s.send("Runtime.evaluate", {
      contextId: ctx.id, awaitPromise: true, returnByValue: true,
      expression: `chrome.storage.local.get("auth").then(() => "lisible", () => "refusé")`,
    })).result.value;
    const sw = await b.worker();
    await sw.evaluate(() => chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }));
    const opened = await readLocal();
    await sw.evaluate(() => chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
    const closedAgain = await readLocal();
    assert.deepEqual([opened, closedAgain], ["lisible", "refusé"], "témoin setAccessLevel");
    await s.detach();
    await yt.close();
    t.diagnostic(`content script : storage.local ${out.local}, storage.sync ${out.sync}, auth.login ${JSON.stringify(out.login)}`);
    assert.equal(out.local, "refusé", "storage.local (jeton) illisible depuis un content script");
    assert.equal(out.sync, "lisible", "les réglages restent lisibles");
    assert.deepEqual(out.list, { ok: true, data: [] }, "jobs.list : seulement ceux de cet onglet");
    // « Se connecter à AETHRYON » dans la page : vraie connexion, mais la page n'apprend que « connecté ».
    assert.deepEqual(out.login, { ok: true, data: { connected: true } }, "auth.login depuis un onglet : réponse réduite, aucune donnée du compte");
    assert.equal(out.init, "sans réponse", "popup.init refusé depuis un onglet");
    assert.equal(out.evil?.error?.code, "unsupported_url");
    assert.equal(out.other?.error?.code, "unsupported_url", "vidéo TikTok demandée depuis une page YouTube");
    assert.ok(!fake.state.urls.some((u) => u.includes("evil")));
  });

  test("téléchargement : chrome.downloads envoie bien Authorization: Bearer, le fichier complet est écrit", { timeout: 60_000 }, async () => {
    const j = await startAndWait(b, { type: "job.start", url: TT(10), fmt: "mp4" });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""}`);
    const reqs = fake.state.fileRequests.filter((x) => x.jobId === j.jobId);
    assert.ok(reqs.length >= 1);
    assert.ok(reqs.every((x) => x.authOk), "en-tête Authorization reçu et valide sur la requête du fichier");
    assert.ok(reqs.some((x) => x.range === null && x.outcome === "200"));
    const file = join(dl, j.fileName);
    assert.equal(statSync(file).size, fake.fileSize);
    assert.equal(j.bytes, fake.fileSize);
    const expected = Buffer.alloc(fake.fileSize);
    for (let i = 0; i < fake.fileSize; i++) expected[i] = (i * 31 + 7) & 0xff;
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), createHash("sha256").update(expected).digest("hex"));
  });

  test("coupure en plein transfert → erreur relançable ; relance → seul le téléchargement recommence → fichier complet", { timeout: 120_000 }, async (t) => {
    const j = await startAndWait(b, { type: "job.start", url: TT(11, "cut"), fmt: "mp4" });
    t.diagnostic(`raison Chrome : ${await chromeReason(j.downloadId)} ; requêtes coupées : ${fake.state.fileRequests.filter((x) => x.jobId === j.jobId && x.outcome === "cut").length}`);
    assert.equal(j.state, "error");
    assert.equal(j.error.retryable, true);
    assert.equal(j.error.code, "download_interrupted");
    assert.equal(j.error.message, `Téléchargement interrompu${NB}: la connexion au serveur a été perdue. Relance-le.`);
    const cuts = fake.state.fileRequests.filter((x) => x.jobId === j.jobId && x.outcome === "cut").length;
    assert.ok(cuts >= 1, `coupures servies : ${cuts}`);
    const jobsBefore = fake.state.n;
    fake.heal(j.jobId);
    const r = await b.send({ type: "job.retry", key: j.key });
    assert.equal(r.ok, true);
    const done = await b.waitJob(j.key, (x) => x.state === "done" || x.state === "error");
    assert.equal(done.state, "done", `${done.state} ${done.error?.code ?? ""}`);
    assert.equal(fake.state.n, jobsBefore, "pas de nouvelle conversion");
    assert.equal(statSync(join(dl, done.fileName)).size, fake.fileSize);
  });

  test("fichier expiré (HTTP 410) → « Le fichier a expiré sur le serveur : relance la conversion. »", { timeout: 60_000 }, async (t) => {
    const j = await startAndWait(b, { type: "job.start", url: TT(12, "gone"), fmt: "mp4" });
    t.diagnostic(`raison Chrome pour le 410 : ${j.downloadId === undefined ? "téléchargement refusé dès le lancement" : await chromeReason(j.downloadId)}`);
    assert.equal(j.state, "error");
    assert.deepEqual(j.error, { code: "file_expired", message: `Le fichier a expiré sur le serveur${NB}: relance la conversion.`, retryable: true });
  });

  test("quota dépassé (HTTP 429 + Retry-After) → texte du serveur, non relançable", { timeout: 60_000 }, async () => {
    const j = await startAndWait(b, { type: "job.start", url: TT(13, "quota"), fmt: "mp4" });
    assert.deepEqual(j.error, {
      code: "quota_exceeded", message: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris).", retryable: false,
    });
  });

  test("service worker arrêté pendant la conversion → l'alarme le relance → suivi repris → fichier téléchargé", { timeout: 120_000 }, async (t) => {
    const r = await b.send({ type: "job.start", url: TT(14, "slow"), fmt: "mp4" });
    assert.equal(r.ok, true);
    const polls = fake.state.pollRequests;
    await b.waitJob(r.data.key, (j) => Boolean(j.jobId), { timeoutMs: 10_000, viaSession: true });
    for (let i = 0; i < 40 && fake.state.pollRequests === polls; i++) await new Promise((res) => setTimeout(res, 100));
    const stopped = await stopExtensionWorker(b.context, b.page);
    assert.ok(stopped >= 1, "service worker arrêté");
    const t0 = Date.now();
    const pollsAtStop = fake.state.pollRequests;
    // lecture de storage.session depuis la page : ne réveille PAS le worker
    const j = await b.waitJob(r.data.key, (x) => x.state === "done" || x.state === "error", { timeoutMs: 90_000, viaSession: true });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""}`);
    assert.ok(Date.now() - t0 > 5_000, "repris plus tard, par l'alarme");
    assert.ok(fake.state.pollRequests > pollsAtStop, "suivi relancé par le nouveau worker");
    t.diagnostic(`reprise après ${Math.round((Date.now() - t0) / 1000)} s (alarme « aethryon-jobs » de 30 s)`);
    assert.equal(statSync(join(dl, j.fileName)).size, fake.fileSize);
  });

  test("jeton refusé (401) → auth_required, liaison effacée ; déconnexion → révocation serveur", { timeout: 60_000 }, async (t) => {
    fake.revokeAll();
    const j = await startAndWait(b, { type: "job.start", url: TT(15), fmt: "mp4" });
    assert.equal(j.error?.code, "auth_required");
    assert.equal(await b.hasAuth(), false);
    const login = await b.send({ type: "auth.login" });
    assert.equal(login.ok, true);
    const out = await b.send({ type: "auth.logout" });
    assert.deepEqual(out, { ok: true, data: { connected: false } });
    assert.equal(fake.state.logouts, 1);
    assert.equal(await b.hasAuth(), false);
    assert.equal(fake.tokenSeenInUrl(), false, "jeton jamais dans une URL reçue par le serveur");
    t.diagnostic(`requêtes reçues par le serveur de test : ${fake.state.urls.length}`);
  });
});
