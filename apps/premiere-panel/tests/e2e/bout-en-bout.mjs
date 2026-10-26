// ESSAI DE BOUT EN BOUT dans Chromium (Playwright) : la VRAIE interface (construction « banc ») pilotée comme un
// utilisateur, avec le VRAI code Node de la coque CEP (src/noeud/services.ts : réseau, téléchargement en flux,
// fichiers, clé) exécuté dans Node et relié à la page par une fonction exposée. Seul Premiere est simulé.
//   A. contre le FAUX serveur (tests/faux-serveur.mjs) : connexion par page d'accord, aperçu, conversion,
//      téléchargement, import, bibliothèque, glisser (formats posés), insertion, déconnexion (révocation) ;
//   B. contre la PRÉPRODUCTION (127.0.0.1:18110 site/compte, 127.0.0.1:18111 ytapi au faux worker) avec un compte
//      d'essai @preprod.test et une clé créée pour l'occasion puis révoquée — JAMAIS la production ;
//   C. contre une PILE JETABLE de la branche (variable PILE) : VRAI account (migration 012, PREMIERE_CONNEXION=1)
//      derrière le vrai site (nginx), VRAI ytapi au faux worker. Parcours complet du panneau : appairage, accord sur la
//      vraie page /premiere/connecter (utilisateur d'essai connecté), clé reçue, aperçu, conversion transcode, fichier
//      H.264/AAC, import simulé, déconnexion puis clé refusée par ytapi ; aucun secret dans les journaux (panneau et
//      conteneurs). JAMAIS la production.
// La clé n'est jamais affichée ; l'essai vérifie qu'elle n'apparaît dans aucun journal.
// Usage : node tests/e2e/bout-en-bout.mjs [--sans-preprod]
//         PILE=ytc2-v2i PILE_SITE=http://127.0.0.1:18230 PILE_API=http://127.0.0.1:18231 node tests/e2e/bout-en-bout.mjs --sans-preprod

import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { servir } from "./serveur-statique.mjs";
import { CLE_ESSAI, demarrerFauxServeur } from "../faux-serveur.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, "..", "..");
const rendus = join(ici, "rendus");
mkdirSync(rendus, { recursive: true });
const avecPreprod = !process.argv.includes("--sans-preprod");
const LIEN = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

// ---- Construction : interface « banc » + services Node regroupés en module ESM ---------------------------------------
execFileSync(join(racine, "node_modules", ".bin", "vite"), ["build", "--mode", "banc", "--logLevel", "warn"], { cwd: racine, stdio: "inherit" });
const esbuild = require(join(racine, "node_modules", "esbuild"));
const travail = mkdtempSync(join(tmpdir(), "aethryon-banc-"));
await esbuild.build({ entryPoints: [join(racine, "src", "noeud", "services.ts")], bundle: true, platform: "node", format: "esm", outfile: join(travail, "services.mjs"), logLevel: "warning" });
const { creerServicesNoeud } = await import(pathToFileURL(join(travail, "services.mjs")).href);

const statique = await servir([["/", join(racine, "dist", "banc")]]);
const urlPage = `http://127.0.0.1:${statique.address().port}/index.html`;
const navigateur = await chromium.launch();
const resultats = [];
let echecs = 0;
const verifier = (nom, ok, detail = "") => {
  resultats.push({ nom, ok, detail });
  if (!ok) echecs++;
  console.log(`${ok ? "ok    " : "ÉCHEC "} ${nom}${detail ? " · " + detail : ""}`);
};

