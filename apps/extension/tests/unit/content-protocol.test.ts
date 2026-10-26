import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_ANSWER, interpretSendFailure, interpretStartResponse, isTrustedSender, parseJob, parseTabMessage } from "../../src/content/common/protocol.ts";

const ID = "dnllfjakdgmgfiompaheickmbjjlgjdc";
const job = { key: "jobkey000001", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube", fmt: "mp4", state: "converting", progress: 42, createdAt: 1, updatedAt: 5, tabId: 3 };

test("messages reçus par l'onglet : detect.request et job.update valides", () => {
  assert.deepEqual(parseTabMessage({ type: "detect.request" }), { type: "detect.request" });
  assert.deepEqual(parseTabMessage({ type: "job.update", job }), {
    type: "job.update",
    job: { key: "jobkey000001", url: job.url, state: "converting", progress: 42, fmt: "mp4", updatedAt: 5 },
  });
});

test("messages refusés : type inconnu, champs en trop, job incohérent", () => {
  for (const bad of [
    null, "detect.request", [], {},
    { type: "detect.request", extra: 1 },
    { type: "eval", code: "alert(1)" },
    { type: "job.update" },
    { type: "job.update", job, extra: true },
    { type: "job.update", job: { ...job, key: "../x" } },
    { type: "job.update", job: { ...job, state: "hacked" } },
    { type: "job.update", job: { ...job, url: "https://www.instagram.com/reel/abc/" } },
    { type: "job.update", job: { ...job, url: "javascript:alert(1)" } },
    { type: "job.update", job: "jobkey000001" },
  ]) assert.equal(parseTabMessage(bad), null, JSON.stringify(bad));
});

test("job : progression bornée, erreur nettoyée, index borné, champs inconnus ignorés", () => {
  const j = parseJob({ ...job, state: "error", progress: 250, index: 99, error: { code: "x\u0000", message: "  Trop‮ de requêtes\n ", retryable: "yes" }, token: "ytc_secret" });
  assert.deepEqual(j, { key: "jobkey000001", url: job.url, state: "error", progress: 100, fmt: "mp4", updatedAt: 5, error: { code: "x", message: "Trop de requêtes", retryable: false } });
  assert.equal(parseJob({ ...job, error: { message: "" } })!.error, undefined, "erreur vide ignorée");
  assert.equal(parseJob({ ...job, index: 2 })!.index, 2);
});

test("expéditeur : notre extension seulement (pas un onglet, pas une autre extension)", () => {
  assert.equal(isTrustedSender({ id: ID }, ID), true);
  assert.equal(isTrustedSender({ id: ID, tab: { id: 1 } }, ID), false);
  assert.equal(isTrustedSender({ id: "autre" }, ID), false);
  assert.equal(isTrustedSender({ id: ID }, undefined), false, "contexte invalidé");
  assert.equal(isTrustedSender(null, ID), false);
});

test("réponse à job.start : rien → « ne répond pas » ; erreur du serveur nettoyée ; job", () => {
  assert.deepEqual(interpretStartResponse(undefined), { ok: false, error: NO_ANSWER });
  assert.equal(NO_ANSWER.retryable, true);
  assert.deepEqual(interpretStartResponse({ ok: false, error: { code: "auth_required", message: "Connecte ton compte AETHRYON.", retryable: false } }), {
    ok: false, error: { code: "auth_required", message: "Connecte ton compte AETHRYON.", retryable: false },
  });
  const generic = interpretStartResponse({ ok: false });
  assert.equal(generic.ok, false);
  assert.equal(!generic.ok && generic.error.message, "Le téléchargement a échoué.");
  assert.deepEqual(interpretStartResponse({ ok: true, data: { ...job, state: "queued" } }), { ok: true, job: { key: "jobkey000001", url: job.url, state: "queued", progress: 42, fmt: "mp4", updatedAt: 5 } });
  assert.deepEqual(interpretStartResponse({ ok: true }), { ok: true, job: null });
  assert.deepEqual(interpretStartResponse({ ok: "yes" }), { ok: false, error: NO_ANSWER });
});

test("échec d'envoi : « pas de destinataire » → message relançable ; contexte invalidé → démontage", () => {
  assert.deepEqual(interpretSendFailure(new Error("Could not establish connection. Receiving end does not exist.")), { invalidated: false, error: NO_ANSWER });
  assert.deepEqual(interpretSendFailure(new Error("The message port closed before a response was received.")), { invalidated: false, error: NO_ANSWER });
  assert.deepEqual(interpretSendFailure(new Error("Extension context invalidated.")), { invalidated: true });
  assert.deepEqual(interpretSendFailure(undefined), { invalidated: false, error: NO_ANSWER });
});
