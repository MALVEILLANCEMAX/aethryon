// Banc navigateur des EXTRAITS (3.6.0) : Chromium réel (new headless), extension construite pointée sur le serveur de
// test local (tests/support/fake-api.mjs, contrat des extraits : startMs/endMs, GET /limites, étapes réelles,
// extrait_partiel_impossible, annulation), VRAI service worker, VRAIE connexion PKCE au faux serveur, VRAIS
// téléchargements écrits sur le disque. Page YouTube FABRIQUÉE (tests/fixtures/youtube-watch.html) servie par
// interception ; sa vidéo est une vraie vidéo VP9 (20 s) lue par Media Source Extensions avec une durée annoncée de
// 10 min, 3 h ou 9 h (comme le lecteur de YouTube) : les instants au-delà de 20 s existent pour le lecteur, sans image.
// Couvert (adapté à TimeLens 3.8.0 ; la loupe est couverte par timelens.test.mjs) : poignées au pointeur (glisser,
// passage entier), lentille pendant le déplacement, champs HH:MM:SS.mmm (mode précis)
// (saisie partielle, sélection d'une partie, erreurs, bornes), clavier (pas, Maj, Alt, Début/Fin, Tab), loupe
// (zoom, glisser fin, Ctrl + molette), lecteur (instant courant, aller à, lecture du passage), export MP4, MP3, GIF
// (corps exact reçu par le serveur), étapes réelles avec ou sans pourcentage, annulation, erreurs (extraction
// partielle impossible, réseau, quota, refus du serveur), popup (même éditeur, lecteur de l'onglet par le service
// worker), mouvement réduit, captures aux tailles du menu et du popup.
//   node --test tests/browser/extraits.test.mjs
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID, launchWithExtension } from "../support/browser.mjs";
import { startFakeServer } from "../support/fake-api.mjs";
import { cdpFor, waitFor } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "tests", "out", "extraits");
mkdirSync(OUT, { recursive: true });
const NB = " ";
const YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const FIXTURE = readFileSync(join(ROOT, "tests", "fixtures", "youtube-watch.html"), "utf8");
const VIDEO = readFileSync(join(ROOT, "tests", "fixtures", "media", "extrait-20s-mse.webm")); // même vidéo, remuxée (ffmpeg -c copy -f webm) : lisible par Media Source Extensions
const shots = [];

