// Liaison qui tombe pendant que des pages sont ouvertes : annonce en direct (auth.changed) avec le MOTIF
// (révoquée par toi, par un administrateur, par sécurité, expirée après 30 jours, déconnexion), liste des
// téléchargements et état du compte effacés à la déconnexion comme à la révocation ; fichier en cours
// d'écriture laissé au navigateur puis retiré ; service du compte en panne : état dégradé, jamais « Connecté ».
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL, YT_URL } from "./fakes/harness.ts";
import { until } from "./fakes/chrome.ts";
import { TOKEN } from "./fakes/backend.ts";

const NB = " ";
const LOST = {
  revoked_user: `Cette extension a été déconnectée de ton compte depuis «${NB}Mes jetons${NB}». Reconnecte-la pour continuer.`,
  revoked_admin: "Un administrateur AETHRYON a révoqué l'accès de cette extension. Reconnecte-la pour continuer.",
  revoked_replay: `Accès révoqué par sécurité${NB}: un code de connexion a été réutilisé. Reconnecte l'extension pour continuer.`,
  expired: `Connexion expirée (30 jours)${NB}: reconnecte-toi.`,
};
const events = (h: any, type: string) => h.browser.pageMessages.filter((m: any) => m.type === type);

test("révocation vue par /me (popup ou réglages ouverts) : annonce auth.changed avec le motif exact, pour chaque motif", async (t) => {
  for (const [by, reason] of [["user", "revoked_user"], ["admin", "revoked_admin"], ["replay", "revoked_replay"]] as const) {
    const h = harness(t);
    h.backend.valid.delete(TOKEN);
    h.backend.revokedBy.set(TOKEN, by);
    await h.page({ type: "account.refresh" });
    assert.deepEqual(events(h, "auth.changed"), [{ type: "auth.changed", connected: false, reason, message: LOST[reason] }], by);
  }
  const h = harness(t);
  h.backend.valid.delete(TOKEN);
  h.backend.expired.add(TOKEN);
  await h.page({ type: "account.refresh" });
  assert.deepEqual(events(h, "auth.changed"), [{ type: "auth.changed", connected: false, reason: "expired", message: LOST.expired }]);
});

test("expiration après 30 jours (vue localement) : « Connexion expirée (30 jours) : reconnecte-toi. » partout, annoncée une fois", async (t) => {
  const h = harness(t);
  h.browser.store.local.set("auth", { ...h.browser.auth, expiresAt: "2020-01-01T00:00:00.000Z" });
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.account.connected, init.data.account.notice.reason, init.data.account.notice.message], [false, "expired", LOST.expired]);
  const content = await h.content({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.deepEqual(content.error, { code: "auth_required", message: LOST.expired, retryable: false }, "le bouton de la page dit la même chose");
  assert.equal(events(h, "auth.changed").length, 1);
  assert.equal(events(h, "auth.changed")[0].reason, "expired");
});

test("révocation pendant des conversions : chaque job en cours annoncé en échec avec le motif, liste vidée, état du compte effacé", async (t) => {
  const h = harness(t);
  await h.page({ type: "account.refresh" });
  assert.ok(h.browser.store.local.get("accountCache"));
  h.backend.onPoll = () => new Promise(() => undefined); // conversions qui ne finissent pas
  const a = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  const b = await h.page({ type: "job.start", url: YT_URL, fmt: "mp3" });
  await until(() => h.browser.jobs.every((j: any) => j.jobId));
  h.backend.valid.delete(TOKEN);
  h.backend.revokedBy.set(TOKEN, "admin");
  await h.page({ type: "account.refresh" });
  for (const key of [a.data.key, b.data.key]) {
    const last = h.browser.pageMessages.filter((m: any) => m.type === "job.update" && m.job.key === key).at(-1);
    assert.deepEqual([last.job.state, last.job.error.code, last.job.error.message], ["error", "auth_required", LOST.revoked_admin], key);
  }
  assert.deepEqual(h.browser.jobs, [], "liste effacée");
  assert.equal(h.browser.store.local.get("accountCache"), undefined, "état du compte effacé");
  assert.equal(h.browser.store.local.get("auth"), undefined);
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.jobs, init.data.account.connected, init.data.account.notice.reason], [[], false, "revoked_admin"]);
});

test("déconnexion : terminés, échecs et annulés effacés ; fichier en cours d'écriture laissé au navigateur, retiré quand il se termine", async (t) => {
  const h = harness(t);
  // un job terminé
  const done = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job(done.data.key)?.state === "downloading");
  h.browser.downloadComplete(h.job(done.data.key).downloadId);
  await until(() => h.job(done.data.key)?.state === "done");
  // un job dont le navigateur écrit encore le fichier
  const writing = await h.page({ type: "job.start", url: YT_URL, fmt: "mp3" });
  await until(() => h.job(writing.data.key)?.state === "downloading");
  const id = h.job(writing.data.key).downloadId;
  const r = await h.page({ type: "auth.logout" });
  assert.equal(r.ok, true);
  assert.deepEqual(h.browser.jobs.map((j: any) => [j.key, j.state]), [[writing.data.key, "downloading"]], "seul le fichier en cours reste, le temps de finir");
  assert.equal(h.browser.cancelCalls.includes(id), false, "le fichier déjà converti n'est pas interrompu");
  h.browser.downloadComplete(id, "/home/u/Téléchargements/Son [x].mp3");
  await until(() => h.browser.jobs.length === 0, 2000, "retiré dès la fin");
  const final = h.browser.pageMessages.filter((m: any) => m.type === "job.update" && m.job.key === writing.data.key).at(-1);
  assert.equal(final.job.state, "done", "l'état final réel est annoncé à l'onglet avant le retrait");
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual(init.data.jobs, []);
  assert.deepEqual(init.data.account, { connected: false }, "aucun motif après une déconnexion voulue");
  assert.deepEqual(events(h, "auth.changed").at(-1), { type: "auth.changed", connected: false, reason: "signed_out" });
});

test("service du compte en panne : popup.init rend un état dégradé (motif + statut), la liaison est gardée", async (t) => {
  const cases: [number, any][] = [[0, { reason: "network" }], [404, { reason: "missing", status: 404 }], [500, { reason: "unavailable", status: 500 }], [429, { reason: "unavailable", status: 429 }]];
  for (const [status, degraded] of cases) {
    const h = harness(t);
    h.backend.meStatus = status;
    const init = await h.page({ type: "popup.init" });
    assert.equal(init.data.account.connected, true, String(status));
    assert.deepEqual(init.data.account.degraded, degraded, String(status));
    assert.equal(init.data.account.today, undefined, "aucun quota inventé sans état connu");
    assert.equal(h.browser.auth.token, TOKEN, "liaison gardée");
    assert.equal(events(h, "auth.changed").length, 0, "pas de déconnexion annoncée");
  }
  // réponse 200 illisible : dégradé « unexpected »
  const h = harness(t);
  h.backend.me = { user: "x" };
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual(init.data.account.degraded, { reason: "unexpected", status: 200 });
});
