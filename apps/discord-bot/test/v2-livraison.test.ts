// Panne du 2026-10-12 (bot réel) : la carte finale de /convert était REFUSÉE par Discord (emoji « ☆ » invalide sur le bouton
// « Enregistrer » : « Invalid emoji », toute la carte rejetée) et le fichier n'était pas joint quand Discord annonçait une
// limite d'envoi au-delà de ce qu'account accepte. Ces tests verrouillent la correction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, MAX_ATTACHMENT, attachLimit, discordError } from "../src/v2/router.ts";
import {
  BUTTON_EMOJIS, accountCard, configCard, detectCard, errorCard, helpCard, prefsCard, previewCard, resultCard, savedItemCard, savedListCard, sharedCard,
  type Features,
} from "../src/v2/ui.ts";
import { ALL, bench, fakeYtapi, ix, last, MB, PREVIEW, settle, SITE, textOf, TIKTOK } from "./fakes-v2.ts";

const F: Features = { ...ALL, preview: true, compress: true, clip: true, gif: true, autoEmbeds: true };
const b = { site: SITE, emoji: "<:aethryon:1559148807717916752>" };
const done = async (i: { calls: { m: string; r?: unknown }[] }, re = /MÉDIA PRÊT|ÉCHEC/) => {
  for (let k = 0; k < 60 && !i.calls.some((c) => c.m === "edit" && re.test(textOf(c.r))); k++) await settle();
};

test("toutes les cartes : seulement des emojis de boutons acceptés par Discord (jamais « ☆ »)", () => {
  const meta = { url: TIKTOK, platform: "tiktok", title: "T", creator: "nasa", durationS: 12 };
  const result = { meta, fmt: "mp4" as const, jobId: "job-1", owner: "1", title: "T", sizeBytes: 3 * MB, shareAllowed: true, downloadUrl: `${SITE}/x`, tooBigForDiscord: true };
  const today = { used: 1, limit: 10, remaining: 9, resetAt: "x" };
  const resolved = { linked: true as const, status: "active" as const, user: { name: "n", email: "e" }, discord: { name: "d", linkedAt: "2026-10-12T10:00:00Z", lastUsedAt: null }, today, maxActive: 1 };
  const item = { id: "s1xxxxxxx", platform: "tiktok" as const, url: TIKTOK, mediaType: "video" as const, title: "T", creator: "c", durationS: 3, origin: "discord", savedAt: "2026-10-12T10:00:00Z" };
  const cards = [
    detectCard(b, meta, "1", F), detectCard(b, meta, "*", F, { auto: true }), previewCard(b, TIKTOK, PREVIEW, "1", F, 10 * MB),
    resultCard(b, result, F), resultCard(b, { ...result, attachment: { name: "a.mp4", type: "video/mp4" }, tooBigForDiscord: false }, F),
    sharedCard(b, { ...result, attachment: { name: "a.mp4", type: "video/mp4" } }, "1", F), errorCard(b, "download_failed", meta, "1", "mp4"),
    accountCard(b, resolved, F), helpCard(b, "accueil", F), prefsCard(b, { fmt: "mp4", quality: "auto", visibility: "private", locale: "auto" }),
    configCard(b, { autoEmbeds: false, platforms: ["youtube"], channels: [], buttons: true, share: false, quality: "auto", perHour: 30, original: "keep", mode: "card" }, F),
    savedListCard(b, { items: [item], total: 1, max: 200 }, 0, "1", ""), savedItemCard(b, item, "1", F),
  ];
  for (const card of cards) {
    const json = JSON.stringify(card);
    assert.ok(!json.includes("☆"), "« ☆ » est refusé par Discord");
    for (const m of json.matchAll(/"emoji":\{"name":"([^"]+)"\}/g)) assert.ok(BUTTON_EMOJIS.has(m[1]!), `emoji non vérifié : ${m[1]}`);
  }
  assert.match(JSON.stringify(cards[0]), /"emoji":\{"name":"⭐"\}/, "« Enregistrer » garde un emoji, valide");
});

test("limite d'envoi effective : celle de Discord, plafonnée à 25 Mio (mémoire du bot, account ≤ 500 Mio)", () => {
  assert.equal(MAX_ATTACHMENT, 25 * MB);
  assert.equal(attachLimit({ attachmentSizeLimit: 10 * MB }), 10 * MB);
  assert.equal(attachLimit({ attachmentSizeLimit: 524_288_000 }), 25 * MB, "Nitro (500 Mio) : plafonné");
  assert.equal(attachLimit({ attachmentSizeLimit: 2 * 1024 * MB }), 25 * MB);
  assert.equal(attachLimit({ attachmentSizeLimit: Number.NaN }), 10 * MB);
});

test("fichier de 3 Mo avec une limite Discord de 500 Mio : JOINT (account appelé avec 25 Mio au plus), livraison journalisée", async () => {
  const B = bench(F);
  const asked: number[] = [];
  const file = B.acc.api.file.bind(B.acc.api);
  B.acc.api.file = async (id: string, job: string, max: number) => { asked.push(max); return file(id, job, max); };
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(3 * MB, 1), name: "Lancement [abc].mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, format: "mp4" }, attachmentSizeLimit: 524_288_000 });
  await B.router.handle(i);
  await done(i);
  assert.deepEqual(asked, [25 * MB]);
  assert.equal((last(i, "edit").r as { files?: unknown[] }).files?.length, 1);
  assert.ok(B.logs.some((l) => l.includes('"msg":"livraison"') && l.includes('"jointe":true') && l.includes('"limite_mo":25')), B.logs.join("\n"));
});

test("fichier de 30 Mo : pas de pièce jointe (lien), raison « trop_lourd » journalisée, aucun appel du fichier", async () => {
  const B = bench(F, fakeYtapi({ size: 30 * MB }));
  let called = 0;
  B.acc.api.file = async () => { called++; return { ok: false as const, error: "x" }; };
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK }, attachmentSizeLimit: 524_288_000 });
  await B.router.handle(i);
  await done(i);
  assert.equal(called, 0);
  assert.match(textOf(last(i, "edit").r), /jeton=/);
  assert.ok(B.logs.some((l) => l.includes('"raison":"trop_lourd"')));
});

