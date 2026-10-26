// Service worker : cycle de vie des jobs, téléchargement par le navigateur, annulation, relance.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL, YT_URL } from "./fakes/harness.ts";
import { tick, until } from "./fakes/chrome.ts";
import { API, TOKEN } from "./fakes/backend.ts";
import { json } from "./fakes/fetch.ts";

const NB = " ";
const distinct = (states: string[]) => states.filter((s, i) => s !== states[i - 1]);

test("cycle complet : queued → converting → downloading → done SEULEMENT à downloads.onChanged « complete »", async (t) => {
  const h = harness(t);
  const r = await h.page({ type: "job.start", url: `${TT_URL}?is_from_webapp=1&sender_device=pc`, fmt: "mp4", title: "Titre de la page" });
  assert.equal(r.ok, true);
  assert.equal(r.data.state, "queued");
  assert.equal(r.data.url, TT_URL, "URL canonique, sans paramètres de suivi");
  assert.match(r.data.key, /^[A-Za-z0-9]{16}$/);
  await until(() => h.browser.alarms.has("aethryon-jobs"), 500, "alarme créée pendant le job");
  assert.equal(h.browser.alarms.get("aethryon-jobs")?.periodInMinutes, 0.5);

  await until(() => h.browser.downloadCalls.length === 1, 2000, "téléchargement lancé");
  assert.deepEqual(h.backend.creates[0], { url: TT_URL, fmt: "mp4", quality: "best" });
  const dl = h.browser.downloadCalls[0]!;
  assert.equal(dl.url, `${API}/jobs/job_0001/file/${encodeURIComponent("Ma vidéo [job_0001].mp4")}`);
  assert.deepEqual(dl.headers, [{ name: "Authorization", value: `Bearer ${TOKEN}` }]);
  assert.equal(dl.conflictAction, "uniquify");
  assert.equal(dl.saveAs, false);
  await until(() => h.job()?.state === "downloading");
  assert.equal(h.job().title, "Ma vidéo", "titre du serveur");

  h.browser.downloadProgress(1, 500, 1000);
  await until(() => h.job().progress === 50, 1000, "progression 50 %");
  h.browser.downloadProgress(1, 1000, 1000); // tout reçu, mais Chrome n'a pas encore dit « complete »
  await tick(60);
  assert.equal(h.job().state, "downloading");
  assert.equal(h.job().progress, 99);

  h.browser.downloadComplete(1, "/home/alice/Téléchargements/Ma vidéo [job_0001].mp4");
  await until(() => h.job().state === "done");
  const j = h.job();
  assert.equal(j.fileName, "Ma vidéo [job_0001].mp4", "nom seul, sans le chemin local");
  assert.equal(j.bytes, 1000);
  assert.equal(j.progress, 100);
  assert.equal(j.fileUrl, `${API}/jobs/job_0001/file/${encodeURIComponent("Ma vidéo [job_0001].mp4")}`, "gardé en interne");
  // Ce qui sort vers les pages : les quatre états, dans l'ordre, sans champ interne.
  const pushed = h.browser.pageMessages.filter((m) => m.type === "job.update");
  assert.deepEqual(distinct(pushed.map((m) => m.job.state)), ["queued", "converting", "downloading", "done"]);
  assert.ok(pushed.some((m) => m.job.state === "converting" && m.job.progress === 40));
  assert.ok(pushed.every((m) => !("fileUrl" in m.job)));
  await until(() => !h.browser.alarms.has("aethryon-jobs"), 500, "alarme retirée sans job actif");
  const list = await h.page({ type: "jobs.list" });
  assert.equal(list.data[0].state, "done");
  assert.ok(!("fileUrl" in list.data[0]));
});

test("MP3 : bitrate des réglages par défaut ; X : index envoyé ; MP4 : qualité demandée", async (t) => {
  const h = harness(t);
  await h.page({ type: "job.start", url: YT_URL, fmt: "mp3" });
  await until(() => h.backend.creates.length === 1);
  assert.deepEqual(h.backend.creates[0], { url: YT_URL, fmt: "mp3", bitrate: 192 });
  await h.page({ type: "job.start", url: "https://x.com/a_b/status/1790637656616943991/video/2", fmt: "mp4", quality: "720" });
  await until(() => h.backend.creates.length === 2);
  assert.deepEqual(h.backend.creates[1], { url: "https://x.com/a_b/status/1790637656616943991", fmt: "mp4", quality: "720", index: 2 });
  // index ignoré hors X
  await h.page({ type: "job.start", url: "https://www.youtube.com/shorts/v-HVEZ_WRBY", fmt: "mp4", index: 3 });
  await until(() => h.backend.creates.length === 3);
  assert.equal(h.backend.creates[2].index, undefined);
});

