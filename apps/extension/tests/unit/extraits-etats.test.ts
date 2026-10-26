// 3.6.0 : limites annoncées par le serveur (src/shared/limites.ts), étapes réelles et progression mesurable
// (src/shared/etapes.ts), états de l'avancement (src/extrait/progress.ts), état des commandes des pages
// (src/content/common/job.ts) et typographie de tous les textes de l'éditeur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ETAPES, ETAPE_LABEL, etapeDetail, etapeOf, laterEtape, progressionOf } from "../../src/shared/etapes.ts";
import { formatBytes, limitText, maxClipMs, parseLimits, quotaExhausted, quotaText, type LimitsView } from "../../src/shared/limites.ts";
import { describeExport, shownEtape, type ExportView } from "../../src/extrait/progress.ts";
import { ADJUST, TL, X, etapeTitle, formatNote, progressAria, stepAria } from "../../src/extrait/texts.ts";
import { describeJob } from "../../src/content/common/job.ts";
import { parseJob } from "../../src/content/common/protocol.ts";
import { timecodeErrorText } from "../../src/shared/timecode.ts";

const NB = " ";
const CONTRACT = { extraitDureeMaxMs: 600_000, sortieTailleMaxOctets: 2_147_483_648, telechargementMaxOctets: 4_294_967_296, traitementMaxS: 900, simultanesMax: 2, quotaJour: 10 };

test("limites : relire une limite déjà analysée garde la limite par format (service worker → menu, popup)", () => {
  const once = parseLimits({ ...CONTRACT, dureeMaxParFormatMs: { mp4: 600_000, mp3: 600_000, gif: 30_000 } })!;
  const twice = parseLimits(JSON.parse(JSON.stringify(once)))!;
  assert.deepEqual(twice.parFormat, { mp4: 600_000, mp3: 600_000, gif: 30_000 });
  assert.equal(maxClipMs(twice, "gif"), 30_000);
  assert.deepEqual(twice, once);
});

test("limites : corps du contrat lu champ par champ ; formes tolérées ; rien d'inventé sans réponse", () => {
  const l = parseLimits(CONTRACT)!;
  assert.equal(l.extraitDureeMaxMs, 600_000);
  assert.equal(l.telechargementMaxOctets, 4_294_967_296);
  assert.equal(l.quotaJour, 10);
  assert.deepEqual(l.parFormat, {});
  assert.deepEqual(parseLimits({ limites: CONTRACT })?.extraitDureeMaxMs, 600_000, "sous « limites »");
  assert.deepEqual(parseLimits({ extraits: { extraitDureeMaxMs: 120_000 } })?.extraitDureeMaxMs, 120_000, "sous « extraits »");
  const per = parseLimits({ extraitDureeMaxMs: 600_000, formats: { gif: { extraitDureeMaxMs: 60_000 } }, extraitDureeMaxMsParFormat: { mp3: 1_200_000 } })!;
  assert.deepEqual(per.parFormat, { mp3: 1_200_000, gif: 60_000 });
  assert.equal(maxClipMs(per, "mp4"), 600_000);
  assert.equal(maxClipMs(per, "gif"), 60_000, "le plus strict");
  assert.equal(maxClipMs(per, "mp3"), 600_000, "le plus strict des deux, même si le format annonce plus");
  assert.equal(maxClipMs(null, "mp4"), null, "aucune limite inventée");
  assert.equal(parseLimits({ extraitDureeMaxMs: -5, quotaJour: "10" }), null, "valeurs refusées : rien d'exploitable");
  assert.equal(parseLimits({ extraitDureeMaxMs: Number.POSITIVE_INFINITY }), null);
  assert.equal(parseLimits([1, 2]), null);
  assert.equal(parseLimits(null), null);
  assert.equal(parseLimits({ extraitDureeMaxMs: 30_000.4 })?.extraitDureeMaxMs, 30_000);
  // Réponse réelle de ytapi (branche feat/extraits-backend, app/main.py « /limites »).
  const ytapi = parseLimits({
    extraitsActifs: true, formats: ["mp4", "mp3", "gif"], extraitDureeMaxMs: 600_000, dureeMaxParFormatMs: { mp4: 600_000, mp3: 600_000, gif: 60_000 },
    gifDureeMaxMs: 60_000, sortieTailleMaxOctets: 1_073_741_824, telechargementMaxOctets: 2_147_483_648, traitementMaxS: 900, simultanesMax: 2,
    quotaJour: 10, restantAujourdhui: 0, actifsMaxParCompte: 1,
  })!;
  assert.deepEqual(ytapi.parFormat, { mp4: 600_000, mp3: 600_000, gif: 60_000 });
  assert.equal(maxClipMs(ytapi, "gif"), 60_000);
  assert.equal(ytapi.restantAujourdhui, 0, "zéro est une valeur (quota atteint)");
  assert.equal(ytapi.extraitsActifs, true);
  assert.equal(parseLimits({ extraitsActifs: false })?.extraitsActifs, false, "extraits coupés : dit tel quel");
  assert.equal(parseLimits({ quotaJour: null, restantAujourdhui: null, extraitDureeMaxMs: 600_000 })?.quotaJour, null, "illimité");
  assert.equal(formatBytes(4_294_967_296), `4${NB}Go`);
  assert.equal(formatBytes(1_610_612_736), `1,5${NB}Go`);
  assert.equal(formatBytes(800 * 1024 * 1024), `800${NB}Mo`);
});

