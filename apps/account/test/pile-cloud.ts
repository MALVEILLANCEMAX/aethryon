// PILE JETABLE d'AETHRYON Cloud pour les bancs du site et du Desktop (manuelle, hors `npm test`) : le VRAI account
// (CLOUD=on, DESKTOP_CONNEXION=1) sur une base temporaire, le stockage S3 LOCAL (moto + passerelle de vérification de
// test/s3-local.ts), et le site construit (web/dist) servi comme le fait nginx (coque pour les routes de l'application,
// en-têtes CSP de web/nginx/*.conf). Tout écoute sur 127.0.0.1 seulement ; aucune étiquette, aucun conteneur, aucun
// identifiant réel. Sessions de test créées DIRECTEMENT par Better Auth (comme src/tools/create-test-session.ts).
//   CLOUD_TEST_MOTO_URL=http://127.0.0.1:<port> WEB_DIST=../web/dist PILE_JSON=<fichier 600> node test/pile-cloud.ts
// Seule différence avec nginx : dans la CSP de /dashboard/cloud, « https://*.backblazeb2.com » est remplacé par
// l'adresse du S3 local (le navigateur lit l'aperçu depuis le stockage, comme en production).
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";
import { s3Local } from "./s3-local.ts";

const ici = dirname(fileURLToPath(import.meta.url));
const MOTO = process.env.CLOUD_TEST_MOTO_URL;
const DIST = resolve(process.env.WEB_DIST ?? join(ici, "../../web/dist"));
const SORTIE = process.env.PILE_JSON;
if (!MOTO || !SORTIE || !existsSync(join(DIST, "app.html"))) { console.error("CLOUD_TEST_MOTO_URL, PILE_JSON et WEB_DIST (avec app.html) requis"); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "ytc2-pile-cloud-"));
const w = (n: string, v: string | Buffer) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
const accessKeyId = `pile${randomBytes(6).toString("hex")}`, secretAccessKey = randomBytes(24).toString("base64url");
const bucket = `aethryon-pile-${randomBytes(4).toString("hex")}`;
const gw = await s3Local(MOTO, { accessKeyId, secretAccessKey });
const s3 = new S3Client({ endpoint: gw.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
await s3.send(new CreateBucketCommand({ Bucket: bucket }));
await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));

// Port choisi d'abord (l'origine publique en dépend : contrôle CSRF, cookies).
const port = Number(process.env.PILE_PORT ?? 0) || await new Promise<number>((ok) => { const t = createHttpServer().listen(0, "127.0.0.1", () => { const p = (t.address() as { port: number }).port; t.close(() => ok(p)); }); });
const origin = `http://127.0.0.1:${port}`;
const env: Record<string, string> = {
  PUBLIC_URL: origin, DB_PATH: join(dir, "account.sqlite"), BACKUP_DIR: join(dir, "b"), YTAPI_INTERNAL_URL: "http://127.0.0.1:9",
  BETTER_AUTH_SECRET_FILE: w("auth", randomBytes(32).toString("hex")), INTERNAL_TOKEN_FILE: w("internal", randomBytes(32).toString("hex")),
  CLOUD: "on", CLOUD_S3_ENDPOINT: gw.endpoint, CLOUD_S3_ALLOW_HTTP: "1", CLOUD_S3_REGION: "us-east-1", CLOUD_S3_BUCKET: bucket, CLOUD_S3_PATH_STYLE: "1",
  CLOUD_S3_ACCESS_KEY_ID_FILE: w("id", accessKeyId), CLOUD_S3_SECRET_ACCESS_KEY_FILE: w("secret", secretAccessKey),
  CLOUD_GET_URL_TTL_S: process.env.PILE_GET_TTL_S ?? "60", ADMIN_EMAILS: "admin@pile.test", DESKTOP_CONNEXION: "1", LOG_LEVEL: "error",
};
const s = await buildServer(loadConfig(env as NodeJS.ProcessEnv));
const ctx = await s.auth.$context;

