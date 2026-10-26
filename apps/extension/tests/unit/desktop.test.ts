// 3.5.2 : lien navigateur → AETHRYON Desktop (Native Messaging, contrat d'échange §6 ; docs/EXTENSION.md §12).
// - correspondance des états du travail et des états du contrat (jamais « pret », qui appartient au Desktop) ;
// - propriété : sur des milliers de travaux tirés au hasard (graine fixe), aucun message ne contient un jeton, une
//   adresse, un identifiant du serveur ou un champ hors de la liste fermée ;
// - noms de fichier : seulement ceux que le Desktop accepte (desktop/noyau/src/noms.rs, est_nom_propre) ;
// - port partagé et court, progression limitée, hôte absent (repli calme), hôte qui s'arrête, permission facultative.
/* eslint-disable @typescript-eslint/no-explicit-any */
import "./fakes/setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { YT_URL } from "./fakes/harness.ts";
import { tick, until } from "./fakes/chrome.ts";
import { TOKEN } from "./fakes/backend.ts";
import {
  createDesktopLink, expectedFile, TRANSFER_FIELDS, transferEtat, transferMessage, transferTitle, tracksDesktop,
  type NativePort, type TransferMessage,
} from "../../src/background/desktop.ts";
import type { StoredJob } from "../../src/background/store.ts";
import { askDesktopLink, hasDesktopLink, NATIVE_PERMISSION } from "../../src/shared/desktop.ts";
import type { JobState } from "../../src/shared/types.ts";

const JOB_STATES: readonly JobState[] = ["queued", "converting", "downloading", "done", "error", "cancelled"];

const KEY = "Ab3dEf6hIj9kLm2n";
const job = (p: Partial<StoredJob> = {}): StoredJob => ({
  key: KEY, url: YT_URL, platform: "youtube", fmt: "mp4", dest: "premiere", state: "queued", createdAt: 0, updatedAt: 0, ...p,
});

// ---- correspondance des états ---------------------------------------------------------------------------------------
test("états : queued → attente, converting → conversion, downloading et done → telechargement, error et cancelled → erreur ; jamais « pret »", () => {
  const expected: Record<JobState, string> = {
    queued: "attente", converting: "conversion", downloading: "telechargement", done: "telechargement", error: "erreur", cancelled: "erreur",
  };
  for (const s of JOB_STATES) assert.equal(transferEtat(s), expected[s], s);
  for (const s of JOB_STATES) assert.notEqual(transferMessage(job({ state: s }))?.etat, "pret");
});

test("message : progression de 0 à 1, nom définitif seulement une fois connu, titre et plateforme du contrat", () => {
  assert.deepEqual(transferMessage(job({ state: "queued", title: "Coucher de soleil" })),
    { type: "transfert", id: KEY, etat: "attente", titre: "Coucher de soleil", plateforme: "youtube", format: "mp4", progression: 0 });
  assert.equal(transferMessage(job({ state: "converting", progress: 42 }))?.progression, 0.42);
  assert.equal(transferMessage(job({ state: "converting" }))?.progression, 0);
  // Nom provisoire pendant la conversion : jamais (le Desktop relierait l'envoi à un ancien fichier du même nom).
  assert.equal(transferMessage(job({ state: "converting", fileName: "Ancien.mp4" }))?.fichierAttendu, undefined);
  assert.deepEqual(transferMessage(job({ state: "downloading", progress: 7, savedAs: "Vidéo [abc] (1).mp4", fileName: "Vidéo [abc] (1).mp4" })),
    { type: "transfert", id: KEY, etat: "telechargement", plateforme: "youtube", format: "mp4", progression: 0.07, fichierAttendu: "Vidéo [abc] (1).mp4" });
  // Fichier écrit : telechargement à 1 avec le nom ; « pret » sera posé par le Desktop quand il le verra arriver.
  assert.deepEqual(transferMessage(job({ state: "done", progress: 100, savedAs: "Vidéo.mp4", platform: "twitter", fmt: "mp3" })),
    { type: "transfert", id: KEY, etat: "telechargement", plateforme: "x", format: "mp3", progression: 1, fichierAttendu: "Vidéo.mp4" });
  assert.deepEqual(transferMessage(job({ state: "error", progress: 30, platform: "tiktok" })),
    { type: "transfert", id: KEY, etat: "erreur", plateforme: "tiktok", format: "mp4" });
  assert.equal(transferMessage(job({ state: "cancelled" }))?.etat, "erreur");
});

