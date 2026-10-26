// Notice sur les données (src/shared/consent.ts) : contenu fidèle au code, typographie, et accord EXIGÉ avant
// toute connexion, tout téléchargement et toute requête vers un serveur (service worker).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSENTED, harness, TT_URL } from "./fakes/harness.ts";
import { EXT_ID, until } from "./fakes/chrome.ts";
import { SITE } from "./fakes/backend.ts";
import { CONSENT_VERSION, DISCLOSURE, RIGHTS_NOTICE, isAccepted } from "../../src/shared/consent.ts";

const NB = "\u00a0";
const all = () => [...DISCLOSURE.flatMap((d) => [d.title, d.text]), RIGHTS_NOTICE];

test("notice : chaque donnée gardée ou envoyée par le code est nommée (et rien d'inventé)", () => {
  const text = DISCLOSURE.map((d) => `${d.title} ${d.text}`).join(" ");
  for (const part of [
    // storage.local (src/shared/storage.ts, consent.ts, background/store.ts, update.ts)
    "jeton ytc_", "adresse e-mail et le nom de ton compte", "date d'expiration", "dernier état connu de ton compte",
    "motif d'une éventuelle déconnexion", "ton accord à cette notice", "vérification de mise à jour",
    // connexion (background/auth.ts : appareil, code + PKCE ; /me ; /logout ; sonde de la page)
    "le nom de l'appareil", `Chrome · Windows`, "code de connexion à usage unique", "PKCE", "révocation de la clé",
    "vérifie seulement si la page du site répond",
    // conversion (background/jobs.ts : requestBody = url, fmt, quality | bitrate, index ; suivi, DELETE, fichier)
    "lien canonique de la vidéo", "le format (MP4 ou MP3)", "la qualité ou le débit", "pour X le numéro de la vidéo",
    "annulation", "requête d'un octet", "en-tête des requêtes, jamais dans une adresse",
    // lu localement (content scripts, popup)
    "titre de la vidéo", "miniature", "serveurs d'images des plateformes",
    // storage.session (setJobs : 30 plus récents)
    "30 téléchargements les plus récents", "effacée à sa fermeture et à la déconnexion",
    // storage.sync
    "stockage synchronisé de Chrome",
    // latest.json (background/update.ts)
    "12 heures", "latest.json", "ne télécharge et n'installe jamais rien",
    // jamais
    "Aucun historique de navigation collecté", "aucun cookie lu", "aucune publicité", "aucune revente", "adresse IP",
  ]) {
    assert.ok(text.replace(/ /g, " ").includes(part.replace(/ /g, " ")), `la notice doit dire : ${part}`);
  }
  // Le titre de la page n'est PAS envoyé au serveur : la notice ne doit jamais le prétendre.
  assert.doesNotMatch(DISCLOSURE.find((d) => d.id === "conversion")!.text, /titre/);
  assert.equal(RIGHTS_NOTICE, `Convertis seulement des contenus pour lesquels tu disposes des droits nécessaires${NB}; l'installation hors store ne change rien aux conditions de YouTube, TikTok et X.`);
});

test("notice : typographie française (insécable avant : ; ! ? et dans « »)", () => {
  for (const s of all()) {
    assert.doesNotMatch(s, / [:;!?»]/, `espace ordinaire avant un signe double : ${s}`);
    for (const m of s.matchAll(/[;!?»]|(?<!\/)(?<!\d):(?!\/)/g)) assert.equal(s[m.index! - 1], NB, `insécable attendue avant « ${m[0]} » : ${s}`);
    for (const m of s.matchAll(/«/g)) assert.equal(s[m.index! + 1], NB, `insécable attendue après « : ${s}`);
  }
});

test("accord : version exacte de la notice exigée", () => {
  assert.equal(isAccepted({ version: CONSENT_VERSION, at: "2026-10-11T08:00:00.000Z" }), true);
  for (const bad of [null, {}, { version: CONSENT_VERSION }, { version: CONSENT_VERSION - 1, at: "2026-10-11T08:00:00.000Z" }, { version: String(CONSENT_VERSION), at: "x" }, "oui"]) {
    assert.equal(isAccepted(bad), false, JSON.stringify(bad));
  }
});