test("ligne des limites et du quota : valeurs du serveur, quota du compte, absence dite", () => {
  const v = (limits: unknown, quota: LimitsView["quota"] = null): LimitsView => ({ limits: parseLimits(limits), quota, source: limits ? "serveur" : "indisponible" });
  assert.equal(limitText(v(CONTRACT), "mp4"), "Jusqu’à 10 min par extrait");
  assert.equal(limitText(v({ extraitDureeMaxMs: 90_000 }), "gif"), `Jusqu’à 1${NB}min 30${NB}s par extrait`);
  assert.equal(limitText(v(null), "mp4"), `Limite de durée non communiquée${NB}: le serveur vérifiera l’extrait`);
  assert.equal(limitText(null, "mp4"), "Limites du serveur en cours de lecture…");
  assert.equal(quotaText(v(CONTRACT, { used: 3, limit: 10, remaining: 7 })), "7 exports restants aujourd’hui");
  assert.equal(quotaText(v(CONTRACT, { used: 9, limit: 10, remaining: 1 })), "1 export restant aujourd’hui");
  assert.equal(quotaText(v(CONTRACT, { used: 10, limit: 10, remaining: 0 })), "Quota du jour atteint");
  assert.equal(quotaText(v(CONTRACT, { used: 4, limit: null, remaining: null })), "Exports illimités aujourd’hui");
  assert.equal(quotaText(v(CONTRACT)), "10 exports par jour", "sans compte connu : la configuration");
  assert.equal(quotaText(v(null)), null);
  assert.equal(quotaExhausted(v(CONTRACT, { used: 10, limit: 10, remaining: 0 })), true);
  assert.equal(quotaExhausted(v(CONTRACT, { used: 1, limit: 10, remaining: 9 })), false);
  assert.equal(quotaExhausted(null), false, "inconnu : le serveur reste juge");
});

test("étapes : contrat (etape ou stage), anciennes étapes traduites, progression SEULEMENT si mesurée, jamais de recul", () => {
  assert.deepEqual([...ETAPES], ["analyse", "recuperation", "conversion", "finalisation", "termine"]);
  assert.equal(etapeOf({ etape: "recuperation" }), "recuperation");
  assert.equal(etapeOf({ stage: "conversion" }), "conversion");
  assert.equal(etapeOf({ stage: "downloading" }), "recuperation", "ancienne étape");
  assert.equal(etapeOf({ stage: "clipping" }), "conversion");
  assert.equal(etapeOf({ stage: "finalizing" }), "finalisation");
  assert.equal(etapeOf({ stage: "done" }), "termine");
  assert.equal(etapeOf({ stage: "inconnue" }), null);
  assert.equal(etapeOf({ etape: "attente", stage: "queued" }), null, "en file : pas une étape (rien n'a commencé)");
  assert.equal(etapeOf({ stage: "queued" }), null);
  assert.equal(etapeOf({ etape: "erreur", stage: "error" }), null);
  assert.equal(etapeOf({ etape: "annule" }), null);
  assert.equal(etapeOf({ etape: "analyse", stage: "extracting" }), "analyse", "forme de ytapi (feat/extraits-backend)");
  assert.equal(etapeOf({ stage: "__proto__" }), null);
  assert.equal(etapeOf("analyse"), null);
  assert.equal(progressionOf({ progression: 0.42 }), 42);
  assert.equal(progressionOf({ progression: 1 }), 100);
  assert.equal(progressionOf({ progress: 50 }), null, "l'ancien champ toujours présent n'est pas une mesure");
  assert.equal(progressionOf({ progression: 1.5 }), null);
  assert.equal(progressionOf({ progression: "0.5" }), null);
  assert.equal(progressionOf({}), null);
  assert.equal(laterEtape("conversion", "recuperation"), "conversion", "jamais de recul");
  assert.equal(laterEtape("analyse", "finalisation"), "finalisation");
  assert.equal(laterEtape(undefined, "analyse"), "analyse");
  assert.equal(laterEtape("analyse", null), "analyse");
});

