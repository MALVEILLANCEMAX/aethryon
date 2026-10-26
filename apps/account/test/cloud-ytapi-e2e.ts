// Banc de bout en bout d'AETHRYON Cloud (manuel, hors `npm test`) : le VRAI code d'ytapi (app/cloud.py, processus Python)
// → API interne d'account (vrai serveur HTTP, CLOUD=on) → stockage S3 local (moto + passerelle de vérification) → lien
// de téléchargement relu octet par octet. Aucun réseau extérieur, aucun identifiant réel.
//   CLOUD_TEST_MOTO_URL=http://127.0.0.1:<port> PYTHON=<python avec les dépendances d'ytapi> node test/cloud-ytapi-e2e.ts
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { harness, INTERNAL, newUser } from "./helpers.ts";
import { s3Local } from "./s3-local.ts";

const MOTO = process.env.CLOUD_TEST_MOTO_URL;
const PYTHON = process.env.PYTHON ?? "python3";
if (!MOTO) { console.error("CLOUD_TEST_MOTO_URL manquant"); process.exit(2); }
const YTAPI = resolve(dirname(fileURLToPath(import.meta.url)), "../../media-api");

const dir = mkdtempSync(join(tmpdir(), "ytc2-cloud-e2e-"));
const w = (n: string, v: string | Buffer) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
const accessKeyId = `essai${randomBytes(6).toString("hex")}`, secretAccessKey = randomBytes(24).toString("base64url");
const bucket = `aethryon-e2e-${randomBytes(4).toString("hex")}`;
const gw = await s3Local(MOTO, { accessKeyId, secretAccessKey });
const s3 = new S3Client({ endpoint: gw.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
await s3.send(new CreateBucketCommand({ Bucket: bucket }));
await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
const h = await harness({
  CLOUD: "on", CLOUD_S3_ENDPOINT: gw.endpoint, CLOUD_S3_ALLOW_HTTP: "1", CLOUD_S3_REGION: "us-east-1", CLOUD_S3_BUCKET: bucket, CLOUD_S3_PATH_STYLE: "1",
  CLOUD_S3_ACCESS_KEY_ID_FILE: w("id", accessKeyId), CLOUD_S3_SECRET_ACCESS_KEY_FILE: w("secret", secretAccessKey), ADMIN_EMAILS: "admin@example.test",
});
const out: Record<string, unknown> = {};
const internal = serve({ fetch: h.s.internalApp.fetch, port: 0, hostname: "127.0.0.1" });
try {
  await new Promise((ok) => internal.once("listening", ok));
  const port = (internal.address() as { port: number }).port;
  const admin = await newUser(h, "admin@example.test");
  const adminId = (await admin.json("/api/me")).body.user.id as string;
  const user = await newUser(h, "lina@example.test");
  const userId = (await user.json("/api/me")).body.user.id as string;
  const media = randomBytes(3 * 1024 * 1024 + 17);
  const file = w("Café 東京 [abc].mp4", media);
  const token = w("internal", INTERNAL);
  const py = `
import asyncio, json, sys, types
sys.path.insert(0, ${JSON.stringify(YTAPI)})
from pathlib import Path
from app.userkeys import AccountClient
from app.cloud import CloudSync
client = AccountClient("http://127.0.0.1:${port}", Path(${JSON.stringify(token)}), 3.0, 0.0)
sync = CloudSync(client, allow_http=True, retry_delays_s=(0.1, 0.1))
def job(i, owner):
    return types.SimpleNamespace(id="job-e2e-%d" % i, owner_user_id=owner, kind="download", usage_id=None, cloud_hold_until=None,
        media=types.SimpleNamespace(platform="youtube"),
        result={"filepath": ${JSON.stringify(file)}, "download_name": "Café 東京 [abc].mp4", "media_type": "video/mp4", "ext": "mp4"})
async def main():
    res = {}
    for i, owner in ((1, ${JSON.stringify(adminId)}), (2, ${JSON.stringify(userId)})):
        j = job(i, owner)
        sync.offer(j)
        j2, handle = sync.queue.get_nowait()
        try:
            res[owner] = await sync.process(j2, handle)
        finally:
            handle.close()
    print(json.dumps(res))
asyncio.run(main())
`;
  const t0 = Date.now();
  // Processus séparé, attendu sans bloquer : account (ce processus) doit répondre pendant ce temps.
  const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((ok) => {
    const p = spawn(PYTHON, ["-I", "-c", py], { timeout: 120_000 });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("close", (status) => ok({ status, stdout, stderr }));
  });
  out.ytapi_ms = Date.now() - t0;
  if (r.status !== 0) throw new Error(`ytapi : ${r.stderr.split("\n").slice(-4).join(" ")}`);
  const etats = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as Record<string, string>;
  out.admin = etats[adminId];
  out.non_admin = etats[userId];
  const liste = await admin.json("/api/cloud/objets");
  const o = liste.body.items[0];
  out.statut = o?.statut; out.libelle = o?.libelle; out.expireDansJours = o?.expireDansJours; out.taille = o?.taille;
  const lien = await admin.json(`/api/cloud/objets/${o.id}/lien`, { method: "POST", body: { usage: "telecharger" } });
  const g = await fetch(lien.body.url);
  const recu = Buffer.from(await g.arrayBuffer());
  out.lien_http = g.status;
  out.octets_identiques = createHash("sha256").update(recu).digest("hex") === createHash("sha256").update(media).digest("hex");
  out.disposition = g.headers.get("content-disposition");
  out.lignes_non_admin = (h.s.db.prepare("SELECT count(*) n FROM ytc_cloud_objet WHERE owner_id = ?").get(userId) as { n: number }).n;
  out.refus_passerelle = gw.refus;
  console.log(JSON.stringify(out, null, 1));
} finally {
  internal.close();
  h.close();
  s3.destroy();
  await gw.close();
  rmSync(dir, { recursive: true, force: true });
}
