// Banc de bout en bout de la section MUSIQUE (manuel, hors `npm test`) : clé « desktop » obtenue par le VRAI appairage
// → relais /api/music/* d'account (MUSIC_RELAY=1) → le VRAI ytapi en HTTP (uvicorn, 127.0.0.1, MUSIC_ENABLED,
// sources locales autorisées pour l'essai seulement) → import RÉEL d'un fichier audio libre de droits (produit ici par
// ffmpeg, servi par un serveur local) → vérifications d'ytapi (octets magiques, ffprobe, étiquettes) → sauvegarde dans
// AETHRYON Cloud (vrai account, CLOUD=on) contre un S3 LOCAL (moto + passerelle SigV4) → fichier rapatrié par le relais,
// octets identiques → bibliothèque musicale du cloud lue par la clé « desktop » → expiration à 30 jours : fiche gardée,
// audio indisponible, réimport proposé. Compte ordinaire : import réussi, aucun cloud. Aucun réseau extérieur, aucune
// étiquette Traefik (rien n'est dans Docker ici), aucun identifiant réel.
//   CLOUD_TEST_MOTO_URL=http://127.0.0.1:<port> PYTHON=<python avec les dépendances d'ytapi> node test/music-relais-e2e.ts
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { CreateBucketCommand, ListObjectVersionsCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { harness, INTERNAL, newUser, type Harness } from "./helpers.ts";
import { s3Local } from "./s3-local.ts";

const MOTO = process.env.CLOUD_TEST_MOTO_URL;
const PYTHON = process.env.PYTHON ?? "python3";
if (!MOTO) { console.error("CLOUD_TEST_MOTO_URL manquant"); process.exit(2); }
const YTAPI = resolve(dirname(fileURLToPath(import.meta.url)), "../../media-api");
const JOUR = 86_400_000;
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "ytc2-music-relais-"));
const w = (n: string, v: string | Buffer) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
const accessKeyId = `essai${randomBytes(6).toString("hex")}`, secretAccessKey = randomBytes(24).toString("base64url");
const bucket = `aethryon-musique-${randomBytes(4).toString("hex")}`;
const gw = await s3Local(MOTO, { accessKeyId, secretAccessKey });
const s3 = new S3Client({ endpoint: gw.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
await s3.send(new CreateBucketCommand({ Bucket: bucket }));
await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));

// Son libre de droits (aucun tiers : produit ici) : 5 s, MP3, avec étiquettes.
const son = join(dir, "source.mp3");
execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k",
  "-metadata", "title=Essai libre", "-metadata", "artist=Banc AETHRYON", son]);
const sonOctets = readFileSync(son);
const source = createServer((req, res) => {
  if (req.url !== "/sons/essai-libre.mp3") { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(sonOctets.length) }).end(req.method === "HEAD" ? undefined : sonOctets);
});
await new Promise<void>((ok) => source.listen(0, "127.0.0.1", ok));
const sourceUrl = `http://127.0.0.1:${(source.address() as { port: number }).port}/sons/essai-libre.mp3`;

const horloge = { decalage: 0 };
const h: Harness = await harness({
  CLOUD: "on", CLOUD_S3_ENDPOINT: gw.endpoint, CLOUD_S3_ALLOW_HTTP: "1", CLOUD_S3_REGION: "us-east-1", CLOUD_S3_BUCKET: bucket, CLOUD_S3_PATH_STYLE: "1",
  CLOUD_S3_ACCESS_KEY_ID_FILE: w("id", accessKeyId), CLOUD_S3_SECRET_ACCESS_KEY_FILE: w("secret", secretAccessKey), ADMIN_EMAILS: "admin@example.test",
  DESKTOP_CONNEXION: "1", MUSIC_RELAY: "1",
}, { cloudNow: () => Date.now() + horloge.decalage });
const internal = serve({ fetch: h.s.internalApp.fetch, port: 0, hostname: "127.0.0.1" });
await new Promise((ok) => internal.once("listening", ok));
const internalPort = (internal.address() as { port: number }).port;

