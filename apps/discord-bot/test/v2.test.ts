// Bot v2 (docs/DISCORD-BOT.md §18) : routeur, cartes et commandes, avec de FAUSSES interactions (aucune requête vers
// Discord), un faux account et un faux ytapi. Un simulateur prouve la logique, pas le rendu réel de Discord : celui-ci se
// vérifie sur le serveur de test (docs/DISCORD-BOT.md §18.8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountError, type GuildSettings, type Prefs, type Resolved, type SavedItem } from "../src/account.ts";
import { createFlights } from "../src/live.ts";
import { createRateLimiter } from "../src/ratelimit.ts";
import type { AnyReply, V2Reply } from "../src/replies.ts";
import { commandsV2, MESSAGE_MENU } from "../src/v2/commands.ts";
import { createRouter, hasYouTubeMusicLink, linksIn, safeName, type Ix, type IxKind, type RouterDeps } from "../src/v2/router.ts";
import { FLAG_V2, NO_FEATURES, sourceOf, type Features } from "../src/v2/ui.ts";

import { ALL, bench, fakeAccount, fakeYtapi, GUILD, isV2, ix, last, MB, ME, OTHER, settle, SITE, textOf, TIKTOK, type Call } from "./fakes-v2.ts";

// ---- tests ------------------------------------------------------------------------------------------------------

test("liens dans un message : texte puis aperçus, sans doublon, ponctuation finale retirée, plateformes prises en charge seulement", () => {
  assert.deepEqual(linksIn(`regarde ${TIKTOK}! et https://evil.com/x et (${TIKTOK})`, ["https://x.com/NASA/status/1883228395842023524", "https://instagram.com/p/x"]),
    [TIKTOK, "https://x.com/NASA/status/1883228395842023524"]);
  assert.deepEqual(linksIn("rien ici"), []);
  assert.equal(safeName("Lancement : Artemis «II» [abc].mp4", "mp4"), "Lancement_Artemis_II_abc.mp4");
  assert.equal(safeName("", "mp3"), "aethryon.mp3");
});

test("commandes : seulement les fonctions ouvertes ; serveur de test sans contextes ; global serveur + utilisateur ; /config réservée", () => {
  assert.deepEqual(commandsV2(NO_FEATURES, "guild").map((c) => c.name), ["status", "help"]);
  const guild = commandsV2(ALL, "guild");
  assert.deepEqual(guild.map((c) => c.name), ["convert", "audio", MESSAGE_MENU.name, "account", "quota", "history", "saved", "settings", "config", "status", "help"]);
  for (const c of guild) {
    assert.ok(!("integration_types" in c) && !("contexts" in c), `${c.name} : pas de contexte pour une commande de serveur`);
    if (c.type === 1) {
      assert.match(c.name, /^[a-z]{1,32}$/);
      assert.ok(c.description!.length <= 100 && c.description_localizations!.fr.length <= 100, c.name);
    } else {
      assert.ok(c.name.length <= 32 && c.name_localizations!.fr.length <= 32);
      assert.ok(!c.description, "un menu contextuel n'a pas de description");
    }
  }
  const global = commandsV2(ALL, "global");
  const cfg = global.find((c) => c.name === "config")!;
  assert.deepEqual([cfg.integration_types, cfg.contexts, cfg.default_member_permissions], [[0], [0], "32"]);
  for (const c of global.filter((x) => x.name !== "config")) assert.deepEqual([c.integration_types, c.contexts], [[0, 1], [0, 1, 2]], c.name);
  assert.deepEqual(guild.find((c) => c.name === "convert")!.options!.map((o) => o.name), ["url", "format", "quality", "visibility"]);
  assert.deepEqual(commandsV2({ ...ALL, files: false }, "guild").find((c) => c.name === "convert")!.options!.map((o) => o.name), ["url", "format", "quality"], "partage seulement avec les pièces jointes");
});

