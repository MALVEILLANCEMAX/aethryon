// Parcours COMPLET dans un vrai Chromium avec l'extension construite (aucun composant simulé côté
// extension) : bouton AETHRYON intégré à une page YouTube (page FABRIQUÉE servie sous
// www.youtube.com, aucune requête vers YouTube) → popover → « Télécharger » → service worker → API de
// PRÉPRODUCTION (ytapi à faux worker, compte réel) → fichier écrit par chrome.downloads dans le dossier
// de téléchargement du profil de test → « Enregistré » dans la page. Vérifié ensuite : fichier (ffprobe),
// conversion visible dans l'historique du compte (même quota que le raccourci).
// Simulé : la page YouTube (fabriquée) et la liaison du compte (état « connecté » injecté, comme si la
// fenêtre de connexion avait abouti ; le flux PKCE réel est couvert par download.test.mjs).
//   node --test tests/browser/integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDev, cdpFor, waitFor, ROOT } from "./helpers.mjs";
import { launchWithExtension } from "../support/browser.mjs";
import { preprodAvailable, testSession, web } from "../support/preprod.mjs";

const RUN = Date.now().toString(36);
const VIDEO_ID = (`it${RUN}xxxxxxxxx`).replace(/[^A-Za-z0-9_-]/g, "x").slice(0, 11);
const VIDEO_ID_MP3 = (`mp${RUN}yyyyyyyyy`).replace(/[^A-Za-z0-9_-]/g, "y").slice(0, 11);
const FIXTURE = join(ROOT, "tests", "fixtures", "youtube-watch.html");
let env, downloads, cookie, key, blocked = [];

const skip = !preprodAvailable() ? "préproduction indisponible" : false;

before(async () => {
  if (skip) return;
  buildDev();
  downloads = mkdtempSync(join(tmpdir(), "aethryon-dl-"));
  cookie = testSession(`ext-integration-${RUN}@preprod.test`);
  const k = await web(cookie, "/api/keys", { method: "POST", body: { name: "Extension (intégration)" } });
  assert.equal(k.status, 201, "clé ytc_ de préproduction");
  key = k.body.secret;
  env = await launchWithExtension({ extDir: join(ROOT, "dist-dev"), downloadDir: downloads });
  // Réseau : la page YouTube fabriquée, la préproduction locale ; tout le reste est bloqué.
  const fixture = (await import("node:fs")).readFileSync(FIXTURE, "utf8");
  await env.context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === "chrome-extension:" || u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    if (u.hostname === "www.youtube.com" && u.pathname === "/watch") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture });
    blocked.push(u.origin);
    return route.abort("blockedbyclient");
  });
  // État « connecté » (la fenêtre de connexion n'est pas pilotable ici) : forme AuthState de storage.ts.
  const sw = await env.worker();
  // Notice sur les données acceptée (vrai chemin, comme « Accepter » sur la page d'accueil).
  assert.equal((await env.acceptConsent())?.ok, true);
  await sw.evaluate((a) => chrome.storage.local.set({ auth: a }), {
    token: key, expiresAt: null, email: `ext-integration-${RUN}@preprod.test`, name: "Test intégration", linkedAt: new Date().toISOString(),
  });
});

after(async () => {
  if (skip) return;
  await env?.close();
  if (cookie) await web(cookie, "/api/auth/delete-user", { method: "POST" });
  if (downloads) rmSync(downloads, { recursive: true, force: true });
});

async function convertFromPage(videoId, fmt) {
  const page = await env.context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`https://www.youtube.com/watch?v=${videoId}&title=Int%C3%A9gration%20${fmt}`);
  const s = await cdpFor(page);
  const [c] = await waitFor(async () => { const l = await s.controls("aethryon-control"); return l.length === 1 ? l : null; }, { message: "bouton AETHRYON dans la page", timeout: 10_000 });
  // Menu V3.5 : « Télécharger la vidéo » (MP4) ou « Extraire l'audio » (MP3), chacun avec son réglage par défaut.
  await s.click(c.handle, ".trigger");
  await waitFor(async () => { const [cur] = await s.controls("aethryon-control"); return cur?.ui?.open ? cur : null; }, { message: "menu ouvert", timeout: 10_000 });
  await s.click(c.handle, fmt === "mp3" ? ".r-audio" : ".r-video");
  // « Enregistré » n'apparaît qu'à l'état done = downloads.onChanged « complete » (état du menu ; pastille de la barre).
  const final = await waitFor(async () => {
    const [cur] = await s.controls("aethryon-control");
    const st = cur?.ui?.status;
    if (st && /Échec|ne répond pas/.test(`${st.state} ${st.message}`)) throw new Error(`échec affiché : ${st.state} — ${st.message}`);
    return (st?.phase === "done" && st.state === "Enregistré") || cur?.ui?.toolbar?.chip === "Enregistré" ? cur : null;
  }, { message: `« Enregistré » pour ${fmt}`, timeout: 60_000, interval: 250 });
  await s.detach();
  await page.close();
  assert.deepEqual(errors, [], "aucune erreur de page");
  return final;
}

function probe(file) {
  const out = execFileSync("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", `${downloads}:/d:ro`, "--entrypoint", "ffprobe", "ytc2-ytapi:reel",
    "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", `/d/${file}`]).toString();
  return JSON.parse(out).streams.map((x) => `${x.codec_type}:${x.codec_name}`).sort();
}

test("bouton intégré YouTube → MP4 : fichier réellement écrit, puis « Enregistré » dans la page", { skip }, async () => {
  const before = new Set(readdirSync(downloads));
  await convertFromPage(VIDEO_ID, "mp4");
  const files = readdirSync(downloads).filter((f) => !before.has(f) && !f.endsWith(".crdownload"));
  assert.equal(files.length, 1, `un fichier MP4 dans le dossier (vus : ${readdirSync(downloads).join(", ")})`);
  assert.match(files[0], /\.mp4$/);
  assert.ok(statSync(join(downloads, files[0])).size > 0);
  assert.deepEqual(probe(files[0]), ["audio:aac", "video:h264"]);
});

test("bouton intégré YouTube → MP3 : fichier MP3 réel", { skip }, async () => {
  const before = new Set(readdirSync(downloads));
  await convertFromPage(VIDEO_ID_MP3, "mp3");
  const files = readdirSync(downloads).filter((f) => !before.has(f) && !f.endsWith(".crdownload"));
  assert.equal(files.length, 1);
  assert.match(files[0], /\.mp3$/);
  assert.ok(probe(files[0]).includes("audio:mp3"));
});

test("même compte, même quota : les deux conversions sont dans l'historique du site", { skip }, async () => {
  const a = await web(cookie, "/api/activity?limit=10");
  assert.equal(a.status, 200);
  const done = a.body.items.filter((i) => i.state === "done" && i.platform === "youtube");
  assert.equal(done.length, 2, JSON.stringify(a.body.items.map((i) => [i.state, i.platform, i.fmt])));
  assert.deepEqual(done.map((i) => i.fmt).sort(), ["mp3", "mp4"]);
  assert.equal(a.body.today.used >= 2, true);
  // Toute requête hors préproduction a été bloquée par le routage (jamais envoyée) : on la signale seulement.
  if (blocked.length) console.log(`requêtes bloquées (jamais envoyées) : ${[...new Set(blocked)].join(", ")}`);
});
