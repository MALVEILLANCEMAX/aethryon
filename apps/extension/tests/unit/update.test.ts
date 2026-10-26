// Avis de nouvelle version (src/background/update.ts) : comparaison de versions, schéma exact de latest.json,
// au plus une requête par 12 h (même en échec), échecs silencieux, avis masquable par version, rien avant
// l'accord à la notice ; et dans le service worker : démarrage, alarme, ouverture du popup, annonce aux pages.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./fakes/harness.ts";
import { FakeBrowser, until } from "./fakes/chrome.ts";
import { SITE } from "./fakes/backend.ts";
import { createFakeFetch, json } from "./fakes/fetch.ts";
import { CHECK_INTERVAL_MS, checkForUpdate, chromeMajor, compareVersions, isDue, noticeFor, parseLatest, type UpdateState } from "../../src/background/update.ts";

const LATEST = {
  version: "1.1.0", file: "aethryon-extension-1.1.0.zip", sha256: "a".repeat(64), size: 123456, released: "2026-11-02", minChrome: 120,
  notes: ["Nouvelle mise en page du popup.", "Corrections de la connexion."],
};
const URL_LATEST = `${SITE}/downloads/extension/latest.json`;

test("versions : comparaison numérique de 1 à 4 nombres, invalides refusées", () => {
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1, "numérique, pas alphabétique");
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
  assert.equal(compareVersions("1.0.0.1", "1.0.0"), 1);
  for (const bad of ["1.0.0-beta", "v1.0.0", "", "1..0", "1.0.0.0.0", "a.b.c"]) assert.equal(compareVersions(bad, "1.0.0"), null, bad);
});

test("latest.json : schéma exact exigé (version, fichier, empreinte, taille, date, Chrome minimal, notes)", () => {
  assert.deepEqual(parseLatest(LATEST), LATEST);
  const bad: [string, unknown][] = [
    ["version", { ...LATEST, version: "1.1" + ".0-rc" }],
    ["fichier", { ...LATEST, file: "autre.zip" }],
    ["empreinte", { ...LATEST, sha256: "XYZ" }],
    ["taille", { ...LATEST, size: -1 }],
    ["date", { ...LATEST, released: "02/11/2026" }],
    ["chrome", { ...LATEST, minChrome: "120" }],
    ["notes", { ...LATEST, notes: "texte" }],
    ["vide", null],
  ];
  for (const [why, body] of bad) assert.equal(parseLatest(body), null, why);
  // Notes : nettoyées (caractères de contrôle), bornées.
  const long = parseLatest({ ...LATEST, notes: ["A\u0000B", "x".repeat(500), ...Array(10).fill("n")] })!;
  assert.equal(long.notes[0], "A B");
  assert.equal(long.notes[1]!.length, 240);
  assert.equal(long.notes.length, 8);
});

test("rythme : au plus une vérification par 12 h ; horloge revenue en arrière → vérification", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  assert.equal(isDue(null, now), true);
  assert.equal(isDue({ checkedAt: now - 3_600_000 }, now), false);
  assert.equal(isDue({ checkedAt: now - CHECK_INTERVAL_MS + 60_000 }, now), true, "alarme de 12 h un peu en avance : pas sautée");
  assert.equal(isDue({ checkedAt: now - 11 * 3_600_000 }, now), false);
  assert.equal(isDue({ checkedAt: now + 3 * 3_600_000 }, now), true);
});

test("avis : seulement pour une version PLUS RÉCENTE, et pas celle que l'utilisateur a masquée ; Chrome trop ancien signalé", () => {
  const s: UpdateState = { checkedAt: 1, latest: { version: "1.1.0", notes: ["N"], released: "2026-11-02", minChrome: 120 } };
  assert.deepEqual(noticeFor(s, "1.0.0", 153), { version: "1.1.0", notes: ["N"], released: "2026-11-02", url: `${SITE}/extension` });
  assert.equal(noticeFor(s, "1.1.0", 153), null, "même version");
  assert.equal(noticeFor(s, "1.2.0", 153), null, "version installée plus récente");
  assert.equal(noticeFor({ ...s, dismissed: "1.1.0" }, "1.0.0", 153), null, "masqué pour cette version");
  assert.notEqual(noticeFor({ ...s, dismissed: "1.0.5" }, "1.0.0", 153), null, "masquer une ancienne version ne masque pas la nouvelle");
  assert.equal(noticeFor({ ...s, latest: { ...s.latest!, minChrome: 160 } }, "1.0.0", 153)!.needsChrome, 160);
  assert.equal(chromeMajor("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Safari/537.36"), 153);
  assert.equal(chromeMajor("Firefox/140.0"), null);
});

