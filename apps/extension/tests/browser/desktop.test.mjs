// 3.5.2 : lien navigateur → AETHRYON Desktop, de bout en bout, dans un VRAI Chromium (Chrome for Testing de
// Playwright, new headless) :
// - le VRAI hôte Native Messaging du Desktop (exemple `banc` du noyau, même code que `aethryon-desktop.exe --nm`),
//   déclaré pour le profil de test dans <profil>/NativeMessagingHosts/fr.aethryon.desktop.json, allowed_origins =
//   l'extension de développement ; Chrome le lance lui-même (`banc chrome-extension://<id>/`) ;
// - le VRAI service du Desktop pour Linux (même exécutable, mode service, `--sans-analyse`) sur le même profil
//   (AETHRYON_BASE) : il surveille Téléchargements/AETHRYON, indexe le fichier arrivé et relie le transfert (« pret ») ;
// - le faux ytapi du banc (tests/support/fake-api.mjs, local) : connexion PKCE réelle, conversion simulée ;
// - permission FACULTATIVE « nativeMessaging » : la demande de Chrome ne peut pas être cliquée en mode sans tête ; son
//   accord est simulé en écrivant dans les préférences du profil ce que Chrome y écrit quand l'utilisateur accepte.
// Exécutable de l'hôte : AETHRYON_NM_EXE (tests/support/desktop-host.sh le construit) ; absent → banc sauté.
//   AETHRYON_NM_EXE=/chemin/banc node --test tests/browser/desktop.test.mjs
// Ce banc ne remplace PAS l'essai sous Windows (registre HKCU, aethryon-desktop.exe, Chrome, Edge, Brave).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, launchWithExtension } from "../support/browser.mjs";
import { startFakeServer } from "../support/fake-api.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXE = process.env.AETHRYON_NM_EXE ?? "";
const HOST = "fr.aethryon.desktop";
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const SEED = String(Date.now() % 100000).padStart(5, "0");
const TT = (n, user = "e2e") => `https://www.tiktok.com/@${user}/video/7${SEED}${String(n).padStart(13, "0")}`;
/** Champs d'un transfert (contrat §6) : ceux de l'extension, plus ceux que l'hôte et le Desktop ajoutent. */
const CONTRAT = new Set(["schema", "id", "titre", "plateforme", "format", "etat", "progression", "fichierAttendu", "chemin", "erreur", "majLe"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 20_000, every = 50, what = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`);
    await sleep(every);
  }
}

/** Processus hôtes lancés par Chrome (`<exe> chrome-extension://…`), jamais le service du Desktop. */
function hostProcesses() {
  const out = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout ?? "";
  return out.split("\n").filter((l) => l.includes(EXE) && l.includes("chrome-extension://")).map((l) => Number(l.trim().split(/\s+/)[0]));
}

/** Simule « Autoriser » dans la demande de Chrome : ce que Chrome écrit dans le profil quand l'utilisateur accepte. */
function grantInProfile(profile, permission) {
  const f = join(profile, "Default", "Preferences");
  const prefs = JSON.parse(readFileSync(f, "utf8"));
  const s = prefs.extensions?.settings?.[EXTENSION_ID];
  if (!s) throw new Error("réglages de l'extension introuvables dans le profil");
  for (const k of ["granted_permissions", "active_permissions"]) {
    s[k] = s[k] ?? {};
    s[k].api = [...new Set([...(s[k].api ?? []), permission])];
  }
  writeFileSync(f, JSON.stringify(prefs));
}

const frame = (o) => {
  const b = Buffer.from(JSON.stringify(o), "utf8");
  const l = Buffer.alloc(4);
  l.writeUInt32LE(b.length);
  return Buffer.concat([l, b]);
};
const frames = (buf) => {
  const out = [];
  for (let i = 0; i + 4 <= buf.length;) {
    const n = buf.readUInt32LE(i);
    out.push(JSON.parse(buf.subarray(i + 4, i + 4 + n).toString("utf8")));
    i += 4 + n;
  }
  return out;
};

describe("AETHRYON Desktop : vrai Chromium, vrai hôte Native Messaging, vrai service du Desktop", { skip: !EXE || !existsSync(EXE) ? "AETHRYON_NM_EXE absent (tests/support/desktop-host.sh)" : false }, () => {
  let fake;
  let b;
  let work;
  let base;
  let dl;
  let R;
  let desktop;
  let desktopOut = "";
  let profile;
  const env = () => ({ AETHRYON_BASE: base });
  const manifest = () => ({ [HOST]: { name: HOST, description: "AETHRYON Desktop (banc Linux)", path: EXE, type: "stdio", allowed_origins: [ORIGIN] } });
  const launch = (reuse = null) => launchWithExtension({ extDir: join(ROOT, "tests/out/dist-desktop"), downloadDir: dl, env: env(), profile: reuse, nativeHosts: manifest() });
  const transfer = (key) => {
    try {
      return JSON.parse(readFileSync(join(R, "transferts", `${key}.json`), "utf8"));
    } catch {
      return null; // absent, ou en cours d'écriture (écriture atomique : réessayé au passage suivant)
    }
  };
  const index = () => {
    try {
      return JSON.parse(readFileSync(join(R, "bibliotheque", "index.json"), "utf8"));
    } catch {
      return { medias: [] };
    }
  };
  /** Lance un envoi vers Premiere et suit, pendant ce temps, le fichier de transfert et les processus hôtes. */
  async function sendToPremiere(url, { fmt = "mp4", title = "Coucher de soleil" } = {}) {
    // Témoin dans le service worker : chaque message posté vers l'hôte est aussi noté (le vrai port reste utilisé).
    await (await b.worker()).evaluate(() => {
      if (self.__nmWrapped || typeof chrome.runtime.connectNative !== "function") return;
      self.__nmWrapped = true;
      self.__nm = [];
      const real = chrome.runtime.connectNative.bind(chrome.runtime);
      chrome.runtime.connectNative = (name) => {
        const port = real(name);
        const post = port.postMessage.bind(port);
        port.postMessage = (m) => { self.__nm.push({ name, m: structuredClone(m) }); post(m); };
        return port;
      };
    });
    const r = await b.send({ type: "job.start", url, fmt, dest: "premiere", title });
    assert.equal(r?.ok, true, `job.start : ${r?.error?.code ?? "sans réponse"}`);
    const key = r.data.key;
    const seen = [];
    let maxHosts = 0;
    let stop = false;
    const sampler = (async () => {
      while (!stop) {
        const t = transfer(key);
        if (t && (seen.at(-1)?.etat !== t.etat || seen.at(-1)?.fichierAttendu !== t.fichierAttendu)) seen.push(t);
        maxHosts = Math.max(maxHosts, hostProcesses().length);
        await sleep(20);
      }
    })();
    const job = await b.waitJob(key, (j) => ["done", "error", "cancelled"].includes(j.state), { timeoutMs: 60_000 });
    const posted = async () => ((await (await b.worker()).evaluate(() => self.__nm ?? [])) ?? []).filter((x) => x.m?.id === key);
    return { key, job, seen, posted, maxHosts: () => maxHosts, stop: async () => { stop = true; await sampler; } };
  }

  before(async () => {
    fake = await startFakeServer({ slowMs: 2_500 });
    execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", "--out=tests/out/dist-desktop"], {
      cwd: ROOT, env: { ...process.env, AETHRYON_API: fake.apiBase, AETHRYON_SITE: fake.siteBase }, stdio: "ignore",
    });
    work = mkdtempSync(join(tmpdir(), "aethryon-desktop-e2e-"));
    base = join(work, "profil-desktop");
    const maison = join(work, "maison");
    dl = join(maison, "Downloads");
    mkdirSync(dl, { recursive: true });
    R = join(base, "Local", "AETHRYON");
    // Le vrai service du Desktop (Linux), sur ce profil : surveille <maison>/Downloads/AETHRYON.
    desktop = spawn(EXE, ["--sans-analyse"], { env: { ...process.env, AETHRYON_BASE: base, BANC_MAISON: maison, BANC_JOURNAL: join(work, "appels.txt") }, stdio: ["pipe", "pipe", "pipe"] });
    desktop.stdout.on("data", (d) => { desktopOut = (desktopOut + d).slice(-20_000); });
    desktop.stderr.on("data", (d) => { desktopOut = (desktopOut + d).slice(-20_000); });
    await waitFor(() => desktopOut.includes("\"demarre\""), { what: "service du Desktop démarré" });
    b = await launch();
    profile = b.profile;
    await b.worker();
    assert.equal((await b.acceptConsent())?.ok, true);
    const r = await b.send({ type: "auth.login" });
    assert.equal(r?.ok, true, `auth.login : ${r?.error?.code ?? "sans réponse"}`);
  });

  after(async () => {
    await b?.close();
    if (desktop && desktop.exitCode === null) {
      desktop.stdin.write("arret\n");
      await Promise.race([new Promise((r) => desktop.on("exit", r)), sleep(3_000)]);
      desktop.kill("SIGKILL");
    }
    await fake?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  test("permission FACULTATIVE dans Chrome : déclarée, non accordée à l'installation ; sans elle, aucun hôte lancé, fichier dans AETHRYON/", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 90_000 }, async (t) => {
    t.diagnostic(`navigateur : ${b.version} ; hôte : ${EXE}`);
    const m = JSON.parse(readFileSync(join(ROOT, "tests/out/dist-desktop/manifest.json"), "utf8"));
    assert.deepEqual(m.optional_permissions, ["notifications", "nativeMessaging"]);
    assert.equal(m.permissions.includes("nativeMessaging"), false);
    assert.equal(await b.page.evaluate(() => chrome.permissions.contains({ permissions: ["nativeMessaging"] })), false);
    assert.equal(await (await b.worker()).evaluate(() => typeof chrome.runtime.connectNative), "undefined", "API absente sans la permission");
    // Chrome la reconnaît comme facultative : sa demande S'OUVRE (en attente d'un clic, impossible sans tête),
    // alors qu'une permission non déclarée est refusée sur-le-champ.
    const ask = (p) => b.page.evaluate((perm) => Promise.race([
      chrome.permissions.request({ permissions: [perm] }).then((g) => `accordée : ${g}`, (e) => `refusée : ${e.message}`),
      new Promise((r) => setTimeout(() => r("demande ouverte"), 1_500)),
    ]), p);
    assert.equal(await ask("tabs"), "refusée : Only permissions specified in the manifest may be requested.");
    assert.equal(await ask("nativeMessaging"), "demande ouverte");
    const { job, seen, stop } = await sendToPremiere(TT(1));
    await stop();
    assert.equal(job.state, "done", `${job.state} ${job.error?.code ?? ""}`);
    assert.ok(existsSync(join(dl, "AETHRYON", job.fileName)), "fichier dans Téléchargements/AETHRYON comme avant");
    assert.equal(job.desktop, undefined, "aucun avis : rien n'a été tenté");
    assert.deepEqual(seen, [], "aucun transfert écrit");
    assert.equal(existsSync(join(R, "transferts")) && readdirSync(join(R, "transferts")).length > 0, false);
    // Le Desktop voit quand même le fichier (il surveille le dossier) : il entre dans la bibliothèque.
    await waitFor(() => index().medias.some((x) => basename(x.chemin) === job.fileName && x.etat === "disponible"), { what: "fichier indexé par le Desktop" });
  });

  test("accord donné (simulé dans le profil) → Desktop suit l'envoi : attente/conversion → telechargement → « pret » posé par le Desktop ; un seul hôte, arrêté ensuite ; ni jeton ni adresse", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 120_000 }, async () => {
    await b.close({ keepProfile: true });
    grantInProfile(profile, "nativeMessaging");
    b = await launch(profile);
    assert.equal(await b.page.evaluate(() => chrome.permissions.contains({ permissions: ["nativeMessaging"] })), true);
    assert.equal(await (await b.worker()).evaluate(() => typeof chrome.runtime.connectNative), "function");
    const run = await sendToPremiere(TT(2, "slow"));
    const { key, job } = run;
    assert.equal(job.state, "done", `${job.state} ${job.error?.code ?? ""}`);
    const final = join(dl, "AETHRYON", job.fileName);
    assert.ok(existsSync(final));
    const linked = await waitFor(() => { const x = transfer(key); return x?.etat === "pret" ? x : null; }, { timeoutMs: 30_000, what: "transfert relié par le Desktop (pret)" });
    await run.stop();
    if (run.seen.at(-1)?.etat !== "pret") run.seen.push(linked); // relu par waitFor juste avant l'arrêt du témoin
    // Ce que l'extension a posté (témoin) : la suite complète des états, jamais « pret ».
    const sent = await run.posted();
    assert.ok(sent.length >= 3 && sent.every((x) => x.name === "fr.aethryon.desktop"));
    const sentEtats = sent.map((x) => x.m.etat).filter((e, i, a) => i === 0 || a[i - 1] !== e);
    assert.deepEqual(sentEtats, ["attente", "conversion", "telechargement"], `postés : ${sent.map((x) => x.m.etat).join(" → ")}`);
    assert.deepEqual(sent.at(-1).m, { type: "transfert", id: key, etat: "telechargement", titre: "Vidéo de test", plateforme: "tiktok", format: "mp4", progression: 1, fichierAttendu: job.fileName });
    for (const x of sent) for (const k of Object.keys(x.m)) assert.ok(["type", "id", "titre", "plateforme", "format", "etat", "progression", "fichierAttendu"].includes(k), k);
    // Ce que l'hôte a écrit (fichier relu toutes les 20 ms : un état très bref peut ne pas être vu), puis le Desktop.
    const etats = run.seen.map((x) => x.etat);
    assert.ok(etats.includes("attente"), `états vus : ${etats.join(" → ")}`);
    assert.ok(etats.includes("telechargement"), `états vus : ${etats.join(" → ")}`);
    assert.equal(etats.at(-1), "pret");
    assert.deepEqual(etats.filter((e, i) => etats.indexOf(e) === i), etats.filter((e, i) => i === 0 || etats[i - 1] !== e), "aucun retour en arrière");
    assert.equal(linked.chemin, final, "relié au fichier écrit par Chrome");
    assert.equal(linked.fichierAttendu, job.fileName);
    assert.equal(linked.progression, 1);
    assert.deepEqual([linked.schema, linked.id, linked.plateforme, linked.format, linked.titre], [1, key, "tiktok", "mp4", "Vidéo de test"]);
    for (const x of run.seen) {
      for (const k of Object.keys(x)) assert.ok(CONTRAT.has(k), `champ hors contrat : ${k}`);
      const text = JSON.stringify(x);
      assert.ok(!text.includes(fake.tokenForTest()), "jeton jamais écrit");
      assert.ok(!text.includes(job.jobId), "identifiant du serveur jamais écrit");
      assert.doesNotMatch(text.replace(JSON.stringify(final).slice(1, -1), ""), /:\/\/|127\.0\.0\.1|localhost|tiktok\.com/, text);
    }
    // Avant que le fichier soit écrit, aucun nom provisoire (pas de liaison possible à un ancien fichier).
    for (const x of run.seen.filter((y) => y.etat === "attente" || y.etat === "conversion")) assert.equal(x.fichierAttendu ?? null, null);
    for (const x of sent.filter((y) => y.m.etat !== "telechargement")) assert.equal("fichierAttendu" in x.m, false);
    // Bibliothèque du Desktop : origine reprise du transfert.
    const media = await waitFor(() => index().medias.find((x) => x.chemin === final && x.origine?.plateforme === "tiktok"), { what: "origine dans l'index" });
    assert.equal(media.origine.titre, "Vidéo de test");
    assert.equal(job.desktop, "suivi");
    assert.equal(run.maxHosts(), 1, "un seul processus hôte pendant l'envoi");
    await waitFor(() => hostProcesses().length === 0, { timeoutMs: 10_000, what: "hôte arrêté après l'envoi (port fermé)" });
    // Aucun fichier temporaire laissé par l'hôte, rien d'autre que des transferts.
    assert.deepEqual(readdirSync(join(R, "transferts")).filter((n) => !n.endsWith(".json")), []);
  });

  test("deux envois en même temps, même nom côté serveur : « uniquify » de Chrome → chaque transfert relié à SON fichier ; un seul hôte", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 120_000 }, async () => {
    const [a, c] = await Promise.all([sendToPremiere(TT(3, "same")), sendToPremiere(TT(4, "same"))]);
    for (const r of [a, c]) assert.equal(r.job.state, "done", `${r.job.state} ${r.job.error?.code ?? ""}`);
    const names = [a.job.fileName, c.job.fileName].sort();
    assert.deepEqual(names, ["Vidéo de test [same] (1).mp4", "Vidéo de test [same].mp4"]);
    for (const r of [a, c]) {
      const x = await waitFor(() => { const y = transfer(r.key); return y?.etat === "pret" ? y : null; }, { timeoutMs: 30_000, what: `transfert ${r.key} relié` });
      assert.equal(x.fichierAttendu, r.job.fileName);
      assert.equal(x.chemin, join(dl, "AETHRYON", r.job.fileName));
    }
    await a.stop();
    await c.stop();
    assert.ok(Math.max(a.maxHosts(), c.maxHosts()) <= 1, `processus hôtes simultanés : ${Math.max(a.maxHosts(), c.maxHosts())}`);
    await waitFor(() => hostProcesses().length === 0, { timeoutMs: 10_000, what: "hôte arrêté" });
  });

  test("Desktop absent (hôte non déclaré) : fichier quand même dans AETHRYON/, ligne calme dans le popup, aucune erreur, aucun processus", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 90_000 }, async () => {
    const m = join(profile, "NativeMessagingHosts", `${HOST}.json`);
    renameSync(m, `${m}.retire`);
    try {
      const run = await sendToPremiere(TT(5));
      await run.stop();
      const { key, job } = run;
      assert.equal(job.state, "done", `${job.state} ${job.error?.code ?? ""}`);
      assert.equal(job.error, undefined);
      assert.ok(existsSync(join(dl, "AETHRYON", job.fileName)));
      const last = await waitFor(async () => { const j = (await b.send({ type: "jobs.list" }))?.data?.find((x) => x.key === key); return j?.desktop === "absent" ? j : null; }, { what: "envoi marqué absent" });
      assert.equal(last.state, "done");
      assert.equal(transfer(key), null, "aucun transfert écrit");
      assert.equal(run.maxHosts(), 0, "aucun processus hôte");
      await b.page.reload();
      const note = await b.page.locator(`li.job[data-key="${key}"] .job-note`).textContent({ timeout: 10_000 });
      assert.equal(note, "Installe AETHRYON Desktop pour suivre l'envoi");
      assert.equal(await b.page.locator(`li.job[data-key="${key}"] .job-status`).getAttribute("data-tone"), "ok", "l'envoi est réussi, pas en erreur");
    } finally {
      renameSync(`${m}.retire`, m);
    }
  });

  test("trames réelles (hôte lancé à la main) : les noms que l'extension annonce sont exactement ceux que l'hôte accepte", { timeout: 30_000 }, async () => {
    await import("../unit/fakes/setup.ts");
    const { expectedFile, transferMessage } = await import("../../src/background/desktop.ts");
    const names = ["Le Passage.mp4", "Vidéo de test [same] (1).mp4", "Interview — Montréal.mp4", "Soirée 🎬 — « été ».mp4", "a  b.mp4", " a.mp4",
      "a.mp4.", "a .mp4", "CON.mp4", "a b.mp4", "été.mp4", "x".repeat(116) + ".mp4", "x".repeat(117) + ".mp4", "a​b.mp4"];
    const msgs = names.map((n, i) => ({ type: "transfert", id: `trame-${i}`, etat: "telechargement", progression: 1, format: "mp4", fichierAttendu: n }));
    const tmp = mkdtempSync(join(tmpdir(), "aethryon-trames-"));
    try {
      const r = spawnSync(EXE, [ORIGIN, "--parent-window=0"], { env: { ...process.env, AETHRYON_BASE: tmp }, input: Buffer.concat(msgs.map(frame)) });
      assert.equal(r.status, 0, r.stderr.toString());
      const replies = frames(r.stdout);
      assert.equal(replies.length, names.length);
      names.forEach((n, i) => assert.equal(replies[i].ok, expectedFile(n) === n, `${JSON.stringify(n)} : hôte ${replies[i].ok}, extension ${expectedFile(n) === n}`));
      // Et un vrai message de l'extension, tel quel : accepté.
      const real = transferMessage({ key: "Ab3dEf6hIj9kLm2n", dest: "premiere", fmt: "mp3", state: "done", platform: "twitter", title: "Titre https://x.com/a", savedAs: "Titre.mp3" });
      const ok = frames(spawnSync(EXE, ["--nm"], { env: { ...process.env, AETHRYON_BASE: tmp }, input: frame(real) }).stdout)[0];
      assert.deepEqual(ok, { ok: true, id: "Ab3dEf6hIj9kLm2n", etat: "telechargement" });
      const written = JSON.parse(readFileSync(join(tmp, "Local", "AETHRYON", "transferts", "Ab3dEf6hIj9kLm2n.json"), "utf8"));
      assert.deepEqual([written.titre, written.plateforme, written.format, written.fichierAttendu], ["Titre", "x", "mp3", "Titre.mp3"]);
      assert.ok(statSync(join(tmp, "Local", "AETHRYON", "transferts")).isDirectory());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