test("suivis : vidéo et audio vers Premiere seulement (ni Téléchargements, ni GIF, image, miniature)", () => {
  assert.equal(tracksDesktop(job()), true);
  assert.equal(tracksDesktop(job({ fmt: "mp3" })), true);
  assert.equal(tracksDesktop(job({ dest: undefined })), false);
  for (const kind of ["gif", "frame", "thumb"] as const) assert.equal(tracksDesktop(job({ kind })), false, kind);
  assert.equal(transferMessage(job({ dest: undefined })), null);
  assert.equal(transferMessage(job({ key: "../../evil" })), null, "identifiant refusé par le Desktop : rien");
});

// ---- propriété : ni jeton, ni adresse --------------------------------------------------------------------------------
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("propriété (5 000 travaux tirés au hasard, graine fixe) : liste fermée de champs, aucun jeton, aucune adresse, aucun identifiant du serveur", () => {
  const r = rng(20261018);
  const pick = <V>(xs: readonly V[]): V => xs[Math.floor(r() * xs.length)]!;
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
  const alnum = (n: number) => Array.from({ length: n }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(r() * 62)]).join("");
  const secretUrl = () => pick([
    `https://api.malvu.fr/media/jobs/${hex(12)}/file/x.mp4?sig=${hex(32)}&exp=${Math.floor(r() * 1e10)}`,
    `https://www.youtube.com/watch?v=${alnum(11)}`, `http://127.0.0.1:18111/jobs/${hex(8)}`, `www.${alnum(6)}.fr/${alnum(4)}`,
    `data:image/png;base64,${alnum(24)}`, `blob:https://x.com/${hex(8)}`, `chrome-extension://dnllfjakdgmgfiompaheickmbjjlgjdc/${alnum(5)}`,
    `file:///C:/Users/${alnum(5)}/secret.txt`, `javascript:alert(${hex(4)})`,
  ]);
  const titles = () => pick([
    "Coucher de soleil", `Regarde ${secretUrl()} maintenant`, `${secretUrl()}`, "Interview — Montréal (extrait)", "", "   ",
    "Clip\u0007 avec\u0000 contrôle", "x".repeat(400), "Émoji 🎬 et accents àéîõü", `Titre ${TOKEN}`.replace(TOKEN, "jeton masqué"),
  ]);
  const names = () => pick([
    undefined, "Vidéo [abc].mp4", "Vidéo [abc] (1).mp4", "a  b.mp4", " début.mp4", "fin.mp4.", "fin .mp4", "CON.mp4", "nul.txt",
    "x".repeat(130) + ".mp4", "a\tb.mp4", "a\u00a0b.mp4", "dossier/évité.mp4", "C:\\Users\\u\\Downloads\\AETHRYON\\Le Passage.mp4",
    "/home/u/Téléchargements/AETHRYON/Le Passage.mp3", "e\u0301te\u0301.mp4" /* NFD */, "été.mp4", "a:b.mp4", "rapport?.mp4", ".", "..",
  ]);
  const extraneous = () => ({ token: TOKEN, authorization: `Bearer ${TOKEN}`, cookie: `SID=${hex(20)}`, email: "alice@example.test", password: "hunter2" });
  for (let i = 0; i < 5000; i++) {
    const jobId = `job_${hex(16)}`;
    const fileUrl = secretUrl();
    const sourceUrl = secretUrl();
    const j: any = {
      key: r() < 0.97 ? alnum(16) : pick(["", "a/b", "x".repeat(80), "ok-key_1"]),
      jobId, url: sourceUrl, fileUrl, localUrl: secretUrl(), thumbFallback: secretUrl(), sourceJobId: `job_${hex(16)}`,
      platform: pick(["youtube", "tiktok", "twitter", "facebook", undefined]), fmt: pick(["mp4", "mp3", "gif", undefined]),
      dest: r() < 0.9 ? "premiere" : undefined, kind: r() < 0.9 ? undefined : pick(["gif", "frame", "thumb"]),
      state: pick(JOB_STATES), progress: pick([undefined, -5, 0, 12.6, 42, 99, 100, 250, Number.NaN, Infinity]),
      title: titles(), stage: pick(["queued", "download", "done", undefined]), fileName: names(), savedAs: names(),
      error: r() < 0.3 ? { code: "x", message: `Erreur ${fileUrl}`, retryable: true } : undefined,
      tabId: Math.floor(r() * 100), downloadId: Math.floor(r() * 100), createdAt: 0, updatedAt: 0, desktop: pick([undefined, "suivi", "absent"]),
      ...(r() < 0.5 ? extraneous() : {}),
    };
    const m = transferMessage(j);
    if (!m) continue;
    const text = JSON.stringify(m);
    for (const k of Object.keys(m)) assert.ok((TRANSFER_FIELDS as readonly string[]).includes(k), `champ hors liste : ${k}`);
    for (const secret of [TOKEN, jobId, j.sourceJobId, fileUrl, sourceUrl, j.localUrl, j.thumbFallback, "Bearer", "SID=", "alice@example.test", "hunter2"]) {
      assert.ok(!text.includes(secret), `fuite (${i}) : ${secret.slice(0, 40)} dans ${text.slice(0, 160)}`);
    }
    assert.doesNotMatch(text, /:\/\/|www\.|data:|blob:|javascript:|file:|chrome-extension:/i, text.slice(0, 160));
    // Valeurs que l'hôte du Desktop accepte (desktop/noyau/src/transferts.rs, Transfert::valider).
    assert.match(m.id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(m.id, j.key, "l'identifiant est la clé locale, jamais celui du serveur");
    assert.ok(["attente", "telechargement", "conversion", "erreur"].includes(m.etat));
    if (m.format !== undefined) assert.ok(m.format === "mp4" || m.format === "mp3");
    if (m.plateforme !== undefined) assert.match(m.plateforme, /^[a-z0-9-]{1,24}$/);
    if (m.progression !== undefined) assert.ok(Number.isFinite(m.progression) && m.progression >= 0 && m.progression <= 1);
    if (m.titre !== undefined) assert.ok(m.titre.length > 0 && [...m.titre].length <= 300 && !/[\u0000-\u001f]/.test(m.titre));
    if (m.fichierAttendu !== undefined) assert.equal(expectedFile(m.fichierAttendu), m.fichierAttendu);
  }
});