/** Ouvre la page avec un banc neuf (dossiers temporaires) ; renvoie de quoi la piloter et l'inspecter. */
async function ouvrirBanc(nom, config, preparer, espion) {
  const base = mkdtempSync(join(tmpdir(), `aethryon-${nom}-`));
  const medias = join(base, "Downloads", "AETHRYON");
  const donnees = join(base, "AppData", "Roaming", "AETHRYON", "premiere");
  const echanges = join(base, "AppData", "Local", "AETHRYON");
  mkdirSync(medias, { recursive: true });
  const journalServices = [];
  const journalPanneau = [];
  const urlsOuvertes = [];
  const s = creerServicesNoeud(require, { dossierDonnees: donnees, dossiersInternes: () => [donnees, join(echanges, "premiere")], httpLocalAdmis: true, journal: (n, m) => journalServices.push(`[${n}] ${m}`) });
  if (preparer) await preparer(s);
  const contexte = await navigateur.newContext({ viewport: { width: 480, height: 820 } });
  const page = await contexte.newPage();
  const consoles = [];
  page.on("console", (m) => consoles.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => consoles.push("pageerror: " + e.message));
  await page.addInitScript((c) => { window.__AETHRYON_BANC_CONFIG__ = c; }, config);
  const table = {
    environnement: async () => ({ hote: "banc", premiereVersion: "26.5.2 (simulé)", cepVersion: null, nodeVersion: process.versions.node, chromiumVersion: null, os: "Linux (banc)", nomMachine: "BANC-E2E", dossierMediasParDefaut: medias, dossierDonnees: donnees, racineEchanges: echanges, extensionVersion: "2.0.0", dossierExtension: null, posix: true }),
    signature: async () => ({ etat: "inconnu", modeDebogage: null, detail: "Banc d’essai : pas de paquet signé." }),
    http: async (r) => {
      const rep = await s.http(r);
      if (espion) espion(r, rep);
      return rep;
    },
    telecharger: (r, id) => s.telecharger(r, (recus, total) => void page.evaluate(([i, a, b]) => window.__bancSuivi && window.__bancSuivi(i, a, b), [id, recus, total]).catch(() => {})),
    ouvrirUrl: async (u) => void urlsOuvertes.push(u),
    journal: async (n, m) => void journalPanneau.push(`[${n}] ${m}`),
  };
  for (const [k, f] of Object.entries(s.fichiers)) if (typeof f === "function") table["fichiers." + k] = f;
  for (const [k, f] of Object.entries(s.coffre)) table["coffre." + k] = f;
  await page.exposeFunction("__banc", async (nom, args) => {
    try {
      const f = table[nom];
      if (!f) throw new Error("fonction de banc inconnue : " + nom);
      const valeur = await f(...JSON.parse(args));
      return JSON.stringify({ valeur: valeur === undefined ? null : valeur });
    } catch (e) {
      return JSON.stringify({ erreur: { message: String(e && e.message || e), statut: e && e.statut, code: e && e.code } });
    }
  });
  // Les fichiers locaux sont servis au <video>/<img> à partir du VRAI disque, seulement dans les dossiers du banc.
  await page.route("**/banc-fichier?**", async (route) => {
    const c = new URL(route.request().url()).searchParams.get("c") || "";
    if (!resolve(c).startsWith(base) || !existsSync(c)) return route.fulfill({ status: 404, body: "" });
    const type = /\.mp4$/i.test(c) ? "video/mp4" : /\.mp3$/i.test(c) ? "audio/mpeg" : /\.jpe?g$/i.test(c) ? "image/jpeg" : "application/octet-stream";
    return route.fulfill({ status: 200, body: readFileSync(c), headers: { "content-type": type } });
  });
  await page.goto(urlPage);
  await page.waitForSelector(".app:not(.app--chargement)");
  return { page, contexte, base, medias, donnees, echanges, journalServices, journalPanneau, urlsOuvertes, consoles, s };
}

function fuite(b, cle) {
  const tout = [...b.journalServices, ...b.journalPanneau, ...b.consoles].join("\n");
  const fichiersJournal = existsSync(join(b.echanges, "journaux")) ? readdirSync(join(b.echanges, "journaux")).map((f) => readFileSync(join(b.echanges, "journaux", f), "utf8")).join("\n") : "";
  return (tout + fichiersJournal).includes(cle);
}

