// 3.5.1 : destination « Premiere Pro » (docs/EXTENSION.md §11 ; 3.5.2 : « Envoyer vers » › « Premiere Pro ») : réglage, requête job.start, paramètres envoyés à
// ytapi (MP4 H.264 + AAC), nom « AETHRYON/<nom> » proposé à Chrome pour NOS fichiers seulement (course comprise),
// téléchargements ordinaires inchangés.
/* eslint-disable @typescript-eslint/no-explicit-any */
import "./fakes/setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL, YT_URL } from "./fakes/harness.ts";
import { EXT_ID, FakeEvent, tick, until } from "./fakes/chrome.ts";
import { forDestination, premiereVideo, requestBody } from "../../src/background/jobs.ts";
import { createPremiereRouter, premiereTarget } from "../../src/background/premiere.ts";
import { RELAY_FIELDS, relayRequest } from "../../src/background/relais.ts";
import type { StoredJob } from "../../src/background/store.ts";
import { MSG, jobError } from "../../src/background/errors.ts";
import { buildStartJob, describeJob, initialChoice } from "../../src/content/common/job.ts";
import { parseJob } from "../../src/content/common/protocol.ts";
import { jobStatusText } from "../../src/popup/text.ts";
import { TOKEN } from "./fakes/backend.ts";
import { M, T } from "../../src/content/common/strings.ts";
import { parseBgRequest } from "../../src/shared/messages.ts";
import { PREMIERE_FOLDER, premiereQuality, premiereReencodes } from "../../src/shared/premiere.ts";
import { mergeSettings } from "../../src/shared/storage.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/types.ts";

const NBSP = "\u00a0";

// ---- réglage ------------------------------------------------------------------------------------
test("réglage : Téléchargements par défaut ; Premiere Pro retenu ; valeur inconnue ignorée ; explication pas encore vue", () => {
  assert.equal(DEFAULT_SETTINGS.destination, "downloads");
  assert.equal(mergeSettings(undefined).destination, "downloads");
  assert.equal(mergeSettings(undefined).premiereHintSeen, false);
  assert.equal(mergeSettings({ destination: "premiere" }).destination, "premiere");
  assert.equal(mergeSettings({ destination: "Premiere" as any }).destination, "downloads");
  assert.equal(mergeSettings({ destination: 1 as any }).destination, "downloads");
  assert.equal(mergeSettings({ premiereHintSeen: true }).premiereHintSeen, true);
  assert.equal(mergeSettings({ premiereHintSeen: "oui" as any }).premiereHintSeen, false);
  // Les autres réglages ne bougent pas.
  const s = mergeSettings({ destination: "premiere", quality: "720", ytToolbar: "collapsed" });
  assert.equal(s.quality, "720");
  assert.equal(s.ytToolbar, "collapsed");
});

test("réglage : mémorisé dans storage.sync (même réglage pour le menu des pages, le popup et les réglages)", async (t) => {
  const h = harness(t);
  const { saveSettings, getSettings } = await import("../../src/shared/storage.ts");
  await saveSettings({ destination: "premiere" });
  assert.equal((h.browser.store.sync.get("settings") as any).destination, "premiere");
  assert.equal((await getSettings()).destination, "premiere");
  await saveSettings({ destination: "downloads" });
  assert.equal((await getSettings()).destination, "downloads");
});

// ---- requête job.start ----------------------------------------------------------------------------
test("job.start : dest « premiere » ou « downloads » accepté, toute autre valeur refusée", () => {
  const base = { type: "job.start", url: YT_URL, fmt: "mp4" };
  assert.equal((parseBgRequest({ ...base, dest: "premiere" }) as any).dest, "premiere");
  assert.equal((parseBgRequest({ ...base, dest: "downloads" }) as any).dest, "downloads");
  assert.equal("dest" in (parseBgRequest(base) as any), false);
  for (const bad of ["Premiere", "", "../x", 1, null, true]) assert.equal(parseBgRequest({ ...base, dest: bad }), null, String(bad));
});

