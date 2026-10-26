// Partage natif dans Discord (2026-10-13). Panne d'origine : le bouton « Partager ici » différait une réponse
// ÉPHÉMÈRE puis envoyait la carte publique en suivi ; or « When using this endpoint directly after responding to an
// interaction with DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE […] no new message will be created, and the loading message will
// be edited instead. The ephemeral flag will be ignored » (docs Discord) : le « partage » restait privé, puis était
// remplacé par « ✓ Partagé ». Et un serveur où seul l'utilisateur a installé AETHRYON ne pouvait jamais partager.
// Ces tests verrouillent : la règle par lieu et mode d'installation, une réponse PUBLIQUE dès la première réponse,
// jamais de suivi juste après une réponse différée, et ce que Discord impose réellement (éphémère forcé).
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateIsEphemeral, REFUSAL_TEXT, sharePolicy, whereOf, type Where } from "../src/v2/context.ts";
import type { V2Reply } from "../src/replies.ts";
import { ALL, bench, fakeYtapi, GUILD, ix, last, ME, MB, OTHER, settle, textOf, TIKTOK } from "./fakes-v2.ts";
import { sourceOf } from "../src/v2/ui.ts";

const W = (o: Partial<Where>): Where => ({ place: "guild", guildInstall: true, userInstall: false, externalApps: null, appAttach: true, ...o });
const USER_ONLY = (externalApps: boolean | null): Where => ({ place: "guild", guildInstall: false, userInstall: true, externalApps, appAttach: true });
const until = async (i: { calls: { m: string; r?: unknown }[] }, re: RegExp) => {
  for (let k = 0; k < 40 && !i.calls.some((c) => (c.m === "edit" || c.m === "followUp") && re.test(textOf(c.r))); k++) await settle();
  await settle();
};

test("whereOf : contexte et modes d'installation tirés de l'interaction", () => {
  const g = "123123123123123123";
  assert.deepEqual(whereOf({ context: 0, guildId: g, userId: ME, owners: { 0: g }, memberExternalApps: true, appAttach: true }),
    { place: "guild", guildInstall: true, userInstall: false, externalApps: true, appAttach: true });
  assert.deepEqual(whereOf({ context: 0, guildId: g, userId: ME, owners: { 1: ME }, memberExternalApps: false, appAttach: true }),
    { place: "guild", guildInstall: false, userInstall: true, externalApps: false, appAttach: true }, "installé seulement sur le compte : le bot n'est pas sur ce serveur");
  assert.equal(whereOf({ context: 0, guildId: g, userId: ME, owners: { 0: g, 1: ME }, memberExternalApps: null, appAttach: null }).userInstall, true);
  assert.equal(whereOf({ context: 1, guildId: null, userId: ME, owners: { 1: ME }, memberExternalApps: null, appAttach: true }).place, "bot_dm");
  assert.equal(whereOf({ context: 2, guildId: null, userId: ME, owners: { 1: ME }, memberExternalApps: null, appAttach: true }).place, "private");
});

test("sharePolicy : la matrice des lieux (serveur installé, compte seul, applications externes, messages privés, groupes)", () => {
  assert.deepEqual(sharePolicy(W({}), null, true), { public: true }, "serveur installé, jamais réglé : permis");
  assert.deepEqual(sharePolicy(W({}), true, true), { public: true });
  assert.deepEqual(sharePolicy(W({}), false, true), { public: false, reason: "server_off" }, "désactivé par /config");
  assert.deepEqual(sharePolicy(W({ appAttach: false }), true, true), { public: false, reason: "no_attach" });
  assert.deepEqual(sharePolicy(USER_ONLY(true), null, true), { public: true }, "compte seul, « Utiliser des applications externes » accordé");
  assert.deepEqual(sharePolicy(USER_ONLY(false), null, true), { public: false, reason: "external_apps" }, "Discord rendrait la réponse éphémère");
  assert.deepEqual(sharePolicy(USER_ONLY(false), true, true), { public: false, reason: "external_apps" }, "/config d'un autre serveur n'y change rien");
  assert.deepEqual(sharePolicy(W({ place: "private", guildInstall: false, userInstall: true }), null, true), { public: true }, "messages privés et groupes");
  assert.deepEqual(sharePolicy(W({ place: "bot_dm", guildInstall: false }), null, true), { public: false, reason: "bot_dm" });
  assert.deepEqual(sharePolicy(W({}), true, false), { public: false, reason: "files_closed" });
  assert.equal(privateIsEphemeral(W({ place: "bot_dm" })), false, "en message privé avec le bot, le fichier reste dans l'historique");
  assert.equal(privateIsEphemeral(W({})), true);
});

