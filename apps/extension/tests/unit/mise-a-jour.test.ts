// 3.6.1 : mise à jour en un clic par AETHRYON Desktop (src/background/desktop-update.ts, worker, messages) — étapes
// réelles relayées, liste fermée (la version seulement), repli si Desktop est absent, trop ancien ou refuse,
// rechargement, puis explication du chargement unique quand la version chargée n'a pas changé.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./fakes/harness.ts";
import { until } from "./fakes/chrome.ts";
import { parseBgRequest } from "../../src/shared/messages.ts";
import { HINT_KEY, RELOAD_KEY, reloadOutcome, runDesktopUpdate } from "../../src/background/desktop-update.ts";
import { parseInstallResult, parseLoadHint, parseProgress } from "../../src/popup/bg.ts";

const FOLDER = "C:\\Users\\Élodie\\AppData\\Local\\AETHRYON\\extension";

/** Port factice : rejoue `replies` après le premier message, ou se coupe. */
function fakePort(replies: unknown[], { disconnect = false } = {}) {
  const msgL: ((m: unknown) => void)[] = [];
  const discL: (() => void)[] = [];
  const posted: unknown[] = [];
  let closed = false;
  return {
    posted, get closed() { return closed; },
    port: {
      postMessage(m: unknown) {
        posted.push(m);
        setTimeout(() => { for (const r of replies) msgL.forEach((f) => f(r)); if (disconnect) discL.forEach((f) => f()); }, 1);
      },
      disconnect() { closed = true; },
      onMessage: { addListener: (f: (m: unknown) => void) => msgL.push(f) },
      onDisconnect: { addListener: (f: () => void) => discL.push(f) },
    },
  };
}

test("Desktop : étapes réelles relayées dans l'ordre, puis réussite ; seul message posté : type et version", async () => {
  const f = fakePort([
    { type: "avancement", etape: "telechargement", fait: 0, total: 1000 },
    { type: "avancement", etape: "telechargement", fait: 1000, total: 1000 },
    { type: "avancement", etape: "verification", fait: 2, total: 2 },
    { type: "avancement", etape: "installation", fait: 40, total: 40 },
    { ok: true, version: "3.6.2", dossier: FOLDER, deja: false, precedente: "3.6.1" },
  ]);
  const steps: string[] = [];
  const r = await runDesktopUpdate({ connect: () => f.port, version: "3.6.2", onStep: (s, d, t) => steps.push(`${s}:${d}/${t}`) });
  assert.deepEqual(r, { ok: true, version: "3.6.2", folder: FOLDER, already: false });
  assert.deepEqual(steps, ["telechargement:0/1000", "telechargement:1000/1000", "verification:2/2", "installation:40/40"]);
  assert.deepEqual(f.posted, [{ type: "mettre-a-jour-extension", version: "3.6.2" }], "ni adresse, ni chemin, ni jeton");
  assert.equal(f.closed, true, "port fermé : l'hôte s'arrête");
});