test("avancement : titre de l'étape, pourcentage seulement s'il est mesuré, phrases, erreurs dédiées", () => {
  const v = (p: Partial<ExportView>): ExportView => ({ phase: "converting", etape: "recuperation", progress: null, format: "mp4", canCancel: true, canShow: false, ...p });
  assert.deepEqual(describeExport(v({ progress: 42 })), { title: "Récupération de l’extrait", detail: etapeDetail("recuperation", "mp4"), tone: "busy", pct: `42${NB}%` });
  assert.equal(describeExport(v({})).pct, null, "aucune mesure : aucun pourcentage");
  assert.equal(describeExport(v({ phase: "queued", etape: "analyse" })).title, "Analyse de la source");
  assert.equal(describeExport(v({ etape: "conversion", format: "gif" })).detail, "Fabrication du GIF à partir du passage.");
  assert.equal(describeExport(v({ etape: "conversion", format: "mp3" })).detail, "Encodage de l’audio en MP3.");
  assert.equal(describeExport(v({ phase: "downloading", etape: "finalisation" })).detail, "Enregistrement du fichier dans Téléchargements.");
  assert.equal(describeExport(v({ phase: "done", etape: "termine", progress: 100 })).title, "Terminé");
  assert.equal(describeExport(v({ phase: "done" })).pct, null);
  assert.equal(describeExport(v({ phase: "sending", etape: null })).title, "Envoi au serveur…");
  assert.deepEqual(describeExport(v({ phase: "queued", etape: null })), { title: "En attente du serveur", detail: "L’export démarre dès qu’une place se libère sur le serveur.", tone: "busy", pct: null });
  assert.equal(describeExport(v({ phase: "cancelled" })).title, "Export annulé");
  const err = (code: string) => describeExport(v({ phase: "error", error: { code, message: "Message du serveur.", retryable: false } }));
  assert.deepEqual(err("extrait_partiel_impossible"), { title: "Extraction partielle impossible", detail: "Message du serveur.", tone: "bad", pct: null });
  assert.equal(err("quota_exceeded").title, "Quota du jour atteint");
  assert.equal(err("network").title, "Serveur injoignable");
  assert.equal(err("extrait_trop_long").title, "Export impossible");
  assert.equal(shownEtape(v({ phase: "downloading", etape: null })), "finalisation");
  assert.equal(shownEtape(v({ phase: "queued", etape: null })), "analyse");
  assert.equal(shownEtape(v({ phase: "done", etape: "conversion" })), "termine");
});