async function session(email: string, admin: boolean): Promise<string> {
  let user = (await ctx.internalAdapter.findUserByEmail(email))?.user;
  if (!user) user = await ctx.internalAdapter.createUser({ email, name: email.split("@")[0]!, emailVerified: true }, { method: "admin" } as never);
  s.db.prepare('UPDATE "user" SET role = ?, status = \'active\' WHERE id = ?').run(admin ? "admin" : "user", user.id);
  const sess = await ctx.internalAdapter.createSession(user.id);
  const sig = createHmac("sha256", ctx.secret).update(sess.token).digest("base64");
  return `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${sess.token}.${sig}`)}`;
}
const admin = await session("admin@pile.test", true);
const lina = await session("lina@pile.test", false);

// ---- Serveur « nginx » : API vers account, fichiers du site, coque pour les routes de l'application -------------------
const api = getRequestListener(s.publicApp.fetch);
const entetes = (fichier: string) => {
  const t = readFileSync(resolve(ici, "../../web/nginx", fichier), "utf8");
  return Object.fromEntries([...t.matchAll(/^add_header ([\w-]+) "([^"]*)" always;/gm)].filter((m) => m[1] !== "X-Robots-Tag").map((m) => [m[1]!, m[2]!.replace(/https:\/\/\*\.backblazeb2\.com/g, gw.endpoint)]));
};
const SECU = entetes("security-headers.conf");
const SECU_CLOUD = entetes("security-headers-cloud.conf");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain" };
function statique(req: IncomingMessage, res: ServerResponse) {
  const chemin = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const candidat = (p: string) => { const f = join(DIST, p); return f.startsWith(DIST) && existsSync(f) && statSync(f).isFile() ? f : null; };
  const f = chemin === "/" ? candidat("index.html") : candidat(chemin) ?? candidat(join(chemin, "index.html")) ?? candidat("app.html");
  const h = chemin === "/dashboard/cloud" ? SECU_CLOUD : SECU;
  res.writeHead(200, { ...h, "Content-Type": TYPES[extname(f!)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(readFileSync(f!));
}
const http = createHttpServer((req, res) => {
  if ((req.url ?? "").startsWith("/api/")) { req.headers["x-real-ip"] = "127.0.0.1"; return void api(req, res); }
  statique(req, res);
});
await new Promise<void>((ok) => http.listen(port, "127.0.0.1", ok));

// ---- Contenu réel du Cloud de l'administrateur (envois par URL présignée, vérification par HEAD) -----------------------
const appel = async (chemin: string, init: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const r = await fetch(origin + chemin, { method: init.method ?? "GET", headers: { cookie: init.cookie ?? admin, ...(init.method && init.method !== "GET" ? { origin, "content-type": "application/json" } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
async function envoyer(nom: string, type: string, octets: Buffer) {
  const md5 = createHash("md5").update(octets).digest("base64"), sha256 = createHash("sha256").update(octets).digest("hex");
  const r = await appel("/api/cloud/envois", { method: "POST", body: { nom, type, taille: octets.length, sha256, md5 } });
  if (r.status !== 201) throw new Error(`réservation ${nom} : ${r.status} ${JSON.stringify(r.body)}`);
  const h = { ...r.body.envoi.entetes }; delete h["content-length"];
  const put = await fetch(r.body.envoi.url, { method: "PUT", headers: h, body: octets });
  if (put.status !== 200) throw new Error(`PUT ${nom} : ${put.status}`);
  const c = await appel(`/api/cloud/envois/${r.body.objet.id}/confirmer`, { method: "POST", body: {} });
  return c.body.objet as { id: string; statut: string };
}
const clip = readFileSync(resolve(ici, "../../desktop/e2e/fixtures/coucher-apercu.mp4"));
const objets: Record<string, string> = {};
objets.clip = (await envoyer("Coucher de soleil sur la côte.mp4", "video/mp4", clip)).id;
objets.audio = (await envoyer("Nappe sonore — côte.mp3", "audio/mpeg", randomBytes(180_000))).id;
objets.rushes = (await envoyer("Plan large — rushes 02.mov", "video/quicktime", randomBytes(420_000))).id;
// Un fichier expiré (30 jours écoulés : toutes ses versions supprimées par la tâche d'expiration) et un envoi abandonné.
const vieux = await envoyer("Teaser d'été.mp4", "video/mp4", randomBytes(90_000));
s.db.prepare("UPDATE ytc_cloud_objet SET expire_le = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), vieux.id);
await s.cloud!.tache();
objets.expire = vieux.id;
const abandon = await appel("/api/cloud/envois", { method: "POST", body: { nom: "Interview — partie 3.mp4", type: "video/mp4", taille: 812_000, sha256: "a".repeat(64), md5: "A".repeat(22) + "==" } });
await appel(`/api/cloud/envois/${abandon.body.objet.id}/annuler`, { method: "POST", body: {} });
objets.echec = abandon.body.objet.id;
const statuts = (s.db.prepare("SELECT statut, count(*) AS n FROM ytc_cloud_objet GROUP BY statut").all() as { statut: string; n: number }[]).map((r) => `${r.statut}:${r.n}`).join(" ");

writeFileSync(SORTIE, JSON.stringify({ url: origin, s3: gw.endpoint, admin, lina, objets, sha: { clip: createHash("sha256").update(clip).digest("hex") } }), { mode: 0o600 });
console.log(`pile prête : ${origin} (S3 local ${gw.endpoint}) ; objets ${statuts}`);

const fin = async () => { http.close(); s.close(); s3.destroy(); await gw.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); };
process.on("SIGTERM", () => void fin());
process.on("SIGINT", () => void fin());