test("double clic : un seul job actif pour la même demande", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined); // conversion qui dure
  const [a, b] = await Promise.all([
    h.page({ type: "job.start", url: TT_URL, fmt: "mp4" }),
    h.content({ type: "job.start", url: TT_URL, fmt: "mp4" }),
  ]);
  const c = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.equal(a.data.key, b.data.key);
  assert.equal(c.data.key, a.data.key);
  await until(() => h.backend.creates.length >= 1);
  await tick(30);
  assert.equal(h.browser.jobs.length, 1);
  assert.equal(h.backend.creates.length, 1);
  assert.equal(h.job().tabId, 7, "l'onglet demandeur reçoit la progression");
});

test("interruption réseau → erreur relançable ; relance = nouveau téléchargement du MÊME fichier (pas de nouvelle conversion)", async (t) => {
  const h = harness(t);
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  h.browser.downloadProgress(1, 300, 1000);
  h.browser.downloadInterrupt(1, "NETWORK_FAILED");
  await until(() => h.job().state === "error");
  assert.deepEqual(h.job().error, {
    code: "download_interrupted", message: `Téléchargement interrompu${NB}: la connexion au serveur a été perdue. Relance-le.`, retryable: true,
  });
  // le fichier a été sondé (1 octet), avec le jeton en en-tête
  const probe = h.net.calls.find((c) => c.url.includes("/file/") && c.headers.range === "bytes=0-0");
  assert.ok(probe);
  assert.equal(probe.headers.authorization, `Bearer ${TOKEN}`);

  const r = await h.page({ type: "job.retry", key: data.key });
  assert.equal(r.ok, true);
  await until(() => h.browser.downloadCalls.length === 2);
  assert.equal(h.browser.downloadCalls[1]!.url, h.browser.downloadCalls[0]!.url);
  assert.ok(h.browser.cancelCalls.includes(1), "téléchargement partiel abandonné");
  await until(() => h.job().state === "downloading" && h.job().downloadId === 2);
  assert.equal(h.job().error, undefined);
  h.browser.downloadComplete(2);
  await until(() => h.job().state === "done");
  assert.equal(h.backend.creates.length, 1, "une seule conversion (quota consommé une fois)");
});

test("fichier expiré (410 au sondage) → message clair ; relance = nouvelle conversion avec les mêmes paramètres", async (t) => {
  const h = harness(t);
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp3", bitrate: 320 });
  await until(() => h.job()?.state === "downloading");
  h.backend.fileStatus = 410;
  h.browser.downloadInterrupt(1, "SERVER_FAILED"); // c'est ce que Chrome rapporte pour un HTTP 410
  await until(() => h.job().state === "error");
  assert.deepEqual(h.job().error, { code: "file_expired", message: `Le fichier a expiré sur le serveur${NB}: relance la conversion.`, retryable: true });
  await h.page({ type: "job.retry", key: data.key });
  await until(() => h.backend.creates.length === 2);
  assert.deepEqual(h.backend.creates[1], h.backend.creates[0]);
  assert.deepEqual(h.backend.creates[1], { url: TT_URL, fmt: "mp3", bitrate: 320 });
  h.backend.fileStatus = 206;
  await until(() => h.browser.downloadCalls.length === 2);
  await until(() => h.job().state === "downloading");
  h.browser.downloadComplete(2);
  await until(() => h.job().state === "done");
  assert.equal(h.job().key, data.key, "même entrée dans la liste");
});

test("HTTP 404 sur le fichier (SERVER_BAD_CONTENT) → fichier expiré, sans sondage", async (t) => {
  const h = harness(t);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  const before = h.net.calls.length;
  h.browser.downloadInterrupt(1, "SERVER_BAD_CONTENT");
  await until(() => h.job().state === "error");
  assert.equal(h.job().error.code, "file_expired");
  assert.equal(h.net.calls.length, before);
});

