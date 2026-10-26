import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStartJob, describeFailure, describeJob, describeSending, initialChoice, normProgress, qualityChoices, qualityLabel, type Choice } from "../../src/content/common/job.ts";
import { parseBgRequest } from "../../src/shared/messages.ts";
import type { JobState } from "../../src/shared/types.ts";

const NBSP = " ";
const mp4 = (quality: Choice["quality"] = "best", index = 1): Choice => ({ fmt: "mp4", quality, bitrate: 192, index });
const mp3 = (bitrate: Choice["bitrate"] = 192): Choice => ({ fmt: "mp3", quality: "best", bitrate, index: 1 });

test("job.start YouTube MP4 : URL canonique (sans suivi), qualité, titre ; jamais de débit", () => {
  const r = buildStartJob({ platform: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc", title: "  Ma vidéo\n" }, mp4("720"));
  assert.deepEqual(r, { type: "job.start", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", fmt: "mp4", quality: "720", title: "Ma vidéo" });
});

test("job.start MP3 : débit seulement ; Shorts gardent leur URL /shorts/", () => {
  const r = buildStartJob({ platform: "youtube", id: "sHoRt000001", url: "https://www.youtube.com/shorts/sHoRt000001" }, mp3(320));
  assert.deepEqual(r, { type: "job.start", url: "https://www.youtube.com/shorts/sHoRt000001", fmt: "mp3", bitrate: 320 });
});

test("job.start X : index seulement s'il y a plusieurs vidéos, et dans les bornes", () => {
  const post = { platform: "twitter" as const, id: "1790000000000000003", url: "https://twitter.com/carol/status/1790000000000000003?s=20" };
  assert.deepEqual(buildStartJob({ ...post, videoCount: 2 }, mp4("best", 2)), { type: "job.start", url: "https://x.com/carol/status/1790000000000000003", fmt: "mp4", quality: "best", index: 2 });
  assert.equal(buildStartJob({ ...post, videoCount: 2 }, mp4("best", 3)), null, "Vidéo 3 inexistante");
  assert.equal(buildStartJob({ ...post, videoCount: 2 }, mp4("best", 0)), null);
  assert.deepEqual(buildStartJob({ ...post, videoCount: 1 }, mp4("best", 2)), { type: "job.start", url: "https://x.com/carol/status/1790000000000000003", fmt: "mp4", quality: "best" }, "une seule vidéo : pas d'index");
  assert.deepEqual(buildStartJob(post, mp3()), { type: "job.start", url: "https://x.com/carol/status/1790000000000000003", fmt: "mp3", bitrate: 192 });
});

test("job.start : titre nettoyé (contrôle, bidi) et borné à 200 caractères", () => {
  const r = buildStartJob({ platform: "tiktok", id: "7300000000000000001", url: "https://www.tiktok.com/@alice.test/video/7300000000000000001", title: `A\u0000B‮c ${"x".repeat(400)}` }, mp4());
  assert.ok(r);
  assert.equal(r.title!.length, 200);
  assert.ok(r.title!.startsWith("A B c "));
  const empty = buildStartJob({ platform: "tiktok", id: "7300000000000000001", url: "https://www.tiktok.com/@alice.test/video/7300000000000000001", title: " ​ " }, mp4());
  assert.equal(empty && "title" in empty, false, "titre vide : absent");
});

test("job.start refusé : URL hors périmètre, plateforme ou identifiant incohérents, lien court", () => {
  const bad: [Parameters<typeof buildStartJob>[0], string][] = [
    [{ platform: "youtube", id: "dQw4w9WgXcQ", url: "https://www.instagram.com/reel/abc/" }, "Instagram"],
    [{ platform: "youtube", id: "dQw4w9WgXcQ", url: "javascript:alert(1)" }, "javascript:"],
    [{ platform: "tiktok", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, "plateforme incohérente"],
    [{ platform: "youtube", id: "aaaaaaaaaaa", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, "identifiant incohérent"],
    [{ platform: "tiktok", id: "ZMabc123", url: "https://vm.tiktok.com/ZMabc123/" }, "lien court"],
    [{ platform: "twitter", id: "1790000000000000001", url: "https://evil.example/alice/status/1790000000000000001" }, "faux hôte"],
  ];
  for (const [media, why] of bad) assert.equal(buildStartJob(media, mp4()), null, why);
});

test("toute requête construite est acceptée telle quelle par le validateur du service worker", () => {
  const cases = [
    buildStartJob({ platform: "youtube", id: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ", title: "T" }, mp4("1080")),
    buildStartJob({ platform: "twitter", id: "1790000000000000003", url: "https://x.com/carol/status/1790000000000000003", videoCount: 4 }, mp4("480", 4)),
    buildStartJob({ platform: "tiktok", id: "7300000000000000001", url: "https://www.tiktok.com/@a/video/7300000000000000001" }, mp3(128)),
  ];
  for (const c of cases) {
    assert.ok(c);
    assert.deepEqual(parseBgRequest(JSON.parse(JSON.stringify(c))), c);
  }
});

test("choix proposés et présélection depuis les réglages", () => {
  assert.deepEqual(qualityChoices("best"), ["best", "1080", "720", "480"]);
  assert.deepEqual(qualityChoices("720"), ["best", "1080", "720", "480"]);
  assert.deepEqual(qualityChoices("360"), ["best", "1080", "720", "480", "360"]);
  assert.deepEqual(qualityChoices("2160"), ["best", "2160", "1080", "720", "480"]);
  assert.deepEqual(["best", "1080", "360"].map((q) => qualityLabel(q as Choice["quality"])), ["Auto", "1080p", "360p"]);
  assert.deepEqual(initialChoice({ defaultFmt: "mp3", quality: "720", bitrate: 320 }), { fmt: "mp3", quality: "720", bitrate: 320, index: 1 });
  assert.deepEqual(initialChoice({ defaultFmt: "gif" as "mp4", quality: "4320" as "best", bitrate: 256 as 192 }), { fmt: "mp4", quality: "best", bitrate: 192, index: 1 });
});

test("états affichés : En file, Conversion… 42 %, Téléchargement… 60 %, Enregistré (typographie française)", () => {
  assert.deepEqual([describeJob({ state: "queued" }).label, describeJob({ state: "queued" }).short], ["En file", "En file"]);
  const conv = describeJob({ state: "converting", progress: 42.4 });
  assert.equal(conv.label, `Conversion… 42${NBSP}%`);
  assert.equal(conv.short, `42${NBSP}%`);
  assert.equal(conv.busy, true);
  assert.equal(describeJob({ state: "converting" }).label, "Conversion…");
  assert.equal(describeJob({ state: "downloading", progress: 60 }).label, `Téléchargement… 60${NBSP}%`);
  const done = describeJob({ state: "done", progress: 100 });
  assert.deepEqual([done.label, done.short, done.busy, done.phase], ["Enregistré", "Enregistré", false, "done"]);
  assert.equal(describeSending().label, "Envoi…");
});

test("« Enregistré » n'apparaît QUE pour l'état done (conversion terminée ≠ fichier enregistré)", () => {
  const states: JobState[] = ["queued", "converting", "downloading", "error", "cancelled"];
  for (const state of states) {
    for (const progress of [undefined, 0, 99, 100]) {
      const d = describeJob({ state, progress });
      assert.notEqual(d.label, "Enregistré", `${state} ${progress}`);
      assert.notEqual(d.short, "Enregistré", `${state} ${progress}`);
    }
  }
});

test("erreurs : message du serveur tel quel, « Réessayer » seulement si relançable", () => {
  const e = describeJob({ state: "error", error: { code: "quota_exceeded", message: "Quota du jour atteint.", retryable: false } });
  assert.deepEqual([e.phase, e.message, e.retryable, e.short], ["error", "Quota du jour atteint.", false, "Échec"]);
  assert.equal(describeJob({ state: "error", error: { code: "network", message: "Connexion perdue.", retryable: true } }).retryable, true);
  assert.equal(describeJob({ state: "error" }).message, "Le téléchargement a échoué.");
  assert.equal(describeFailure({ code: "x", message: "", retryable: false }).message, "Le téléchargement a échoué.");
  assert.equal(describeJob({ state: "cancelled" }).label, "Annulé");
});

test("progression bornée et arrondie", () => {
  assert.deepEqual([150, -5, 41.6, Number.NaN, "42", undefined].map(normProgress), [100, 0, 42, null, null, null]);
});