test("carte finale refusée par Discord : erreur détaillée au journal, puis carte de secours avec le lien (le fichier arrive)", async () => {
  const B = bench(F);
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(MB, 1), name: "a.mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  const edit = i.edit.bind(i);
  i.edit = async (r) => {
    if (/MÉDIA PRÊT/.test(textOf(r)) && /attachment:\/\//.test(textOf(r))) {
      const e = Object.assign(new Error("Invalid Form Body"), { name: "DiscordAPIError[50035]", code: 50035, status: 400,
        rawError: { errors: { components: { 0: { components: { 5: { components: { 2: { emoji: { name: { _errors: [{ code: "COMPONENT_INVALID_EMOJI", message: "Invalid emoji" }] } } } } } } } } } } });
      throw e;
    }
    return edit(r);
  };
  await B.router.handle(i);
  for (let k = 0; k < 60 && !i.calls.some((c) => c.m === "edit" && /Télécharger/.test(textOf(c.r))); k++) await settle();
  const t = textOf(last(i, "edit").r);
  assert.match(t, /Ton fichier est prêt/);
  assert.match(t, /jeton=/);
  const warn = B.logs.find((l) => l.includes("message non modifié"))!;
  assert.match(warn, /"code":50035/);
  assert.match(warn, /COMPONENT_INVALID_EMOJI/);
  assert.ok(B.logs.some((l) => l.includes('"code":"secours"')), "secours journalisé");
});

test("résumé d'erreur Discord : code, statut, champs ; rien du contenu", () => {
  const r = discordError({ name: "DiscordAPIError[50035]", code: 50035, status: 400, rawError: { errors: { a: { b: { _errors: [{ code: "X", message: "secret?" }] } } } } });
  assert.deepEqual(r, { code: 50035, statut: 400, champs: "a.b:X", erreur: "DiscordAPIError[50035]" });
  assert.deepEqual(discordError(new Error("boom")), { code: null, statut: null, champs: null, erreur: "Error" });
});