test("interruptions : disque plein, accès refusé (401 → déconnexion), 403 (texte du serveur), annulation dans Chrome", async (t) => {
  const h = harness(t);
  const run = async (reason: string, setup?: () => void) => {
    const n = h.browser.downloadCalls.length;
    const r = await h.page({ type: "job.start", url: `https://www.tiktok.com/@e2e/video/7${String(n).padStart(18, "1")}`, fmt: "mp4" });
    await until(() => h.job(r.data.key)?.state === "downloading");
    setup?.();
    h.browser.downloadInterrupt(h.job(r.data.key).downloadId, reason);
    await until(() => !["downloading"].includes(h.job(r.data.key).state));
    return h.job(r.data.key);
  };
  let j = await run("FILE_NO_SPACE");
  assert.deepEqual(j.error, { code: "disk_full", message: `Espace disque insuffisant${NB}: libère de la place puis relance le téléchargement.`, retryable: true });
  j = await run("USER_CANCELED");
  assert.equal(j.state, "cancelled");
  assert.equal(j.error, undefined);
  j = await run("SERVER_FORBIDDEN", () => { h.backend.fileStatus = 403; });
  assert.deepEqual(j.error, { code: "account_suspended", message: "Ce compte est suspendu.", retryable: false });
  h.backend.fileStatus = 206;
  // 401 confirmé par le compte : l'échec est annoncé (onglet, pages), puis déconnexion → liste vidée.
  const n = h.browser.downloadCalls.length;
  const r = await h.page({ type: "job.start", url: `https://www.tiktok.com/@e2e/video/7${String(n).padStart(18, "1")}`, fmt: "mp4" });
  await until(() => h.job(r.data.key)?.state === "downloading");
  h.backend.valid.clear();
  h.browser.downloadInterrupt(h.job(r.data.key).downloadId, "SERVER_UNAUTHORIZED");
  await until(() => h.browser.pageMessages.some((m: any) => m.type === "job.update" && m.job.key === r.data.key && m.job.state === "error"));
  const failed = h.browser.pageMessages.find((m: any) => m.type === "job.update" && m.job.key === r.data.key && m.job.state === "error");
  assert.equal(failed.job.error.code, "auth_required");
  await until(() => h.browser.jobs.length === 0, 2000, "liste vidée");
  assert.equal(h.browser.auth, undefined, "liaison effacée après le 401 confirmé");
});

test("downloads.download rejeté (« SERVER_FAILED ») → diagnostic par sondage", async (t) => {
  const h = harness(t);
  h.browser.downloadReject = "SERVER_FAILED";
  h.backend.fileStatus = 410;
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "error");
  assert.equal(h.job().error.code, "file_expired");
  h.browser.downloadReject = "Invalid URL";
  await h.page({ type: "job.start", url: YT_URL, fmt: "mp4" });
  await until(() => h.job()?.url === YT_URL && h.job().state === "error");
  assert.deepEqual(h.job().error, { code: "download_refused", message: "Le navigateur a refusé de lancer le téléchargement.", retryable: true });
});

test("petit fichier : « complete » arrivé avant l'enregistrement de l'identifiant → quand même « done »", async (t) => {
  const h = harness(t);
  h.browser.onDownloadCreated = (id) => h.browser.downloadComplete(id, "/tmp/x/Ma vidéo [job_0001].mp4");
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "done");
  assert.equal(h.job().fileName, "Ma vidéo [job_0001].mp4");
});

test("adresse de fichier d'une autre origine ou d'un autre job : refusée, aucun téléchargement (le jeton ne part pas)", async (t) => {
  for (const bad of [
    "https://evil.test/media/jobs/job_0001/file/x.mp4",
    `${API}/jobs/autre_job/file/x.mp4`,
    `${API}/jobs/job_0001/file/x.mp4?token=1`,
    "https://api.test.evil.test/media/jobs/job_0001/file/x.mp4",
    `http://api.test/media/jobs/job_0001/file/x.mp4`,
  ]) {
    const h = harness(t);
    h.backend.onPoll = (job) => json(200, { ...h.backend.body({ ...job, status: "done", stage: "done", progress: 100 }), file_url: bad });
    await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
    await until(() => h.job()?.state === "error", 2000, bad);
    assert.equal(h.job().error.code, "server_error", bad);
    assert.equal(h.browser.downloadCalls.length, 0, bad);
    h.worker.stop();
  }
});