test("Desktop : absent, trop ancien, refus (étape gardée), délai, permission absente → repli lisible", async () => {
  assert.equal((await runDesktopUpdate({ connect: () => null, version: "3.6.2" })).ok, false);
  assert.equal(((await runDesktopUpdate({ connect: () => null, version: "3.6.2" })) as any).reason, "permission");
  const absent = await runDesktopUpdate({ connect: () => fakePort([], { disconnect: true }).port, version: "3.6.2" });
  assert.equal((absent as any).reason, "absent");
  const ancien = await runDesktopUpdate({ connect: () => fakePort([{ ok: false, erreur: "Type de message inconnu." }]).port, version: "3.6.2" });
  assert.equal((ancien as any).reason, "ancien");
  assert.match((ancien as any).message, /mets-le d'abord à jour/);
  const refus = await runDesktopUpdate({ connect: () => fakePort([{ type: "avancement", etape: "telechargement", fait: 1, total: 9 }, { ok: false, erreur: "Empreinte SHA-256 différente\u0007.", etape: "verification" }]).port, version: "3.6.2" });
  assert.equal((refus as any).reason, "refus");
  assert.equal((refus as any).step, "verification");
  assert.ok(!(refus as any).message.includes("\u0007"), "texte de l'hôte nettoyé");
  const delai = await runDesktopUpdate({ connect: () => fakePort([]).port, version: "3.6.2", timeoutMs: 30 });
  assert.equal((delai as any).reason, "delai");
  const mauvais = await runDesktopUpdate({ connect: () => fakePort([{ ok: true, version: "3.6.2", dossier: "a\u0000b" }]).port, version: "3.6.2" });
  assert.equal((mauvais as any).reason, "refus", "dossier illisible refusé");
});

test("après rechargement : version inchangée → explication avec le chemin exact ; nouvelle version → rien ; explication réglée → retirée", () => {
  const now = Date.now();
  const pending = { from: "3.6.1", to: "3.6.2", folder: FOLDER, at: now - 2_000 };
  assert.deepEqual(reloadOutcome(pending, null, "3.6.1", now), { hint: { version: "3.6.2", folder: FOLDER, loaded: "3.6.1" }, updated: null });
  assert.deepEqual(reloadOutcome(pending, null, "3.6.2", now), { hint: null, updated: "3.6.2" });
  assert.deepEqual(reloadOutcome(null, { version: "3.6.2", folder: FOLDER, loaded: "3.6.1" }, "3.6.2", now), { hint: null, updated: null });
  assert.deepEqual(reloadOutcome(null, { version: "3.6.2", folder: FOLDER, loaded: "3.6.1" }, "3.6.1", now).hint?.folder, FOLDER);
  assert.deepEqual(reloadOutcome({ ...pending, at: now - 3_600_000 }, null, "3.6.1", now), { hint: null, updated: null }, "demande trop ancienne ignorée");
});

test("messages : update.install en liste fermée (version seulement), jamais depuis un content script", async (t) => {
  assert.deepEqual(parseBgRequest({ type: "update.install", version: "3.6.2" }), { type: "update.install", version: "3.6.2" });
  for (const bad of [{ type: "update.install" }, { type: "update.install", version: "3.6.2", url: "https://x" }, { type: "update.install", version: "3.6.2", dossier: "C:\\" }, { type: "update.install", version: "../1" }]) {
    assert.equal(parseBgRequest(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseBgRequest({ type: "update.hint.dismiss" }), { type: "update.hint.dismiss" });
  const h = harness(t);
  h.browser.grantNative();
  const r = await h.content({ type: "update.install", version: "9.0.0" });
  assert.equal(r, undefined, "un content script ne peut pas demander de mise à jour");
  assert.equal(h.browser.nativeMessages.length, 0);
});

test("parcours : clic → étapes réelles annoncées aux pages → rechargement ; même version au redémarrage → explication une fois", async (t) => {
  const h = harness(t, { timing: { updateReloadDelayMs: 5 } });
  h.browser.manifestVersion = "3.6.1";
  h.browser.grantNative();
  const r = await h.page({ type: "update.install", version: "3.6.2" });
  assert.equal(r.ok, true);
  assert.deepEqual(parseInstallResult(r.data), { ok: true, version: "3.6.2", folder: FOLDER, already: false });
  assert.deepEqual(h.browser.nativeMessages.at(-1), { type: "mettre-a-jour-extension", version: "3.6.2" });
  const steps = h.browser.pageMessages.filter((m: any) => m.type === "update.progress" && m.progress).map((m: any) => parseProgress(m.progress)!.step);
  assert.deepEqual([...new Set(steps)], ["telechargement", "verification", "installation", "redemarrage"]);
  await until(() => h.browser.reloads === 1, 2000, "chrome.runtime.reload() appelé");
  assert.deepEqual((h.browser.store.local.get(RELOAD_KEY) as any)?.to, "3.6.2");
  // Rechargement depuis un AUTRE dossier : la version chargée reste 3.6.1.
  h.restart();
  await until(() => h.browser.store.local.has(HINT_KEY), 2000, "explication enregistrée");
  assert.equal(h.browser.store.local.has(RELOAD_KEY), false);
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual(parseLoadHint(init.data.loadHint), { version: "3.6.2", folder: FOLDER, loaded: "3.6.1" });
  // L'utilisateur charge le dossier AETHRYON : version 3.6.2 au démarrage suivant → explication retirée.
  h.browser.manifestVersion = "3.6.2";
  h.restart();
  await until(() => !h.browser.store.local.has(HINT_KEY), 2000, "explication retirée");
  assert.equal((await h.page({ type: "popup.init" })).data.loadHint, null);
});

test("parcours : chargé depuis le dossier géré → nouvelle version au redémarrage, aucune explication", async (t) => {
  const h = harness(t, { timing: { updateReloadDelayMs: 5 } });
  h.browser.manifestVersion = "3.6.1";
  h.browser.grantNative();
  assert.equal((await h.page({ type: "update.install", version: "3.6.2" })).ok, true);
  await until(() => h.browser.reloads === 1, 2000, "rechargement");
  h.browser.manifestVersion = "3.6.2";
  h.restart();
  await until(() => !h.browser.store.local.has(RELOAD_KEY), 2000, "demande de rechargement consommée");
  assert.equal(h.browser.store.local.has(HINT_KEY), false);
});

test("repli : Desktop trop ancien ou refus → aucune écriture, aucun rechargement ; version déjà installée refusée", async (t) => {
  const h = harness(t, { timing: { updateReloadDelayMs: 5 } });
  h.browser.manifestVersion = "3.6.1";
  h.browser.grantNative();
  h.browser.nativeUpdate = "ancien";
  const a = await h.page({ type: "update.install", version: "3.6.2" });
  assert.equal(parseInstallResult(a.data)?.ok, false);
  assert.equal((parseInstallResult(a.data) as any).reason, "ancien");
  h.browser.nativeUpdate = "refus";
  const b = parseInstallResult((await h.page({ type: "update.install", version: "3.6.2" })).data) as any;
  assert.equal(b.reason, "refus");
  assert.equal(b.step, "verification");
  assert.match(b.message, /SHA-256/);
  h.browser.revokeNative();
  assert.equal((parseInstallResult((await h.page({ type: "update.install", version: "3.6.2" })).data) as any).reason, "permission");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.browser.reloads, 0);
  assert.equal(h.browser.store.local.has(RELOAD_KEY), false);
  const same = await h.page({ type: "update.install", version: "3.6.1" });
  assert.equal(same.ok, false);
  assert.equal(same.error.code, "update_none");
});