test("bouton « Partager ici » : NOUVELLE réponse publique (différée publique puis modifiée avec le fichier), jamais un suivi ; un seul partage", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "Lancement [abc].mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(i);
  await until(i, /MÉDIA PRÊT/);
  assert.deepEqual(i.calls[0], { m: "defer", eph: true }, "privé par défaut");
  const result = last(i, "edit").r as V2Reply;
  const share = /"label":"Partager ici","custom_id":"(ae:share:[^"]+)"/.exec(textOf(result));
  assert.ok(share, "bouton présent : partage permis ici");
  const s = ix("button", { customId: share![1], messageComponents: result.components, messageEphemeral: true });
  await B.router.handle(s);
  assert.deepEqual(s.calls[0], { m: "defer", eph: false }, "réponse différée PUBLIQUE à ce clic");
  assert.ok(!s.calls.some((c) => c.m === "followUp" || c.m === "deferUpdate"), "ni suivi ni modification de la carte privée");
  const pub = last(s, "edit").r as V2Reply;
  assert.equal(pub.files?.[0]?.attachment.length, 2000, "le fichier est dans le message public");
  assert.match(textOf(pub), /partagé par <@112233445566778899>/);
  assert.doesNotMatch(textOf(pub), /quota|jeton=|ae:share/);
  assert.equal(sourceOf(pub.components), TIKTOK);
  assert.ok(B.logs.some((l) => l.includes('"msg":"partage"') && l.includes('"ok":true')), B.logs.join("\n"));
  const again = ix("button", { customId: share![1], messageComponents: result.components, messageEphemeral: true });
  await B.router.handle(again);
  assert.match(textOf(last(again, "reply").r), /Déjà partagé/);
  assert.equal(last(again, "reply").eph, true);
  const other = ix("button", { customId: share![1], userId: OTHER, messageComponents: result.components });
  await B.router.handle(other);
  assert.match(textOf(last(other, "reply").r), /n'est pas pour toi/);
});

test("Discord impose l'éphémère (application du compte sans droit de publier) : on le dit, rien n'est republié en privé", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "a.mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(i);
  await until(i, /MÉDIA PRÊT/);
  const result = last(i, "edit").r as V2Reply;
  const id = /"custom_id":"(ae:share:[^"]+)"/.exec(textOf(result))![1]!;
  const s = ix("button", { customId: id, messageComponents: result.components, messageEphemeral: true });
  s.defer = async (eph: boolean) => { s.calls.push({ m: "defer", eph }); return { ephemeral: true }; };
  await B.router.handle(s);
  const out = last(s, "edit").r as V2Reply;
  assert.equal(out.files, undefined, "aucun fichier envoyé");
  assert.match(textOf(out), /Utiliser des applications externes/);
  assert.ok(B.logs.some((l) => l.includes('"msg":"partage"') && l.includes('"impose":true')));
});

test("serveur où seul l'utilisateur a installé AETHRYON, sans « Utiliser des applications externes » : résultat privé, raison donnée, pas de bouton de partage", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "a.mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, visibility: "share" } });
  i.where = USER_ONLY(false);
  await B.router.handle(i);
  await until(i, /MÉDIA PRÊT/);
  assert.deepEqual(i.calls[0], { m: "defer", eph: true });
  const t = textOf(last(i, "edit").r);
  assert.match(t, new RegExp(REFUSAL_TEXT.external_apps.slice(0, 40).replace(/[()]/g, ".")));
  assert.doesNotMatch(t, /ae:share/);
  assert.ok(B.logs.some((l) => l.includes('"visibilite":"privé"') && l.includes('"installation":"compte"')), B.logs.join("\n"));
  // Le même serveur avec la permission : public, sans réglage /config (le bot n'y est pas).
  const C = bench();
  C.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "a.mp4", type: "video/mp4" });
  const j = ix("command", { commandName: "convert", opts: { url: TIKTOK, visibility: "share" } });
  j.where = USER_ONLY(true);
  await C.router.handle(j);
  await until(j, /partagé par/);
  assert.deepEqual(j.calls[0], { m: "defer", eph: false });
  assert.equal((last(j, "edit").r as V2Reply).files?.length, 1);
});

