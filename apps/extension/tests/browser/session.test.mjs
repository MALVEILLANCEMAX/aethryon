// Compte partagé, sessions et erreurs de l'extension, de bout en bout contre la PRÉPRODUCTION (account et
// site de cette branche, ytapi à faux worker qui produit de vrais petits MP4/MP3) dans un vrai Chromium
// avec l'extension construite (build de développement) :
//   1. même compte, même quota, même historique que le raccourci iPhone : une conversion par une clé du
//      raccourci (requêtes du raccourci : POST /jobs, suivi, GET du fichier), deux par l'extension (fichiers
//      écrits par chrome.downloads, vérifiés par ffprobe) → compteur du jour commun ; quota épuisé →
//      refus pour l'extension ET pour le raccourci ; popup réel : « 0 conversion restante sur 3 » ;
//   2. révocation depuis « Mes jetons » (vrai clic) et 3. depuis le Control Center (vrai clic, popup
//      ouvert) → l'appel suivant échoue proprement et le popup revient à « Reconnecte-toi » avec le motif ;
//   4. clé expirée (en base et localement, puis en base seulement) → « a expiré » ;
//   5. conversions suspendues (service indisponible) → message du serveur, relance réussie ensuite ;
//   6. réseau coupé (émulation hors ligne du service worker) → dernières infos connues, erreur réseau,
//      relance réussie une fois le réseau revenu ;
//   7. compte suspendu → liaison gardée, popup « suspendu », refus ; réactivation → conversion réelle ;
//   8. déconnexion depuis le popup (vrai clic) → clé révoquée côté serveur (motif « user »).
// Simulé : la LIAISON initiale (jeton d'extension RÉEL obtenu par le contrat serveur — consentement HTTP
// avec la session + échange PKCE —, écrit dans storage.local comme le fait auth.login ; la fenêtre
// launchWebAuthFlow elle-même est couverte par login.test.mjs) ; la session du site (outil de préproduction).
// Aucun secret affiché ; l'utilisateur de test est supprimé à la fin.
//   node --test tests/browser/session.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, launchWithExtension } from "../support/browser.mjs";
import { CONTAINERS, extensionToken, ORIGIN, preprodAvailable, testSession, web, WEB, YTAPI } from "../support/preprod.mjs";
import { axe, serious, typography } from "./ui-helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "tests", "out", "session");
const NB = "\u00a0"; // espace insécable (typographie française)
const RUN = Date.now().toString(36);
const SEED = String(Date.now() % 100000).padStart(5, "0");
const TT = (n, user = "e2e") => `https://www.tiktok.com/@${user}/video/8${SEED}${String(n).padStart(13, "0")}`;
const PP = preprodAvailable();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DONE = (j) => ["done", "error", "cancelled"].includes(j.state);

const LOST = {
  user: `Cette extension a été déconnectée de ton compte depuis «${NB}Mes jetons${NB}». Reconnecte-la pour continuer.`,
  admin: "Un administrateur AETHRYON a révoqué l'accès de cette extension. Reconnecte-la pour continuer.",
  expired: `Connexion expirée (30 jours)${NB}: reconnecte-toi.`,
};

function build(out) {
  execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", `--out=${out}`], { cwd: ROOT, stdio: "ignore" });
  return join(ROOT, out);
}

/** Flux du fichier (ffprobe de l'image ytapi, sans réseau). */
function probe(file) {
  const out = execFileSync("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", `${dirname(file)}:/d:ro`, "--entrypoint", "ffprobe", "ytc2-ytapi:reel",
    "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", `/d/${file.split("/").pop()}`]);
  return JSON.parse(out.toString()).streams.map((s) => `${s.codec_type}:${s.codec_name}`).sort();
}

/** Requête à ytapi avec une clé (comme le raccourci iPhone) ; corps JSON ou octets du fichier. */
async function ytapi(key, path, { method = "GET", body } = {}) {
  const headers = { authorization: `Bearer ${key}` };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(path.startsWith("http") ? path : YTAPI + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: data, headers: res.headers };
}

/** Parcours du raccourci iPhone (v3) : POST /jobs, suivi jusqu'à la fin, GET du fichier. */
async function shortcutConvert(key, url, fmt) {
  let r = await ytapi(key, "/jobs?wait=20", { method: "POST", body: { url, fmt } });
  for (let i = 0; i < 20 && (r.status === 200 || r.status === 202) && !["done", "error"].includes(r.body.status); i++) {
    r = await ytapi(key, `/jobs/${r.body.job_id}?wait=20`);
  }
  if (r.status !== 200 || r.body.status !== "done") return { job: r, file: null };
  return { job: r, file: await ytapi(key, r.body.file_url) };
}