test("titre : adresses retirées, contrôles retirés, 300 caractères ; vide → absent", () => {
  assert.equal(transferTitle("Regarde https://exemple.fr/a?b=c maintenant"), "Regarde maintenant");
  assert.equal(transferTitle("www.exemple.fr"), undefined);
  assert.equal(transferTitle("Clip\u0007 n°2"), "Clip n°2");
  assert.equal([...transferTitle("é".repeat(400))!].length, 300);
  assert.equal(transferTitle(42), undefined);
});

test("nom attendu : règles du Desktop (est_nom_propre) ; chemin réduit au nom ; sinon absent", () => {
  assert.equal(expectedFile("C:\\Users\\u\\Downloads\\AETHRYON\\Le Passage.mp4"), "Le Passage.mp4");
  assert.equal(expectedFile("/home/u/Téléchargements/AETHRYON/Vidéo [abc] (1).mp4"), "Vidéo [abc] (1).mp4");
  for (const bad of ["a  b.mp4", " a.mp4", "a.mp4 ", "a.mp4.", "a .mp4", "CON.mp4", "lpt9.txt", "a\tb.mp4", "a\u00a0b.mp4", "a:b.mp4",
    "a?.mp4", "a*.mp4", 'a".mp4', "a<b>.mp4", "a|b.mp4", "e\u0301.mp4", "x".repeat(117) + ".mp4", ".", "..", "", "a\u0001.mp4"]) {
    assert.equal(expectedFile(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(expectedFile("x".repeat(116) + ".mp4"), "x".repeat(116) + ".mp4", "120 caractères : accepté");
  assert.equal(expectedFile("Interview — Montréal.mp4"), "Interview — Montréal.mp4");
});

// ---- port partagé, progression limitée -------------------------------------------------------------------------------
function fakePort(log: { posted: TransferMessage[]; connects: number; closed: number }, reply: "ok" | "none" = "ok"): () => NativePort {
  return () => {
    log.connects++;
    const msg: ((m: unknown) => void)[] = [];
    const dis: (() => void)[] = [];
    let open = true;
    return {
      postMessage(m: unknown) {
        log.posted.push(structuredClone(m as TransferMessage));
        if (reply === "ok") setTimeout(() => { if (open) for (const f of msg) f({ ok: true, id: (m as any).id, etat: (m as any).etat }); }, 1);
      },
      disconnect() { if (open) { open = false; log.closed++; } },
      onMessage: { addListener: (f) => { msg.push(f); } },
      onDisconnect: { addListener: (f) => { dis.push(f); } },
    };
  };
}

test("progression limitée : un changement d'état part tout de suite, la progression au plus une fois par fenêtre (la dernière n'est pas perdue)", async () => {
  const log = { posted: [] as TransferMessage[], connects: 0, closed: 0 };
  const links: string[] = [];
  const link = createDesktopLink({ connect: fakePort(log), onLink: (_k, l) => links.push(l), progressMs: 60, idleMs: 20 });
  link.update(job({ state: "queued" }));
  link.update(job({ state: "converting", progress: 1 }));
  for (let p = 2; p <= 40; p++) link.update(job({ state: "converting", progress: p }));
  assert.deepEqual(log.posted.map((m) => [m.etat, m.progression]), [["attente", 0], ["conversion", 0.01]], "rafale retenue");
  await tick(90);
  assert.deepEqual(log.posted.at(-1), { type: "transfert", id: KEY, etat: "conversion", plateforme: "youtube", format: "mp4", progression: 0.4 }, "dernière progression envoyée à la fin de la fenêtre");
  link.update(job({ state: "converting", progress: 40 }));
  assert.equal(log.posted.length, 3, "rien de nouveau : rien d'envoyé");
  link.update(job({ state: "downloading", progress: 0, savedAs: "Vidéo.mp4" }));
  link.update(job({ state: "done", progress: 100, savedAs: "Vidéo.mp4" }));
  assert.deepEqual(log.posted.slice(-2).map((m) => [m.etat, m.progression, m.fichierAttendu]), [["telechargement", 0, "Vidéo.mp4"], ["telechargement", 1, "Vidéo.mp4"]]);
  assert.equal(log.connects, 1, "un seul port pour tout l'envoi");
  await until(() => log.closed === 1, 500, "port fermé après le dernier envoi");
  assert.equal(link.open, false);
  assert.equal(link.tracked, 0);
  assert.deepEqual([...new Set(links)], ["suivi"]);
  link.stop();
});

test("port partagé : trois envois en même temps → UN seul port (un seul processus hôte), fermé quand tous sont terminés", async () => {
  const log = { posted: [] as TransferMessage[], connects: 0, closed: 0 };
  const link = createDesktopLink({ connect: fakePort(log), onLink: () => undefined, progressMs: 10, idleMs: 20 });
  const keys = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"];
  for (const key of keys) link.update(job({ key, state: "queued" }));
  for (const key of keys) link.update(job({ key, state: "converting", progress: 50 }));
  link.update(job({ key: keys[0], state: "done", savedAs: "a.mp4" }));
  link.update(job({ key: keys[1], state: "error" }));
  await tick(50);
  assert.equal(log.closed, 0, "un envoi encore en cours : port gardé");
  link.update(job({ key: keys[2], state: "cancelled" }));
  await until(() => log.closed === 1, 500, "port fermé");
  assert.equal(log.connects, 1);
  assert.deepEqual(new Set(log.posted.map((m) => m.id)), new Set(keys));
  // Un nouvel envoi plus tard : un nouveau port (le précédent processus est terminé).
  link.update(job({ key: "dddddddddddddddd", state: "queued" }));
  assert.equal(log.connects, 2);
  link.stop();
  assert.equal(log.closed, 2, "arrêt du worker : port fermé");
});

test("sans permission (connectNative absent) : rien n'est envoyé ni retenu, aucun avis", () => {
  const links: string[] = [];
  const link = createDesktopLink({ connect: () => null, onLink: (_k, l) => links.push(l) });
  link.update(job({ state: "queued" }));
  link.update(job({ state: "converting", progress: 10 }));
  assert.equal(link.tracked, 0);
  assert.deepEqual(links, []);
});

// 3.8.1 : les essais de bout en bout du service worker (annonce `transfert` pendant un téléchargement Chrome vers
// Téléchargements › AETHRYON) sont retirés : « Envoyer vers › Premiere Pro » est désormais relayé à AETHRYON Desktop sans
// téléchargement Chrome (src/background/relais.ts ; essais dans tests/unit/premiere.test.ts). Le module desktop.ts
// (liste fermée, noms, port partagé) reste vérifié ci-dessus.

test("permission : demandée DANS le geste avec { permissions: [nativeMessaging] } ; refus, erreur ou API absente → faux, sans exception", async () => {
  const calls: unknown[] = [];
  const api = (answer: boolean | Error) => ({
    contains: async () => answer === true,
    request: (p: unknown) => {
      calls.push(p);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  }) as any;
  assert.equal(await askDesktopLink(api(true)), true);
  assert.equal(await askDesktopLink(api(false)), false);
  assert.equal(await askDesktopLink(api(new Error("This function must be called during a user gesture"))), false);
  assert.equal(await askDesktopLink({ request: () => { throw new Error("x"); } } as any), false);
  assert.equal(await askDesktopLink(undefined), false);
  assert.deepEqual(calls, [NATIVE_PERMISSION, NATIVE_PERMISSION, NATIVE_PERMISSION]);
  assert.deepEqual(NATIVE_PERMISSION, { permissions: ["nativeMessaging"] });
  assert.equal(await hasDesktopLink(api(true)), true);
  assert.equal(await hasDesktopLink({ contains: () => Promise.reject(new Error("x")) } as any), false);
  assert.equal(await hasDesktopLink(undefined), false);
  // L'appel part de façon SYNCHRONE (avant tout await), condition de Chrome pour ouvrir sa demande.
  let syncCalled = false;
  const p = askDesktopLink({ request: () => { syncCalled = true; return Promise.resolve(true); } } as any);
  assert.equal(syncCalled, true);
  await p;
});