// ---- A. Faux serveur ------------------------------------------------------------------------------------------------
{
  console.log("\nA. Faux serveur AETHRYON (127.0.0.1)");
  const fs = await demarrerFauxServeur({ attentesAvantAccord: 2, intervalle: 1, tailleFichier: 2 * 1024 * 1024 + 77, lent: true });
  const b = await ouvrirBanc("faux", fs.config);
  const p = b.page;
  try {
    verifier("démarre déconnecté", (await p.textContent(".connexion")).includes("Se connecter"));
    await p.click(".connexion");
    await p.click(".compte .btn--principal");
    await p.waitForSelector(".code-appairage", { timeout: 8000 });
    const code = (await p.textContent(".code-appairage")).trim();
    verifier("page d'accord ouverte dans le navigateur avec le code", b.urlsOuvertes[0] === `${fs.base}/premiere/connecter?code=${encodeURIComponent(code)}`, b.urlsOuvertes[0]);
    await p.screenshot({ path: join(rendus, "bout-en-bout-A1-code.png") });
    await p.waitForSelector(".compte__nom", { timeout: 15000 });
    await p.waitForSelector(".conversions", { timeout: 8000 });
    verifier("connecté après accord ; quota et dernières conversions lus", (await p.textContent(".chiffre")).trim() === "8");
    const fichierCle = join(b.donnees, "cle.json");
    verifier("clé enregistrée dans le profil (repli fichier 0600 hors Windows)", existsSync(fichierCle) && (statSync(fichierCle).mode & 0o777) === 0o600);
    await p.screenshot({ path: join(rendus, "bout-en-bout-A2-compte.png") });

    await p.click(".onglet >> text=Accueil");
    await p.fill('input[aria-label="Lien de la vidéo"]', LIEN);
    await p.waitForSelector(".apercu-lien:not(.est-chargement)", { timeout: 10000 });
    verifier("plateforme reconnue et aperçu du serveur", (await p.textContent(".lien__etat")).includes("YouTube") && (await p.textContent(".apercu-lien__titre")).includes("Essai"));
    await p.waitForSelector(".apercu-lien__image img", { timeout: 5000 });
    verifier("miniature servie par le serveur (data:)", (await p.getAttribute(".apercu-lien__image img", "src")).startsWith("data:image/jpeg;base64,"));
    await p.click(".options .btn--principal");
    await p.waitForSelector(".etape.est-en-cours", { timeout: 5000 });
    let vuTelechargement = false;
    for (let i = 0; i < 100 && !(await p.$(".tache--termine")) && !(await p.$(".tache--erreur")); i++) {
      if (await p.$(".etape.est-en-cours >> text=Téléchargement")) {
        vuTelechargement = true;
        if (!existsSync(join(b.base, "vu-part"))) {
          const partiels = readdirSync(b.medias).filter((n) => n.endsWith(".aethryon.part"));
          if (partiels.length) writeFileSync(join(b.base, "vu-part"), partiels[0]);
          await p.screenshot({ path: join(rendus, "bout-en-bout-A3-telechargement.png") });
        }
      }
      await p.waitForTimeout(100);
    }
    verifier("progression réelle : conversion puis téléchargement", vuTelechargement);
    verifier("fichier .aethryon.part pendant le téléchargement", existsSync(join(b.base, "vu-part")));
    await p.waitForSelector(".tache--termine", { timeout: 5000 });
    const fichiers = readdirSync(b.medias);
    const chemin = join(b.medias, fichiers.find((n) => n.endsWith(".mp4")) || "");
    verifier("fichier complet renommé, aucun .part restant", fichiers.length === 1 && statSync(chemin).size === 2 * 1024 * 1024 + 77, fichiers.join(", "));
    verifier("importé dans le projet (Premiere simulé)", (await p.evaluate(() => window.__bancPremiere.importes)).includes(chemin));
    verifier("toast de succès réel", (await p.textContent(".toast")).includes("Importé dans"));
    verifier("le fichier n'a pas été demandé ailleurs que sur l'API configurée", fs.journal.some((j) => j.chemin.endsWith("/file") && j.cle) && !fs.journal.some((j) => j.chemin.includes("exemple.invalid")));
    await p.screenshot({ path: join(rendus, "bout-en-bout-A4-importe.png") });
    verifier("import récent listé sous le champ", (await p.textContent(".recents")).includes("Essai"));

    await p.click(".onglet >> text=Bibliothèque");
    await p.fill('input[type="search"]', "coucher");
    await p.waitForTimeout(500);
    verifier("bibliothèque : recherche et état « Importé »", (await p.$$(".tuile")).length === 1 && (await p.textContent(".tuile")).includes("Importé"));
    const formats = await p.evaluate(() => {
      const el = document.querySelector(".tuile.est-glissable");
      const dt = new DataTransfer();
      el.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return { types: [...dt.types], chemin: dt.getData("com.adobe.cep.dnd.file.0"), uri: dt.getData("text/uri-list") };
    });
    verifier("glisser : com.adobe.cep.dnd.file.0 = chemin absolu, + text/uri-list", formats.chemin === chemin && formats.uri.startsWith("file://") && formats.types.includes("text/plain"), formats.types.join(", "));
    await p.click(".tuile");
    await p.waitForSelector(".apercu");
    await p.click("text=Insérer à la tête de lecture");
    await p.waitForSelector(".toast >> text=Inséré", { timeout: 5000 });
    verifier("insérer à la tête de lecture (clic explicite)", (await p.evaluate(() => window.__bancPremiere.sequence)).includes(chemin));
    await p.waitForTimeout(1500);
    const mini = await p.$eval(".lect video", (v) => ({ poster: v.getAttribute("poster") || "", src: v.getAttribute("src") || "" })).catch(() => null);
    verifier("aperçu : lecteur <video> sur le fichier local", !!mini && mini.src.includes("banc-fichier"));
    await p.screenshot({ path: join(rendus, "bout-en-bout-A5-apercu.png") });

    // Import automatique des fichiers envoyés par le navigateur : DÉSACTIVÉ par défaut, puis activé.
    const avant = join(b.medias, "Avant activation.mp4");
    writeFileSync(avant, Buffer.alloc(4096, 1));
    await p.waitForTimeout(6000);
    verifier("import automatique désactivé par défaut (fichier arrivé non importé)", !(await p.evaluate(() => window.__bancPremiere.importes)).includes(avant));
    await p.click('button[aria-label="Réglages"]');
    await p.click('[role="switch"][aria-label^="Importer automatiquement"]');
    await p.waitForTimeout(500);
    const envoye = join(b.medias, "Envoi du navigateur.mp4");
    writeFileSync(envoye + ".crdownload", Buffer.alloc(4096, 2));
    await p.waitForTimeout(4500);
    verifier("import automatique : un téléchargement inachevé (.crdownload) n'est jamais importé", !(await p.evaluate(() => window.__bancPremiere.importes)).some((c) => c.includes("Envoi du navigateur")));
    execFileSync("mv", [envoye + ".crdownload", envoye]);
    let auto = false;
    for (let i = 0; i < 40 && !auto; i++) {
      await p.waitForTimeout(250);
      auto = (await p.evaluate(() => window.__bancPremiere.importes)).includes(envoye);
    }
    const importesApres = await p.evaluate(() => window.__bancPremiere.importes);
    verifier("import automatique activé : le nouveau fichier est importé, l'ancien ne l'est pas", auto && !importesApres.includes(avant));
    await p.screenshot({ path: join(rendus, "bout-en-bout-A6-import-auto.png") });

    await p.click(".connexion");
    await p.click("text=Se déconnecter");
    await p.click("text=Confirmer");
    await p.waitForSelector(".compte__bloc--centre", { timeout: 5000 });
    verifier("déconnexion : clé révoquée sur le serveur et effacée du PC", fs.clesRevoquees.has(CLE_ESSAI) && !existsSync(fichierCle));
    verifier("la clé n'apparaît dans aucun journal ni dans la console", !fuite(b, CLE_ESSAI));
    verifier("aucune erreur de page", !b.consoles.some((c) => c.startsWith("pageerror") || c.startsWith("error")), b.consoles.filter((c) => c.startsWith("error") || c.startsWith("pageerror")).join(" | "));
  } catch (e) {
    verifier("scénario A sans exception", false, String(e.message || e).split("\n")[0]);
    await p.screenshot({ path: join(rendus, "bout-en-bout-A-echec.png") }).catch(() => {});
  }
  await b.contexte.close();
  await fs.fermer();
}