test("annulation pendant la conversion : DELETE envoyé, suivi arrêté", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined); // GET ?wait= en attente
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.jobId === "job_0001");
  const r = await h.page({ type: "job.cancel", key: data.key });
  assert.equal(r.data.state, "cancelled");
  assert.deepEqual(h.backend.deleted, ["job_0001"]);
  const del = h.net.calls.find((c) => c.method === "DELETE")!;
  assert.equal(del.url, `${API}/jobs/job_0001`);
  assert.equal(del.headers.authorization, `Bearer ${TOKEN}`);
  const gets = h.net.calls.length;
  await tick(50);
  assert.equal(h.net.calls.length, gets, "plus de suivi");
  assert.equal(h.job().state, "cancelled");
  await until(() => !h.browser.alarms.has("aethryon-jobs"));
});

test("annulation pendant la création (POST en vol) : le job créé est supprimé dès la réponse", async (t) => {
  const h = harness(t);
  let release!: () => void;
  h.backend.onCreate = () => new Promise<Response>((res) => {
    release = () => res(json(202, { job_id: "job_late01", status: "queued", stage: "queued", progress: 0, file_url: null }));
  });
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => typeof release === "function");
  const r = await h.page({ type: "job.cancel", key: data.key });
  assert.equal(r.data.state, "cancelled");
  release();
  await until(() => h.net.calls.some((c) => c.method === "DELETE" && c.url === `${API}/jobs/job_late01`));
  assert.equal(h.job().state, "cancelled");
});

test("annulation pendant le téléchargement : chrome.downloads.cancel", async (t) => {
  const h = harness(t);
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  const r = await h.page({ type: "job.cancel", key: data.key });
  assert.equal(r.data.state, "cancelled");
  assert.deepEqual(h.browser.cancelCalls, [1]);
  await tick(30);
  assert.equal(h.job().state, "cancelled");
  // relance après annulation : le fichier est encore là → seulement le téléchargement
  await h.page({ type: "job.retry", key: data.key });
  await until(() => h.browser.downloadCalls.length === 2);
  assert.equal(h.backend.creates.length, 1);
});

test("job.dismiss retire le job (et l'annule s'il est actif)", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined);
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.jobId === "job_0001");
  const r = await h.page({ type: "job.dismiss", key: data.key });
  assert.deepEqual(r, { ok: true, data: { key: data.key } });
  assert.equal(h.browser.jobs.length, 0);
  assert.deepEqual(h.backend.deleted, ["job_0001"]);
  const again = await h.page({ type: "job.dismiss", key: data.key });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, "not_found");
});

test("le compte a déjà une conversion en cours (429 active_job_limit) : attente locale puis création", async (t) => {
  const h = harness(t);
  let calls = 0;
  h.backend.onCreate = () => (++calls === 1
    ? json(429, { error: "active_job_limit", detail: "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine." }, { "retry-after": "15" })
    : undefined);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.browser.pageMessages.some((m) => m.job?.stage === "waiting"), 1000, "étape « waiting »");
  await until(() => h.job()?.state === "downloading", 2000);
  assert.equal(calls, 2);
});

test("suivi : 429 avec Retry-After puis reprise ; pannes passagères puis reprise ; pannes durables → erreur réseau relançable", async (t) => {
  const h = harness(t, { timing: { maxPollFailures: 5 } });
  let n = 0;
  h.backend.onPoll = () => {
    n++;
    if (n === 1) return json(429, { error: "rate_limited", detail: "Trop de requêtes, réessayez dans 2 s." }, { "retry-after": "2" });
    if (n === 2) return "network";
    if (n === 3) return json(503, { error: "server_busy", detail: "Serveur occupé." });
    return undefined;
  };
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading", 2000);

  const h2 = harness(t);
  h2.backend.onPoll = () => "network";
  const { data } = await h2.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h2.job()?.state === "error", 2000);
  assert.deepEqual(h2.job().error, {
    code: "network", message: `Impossible de joindre le serveur AETHRYON${NB}: vérifie ta connexion puis réessaie.`, retryable: true,
  });
  h2.backend.onPoll = null;
  await h2.page({ type: "job.retry", key: data.key });
  await until(() => h2.job()?.state === "downloading", 2000);
});

test("réseau coupé à la création → erreur relançable, la relance aboutit", async (t) => {
  const h = harness(t);
  h.backend.onCreate = () => "network";
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "error");
  assert.equal(h.job().error.code, "network");
  h.backend.onCreate = null;
  const r = await h.page({ type: "job.retry", key: data.key });
  assert.equal(r.data.state, "queued");
  await until(() => h.job()?.state === "downloading");
});