test("/help : carte V2 privée, sujets au menu, aucune mention possible", async () => {
  const { router } = bench();
  const i = ix("command", { commandName: "help" });
  await router.handle(i);
  const c = last(i, "reply");
  assert.equal(c.eph, true);
  assert.ok(isV2(c.r));
  assert.deepEqual((c.r as V2Reply).allowedMentions, { parse: [] });
  const s = ix("select", { customId: "ae:help", values: ["menu"] });
  await router.handle(s);
  assert.match(textOf(last(s, "update").r), /Applications › Convertir avec AETHRYON/);
});

test("/account link : panneau privé vers le site (aucun secret), puis « Compte connecté » dès la liaison faite sur le site", async () => {
  const B = bench();
  B.acc.state.linked.delete(ME);
  const i = ix("command", { commandName: "account", subcommand: "link" });
  await B.router.handle(i);
  const panel = textOf(last(i, "reply").r);
  assert.match(panel, /dashboard\/discord\?depuis=discord/);
  assert.match(panel, /jamais de mot de passe ni de jeton/);
  assert.doesNotMatch(panel, /ytc_|jeton=/);
  await new Promise((r) => setTimeout(r, 4));   // au moins une lecture « pas encore lié »
  assert.ok(B.acc.state.calls.filter((c) => c === "resolve").length >= 2, "la page interroge le compte en attendant");
  B.acc.state.linked.add(ME);   // liaison faite sur le site
  for (let k = 0; k < 10 && !i.calls.some((c) => c.m === "edit"); k++) await settle();
  const done = textOf(last(i, "edit").r);
  assert.match(done, /✓ Compte connecté/);
  assert.match(done, /ae:acct:status/);
  assert.match(done, /8 conversions restantes/);
});

test("/account link : l'attente s'arrête d'elle-même (message honnête), et un compte déjà lié l'est tout de suite", async () => {
  const B = bench();
  B.acc.state.linked.delete(ME);
  const i = ix("command", { commandName: "account", subcommand: "link" });
  await B.router.handle(i);
  for (let k = 0; k < 40 && !i.calls.some((c) => c.m === "edit"); k++) await settle();
  assert.match(textOf(last(i, "edit").r), /Liaison non terminée/);
  B.acc.state.linked.add(ME);
  const j = ix("command", { commandName: "account", subcommand: "link" });
  await B.router.handle(j);
  assert.match(textOf(last(j, "reply").r), /✓ Compte connecté/);
});

