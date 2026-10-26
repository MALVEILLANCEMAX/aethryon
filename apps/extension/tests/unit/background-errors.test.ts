// Service worker : correspondance des réponses de ytapi (400/401/403/404/409/410/413/422/429/499/5xx,
// Retry-After) avec ce que voit l'utilisateur, et typographie française des messages.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL } from "./fakes/harness.ts";
import { until } from "./fakes/chrome.ts";
import { json } from "./fakes/fetch.ts";
import { apiError, formatDelay, MSG, parseRetryAfter, typo } from "../../src/background/errors.ts";

const NB = " ";

test("création refusée par ytapi : texte du serveur affiché, relançable ou non selon le code", async (t) => {
  const cases: [number, any, Record<string, string>, { code: string; message: string; retryable: boolean } | "cancelled"][] = [
    [400, { error: "invalid_parameter", detail: "Paramètre invalide — fmt : valeur non autorisée" }, {}, { code: "invalid_parameter", message: "Paramètre invalide — fmt : valeur non autorisée".replace(" :", `${NB}:`), retryable: false }],
    [403, { error: "private", detail: "La vidéo est privée." }, {}, { code: "private", message: "La vidéo est privée.", retryable: false }],
    [403, { error: "account_suspended", detail: "Ce compte est suspendu." }, {}, { code: "account_suspended", message: "Ce compte est suspendu.", retryable: false }],
    [404, { error: "not_found", detail: "Vidéo supprimée ou inaccessible : la plateforme ne la trouve pas (lien erroné ou vidéo retirée)." }, {},
      { code: "not_found", message: `Vidéo supprimée ou inaccessible${NB}: la plateforme ne la trouve pas (lien erroné ou vidéo retirée).`, retryable: false }],
    [409, { error: "job_failed", detail: "La conversion a échoué." }, {}, { code: "job_failed", message: "La conversion a échoué.", retryable: false }],
    [410, { error: "file_gone", detail: "Le fichier a expiré ou a été supprimé : relancez le job." }, {}, { code: "file_gone", message: MSG.fileExpired.replace(" :", `${NB}:`), retryable: true }],
    [413, { error: "too_long", detail: "Vidéo trop longue pour le service." }, {}, { code: "too_long", message: "Vidéo trop longue pour le service.", retryable: false }],
    [422, { error: "format_unavailable", detail: "Échec de récupération du média : aucun format compatible n'est proposé." }, {},
      { code: "format_unavailable", message: `Échec de récupération du média${NB}: aucun format compatible n'est proposé.`, retryable: false }],
    [429, { error: "quota_exceeded", detail: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris)." }, { "retry-after": "18000" },
      { code: "quota_exceeded", message: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris).", retryable: false }],
    [499, { error: "cancelled", detail: "La conversion a été annulée." }, {}, "cancelled"],
    [503, { error: "service_paused", detail: "Les conversions sont temporairement suspendues." }, { "retry-after": "300" },
      { code: "service_paused", message: `Les conversions sont temporairement suspendues. Réessaie dans 5${NB}min.`, retryable: true }],
    [503, { error: "bot_check", detail: "Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard." }, { "retry-after": "600" },
      { code: "bot_check", message: `Plateforme temporairement indisponible${NB}: elle impose au serveur une vérification anti-robot et bloque ses demandes${NB}; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.`, retryable: true }],
    [502, { error: "short_link_unresolved", detail: "Le lien court n'a pas pu être ouvert : ouvre la vidéo dans l'app puis partage-la à nouveau." }, {},
      { code: "short_link_unresolved", message: `Le lien court n'a pas pu être ouvert${NB}: ouvre la vidéo dans l'app puis partage-la à nouveau.`, retryable: false }],
    [500, null, {}, { code: "server_error", message: `Le serveur AETHRYON rencontre un problème${NB}: réessaie dans un instant.`, retryable: true }],
  ];
  for (const [status, body, headers, want] of cases) {
    const h = harness(t);
    h.backend.onCreate = () => (body === null ? new Response("<html>", { status, headers: { "content-type": "text/html" } }) : json(status, body, headers));
    const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
    assert.equal(r.ok, true);
    await until(() => h.job()?.state === "error" || h.job()?.state === "cancelled", 1000, `${status}`);
    if (want === "cancelled") assert.equal(h.job().state, "cancelled");
    else assert.deepEqual(h.job().error, want, `${status} ${body?.error}`);
    h.worker.stop();
  }
});

test("429 rate_limited / active_job_limit au-delà de l'attente locale : message + délai Retry-After", () => {
  assert.deepEqual(apiError(429, { error: "active_job_limit", detail: "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine." }, 15), {
    code: "active_job_limit", message: `Une conversion est déjà en cours pour ton compte${NB}: attends qu'elle se termine. Réessaie dans 15${NB}s.`, retryable: true,
  });
  // le serveur donne déjà le délai : pas de doublon
  assert.equal(apiError(429, { error: "rate_limited", detail: "Trop de requêtes, réessayez dans 7 s." }, 7).message, "Trop de requêtes, réessayez dans 7 s.");
  assert.equal(apiError(429, {}, null).message, `Trop de demandes${NB}: réessaie dans un instant.`);
});

test("YouTube Music fermé (2026-10-23) : le refus d'ytapi est montré tel quel et n'est jamais relançable", () => {
  const detail = "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.";
  for (const status of [400, 200]) {
    assert.deepEqual(apiError(status, { error: "youtube_music_not_accepted", detail }, null),
      { code: "youtube_music_not_accepted", message: `Les liens YouTube Music ne sont pas acceptés${NB}: AETHRYON ne télécharge pas le catalogue musical commercial.`, retryable: false });
  }
});

test("suivi : 404 job_not_found → « La conversion a expiré : relance-la. » (relançable) ; échec lu dans le corps du job", async (t) => {
  const h = harness(t);
  h.backend.onPoll = () => json(404, { error: "job_not_found", detail: "Job inconnu ou expiré (le serveur a peut-être redémarré)." });
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "error");
  assert.deepEqual(h.job().error, { code: "job_not_found", message: `La conversion a expiré${NB}: relance-la.`, retryable: true });

  for (const [code, detail, retryable] of [
    ["private", "La vidéo est privée.", false],
    ["bot_check", "Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.", true],
    ["no_audio", "Cette vidéo n'a pas de son : MP3 impossible.", false],
    ["timeout", "Délai de conversion dépassé.", true],
  ] as const) {
    const g = harness(t);
    g.backend.script = [{ status: "error", stage: "error", error: code, detail }];
    await g.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
    await until(() => g.job()?.state === "error");
    assert.deepEqual(g.job().error, { code, message: typo(detail), retryable }, code);
    assert.equal(g.job().jobId, "job_0001");
    g.worker.stop();
  }
});

test("typographie : espace insécable avant : ; ! ? et dans les guillemets, nulle part ailleurs", () => {
  assert.equal(typo("Attention : test ; oui ! non ? « cité »"), `Attention${NB}: test${NB}; oui${NB}! non${NB}? «${NB}cité${NB}»`);
  assert.equal(typo("https://x.com/a?b=1 10:30"), "https://x.com/a?b=1 10:30");
  for (const [k, m] of Object.entries(MSG)) {
    assert.ok(!/ [:;!?»]/.test(typo(m)), k);
  }
  assert.equal(formatDelay(15), `15${NB}s`);
  assert.equal(formatDelay(300), `5${NB}min`);
  assert.equal(formatDelay(18_420), `5${NB}h${NB}07`);
  assert.equal(formatDelay(7200), `2${NB}h`);
});

test("Retry-After : secondes ou date HTTP, borné", () => {
  assert.equal(parseRetryAfter("15"), 15);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("abc"), null);
  assert.equal(parseRetryAfter("999999999"), 172_800);
  const now = Date.parse("2026-10-10T20:00:00Z");
  assert.equal(parseRetryAfter("Sat, 10 Oct 2026 20:01:00 GMT", now), 60);
});