test("commande des pages : un extrait affiche son étape réelle (« Récupération de l’extrait »), pas « Conversion… 50 % »", () => {
  const job = parseJob({ key: "jobkey36clip01", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", state: "converting", clip: { start: 1, end: 2 }, etape: "recuperation", updatedAt: 1 })!;
  assert.equal(job.clip, true);
  assert.equal(job.etape, "recuperation");
  const d = describeJob(job);
  assert.equal(d.label, "Récupération de l’extrait");
  assert.equal(d.short, "Récupération");
  assert.equal(d.progress, null, "indéterminé");
  const measured = describeJob({ ...job, progress: 42 });
  assert.equal(measured.label, `Récupération de l’extrait · 42${NB}%`);
  assert.equal(measured.short, `42${NB}%`);
  assert.equal(describeJob({ ...job, state: "done" }).label, "Enregistré", "« Enregistré » seulement pour un fichier écrit");
  assert.equal(parseJob({ key: "jobkey36clip02", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", state: "queued", etape: "piratage", updatedAt: 1 })?.etape, undefined, "étape inconnue ignorée");
  assert.equal(describeJob({ state: "converting", progress: 42 }).label, `Conversion… 42${NB}%`, "vidéo entière : inchangé");
});

test("typographie de l'éditeur : insécable avant « : ; ! ? % » et dans « », apostrophe ’, points de suspension", () => {
  const all: string[] = [
    ...Object.values(X), ...Object.values(ETAPE_LABEL),
    ...ETAPES.flatMap((e) => (["mp4", "mp3", "gif"] as const).flatMap((f) => [etapeDetail(e, f), etapeDetail(e, f, true)])),
    ADJUST.clampedEnd("00:10:00.000"), ADJUST.clampedZero("début"), ADJUST.clampedZero("fin"), ADJUST.followedEnd(), ADJUST.followedStart(), ADJUST.maxApplied(`10${NB}min`),
    etapeTitle("recuperation", 42), etapeTitle("conversion", null), progressAria("recuperation", null), progressAria("conversion", 42), progressAria(null, null),
    stepAria(1, "recuperation", "en cours"), formatNote("mp4", "1080p"), formatNote("mp4", "Auto"), formatNote("mp3"), formatNote("gif"),
    ...(["empty", "invalid", "negative", "range", "too_long"] as const).map(timecodeErrorText),
    // 3.8.0 (TimeLens)
    TL.bubble(30_000), TL.bubbleNear(552_000, 600_000), TL.bubbleMax(600_000), TL.bubbleGif(30_000), TL.range(12_500, 42_500, false),
    TL.now(83_400, true), TL.hereAria("start", 83_400), TL.hereAria("end", null), TL.placed("start", 83_400), TL.placed("end", 600_000),
    TL.followLimit("start", 600_000), TL.followLimit("end", 600_000), TL.limitReached(600_000), TL.passage(12_500, 42_500),
    TL.preset(15_000), TL.preset(60_000), TL.presetAria(15_000, 12_500), TL.presetSaid(60_000, 12_500), TL.presetGif(30_000), TL.presetMax(600_000),
    TL.gifLine(30_000), TL.gifSaid(30_000), TL.go(30_000, "mp4"), TL.goAria(30_000, "mp4"), TL.toolsTitle(12_500, 42_500, false), TL.quota(3), TL.quota(1),
    TL.hintInaction(), TL.hintHesitation(), TL.hintButee(600_000), TL.hintPrecision(),
  ];
  for (const s of all) {
    // « 00:10:00.000 » : un timecode n'est pas une ponctuation.
    const text = s.replace(/\d{1,2}(:\d{2})+(\.\d+)?/g, "T").replace(/HH:MM:SS\.mmm/g, "T");
    assert.doesNotMatch(text, / [?!:;%»]/, `espace ordinaire avant un signe double : « ${s} »`);
    for (const m of text.matchAll(/[?!:;%»]/g)) assert.equal(text[m.index! - 1], NB, `insécable attendue avant « ${m[0]} » dans « ${s} »`);
    assert.doesNotMatch(s, /'/, `apostrophe droite : ${s}`);
    assert.doesNotMatch(s, /\.\.\./, `trois points : ${s}`);
  }
  assert.equal(ADJUST.clampedZero("fin"), `Un instant ne peut pas être négatif${NB}: fin ramenée à 00:00:00.000.`);
  // Textes exacts de D-SPEC §A (valeurs venues du serveur : 10 min, 30 s ne sont que des exemples).
  assert.equal(TL.bubbleNear(552_000, 600_000), "9:12 · max 10:00");
  assert.equal(TL.bubbleMax(600_000), "10:00 · maximum");
  assert.equal(TL.bubbleGif(30_000), "0:30 en GIF");
  assert.equal(TL.go(30_000, "mp4"), "Exporter 0:30 en MP4");
  assert.equal(TL.go(75_900, "mp3"), "Exporter 1:15.9 en MP3");
  assert.equal(TL.goAria(30_000, "mp4"), `Exporter 0:30 en MP4, un extrait de 30${NB}secondes`);
  assert.equal(TL.limitReached(600_000), `Durée maximale atteinte${NB}: 10${NB}min par extrait.`);
  assert.equal(TL.gifLine(30_000), `Un GIF dure 30${NB}s au plus${NB}: seul le début du passage (30${NB}s) sera exporté.`);
  assert.equal(TL.hereAria("start", 83_400), `Marquer le début ici, lecteur à 1${NB}minute 23,4${NB}secondes`);
  assert.equal(TL.presetAria(15_000, 12_500), `15${NB}secondes à partir de 12,5${NB}secondes`);
  assert.equal(TL.presetSaid(60_000, 12_500), `Durée${NB}: 1${NB}minute, à partir de 12,5${NB}secondes.`);
  assert.equal(TL.passage(12_500, 42_500), `Passage de 12,5${NB}secondes à 42,5${NB}secondes, durée 30${NB}secondes.`);
  assert.equal(TL.followLimit("start", 600_000), `Le début suit${NB}: le serveur accepte 10${NB}min par extrait.`);
  assert.equal(TL.quota(1), "Plus qu’un export aujourd’hui");
  assert.equal(TL.hintInaction(), `Lis la vidéo jusqu’au bon moment, puis «${NB}Début ici${NB}».`);
  assert.equal(X.startHere, "Début ici");
  assert.equal(X.endHereAria, "Marquer la fin ici");
});
