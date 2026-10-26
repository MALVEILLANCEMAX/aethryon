// Service worker : reprise après un arrêt (le worker MV3 est arrêté après ~30 s d'inactivité) — état
// relu dans storage.session, suivi relancé, téléchargements rattachés, alarme de 30 s.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL } from "./fakes/harness.ts";
import { tick, until } from "./fakes/chrome.ts";
import { API } from "./fakes/backend.ts";
import { json } from "./fakes/fetch.ts";

const NB = " ";

test("arrêt pendant la conversion : le nouveau worker reprend le suivi du même job (pas de nouvelle conversion)", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined); // suivi en attente au moment de l'arrêt
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.jobId === "job_0001" && h.net.calls.some((c) => c.url.includes("/jobs/job_0001?wait=")));
  const before = h.job();
  h.restart(); // mémoire perdue ; storage.session, téléchargements et alarmes conservés
  h.backend.onPoll = null;
  await until(() => h.browser.downloadCalls.length === 1, 2000, "téléchargement relancé par le nouveau worker");
  await until(() => h.job()?.state === "downloading");
  h.browser.downloadComplete(1); // événement reçu par le NOUVEAU worker
  await until(() => h.job()?.state === "done");
  assert.equal(h.job().key, data.key);
  assert.equal(h.job().createdAt, before.createdAt);
  assert.equal(h.backend.creates.length, 1);
});

test("arrêt pendant le téléchargement : rattachement par downloadId, progression puis « done » à l'événement", async (t) => {
  const h = harness(t);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  h.restart();
  h.browser.downloadProgress(1, 250, 1000);
  await until(() => h.job().progress === 25, 1000, "progression lue par le nouveau worker");
  assert.equal(h.browser.downloadCalls.length, 1, "pas de second téléchargement");
  h.browser.downloadComplete(1);
  await until(() => h.job().state === "done");
});

test("téléchargement terminé ou interrompu pendant que le worker était arrêté : état confirmé par Chrome au redémarrage", async (t) => {
  const h = harness(t);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await h.page({ type: "job.start", url: "https://www.tiktok.com/@e2e/video/7000000000000000002", fmt: "mp4" });
  await until(() => h.browser.jobs.filter((j: any) => j.state === "downloading").length === 2, 3000);
  h.worker.stop();
  h.browser.downloadComplete(1); // personne n'écoute : le worker est arrêté
  h.browser.downloadInterrupt(2, "FILE_NO_SPACE");
  await tick(20);
  assert.ok(h.browser.jobs.every((j: any) => j.state === "downloading"));
  h.restart();
  await until(() => h.browser.jobs.every((j: any) => j.state !== "downloading"));
  const byDl = Object.fromEntries(h.browser.jobs.map((j: any) => [j.downloadId, j]));
  assert.equal(byDl[1].state, "done");
  assert.equal(byDl[2].error.code, "disk_full");
});

test("téléchargement disparu de la liste du navigateur → erreur relançable", async (t) => {
  const h = harness(t);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  h.worker.stop();
  h.browser.downloads.delete(1);
  h.restart();
  await until(() => h.job()?.state === "error");
  assert.deepEqual(h.job().error, { code: "download_missing", message: `Le téléchargement n'apparaît plus dans le navigateur${NB}: relance-le.`, retryable: true });
});

test("job expiré sur le serveur pendant l'arrêt (404 job_not_found) → « La conversion a expiré : relance-la. »", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.jobId === "job_0001");
  h.restart();
  h.backend.jobs.clear(); // ytapi redémarré / TTL dépassé
  h.backend.onPoll = null;
  await until(() => h.job()?.state === "error");
  assert.deepEqual(h.job().error, { code: "job_not_found", message: `La conversion a expiré${NB}: relance-la.`, retryable: true });
});

test("création interrompue par l'arrêt (job sans identifiant) : renvoyée au redémarrage", async (t) => {
  const h = harness(t);
  h.backend.onCreate = () => new Promise(() => undefined); // le worker meurt avant la réponse
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.backend.creates.length === 1);
  h.restart();
  h.backend.onCreate = null;
  await until(() => h.job()?.state === "downloading", 2000);
  assert.equal(h.backend.creates.length, 2);
});

test("alarme « aethryon-jobs » et onStartup : reprise idempotente (un seul suivi par job), alarme retirée à la fin", async (t) => {
  const h = harness(t);
  let polls = 0;
  let open = 0;
  let maxOpen = 0;
  const releases: (() => void)[] = [];
  h.backend.onPoll = (job) => {
    polls++;
    open++;
    maxOpen = Math.max(maxOpen, open);
    return new Promise((res) => releases.push(() => {
      open--;
      res(json(200, h.backend.body({ ...job, status: "running", stage: "converting", progress: 10 * polls })));
    }));
  };
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => polls === 1);
  assert.ok(h.browser.alarms.has("aethryon-jobs"));
  h.browser.fireAlarm("aethryon-jobs");
  h.browser.fireStartup();
  h.browser.fireAlarm("aethryon-jobs");
  await tick(30);
  assert.equal(polls, 1, "pas de second suivi concurrent");
  // chaque réponse du suivi est écrite (vrai travail) puis la longue attente suivante démarre
  const writes = h.browser.pageMessages.length;
  releases.shift()!();
  await until(() => polls === 2);
  assert.ok(h.browser.pageMessages.length > writes);
  assert.equal(h.job().progress, 10);
  assert.equal(maxOpen, 1);
  h.backend.onPoll = null;
  releases.shift()!();
  await until(() => h.job()?.state === "downloading");
  h.browser.downloadComplete(1);
  await until(() => !h.browser.alarms.has("aethryon-jobs"), 1000, "alarme retirée");
  h.browser.fireAlarm("aethryon-jobs"); // alarme fantôme : sans effet
  void API;
});

test("module du service worker rechargé (index.ts, délais de production) : reprise depuis storage.session", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined);
  const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.jobId === "job_0001");
  h.worker.stop();
  h.browser.restartWorker(); // nouvel objet chrome : les écouteurs de l'ancien worker sont perdus
  h.backend.onPoll = null;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = h.net.fetch;
  t.after(() => { globalThis.fetch = savedFetch; });
  // Nouvelle instance du module d'entrée : installe ses écouteurs et reprend, comme au réveil du worker.
  await import(`../../src/background/index.ts?restart=${Date.now()}`);
  await until(() => h.browser.downloadCalls.length === 1, 3000, "téléchargement relancé par le module rechargé");
  await until(() => h.job()?.state === "downloading");
  h.browser.downloadComplete(1);
  await until(() => h.job()?.state === "done");
  assert.equal(h.job().key, data.key);
  assert.equal(h.backend.creates.length, 1);
  const poll = h.net.calls.filter((c) => c.method === "GET" && c.url.startsWith(`${API}/jobs/job_0001?wait=`)).at(-1)!;
  assert.equal(poll.url, `${API}/jobs/job_0001?wait=20`, "attente longue de production");
});