// Le VRAI ytapi, en HTTP sur 127.0.0.1 (processus Python, aucun conteneur).
const yPort = 20000 + Math.floor(Math.random() * 20000);
mkdirSync(join(dir, "tmp")); mkdirSync(join(dir, "cache"));
// Comme music-cloud-e2e.ts : la source d'essai est en http (127.0.0.1) ; en production une source est toujours https et
// account ne garde que des liens https dans la fiche musicale. Le lien de la FICHE est donc réécrit en https ; le
// téléchargement, lui, passe bien par le serveur local (aucun autre changement du code d'ytapi).
const lanceur = `
import sys, uvicorn
from app.music.sources import DirectFile
_plan = DirectFile.plan_import
async def plan_https(self, ref, body):
    plan = await _plan(self, ref, body)
    plan.source_url = "https://fichiers.exemple.test/sons/essai-libre.mp3"
    return plan
DirectFile.plan_import = plan_https
uvicorn.run("app.main:app", host="127.0.0.1", port=int(sys.argv[1]), access_log=False, log_level="warning")
`;
const ytapi = spawn(PYTHON, ["-c", lanceur, String(yPort)], {
  cwd: YTAPI,
  env: { PATH: process.env.PATH ?? "", HOME: dir, API_TOKEN: "a".repeat(40), USER_KEYS_ENABLED: "true", ACCOUNT_INTERNAL_URL: `http://127.0.0.1:${internalPort}`,
    ACCOUNT_INTERNAL_TOKEN_FILE: w("internal", INTERNAL), MUSIC_ENABLED: "true", MUSIC_ALLOW_LOCAL_SOURCES: "true", DEBUG: "true", CLOUD_SYNC: "true", CLOUD_SYNC_ALLOW_HTTP: "true",
    TMP_DIR: join(dir, "tmp"), CACHE_DIR: join(dir, "cache"), LOG_LEVEL: "WARNING" },
});
let journal = "";
ytapi.stderr.on("data", (d) => { journal += d; });
ytapi.stdout.on("data", (d) => { journal += d; });
// Le relais d'account appelle « ytapi.invalid » (configuration du harnais) : on le renvoie au vrai ytapi.
h.ytapi.handler = async ({ method, url, headers, body }) => {
  if (!url.pathname.startsWith("/music/")) return null;
  return fetch(`http://127.0.0.1:${yPort}${url.pathname}${url.search}`, { method, headers, body: method === "GET" || method === "DELETE" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)), redirect: "manual" });
};