test("sans accord : connexion et téléchargement refusés, popup.init et account.refresh SANS aucune requête", async (t) => {
  const h = harness(t, { consent: false, updateDue: true });
  h.browser.authFlow = (url) => h.backend.authorize(url);
  const msg = `Avant la première connexion, lis la notice sur les données et accepte-la.`;
  assert.deepEqual(await h.page({ type: "auth.login" }), { ok: false, error: { code: "consent_required", message: msg, retryable: false } });
  assert.equal(h.browser.authFlows.length, 0, "aucune fenêtre de connexion");
  const content = await h.content({ type: "auth.login" });
  assert.equal(content.error.code, "consent_required");
  const j = await h.content({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.deepEqual(j.error, { code: "consent_required", message: msg, retryable: false });
  assert.equal(h.browser.jobs.length, 0);
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual(init.data.consent, { accepted: false, version: CONSENT_VERSION });
  assert.equal(init.data.account.connected, true, "liaison existante gardée (lue localement)");
  assert.equal(init.data.update, null);
  const acc = await h.page({ type: "account.refresh" });
  assert.equal(acc.ok, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(h.net.calls.map((c) => c.url), [], "aucune requête vers un serveur avant l'accord (ni compte, ni ytapi, ni latest.json)");
});

test("accord donné : version vérifiée, enregistré (version + date), puis connexion possible ; vérification de mise à jour lancée", async (t) => {
  const h = harness(t, { consent: false, linked: false, updateDue: true });
  h.browser.authFlow = (url) => h.backend.authorize(url);
  const old = await h.page({ type: "consent.accept", version: CONSENT_VERSION + 1 });
  assert.equal(old.error.code, "consent_outdated");
  assert.equal(h.browser.store.local.get("consent"), undefined);
  const r = await h.page({ type: "consent.accept", version: CONSENT_VERSION });
  assert.equal(r.ok, true);
  assert.equal(r.data.accepted, true);
  const stored = h.browser.store.local.get("consent") as any;
  assert.equal(stored.version, CONSENT_VERSION);
  assert.ok(Number.isFinite(Date.parse(stored.at)));
  await until(() => h.net.calls.some((c) => c.url === `${SITE}/downloads/extension/latest.json`), 2000, "première vérification de mise à jour");
  const login = await h.page({ type: "auth.login" });
  assert.equal(login.ok, true);
  assert.equal(h.browser.authFlows.length, 1);
  assert.ok(h.browser.pageMessages.some((m: any) => m.type === "auth.changed" && m.connected === true && m.reason === "linked"));
});

test("accord retiré : déconnexion (clé révoquée), accord et état de mise à jour effacés, annonce « withdrawn »", async (t) => {
  const h = harness(t);
  const r = await h.page({ type: "consent.withdraw" });
  assert.deepEqual(r, { ok: true, data: { accepted: false, version: CONSENT_VERSION } });
  assert.equal(h.backend.logouts, 1, "clé révoquée sur le serveur");
  assert.equal(h.browser.auth, undefined);
  assert.equal(h.browser.store.local.get("consent"), undefined);
  assert.equal(h.browser.store.local.get("update"), undefined);
  assert.deepEqual(h.browser.pageMessages.at(-1), { type: "auth.changed", connected: false, reason: "withdrawn" });
  const j = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.equal(j.error.code, "consent_required");
});

test("premier lancement : la page d'accueil s'ouvre (installation), pas à une mise à jour ; alarme de mise à jour posée", async (t) => {
  const h = harness(t, { consent: false, linked: false });
  h.browser.fireInstalled("install");
  await until(() => h.browser.createdTabs.length === 1);
  assert.deepEqual(h.browser.createdTabs, [`chrome-extension://${EXT_ID}/welcome/welcome.html`]);
  await until(() => h.browser.alarms.has("aethryon-update"));
  assert.equal(h.browser.alarms.get("aethryon-update")!.periodInMinutes, 720);
  const g = harness(t, { consent: false, linked: false });
  g.browser.fireInstalled("update");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(g.browser.createdTabs, [], "mise à jour : aucune page ouverte");
  void CONSENTED;
});

test("mise à jour : accord donné à une notice plus ancienne → à relire (dit comme tel), liaison gardée, AUCUNE requête avant le nouvel accord", async (t) => {
  const h = harness(t, { consent: false, updateDue: true });
  h.browser.store.local.set("consent", { version: CONSENT_VERSION - 1, at: "2026-10-11T08:00:00.000Z" });
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual(init.data.consent, { accepted: false, version: CONSENT_VERSION, outdated: true });
  assert.equal(init.data.account.connected, true, "liaison gardée (lue localement)");
  const changed = "La notice sur les données a changé avec la mise à jour : relis-la et accepte-la pour continuer.";
  for (const msg of [{ type: "job.start", url: TT_URL, fmt: "mp4" }, { type: "auth.login" }]) {
    const r = await h.content(msg);
    assert.deepEqual(r.error, { code: "consent_required", message: changed, retryable: false }, msg.type);
  }
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(h.net.calls.map((c) => c.url), [], "aucune requête avant le nouvel accord");
  const ok = await h.page({ type: "consent.accept", version: CONSENT_VERSION });
  assert.equal(ok.data.accepted, true);
  const after = await h.page({ type: "popup.init" });
  assert.equal(after.data.consent.accepted, true);
  assert.equal(after.data.consent.outdated, undefined);
  // Accord jamais donné : la phrase de la première connexion, sans « outdated ».
  const g = harness(t, { consent: false });
  assert.deepEqual((await g.page({ type: "popup.init" })).data.consent, { accepted: false, version: CONSENT_VERSION });
  assert.equal((await g.content({ type: "job.start", url: TT_URL, fmt: "mp4" })).error.message, "Avant la première connexion, lis la notice sur les données et accepte-la.");
});