test("checkForUpdate : requête sans clé ni cookie, une seule par 12 h (même en échec), échecs silencieux", async () => {
  const b = new FakeBrowser();
  let reply: () => any = () => json(200, LATEST);
  const net = createFakeFetch(() => reply());
  const t0 = Date.parse("2026-10-11T12:00:00Z");
  let r = await checkForUpdate(net.fetch, "1.0.0", { now: t0 });
  assert.equal(r.checked, true);
  assert.equal(r.notice?.version, "1.1.0");
  assert.equal(net.calls.length, 1);
  const call = net.calls[0]!;
  assert.equal(call.url, URL_LATEST);
  assert.equal(call.headers.authorization, undefined, "aucune clé");
  assert.equal(call.init.credentials, "omit", "aucun cookie");
  assert.equal(call.init.redirect, "error", "aucune redirection suivie");
  // 1 h plus tard : rien n'est redemandé, l'avis reste
  r = await checkForUpdate(net.fetch, "1.0.0", { now: t0 + 3_600_000 });
  assert.deepEqual([r.checked, r.notice?.version, net.calls.length], [false, "1.1.0", 1]);
  // 12 h plus tard, réseau coupé : silencieux, l'essai compte, l'avis connu reste
  reply = () => "network";
  r = await checkForUpdate(net.fetch, "1.0.0", { now: t0 + CHECK_INTERVAL_MS });
  assert.deepEqual([r.checked, r.notice?.version, net.calls.length], [true, "1.1.0", 2]);
  r = await checkForUpdate(net.fetch, "1.0.0", { now: t0 + CHECK_INTERVAL_MS + 60_000 });
  assert.deepEqual([r.checked, net.calls.length], [false, 2], "pas de nouvel essai avant 12 h");
  // réponses inattendues : ignorées sans erreur
  for (const [i, bad] of [() => json(500, {}), () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), () => json(200, { version: "9" })].entries()) {
    reply = bad;
    r = await checkForUpdate(net.fetch, "1.0.0", { now: t0 + CHECK_INTERVAL_MS * (2 + i) });
    assert.equal(r.checked, true);
    assert.equal(r.notice?.version, "1.1.0", "dernier avis valable conservé");
  }
  assert.ok(b.store.local.has("update"));
});

test("service worker : popup.init lance la vérification due, annonce l'avis aux pages ; « Masquer » le retire pour cette version", async (t) => {
  const h = harness(t, { updateDue: true });
  h.backend.latestStatus = 200;
  h.backend.latest = LATEST;
  const first = await h.page({ type: "popup.init" });
  assert.equal(first.data.update, null, "pas encore vérifié");
  await until(() => h.browser.pageMessages.some((m: any) => m.type === "update.changed"));
  const ev = h.browser.pageMessages.find((m: any) => m.type === "update.changed");
  assert.deepEqual(ev.update, { version: "1.1.0", notes: LATEST.notes, released: "2026-11-02", url: `${SITE}/extension` });
  const again = await h.page({ type: "popup.init" });
  assert.equal(again.data.update.version, "1.1.0");
  assert.equal(h.backend.latestRequests, 1, "une seule requête");
  const d = await h.page({ type: "update.dismiss", version: "1.1.0" });
  assert.deepEqual(d, { ok: true, data: { update: null } });
  assert.equal((await h.page({ type: "popup.init" })).data.update, null);
  assert.deepEqual(h.browser.pageMessages.at(-1), { type: "update.changed", update: null });
});

test("service worker : démarrage du navigateur et alarme de 12 h → vérification (si due) ; installée = annoncée → aucun avis", async (t) => {
  const h = harness(t, { updateDue: true });
  h.backend.latestStatus = 200;
  h.backend.latest = { ...LATEST, version: "1.0.0", file: "aethryon-extension-1.0.0.zip" };
  h.browser.fireStartup();
  await until(() => h.backend.latestRequests === 1);
  await until(() => h.browser.alarms.has("aethryon-update"));
  await until(() => h.browser.pageMessages.some((m: any) => m.type === "update.changed"));
  assert.equal(h.browser.pageMessages.find((m: any) => m.type === "update.changed").update, null, "même version : rien à montrer");
  h.browser.fireAlarm("aethryon-update");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.backend.latestRequests, 1, "l'alarme ne double pas une vérification faite il y a moins de 12 h");
});

test("sans accord à la notice : aucune vérification (ni au démarrage, ni par l'alarme, ni à l'ouverture du popup)", async (t) => {
  const h = harness(t, { consent: false, updateDue: true });
  h.backend.latestStatus = 200;
  h.backend.latest = LATEST;
  h.browser.fireStartup();
  h.browser.fireAlarm("aethryon-update");
  await h.page({ type: "popup.init" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.backend.latestRequests, 0);
  assert.equal(h.net.calls.length, 0);
});
