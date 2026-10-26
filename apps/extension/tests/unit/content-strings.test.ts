// Typographie française de toutes les chaînes affichées par les content scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeJob } from "../../src/content/common/job.ts";
import { NO_ANSWER } from "../../src/content/common/protocol.ts";
import { T, kbps, percent, quotedContext, triggerAria, videoCount, videoN, withPercent } from "../../src/content/common/strings.ts";

const NBSP = " ";

function all(): string[] {
  return [
    ...Object.values(T),
    percent(42), withPercent(T.converting, 42), withPercent(T.downloading, 60), videoN(2), videoCount(3), kbps(192),
    triggerAria("@alice"), triggerAria(null), quotedContext("dave"), quotedContext(null), NO_ANSWER.message,
    ...(["queued", "converting", "downloading", "done", "error", "cancelled"] as const).flatMap((state) => {
      const d = describeJob({ state, progress: 42 });
      return [d.label, d.short, d.message ?? ""];
    }),
  ].filter(Boolean);
}

test("espace insécable U+00A0 avant ? ! : ; % et dans « », jamais d'espace ordinaire", () => {
  for (const s of all()) {
    assert.doesNotMatch(s, / [?!:;%»]/, `espace ordinaire avant un signe double : « ${s} »`);
    assert.doesNotMatch(s, /« /, `espace ordinaire après « : ${s}`);
    for (const m of s.matchAll(/[?!:;%»]/g)) {
      const before = s[m.index! - 1];
      // « : » dans une URL ou une heure n'existe pas dans ces textes ; tout signe double est précédé d'une insécable.
      assert.equal(before, NBSP, `insécable attendue avant « ${m[0]} » dans « ${s} »`);
    }
    for (const m of s.matchAll(/«/g)) assert.equal(s[m.index! + 1], NBSP, `insécable attendue après « dans ${s}`);
  }
});

test("apostrophe typographique ’ et points de suspension …", () => {
  for (const s of all()) {
    assert.doesNotMatch(s, /'/, `apostrophe droite : ${s}`);
    assert.doesNotMatch(s, /\.\.\./, `trois points au lieu de … : ${s}`);
  }
});

test("libellés exacts demandés", () => {
  assert.equal(T.trigger, "Télécharger");
  assert.equal(T.queued, "En file");
  assert.equal(withPercent(T.converting, 42), `Conversion… 42${NBSP}%`);
  assert.equal(withPercent(T.downloading, 60), `Téléchargement… 60${NBSP}%`);
  assert.equal(T.done, "Enregistré");
  assert.equal(T.retry, "Réessayer");
  assert.equal(T.hintX, "Utilise le bouton AETHRYON sous la publication qui contient la vidéo.");
  assert.equal(videoN(1), "Vidéo 1");
});