test("/account status, /quota, /history : données réelles, nom neutralisé, jamais de lien ; non lié, suspendu, injoignable", async () => {
  const B = bench();
  const s = ix("command", { commandName: "account", subcommand: "status" });
  await B.router.handle(s);
  const card = textOf(last(s, "edit").r);
  assert.match(card, /Ton compte AETHRYON/);
  assert.doesNotMatch(card, /<@everyone>/, "mention neutralisée");
  assert.match(card, /8 conversions restantes aujourd'hui \(2\/10\)/);
  const q = ix("command", { commandName: "quota" });
  await B.router.handle(q);
  assert.match(textOf(last(q, "edit").r), /8 conversions restantes/);
  const h = ix("command", { commandName: "history" });
  await B.router.handle(h);
  const hist = textOf(last(h, "edit").r);
  assert.match(hist, /TikTok · MP4 · ✓ Terminée/);
  assert.doesNotMatch(hist, /tiktok\.com/);
  B.acc.state.linked.delete(ME);
  const n = ix("command", { commandName: "account", subcommand: "status" });
  await B.router.handle(n);
  assert.match(textOf(last(n, "edit").r), /Compte non lié/);
  B.acc.state.linked.add(ME); B.acc.state.suspended.add(ME);
  const su = ix("command", { commandName: "quota" });
  await B.router.handle(su);
  assert.match(textOf(last(su, "edit").r), /Compte suspendu/);
  B.acc.state.suspended.clear(); B.acc.state.down = true;
  const dn = ix("command", { commandName: "account", subcommand: "status" });
  await B.router.handle(dn);
  assert.match(textOf(last(dn, "edit").r), /Compte injoignable/);
});

test("/account unlink : confirmation, puis déliaison réelle ; « Annuler » ne délie rien", async () => {
  const B = bench();
  const c = ix("command", { commandName: "account", subcommand: "unlink" });
  await B.router.handle(c);
  assert.match(textOf(last(c, "reply").r), /ae:acct:unlink-yes/);
  await B.router.handle(ix("button", { customId: "ae:acct:unlink-no" }));
  assert.ok(B.acc.state.linked.has(ME));
  const y = ix("button", { customId: "ae:acct:unlink-yes" });
  await B.router.handle(y);
  assert.ok(!B.acc.state.linked.has(ME));
  assert.match(textOf(last(y, "edit").r), /Compte délié/);
});

test("/convert : un seul message privé mis à jour ; fichier JOINT s'il tient dans la limite (galerie), boutons, clé rendue, journaux sans lien ni titre", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(3 * MB, 1), name: "Lancement [abc].mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, format: "mp4", quality: "720" } });
  await B.router.handle(i);
  for (let k = 0; k < 20 && !textOf(last(i, "edit")?.r).includes("MÉDIA PRÊT"); k++) await settle();
  assert.deepEqual(i.calls[0], { m: "defer", eph: true });
  assert.deepEqual(B.y.calls[0]!.params, { fmt: "mp4", quality: "720" });
  const done = last(i, "edit").r as V2Reply;
  assert.ok(isV2(done));
  assert.equal(done.files?.[0]?.name, "Lancement_abc.mp4");
  assert.equal(done.files?.[0]?.attachment.length, 3 * MB);
  const t = textOf(done);
  assert.match(t, /attachment:\/\/Lancement_abc\.mp4/);
  assert.match(t, /"type":12/, "galerie : lecteur vidéo dans Discord");
  assert.doesNotMatch(t, /jeton=/, "pas de lien de téléchargement quand le fichier est joint");
  assert.match(t, /≤ 720p|≤\\u00a0720p|720p/);
  assert.doesNotMatch(t, /@everyone \*\*/, "titre de la plateforme neutralisé");
  assert.equal(sourceOf(done.components), TIKTOK);
  assert.match(t, /ae:save:112233445566778899/);
  assert.doesNotMatch(t, /conversions restantes|quota/, "carte courte : le quota se lit avec /quota");
  assert.ok(B.acc.state.released >= 1, "clé de conversion rendue");
  assert.ok(i.calls.some((c) => c.m === "edit" && /Téléchargement|▰/.test(textOf(c.r))), "progression réelle affichée");
  const logs = B.logs.join("\n");
  assert.doesNotMatch(logs, /tiktok\.com|Lancement|112233445566778899|ytc_k/);
});

test("/convert : fichier trop gros pour Discord → lien personnel et explication ; sans pièces jointes ouvertes → lien seulement", async () => {
  const B = bench(ALL, fakeYtapi({ size: 30 * MB }));
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(10), name: "x.mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(i);
  for (let k = 0; k < 20 && !textOf(last(i, "edit")?.r).includes("MÉDIA PRÊT"); k++) await settle();
  const t = textOf(last(i, "edit").r);
  assert.match(t, /jeton=/);
  assert.match(t, /Trop lourd pour Discord ici/);
  assert.equal((last(i, "edit").r as V2Reply).files, undefined);
  const C = bench({ ...ALL, files: false });
  const j = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await C.router.handle(j);
  for (let k = 0; k < 20 && !textOf(last(j, "edit")?.r).includes("MÉDIA PRÊT"); k++) await settle();
  assert.match(textOf(last(j, "edit").r), /valable 10\u00a0minutes, une fois/);
});