test("menu des pages : Téléchargements → requête identique à la 3.5.0 ; Premiere Pro → dest « premiere »", () => {
  const media = { platform: "youtube" as const, id: "dQw4w9WgXcQ", url: YT_URL, title: "Titre" };
  const choice = { ...initialChoice(DEFAULT_SETTINGS), fmt: "mp4" as const };
  assert.deepEqual(buildStartJob(media, choice), { type: "job.start", url: YT_URL, fmt: "mp4", quality: "best", title: "Titre" });
  assert.deepEqual(buildStartJob(media, choice, "downloads"), { type: "job.start", url: YT_URL, fmt: "mp4", quality: "best", title: "Titre" });
  assert.deepEqual(buildStartJob(media, choice, "premiere"), { type: "job.start", url: YT_URL, fmt: "mp4", quality: "best", title: "Titre", dest: "premiere" });
  assert.deepEqual(buildStartJob(media, { ...choice, fmt: "mp3" }, "premiere"), { type: "job.start", url: YT_URL, fmt: "mp3", bitrate: 192, title: "Titre", dest: "premiere" });
});

test("textes du menu : typographie française (insécable avant ; et :, apostrophe ’) et libellés demandés", () => {
  // 3.5.2 : « Envoyer vers » › « Premiere Pro » (mots du brief, compacts) ; plus jamais « importe tout seul ».
  assert.equal(M.destTitle, "Envoyer vers");
  assert.equal(M.destDownloads, "Téléchargements");
  assert.equal(M.destPremiere, "Premiere Pro");
  // 3.8.1 : relayé à AETHRYON Desktop, qui convertit, enregistre et importe (à la demande de l'utilisateur : son clic).
  assert.equal(M.destHint, "AETHRYON Desktop convertit la vidéo, l’enregistre dans sa bibliothèque et l’importe dans Premiere Pro.");
  assert.equal(T.desktopMissing, "Installe AETHRYON Desktop pour suivre l’envoi");
  for (const s of [M.destHint, M.destReencode, M.premiereBest, M.premiereVideo("720p"), T.desktopMissing]) {
    assert.doesNotMatch(s, /tout seul|automatiquement/, s);
    assert.doesNotMatch(s, / [?!:;%»]/, s);
    assert.doesNotMatch(s, /'/, s);
  }
});

// ---- formats pour Premiere ---------------------------------------------------------------------------
const job = (p: Partial<StoredJob>): StoredJob => ({
  key: "k".repeat(16), url: YT_URL, platform: "youtube", fmt: "mp4", state: "queued", createdAt: 0, updatedAt: 0, ...p,
});

test("formats : Premiere + MP4 → transcode=true (H.264 + AAC garanti par ytapi), « Auto » demandé en 1080p", () => {
  assert.deepEqual(requestBody(job({ dest: "premiere", quality: "best" })), { url: YT_URL, fmt: "mp4", quality: "1080", transcode: true });
  assert.deepEqual(requestBody(job({ dest: "premiere", quality: "720" })), { url: YT_URL, fmt: "mp4", quality: "720", transcode: true });
  assert.deepEqual(requestBody(job({ dest: "premiere", quality: "2160" })), { url: YT_URL, fmt: "mp4", quality: "2160", transcode: true });
  assert.equal(premiereQuality("best"), "1080");
  assert.equal(premiereQuality("480"), "480");
  assert.equal(premiereReencodes("2160"), true);
  assert.equal(premiereReencodes("1440"), true);
  assert.equal(premiereReencodes("1080"), false);
  assert.equal(premiereReencodes("best"), false);
});

test("formats : MP3 vers Premiere inchangé ; extrait déjà réencodé en H.264 + AAC (rien de plus) ; GIF jamais « Premiere »", () => {
  assert.deepEqual(requestBody(job({ dest: "premiere", fmt: "mp3", bitrate: 320 })), { url: YT_URL, fmt: "mp3", bitrate: 320 });
  assert.deepEqual(requestBody(job({ dest: "premiere", quality: "best", clip: { start: 5, end: 15 } })), { url: YT_URL, fmt: "mp4", quality: "best", startMs: 5_000, endMs: 15_000 }); // 3.6.0 : millisecondes entières
  assert.equal(premiereVideo({ dest: "premiere", fmt: "mp4", kind: "gif" }), false);
});

test("formats : Téléchargements → corps envoyé à ytapi identique à la 3.5.0 (jamais de transcode)", () => {
  assert.deepEqual(requestBody(job({ quality: "best" })), { url: YT_URL, fmt: "mp4", quality: "best" });
  assert.deepEqual(requestBody(job({ quality: "2160" })), { url: YT_URL, fmt: "mp4", quality: "2160" });
  assert.deepEqual(requestBody(job({ fmt: "mp3", bitrate: 192 })), { url: YT_URL, fmt: "mp3", bitrate: 192 });
});

test("erreur : vidéo trop longue pour être réencodée → explication pour Premiere ; vers Téléchargements, texte du serveur", () => {
  const e = { code: "transcode_too_long", message: "Vidéo trop longue pour être réencodée.", retryable: false };
  assert.deepEqual(forDestination({ dest: "premiere" }, e), jobError("transcode_too_long", MSG.premiereTooLong, false));
  assert.deepEqual(forDestination({}, e), e);
  const other = { code: "too_long", message: "Vidéo trop longue pour le service.", retryable: false };
  assert.deepEqual(forDestination({ dest: "premiere" }, other), other);
});

// ---- nom proposé à Chrome (routeur seul) ------------------------------------------------------------------
test("nom : « AETHRYON/<nom seul> » ; un chemin est réduit à son nom ; nom vide ou absent → nom de Chrome", () => {
  assert.equal(PREMIERE_FOLDER, "AETHRYON");
  assert.equal(premiereTarget("Ma vidéo [abc].mp4"), "AETHRYON/Ma vidéo [abc].mp4");
  assert.equal(premiereTarget("C:\\Users\\a\\Downloads\\x.mp3"), "AETHRYON/x.mp3");
  assert.equal(premiereTarget("/home/a/Téléchargements/x.mp4"), "AETHRYON/x.mp4");
  assert.equal(premiereTarget(""), null);
  assert.equal(premiereTarget(".."), null);
  assert.equal(premiereTarget(undefined), null);
});

function router(opts: { holdMs?: number; expectMs?: number } = {}) {
  const ev = new FakeEvent();
  const r = createPremiereRouter({ extensionId: () => EXT_ID, event: () => ev as any, ...opts });
  /** Chrome appelle les écouteurs ; renvoie la proposition (null = nom de Chrome) et si la réponse a été immédiate. */
  const determine = (id: number, filename: string, byExtensionId?: string) => new Promise<{ s: any; sync: boolean; listeners: number }>((resolve) => {
    const listeners = ev.listeners.length;
    if (!listeners) return resolve({ s: null, sync: true, listeners });
    let answered = false;
    let sync = true;
    const out = ev.listeners[0]!({ id, filename, ...(byExtensionId ? { byExtensionId } : {}) }, (s?: any) => {
      answered = true;
      resolve({ s: s ?? null, sync, listeners });
    });
    sync = false;
    if (out !== true && !answered) resolve({ s: null, sync: true, listeners });
  });
  return { ev, r, determine };
}

test("routeur : aucun écouteur au repos ; posé pendant le lancement ; retiré dès que le nom est donné", async () => {
  const { ev, r, determine } = router();
  assert.equal(ev.listeners.length, 0);
  let resolveId!: (id: number) => void;
  const p = r.launch(() => new Promise<number>((res) => { resolveId = res; }));
  assert.equal(ev.listeners.length, 1, "écouteur posé AVANT downloads.download()");
  resolveId(41);
  assert.equal(await p, 41);
  assert.equal(r.listening, true, "en attente du nom de 41");
  const got = await determine(41, "Ma vidéo [job].mp4", EXT_ID);
  assert.deepEqual(got.s, { filename: "AETHRYON/Ma vidéo [job].mp4", conflictAction: "uniquify" });
  assert.equal(got.sync, true);
  assert.equal(ev.listeners.length, 0, "plus rien à attendre : écouteur retiré");
  assert.equal(r.pending, 0);
});

test("routeur : course — Chrome donne le nom AVANT que downloads.download() ait rendu l'identifiant", async () => {
  const { ev, r, determine } = router();
  let resolveId!: (id: number) => void;
  const p = r.launch(() => new Promise<number>((res) => { resolveId = res; }));
  const early = determine(7, "Clip [x].mp4", EXT_ID); // retenu : peut-être le nôtre
  await tick(5);
  assert.equal(r.pending, 1);
  resolveId(7);
  await p;
  const got = await early;
  assert.equal(got.sync, false, "réponse asynchrone (l'écouteur a rendu true)");
  assert.deepEqual(got.s, { filename: "AETHRYON/Clip [x].mp4", conflictAction: "uniquify" });
  assert.equal(ev.listeners.length, 0);
});

test("routeur : fichiers d'un site pendant un lancement → nom de Chrome tout de suite ; autre fichier de l'extension → rendu sans changement", async () => {
  const { ev, r, determine } = router();
  let resolveId!: (id: number) => void;
  const p = r.launch(() => new Promise<number>((res) => { resolveId = res; }));
  const site = await determine(100, "facture.pdf"); // pas de byExtensionId : un site
  assert.deepEqual(site, { s: null, sync: true, listeners: 1 });
  const otherExt = await determine(101, "x.zip", "autre-extension");
  assert.deepEqual(otherExt, { s: null, sync: true, listeners: 1 });
  const ours = determine(102, "Image.png", EXT_ID); // de l'extension, mais un autre téléchargement (ex. image de la vidéo)
  resolveId(103);
  await p;
  assert.deepEqual((await ours).s, null, "pas « Premiere » : le nom donné par l'extension ou par Chrome est gardé");
  assert.equal(r.pending, 1, "103 attend toujours son nom");
  r.forget(103); // interrompu avant d'avoir un nom
  assert.equal(ev.listeners.length, 0);
});

test("routeur : un fichier retenu n'attend jamais plus de holdMs ; un identifiant oublié après expectMs ; échec de download()", async () => {
  const { ev, r, determine } = router({ holdMs: 20, expectMs: 30 });
  const never = r.launch(() => new Promise<number>(() => undefined)); // download() qui ne rend jamais la main
  const held = await determine(5, "a.mp4", EXT_ID);
  assert.deepEqual(held.s, null, "rendu à Chrome après holdMs");
  void never;
  const { ev: ev2, r: r2 } = router({ expectMs: 30 });
  await r2.launch(async () => 9);
  assert.equal(ev2.listeners.length, 1);
  await tick(60);
  assert.equal(ev2.listeners.length, 0, "nom jamais demandé (téléchargement disparu) : écouteur retiré");
  const { ev: ev3, r: r3 } = router();
  await assert.rejects(r3.launch(async () => { throw new Error("SERVER_FAILED"); }), /SERVER_FAILED/);
  assert.equal(ev3.listeners.length, 0, "download() refusé : écouteur retiré");
  r.stop();
  assert.equal(ev.listeners.length, 0);
});

test("routeur : nom choisi par l'extension (image, miniature) — aucun écouteur posé pour lui ; redonné à Chrome pendant un envoi vers Premiere", async () => {
  const { ev, r, determine } = router();
  // Seul : aucun écouteur, Chrome garde le nom passé à downloads.download.
  assert.equal(await r.withName(async () => 1, "Image (0m12s).png"), 1);
  assert.equal(ev.listeners.length, 0);
  // Pendant un envoi vers Premiere : l'écouteur est posé, le nom de l'image lui est redonné explicitement.
  let resolvePremiere!: (id: number) => void;
  const p = r.launch(() => new Promise<number>((res) => { resolvePremiere = res; }));
  assert.deepEqual((await determine(1, "download.png", EXT_ID)).s, { filename: "Image (0m12s).png", conflictAction: "uniquify" });
  // Course : l'image est nommée avant que son downloads.download() ait rendu l'identifiant.
  let resolveImage!: (id: number) => void;
  const img = r.withName(() => new Promise<number>((res) => { resolveImage = res; }), "Miniature.jpg");
  const early = determine(2, "hqdefault.jpg", EXT_ID);
  await tick(5);
  resolveImage(2);
  await img;
  assert.deepEqual((await early).s, { filename: "Miniature.jpg", conflictAction: "uniquify" });
  resolvePremiere(3);
  await p;
  assert.deepEqual((await determine(3, "Vidéo.mp4", EXT_ID)).s, { filename: "AETHRYON/Vidéo.mp4", conflictAction: "uniquify" });
  assert.equal(ev.listeners.length, 0);
  assert.equal(await r.withName(async () => 4, undefined), 4, "sans nom : simple appel");
});

// ---- de bout en bout dans le service worker (faux navigateur, faux ytapi, faux hôte du Desktop) ---------------
// 3.8.1 : « Envoyer vers › Premiere Pro » est relayé à AETHRYON Desktop (src/background/relais.ts, contrat §12 proposé) :
// plus AUCUN chrome.downloads ni aucune requête à ytapi depuis l'extension pour cette destination.
test("service worker 3.8.1 : Premiere Pro → AUCUN téléchargement Chrome ni requête ytapi ; « envoyer-premiere » en liste fermée (page, format, titre) ; états réels jusqu'à « Importé dans Premiere Pro »", async (t) => {
  const h = harness(t);
  h.browser.grantNative();
  let listeners = 0;
  h.browser.onDownloadCreated = () => { listeners++; };
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", dest: "premiere", title: "Coucher de soleil https://exemple.test/x?sig=1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const key = r.data.key as string;
  const seen = new Set<string>();
  await until(() => { const j = h.job(key); if (j) seen.add(`${j.state}/${j.stage ?? ""}`); return j?.state === "done"; }, 3000, "importé");
  assert.deepEqual(h.browser.downloadCalls, [], "aucun téléchargement par Chrome");
  assert.equal(listeners, 0);
  assert.equal(h.backend.creates.length, 0, "aucune conversion demandée par l'extension (le Desktop convertit avec SA clé)");
  assert.equal(h.browser.determiningListeners, 0);
  const msgs = h.browser.nativeMessages;
  assert.deepEqual(msgs[0], { type: "envoyer-premiere", id: key, url: TT_URL, format: "mp4", titre: "Coucher de soleil" });
  for (const k of Object.keys(msgs[0])) assert.ok((RELAY_FIELDS as readonly string[]).includes(k), k);
  assert.ok(msgs.slice(1).every((m: any) => m.type === "etat-envoi" && m.id === key && Object.keys(m).length === 2));
  const all = JSON.stringify(msgs);
  assert.ok(!all.includes(TOKEN) && !all.includes("sig=") && !all.includes("/file"), all.slice(0, 300));
  for (const st of ["converting/desktop", "downloading/desktop", "downloading/import", "done/done"]) assert.ok(seen.has(st), `${st} : ${[...seen].join(", ")}`);
  assert.equal(h.job(key).progress, 100);
  assert.equal(jobStatusText(h.job(key)), "Importé dans Premiere Pro");
  await until(() => h.browser.nativeLive === 0, 2000, "port fermé après le dernier envoi");
  assert.deepEqual(h.browser.nativeNames, ["fr.aethryon.desktop"], "un seul port, un seul processus hôte");
  // Le menu de la page dit « Importé dans Premiere ».
  assert.equal(describeJob(parseJob(h.job(key))!).label, T.premiereDone);
});

test("service worker 3.8.1 : refus et échecs clairs — sans permission, Desktop absent, non relié, Premiere non ouvert ou sans projet ; MP3 par défaut jamais imposé", async (t) => {
  const h = harness(t);
  const sans = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", dest: "premiere" });
  assert.deepEqual([sans.ok, sans.error.code], [false, "desktop_permission"]);
  assert.match(sans.error.message, /Autoriser/);
  h.browser.grantNative();
  const cas: [any[], string, RegExp][] = [
    [[{ ok: true, etat: "non-relie", message: "AETHRYON Desktop n'est pas relié à ton compte : ouvre AETHRYON Desktop › Paramètres › Compte, puis relance." }], "desktop_not_linked", /Paramètres › Compte/],
    [[{ ok: true, etat: "conversion" }, { ok: true, etat: "premiere-absent" }], "premiere_absent", /Premiere Pro n'est pas ouvert/],
    [[{ ok: true, etat: "sans-projet" }], "premiere_no_project", /aucun projet/],
    [[{ ok: true, etat: "echec", message: "Tu as atteint ta limite de conversions pour aujourd'hui." }], "premiere_failed", /limite de conversions/],
  ];
  for (const [script, code, texte] of cas) {
    h.browser.nativeRelay = script;
    const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp3", dest: "premiere" });
    assert.equal(r.ok, true);
    await until(() => h.job(r.data.key)?.state === "error", 3000, code);
    assert.equal(h.job(r.data.key).error.code, code);
    assert.match(h.job(r.data.key).error.message, texte);
    assert.equal(h.browser.nativeMessages.filter((m: any) => m.type === "envoyer-premiere" && m.id === r.data.key)[0].format, "mp3", "format choisi gardé");
    await h.page({ type: "job.dismiss", key: r.data.key });
  }
  await until(() => h.browser.nativeLive === 0, 2000, "port fermé (hôte arrêté)");
  h.browser.nativeHost = "absent";
  const absent = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", dest: "premiere" });
  await until(() => h.job(absent.data.key)?.state === "error", 3000, "Desktop absent");
  assert.equal(h.job(absent.data.key).error.code, "desktop_absent");
  assert.deepEqual(h.browser.downloadCalls, [], "jamais de repli vers un téléchargement Chrome");
  assert.equal(h.backend.creates.length, 0);
  // Vidéo par défaut : « envoyer-premiere » sans format imposé → mp4 (relayRequest).
  assert.equal(relayRequest({ key: "Ab3dEf6hIj9kLm2n", url: YT_URL, fmt: "mp4" })!.format, "mp4");
  assert.deepEqual(relayRequest({ key: "Ab3dEf6hIj9kLm2n", url: YT_URL, fmt: "mp4", clip: { start: 1.5, end: 9.25 } }), { type: "envoyer-premiere", id: "Ab3dEf6hIj9kLm2n", url: YT_URL, format: "mp4", debut: 1.5, fin: 9.25 });
});

test("service worker 3.8.1 : AETHRYON Desktop trop ancien (« Type de message inconnu. ») → « Mets à jour AETHRYON Desktop pour importer dans Premiere Pro », jamais le texte brut", async (t) => {
  const h = harness(t);
  h.browser.grantNative();
  h.browser.nativeHost = "ancien";
  const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", dest: "premiere" });
  assert.equal(r.ok, true);
  await until(() => h.job(r.data.key)?.state === "error", 3000, "Desktop trop ancien");
  const job = h.job(r.data.key);
  assert.equal(job.error.message, MSG.desktopOutdated);
  assert.equal(job.error.code, "desktop_outdated", "3.9.0 : code à part (le popup propose « Mettre à jour AETHRYON Desktop »)");
  assert.equal(job.error.retryable, false);
  assert.equal(MSG.desktopOutdated, "Mets à jour AETHRYON Desktop pour importer dans Premiere Pro.");
  assert.equal(jobStatusText(job), MSG.desktopOutdated, "popup : le texte de mise à jour");
  assert.ok(!JSON.stringify(job).includes("Type de message"), "texte brut de l'hôte jamais gardé ni montré");
  assert.deepEqual(h.browser.nativeMessages.map((m: any) => m.type), ["envoyer-premiere"], "aucun suivi après le refus");
  assert.deepEqual(h.browser.downloadCalls, [], "jamais de repli vers un téléchargement Chrome");
  assert.equal(h.backend.creates.length, 0);
});

test("service worker : Téléchargements → aucun écouteur, à aucun moment ; nom de Chrome ; corps ytapi inchangé", async (t) => {
  const h = harness(t);
  const seen: number[] = [];
  h.browser.onDownloadCreated = () => seen.push(h.browser.determiningListeners);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "downloading");
  assert.deepEqual(seen, [0], "Chrome ne passe jamais par l'extension pour nommer un téléchargement ordinaire");
  assert.deepEqual(h.backend.creates[0], { url: TT_URL, fmt: "mp4", quality: "best" });
  const named = await h.browser.determineFilename(1, "Ma vidéo [job_0001].mp4");
  assert.equal(named.listeners, 0);
  assert.equal(h.job().dest, undefined);
  // Fichier d'un site : aucun écouteur non plus.
  const site = h.browser.siteDownload();
  assert.equal((await h.browser.determineFilename(site, "facture.pdf")).listeners, 0);
});

test("service worker : même vidéo vers Téléchargements puis vers Premiere → deux travaux distincts ; GIF jamais « Premiere »", async (t) => {
  const h = harness(t);
  h.browser.grantNative();
  h.backend.onPoll = () => new Promise(() => undefined) as any; // conversions qui durent
  const a = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  const b = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", dest: "premiere" });
  assert.notEqual(a.data.key, b.data.key);
  const g = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 0, end: 5 }, gif: true, dest: "premiere" });
  assert.equal(g.ok, true);
  assert.equal(g.data.dest, undefined);
  assert.equal(g.data.kind, "gif");
});

