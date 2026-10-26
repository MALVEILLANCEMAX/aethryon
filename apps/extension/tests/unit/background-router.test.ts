// Service worker : qui peut demander quoi (expéditeurs), revalidation des URL, popup.init, notifications.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL, YT_URL } from "./fakes/harness.ts";
import { EXT_ID, tick, until } from "./fakes/chrome.ts";
import { TOKEN } from "./fakes/backend.ts";
import { classifySender } from "../../src/background/worker.ts";

const NB = " ";
const YT_PAGE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

test("expéditeurs refusés en silence : site non pris en charge, http, sous-cadre, origine incohérente, autre extension", async (t) => {
  const h = harness(t);
  const start = { type: "job.start", url: YT_URL, fmt: "mp4" };
  for (const sender of [
    h.browser.contentSender("https://evil.test/watch?v=dQw4w9WgXcQ"),
    h.browser.contentSender("https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ"),
    h.browser.contentSender("http://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    h.browser.contentSender(YT_PAGE, 7, { frameId: 3 }),
    h.browser.contentSender(YT_PAGE, 7, { origin: "https://evil.test" }),
    h.browser.contentSender(YT_PAGE, 7, { id: "abcdefghijklmnopabcdefghijklmnop" }),
    { id: EXT_ID, url: YT_PAGE }, // sans onglet
    { id: "abcdefghijklmnopabcdefghijklmnop", url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html" },
  ] as chrome.runtime.MessageSender[]) {
    assert.equal(await h.browser.send(start, sender), undefined, JSON.stringify(sender));
  }
  assert.equal(h.browser.jobs.length, 0);
  assert.equal(h.net.calls.length, 0);
});

test("content script : job.start/retry/cancel, jobs.list, auth.login (réponse réduite) et welcome.open ; jamais auth.logout, popup.init, account.refresh, job.dismiss, consent.*, update.dismiss", async (t) => {
  const h = harness(t, { linked: false });
  h.browser.authFlow = (url) => h.backend.authorize(url);
  const yt = h.browser.contentSender(YT_PAGE);
  for (const msg of [
    { type: "auth.logout" }, { type: "popup.init" }, { type: "account.refresh" }, { type: "job.dismiss", key: "abcdefgh12" },
    { type: "consent.accept", version: 1 }, { type: "consent.withdraw" }, { type: "update.dismiss", version: "9.9.9" },
  ]) {
    assert.equal(await h.browser.send(msg, yt), undefined, msg.type);
  }
  assert.equal(h.browser.authFlows.length, 0, "aucune fenêtre de connexion ouverte par ces messages");
  assert.deepEqual(await h.browser.send({ type: "jobs.list" }, yt), { ok: true, data: [] });
  // « Se connecter à AETHRYON » dans la page : VRAIE connexion (fenêtre, PKCE), mais la page n'apprend que « connecté ».
  const login = await h.browser.send({ type: "auth.login" }, yt);
  assert.deepEqual(login, { ok: true, data: { connected: true } });
  assert.equal(h.browser.authFlows.length, 1);
  assert.equal(h.browser.auth.token, TOKEN);
  assert.ok(!JSON.stringify(login).includes("alice"), "ni e-mail ni nom transmis à la page");
  // « Lire la notice » : la page d'accueil s'ouvre sur la notice (une fois par geste : doublons ignorés).
  assert.deepEqual(await h.browser.send({ type: "welcome.open", section: "donnees" }, yt), { ok: true, data: { opened: true } });
  assert.deepEqual(await h.browser.send({ type: "welcome.open", section: "donnees" }, yt), { ok: true, data: { opened: false } });
  assert.deepEqual(h.browser.createdTabs, [`chrome-extension://${EXT_ID}/welcome/welcome.html#donnees`]);
  // messages mal formés : rejet silencieux, même d'une page de l'extension
  for (const bad of [null, "auth.login", { type: "auth.login", token: "x" }, { type: "job.start", url: YT_URL, fmt: "gif" }, { type: "eval" },
    { type: "welcome.open", section: "ailleurs" }, { type: "consent.accept", version: "1" }, { type: "update.dismiss", version: "x" }]) {
    assert.equal(await h.page(bad), undefined, JSON.stringify(bad));
  }
  // la page de réglages s'ouvre DANS UN ONGLET (options_ui.open_in_tab) : c'est une page de l'extension
  const r = await h.browser.send({ type: "auth.login" }, h.browser.pageInTabSender());
  assert.equal(r.ok, true);
  assert.equal(r.data.email, "alice@example.test", "une page de l'extension reçoit la vue du compte");
  assert.deepEqual(classifySender(h.browser.pageInTabSender(), EXT_ID), { kind: "page" });
  assert.deepEqual(classifySender(h.browser.pageInTabSender("welcome/welcome.html"), EXT_ID), { kind: "page" });
  assert.deepEqual(classifySender(h.browser.contentSender("https://m.youtube.com/watch?v=dQw4w9WgXcQ", 9), EXT_ID), { kind: "content", tabId: 9, platform: "youtube" });
});

test("URL revalidée dans le worker : lien malveillant ou d'une autre plateforme refusé, sans aucune requête", async (t) => {
  const h = harness(t);
  for (const url of [
    "https://evil.test/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)//https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/playlist?list=PL123",
    "file:///etc/passwd",
  ]) {
    const r = await h.content({ type: "job.start", url, fmt: "mp4" }, YT_PAGE);
    assert.deepEqual(r, { ok: false, error: { code: "unsupported_url", message: `Ce lien n'est pas pris en charge${NB}: ouvre une vidéo YouTube, TikTok ou X.`, retryable: false } }, url);
  }
  // un content script YouTube ne peut pas faire télécharger une vidéo TikTok
  const r = await h.content({ type: "job.start", url: TT_URL, fmt: "mp4" }, YT_PAGE);
  assert.equal(r.error.code, "unsupported_url");
  assert.equal(r.error.message, `Ce lien ne correspond pas à la page ouverte${NB}: relance le téléchargement depuis la vidéo.`);
  assert.equal(h.net.calls.length, 0);
  assert.equal(h.browser.jobs.length, 0);
});

test("content script : ne voit et ne pilote que les jobs de SON onglet ; reçoit leur progression (cadre principal)", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => new Promise(() => undefined);
  const a = await h.content({ type: "job.start", url: YT_URL, fmt: "mp4" }, YT_PAGE, 7);
  assert.equal(a.ok, true);
  assert.equal(a.data.tabId, 7);
  await until(() => h.browser.tabMessages.some((m) => m.tabId === 7 && m.msg.type === "job.update"));
  const m = h.browser.tabMessages.find((x) => x.tabId === 7)!;
  assert.deepEqual(m.options, { frameId: 0 });
  assert.ok(!("fileUrl" in m.msg.job));
  assert.equal((await h.content({ type: "jobs.list" }, YT_PAGE, 7)).data.length, 1);
  assert.equal((await h.content({ type: "jobs.list" }, YT_PAGE, 8)).data.length, 0);
  const foreign = await h.content({ type: "job.cancel", key: a.data.key }, YT_PAGE, 8);
  assert.equal(foreign.error.code, "not_found");
  const own = await h.content({ type: "job.cancel", key: a.data.key }, YT_PAGE, 7);
  assert.equal(own.data.state, "cancelled");
  assert.equal((await h.page({ type: "jobs.list" })).data.length, 1, "les pages voient tout");
});

test("popup.init : vidéo détectée revalidée, jobs du plus récent au plus ancien, réglages, version, compte", async (t) => {
  const h = harness(t);
  h.browser.tabResponder = (tabId, msg) => (msg.type === "detect.request" && tabId === 7
    ? {
      media: {
        platform: "tiktok", kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", id: "ignored",
        title: "  Never\u0000 gonna‮ ", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", videoCount: 3, extra: "x",
      },
      hint: null,
    }
    : undefined);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await tick(5);
  await h.page({ type: "job.start", url: "https://www.tiktok.com/@e2e/video/7000000000000000001", fmt: "mp3" });
  const r = await h.page({ type: "popup.init" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.detected, {
    platform: "youtube", kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ",
    title: "Never gonna", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  });
  assert.equal(r.data.pageHint, null);
  assert.deepEqual(r.data.jobs.map((j: any) => j.fmt), ["mp3", "mp4"]);
  assert.equal(r.data.settings.defaultFmt, "mp4");
  assert.equal(r.data.version, "1.0.0");
  assert.equal(r.data.account.connected, true);
  assert.equal(r.data.account.today.remaining, 7);
  assert.deepEqual(r.data.consent, { accepted: true, version: 2, at: "2026-10-11T08:00:00.000Z" });
  assert.equal(r.data.update, null);
  const ask = h.browser.tabMessages.find((m) => m.msg.type === "detect.request")!;
  assert.deepEqual(ask, { tabId: 7, msg: { type: "detect.request" }, options: { frameId: 0 } });

  // lancé depuis le popup pour la vidéo détectée : le bouton de la page suit aussi la progression
  const s = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4" });
  assert.equal(s.data.tabId, 7);
});

test("popup.init : pas de content script, réponse trop lente, réponse invalide, page sans vidéo (indice du content script)", async (t) => {
  const h = harness(t);
  const hint = `Ouvre une vidéo YouTube, TikTok ou X pour la télécharger. Si elle est déjà ouverte, recharge la page.`;
  h.browser.tabResponder = () => undefined; // aucun content script dans l'onglet
  let r = await h.page({ type: "popup.init" });
  assert.equal(r.data.detected, null);
  assert.equal(r.data.pageHint, hint);

  h.browser.tabResponder = () => new Promise(() => undefined); // ne répond jamais
  const t0 = Date.now();
  r = await h.page({ type: "popup.init" });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.data.detected, null);
  assert.equal(r.data.pageHint, hint);

  h.browser.tabResponder = () => ({ media: { url: "https://evil.test/v/1", thumbnail: "javascript:alert(1)" }, hint: 42 });
  r = await h.page({ type: "popup.init" });
  assert.equal(r.data.detected, null);
  assert.equal(r.data.pageHint, hint);

  h.browser.tabResponder = () => ({ media: null, hint: "Fil X : utilise le bouton sous la publication." });
  r = await h.page({ type: "popup.init" });
  assert.equal(r.data.pageHint, `Fil X${NB}: utilise le bouton sous la publication.`);

  h.browser.activeTab = null;
  r = await h.page({ type: "popup.init" });
  assert.equal(r.data.pageHint, hint);

  h.backend.valid.clear();
  r = await h.page({ type: "popup.init" });
  assert.equal(r.data.account.connected, false, "jeton refusé → déconnecté");
  assert.deepEqual([r.data.account.notice.reason, r.data.account.notice.message], ["invalid", "La connexion de l'extension n'est plus valide. Reconnecte-la pour continuer."], "avec le motif");
});

test("notifications : seulement si l'option est activée ET la permission accordée ; jamais demandée par le worker", async (t) => {
  const run = async (enabled: boolean, granted: boolean, fail = false) => {
    const h = harness(t);
    h.browser.store.sync.set("settings", { notifications: enabled });
    if (granted) h.browser.grantNotifications();
    if (fail) h.backend.script = [{ status: "error", stage: "error", error: "private", detail: "La vidéo est privée." }];
    const { data } = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
    if (!fail) {
      await until(() => h.job()?.state === "downloading");
      h.browser.downloadComplete(1);
    }
    await until(() => ["done", "error"].includes(h.job(data.key).state));
    await tick(20);
    h.worker.stop();
    return h.browser.notifications;
  };
  assert.deepEqual(await run(false, true), []);
  assert.deepEqual(await run(true, false), []);
  const done = await run(true, true);
  assert.equal(done.length, 1);
  assert.equal(done[0]!.options.message, `Téléchargement terminé${NB}: Ma vidéo`);
  assert.equal(done[0]!.options.type, "basic");
  assert.equal(done[0]!.options.iconUrl, `chrome-extension://${EXT_ID}/assets/icons/icon-128.png`);
  const failed = await run(true, true, true);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.options.title, `AETHRYON${NB}: échec du téléchargement`);
  assert.match(failed[0]!.options.message, /La vidéo est privée\./);
});