test("/convert public sur un serveur où AETHRYON est installé : réponse différée PUBLIQUE puis modifiée (jamais un suivi), fichier joint, attribution, aucune donnée de compte ; partage désactivé par /config → privé et expliqué", async () => {
  const B = bench();
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(1000, 1), name: "a.mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, visibility: "share" } });
  await B.router.handle(i);
  for (let k = 0; k < 20 && !textOf(last(i, "edit")?.r).includes("partagé par"); k++) await settle();
  assert.deepEqual(i.calls[0], { m: "defer", eph: false }, "public dès la première réponse : l'état éphémère ne change plus ensuite");
  assert.ok(!i.calls.some((c) => c.m === "followUp"), "aucun suivi : la réponse différée est modifiée");
  const pub = last(i, "edit").r as V2Reply;
  assert.equal(pub.files?.[0]?.attachment.length, 1000, "fichier joint au message public");
  const t = textOf(pub);
  assert.match(t, /partagé par <@112233445566778899>/);
  assert.match(t, /MP4 pour moi/);
  assert.equal(sourceOf(pub.components), TIKTOK);
  assert.doesNotMatch(t, /conversions restantes|quota|jeton=|ae:share/, "aucune donnée de compte, aucun lien personnel en public");
  assert.ok(B.logs.some((l) => l.includes('"msg":"conversion"') && l.includes('"visibilite":"public"') && l.includes('"installation":"serveur"')), B.logs.join("\n"));
  // Partage désactivé par un administrateur : résultat privé, raison donnée, aucun bouton « Partager ici ».
  const C = bench();
  C.acc.state.files.set("job-1", { bytes: Buffer.alloc(1000, 1), name: "a.mp4", type: "video/mp4" });
  await C.acc.api.setGuild(GUILD, { share: false });
  const j = ix("command", { commandName: "convert", opts: { url: TIKTOK, visibility: "share" } });
  await C.router.handle(j);
  for (let k = 0; k < 20 && !textOf(last(j, "edit")?.r).includes("MÉDIA PRÊT"); k++) await settle();
  assert.deepEqual(j.calls[0], { m: "defer", eph: true });
  const priv = textOf(last(j, "edit").r);
  assert.match(priv, /ont désactivé le partage public/);
  assert.doesNotMatch(priv, /ae:share/);
});

test("/convert : lien refusé, conversion déjà en cours, conversion fermée, échec avec « Réessayer »", async () => {
  const B = bench(ALL, fakeYtapi({ error: "download_failed" }));
  const bad = ix("command", { commandName: "convert", opts: { url: "https://evil.com/v" } });
  await B.router.handle(bad);
  assert.match(textOf(last(bad, "reply").r), /Lien non pris en charge/);
  const a = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(a);
  const b2 = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(b2);
  assert.match(textOf(last(b2, "reply").r), /déjà en cours/);
  for (let k = 0; k < 20 && !textOf(last(a, "edit")?.r).includes("ÉCHEC"); k++) await settle();
  const err = textOf(last(a, "edit").r);
  assert.match(err, /Réessayer/);
  assert.match(err, /ae:conv:112233445566778899:mp4/);
  const C = bench(NO_FEATURES);
  const c = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await C.router.handle(c);
  assert.match(textOf(last(c, "reply").r), /pas encore ouverte/);
});

