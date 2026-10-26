// Destination « Premiere Pro » (3.5.1) dans un VRAI Chromium (Chrome for Testing, new headless) : vrai
// chrome.downloads.onDeterminingFilename, fichier écrit par le navigateur dans <dossier de téléchargement>/AETHRYON/
// avec le nom donné par le serveur (Content-Disposition) ; un téléchargement ordinaire reste à la racine, avec le
// nom de Chrome. Serveur LOCAL de test (tests/support/fake-api.mjs), connexion PKCE réelle ; aucun réseau extérieur.
//   node --test tests/browser/premiere.test.mjs
// Ce banc ne remplace PAS l'essai sous Windows (dossier %USERPROFILE%\Downloads\AETHRYON) ni le panneau de Premiere.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchWithExtension } from "../support/browser.mjs";
import { startFakeServer } from "../support/fake-api.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEED = String(Date.now() % 100000).padStart(5, "0");
const TT = (n, user = "e2e") => `https://www.tiktok.com/@${user}/video/7${SEED}${String(n).padStart(13, "0")}`;
// PNG 1×1 (image de la vidéo enregistrée par l'extension avec un nom choisi par elle).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("Premiere Pro : vrai Chromium, vrai onDeterminingFilename, fichiers sur le disque", () => {
  let fake;
  let b;
  let dl;

  before(async () => {
    fake = await startFakeServer();
    execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", "--out=tests/out/dist-premiere"], {
      cwd: ROOT, env: { ...process.env, AETHRYON_API: fake.apiBase, AETHRYON_SITE: fake.siteBase }, stdio: "ignore",
    });
    dl = mkdtempSync(join(tmpdir(), "aethryon-dl-premiere-"));
    b = await launchWithExtension({ extDir: join(ROOT, "tests/out/dist-premiere"), downloadDir: dl });
    await b.worker();
    assert.equal((await b.acceptConsent())?.ok, true);
    const r = await b.send({ type: "auth.login" });
    assert.equal(r?.ok, true, `auth.login : ${r?.error?.code ?? "sans réponse"}`);
  });

  after(async () => {
    await b?.close();
    await fake?.close();
    if (dl) rmSync(dl, { recursive: true, force: true });
  });

  const start = async (msg) => {
    const r = await b.send(msg);
    assert.equal(r?.ok, true, `job.start refusé : ${r?.error?.code ?? "sans réponse"}`);
    return b.waitJob(r.data.key, (j) => ["done", "error", "cancelled"].includes(j.state));
  };
  const chromePath = (id) => b.page.evaluate(async (x) => (await chrome.downloads.search({ id: x }))[0]?.filename ?? null, id);
  const listening = async () => (await b.worker()).evaluate(() => chrome.downloads.onDeterminingFilename.hasListeners());

  test("MP4 vers Premiere : transcode=true + 1080p demandés ; fichier complet dans AETHRYON/<nom du serveur>", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 60_000 }, async (t) => {
    t.diagnostic(`navigateur : ${b.version}`);
    assert.equal(await listening(), false, "aucun écouteur au repos");
    const j = await start({ type: "job.start", url: TT(1), fmt: "mp4", dest: "premiere" });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""}`);
    assert.equal(j.dest, "premiere");
    const body = fake.state.creates.find((c) => c.url === TT(1));
    assert.deepEqual(body, { url: TT(1), fmt: "mp4", quality: "1080", transcode: true });
    const file = join(dl, "AETHRYON", j.fileName);
    assert.ok(existsSync(file), `fichier attendu : AETHRYON/${j.fileName} (dossier : ${readdirSync(dl).join(", ")})`);
    assert.equal(statSync(file).size, fake.fileSize);
    assert.equal(existsSync(join(dl, j.fileName)), false, "rien à la racine");
    assert.equal(await chromePath(j.downloadId), file, "chemin rapporté par Chrome");
    assert.match(j.fileName, /^Vidéo de test \[fake\w+\]\.mp4$/, "nom du serveur (Content-Disposition), inchangé");
    assert.equal(await listening(), false, "écouteur retiré une fois le nom donné");
  });

  test("MP3 vers Premiere : même dossier ; rien de plus demandé au serveur", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 60_000 }, async () => {
    const j = await start({ type: "job.start", url: TT(2), fmt: "mp3", dest: "premiere" });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""}`);
    assert.deepEqual(fake.state.creates.find((c) => c.url === TT(2)), { url: TT(2), fmt: "mp3", bitrate: 192 });
    assert.ok(existsSync(join(dl, "AETHRYON", j.fileName)));
  });

  test("Téléchargements : fichier à la racine avec le nom de Chrome, corps envoyé au serveur identique à la 3.5.0, aucun écouteur", { timeout: 60_000 }, async () => {
    const j = await start({ type: "job.start", url: TT(3), fmt: "mp4" });
    assert.equal(j.state, "done", `${j.state} ${j.error?.code ?? ""}`);
    assert.equal(j.dest, undefined);
    assert.deepEqual(fake.state.creates.find((c) => c.url === TT(3)), { url: TT(3), fmt: "mp4", quality: "best" });
    assert.ok(existsSync(join(dl, j.fileName)), "à la racine du dossier de téléchargement");
    assert.equal(existsSync(join(dl, "AETHRYON", j.fileName)), false);
    assert.equal(await listening(), false);
  });

  test("Chrome 153 : un écouteur qui répond « rien à changer » fait OUBLIER le nom choisi par l'extension ; le redonner le garde", { timeout: 30_000 }, async (t) => {
    // Raison de premiere.ts withName() : pendant un envoi vers Premiere, une image ou une miniature enregistrée par
    // l'extension perdrait sinon son nom.
    const sw = await b.worker();
    const save = (name, mode) => sw.evaluate(async ({ png, name, mode }) => {
      const l = (item, suggest) => { if (mode === "keep") suggest({ filename: name, conflictAction: "uniquify" }); else suggest(); };
      chrome.downloads.onDeterminingFilename.addListener(l);
      try {
        const id = await chrome.downloads.download({ url: png, filename: name, conflictAction: "uniquify", saveAs: false });
        for (let i = 0; i < 100; i++) {
          const [item] = await chrome.downloads.search({ id });
          if (item?.state === "complete") return item.filename;
          await new Promise((r) => setTimeout(r, 50));
        }
        return null;
      } finally {
        chrome.downloads.onDeterminingFilename.removeListener(l);
      }
    }, { png: PNG, name, mode });
    const lost = await save("Image A (1m02s).png", "none");
    t.diagnostic(`suggest() sans argument : ${lost}`);
    assert.notEqual(lost, join(dl, "Image A (1m02s).png"), "comportement de Chrome constaté : le nom choisi est perdu");
    assert.equal(await save("Image B (1m02s).png", "keep"), join(dl, "Image B (1m02s).png"));
  });

  test("fichier d'un SITE (lien « download ») pendant que l'écouteur est posé : nom du site gardé (suggest() sans argument)", { timeout: 30_000 }, async () => {
    const sw = await b.worker();
    await sw.evaluate(() => {
      self.__l = (_item, suggest) => { suggest(); };
      chrome.downloads.onDeterminingFilename.addListener(self.__l);
    });
    const page = await b.context.newPage();
    try {
      await page.setContent('<a id="a" download="Facture test 2026.pdf">Télécharger</a>');
      await page.evaluate(() => { document.getElementById("a").href = URL.createObjectURL(new Blob(["%PDF-1.4 test"], { type: "application/pdf" })); });
      await page.click("#a");
      const file = join(dl, "Facture test 2026.pdf");
      for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(existsSync(file), `nom du site gardé (dossier : ${readdirSync(dl).join(", ")})`);
    } finally {
      await page.close();
      await sw.evaluate(() => chrome.downloads.onDeterminingFilename.removeListener(self.__l));
    }
  });

  test("Premiere et Téléchargements EN MÊME TEMPS (fichier lent) : seul le fichier « Premiere » va dans AETHRYON/", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 60_000 }, async () => {
    const p = b.send({ type: "job.start", url: TT(7, "late"), fmt: "mp4", dest: "premiere" });
    const n = b.send({ type: "job.start", url: TT(8), fmt: "mp4" });
    const [rp, rn] = await Promise.all([p, n]);
    assert.equal(rp?.ok, true);
    assert.equal(rn?.ok, true);
    // Le fichier « Premiere » attend ses en-têtes 1,5 s (écouteur posé) pendant que le fichier ordinaire est nommé.
    const [jp, jn] = await Promise.all([rp, rn].map((r) => b.waitJob(r.data.key, (j) => ["done", "error", "cancelled"].includes(j.state), { timeoutMs: 30_000 })));
    assert.equal(jp.state, "done");
    assert.equal(jn.state, "done");
    assert.ok(existsSync(join(dl, "AETHRYON", jp.fileName)), "Premiere : AETHRYON/");
    assert.ok(existsSync(join(dl, jn.fileName)), "ordinaire : racine, nom du serveur");
    assert.equal(existsSync(join(dl, "AETHRYON", jn.fileName)), false);
    assert.match(jn.fileName, /^Vidéo de test \[fake\w+\]\.mp4$/);
    assert.equal(await listening(), false);
  });

  test("deux envois vers Premiere du même nom : le second ne remplace pas le premier (« uniquify »)", { skip: "3.8.1 : « Envoyer vers › Premiere Pro » ne passe plus par un téléchargement Chrome (relais AETHRYON Desktop, src/background/relais.ts) ; essai à réécrire avec le faux hôte du relais", timeout: 60_000 }, async () => {
    const first = await start({ type: "job.start", url: TT(5, "same"), fmt: "mp4", dest: "premiere" });
    const second = await start({ type: "job.start", url: TT(6, "same"), fmt: "mp4", dest: "premiere" });
    assert.equal(first.state, "done");
    assert.equal(second.state, "done");
    assert.equal(first.fileName, "Vidéo de test [same].mp4");
    assert.equal(second.fileName, "Vidéo de test [same] (1).mp4");
    for (const n of [first.fileName, second.fileName]) assert.equal(statSync(join(dl, "AETHRYON", n)).size, fake.fileSize, n);
  });
});