/** Clé d'extension expirée directement en base (préproduction seulement), comme 30 jours plus tard. */
function expireInDb(keyId) {
  execFileSync("docker", ["exec", CONTAINERS.account, "node", "-e",
    "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/account.sqlite');const id=process.argv[1];" +
    "const r=d.prepare('SELECT expiresAt FROM apikey WHERE id=?').get(id);if(!r)process.exit(3);" +
    "const v=typeof r.expiresAt==='number'?Date.now()-60000:new Date(Date.now()-60000).toISOString();" +
    "d.prepare('UPDATE apikey SET expiresAt=? WHERE id=?').run(v,id);", keyId], { stdio: ["ignore", "ignore", "inherit"] });
}

describe("préproduction : compte partagé avec le raccourci, révocations, expiration, service indisponible, réseau coupé, suspension, déconnexion", { skip: PP ? false : "préproduction arrêtée" }, () => {
  let b;
  let dl;
  let cookie;
  let admin;
  let userId;
  const email = `ext-session-${RUN}@preprod.test`;
  const secrets = [];
  const report = [];

  const cookieFor = (c) => {
    const i = c.indexOf("=");
    return { name: c.slice(0, i), value: c.slice(i + 1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" };
  };

  /** Nouvelle liaison avec un VRAI jeton d'extension (appareil « <tag>-<lancement> », nom de clé complet). */
  async function link(tag) {
    const device = `${tag}-${RUN}`;
    // Tests indépendants : les liaisons encore actives d'un test précédent sont révoquées (au plus 3 par compte).
    for (const k of (await web(cookie, "/api/keys")).body.keys.filter((x) => x.kind === "extension" && x.status === "active")) {
      await web(cookie, `/api/keys/${k.id}/revoke`, { method: "POST" });
    }
    const grant = await extensionToken(cookie, { appareil: device });
    secrets.push(grant.token);
    const key = (await web(cookie, "/api/keys")).body.keys.find((k) => k.kind === "extension" && k.deviceLabel === device);
    assert.ok(key, `clé d'extension ${device}`);
    const sw = await b.worker();
    await sw.evaluate(async (auth) => {
      await chrome.storage.local.remove("authNotice");
      await chrome.storage.local.set({ auth });
    }, { token: grant.token, expiresAt: grant.expiresAt, email: grant.user.email, name: grant.user.name, linkedAt: new Date().toISOString() });
    return { token: grant.token, keyId: key.id, device, name: key.name };
  }

  const setAuthField = async (patch) => (await b.worker()).evaluate(async (p) => {
    const { auth } = await chrome.storage.local.get("auth");
    await chrome.storage.local.set({ auth: { ...auth, ...p } });
  }, patch);

  async function startAndWait(msg, pred = DONE, timeoutMs = 90_000) {
    const r = await b.send(msg);
    assert.equal(r?.ok, true, `job.start : ${r?.error?.code ?? "sans réponse"} ${r?.error?.message ?? ""}`);
    return b.waitJob(r.data.key, pred, { timeoutMs });
  }

  /** Le VRAI popup (service worker réel) dans un onglet de 380 × 600. */
  async function openPopup() {
    const page = await b.context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    await page.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`);
    await page.waitForSelector("#conn:not([hidden]), .failure", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors };
  }

  /** Accessibilité (axe, clair et sombre) et typographie du popup réel, capture des deux thèmes. */
  async function auditPopup(page, errors, name) {
    const problems = [];
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(450);
      const bad = serious(await axe(page));
      if (bad.length) problems.push(`${name}/${scheme} axe ${JSON.stringify(bad)}`);
      await page.screenshot({ path: join(OUT, `${name}-${scheme === "light" ? "clair" : "sombre"}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
    const typo = await typography(page);
    if (typo.length) problems.push(`${name} typographie ${JSON.stringify(typo)}`);
    if (errors.length) problems.push(`${name} console ${errors.join(" | ")}`);
    report.push({ name, problems });
    assert.deepEqual(problems, []);
  }

  const text = (page, sel) => page.locator(sel).first().textContent();

  before(async () => {
    mkdirSync(OUT, { recursive: true });
    const ext = build("tests/out/dist-session");
    // Limiteurs de ytapi remis à zéro (en mémoire) : cette suite provoque volontairement des refus de jeton.
    execFileSync("docker", ["restart", CONTAINERS.ytapi], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) {
      if (execFileSync("docker", ["inspect", CONTAINERS.ytapi, "-f", "{{.State.Health.Status}}"]).toString().trim() === "healthy") break;
      await sleep(1000);
    }
    dl = mkdtempSync(join(tmpdir(), "aethryon-dl-session-"));
    cookie = testSession(email);
    admin = testSession("admin@preprod.test", { admin: true });
    secrets.push(cookie.split("=").slice(1).join("="), admin.split("=").slice(1).join("="));
    userId = (await web(cookie, "/api/me")).body.user.id;
    // État global attendu (réglages partagés de la préproduction) : conversions actives.
    assert.equal((await web(admin, "/api/admin/settings", { method: "PUT", body: { conversionsPaused: false } })).status, 200);
    b = await launchWithExtension({ extDir: ext, downloadDir: dl });
    await b.worker();
    // Notice sur les données acceptée (vrai chemin, comme « Accepter » sur la page d'accueil).
    assert.equal((await b.acceptConsent())?.ok, true);
    await b.context.addCookies([cookieFor(cookie)]);
  });

  after(async () => {
    await b?.context.setOffline(false).catch(() => undefined);
    if (admin) await web(admin, "/api/admin/settings", { method: "PUT", body: { conversionsPaused: false } });
    if (admin && userId) await web(admin, `/api/admin/users/${userId}/status`, { method: "POST", body: { status: "active" } });
    await b?.close();
    if (email) {
      const c = testSession(email); // session fraîche (la suspension a supprimé les précédentes)
      await web(c, "/api/auth/delete-user", { method: "POST", body: {} });
    }
    if (dl) rmSync(dl, { recursive: true, force: true });
  });

  test("même compte, même quota, même historique que le raccourci iPhone ; quota épuisé → refus pour les deux ; popup réel", { timeout: 240_000 }, async (t) => {
    // Quota du jour de ce compte : 3 (Control Center), compteur à zéro.
    assert.equal((await web(admin, `/api/admin/users/${userId}/quota`, { method: "PUT", body: { dailyLimit: 3, unlimited: false, maxActive: null } })).status, 200);
    assert.equal((await web(admin, `/api/admin/users/${userId}/quota/reset`, { method: "POST" })).status, 200);
    // 1. le raccourci iPhone (clé du raccourci, mêmes requêtes que le raccourci v3)
    const shortcut = (await web(cookie, "/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret;
    secrets.push(shortcut);
    const s1 = await shortcutConvert(shortcut, TT(1), "mp4");
    assert.equal(s1.job.body.status, "done", JSON.stringify(s1.job.body).slice(0, 200));
    assert.equal(s1.file.status, 200);
    assert.ok(s1.file.body.length > 1000, "fichier reçu par le raccourci");
    // 2. l'extension : MP4 puis MP3, fichiers écrits par le navigateur
    const ext = await link("Quota");
    const j1 = await startAndWait({ type: "job.start", url: TT(2), fmt: "mp4" });
    assert.equal(j1.state, "done", `${j1.state} ${j1.error?.code ?? ""}`);
    assert.ok(existsSync(join(dl, j1.fileName)));
    assert.ok(probe(join(dl, j1.fileName)).includes("video:h264"));
    const j2 = await startAndWait({ type: "job.start", url: TT(3), fmt: "mp3" });
    assert.equal(j2.state, "done", `${j2.state} ${j2.error?.code ?? ""}`);
    assert.deepEqual(probe(join(dl, j2.fileName)), ["audio:mp3"]);
    assert.equal(statSync(join(dl, j2.fileName)).size, j2.bytes);
    await sleep(1500); // événements d'usage envoyés par ytapi de façon asynchrone
    // Compteur du jour commun (site), historique commun (page Activité du site)
    const me = (await web(cookie, "/api/me")).body.today;
    assert.deepEqual([me.used, me.limit, me.remaining], [3, 3, 0]);
    const act = (await web(cookie, "/api/activity?limit=10")).body.items;
    assert.deepEqual(act.map((i) => `${i.platform}:${i.fmt}:${i.state}`), ["tiktok:mp3:done", "tiktok:mp4:done", "tiktok:mp4:done"]);
    // Qui a converti quoi (Control Center : nom de la clé de chaque conversion)
    const convs = (await web(admin, `/api/admin/conversions?userId=${userId}&pageSize=10`)).body.items;
    const names = [];
    for (const c of convs) names.push((await web(admin, `/api/admin/conversions/${c.id}`)).body.keyName);
    assert.deepEqual(names.sort(), [ext.name, ext.name, "iPhone"].sort(), "deux conversions de l'extension, une du raccourci, même compte");
    // 3. quota épuisé : l'extension ET le raccourci sont refusés, avec le texte du serveur
    const j3 = await startAndWait({ type: "job.start", url: TT(4), fmt: "mp4" });
    assert.deepEqual(j3.error, { code: "quota_exceeded", message: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris).", retryable: false });
    const refused = await ytapi(shortcut, "/jobs?wait=0", { method: "POST", body: { url: TT(5), fmt: "mp4" } });
    assert.deepEqual([refused.status, refused.body.error], [429, "quota_exceeded"]);
    // 4. le popup réel : quota restant, activité récente, erreur du job
    const acc = await b.send({ type: "account.refresh" });
    assert.deepEqual([acc.data.today.used, acc.data.today.remaining], [3, 0]);
    assert.equal(acc.data.recent.length, 3);
    const { page, errors } = await openPopup();
    assert.equal(await text(page, "#quota-text"), "0 conversion restante sur 3");
    assert.match(await text(page, "#quota-note"), /^Quota du jour atteint/);
    assert.equal(await page.locator("#quota").getAttribute("data-tone"), "bad");
    assert.equal(await page.locator("#account .recent li").count(), 3);
    assert.ok((await page.locator("li.job .job-status-text").allTextContents()).some((x) => x.includes("limite de conversions")));
    await auditPopup(page, errors, "quota-epuise");
    await page.close();
    t.diagnostic(`conversions : raccourci 1, extension 2 ; noms de clés : ${names.join(", ")}`);
    // Remise à zéro pour la suite (Control Center) : quota global, compteur du jour à zéro
    await web(admin, `/api/admin/users/${userId}/quota`, { method: "PUT", body: { dailyLimit: null, unlimited: false, maxActive: null } });
    await web(admin, `/api/admin/users/${userId}/quota/reset`, { method: "POST" });
  });

  test("révocation depuis « Mes jetons » (vrai clic) → conversion refusée avec le motif, popup « Reconnecte-toi »", { timeout: 120_000 }, async () => {
    const ext = await link("Site");
    const keys = await b.context.newPage();
    await keys.goto(`${ORIGIN}/dashboard/cles`, { waitUntil: "networkidle" });
    const section = keys.getByRole("region", { name: "Extensions connectées" });
    await section.getByRole("button", { name: `Révoquer l'extension sur ${ext.device}` }).click();
    const dialog = keys.getByRole("dialog");
    assert.equal((await dialog.getByRole("heading").first().textContent()).trim(), `Révoquer l'extension sur «${NB}${ext.device}${NB}»${NB}?`);
    await dialog.getByRole("button", { name: "Révoquer", exact: true }).click();
    await section.getByText("Révoquée").first().waitFor({ timeout: 10_000 });
    await keys.close();
    // appel suivant de l'extension : refusé proprement, avec le motif
    const j = await startAndWait({ type: "job.start", url: TT(6), fmt: "mp4" });
    assert.deepEqual(j.error, { code: "auth_required", message: LOST.user, retryable: false });
    assert.equal(await b.hasAuth(), false, "liaison effacée");
    assert.equal((await b.send({ type: "jobs.list" })).data.length, 0, "liste des téléchargements effacée à la révocation");
    assert.deepEqual((await b.events("auth.changed")).at(-1), { type: "auth.changed", connected: false, reason: "revoked_user", message: LOST.user });
    const { page, errors } = await openPopup();
    assert.equal(await text(page, "#hero-title"), "Reconnecte-toi");
    assert.equal(await text(page, "#auth-notice"), LOST.user);
    assert.equal(await text(page, "#conn-label"), "Non connecté");
    await auditPopup(page, errors, "revoquee-mes-jetons");
    await page.close();
    // la clé ne passe plus nulle part
    assert.equal((await ytapi(ext.token, "/jobs/verif-session")).status, 401);
  });

  test("révocation depuis le Control Center (vrai clic) pendant que le popup est ouvert → retour immédiat à la connexion avec le motif « administrateur »", { timeout: 120_000 }, async () => {
    const ext = await link("Admin");
    const { page, errors } = await openPopup();
    assert.equal(await text(page, "#conn-label"), "Connecté");
    // Control Center, dans un contexte à part (session administrateur)
    const ctx = await b.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([cookieFor(admin)]);
    const cc = await ctx.newPage();
    await cc.goto(`${ORIGIN}/admin/api-keys`, { waitUntil: "networkidle" });
    await cc.getByRole("searchbox", { name: "Rechercher" }).or(cc.getByLabel("Rechercher")).first().fill(ext.device);
    const btn = cc.getByRole("button", { name: `Révoquer le jeton ${ext.name}` });
    await btn.waitFor({ timeout: 15_000 });
    await btn.click();
    await cc.getByRole("dialog").getByRole("button", { name: "Révoquer", exact: true }).click();
    await cc.getByText("Jeton révoqué").first().waitFor({ timeout: 10_000 });
    await ctx.close();
    // L'appel suivant (bouton d'une page, par exemple) échoue ; le popup ouvert l'affiche aussitôt.
    const j = await startAndWait({ type: "job.start", url: TT(7), fmt: "mp4" });
    assert.deepEqual(j.error, { code: "auth_required", message: LOST.admin, retryable: false });
    await page.waitForFunction(() => document.querySelector("#hero-title")?.textContent === "Reconnecte-toi", null, { timeout: 10_000 });
    assert.equal(await text(page, "#auth-notice"), LOST.admin);
    await page.waitForFunction(() => document.activeElement?.dataset?.action === "login", null, { timeout: 5_000 });
    await auditPopup(page, errors, "revoquee-control-center");
    await page.close();
    const k = (await web(admin, `/api/admin/keys?userId=${userId}&kind=extension&pageSize=50`)).body.items.find((x) => x.id === ext.keyId);
    assert.deepEqual([k.state, k.revokedReason], ["revoked", "admin"]);
  });

  test("clé expirée : ytapi la refuse ; l'extension dit « a expiré » (expiration locale, puis vue par le serveur seul)", { timeout: 120_000 }, async () => {
    // a) 30 jours écoulés : expirée en base ET dans la liaison locale
    const a = await link("Expire");
    expireInDb(a.keyId);
    await setAuthField({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
    let init = await b.send({ type: "popup.init" });
    assert.deepEqual([init.data.account.connected, init.data.account.notice?.reason, init.data.account.notice?.message], [false, "expired", LOST.expired]);
    const r = await ytapi(a.token, "/jobs?wait=0", { method: "POST", body: { url: TT(8), fmt: "mp4" } });
    assert.equal(r.status, 401, "ytapi refuse la clé expirée");
    assert.match(r.body.detail, /expiré/);
    // b) expirée côté serveur seulement (horloge locale en retard) : le compte donne le motif
    const c = await link("Expire2");
    expireInDb(c.keyId);
    init = await b.send({ type: "popup.init" });
    assert.deepEqual([init.data.account.connected, init.data.account.notice?.reason], [false, "expired"]);
    const { page, errors } = await openPopup();
    assert.equal(await text(page, "#auth-notice"), LOST.expired);
    await auditPopup(page, errors, "expiree");
    await page.close();
  });

  test("conversions suspendues (service indisponible) : message du serveur, relançable ; reprise → fichier réel", { timeout: 150_000 }, async () => {
    await link("Pause");
    assert.equal((await web(admin, "/api/admin/settings", { method: "PUT", body: { conversionsPaused: true } })).status, 200);
    let j;
    try {
      j = await startAndWait({ type: "job.start", url: TT(9), fmt: "mp4" });
    } finally {
      await web(admin, "/api/admin/settings", { method: "PUT", body: { conversionsPaused: false } });
    }
    assert.deepEqual(j.error, { code: "service_paused", message: `Les conversions sont temporairement suspendues. Réessaie dans 5${NB}min.`, retryable: true });
    assert.equal(await b.hasAuth(), true, "la liaison n'est pas touchée");
    const { page, errors } = await openPopup();
    const row = page.locator("li.job").first();
    assert.ok((await row.textContent()).includes("temporairement suspendues"));
    assert.equal(await row.locator("[data-action=retry]").count(), 1, "« Réessayer » proposé");
    await auditPopup(page, errors, "service-suspendu");
    await row.locator("[data-action=retry]").click();
    const done = await b.waitJob(j.key, (x) => x.state === "done" || x.state === "error", { timeoutMs: 90_000 });
    assert.equal(done.state, "done", `${done.state} ${done.error?.code ?? ""}`);
    assert.ok(probe(join(dl, done.fileName)).includes("video:h264"));
    await page.close();
  });

  test("réseau coupé : dernières infos connues, conversion → erreur réseau relançable ; réseau rétabli → relance → fichier réel", { timeout: 150_000 }, async () => {
    await link("Reseau");
    assert.equal((await b.send({ type: "account.refresh" })).data.stale, undefined, "compte lu une fois en ligne");
    await b.context.setOffline(true);
    let j;
    try {
      const init = await b.send({ type: "popup.init" });
      assert.deepEqual([init.data.account.connected, init.data.account.stale, init.data.account.degraded], [true, true, { reason: "network" }], "liaison gardée, état dégradé, dernières infos connues");
      j = await startAndWait({ type: "job.start", url: TT(10), fmt: "mp3" });
      assert.deepEqual(j.error, { code: "network", message: `Impossible de joindre le serveur AETHRYON${NB}: vérifie ta connexion puis réessaie.`, retryable: true });
      const { page, errors } = await openPopup();
      assert.equal(await text(page, "#conn-label"), "Hors ligne", "jamais « Connecté » sans réponse du compte");
      assert.equal(await text(page, "#degraded-title"), "AETHRYON injoignable");
      assert.match(await text(page, ".strip-hint"), /Dernier quota connu/);
      await auditPopup(page, errors, "reseau-coupe");
      await page.close();
    } finally {
      await b.context.setOffline(false);
    }
    assert.equal(await b.hasAuth(), true, "liaison gardée hors ligne");
    const r = await b.send({ type: "job.retry", key: j.key });
    assert.equal(r.ok, true);
    const done = await b.waitJob(j.key, (x) => x.state === "done" || x.state === "error", { timeoutMs: 90_000 });
    assert.equal(done.state, "done", `${done.state} ${done.error?.code ?? ""}`);
    assert.deepEqual(probe(join(dl, done.fileName)), ["audio:mp3"]);
  });

  test("compte suspendu par un administrateur : liaison gardée, popup « suspendu », refus ; réactivation → conversion réelle", { timeout: 150_000 }, async () => {
    const ext = await link("Suspendu");
    assert.equal((await web(admin, `/api/admin/users/${userId}/status`, { method: "POST", body: { status: "suspended" } })).status, 200);
    try {
      const init = await b.send({ type: "popup.init" });
      assert.deepEqual([init.data.account.connected, init.data.account.suspended], [true, true]);
      const { page, errors } = await openPopup();
      assert.equal(await text(page, "#quota .notice"), `Ton compte AETHRYON est suspendu par un administrateur${NB}: les conversions sont refusées.`);
      await auditPopup(page, errors, "compte-suspendu");
      await page.close();
      const j = await startAndWait({ type: "job.start", url: TT(11), fmt: "mp4" });
      assert.deepEqual(j.error, { code: "account_suspended", message: "Ce compte est suspendu.", retryable: false });
      assert.equal(await b.hasAuth(), true, "liaison gardée");
    } finally {
      assert.equal((await web(admin, `/api/admin/users/${userId}/status`, { method: "POST", body: { status: "active" } })).status, 200);
    }
    const init = await b.send({ type: "popup.init" });
    assert.deepEqual([init.data.account.connected, init.data.account.suspended], [true, undefined], "réactivé : même liaison");
    const j = await startAndWait({ type: "job.start", url: TT(12), fmt: "mp4" });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""}`);
    assert.ok(existsSync(join(dl, j.fileName)));
    // La suspension a supprimé les sessions du site : nouvelle session de test pour la suite.
    cookie = testSession(email);
    secrets.push(cookie.split("=").slice(1).join("="));
    await b.context.addCookies([cookieFor(cookie)]);
    void ext;
  });

  test("déconnexion depuis le popup (vrai clic, confirmation) → clé révoquée côté serveur (motif « user »), ytapi la refuse, aucun motif affiché", { timeout: 90_000 }, async () => {
    const ext = await link("Sortie");
    const { page, errors } = await openPopup();
    await page.locator("[data-action=logout]").click();
    await page.locator("[data-action=logout-confirm]").click();
    await page.waitForFunction(() => document.querySelector("#hero-title")?.textContent === "Connecte-toi", null, { timeout: 15_000 });
    assert.equal(await page.locator("#auth-notice").count(), 0, "déconnexion voulue : aucun motif");
    assert.equal(await page.locator("li.job").count(), 0, "liste des téléchargements effacée");
    assert.deepEqual((await b.send({ type: "jobs.list" })).data, [], "rien ne survit dans storage.session");
    assert.deepEqual((await b.events("auth.changed")).at(-1), { type: "auth.changed", connected: false, reason: "signed_out" });
    assert.deepEqual(errors, []);
    await page.close();
    const k = (await web(admin, `/api/admin/keys?userId=${userId}&kind=extension&pageSize=50`)).body.items.find((x) => x.id === ext.keyId);
    assert.deepEqual([k.state, k.revokedReason], ["revoked", "user"]);
    assert.equal((await ytapi(ext.token, "/jobs/verif-session")).status, 401);
    assert.equal(await b.hasAuth(), false);
  });

  test("rejeu d'un code d'autorisation (serveur réel) : refusé, et la clé émise avec ce code est aussitôt révoquée (motif « replay »)", { timeout: 60_000 }, async () => {
    for (const k of (await web(cookie, "/api/keys")).body.keys.filter((x) => x.kind === "extension" && x.status === "active")) {
      await web(cookie, `/api/keys/${k.id}/revoke`, { method: "POST" });
    }
    const { createHash, randomBytes } = await import("node:crypto");
    const redirect_uri = `https://${EXTENSION_ID}.chromiumapp.org/aethryon`;
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const a = await web(cookie, "/api/extension/authorize", { method: "POST", body: {
      redirect_uri, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", appareil: `Rejeu-${RUN}`,
    } });
    assert.equal(a.status, 200);
    const code = new URL(a.body.redirect).searchParams.get("code");
    secrets.push(code, verifier);
    const exchange = async () => {
      const res = await fetch(`${WEB}/api/extension/token`, {
        method: "POST", headers: { "content-type": "application/json", origin: `chrome-extension://${EXTENSION_ID}` },
        body: JSON.stringify({ code, code_verifier: verifier, redirect_uri }),
      });
      return { status: res.status, body: await res.json() };
    };
    const first = await exchange();
    assert.equal(first.status, 200);
    secrets.push(first.body.token);
    assert.equal((await ytapi(first.body.token, "/jobs/verif-session")).status, 404, "clé acceptée par ytapi (job inconnu)");
    const again = await exchange();
    assert.deepEqual([again.status, again.body.error, "token" in again.body], [400, "invalid_grant", false]);
    const me = await fetch(`${WEB}/api/extension/me`, { headers: { authorization: `Bearer ${first.body.token}` } });
    assert.deepEqual([me.status, (await me.json()).revokedBy], [401, "replay"]);
    assert.equal((await ytapi(first.body.token, "/jobs/verif-session")).status, 401, "ytapi refuse aussitôt la clé révoquée");
    // Mauvais vérificateur : refusé, et le code est brûlé (même le bon vérificateur ne passe plus ensuite)
    const v2 = randomBytes(32).toString("base64url");
    const a2 = await web(cookie, "/api/extension/authorize", { method: "POST", body: {
      redirect_uri, state, code_challenge: createHash("sha256").update(v2).digest("base64url"), code_challenge_method: "S256", appareil: `Rejeu2-${RUN}`,
    } });
    const code2 = new URL(a2.body.redirect).searchParams.get("code");
    const post = (verifierX) => fetch(`${WEB}/api/extension/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code2, code_verifier: verifierX, redirect_uri }) });
    assert.equal((await post(randomBytes(32).toString("base64url"))).status, 400, "PKCE : vérificateur faux");
    assert.equal((await post(v2)).status, 400, "code brûlé après un échec PKCE");
  });

  test("aucun jeton, cookie ni code dans les journaux des conteneurs de préproduction", () => {
    for (const c of [CONTAINERS.web, CONTAINERS.account, CONTAINERS.ytapi]) {
      const logs = execFileSync("sh", ["-c", `docker logs --since 30m ${c} 2>&1`], { maxBuffer: 128 * 1024 * 1024 }).toString();
      for (const s of secrets) assert.ok(!logs.includes(s) && !logs.includes(s.slice(4, 24)), `secret dans les journaux de ${c}`);
    }
    void WEB;
  });
});