function build(out, env) {
  execFileSync(process.execPath, ["scripts/build.mjs", "--target=dev", `--out=${out}`], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
  return join(ROOT, out);
}

/** HH:MM:SS.mmm (même format que l'éditeur). */
const tc = (ms) => {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor((ms % 3_600_000) / 60_000))}:${p(Math.floor((ms % 60_000) / 1000))}.${p(ms % 1000, 3)}`;
};

/** État de l'éditeur, lu dans la racine Shadow DOM fermée de la commande. */
const READ_CE = function () {
  const root = this.querySelector(".aeth");
  const pop = root?.querySelector(".pop");
  const ce = pop?.querySelector(".view[data-view=clip] .ce");
  if (!ce) return null;
  const q = (s) => ce.querySelector(s);
  const shown = (el) => !!el && !el.hidden && !el.closest("[hidden]");
  const handle = (sel) => {
    const h = q(sel);
    return { now: Number(h.getAttribute("aria-valuenow")), text: h.getAttribute("aria-valuetext"), min: Number(h.getAttribute("aria-valuemin")), max: Number(h.getAttribute("aria-valuemax")),
      role: h.getAttribute("role"), label: h.getAttribute("aria-label") };
  };
  const lens = q(".tl-lens");
  const x = q(".xp");
  const bar = q(".xp-bar");
  const active = this.activeElement;
  return {
    open: pop.matches(":popover-open"), view: pop.getAttribute("data-view"),
    start: q(".ce-f-start input").value, end: q(".ce-f-end input").value,
    startInvalid: q(".ce-f-start input").getAttribute("aria-invalid") === "true", endInvalid: q(".ce-f-end input").getAttribute("aria-invalid") === "true",
    hs: handle(".tl-h-start"), he: handle(".tl-h-end"),
    dragging: q(".tl").getAttribute("data-dragging"),
    len: q(".tl-bubble").textContent, range: q(".ce-range").textContent, now: q(".ce-now").textContent, playing: q(".ce-play").getAttribute("aria-pressed") === "true",
    lens: { on: lens.hasAttribute("data-on"), val: q(".tl-lens-val").textContent, edge: q(".tl-lens-edge").textContent }, precis: !q(".ce-precis").hidden,
    msg: q(".ce-msg").textContent, msgTone: q(".ce-msg").getAttribute("data-tone"),
    limits: ce.getAttribute("data-limits"), quota: q(".ce-quota").hidden ? null : q(".ce-quota").textContent, keysShown: getComputedStyle(q(".ce-keys")).display !== "none" && !q(".ce-precis").hidden,
    fmt: q(".ce-fmt .ce-opt[aria-checked=true]")?.textContent ?? null, fnote: q(".ce-fmt .ce-opt[aria-checked=true]")?.getAttribute("title") ?? null,
    go: { shown: shown(q(".ce-go")), disabled: q(".ce-go").disabled, label: q(".ce-go").textContent, why: q(".ce-why").textContent },
    playhead: q(".tl-ph").hasAttribute("data-on"),
    scaleEnd: q(".tl-scale span:last-child").textContent,
    focus: active ? (active.getAttribute("data-edge") ? `handle:${active.getAttribute("data-edge")}` : active.className) : null,
    xp: x && !x.hidden ? {
      phase: x.getAttribute("data-phase"), mood: x.getAttribute("data-mood"), tone: x.getAttribute("data-tone"), role: x.getAttribute("role"),
      title: q(".xp-title").textContent, pct: q(".xp-pct").textContent, detail: q(".xp-detail").textContent,
      steps: [...x.querySelectorAll(".xp-step")].map((s) => s.getAttribute("data-state")),
      bar: { hidden: bar.hidden, indeterminate: bar.hasAttribute("data-indeterminate"), now: bar.getAttribute("aria-valuenow"), text: bar.getAttribute("aria-valuetext") },
      cancel: !q(".xp-cancel").hidden, show: !q(".xp-show").hidden, retry: !q(".xp-retry").hidden,
      ring: getComputedStyle(q(".xp-ring")).animationName, ringOpacity: Number(getComputedStyle(q(".xp-ring")).opacity),
    } : null,
    statusHidden: getComputedStyle(pop.querySelector(".status")).display === "none",
    popWidth: Math.round(pop.getBoundingClientRect().width), overflowX: pop.scrollWidth - pop.clientWidth,
    popRect: (() => { const r = pop.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
  };
};

let fake;
let b;
let dl;

before(async () => {
  fake = await startFakeServer({ clipStepMs: 1_600 });
  const ext = build("tests/out/dist-extraits", { AETHRYON_API: fake.apiBase, AETHRYON_SITE: fake.siteBase });
  dl = mkdtempSync(join(tmpdir(), "aethryon-dl-extraits-"));
  b = await launchWithExtension({ extDir: ext, downloadDir: dl, extraArgs: ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1", "--autoplay-policy=no-user-gesture-required"] });
  await b.worker();
  assert.equal((await b.acceptConsent())?.ok, true);
  // Vraie connexion (launchWebAuthFlow → faux site → échange PKCE), puis le compte (quota du jour) est lu.
  const login = await b.send({ type: "auth.login" });
  assert.equal(login?.ok, true, `connexion : ${login?.error?.code ?? "sans réponse"}`);
  await b.send({ type: "account.refresh" });
});

after(async () => {
  writeFileSync(join(OUT, "captures.json"), JSON.stringify(shots, null, 2));
  await b?.close();
  await fake?.close();
  if (dl) rmSync(dl, { recursive: true, force: true });
});

/** Page YouTube fabriquée ; vidéo VP9 de 20 s lue par MSE avec une durée annoncée de `durationS`. */
async function openWatch({ durationS = 600, at = 0, dark = false } = {}) {
  const page = await b.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("https://www.youtube.com/watch")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE });
    if (u.endsWith("/__media/extrait.webm")) return route.fulfill({ status: 200, contentType: "video/webm", body: VIDEO });
    return route.abort();
  });
  await page.goto(YT_URL);
  if (dark) await page.evaluate(() => document.documentElement.setAttribute("dark", ""));
  await page.evaluate(async ([dur, t]) => {
    const v = document.querySelector("video");
    v.removeAttribute("preload");
    v.muted = true;
    const buf = await (await fetch("/__media/extrait.webm")).arrayBuffer();
    const ms = new MediaSource();
    v.src = URL.createObjectURL(ms);
    await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
    const sb = ms.addSourceBuffer('video/webm; codecs="vp9, opus"');
    await new Promise((r, j) => { sb.addEventListener("updateend", r, { once: true }); sb.addEventListener("error", j, { once: true }); sb.appendBuffer(buf); });
    ms.duration = dur;
    if (v.readyState < 2) await new Promise((r) => v.addEventListener("loadeddata", r, { once: true }));
    if (t) {
      v.currentTime = t;
      if (t < 19) await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
    }
  }, [durationS, at]);
  const s = await cdpFor(page);
  const [c] = await waitFor(async () => {
    const list = await s.controls("aethryon-control");
    return list.length === 1 ? list : null;
  }, { message: "barre AETHRYON" });
  const read = () => s.callOn({ backendNodeId: c.handle.shadowBackend }, READ_CE);
  let last = null;
  const until = (pred, message, timeout = 8_000) => waitFor(async () => {
    const st = await read();
    last = st;
    return st && pred(st) ? st : null;
  }, { message, timeout }).catch((e) => {
    throw new Error(`${e.message} — dernier état : ${JSON.stringify(last && { start: last.start, end: last.end, msg: last.msg, go: last.go, xp: last.xp && { phase: last.xp.phase, title: last.xp.title, detail: last.xp.detail } })}`);
  });
  return { page, s, c, errors, read, until };
}

/** Ouvre le menu sur la vue Extrait (bouton « Extrait » de la barre YouTube). */
async function openClip(w) {
  await w.s.click(w.c.handle, ".tb-clip");
  const st = await w.until((x) => x.open && x.view === "clip" && x.limits === "serveur", "vue Extrait ouverte, limites lues");
  await w.page.waitForTimeout(300); // fin de l'entrée de la vue
  return st;
}

/** 3.8.0 : les champs HH:MM:SS.mmm sont dans le mode précis (« Ajuster finement »). */
async function precis(w) {
  const st = await w.read();
  if (!st.precis) {
    await w.s.click(w.c.handle, ".ce-fine");
    await w.page.waitForTimeout(300); // animation de hauteur (220 ms)
  }
  return w.until((x) => x.precis, "mode précis ouvert");
}

async function setField(w, edge, text) {
  await precis(w);
  await w.s.click(w.c.handle, `.ce-f-${edge} input`);
  await w.page.keyboard.press("Control+A");
  await w.page.keyboard.press("Backspace");
  if (text) await w.page.keyboard.type(text);
  await w.page.keyboard.press("Enter");
}

const videoTime = (page) => page.evaluate(() => document.querySelector("video").currentTime);

/** Capture du menu (popover) seul, avec une marge ; le chemin est noté pour le livrable. */
async function shootMenu(w, name, st) {
  const r = st.popRect;
  const file = join(OUT, `${name}.png`);
  await w.page.waitForTimeout(350);
  await w.page.screenshot({ path: file, clip: { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: Math.min(1280, r.width + 24), height: Math.min(900, r.height + 24) } });
  shots.push(file);
  return file;
}

describe("menu de la page : réglette, champs, clavier, loupe, lecteur", () => {
  test("ouverture : passage initial (30 s depuis l'instant de lecture), champs HH:MM:SS.mmm, limites du serveur et quota, ARIA", { timeout: 60_000 }, async () => {
    const w = await openWatch({ durationS: 600, at: 12.5 });
    const st = await openClip(w);
    assert.equal(st.start, "00:00:12.500");
    assert.equal(st.end, "00:00:42.500");
    assert.equal(st.len, "0:30");
    assert.equal(st.hs.role, "slider");
    assert.equal(st.hs.label, "Début de l’extrait");
    assert.equal(st.he.label, "Fin de l’extrait");
    assert.deepEqual([st.hs.now, st.he.now], [12.5, 42.5]);
    assert.equal(st.hs.text, `12,5${NB}secondes`, "3.8.0 : valeur parlée");
    assert.equal(st.he.max, 600);
    assert.equal(st.limits, "serveur", "limites lues sur GET /limites");
    assert.equal(st.quota, null, "3.8.0 : quota affiché seulement à 3 exports restants ou moins");
    assert.equal(st.scaleEnd, "10:00");
    assert.equal(st.fmt, "MP4");
    assert.equal(st.go.disabled, false);
    assert.equal(st.go.label, "Exporter 0:30 en MP4");
    assert.equal(st.keysShown, false, "3.8.0 : aide du clavier seulement dans le mode précis");
    assert.ok(st.popWidth <= 352 && st.overflowX <= 0, `aucun débordement horizontal (${st.popWidth} px, ${st.overflowX})`);
    assert.ok(fake.state.limitsRequests >= 1, "GET /limites demandé");
    await shootMenu(w, "menu-extrait-clair", st);
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  test("poignées au pointeur : glisser la fin, timecode affiché pendant le déplacement, champs synchronisés ; glisser le passage entier", { timeout: 60_000 }, async () => {
    const w = await openWatch({ durationS: 600, at: 12.5 });
    let st = await openClip(w);
    const p = await w.s.centerOf(w.c.handle, ".tl-h-end");
    await w.page.mouse.move(p.x, p.y);
    await w.page.mouse.down();
    await w.page.mouse.move(p.x + 30, p.y, { steps: 6 });
    await w.page.waitForTimeout(250);
    st = await w.read();
    assert.equal(st.dragging, "end", "glisser en cours");
    assert.equal(st.lens.on, true, "3.8.0 : la lentille donne l'instant exact pendant le déplacement");
    assert.equal(st.lens.val, tc(Math.round(st.he.now * 1000)).replace(/^00:/, "").replace(/^0(\d:)/, "$1"), "lentille = valeur de la poignée");
    await shootMenu(w, "menu-glisser-fin", st);
    await w.page.mouse.up();
    st = await w.until((x) => !x.dragging, "glisser terminé");
    assert.ok(st.he.now > 42.5 + 10, `fin déplacée vers la droite (${st.he.now})`);
    assert.equal(st.end, tc(Math.round(st.he.now * 1000)), "champ Fin = poignée");
    assert.equal(st.start, "00:00:12.500", "le début n'a pas bougé");
    await waitFor(async () => Math.abs((await videoTime(w.page)) - st.he.now) < 0.05, { message: "le lecteur montre l'image de la fin" });
    // Passage entier : glissé de 20 px, sa durée ne change pas.
    const before = st;
    const band = await w.s.centerOf(w.c.handle, ".tl-sel");
    await w.page.mouse.move(band.x, band.y);
    await w.page.mouse.down();
    await w.page.mouse.move(band.x + 20, band.y, { steps: 4 });
    await w.page.mouse.up();
    st = await w.until((x) => x.hs.now !== before.hs.now, "passage glissé");
    assert.ok(st.hs.now > before.hs.now);
    assert.equal(Math.round((st.he.now - st.hs.now) * 1000), Math.round((before.he.now - before.hs.now) * 1000), "durée du passage gardée");
    assert.equal(st.start, tc(Math.round(st.hs.now * 1000)));
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  test("champs : saisies partielles normalisées, sélection d'une partie retapée, erreurs, négatif, au-delà de la durée, début > fin", { timeout: 60_000 }, async () => {
    const w = await openWatch({ durationS: 600, at: 0 });
    await openClip(w);
    await setField(w, "start", "1:20");
    let st = await w.until((x) => x.start === "00:01:20.000", "1:20 → 00:01:20.000");
    assert.equal(st.hs.now, 80, "réglette synchronisée");
    assert.equal(st.end, "00:01:50.000", "la fin suit (le début dépassait la fin) en gardant 30 s");
    assert.match(st.msg, /la fin suit/);
    assert.equal(st.precis, true, "champs dans le mode précis");
    await waitFor(async () => Math.abs((await videoTime(w.page)) - 80) < 0.05, { message: "lecteur à 80 s" });
    // Sélection d'une partie (les millisecondes) retapée.
    await w.s.click(w.c.handle, ".ce-f-start input");
    await w.page.keyboard.press("End");
    for (let i = 0; i < 3; i++) await w.page.keyboard.press("Shift+ArrowLeft");
    await w.page.keyboard.type("500");
    await w.page.keyboard.press("Enter");
    st = await w.until((x) => x.start === "00:01:20.500", "millisecondes retapées");
    assert.equal(st.hs.now, 80.5);
    // Secondes seules et virgule décimale.
    await setField(w, "end", "95,25");
    st = await w.until((x) => x.end === "00:01:35.250", "95,25 → 00:01:35.250");
    // Saisie illisible : signalée, export bloqué, Échap rend la valeur.
    await setField(w, "end", "1:75");
    st = await w.until((x) => x.endInvalid, "saisie refusée");
    assert.equal(st.msgTone, "bad");
    assert.match(st.msg, /Minutes et secondes vont de 00 à 59/);
    assert.equal(st.go.disabled, true);
    assert.match(st.go.why, /Corrige le début ou la fin/);
    await w.page.keyboard.press("Escape");
    st = await w.until((x) => !x.endInvalid && x.end === "00:01:35.250", "Échap : valeur rendue");
    assert.equal(st.open, true, "Échap dans un champ ne ferme pas le menu");
    // Champ vide puis Entrée : message, pas de valeur inventée.
    await setField(w, "start", "");
    st = await w.until((x) => x.startInvalid, "champ vide signalé");
    assert.match(st.msg, /Saisis un instant/);
    await w.page.keyboard.press("Escape");
    // Négatif : ramené à 0 (dit poliment).
    await setField(w, "start", "-5");
    st = await w.until((x) => x.start === "00:00:00.000", "négatif → 0");
    assert.match(st.msg, /ne peut pas être négatif/);
    // Au-delà de la durée : fin ramenée à 10:00.
    await setField(w, "end", "12:00");
    st = await w.until((x) => x.end === "00:10:00.000", "fin ramenée à la durée");
    assert.match(st.msg, /Fin ramenée à la durée de la vidéo \(00:10:00\.000\)/);
    assert.equal(st.start, "00:00:00.000", "dépassement de 10 min (limite du serveur) : le début suit");
    assert.equal(st.len, "10:00 · maximum");
    // Heures complètes « 0:05:00.5 ».
    await setField(w, "start", "0:05:00.5");
    st = await w.until((x) => x.start === "00:05:00.500", "h:min:s.d");
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  test("clavier : flèches 100 ms, Maj 1 s, Alt 10 ms, Page 10 s, Début/Fin, Tab entre les poignées, valeurs ARIA", { timeout: 60_000 }, async () => {
    const w = await openWatch({ durationS: 600, at: 12.5 });
    await openClip(w);
    await w.s.click(w.c.handle, ".tl-h-start");
    let st = await w.until((x) => x.focus === "handle:start", "poignée de début au focus");
    const press = async (k, want, msg) => {
      await w.page.keyboard.press(k);
      return w.until((x) => Math.round(x.hs.now * 1000) === want, msg);
    };
    st = await press("ArrowRight", 12_600, "→ : +100 ms");
    st = await w.until((x) => x.lens.on && x.lens.val === "0:12.600", "3.8.0 : lentille au premier réglage clavier");
    st = await press("Shift+ArrowRight", 13_600, "Maj+→ : +1 s");
    st = await press("Alt+ArrowRight", 13_610, "Alt+→ : +10 ms");
    assert.equal(st.start, "00:00:13.610");
    st = await press("ArrowLeft", 13_510, "← : −100 ms");
    st = await press("PageUp", 23_510, "Page haut : +10 s");
    st = await press("Home", 0, "Début : 0");
    st = await press("End", 42_400, "Fin : jusqu'à la fin − 0,1 s");
    st = await press("Alt+ArrowLeft", 42_390, "Alt+← : −10 ms (et la page ne recule pas)");
    assert.equal(w.page.url(), YT_URL, "Alt+← n'a pas fait reculer la page");
    await w.page.keyboard.press("ArrowRight");
    await w.until((x) => Math.round(x.hs.now * 1000) === 42_400, "→ bloqué à la fin − 0,1 s (les poignées ne se croisent pas)");
    await w.page.keyboard.press("ArrowRight");
    st = await w.until((x) => Math.round(x.hs.now * 1000) === 42_400, "toujours bloqué");
    st = await press("Home", 0, "Début : 0");
    await w.page.keyboard.press("Tab");
    st = await w.until((x) => x.focus === "handle:end", "Tab : poignée de fin");
    await w.page.keyboard.press("Shift+ArrowLeft");
    st = await w.until((x) => Math.round(x.he.now * 1000) === 41_500, "fin −1 s");
    assert.equal(st.end, "00:00:41.500");
    assert.equal(st.lens.edge, "Fin", "la lentille montre la borne réglée au clavier");
    assert.equal(st.hs.max, 41.4, "aria-valuemax du début : fin − 0,1 s");
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  // 3.8.0 : l'essai « loupe » (zoom, Ctrl + molette, borne choisie) est remplacé par les essais T1 à T15 de TimeLens
  // (tests/browser/timelens.test.mjs, D-SPEC §A.14).

  test("lecteur : instant courant affiché et suivi, appui sur la piste = aller à, « = lecteur », lecture du passage arrêtée à la fin", { timeout: 60_000 }, async () => {
    const w = await openWatch({ durationS: 600, at: 3 });
    let st = await openClip(w);
    assert.equal(st.now, "Lecteur 0:03");
    assert.equal(st.playhead, true);
    await w.page.evaluate(() => { document.querySelector("video").currentTime = 7.25; });
    st = await w.until((x) => x.now === "Lecteur 0:07.2" || x.now === "Lecteur 0:07.3", "instant suivi en direct");
    // Appui sur la piste (hors poignées) : le lecteur y va.
    const track = await w.s.centerOf(w.c.handle, ".tl-track");
    await w.page.mouse.click(track.x + 120, track.y);
    await waitFor(async () => (await videoTime(w.page)) > 300, { message: "le lecteur est allé à l'instant cliqué" });
    // « Début = position du lecteur », « Fin = position du lecteur ».
    await w.page.evaluate(() => { document.querySelector("video").currentTime = 2; });
    await w.page.waitForTimeout(200);
    await w.s.click(w.c.handle, ".ce-mark-start");
    st = await w.until((x) => x.start === "00:00:02.000", "début = lecteur");
    await w.page.evaluate(() => { document.querySelector("video").currentTime = 4.5; });
    await w.page.waitForTimeout(200);
    await w.s.click(w.c.handle, ".ce-mark-end");
    st = await w.until((x) => x.end === "00:00:04.500", "fin = lecteur");
    // Lecture du passage : part du début, s'arrête d'elle-même à la fin.
    await w.s.click(w.c.handle, ".ce-play");
    await w.until((x) => x.playing, "lecture du passage");
    await w.until((x) => !x.playing, "arrêt à la fin", 8_000);
    const t = await w.page.evaluate(() => ({ t: document.querySelector("video").currentTime, paused: document.querySelector("video").paused }));
    assert.ok(t.paused && t.t >= 4.3 && t.t <= 4.8, `arrêt à la fin du passage (${JSON.stringify(t)})`);
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });
});

describe("export : contrat du serveur, étapes réelles, annulation, erreurs", () => {
  /** Exporte le passage courant au format donné ; renvoie le corps reçu par le serveur. */
  async function exportAs(w, format) {
    const n = fake.state.creates.length;
    if (format !== "MP4") await w.s.click(w.c.handle, ".ce-fmt .ce-opt", format);
    await w.until((x) => x.fmt === format, `format ${format}`);
    await w.s.click(w.c.handle, ".ce-go");
    await waitFor(() => fake.state.creates.length > n, { message: "POST /jobs reçu" });
    return fake.state.creates.at(-1);
  }

  test("MP4 (progression mesurée) : startMs/endMs exacts, étapes réelles avec pourcentage, anneau, fichier enregistré, « Afficher »", { timeout: 90_000 }, async () => {
    fake.state.clipScenario = "measured";
    const w = await openWatch({ durationS: 32_400, at: 0 });
    await openClip(w);
    await setField(w, "start", "02:13:07.800");
    await setField(w, "end", "02:14:23.700");
    await w.until((x) => x.end === "02:14:23.700", "passage réglé");
    // Hauteur du pied de l'éditeur mesurée à chaque image : l'avancement apparaît sans saut brutal.
    await w.s.callOn({ backendNodeId: w.c.handle.shadowBackend }, function () {
      const foot = this.querySelector(".ce-foot");
      globalThis.__heights = [];
      const t0 = performance.now();
      const tick = () => { globalThis.__heights.push(foot.getBoundingClientRect().height); if (performance.now() - t0 < 900) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const body = await exportAs(w, "MP4");
    assert.equal(body.startMs, 7_987_800);
    assert.equal(body.endMs, 8_063_700);
    assert.equal(body.fmt, "mp4");
    assert.equal("start_s" in body || "end_s" in body, false, "plus de secondes flottantes");
    let st = await w.until((x) => x.xp && (x.xp.phase === "queued" || x.xp.phase === "converting"), "export lancé");
    assert.equal(st.xp.mood === "launch" || st.xp.mood === "busy", true, "la chouette réagit au lancement");
    assert.equal(st.xp.ring, "xp-turn", "anneau champagne indéterminé pendant le travail");
    assert.equal(st.statusHidden, true, "l'état général du menu laisse place à l'avancement de l'extrait");
    assert.equal(st.go.shown, false, "bouton d'export remplacé par l'avancement");
    const heights = await w.s.callOn({ backendNodeId: w.c.handle.shadowBackend }, function () { return globalThis.__heights; });
    const jumps = heights.slice(1).map((h, i) => Math.abs(h - heights[i]));
    assert.ok(Math.max(...jumps) < 60, `hauteur animée, sans saut (${Math.round(Math.max(...jumps))} px au plus d'une image à l'autre)`);
    st = await w.until((x) => x.xp && x.xp.title === "Récupération de l’extrait" && /^\d+ %$/.test(x.xp.pct), "récupération avec pourcentage mesuré", 15_000);
    assert.equal(st.xp.bar.indeterminate, false);
    assert.ok(Number(st.xp.bar.now) > 0);
    assert.deepEqual(st.xp.steps.slice(0, 2), ["done", "current"]);
    assert.match(st.xp.detail, /Seuls les segments du passage sont récupérés/);
    assert.equal(st.xp.cancel, true);
    await shootMenu(w, "menu-export-recuperation", st);
    st = await w.until((x) => x.xp?.phase === "done", "fichier enregistré", 30_000);
    assert.equal(st.xp.title, "Terminé");
    assert.deepEqual(st.xp.steps, ["done", "done", "done", "done", "done"]);
    assert.equal(st.xp.show, true, "« Afficher » le fichier");
    assert.equal(st.xp.mood, "done", "retour au repos");
    assert.equal(st.go.shown, true, "nouvel export possible");
    await shootMenu(w, "menu-export-termine", st);
    const files = readdirSync(dl).filter((f) => f.startsWith("Extrait de test") && f.endsWith(".mp4"));
    assert.ok(files.length >= 1 && statSync(join(dl, files[0])).size === fake.fileSize, `fichier MP4 sur le disque (${files.join(", ")})`);
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  test("MP3 (sans progression mesurable) : animation indéterminée et phrase descriptive, jamais de pourcentage inventé", { timeout: 90_000 }, async () => {
    fake.state.clipScenario = "unmeasured";
    const w = await openWatch({ durationS: 10_800, at: 3_600 });
    let st = await openClip(w);
    assert.equal(st.scaleEnd, "3:00:00");
    assert.equal(st.start, "01:00:00.000");
    const body = await exportAs(w, "MP3");
    assert.deepEqual([body.fmt, body.startMs, body.endMs, body.bitrate], ["mp3", 3_600_000, 3_630_000, 192]);
    const seen = new Set();
    st = await waitFor(async () => {
      const x = await w.read();
      if (x?.xp) {
        seen.add(x.xp.title);
        assert.doesNotMatch(x.xp.title + x.xp.pct, /%/, "aucun pourcentage sans mesure");
        if (x.xp.phase !== "done" && x.xp.phase !== "sending") assert.equal(x.xp.bar.indeterminate, true, "barre indéterminée");
      }
      return x?.xp?.phase === "done" ? x : null;
    }, { timeout: 30_000, interval: 100, message: "MP3 enregistré" });
    for (const t of ["Analyse de la source", "Récupération de l’extrait", "Conversion"]) assert.ok(seen.has(t), `étape vue : ${t} (${[...seen].join(" | ")})`);
    assert.ok(readdirSync(dl).some((f) => f.endsWith(".mp3")), "fichier MP3 sur le disque");
    await w.page.close();
  });

  test("GIF : demandé au serveur (fmt « gif »), fichier GIF enregistré", { timeout: 90_000 }, async () => {
    fake.state.clipScenario = "unmeasured";
    const w = await openWatch({ durationS: 600, at: 0 });
    await openClip(w);
    await setField(w, "start", "4");
    await setField(w, "end", "9.5");
    await w.until((x) => x.end === "00:00:09.500", "passage de 5,5 s");
    const body = await exportAs(w, "GIF");
    assert.deepEqual([body.fmt, body.startMs, body.endMs, body.quality], ["gif", 4_000, 9_500, undefined]);
    const st = await w.until((x) => x.xp?.phase === "done", "GIF enregistré", 30_000);
    assert.equal(st.go.label, "Exporter 0:05.5 en GIF");
    assert.ok(readdirSync(dl).some((f) => f.endsWith(".gif")), "fichier GIF sur le disque");
    await w.page.close();
  });

  test("annulation : « Annuler » pendant la récupération → DELETE /jobs/{id}, « Export annulé », nouvel export possible", { timeout: 60_000 }, async () => {
    fake.state.clipScenario = "slow";
    const w = await openWatch({ durationS: 600, at: 0 });
    await openClip(w);
    const d = fake.state.deletes.length;
    await exportAs(w, "MP4");
    let st = await w.until((x) => x.xp?.title === "Récupération de l’extrait" && x.xp.cancel, "récupération en cours", 15_000);
    await w.s.click(w.c.handle, ".xp-cancel");
    st = await w.until((x) => x.xp?.phase === "cancelled", "export annulé");
    assert.equal(st.xp.title, "Export annulé");
    assert.equal(st.xp.ringOpacity < 1, true, "anneau qui s'efface");
    assert.equal(fake.state.deletes.length, d + 1, "DELETE /jobs/{id} envoyé");
    assert.equal(st.go.shown && !st.go.disabled, true);
    await w.page.close();
  });

  test("erreurs : extraction partielle impossible (message dédié), réseau coupé, quota, refus du serveur (422)", { timeout: 90_000 }, async () => {
    const w = await openWatch({ durationS: 600, at: 0, dark: true });
    await openClip(w);
    fake.state.clipScenario = "partial";
    await exportAs(w, "MP4");
    let st = await w.until((x) => x.xp?.phase === "error", "extraction partielle impossible", 15_000);
    assert.equal(st.xp.title, "Extraction partielle impossible");
    assert.match(st.xp.detail, /^Cette vidéo ne permet pas de récupérer seulement le passage choisi/);
    assert.match(st.xp.detail, /Rien n'a été téléchargé/);
    assert.equal(st.xp.role, "alert");
    assert.equal(st.xp.retry, false, "rien à relancer tel quel");
    assert.deepEqual(st.xp.steps.slice(0, 1), ["failed"]);
    await shootMenu(w, "menu-erreur-partiel-sombre", st);
    // Réseau coupé à la création.
    fake.state.clipScenario = "network";
    await w.page.waitForTimeout(350); // fin de l'animation de hauteur (220 ms) : le bouton ne bouge plus
    await w.s.click(w.c.handle, ".ce-go");
    st = await w.until((x) => x.xp?.phase === "error" && x.xp.title === "Serveur injoignable", "réseau coupé", 30_000);
    assert.match(st.xp.detail, /Impossible de joindre le serveur AETHRYON/);
    assert.equal(st.xp.retry, true);
    // Quota du jour.
    fake.state.clipScenario = "quota";
    await w.page.waitForTimeout(350); // fin de l'animation de hauteur (220 ms) : le bouton ne bouge plus
    await w.s.click(w.c.handle, ".ce-go");
    st = await w.until((x) => x.xp?.title === "Quota du jour atteint", "quota", 15_000);
    assert.match(st.xp.detail, /limite de conversions pour aujourd/);
    // Refus du serveur (validation indépendante).
    fake.state.clipScenario = "invalid";
    await w.page.waitForTimeout(350); // fin de l'animation de hauteur (220 ms) : le bouton ne bouge plus
    await w.s.click(w.c.handle, ".ce-go");
    st = await w.until((x) => x.xp?.title === "Export impossible", "refus du serveur", 15_000);
    assert.match(st.xp.detail, /durée maximale autorisée/);
    fake.state.clipScenario = "measured";
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  test("limite du serveur appliquée côté client : au-delà de 10 min, l'autre borne suit (dit), jamais d'envoi hors limite", { timeout: 60_000 }, async () => {
    const w = await openWatch({ durationS: 32_400, at: 0 });
    await openClip(w);
    await setField(w, "start", "0");
    await setField(w, "end", "20:00");
    const st = await w.until((x) => x.end === "00:20:00.000", "fin à 20 min");
    assert.equal(st.start, "00:10:00.000", "le début suit : 10 min au plus");
    assert.match(st.msg, /Passage ramené à 10 min, la durée maximale autorisée par le serveur/);
    assert.equal(st.go.disabled, false);
    await w.page.close();
  });

  test("mouvement réduit : aucun mouvement (anneau fixe, barre immobile), états toujours écrits", { timeout: 60_000 }, async () => {
    fake.state.clipScenario = "slow";
    const w = await openWatch({ durationS: 600, at: 0 });
    await w.page.emulateMedia({ reducedMotion: "reduce" });
    await openClip(w);
    await exportAs(w, "MP4");
    const st = await w.until((x) => x.xp?.title === "Récupération de l’extrait", "récupération", 15_000);
    assert.equal(st.xp.ring, "none", "anneau sans rotation");
    assert.equal(st.xp.bar.indeterminate, true);
    await w.s.click(w.c.handle, ".xp-cancel");
    await w.until((x) => x.xp?.phase === "cancelled", "annulé");
    fake.state.clipScenario = "measured";
    await w.page.close();
  });
});

describe("popup : même éditeur, lecteur de l'onglet piloté par le service worker", () => {
  test("popup 380 px : instant du lecteur, champs, export, avancement ; aucun débordement ; clair et sombre", { timeout: 90_000 }, async () => {
    fake.state.clipScenario = "measured";
    const w = await openWatch({ durationS: 600, at: 12.5 });
    // L'onglet YouTube est « l'onglet actif » vu par le service worker (le popup ouvert dans un onglet de test le serait sinon).
    const sw = await b.worker();
    await sw.evaluate(async () => {
      const all = await chrome.tabs.query({});
      let target = null;
      for (const t of all) {
        try {
          const r = await chrome.tabs.sendMessage(t.id, { type: "detect.request" });
          if (r?.media) target = t.id;
        } catch { /* pas de content script */ }
      }
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (info) => (info && info.active ? Promise.resolve([{ id: target, active: true }]) : orig(info));
      globalThis.__target = target;
    });
    const page = await b.context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`);
    await page.locator(".seg-opt", { hasText: "Extrait" }).click();
    await page.waitForSelector(".ce .tl-h-start");
    await page.waitForFunction(() => /^Lecteur 0:12\.5$/.test(document.querySelector(".ce-now")?.textContent ?? ""), null, { timeout: 5_000 });
    assert.equal(await page.inputValue(".ce-f-start input"), "00:00:12.500");
    await page.waitForFunction(() => document.querySelector(".ce")?.getAttribute("data-limits") === "serveur", null, { timeout: 5_000 });
    await page.click(".ce-fine"); // 3.8.0 : champs dans le mode précis
    await page.waitForTimeout(300);
    // Le lecteur de l'onglet suit le popup (aller à) et inversement.
    await page.fill(".ce-f-start input", "0:05");
    await page.press(".ce-f-start input", "Enter");
    await waitFor(async () => Math.abs((await videoTime(w.page)) - 5) < 0.05, { message: "onglet : lecteur à 5 s depuis le popup" });
    await w.page.evaluate(() => { document.querySelector("video").currentTime = 9; });
    await page.waitForFunction(() => document.querySelector(".ce-now")?.textContent === "Lecteur 0:09", null, { timeout: 5_000 }); // 3.8.0 : dixièmes seulement s'ils ne sont pas nuls
    await page.click(".ce-mark-end");
    await page.waitForFunction(() => document.querySelector(".ce-f-end input")?.value === "00:00:09.000", null, { timeout: 5_000 });
    const layout = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, width: document.body.getBoundingClientRect().width }));
    assert.deepEqual(layout, { overflowX: 0, width: 380 });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.locator(".ce").scrollIntoViewIfNeeded();
      const file = join(OUT, `popup-extrait-${scheme === "light" ? "clair" : "sombre"}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    }
    await page.emulateMedia({ colorScheme: "light" });
    const n = fake.state.creates.length;
    await page.click(".ce-go");
    await waitFor(() => fake.state.creates.length > n, { message: "POST /jobs depuis le popup" });
    assert.deepEqual([fake.state.creates.at(-1).startMs, fake.state.creates.at(-1).endMs], [5_000, 9_000]);
    await page.waitForFunction(() => /Récupération de l'extrait/.test(document.querySelector(".xp-title")?.textContent ?? ""), null, { timeout: 15_000 });
    await page.locator(".xp").scrollIntoViewIfNeeded();
    const file = join(OUT, "popup-export-en-cours.png");
    await page.screenshot({ path: file });
    shots.push(file);
    await page.waitForFunction(() => document.querySelector(".xp")?.getAttribute("data-phase") === "done", null, { timeout: 30_000 });
    assert.equal(await page.textContent(".xp-title"), "Terminé");
    const typo = await page.evaluate(() => [...document.querySelectorAll(".ce, .xp")].map((e) => e.textContent).join(" "));
    assert.doesNotMatch(typo, /’/, "apostrophe droite dans le popup, comme le site");
    assert.deepEqual(errors, []);
    await page.close();
    await w.page.close();
  });
});

test("captures écrites", () => {
  for (const f of shots) assert.ok(existsSync(f), f);
});