test("/convert public, puis Discord rend la réponse éphémère : résultat privé avec l'explication (pas de faux « partagé »)", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "a.mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, visibility: "share" } });
  i.where = USER_ONLY(null);
  i.defer = async (eph: boolean) => { i.calls.push({ m: "defer", eph }); return { ephemeral: true }; };
  await B.router.handle(i);
  await until(i, /MÉDIA PRÊT/);
  const t = textOf(last(i, "edit").r);
  assert.doesNotMatch(t, /partagé par/);
  assert.match(t, /Utiliser des applications externes/);
  assert.ok(B.logs.some((l) => l.includes('"impose":true')));
});

test("groupe ou message privé entre amis (installation sur le compte) : public permis ; message privé avec le bot : message normal, sans partage", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "a.mp3", type: "audio/mpeg" });
  const g = ix("command", { commandName: "audio", opts: { url: TIKTOK, visibility: "share" }, guildId: null });
  g.where = { place: "private", guildInstall: false, userInstall: true, externalApps: null, appAttach: true };
  await B.router.handle(g);
  await until(g, /partagé par/);
  assert.deepEqual(g.calls[0], { m: "defer", eph: false });
  const pub = last(g, "edit").r as V2Reply;
  assert.match(pub.files![0]!.name, /\.mp3$/);
  assert.match(textOf(pub), /"type":13/, "MP3 : composant fichier");
  const C = bench();
  C.acc.state.files.set("job-1", { bytes: Buffer.alloc(2000, 1), name: "a.mp4", type: "video/mp4" });
  const d = ix("command", { commandName: "convert", opts: { url: TIKTOK }, guildId: null });
  d.where = { place: "bot_dm", guildInstall: false, userInstall: true, externalApps: null, appAttach: true };
  await C.router.handle(d);
  await until(d, /MÉDIA PRÊT/);
  assert.deepEqual(d.calls[0], { m: "defer", eph: false }, "message normal : il reste dans l'historique");
  assert.doesNotMatch(textOf(last(d, "edit").r), /ae:share/);
});

test("public mais trop lourd pour être joint : carte publique SANS lien personnel posée d'abord, puis le lien en privé", async () => {
  const B = bench(ALL, fakeYtapi({ size: 30 * MB }));
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, visibility: "share" }, attachmentSizeLimit: 10 * MB });
  await B.router.handle(i);
  await until(i, /jeton=/);
  assert.deepEqual(i.calls[0], { m: "defer", eph: false });
  const edits = i.calls.filter((c) => c.m === "edit").map((c) => textOf(c.r));
  const fu = i.calls.findIndex((c) => c.m === "followUp");
  const lite = i.calls.findIndex((c) => c.m === "edit" && /trop lourd pour être joint ici/.test(textOf(c.r)));
  assert.ok(lite >= 0 && fu > lite, "la carte publique est posée AVANT le suivi privé (sinon le suivi remplacerait la réponse)");
  assert.equal(i.calls[fu]!.eph, true, "le lien personnel part en privé");
  assert.match(textOf(i.calls[fu]!.r), /jeton=/);
  assert.ok(edits.every((t) => !/jeton=/.test(t)), "jamais de lien personnel dans la réponse publique");
});

test("menu « Convertir avec AETHRYON » : aperçu privé (grande miniature, MP4, MP3), puis résultat privé partageable", async () => {
  const B = bench({ ...ALL, preview: true });
  const m = ix("messageMenu", { target: { content: `regarde ${TIKTOK}`, urls: [], authorId: OTHER } });
  await B.router.handle(m);
  await until(m, /APERÇU/);
  const prev = last(m, "edit").r as V2Reply;
  assert.deepEqual(m.calls[0], { m: "defer", eph: true });
  assert.match(textOf(prev), /"type":12/);
  assert.match(textOf(prev), /ae:conv:112233445566778899:mp4/);
  assert.match(textOf(prev), /ae:conv:112233445566778899:mp3/);
  void GUILD;
});

test("profil Discord : le nom affiché et l'empreinte de l'image vus dans l'interaction partent vers account (espace › Discord)", async () => {
  const B = bench();
  const i = ix("command", { commandName: "quota" });
  i.user = { id: ME, username: "alice_", globalName: "Alice", avatar: "c".repeat(32) };
  await B.router.handle(i);
  for (let k = 0; k < 20 && !B.acc.state.profiles.length; k++) await settle();
  assert.deepEqual(B.acc.state.profiles[0], { name: "alice_", display: "Alice", avatar: "c".repeat(32) });
});