const out: Record<string, unknown> = {};
let ipN = 1;
async function core(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { "x-real-ip": `198.51.100.${(ipN++ % 250) + 1}` };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] = "application/json"; }
  const res = await h.s.publicApp.request(path, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, body });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return { status: res.status, body: null as any, bytes: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, body: await res.json() as any, bytes: null };
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${yPort}/health`)).status === 200) break; } catch { /* démarrage */ }
    if (ytapi.exitCode !== null) throw new Error(`ytapi arrêté : ${journal.slice(-2000)}`);
    await attendre(200);
  }
  const admin = await newUser(h, "admin@example.test");
  // Appairage réel du Desktop (desktop.ts) : la clé « desktop » de l'administrateur.
  const p = await core("/api/desktop/appairage", { body: { hote: "PC-MUSIQUE", versionDesktop: "1.1.0-beta.1" } });
  assert.equal((await admin.json("/api/desktop/autoriser", { method: "POST", body: { codeUtilisateur: p.body.codeUtilisateur } })).status, 200);
  const cle = (await core("/api/desktop/jeton", { body: { codeAppareil: p.body.codeAppareil } })).body.cle as string;
  assert.match(cle, /^ytc_/);

  // 1. Analyse : fichier direct « Téléchargeable », import avec déclaration de droits.
  const a = await core("/api/music/analyser", { token: cle, body: { url: sourceUrl, type: "fichier" } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.fiche.etat, "telechargeable");
  const action = a.body.fiche.actions.find((x: { id: string }) => x.id === "importer");
  assert.ok(action && action.attestationRequise === true, "déclaration de droits exigée");
  assert.equal(action.requete.chemin, "/api/music/imports", "chemin réécrit vers le relais");
  // ytapi ne pré-remplit plus `attestation` (correctif 3.8) : le corps proposé, renvoyé tel quel, doit être refusé.
  assert.ok(!("attestation" in action.requete.corps), "le corps proposé ne porte pas la déclaration");
  out.attestationPreRemplie = action.requete.corps.attestation ?? null;
  // Corps proposé renvoyé tel quel (sans déclaration) : refusé AVANT toute requête vers le fichier.
  const sans = await core("/api/music/imports", { token: cle, body: action.requete.corps });
  assert.equal(sans.status, 400);
  assert.equal(sans.body.error, "attestation_requise");
  // 2. Import réel.
  const imp = await core("/api/music/imports", { token: cle, body: { ...action.requete.corps, attestation: true } });
  assert.equal(imp.status, 202, JSON.stringify(imp.body));
  const id = imp.body.import.id as string;
  const vus = new Set<string>();
  let vue: any = imp.body.import;
  for (let i = 0; i < 300 && (!["termine", "echec", "annule"].includes(vue.etat) || ["en_attente", "envoi_en_cours"].includes(vue.cloud?.etat)); i++) {
    await attendre(100);
    vue = (await core(`/api/music/imports/${id}`, { token: cle })).body.import;
    vus.add(vue.etat);
  }
  assert.equal(vue.etat, "termine", JSON.stringify(vue).slice(0, 600));
  assert.equal(vue.fichier.url, `/api/music/imports/${id}/fichier`);
  assert.equal(vue.attestation, true);
  assert.equal(vue.cloud?.etat, "sauvegarde", "administrateur : sauvegardé après vérification d'account");
  out.import = { etats: [...vus], fichier: vue.fichier.nom, audio: vue.fichier.audio, cloud: vue.cloud };
  // 3. Rapatriement par le relais : octets d'ytapi (flux copiés, étiquettes ajoutées), audio intact.
  const f = await core(`/api/music/imports/${id}/fichier`, { token: cle });
  assert.equal(f.status, 200);
  assert.equal(f.bytes!.length, vue.fichier.taille);
  const sha = createHash("sha256").update(f.bytes!).digest("hex");
  out.rapatriement = { octets: f.bytes!.length, sha256: sha.slice(0, 16) };
  // 4. Bibliothèque musicale du cloud, lue par la clé « desktop » (même quota que les vidéos).
  const bib = await core("/api/cloud/objets?musique=1", { token: cle });
  assert.equal(bib.status, 200);
  assert.equal(bib.body.total, 1);
  const item = bib.body.items[0];
  assert.equal(item.audioDisponible, true);
  assert.equal(item.sha256, sha, "le cloud garde les mêmes octets que le fichier rapatrié");
  assert.equal(item.musique.attestation, true);
  const quota = (await core("/api/cloud/etat", { token: cle })).body.quota;
  assert.equal(quota.utilise, item.taille, "un seul quota global : l'audio compte comme une vidéo");
  const lien = await core(`/api/cloud/objets/${item.id}/lien`, { token: cle, body: { usage: "apercu" } });
  const got = Buffer.from(await (await fetch(lien.body.url)).arrayBuffer());
  assert.equal(createHash("sha256").update(got).digest("hex"), sha, "écoute sécurisée : lien signé, octets identiques");
  // 5. Historique de l'espace : l'import vu depuis le Desktop.
  const hist = (await core("/api/music/historique", { token: cle })).body.entrees;
  assert.ok(hist.some((e: { importId: string; etat: string; origine: string }) => e.importId === id && e.etat === "termine" && e.origine === "desktop"));
  // 6. Expiration à 30 jours : audio supprimé chez le fournisseur, fiche gardée, réimport proposé ; copie locale intacte.
  horloge.decalage = 30 * JOUR + 1000;
  assert.equal((await h.s.cloud!.tache()).expires, 1);
  const apres = (await core("/api/cloud/objets?musique=1", { token: cle })).body.items[0];
  assert.equal(apres.statut, "expire");
  assert.equal(apres.audioDisponible, false);
  assert.equal(apres.musique.titre, "essai-libre", "fiche gardée (titre tiré du nom du fichier direct)");
  assert.equal(apres.reimport?.possible, true);
  assert.equal((await core(`/api/cloud/objets/${item.id}/lien`, { token: cle, body: { usage: "apercu" } })).status, 410);
  const cleS3 = (h.s.db.prepare("SELECT cle FROM ytc_cloud_objet WHERE id = ?").get(item.id) as { cle: string }).cle;
  const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: cleS3 }));
  assert.equal((versions.Versions ?? []).length + (versions.DeleteMarkers ?? []).length, 0);
  out.expiration = { statut: apres.statut, audioDisponible: apres.audioDisponible, ficheGardee: apres.musique.titre, reimport: apres.reimport };
  // 7. Compte ordinaire (session du site) : import réussi, AUCUN cloud ; /api/cloud refusé.
  const lina = await newUser(h, "lina@example.test");
  const i2 = await lina.json("/api/music/imports", { method: "POST", body: { url: sourceUrl, type: "fichier", attestation: true } });
  assert.equal(i2.status, 202, JSON.stringify(i2.body));
  let v2 = i2.body.import;
  for (let i = 0; i < 200 && !["termine", "echec"].includes(v2.etat); i++) { await attendre(100); v2 = (await lina.json(`/api/music/imports/${v2.id}`)).body.import; }
  assert.equal(v2.etat, "termine");
  assert.equal(v2.cloud, null);
  assert.equal((await lina.json("/api/cloud/objets?musique=1")).status, 403);
  // 8. L'import de l'administrateur n'est pas visible par un autre compte.
  assert.equal((await lina.json(`/api/music/imports/${id}`)).status, 404);
  out.compteOrdinaire = { etat: v2.etat, cloud: v2.cloud };
  out.refusPasserelle = gw.refus;
  console.log(JSON.stringify(out, null, 1));
  console.log("BANC MUSIQUE (relais + vrai ytapi + cloud S3 local) RÉUSSI");
} finally {
  ytapi.kill("SIGTERM");
  internal.close(); source.close(); h.close(); s3.destroy(); await gw.close();
  rmSync(dir, { recursive: true, force: true });
}
