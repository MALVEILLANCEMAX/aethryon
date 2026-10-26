// Banc de bout en bout d'AETHRYON Music + Cloud (manuel, hors `npm test`) : le VRAI code d'ytapi (app/music : connecteur
// « fichier », job d'import, vérifications ffprobe, étiquettes ffmpeg ; app/cloud.py : envoi) → API interne d'account
// (vrai serveur HTTP, CLOUD=on) → stockage S3 local (moto + passerelle de vérification) → bibliothèque musicale relue
// (fiche, lien signé, octets identiques) → expiration à 30 jours (fiche gardée, audio supprimé, réimport proposé).
// Source audio : petit serveur HTTP local (MUSIC_ALLOW_LOCAL_SOURCES, essais seulement). Aucun réseau extérieur.
//   CLOUD_TEST_MOTO_URL=http://127.0.0.1:<port> PYTHON=<python avec fastapi> node test/music-cloud-e2e.ts
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { CreateBucketCommand, ListObjectVersionsCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { harness, INTERNAL, newUser } from "./helpers.ts";
import { s3Local } from "./s3-local.ts";

const MOTO = process.env.CLOUD_TEST_MOTO_URL;
const PYTHON = process.env.PYTHON ?? "python3";
if (!MOTO) { console.error("CLOUD_TEST_MOTO_URL manquant"); process.exit(2); }
const YTAPI = resolve(dirname(fileURLToPath(import.meta.url)), "../../media-api");
const JOUR = 86_400_000;

const dir = mkdtempSync(join(tmpdir(), "ytc2-music-e2e-"));
const w = (n: string, v: string | Buffer) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
const accessKeyId = `essai${randomBytes(6).toString("hex")}`, secretAccessKey = randomBytes(24).toString("base64url");
const bucket = `aethryon-music-${randomBytes(4).toString("hex")}`;
const gw = await s3Local(MOTO, { accessKeyId, secretAccessKey });
const s3 = new S3Client({ endpoint: gw.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
await s3.send(new CreateBucketCommand({ Bucket: bucket }));
await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
const horloge = { decalage: 0 };
const h = await harness({
  CLOUD: "on", CLOUD_S3_ENDPOINT: gw.endpoint, CLOUD_S3_ALLOW_HTTP: "1", CLOUD_S3_REGION: "us-east-1", CLOUD_S3_BUCKET: bucket, CLOUD_S3_PATH_STYLE: "1",
  CLOUD_S3_ACCESS_KEY_ID_FILE: w("id", accessKeyId), CLOUD_S3_SECRET_ACCESS_KEY_FILE: w("secret", secretAccessKey), ADMIN_EMAILS: "admin@example.test",
}, { cloudNow: () => Date.now() + horloge.decalage });
// Vrai fichier audio (4 s, MP3) produit par ffmpeg, servi par un serveur local.
const son = join(dir, "source.mp3");
execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", son]);
const sonOctets = readFileSync(son);
const source = createServer((req, res) => {
  if (req.url !== "/mes-sons/demo.mp3") { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(sonOctets.length) }).end(sonOctets);
});
await new Promise<void>((ok) => source.listen(0, "127.0.0.1", ok));
const sourceUrl = `http://127.0.0.1:${(source.address() as { port: number }).port}/mes-sons/demo.mp3`;
const internal = serve({ fetch: h.s.internalApp.fetch, port: 0, hostname: "127.0.0.1" });
const out: Record<string, unknown> = {};
try {
  await new Promise((ok) => internal.once("listening", ok));
  const port = (internal.address() as { port: number }).port;
  const admin = await newUser(h, "admin@example.test");
  const adminId = (await admin.json("/api/me")).body.user.id as string;
  const user = await newUser(h, "lina@example.test");
  const userId = (await user.json("/api/me")).body.user.id as string;
  const token = w("internal", INTERNAL);
  const py = `
import asyncio, dataclasses, hashlib, json, sys, time
sys.path.insert(0, ${JSON.stringify(YTAPI)})
from pathlib import Path
from app.config import Settings
from app.userkeys import AccountClient, Principal
from app.cloud import CloudSync
from app.music.service import MusicService
settings = Settings(api_token="x" * 40, allowed_domains=("youtube.com",), tmp_dir=Path(${JSON.stringify(join(dir, "ytapi-tmp"))}),
                    music_enabled=True, music_allow_local_sources=True)
client = AccountClient("http://127.0.0.1:${port}", Path(${JSON.stringify(token)}), 3.0, 0.0)
sync = CloudSync(client, allow_http=True, retry_delays_s=(0.1, 0.1))
music = MusicService(settings, cloud_sink=sync.offer)
# La source locale est en http (essai) ; en production une source est toujours https et account ne garde que des
# liens https dans la fiche : le lien de la FICHE est réécrit, le téléchargement, lui, passe par le vrai serveur local.
_plan = music.direct.plan_import
async def plan_https(ref, body):
    plan = await _plan(ref, body)
    plan.source_url = "https://fichiers.exemple.test/mes-sons/demo.mp3"
    return plan
music.direct.plan_import = plan_https
async def one(user_id):
    p = Principal(kind="user", label="u", user_id=user_id, key_id="k")
    t0 = time.monotonic()
    job = await music.start_import(p, {"url": ${JSON.stringify(sourceUrl)}, "type": "fichier", "attestation": True})
    while job.etat not in ("termine", "echec", "annule"):
        await asyncio.sleep(0.02)
    t_import = time.monotonic() - t0
    while job.cloud_state in ("en_file", "envoi_en_cours"):
        await asyncio.sleep(0.02)
    v = music.imports.view(job, None)
    data = Path(job.result["filepath"]).read_bytes() if job.result else b""
    return {"etat": job.etat, "cloud": job.cloud_state, "vue_cloud": v["cloud"], "audio": v["fichier"]["audio"] if v["fichier"] else None,
            "etiquetage": job.etiquetage, "sha256": hashlib.sha256(data).hexdigest(), "taille": len(data), "nom": v["fichier"]["nom"] if v["fichier"] else None,
            "ms_import": round(t_import * 1000), "ms_total": round((time.monotonic() - t0) * 1000)}
async def main():
    music.imports.start(); sync.start()
    res = {"admin": await one(${JSON.stringify(adminId)}), "utilisateur": await one(${JSON.stringify(userId)})}
    await sync.stop(); await music.imports.shutdown()
    print(json.dumps(res))
asyncio.run(main())
`;
  const p = spawn(PYTHON, ["-I", "-c", py], { timeout: 120_000 });
  let stdout = "", stderr = "";
  p.stdout.on("data", (d) => { stdout += d; });
  p.stderr.on("data", (d) => { stderr += d; });
  const code = await new Promise((ok) => p.on("close", ok));
  if (code !== 0) { console.error(stderr.slice(-3000)); throw new Error(`python ${code}`); }
  const res = JSON.parse(stdout.trim().split("\n").pop()!);
  out.ytapi = res;
  assert.equal(res.admin.etat, "termine");
  assert.equal(res.admin.cloud, "sauvegarde", "ytapi : sauvegardé seulement après la vérification d'account");
  assert.deepEqual(res.admin.vue_cloud, { etat: "sauvegarde", libelle: "Sauvegardé", raison: null });
  assert.equal(res.admin.etiquetage, "ok");
  assert.ok(res.admin.audio.dureeS > 3.9 && res.admin.audio.dureeS < 4.2 && res.admin.audio.codec === "mp3");
  assert.equal(res.utilisateur.etat, "termine");
  assert.equal(res.utilisateur.cloud, "skipped:non_admin");
  assert.equal(res.utilisateur.vue_cloud, null, "aucune ligne cloud affichée pour un compte ordinaire");
  // Bibliothèque musicale de l'administrateur (API publique d'account, session).
  const bib = await admin.json("/api/cloud/objets?musique=1");
  assert.equal(bib.body.total, 1);
  const item = bib.body.items[0];
  assert.equal(item.statut, "sauvegarde");
  assert.equal(item.audioDisponible, true);
  assert.equal(item.musique.connecteur, "fichier");
  assert.equal(item.musique.licence.code, "declaree");
  assert.equal(item.musique.attestation, true);
  assert.equal(item.musique.audio.codec, "mp3");
  assert.equal(item.taille, res.admin.taille);
  assert.equal(item.sha256, res.admin.sha256);
  assert.equal(item.expireDansJours, 30);
  const lien = await admin.json(`/api/cloud/objets/${item.id}/lien`, { method: "POST", body: { usage: "apercu" } });
  assert.equal(lien.status, 200);
  const got = Buffer.from(await (await fetch(lien.body.url)).arrayBuffer());
  assert.equal(createHash("sha256").update(got).digest("hex"), res.admin.sha256, "octets identiques à ceux produits par ytapi");
  out.lien = { statut: 200, octets: got.length };
  assert.equal((await user.json("/api/cloud/objets?musique=1")).status, 403, "compte ordinaire : cloud refusé");
  // Quota commun : l'audio compte comme une vidéo.
  const etat = await admin.json("/api/cloud/etat");
  assert.equal(etat.body.quota.utilise, res.admin.taille);
  // Expiration à 30 jours : audio supprimé (toutes versions), fiche gardée, réimport proposé.
  horloge.decalage = 30 * JOUR + 1000;
  const t = await h.s.cloud!.tache();
  assert.equal(t.expires, 1);
  const apres = (await admin.json("/api/cloud/objets?musique=1")).body.items[0];
  assert.equal(apres.statut, "expire");
  assert.equal(apres.audioDisponible, false);
  assert.equal(apres.musique.titre, "demo");
  assert.deepEqual(apres.reimport, { possible: true, url: "https://fichiers.exemple.test/mes-sons/demo.mp3", connecteur: "fichier", attestationRequise: true });
  assert.equal((await admin.json(`/api/cloud/objets/${item.id}/lien`, { method: "POST", body: {} })).status, 410);
  const cle = (h.s.db.prepare("SELECT cle FROM ytc_cloud_objet WHERE id = ?").get(item.id) as { cle: string }).cle;
  const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: cle }));
  assert.equal((versions.Versions ?? []).length + (versions.DeleteMarkers ?? []).length, 0, "plus aucune version chez le fournisseur");
  assert.equal((await admin.json("/api/cloud/etat")).body.quota.utilise, 0);
  out.expiration = { statut: apres.statut, ficheGardee: true, versionsRestantes: 0 };
  out.refusPasserelle = gw.refus;
  console.log(JSON.stringify(out, null, 1));
  console.log("BANC MUSIC + CLOUD RÉUSSI");
} finally {
  internal.close(); source.close(); h.close(); s3.destroy(); await gw.close();
  rmSync(dir, { recursive: true, force: true });
}