// ---- B. Préproduction ------------------------------------------------------------------------------------------------
async function preprodJoignable() {
  try {
    const r = await fetch("http://127.0.0.1:18111/health", { signal: AbortSignal.timeout(3000) });
    const s = await fetch("http://127.0.0.1:18110/", { signal: AbortSignal.timeout(3000) });
    return r.ok && s.ok;
  } catch {
    return false;
  }
}

if (avecPreprod && (await preprodJoignable())) {
  console.log("\nB. Préproduction (127.0.0.1:18110 / 18111, faux worker) — compte d'essai cep-e2e@preprod.test");
  // Session d'essai (outil de préproduction, refusé hors YTC_ALLOW_TEST_SESSIONS) ; rien n'est affiché.
  execFileSync("docker", ["exec", "ytc2-pp-account", "node", "dist/tools/create-test-session.js", "--email", "cep-e2e@preprod.test", "--out", "/tmp/session-cep.cookie"], { stdio: "ignore" });
  const cookie = execFileSync("docker", ["exec", "ytc2-pp-account", "cat", "/tmp/session-cep.cookie"], { encoding: "utf8" }).trim().replace(/^Cookie:\s*/i, "");
  execFileSync("docker", ["exec", "ytc2-pp-account", "rm", "-f", "/tmp/session-cep.cookie"], { stdio: "ignore" });
  const site = { cookie, origin: "http://localhost:18110", "content-type": "application/json" };
  const creation = await fetch("http://127.0.0.1:18110/api/keys", { method: "POST", headers: site, body: JSON.stringify({ name: "Essai panneau Premiere v2 (CEP)", expiresInDays: 30 }) });
  const corps = await creation.json().catch(() => ({}));
  const cle = corps.secret || corps.token || corps.key?.secret || null;
  const idCle = corps.key?.id || null;
  verifier("préproduction : clé d’essai créée (non affichée)", creation.status === 201 && typeof cle === "string", `HTTP ${creation.status}${creation.status !== 201 ? " " + (corps.error || "") + " " + (corps.message || "") : ""}`);
  if (typeof cle === "string") {
    const b = await ouvrirBanc("preprod", { compte: "http://127.0.0.1:18110", api: "http://127.0.0.1:18111" }, async (s) => {
      await s.coffre.ecrire({ cle, expireLe: null, compte: { email: "cep-e2e@preprod.test", nom: "Essai CEP" }, enregistreeLe: new Date().toISOString() });
    });
    const p = b.page;
    try {
      verifier("préproduction : panneau connecté avec la clé enregistrée", (await p.textContent(".connexion")).includes("Connecté"));
      await p.fill('input[aria-label="Lien de la vidéo"]', LIEN);
      await p.waitForSelector(".apercu-lien:not(.est-chargement), .carte--erreur", { timeout: 20000 });
      const erreurApercu = await p.$(".carte--erreur");
      verifier("préproduction : aperçu réel par /preview", !erreurApercu, erreurApercu ? await erreurApercu.textContent() : (await p.textContent(".apercu-lien__titre")).trim());
      await p.screenshot({ path: join(rendus, "bout-en-bout-B1-apercu.png") });
      if (!erreurApercu) {
        await p.click('[role="switch"]');
        await p.fill('input[aria-label^="Début"]', "0:00");
        await p.fill('input[aria-label^="Fin"]', "0:01");
        await p.click(".options .btn--principal");
        await p.waitForSelector(".tache--termine, .tache--erreur", { timeout: 90000 });
        const err = await p.$(".tache--erreur");
        verifier("préproduction : conversion (extrait 0:00–0:01, MP4 H.264) + téléchargement + import", !err, err ? (await err.textContent()).slice(0, 160) : "");
        await p.screenshot({ path: join(rendus, "bout-en-bout-B2-importe.png") });
        const mp4 = readdirSync(b.medias).filter((n) => n.endsWith(".mp4"));
        const sonde = mp4.length ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", join(b.medias, mp4[0])], { encoding: "utf8" }).trim().split("\n").join("+") : "";
        verifier("préproduction : fichier reçu, H.264 + AAC, aucun .part", mp4.length === 1 && sonde === "h264+aac" && !readdirSync(b.medias).some((n) => n.endsWith(".part")), `${mp4.join(", ")} · ${sonde}`);
        await p.click(".onglet >> text=Bibliothèque");
        await p.waitForSelector(".tuile", { timeout: 5000 });
        await p.waitForSelector(".tuile__image > img", { timeout: 12000 }).catch(() => {});
        const miniature = await p.$eval(".tuile__image > img", (i) => i.getAttribute("src") || "").catch(() => "");
        verifier("préproduction : miniature générée dans le panneau (<video> + canvas) et mise en cache", miniature.startsWith("data:image/jpeg") && existsSync(join(b.echanges, "premiere", "miniatures")), miniature.slice(0, 30));
        await p.screenshot({ path: join(rendus, "bout-en-bout-B3-bibliotheque.png") });
      }
      verifier("préproduction : la clé n'apparaît dans aucun journal ni dans la console", !fuite(b, cle));
    } catch (e) {
      verifier("scénario B sans exception", false, String(e.message || e).split("\n")[0]);
      await p.screenshot({ path: join(rendus, "bout-en-bout-B-echec.png") }).catch(() => {});
    }
    await b.contexte.close();
    rmSync(b.base, { recursive: true, force: true });
    if (idCle) {
      const r = await fetch(`http://127.0.0.1:18110/api/keys/${idCle}/revoke`, { method: "POST", headers: site, body: "{}" });
      verifier("préproduction : clé d'essai révoquée", r.ok, `HTTP ${r.status}`);
    }
  }
} else if (avecPreprod) {
  verifier("préproduction joignable (127.0.0.1:18110/18111)", false, "non joignable : scénario B non fait");
}