test("YouTube Music fermé (2026-10-23) : jamais détecté ni converti ; /convert, /audio et le menu répondent par le refus de docs/ERREURS.md ; les liens classiques passent", async () => {
  const MUSIC = "https://music.youtube.com/watch?v=dQw4w9WgXcQ";
  const REFUS = "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.";
  // Détection automatique : un lien YouTube Music n'est jamais repris, un lien classique voisin l'est.
  assert.deepEqual(linksIn(`écoute ${MUSIC} et https://m.music.youtube.com/watch?v=x`), []);
  assert.deepEqual(linksIn(`${MUSIC} puis https://youtu.be/dQw4w9WgXcQ`), ["https://youtu.be/dQw4w9WgXcQ"]);
  assert.equal(hasYouTubeMusicLink(`écoute ${MUSIC}`), true);
  assert.equal(hasYouTubeMusicLink("https://youtu.be/dQw4w9WgXcQ", ["https://x.com/NASA/status/1883228395842023524"]), false);
  const B = bench(ALL, fakeYtapi());
  for (const [name, kicker] of [["convert", "CONVERSION"], ["audio", "CONVERSION"]] as const) {
    const c = ix("command", { commandName: name, opts: { url: MUSIC } });
    await B.router.handle(c);
    const text = textOf(last(c, "reply").r);
    assert.ok(text.includes(REFUS), `/${name} : ${text.slice(0, 200)}`);
    assert.ok(text.includes(kicker) && !text.includes("Lien non pris en charge"), name);
  }
  assert.equal(B.y.calls.length, 0, "ytapi n'est jamais appelé");
  // Menu « Applications » : un message qui ne contient que YouTube Music reçoit le refus clair, pas « aucun lien ».
  const only = ix("messageMenu", { target: { content: `vu ça ? ${MUSIC}`, urls: [], authorId: OTHER } });
  await B.router.handle(only);
  assert.ok(textOf(last(only, "reply").r).includes(REFUS));
  assert.equal(B.y.calls.length, 0);
  // Un message avec un lien classique ET un lien YouTube Music garde le comportement d'avant (le classique seul).
  const mixed = ix("messageMenu", { target: { content: `${MUSIC} et ${TIKTOK}`, urls: [], authorId: OTHER } });
  await B.router.handle(mixed);
  const card = last(mixed, "reply");
  assert.equal(sourceOf((card.r as V2Reply).components), TIKTOK);
  // Un lien YouTube classique est toujours converti.
  const ok = ix("command", { commandName: "convert", opts: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  await B.router.handle(ok);
  assert.equal(B.y.calls.length, 1, "le lien classique part chez ytapi comme avant");
});

test("menu « Applications » : un lien → carte privée MP4/MP3 ; plusieurs → choix ; aucun → explication", async () => {
  const B = bench();
  const one = ix("messageMenu", { target: { content: `vu ça ? ${TIKTOK}`, urls: [], authorId: OTHER } });
  await B.router.handle(one);
  const card = last(one, "reply");
  assert.equal(card.eph, true);
  assert.match(textOf(card.r), /ae:conv:112233445566778899:mp4/);
  assert.equal(sourceOf((card.r as V2Reply).components), TIKTOK);
  const many = ix("messageMenu", { target: { content: `${TIKTOK} https://x.com/NASA/status/1883228395842023524`, urls: [], authorId: OTHER } });
  await B.router.handle(many);
  const pickCard = last(many, "reply").r as V2Reply;
  assert.match(textOf(pickCard), /ae:pick:112233445566778899/);
  const pick = ix("select", { customId: `ae:pick:${ME}`, values: ["1"], messageComponents: pickCard.components });
  await B.router.handle(pick);
  assert.equal(sourceOf((last(pick, "update").r as V2Reply).components), "https://x.com/NASA/status/1883228395842023524");
  const none = ix("messageMenu", { target: { content: "bonjour", urls: [], authorId: OTHER } });
  await B.router.handle(none);
  assert.match(textOf(last(none, "reply").r), /Aucun lien pris en charge/);
});

test("boutons : propriétaire seulement (sauf carte publique « * ») ; carte privée transformée sur place ; carte publique → réponse privée", async () => {
  const B = bench();
  const own = (await (async () => { const m = ix("messageMenu", { target: { content: TIKTOK, urls: [], authorId: OTHER } }); await B.router.handle(m); return last(m, "reply").r as V2Reply; })());
  const stranger = ix("button", { customId: `ae:conv:${ME}:mp4`, messageComponents: own.components, userId: OTHER, messageEphemeral: false });
  await B.router.handle(stranger);
  assert.match(textOf(last(stranger, "reply").r), /n'est pas pour toi/);
  const mine = ix("button", { customId: `ae:conv:${ME}:mp3`, messageComponents: own.components, messageEphemeral: true });
  await B.router.handle(mine);
  assert.deepEqual(mine.calls[0], { m: "deferUpdate" }, "carte privée transformée sur place");
  assert.equal((B.y.calls.at(-1)!.params as { fmt: string }).fmt, "mp3");
  for (let k = 0; k < 20 && !textOf(last(mine, "edit")?.r).includes("PRÊT"); k++) await settle();
  B.acc.state.linked.add(OTHER);
  const pub = ix("button", { customId: "ae:conv:*:mp4", messageComponents: own.components, userId: OTHER, messageEphemeral: false });
  await B.router.handle(pub);
  assert.deepEqual(pub.calls[0], { m: "defer", eph: true }, "carte publique : réponse privée à part, avec le compte de qui clique");
});

test("bibliothèque : « Enregistrer » (lien lu sur la carte), doublon, /saved, ouvrir, retirer ; autocomplétion", async () => {
  const B = bench();
  const m = ix("messageMenu", { target: { content: TIKTOK, urls: [], authorId: OTHER } });
  await B.router.handle(m);
  const card = last(m, "reply").r as V2Reply;
  const s1 = ix("button", { customId: `ae:save:${ME}`, messageComponents: card.components });
  await B.router.handle(s1);
  assert.match(textOf(last(s1, "edit").r), /☆ Enregistré/);
  const s2 = ix("button", { customId: `ae:save:${ME}`, messageComponents: card.components });
  await B.router.handle(s2);
  assert.match(textOf(last(s2, "edit").r), /Déjà enregistré/);
  const list = ix("command", { commandName: "saved" });
  await B.router.handle(list);
  const lc = last(list, "edit").r as V2Reply;
  assert.match(textOf(lc), /ae:saved:open:112233445566778899/);
  const id = B.acc.state.saved.get(ME)![0]!.id;
  const open = ix("select", { customId: `ae:saved:open:${ME}`, values: [id] });
  await B.router.handle(open);
  assert.equal(sourceOf((last(open, "update").r as V2Reply).components), TIKTOK);
  const rm = ix("button", { customId: `ae:saved:rm:${ME}:${id}` });
  await B.router.handle(rm);
  assert.equal(B.acc.state.saved.get(ME)!.length, 0);
  B.acc.state.saved.set(ME, [{ id: "s9xxxxxxx", platform: "x", url: "https://x.com/a/status/1", mediaType: "video", title: "Décollage Artemis", creator: null, durationS: null, origin: "discord", savedAt: "2026-10-12T08:00:00Z" }]);
  const ac = ix("autocomplete", { commandName: "saved", focused: { name: "search", value: "Artemis" } });
  await B.router.handle(ac);
  assert.deepEqual(last(ac, "respond").choices, [{ name: "Décollage Artemis", value: "Décollage Artemis" }]);
});

test("/settings : préférences lues et modifiées ; elles s'appliquent ensuite à /convert", async () => {
  const B = bench();
  const s = ix("command", { commandName: "settings" });
  await B.router.handle(s);
  assert.match(textOf(last(s, "edit").r), /Tes préférences/);
  await B.router.handle(ix("select", { customId: "ae:prefs:fmt", values: ["mp3"] }));
  assert.equal(B.acc.state.prefs.get(ME)?.fmt, "mp3");
  const c = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(c);
  assert.equal((B.y.calls.at(-1)!.params as { fmt: string }).fmt, "mp3", "format par défaut de l'utilisateur");
  for (let k = 0; k < 20 && !textOf(last(c, "edit")?.r).includes("PRÊT"); k++) await settle();
});

test("/config : serveur seulement, permission « Gérer le serveur », modifications validées et réinitialisables", async () => {
  const B = bench();
  const dm = ix("command", { commandName: "config", guildId: null });
  await B.router.handle(dm);
  assert.match(textOf(last(dm, "reply").r), /Sur un serveur seulement/);
  const noPerm = ix("command", { commandName: "config" });
  await B.router.handle(noPerm);
  assert.match(textOf(last(noPerm, "reply").r), /Permission requise/);
  const ok = ix("command", { commandName: "config", canManageGuild: true });
  await B.router.handle(ok);
  assert.match(textOf(last(ok, "edit").r), /Réglages du serveur/);
  assert.match(textOf(last(ok, "edit").r), /Partage public : oui/, "serveur jamais réglé : partage permis (2026-10-13)");
  await B.router.handle(ix("button", { customId: "ae:cfg:share", canManageGuild: true }));
  assert.equal(B.acc.state.guilds.get(GUILD)?.share, false, "un administrateur le désactive");
  const hijack = ix("button", { customId: "ae:cfg:share", canManageGuild: false });
  await B.router.handle(hijack);
  assert.equal(B.acc.state.guilds.get(GUILD)?.share, false, "sans la permission, rien ne change");
  await B.router.handle(ix("button", { customId: "ae:cfg:auto", canManageGuild: true }));
  assert.equal(B.acc.state.guilds.get(GUILD)?.autoEmbeds, false, "cartes automatiques impossibles tant que l'accès au contenu n'est pas activé");
  await B.router.handle(ix("select", { customId: "ae:cfg:platforms", values: [], canManageGuild: true }));
  assert.equal(B.acc.state.guilds.get(GUILD)?.platforms.length, 3, "aucune plateforme : refus silencieux, valeur gardée");
  await B.router.handle(ix("button", { customId: "ae:cfg:reset", canManageGuild: true }));
  assert.equal(B.acc.state.guilds.get(GUILD)?.share, true, "réinitialiser = valeurs par défaut effectives");
});

test("limites : 5 actions par 30 s et par personne ; la navigation reste possible ; erreurs internes → message clair", async () => {
  const B = bench({ ...ALL, convert: false });
  for (let k = 0; k < 5; k++) await B.router.handle(ix("command", { commandName: "convert", opts: { url: TIKTOK } }));
  const sixth = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(sixth);
  assert.match(textOf(last(sixth, "reply").r), /Doucement/);
  const help = ix("command", { commandName: "help" });
  await B.router.handle(help);
  assert.match(textOf(last(help, "reply").r), /AETHRYON sur Discord/);
  B.tick(31_000);
  const again = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(again);
  assert.doesNotMatch(textOf(last(again, "reply").r), /Doucement/);
  const C = bench();
  C.acc.api.history = async () => { throw new Error("boom"); };
  const h = ix("command", { commandName: "history" });
  await C.router.handle(h);
  assert.match(textOf(last(h, "edit").r), /Historique indisponible/);
});

// ---- cartes automatiques ---------------------------------------------------------------------------------------
import { createAuto, type AutoMessage } from "../src/v2/auto.ts";

function autoBench(settings: Partial<GuildSettings> | null, features: Features = { ...ALL, autoEmbeds: true }) {
  let clock = Date.now();
  const logs: string[] = [];
  const g: GuildSettings | null = settings ? { autoEmbeds: true, platforms: ["youtube", "tiktok", "x"], channels: [], buttons: true, share: false, quality: "auto", perHour: 2, original: "keep", mode: "card", ...settings } : null;
  const auto = createAuto({ brand: { site: SITE, emoji: null }, features, guildSettings: async () => g, log: (_l, m) => logs.push(m), now: () => clock });
  let n = 0;
  const msg = (content: string, o: Partial<AutoMessage> = {}) => {
    const calls: { m: string; r?: unknown }[] = [];
    const m: AutoMessage & { calls: typeof calls } = {
      id: `m${++n}`, guildId: GUILD, channelId: "555555555555555555", content, authorId: OTHER, authorIsBot: false, webhook: false, system: false, canManageMessages: false,
      async reply(r) { calls.push({ m: "reply", r }); }, async react(e) { calls.push({ m: "react", r: e }); }, async suppressEmbeds() { calls.push({ m: "suppress" }); },
      calls, ...o,
    };
    return m;
  };
  return { auto, msg, logs, tick: (ms: number) => { clock += ms; } };
}

test("cartes automatiques : désactivées par défaut ; carte publique avec attribution, sans compte ; filtres, doublons, limite horaire", async () => {
  const off = autoBench(null);
  assert.equal(await off.auto.onMessage(off.msg(`vu ${TIKTOK}`)), "ignored", "serveur sans réglage : rien");
  const closed = autoBench({}, ALL);
  assert.equal(await closed.auto.onMessage(closed.msg(TIKTOK)), "ignored", "fonction fermée pour le bot : rien");
  const A = autoBench({});
  const m1 = A.msg(`regardez ${TIKTOK} !`);
  assert.equal(await A.auto.onMessage(m1), "card");
  const card = m1.calls[0]!.r as V2Reply;
  const t = textOf(card);
  assert.match(t, /Lien partagé par <@998877665544332211>/);
  assert.match(t, /ae:conv:\*:mp4/, "boutons pour quiconque clique, avec son propre compte");
  assert.equal(sourceOf(card.components), TIKTOK);
  assert.doesNotMatch(t, /conversions restantes|i•••@/);
  assert.equal(await A.auto.onMessage(A.msg(`encore ${TIKTOK}`)), "ignored", "même lien dans le même salon en 10 min : pas de nouvelle carte");
  assert.equal(await A.auto.onMessage(A.msg("https://x.com/NASA/status/1883228395842023524")), "card");
  assert.equal(await A.auto.onMessage(A.msg("https://youtu.be/dQw4w9WgXcQ")), "limited", "limite horaire du serveur (2)");
  A.tick(3_600_001);
  assert.equal(await A.auto.onMessage(A.msg("https://youtu.be/dQw4w9WgXcQ")), "card");
  assert.equal(await A.auto.onMessage(A.msg("https://evil.com/v")), "ignored");
  assert.equal(await A.auto.onMessage(A.msg(TIKTOK, { authorIsBot: true })), "ignored", "messages de bots ignorés");
  assert.equal(await A.auto.onMessage(A.msg(TIKTOK, { webhook: true })), "ignored", "webhooks ignorés");
  assert.equal(await A.auto.onMessage(A.msg(TIKTOK, { guildId: null })), "ignored", "messages privés ignorés");
  const C = autoBench({ channels: ["111111111111111111"], platforms: ["x"] });
  assert.equal(await C.auto.onMessage(C.msg(TIKTOK, { channelId: "111111111111111111" })), "ignored", "plateforme non choisie");
  assert.equal(await C.auto.onMessage(C.msg("https://x.com/NASA/status/1883228395842023524")), "ignored", "salon non autorisé");
  assert.equal(await C.auto.onMessage(C.msg("https://x.com/NASA/status/1883228395842023524", { channelId: "111111111111111111" })), "card");
});

test("cartes automatiques : mode réaction ; aperçu natif masqué seulement si demandé ET permis ; message d'origine jamais supprimé", async () => {
  const R = autoBench({ mode: "react" });
  const m = R.msg(TIKTOK);
  assert.equal(await R.auto.onMessage(m), "reaction");
  assert.deepEqual(m.calls, [{ m: "react", r: "🦉" }]);
  const S = autoBench({ original: "suppress" });
  const noPerm = S.msg(TIKTOK);
  await S.auto.onMessage(noPerm);
  assert.ok(!noPerm.calls.some((c) => c.m === "suppress"), "sans « Gérer les messages » : rien n'est masqué");
  const perm = S.msg("https://x.com/NASA/status/1883228395842023524", { canManageMessages: true });
  await S.auto.onMessage(perm);
  assert.ok(perm.calls.some((c) => c.m === "suppress"), "aperçu natif masqué");
  const K = autoBench({ buttons: false });
  const plain = K.msg(TIKTOK);
  await K.auto.onMessage(plain);
  assert.doesNotMatch(textOf(plain.calls[0]!.r), /ae:conv/, "boutons retirés si le serveur le demande");
  assert.ok(![...R.logs, ...S.logs, ...K.logs].some((l) => /tiktok\.com|99887766/.test(l)), "journaux sans lien ni identifiant");
});