test("401 de ytapi : liaison effacée, erreur « auth_required » avec le motif annoncée, liste vidée ; aucun job sans liaison", async (t) => {
  const h = harness(t);
  h.backend.valid.clear(); // clé inconnue côté serveur (le compte répond invalid_token)
  const started = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  const lost = "La connexion de l'extension n'est plus valide. Reconnecte-la pour continuer.";
  await until(() => h.browser.pageMessages.some((m: any) => m.type === "job.update" && m.job.state === "error"));
  assert.deepEqual(h.browser.pageMessages.find((m: any) => m.type === "job.update" && m.job.state === "error").job.error, { code: "auth_required", message: lost, retryable: false });
  await until(() => h.browser.auth === undefined && h.browser.jobs.length === 0);
  const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4" });
  assert.deepEqual(r, { ok: false, error: { code: "auth_required", message: lost, retryable: false } });
  assert.equal(h.browser.jobs.length, 0, "aucun nouveau job");
  // Le job effacé ne peut plus être relancé (la page propose « Se connecter », pas « Réessayer »).
  const retry = await h.page({ type: "job.retry", key: started.data.key });
  assert.equal(retry.error.code, "not_found");
});

test("401 pendant le suivi : liaison effacée ; un 401 pour un ANCIEN jeton n'efface pas une nouvelle liaison", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => {
    h.backend.valid.clear();
    return undefined;
  };
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.browser.pageMessages.some((m: any) => m.type === "job.update" && m.job.state === "error"));
  assert.equal(h.browser.pageMessages.find((m: any) => m.type === "job.update" && m.job.state === "error").job.error.code, "auth_required");
  await until(() => h.browser.auth === undefined && h.browser.jobs.length === 0);

  const h2 = harness(t);
  const fresh = { token: `ytc_${"N".repeat(64)}`, expiresAt: null, email: "a@b.test", name: "A", linkedAt: "2026-10-10T12:00:00.000Z" };
  h2.backend.onCreate = () => {
    h2.browser.store.local.set("auth", fresh); // reconnexion pendant la requête
    return json(401, { error: "unauthorized", detail: "Jeton absent ou invalide." });
  };
  await h2.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h2.job()?.state === "error");
  assert.deepEqual(h2.browser.auth, fresh);
});

test("le jeton n'apparaît dans AUCUNE URL, aucun message, aucun stockage de session", async (t) => {
  const h = harness(t);
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  h.browser.downloadInterrupt(1, "NETWORK_FAILED");
  await until(() => h.job().state === "error");
  await h.page({ type: "job.retry", key: data.key });
  await until(() => h.browser.downloadCalls.length === 2);
  h.browser.downloadComplete(2);
  await until(() => h.job().state === "done");
  await h.content({ type: "job.start", url: "https://www.tiktok.com/@e2e/video/7999999999999999999", fmt: "mp3" });
  await until(() => h.browser.tabMessages.length > 0);
  assert.ok(h.net.calls.length >= 5);
  for (const s of h.leaks()) assert.ok(!s.includes(TOKEN) && !s.includes(TOKEN.slice(4, 24)), s.slice(0, 120));
  for (const c of h.net.calls) assert.ok(!/token=|ytc_/.test(c.url), c.url);
  // le jeton n'est QUE dans l'en-tête Authorization (fetch) et dans les en-têtes du téléchargement
  for (const c of h.net.calls) {
    const where = Object.entries(c.headers).filter(([, v]) => v.includes(TOKEN)).map(([k]) => k);
    assert.ok(where.length === 0 || (where.length === 1 && where[0] === "authorization"));
    assert.ok(!(c.body ?? "").includes(TOKEN));
    assert.equal(c.init.credentials, "omit");
    assert.equal(c.init.redirect, "manual");
  }
});

test("serveur qui ignorerait ?wait= : suivis espacés d'au moins minPollIntervalMs (pas de rafale)", async (t) => {
  const h = harness(t, { timing: { minPollIntervalMs: 40 } });
  const at: number[] = [];
  h.backend.onPoll = (job) => {
    at.push(Date.now());
    return json(200, h.backend.body({ ...job, status: "running", stage: "converting", progress: 5 }));
  };
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => at.length >= 4, 3000);
  const gaps = at.slice(1).map((x, i) => x - at[i]!);
  assert.ok(gaps.every((g) => g >= 38), `écarts : ${gaps.join(", ")} ms`);
});