// ---- C. Pile jetable : vrai account + vrai site + vrai ytapi (faux worker) --------------------------------------------
const PILE = process.env.PILE || "";
if (PILE) {
  if (/^(ytc|ytc-prod)$|prod/.test(PILE)) throw new Error("PILE doit être une pile JETABLE, jamais la production");
  const SITE = (process.env.PILE_SITE || "").replace(/\/+$/, "");
  const API = (process.env.PILE_API || "").replace(/\/+$/, "");
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(SITE) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(API)) throw new Error("PILE_SITE et PILE_API : http://127.0.0.1:<port> seulement");
  console.log(`\nC. Pile jetable ${PILE} (${SITE} site + account réel, ${API} ytapi au faux worker)`);
  const secrets = [];
  const email = `cep-integration-${Date.now().toString(36)}@preprod.test`;
  execFileSync("docker", ["exec", `${PILE}-account`, "node", "dist/tools/create-test-session.js", "--email", email, "--out", "/tmp/session-cep.cookie"], { stdio: "ignore" });
  const cookieBrut = execFileSync("docker", ["exec", `${PILE}-account`, "cat", "/tmp/session-cep.cookie"], { encoding: "utf8" }).trim().replace(/^Cookie:\s*/i, "");
  execFileSync("docker", ["exec", `${PILE}-account`, "rm", "-f", "/tmp/session-cep.cookie"], { stdio: "ignore" });
  const [nomCookie, ...reste] = cookieBrut.split("=");
  secrets.push(reste.join("="));
  // Requêtes du panneau vues par l'essai (corps sans secret) ; les secrets reçus sont notés pour la fouille des journaux.
  const envois = [];
  const espion = (r, rep) => {
    const u = new URL(r.url);
    envois.push({ methode: r.methode, origine: u.origin, chemin: u.pathname, json: r.json ?? null, statut: rep.statut, entetes: Object.keys(r.entetes || {}) });
    const j = rep.json;
    if (j && typeof j === "object") for (const k of ["codeAppareil", "codeUtilisateur", "cle"]) if (typeof j[k] === "string") secrets.push(j[k], j[k].replace("-", ""));
  };
  const b = await ouvrirBanc("pile", { compte: SITE, api: API }, null, espion);
  const p = b.page;
  let cle = null;
  try {
    verifier("pile : démarre déconnecté", (await p.textContent(".connexion")).includes("Se connecter"));
    await p.click(".connexion");
    await p.click(".compte .btn--principal");
    await p.waitForSelector(".code-appairage", { timeout: 10000 });
    const code = (await p.textContent(".code-appairage")).trim();
    const app = envois.find((e) => e.chemin === "/api/premiere/appairage");
    verifier("1. appairage : 200, corps strict {hote, versionPremiere, versionExtension}", !!app && app.statut === 200 && JSON.stringify(Object.keys(app.json || {}).sort()) === JSON.stringify(["hote", "versionExtension", "versionPremiere"]) && app.json.hote === "BANC-E2E", app ? `HTTP ${app.statut} · ${Object.keys(app.json || {}).join(", ")}` : "aucun appel");
    verifier("1. page d'accord ouverte dans le navigateur avec le code (même origine que le site)", b.urlsOuvertes[0] === `${SITE}/premiere/connecter?code=${encodeURIComponent(code)}` && /^[B-DF-HJ-NP-TV-Z]{4}-[B-DF-HJ-NP-TV-Z]{4}$/.test(code), "format XXXX-XXXX");
    await p.screenshot({ path: join(rendus, "bout-en-bout-C1-code.png") });

    // Le panneau attend : au moins une interrogation « en attente » (428) avant l'accord.
    for (let i = 0; i < 40 && !envois.some((e) => e.chemin === "/api/premiere/jeton" && e.statut === 428); i++) await p.waitForTimeout(250);
    // 2. Accord sur la VRAIE page du site, utilisateur d'essai connecté (session d'essai de la pile).
    const ctxSite = await navigateur.newContext({ viewport: { width: 1280, height: 860 } });
    await ctxSite.addCookies([{ name: nomCookie, value: reste.join("="), domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await ctxSite.addInitScript(() => {
      try { localStorage.setItem("aethryon:confidentialite", JSON.stringify({ v: 1, at: new Date().toISOString(), signature: "", services: {} })); } catch { /* bandeau */ }
    });
    const site = await ctxSite.newPage();
    const erreursSite = [];
    site.on("pageerror", (e) => erreursSite.push(e.message));
    site.on("console", (m) => { if (m.type() === "error") erreursSite.push(m.text()); });
    await site.goto(b.urlsOuvertes[0]);
    await site.getByRole("button", { name: "Autoriser", exact: true }).waitFor({ timeout: 10000 });
    const titre = (await site.getByRole("heading", { level: 1 }).textContent()) || "";
    const corpsPage = (await site.textContent("body")) || "";
    const vus = { titre: titre.replace(/[\u00a0\u202f]/g, " ").trim() === "Connecter AETHRYON pour Premiere Pro ?", code: corpsPage.replace(/[\s\u00a0\u202f-]/g, "").includes(code.replace("-", "")), ordinateur: corpsPage.includes("BANC-E2E"), panneau: corpsPage.includes("2.0.0") };
    verifier("2. page d'accord réelle : titre, code identique, ordinateur et version du panneau affichés", Object.values(vus).every(Boolean), Object.entries(vus).map(([k, v]) => `${k} ${v ? "oui" : "NON"}`).join(", "));
    await site.screenshot({ path: join(rendus, "bout-en-bout-C2-accord.png") });
    await site.getByRole("button", { name: "Autoriser", exact: true }).click();
    await site.getByRole("heading", { name: "Premiere Pro est connecté" }).waitFor({ timeout: 8000 });
    verifier("2. accord donné sur le site (« Premiere Pro est connecté »), sans erreur de page", erreursSite.length === 0, erreursSite.join(" | ").slice(0, 160));
    await site.screenshot({ path: join(rendus, "bout-en-bout-C3-autorise.png") });

    // 3. Clé reçue par l'interrogation du panneau, enregistrée, quota lu par /moi.
    await p.waitForSelector(".compte__nom", { timeout: 20000 });
    await p.waitForSelector(".chiffre", { timeout: 10000 });
    const fichierCle = join(b.donnees, "cle.json");
    cle = existsSync(fichierCle) ? JSON.parse(readFileSync(fichierCle, "utf8")).cle : null;
    if (cle) secrets.push(cle);
    const jetons = envois.filter((e) => e.chemin === "/api/premiere/jeton").map((e) => e.statut);
    verifier("3. clé « premiere » reçue une seule fois (428… puis 200), enregistrée 0600, compte affiché", typeof cle === "string" && cle.startsWith("ytc_") && jetons[0] === 428 && jetons.filter((s) => s === 200).length === 1 && jetons.every((s) => s === 428 || s === 200) && (statSync(fichierCle).mode & 0o777) === 0o600 && (await p.textContent(".compte")).includes(email), `jeton : ${jetons.join(" ")}`);
    const moi = envois.find((e) => e.chemin === "/api/premiere/moi");
    verifier("3. /api/premiere/moi 200 : quota du jour affiché", !!moi && moi.statut === 200 && /^\d+$/.test((await p.textContent(".chiffre")).trim()), `quota restant ${(await p.textContent(".chiffre")).trim()}`);
    const liste = await fetch(`${SITE}/api/keys`, { headers: { cookie: cookieBrut } }).then((r) => r.text()).catch(() => "");
    verifier("3. « Mes jetons » liste la clé « Premiere Pro · BANC-E2E »", liste.includes("Premiere Pro · BANC-E2E") || liste.includes("Premiere Pro \u00b7 BANC-E2E"));
    await p.screenshot({ path: join(rendus, "bout-en-bout-C4-compte.png") });

    // 4. Aperçu par ytapi /preview avec la clé.
    await p.click(".onglet >> text=Accueil");
    await p.fill('input[aria-label="Lien de la vidéo"]', LIEN);
    await p.waitForSelector(".apercu-lien:not(.est-chargement), .carte--erreur", { timeout: 30000 });
    const erreurApercu = await p.$(".carte--erreur");
    verifier("4. aperçu réel par /preview (clé premiere)", !erreurApercu && envois.some((e) => e.chemin === "/preview" && e.statut === 200), erreurApercu ? (await erreurApercu.textContent()).slice(0, 120) : (await p.textContent(".apercu-lien__titre")).trim());
    await p.screenshot({ path: join(rendus, "bout-en-bout-C5-apercu.png") });

    // 5-7. Conversion transcode (extrait 0:00–0:01), fichier, import simulé.
    await p.click('[role="switch"]');
    await p.fill('input[aria-label^="Début"]', "0:00");
    await p.fill('input[aria-label^="Fin"]', "0:01");
    await p.click(".options .btn--principal");
    await p.waitForSelector(".tache--termine, .tache--erreur", { timeout: 120000 });
    const errTache = await p.$(".tache--erreur");
    const job = envois.find((e) => e.chemin === "/jobs" && e.methode === "POST");
    verifier("5. conversion : POST /jobs avec transcode: true, fmt mp4 (202)", !!job && job.json?.transcode === true && job.json?.fmt === "mp4" && [200, 202].includes(job.statut) && !errTache, job ? `HTTP ${job.statut} · ${JSON.stringify({ fmt: job.json?.fmt, quality: job.json?.quality, transcode: job.json?.transcode, start_s: job.json?.start_s, end_s: job.json?.end_s })}` : "aucun POST /jobs");
    const mp4 = readdirSync(b.medias).filter((n) => n.endsWith(".mp4"));
    const sonde = mp4.length ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", join(b.medias, mp4[0])], { encoding: "utf8" }).trim().split("\n").join("+") : "";
    verifier("6. fichier téléchargé : MP4 H.264 + AAC (ffprobe), aucun .part", mp4.length === 1 && sonde === "h264+aac" && !readdirSync(b.medias).some((n) => n.endsWith(".part")), `${mp4.join(", ")} · ${sonde}`);
    const chemin = mp4.length ? join(b.medias, mp4[0]) : "";
    verifier("7. import dans le projet (Premiere simulé) et toast réel", !!chemin && (await p.evaluate(() => window.__bancPremiere.importes)).includes(chemin) && (await p.textContent(".toast")).includes("Importé dans"));
    await p.screenshot({ path: join(rendus, "bout-en-bout-C6-importe.png") });

    // 8. Déconnexion : révocation sur le serveur, clé effacée, puis refusée par ytapi et par /moi.
    await p.click(".connexion");
    await p.click("text=Se déconnecter");
    await p.click("text=Confirmer");
    await p.waitForSelector(".compte__bloc--centre", { timeout: 8000 });
    const dec = envois.find((e) => e.chemin === "/api/premiere/deconnexion");
    verifier("8. déconnexion : POST /api/premiere/deconnexion 204, clé effacée du PC", !!dec && dec.statut === 204 && !existsSync(fichierCle), dec ? `HTTP ${dec.statut}` : "aucun appel");
    const apres = await fetch(`${API}/preview`, { method: "POST", headers: { authorization: `Bearer ${cle}`, "content-type": "application/json" }, body: JSON.stringify({ url: LIEN }) });
    const apresJob = await fetch(`${API}/jobs`, { method: "POST", headers: { authorization: `Bearer ${cle}`, "content-type": "application/json" }, body: JSON.stringify({ url: LIEN, fmt: "mp4" }) });
    const apresMoi = await fetch(`${SITE}/api/premiere/moi`, { headers: { authorization: `Bearer ${cle}` } });
    const motif = await apresMoi.json().catch(() => ({}));
    verifier("8. après déconnexion, la clé est refusée par ytapi (/preview et /jobs 401) et par /moi (token_revoked, user)", apres.status === 401 && apresJob.status === 401 && apresMoi.status === 401 && motif.error === "token_revoked" && motif.revokedBy === "user", `${apres.status} ${apresJob.status} ${apresMoi.status} ${motif.error}/${motif.revokedBy}`);
    await p.screenshot({ path: join(rendus, "bout-en-bout-C7-deconnecte.png") });

    // Requêtes du panneau : seulement le site et l'API configurés, aucun cookie, aucune origine.
    verifier("le panneau n'a parlé qu'au site et à l'API configurés, sans cookie", envois.every((e) => (e.origine === SITE || e.origine === API) && !e.entetes.some((h) => /^(cookie|origin)$/i.test(h))));
    await ctxSite.close();
  } catch (e) {
    verifier("scénario C sans exception", false, String(e.message || e).split("\n")[0]);
    await p.screenshot({ path: join(rendus, "bout-en-bout-C-echec.png") }).catch(() => {});
  }
  // Aucun secret (clé, code d'appareil, code utilisateur, cookie) dans les journaux du panneau ni des conteneurs.
  const vrais = [...new Set(secrets.filter((x) => typeof x === "string" && x.length >= 8))];
  const panneau = vrais.filter((x) => fuite(b, x)).length;
  let conteneurs = 0;
  const lus = [];
  for (const c of ["web", "account", "ytapi"]) {
    const r = spawnSync("docker", ["logs", `${PILE}-${c}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const tout = (r.stdout || "") + (r.stderr || "");
    lus.push(`${c} ${tout.split("\n").length} lignes`);
    conteneurs += vrais.filter((x) => tout.includes(x)).length;
  }
  verifier(`aucun secret (${vrais.length} valeurs : clé, codes, cookie) dans les journaux du panneau ni des 3 conteneurs`, panneau === 0 && conteneurs === 0 && vrais.length >= 4, `${lus.join(", ")} · trouvés : panneau ${panneau}, conteneurs ${conteneurs}`);
  await b.contexte.close();
  rmSync(b.base, { recursive: true, force: true });
}

await navigateur.close();
statique.close();
rmSync(travail, { recursive: true, force: true });
writeFileSync(join(rendus, "bout-en-bout.json"), JSON.stringify({ le: new Date().toISOString(), echecs, resultats }, null, 1));
console.log(`\n${resultats.length} vérifications, ${echecs} en échec.`);
process.exit(echecs ? 1 : 0);
