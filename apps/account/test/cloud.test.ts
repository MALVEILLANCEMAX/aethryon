// AETHRYON Cloud V1 : essais du cœur serveur (réservation, envoi, vérification, expiration, suppression définitive,
// panne du fournisseur, réconciliation, droits). Deux bancs, mêmes essais :
// - S3 LOCAL (CLOUD_TEST_MOTO_URL=http://127.0.0.1:<port> : moto en mode serveur derrière test/s3-local.ts, qui vérifie
//   signatures, échéances et MD5) : vraies requêtes HTTP du SDK AWS, vrais envois par URL présignée ;
// - sinon, faux stockage en mémoire (test/fake-cloud.ts) avec le même contrat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { request } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CreateBucketCommand, DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CLOUD_ROUTES } from "../src/cloud/routes.ts";
import { S3CloudStore, type CloudStore, type EnvoiSigne } from "../src/cloud/stockage.ts";
import { loadCloud } from "../src/config.ts";
import { FakeCloudStore } from "./fake-cloud.ts";
import { s3Local, type S3Local } from "./s3-local.ts";
import { Browser, harness, internalCall, newUser, type Harness } from "./helpers.ts";

const MOTO = process.env.CLOUD_TEST_MOTO_URL ?? "";
const JOUR = 86_400_000;
const md5 = (b: Buffer) => createHash("md5").update(b).digest("base64");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const octets = (n: number, graine = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + graine) % 251));

/** Banc : stockage (S3 local ou mémoire), client HTTP de l'envoyeur, outils d'inspection et de panne. */
interface Banc {
  nom: string;
  store: CloudStore;
  env: Record<string, string>;
  put(e: EnvoiSigne, body: Buffer, entetes?: Record<string, string>): Promise<number>;
  putInterrompu(e: EnvoiSigne, body: Buffer): Promise<void>;
  get(url: string): Promise<{ status: number; body?: Buffer; disposition?: string | null }>;
  masquer(cle: string): Promise<void>;
  deposer(cle: string, body: Buffer): Promise<void>;
  nbVersions(cle: string): Promise<number>;
  panne(v: boolean): void;
  close(): Promise<void>;
}

async function banc(dir: string): Promise<Banc> {
  const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
  const accessKeyId = `essai${randomBytes(6).toString("hex")}`;
  const secretAccessKey = randomBytes(24).toString("base64url");
  const bucket = `aethryon-essai-${randomBytes(4).toString("hex")}`;
  const env: Record<string, string> = {
    CLOUD: "on", CLOUD_S3_REGION: "us-east-1", CLOUD_S3_BUCKET: bucket, CLOUD_S3_PATH_STYLE: "1", CLOUD_S3_ALLOW_HTTP: "1",
    CLOUD_S3_ACCESS_KEY_ID_FILE: w("cloud_id", accessKeyId), CLOUD_S3_SECRET_ACCESS_KEY_FILE: w("cloud_secret", secretAccessKey),
    CLOUD_QUOTA_BYTES: "1000", CLOUD_GLOBAL_QUOTA_BYTES: "1800", CLOUD_MAX_FILE_BYTES: "600", ADMIN_EMAILS: "admin@example.test,admin2@example.test",
  };
  if (!MOTO) {
    const f = new FakeCloudStore();
    env.CLOUD_S3_ENDPOINT = "https://s3.fake.example.test";
    return {
      nom: "mémoire", store: f, env,
      put: async (e, body, h) => f.put(e.url, body, { ...e.entetes, ...(h ?? {}) }),
      putInterrompu: async () => {},
      get: async (url) => f.get(url),
      masquer: async (cle) => f.masquer(cle),
      deposer: async (cle, body) => f.ajouter(cle, body),
      nbVersions: async (cle) => (f.objets.get(cle) ?? []).length,
      panne: (v) => { f.panne = v; },
      close: async () => {},
    };
  }
  const gw: S3Local = await s3Local(MOTO, { accessKeyId, secretAccessKey });
  env.CLOUD_S3_ENDPOINT = gw.endpoint;
  const admin = new S3Client({ endpoint: gw.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 1 });
  await admin.send(new CreateBucketCommand({ Bucket: bucket }));
  await admin.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
  const store = new S3CloudStore(loadCloud(env)!);
  return {
    nom: "S3 local (moto + passerelle de vérification)", store, env,
    put: async (e, body, h) => {
      const headers = { ...e.entetes, ...(h ?? {}) };
      delete (headers as Record<string, string>)["content-length"];
      try { return (await fetch(e.url, { method: "PUT", body, headers })).status; } catch { return 0; }
    },
    // Coupure en plein envoi : la moitié des octets annoncés, puis la connexion est fermée.
    putInterrompu: (e, body) => new Promise<void>((ok) => {
      const u = new URL(e.url);
      const r = request({ host: u.hostname, port: u.port, method: "PUT", path: u.pathname + u.search, headers: e.entetes });
      r.on("error", () => ok());
      r.write(body.subarray(0, Math.floor(body.length / 2)), () => setTimeout(() => { r.destroy(); ok(); }, 50));
    }),
    get: async (url) => {
      const r = await fetch(url);
      return { status: r.status, body: Buffer.from(await r.arrayBuffer()), disposition: r.headers.get("content-disposition") };
    },
    masquer: async (cle) => { await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: cle })); },
    deposer: async (cle, body) => { await admin.send(new PutObjectCommand({ Bucket: bucket, Key: cle, Body: body, ContentType: "video/mp4" })); },
    nbVersions: async (cle) => (await store.versions(cle)).length,
    panne: (v) => { gw.panne.value = v; },
    close: async () => { admin.destroy(); await gw.close(); },
  };
}

interface Ctx { h: Harness; b: Banc; admin: Browser; adminId: string; horloge: { decalage: number }; dir: string }

async function contexte(extra: Record<string, string> = {}): Promise<Ctx> {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "ytc2-cloud-"));
  const b = await banc(dir);
  const horloge = { decalage: 0 };
  const h = await harness({ ...b.env, ...extra }, { cloudStore: b.store, cloudNow: () => Date.now() + horloge.decalage });
  const admin = await newUser(h, "admin@example.test");
  const adminId = (await admin.json("/api/me")).body.user.id as string;
  assert.equal((await admin.json("/api/me")).body.user.role, "admin");
  return { h, b, admin, adminId, horloge, dir };
}

const fin = async (c: Ctx) => { c.h.close(); await c.b.close(); (await import("node:fs")).rmSync(c.dir, { recursive: true, force: true }); };

/** Annonce d'un fichier pour une réservation (nom, type, taille, empreintes). */
const annonce = (body: Buffer, nom = "Clip été.mp4", type = "video/mp4") => ({ nom, type, taille: body.length, sha256: sha(body), md5: md5(body) });

/** Parcours complet du Desktop : réservation, envoi direct, confirmation. */
async function envoyer(c: Ctx, body: Buffer, nom = "Clip été.mp4", type = "video/mp4") {
  const r = await c.admin.json("/api/cloud/envois", { method: "POST", body: { ...annonce(body, nom, type), origine: "desktop" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await c.b.put(r.body.envoi, body), 200);
  const conf = await c.admin.json(`/api/cloud/envois/${r.body.objet.id}/confirmer`, { method: "POST" });
  assert.equal(conf.status, 200);
  return conf.body.objet as { id: string; statut: string; expireLe: string; envoyeLe: string; expireDansJours: number };
}

const cleDe = (c: Ctx, id: string) => (c.h.s.db.prepare("SELECT cle FROM ytc_cloud_objet WHERE id = ?").get(id) as { cle: string }).cle;
const statutDe = (c: Ctx, id: string) => ({ ...(c.h.s.db.prepare("SELECT statut, derniere_erreur FROM ytc_cloud_objet WHERE id = ?").get(id) as { statut: string; derniere_erreur: string | null }) });

// ---- essais -------------------------------------------------------------------------------------------------------

test(`cloud coupé par défaut : 404 cloud_closed pour tous, offre interne refusée (banc ${MOTO ? "S3 local" : "mémoire"})`, async () => {
  const h = await harness({ ADMIN_EMAILS: "admin@example.test" });
  try {
    const a = await newUser(h, "admin@example.test");
    for (const [m, p] of CLOUD_ROUTES) {
      const r = await a.json(p.replace(":id", "x"), { method: m, ...(m === "GET" ? {} : { body: {} }) });
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.equal(r.body.error, "cloud_closed");
    }
    const o = await internalCall(h, "/internal/v1/cloud/offre", { user_id: "x", job_id: "j1" });
    assert.deepEqual(o.body, { sauvegarder: false, raison: "cloud_coupe" });
  } finally { h.close(); }
});

test("non-administrateur refusé partout (session, clé d'extension, appel direct) ; propriétaire contrôlé sur chaque objet", async () => {
  const c = await contexte();
  try {
    const obj = await envoyer(c, octets(100));
    const user = await newUser(c.h, "lina@example.test");
    const uid = (await user.json("/api/me")).body.user.id as string;
    const anonyme = new Browser(c.h);
    const ext = await c.h.s.keys.createExtensionKey(uid, "Essai", () => true);
    let refus = 0;
    for (const [m, p] of CLOUD_ROUTES) {
      const path = p.replace(":id", obj.id);
      const init = { method: m, ...(m === "GET" ? {} : { body: { usage: "telecharger", sauvegardeAuto: true, ...annonce(octets(10)) } }) };
      assert.equal((await user.json(path, init)).status, 403, `session ${m} ${p}`);
      assert.equal((await anonyme.json(path, init)).status, 401, `anonyme ${m} ${p}`);
      const r = await c.h.s.publicApp.request(path, { method: m, headers: { authorization: `Bearer ${ext!.secret}`, "content-type": "application/json" }, ...(m === "GET" ? {} : { body: "{}" }) });
      assert.equal(r.status, 403, `clé d'extension ${m} ${p}`);
      refus += 3;
    }
    // Rien n'a bougé pour l'objet de l'administrateur, et aucun lien n'a été signé.
    assert.equal(statutDe(c, obj.id).statut, "sauvegarde");
    // Offre interne d'ytapi pour un non-administrateur : refusée, aucune ligne.
    const o = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: uid, job_id: "job1", ...annonce(octets(10), "a.mp3", "audio/mpeg") });
    assert.deepEqual(o.body, { sauvegarder: false, raison: "non_admin" });
    assert.equal((c.h.s.db.prepare("SELECT count(*) n FROM ytc_cloud_objet WHERE owner_id = ?").get(uid) as { n: number }).n, 0);
    // Deuxième administrateur : l'objet du premier lui est invisible (404, comme un identifiant inconnu).
    const a2 = await newUser(c.h, "admin2@example.test");
    for (const p of [`/api/cloud/objets/${obj.id}`]) assert.equal((await a2.json(p)).status, 404);
    for (const p of [`/api/cloud/objets/${obj.id}/lien`, `/api/cloud/objets/${obj.id}/supprimer`, `/api/cloud/envois/${obj.id}/confirmer`]) assert.equal((await a2.json(p, { method: "POST", body: {} })).status, 404, p);
    assert.equal((await a2.json("/api/cloud/objets")).body.total, 0);
    // Clé d'extension de l'administrateur : acceptée (sans session), origine web refusée.
    const extA = await c.h.s.keys.createExtensionKey(c.adminId, "Essai", () => true);
    const okExt = await c.h.s.publicApp.request("/api/cloud/etat", { headers: { authorization: `Bearer ${extA!.secret}` } });
    assert.equal(okExt.status, 200);
    const web = await c.h.s.publicApp.request("/api/cloud/etat", { headers: { authorization: `Bearer ${extA!.secret}`, origin: "https://evil.example" } });
    assert.equal(web.status, 403);
    assert.ok(refus >= 33);
  } finally { await fin(c); }
});

test("envoi réussi par ytapi (offre → URL présignée → PUT → termine) : « Sauvegardé » seulement après HEAD, expiration à 30 jours", async () => {
  const c = await contexte();
  try {
    const body = octets(400, 7);
    const offre = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "job-ok", plateforme: "youtube", ...annonce(body, "Musique.mp3", "audio/mpeg") });
    assert.equal(offre.body.sauvegarder, true, JSON.stringify(offre.body));
    const id = offre.body.objet.id as string;
    assert.equal(offre.body.objet.statut, "envoi_en_cours");
    assert.equal(offre.body.objet.libelle, "Upload cloud en cours");
    // Avant l'envoi réel, « termine ok » ne peut pas faire croire à une sauvegarde : HEAD → absent → Échec.
    // (essai séparé plus bas) — ici, l'envoi a lieu :
    assert.equal(await c.b.put(offre.body.envoi, body), 200);
    assert.equal(statutDe(c, id).statut, "envoi_en_cours", "jamais « Sauvegardé » avant la vérification");
    const t = await internalCall(c.h, `/internal/v1/cloud/objets/${id}/termine`, { user_id: c.adminId, ok: true });
    assert.equal(t.body.statut, "sauvegarde");
    const row = c.h.s.db.prepare("SELECT envoye_le, expire_le, cle, nom_original FROM ytc_cloud_objet WHERE id = ?").get(id) as { envoye_le: string; expire_le: string; cle: string; nom_original: string };
    assert.equal(Date.parse(row.expire_le) - Date.parse(row.envoye_le), 30 * JOUR);
    assert.ok(!row.cle.includes("Musique") && /^aethryon-cloud\/v1\/[0-9a-f]{16}\/[A-Za-z0-9_-]{22}$/.test(row.cle), "clé générée par le serveur");
    const liste = await c.admin.json("/api/cloud/objets");
    assert.equal(liste.body.total, 1);
    assert.equal(liste.body.items[0].expireDansJours, 30);
    assert.equal(liste.body.quota.utilise, 400);
    // Lien temporaire : les octets reviennent à l'identique, en pièce jointe sous le nom d'origine.
    const lien = await c.admin.json(`/api/cloud/objets/${id}/lien`, { method: "POST", body: { usage: "telecharger" } });
    assert.equal(lien.status, 200);
    const g = await c.b.get(lien.body.url);
    assert.equal(g.status, 200);
    assert.ok(g.body!.equals(body));
    assert.match(String(g.disposition), /^attachment;.*filename\*=UTF-8''Musique\.mp3/);
    const ap = await c.admin.json(`/api/cloud/objets/${id}/lien`, { method: "POST", body: { usage: "apercu" } });
    assert.equal(ap.status, 200);
    assert.match(String((await c.b.get(ap.body.url)).disposition), /^inline;/);
    // Rejouer l'offre du même job : pas de doublon.
    const deux = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "job-ok", ...annonce(body, "Musique.mp3", "audio/mpeg") });
    assert.deepEqual(deux.body, { sauvegarder: false, raison: "deja_envoye" });
  } finally { await fin(c); }
});

test("envoi interrompu, envoi jamais confirmé, autre fichier sur la même URL : rien n'est déclaré sauvegardé, la place est rendue", async () => {
  const c = await contexte();
  try {
    const body = octets(300, 3);
    // 1. Coupure en plein envoi puis confirmation : HEAD → absent → Échec (objet_absent).
    const r1 = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(body) });
    await c.b.putInterrompu(r1.body.envoi, body);
    const conf = await c.admin.json(`/api/cloud/envois/${r1.body.objet.id}/confirmer`, { method: "POST" });
    assert.equal(conf.body.objet.statut, "echec");
    assert.equal(conf.body.objet.erreur, "objet_absent");
    assert.equal(conf.body.quota.utilise, 0);
    // 2. Un AUTRE fichier (même taille) sur l'URL signée : refusé par le fournisseur (MD5 signé).
    const r2 = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(body) });
    const autre = octets(300, 9);
    const st = await c.b.put(r2.body.envoi, autre, { "content-md5": md5(autre) });
    assert.ok(st === 403 || st === 400, `refusé : ${st}`);
    // 3. Réservation jamais confirmée : à l'échéance, la tâche vérifie puis rend la place (envoi_abandonne).
    c.horloge.decalage = 2 * 3_600_000;
    const t = await c.h.s.cloud!.tache();
    assert.ok(t.abandons >= 1);
    assert.deepEqual(statutDe(c, r2.body.objet.id), { statut: "echec", derniere_erreur: "envoi_abandonne" });
    assert.equal((await c.admin.json("/api/cloud/etat")).body.quota.utilise, 0);
    // 4. Envoi complet mais jamais confirmé (confirmation perdue) : à l'échéance il est vérifié et GARDÉ.
    c.horloge.decalage = 0;
    const r3 = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(body) });
    assert.equal(await c.b.put(r3.body.envoi, body), 200);
    c.horloge.decalage = 2 * 3_600_000;
    await c.h.s.cloud!.tache();
    assert.equal(statutDe(c, r3.body.objet.id).statut, "sauvegarde");
    // 5. ytapi annonce un échec définitif : Échec, place rendue.
    c.horloge.decalage = 0;
    const o = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "job-ko", ...annonce(octets(50), "x.mp4") });
    const fin5 = await internalCall(c.h, `/internal/v1/cloud/objets/${o.body.objet.id}/termine`, { user_id: c.adminId, ok: false, erreur: "envoi_impossible" });
    assert.equal(fin5.body.statut, "echec");
  } finally { await fin(c); }
});

test("fichier trop volumineux, type refusé, nom dangereux : refus propres, aucune réservation", async () => {
  const c = await contexte();
  try {
    const gros = await c.admin.json("/api/cloud/envois", { method: "POST", body: { ...annonce(octets(10)), taille: 601 } });
    assert.equal(gros.status, 413);
    assert.equal(gros.body.error, "fichier_trop_volumineux");
    const exe = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(octets(10), "outil.exe", "application/octet-stream") });
    assert.equal(exe.status, 415);
    const faux = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(octets(10), "a.mp4", "text/html") });
    assert.equal(faux.status, 415);
    const sansHash = await c.admin.json("/api/cloud/envois", { method: "POST", body: { ...annonce(octets(10)), sha256: "zz" } });
    assert.equal(sansHash.status, 400);
    assert.equal((c.h.s.db.prepare("SELECT count(*) n FROM ytc_cloud_objet").get() as { n: number }).n, 0);
    const chemin = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(octets(10), "../../etc/passwd‮.mp4") });
    assert.equal(chemin.status, 201);
    assert.equal(chemin.body.objet.nom, ".._.._etc_passwd.mp4");
    assert.ok(!cleDe(c, chemin.body.objet.id).includes(".."));
    // Offre ytapi trop volumineuse : refus noté (Échec visible), téléchargement initial non concerné.
    const o = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "job-gros", ...annonce(octets(10), "gros.mp4"), taille: 700 });
    assert.deepEqual(o.body, { sauvegarder: false, raison: "fichier_trop_volumineux" });
  } finally { await fin(c); }
});

test("quota atteint : refus clair (409), aucun fichier non expiré supprimé ; offre ytapi → « Échec de sauvegarde » quota_atteint", async () => {
  const c = await contexte();
  try {
    const a = await envoyer(c, octets(500, 1), "a.mp4");
    const b = await envoyer(c, octets(400, 2), "b.mp4");
    const r = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(octets(200, 3), "c.mp4") });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "quota_atteint");
    assert.match(r.body.message, /Supprime des fichiers/);
    assert.equal(statutDe(c, a.id).statut, "sauvegarde");
    assert.equal(statutDe(c, b.id).statut, "sauvegarde");
    const o = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "job-q", ...annonce(octets(200, 4), "d.mp3", "audio/mpeg") });
    assert.deepEqual(o.body, { sauvegarder: false, raison: "quota_atteint" });
    const echecs = await c.admin.json("/api/cloud/objets?statut=echec");
    assert.equal(echecs.body.items[0].erreur, "quota_atteint");
    assert.equal(echecs.body.items[0].libelle, "Échec de sauvegarde");
    // Suppression manuelle proposée : la place revient.
    const s = await c.admin.json(`/api/cloud/objets/${a.id}/supprimer`, { method: "POST" });
    assert.equal(s.body.objet.statut, "supprime");
    assert.equal(s.body.quota.utilise, 400);
    assert.equal((await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(octets(200, 3), "c.mp4") })).status, 201);
  } finally { await fin(c); }
});

test("envois concurrents : la réservation atomique n'accepte jamais plus que le quota (compte puis seau entier)", async () => {
  const c = await contexte();
  try {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(octets(300, i), `p${i}.mp4`) })));
    const ok = rs.filter((r) => r.status === 201).length;
    const quota = rs.filter((r) => r.status === 409).length;
    assert.equal(ok, 3, "3 × 300 ≤ 1000 < 4 × 300");
    assert.equal(ok + quota, 20);
    assert.equal((await c.admin.json("/api/cloud/etat")).body.quota.utilise, 900);
    const a2 = await newUser(c.h, "admin2@example.test");
    // Plafond du seau entier (1800) avec un deuxième administrateur : 900 + 3 × 250 = 1650 ; la quatrième (1900) est
    // refusée par le plafond global alors que son propre quota (1000) la permettrait.
    const r2 = await Promise.all(Array.from({ length: 6 }, (_, i) => a2.json("/api/cloud/envois", { method: "POST", body: annonce(octets(250, 40 + i), `q${i}.mp4`) })));
    assert.equal(r2.filter((r) => r.status === 201).length, 3);
    assert.ok(r2.filter((r) => r.status !== 201).every((r) => r.body.error === "quota_global_atteint"));
    const total = (c.h.s.db.prepare("SELECT sum(taille) n FROM ytc_cloud_objet WHERE statut IN ('en_attente','envoi_en_cours','sauvegarde','suppression_en_attente')").get() as { n: number }).n;
    assert.equal(total, 1650);
  } finally { await fin(c); }
});

test("URL signée expirée : envoi refusé par le fournisseur ; lien de lecture expiré refusé", async () => {
  const c = await contexte({ CLOUD_PUT_URL_TTL_S: "1", CLOUD_GET_URL_TTL_S: "1" });
  try {
    const body = octets(120, 5);
    const r = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(body) });
    await new Promise((ok) => setTimeout(ok, 2_200));
    assert.equal(await c.b.put(r.body.envoi, body), 403);
    // Signature falsifiée : refusée elle aussi.
    const faux = new URL(r.body.envoi.url);
    if (faux.searchParams.has("X-Amz-Signature")) faux.searchParams.set("X-Amz-Signature", "0".repeat(64)); else faux.searchParams.set("jeton", "0");
    assert.equal(await c.b.put({ ...r.body.envoi, url: faux.href }, body), 403);
    // Reprise : une nouvelle URL (même réservation) passe.
    const n = await c.admin.json(`/api/cloud/envois/${r.body.objet.id}/url`, { method: "POST" });
    assert.equal(await c.b.put(n.body.envoi, body), 200);
    assert.equal((await c.admin.json(`/api/cloud/envois/${r.body.objet.id}/confirmer`, { method: "POST" })).body.objet.statut, "sauvegarde");
    const lien = await c.admin.json(`/api/cloud/objets/${r.body.objet.id}/lien`, { method: "POST", body: {} });
    assert.equal((await c.b.get(lien.body.url)).status, 200);
    await new Promise((ok) => setTimeout(ok, 2_200));
    assert.equal((await c.b.get(lien.body.url)).status, 403);
  } finally { await fin(c); }
});

test("fichier expiré : à 30 jours l'accès est révoqué, TOUTES les versions supprimées et vérifiées, quota libéré", async () => {
  const c = await contexte();
  try {
    const o = await envoyer(c, octets(200, 8));
    const cle = cleDe(c, o.id);
    // Une deuxième version et un marqueur de masquage (« hide marker ») : ils doivent disparaître aussi.
    await c.b.deposer(cle, octets(200, 8));
    await c.b.masquer(cle);
    assert.equal(await c.b.nbVersions(cle), 3);
    c.horloge.decalage = 29 * JOUR;
    assert.equal((await c.h.s.cloud!.tache()).expires, 0, "pas avant l'échéance");
    c.horloge.decalage = 30 * JOUR + 1000;
    const t = await c.h.s.cloud!.tache();
    assert.equal(t.expires, 1);
    assert.equal(t.purges, 1);
    assert.equal(statutDe(c, o.id).statut, "expire");
    assert.equal(await c.b.nbVersions(cle), 0, "aucune version ni marqueur restant");
    const l = await c.admin.json(`/api/cloud/objets/${o.id}/lien`, { method: "POST", body: {} });
    assert.equal(l.status, 410);
    assert.equal((await c.admin.json("/api/cloud/etat")).body.quota.utilise, 0);
    assert.equal((c.h.s.db.prepare("SELECT count(*) n FROM ytc_cloud_journal WHERE objet_id = ? AND action = 'expiration' AND resultat = 'ok'").get(o.id) as { n: number }).n, 1);
  } finally { await fin(c); }
});

test("suppression définitive manuelle : aucune version restante (marqueurs compris), statut « Supprimé »", async () => {
  const c = await contexte();
  try {
    const o = await envoyer(c, octets(150, 4));
    const cle = cleDe(c, o.id);
    await c.b.masquer(cle); // un DeleteObject sans VersionId ne fait que masquer : les octets restent facturés
    assert.equal(await c.b.nbVersions(cle), 2);
    const s = await c.admin.json(`/api/cloud/objets/${o.id}/supprimer`, { method: "POST" });
    assert.equal(s.body.objet.statut, "supprime");
    assert.equal(await c.b.nbVersions(cle), 0);
    assert.equal((await c.admin.json(`/api/cloud/objets/${o.id}`)).status, 404);
  } finally { await fin(c); }
});

test("panne temporaire du fournisseur : « En attente », nouvelle tentative programmée, puis reprise réussie", async () => {
  const c = await contexte();
  try {
    const body = octets(220, 6);
    const r = await c.admin.json("/api/cloud/envois", { method: "POST", body: annonce(body) });
    assert.equal(await c.b.put(r.body.envoi, body), 200);
    c.b.panne(true);
    const conf = await c.admin.json(`/api/cloud/envois/${r.body.objet.id}/confirmer`, { method: "POST" });
    assert.equal(conf.body.objet.statut, "en_attente");
    assert.equal(conf.body.objet.libelle, "En attente de sauvegarde cloud");
    assert.equal(conf.body.quota.utilise, 220, "la place reste réservée");
    // Suppression pendant la panne : reprise programmée, journalisée.
    const o2 = await (async () => { c.b.panne(false); const x = await envoyer(c, octets(100, 1), "z.mp4"); c.b.panne(true); return x; })();
    const s = await c.admin.json(`/api/cloud/objets/${o2.id}/supprimer`, { method: "POST" });
    assert.equal(s.body.objet.statut, "suppression_en_attente");
    assert.equal((c.h.s.db.prepare("SELECT count(*) n FROM ytc_cloud_journal WHERE objet_id = ? AND resultat = 'echec'").get(o2.id) as { n: number }).n, 1);
    // Une tâche pendant la panne ne change rien ; la tentative suivante (après le délai) réussit.
    c.horloge.decalage = 2 * 60_000;
    await c.h.s.cloud!.tache();
    assert.equal(statutDe(c, r.body.objet.id).statut, "en_attente");
    c.b.panne(false);
    c.horloge.decalage = 20 * 60_000;
    await c.h.s.cloud!.tache();
    assert.equal(statutDe(c, r.body.objet.id).statut, "sauvegarde");
    assert.equal(statutDe(c, o2.id).statut, "supprime");
    assert.equal(await c.b.nbVersions(cleDe(c, o2.id)), 0);
  } finally { await fin(c); }
});

test("réconciliation du quota : orphelins supprimés, anciennes versions retirées, objet disparu signalé, écart compté", async () => {
  const c = await contexte({ CLOUD_ORPHAN_GRACE_S: "3600" });
  try {
    const garde = await envoyer(c, octets(200, 2), "garde.mp4");
    const perdu = await envoyer(c, octets(100, 3), "perdu.mp4");
    // Orphelin (aucune ligne), ancienne version d'un objet gardé, objet gardé disparu chez le fournisseur.
    const orphelin = "aethryon-cloud/v1/0000000000000000/orphelinAAAAAAAAAAAAAA";
    await c.b.deposer(orphelin, octets(300, 4));
    await c.b.deposer(cleDe(c, garde.id), octets(200, 2));
    await c.b.store.supprimerToutesVersions(cleDe(c, perdu.id));
    // Juste après : l'orphelin est récent (délai de grâce), il est compté dans l'écart du plafond global.
    const m1 = await c.h.s.cloud!.reconcilier();
    assert.equal(m1.orphelins, 0);
    assert.equal(m1.absents, 1);
    assert.equal(statutDe(c, perdu.id).derniere_erreur, "objet_absent");
    assert.equal(m1.octetsReels, 200 + 200 + 300);
    assert.equal(m1.ecart, 700 - 200);
    assert.equal((await c.admin.json("/api/cloud/etat")).body.quota.global.ecart, 500);
    // Plus tard : orphelin supprimé, version en trop retirée, l'écart retombe à zéro.
    c.horloge.decalage = 2 * 3_600_000;
    const m2 = await c.h.s.cloud!.reconcilier();
    assert.equal(m2.orphelins, 1);
    assert.equal(m2.anciennes, 1);
    assert.equal(m2.octetsReels, 200);
    assert.equal(m2.ecart, 0);
    assert.equal(await c.b.nbVersions(orphelin), 0);
    assert.equal(await c.b.nbVersions(cleDe(c, garde.id)), 1);
    assert.equal(statutDe(c, garde.id).statut, "sauvegarde", "jamais de suppression d'un fichier non expiré");
  } finally { await fin(c); }
});

test("limitation de débit, réglages, recherche et filtres ; journal sans secret ni nom de fichier", async () => {
  const c = await contexte();
  try {
    await envoyer(c, octets(100, 1), "Concert été.mp4");
    const o = await envoyer(c, octets(90, 2), "podcast.mp3", "audio/mpeg");
    assert.equal((await c.admin.json("/api/cloud/objets?q=été")).body.total, 1);
    assert.equal((await c.admin.json("/api/cloud/objets?q=%25")).body.total, 0, "% littéral");
    assert.equal((await c.admin.json("/api/cloud/objets?type=audio")).body.items[0].id, o.id);
    assert.equal((await c.admin.json("/api/cloud/objets?tri=inconnu")).status, 400);
    assert.equal((await c.admin.json("/api/cloud/reglages", { method: "PUT", body: { sauvegardeAuto: false } })).status, 200);
    const off = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "j9", ...annonce(octets(10), "x.mp4") });
    assert.deepEqual(off.body, { sauvegarder: false, raison: "sauvegarde_auto_coupee" });
    let limite = 0;
    for (let i = 0; i < 125; i++) if ((await c.admin.json(`/api/cloud/objets/${o.id}/lien`, { method: "POST", body: {} })).status === 429) limite++;
    assert.equal(limite, 5, "120 liens par heure");
    const journal = c.h.logs.join("\n");
    assert.ok(!/X-Amz-Signature|X-Amz-Credential|Concert|podcast/.test(journal), "aucune URL signée ni nom de fichier");
    const { readFileSync } = await import("node:fs");
    for (const f of ["CLOUD_S3_ACCESS_KEY_ID_FILE", "CLOUD_S3_SECRET_ACCESS_KEY_FILE"]) assert.ok(!journal.includes(readFileSync(c.h.env[f]!, "utf8")), `${f} jamais journalisé`);
  } finally { await fin(c); }
});

// ---- AETHRYON Music : fiche du morceau séparée de l'audio, même quota, même expiration -------------------------

const fiche = (extra: Record<string, unknown> = {}) => ({
  connecteur: "archive", titre: "Gymnopédie n° 1", artistes: ["Erik Satie"], album: "Gymnopédies", date: "1888", isrc: null,
  licence: { code: "cc0", nom: "CC0 1.0 (domaine public)", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  attribution: "« Gymnopédie n° 1 » par Erik Satie, CC0, via Internet Archive", sourceUrl: "https://archive.org/details/gymnopedie-libre",
  pochetteUrl: "https://archive.org/services/img/gymnopedie-libre", attestation: false,
  audio: { dureeS: 185.2, codec: "mp3", debitKbps: 192, frequenceHz: 44100, canaux: 2, sansPerte: false }, ...extra,
});

test("Music : la fiche reste quand l'audio expire (audio indisponible, réimport proposé), copie servie avant", async () => {
  const c = await contexte();
  try {
    const body = octets(300, 11);
    const offre = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "mus_essai1", plateforme: "archive",
      meta: { musique: fiche() }, ...annonce(body, "Erik Satie - Gymnopédie n° 1.mp3", "audio/mpeg") });
    assert.equal(offre.body.sauvegarder, true, JSON.stringify(offre.body));
    const id = offre.body.objet.id as string;
    assert.equal(offre.body.objet.audioDisponible, false, "pas avant la vérification");
    assert.equal(await c.b.put(offre.body.envoi, body), 200);
    assert.equal((await internalCall(c.h, `/internal/v1/cloud/objets/${id}/termine`, { user_id: c.adminId, ok: true })).body.statut, "sauvegarde");
    let v = (await c.admin.json(`/api/cloud/objets/${id}`)).body.objet;
    assert.equal(v.audioDisponible, true);
    assert.equal(v.musique.titre, "Gymnopédie n° 1");
    assert.equal(v.musique.licence.code, "cc0");
    assert.equal(v.musique.audio.codec, "mp3");
    assert.equal(v.reimport, null);
    const ap = await c.admin.json(`/api/cloud/objets/${id}/lien`, { method: "POST", body: { usage: "apercu" } });
    assert.equal(ap.status, 200, "écoute sécurisée : lien signé « inline » pendant la conservation");
    assert.ok((await c.b.get(ap.body.url)).body!.equals(body));
    assert.equal((await c.admin.json("/api/cloud/objets?musique=1")).body.total, 1);
    assert.equal((await c.admin.json("/api/cloud/objets?q=Satie")).body.total, 1, "recherche dans la fiche");
    c.horloge.decalage = 30 * JOUR + 1000;
    const t = await c.h.s.cloud!.tache();
    assert.equal(t.expires, 1);
    v = (await c.admin.json(`/api/cloud/objets/${id}`)).body.objet;
    assert.equal(v.statut, "expire");
    assert.equal(v.audioDisponible, false);
    assert.equal(v.musique.titre, "Gymnopédie n° 1", "la fiche, la pochette et les métadonnées restent");
    assert.equal(v.musique.pochetteUrl, "https://archive.org/services/img/gymnopedie-libre");
    assert.deepEqual(v.reimport, { possible: true, url: "https://archive.org/details/gymnopedie-libre", connecteur: "archive", attestationRequise: false });
    assert.equal(await c.b.nbVersions(cleDe(c, id)), 0, "l'audio est réellement supprimé du stockage");
    assert.equal((await c.admin.json(`/api/cloud/objets/${id}/lien`, { method: "POST", body: {} })).status, 410);
    const bib = await c.admin.json("/api/cloud/objets?musique=1");
    assert.equal(bib.body.total, 1, "la bibliothèque musicale garde la fiche expirée");
    assert.equal((await c.admin.json("/api/cloud/objets")).body.total, 0, "la liste ordinaire ne montre que les fichiers présents");
    assert.equal((await c.admin.json("/api/cloud/etat")).body.quota.utilise, 0);
    assert.equal((await c.admin.json("/api/cloud/objets?musique=2")).status, 400);
  } finally { await fin(c); }
});

test("Music : vidéos et audio dans le MÊME quota ; fiche invalide ignorée ; non-administrateur jamais sauvegardé", async () => {
  const c = await contexte();
  try {
    const video = octets(600, 3);
    await envoyer(c, video, "Clip.mp4", "video/mp4");
    const audio = octets(500, 4);
    const refus = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: "mus_quota", plateforme: "commons",
      meta: { musique: fiche({ connecteur: "commons", sourceUrl: "https://commons.wikimedia.org/wiki/File:Chant.ogg" }) }, ...annonce(audio, "Chant.ogg", "audio/ogg") });
    assert.deepEqual(refus.body, { sauvegarder: false, raison: "quota_atteint" }, "600 + 500 > 1000 : un seul quota pour la vidéo et l'audio");
    const ligne = (await c.admin.json("/api/cloud/objets?musique=1")).body.items[0];
    assert.equal(ligne.statut, "echec");
    assert.equal(ligne.erreur, "quota_atteint");
    assert.equal(ligne.musique.titre, "Gymnopédie n° 1");
    assert.equal(ligne.reimport.url, "https://commons.wikimedia.org/wiki/File:Chant.ogg");
    assert.equal(statutDe(c, (await c.admin.json("/api/cloud/objets?type=video")).body.items[0].id).statut, "sauvegarde", "rien n'est supprimé pour faire de la place");
    // Fiches refusées (catalogue commercial, lien non https, licence inconnue) : la sauvegarde a lieu, sans fiche.
    for (const [i, m] of [fiche({ connecteur: "spotify" }), fiche({ sourceUrl: "http://archive.org/details/x" }), fiche({ licence: { code: "cc-by-nc" } }), "texte"].entries()) {
      const small = octets(10, 20 + i);
      const o = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: c.adminId, job_id: `mus_bad${i}`, meta: { musique: m }, ...annonce(small, `x${i}.mp3`, "audio/mpeg") });
      assert.equal(o.body.sauvegarder, true);
      assert.equal(o.body.objet.musique, null);
    }
    const lina = await newUser(c.h, "lina@example.test");
    const linaId = (await lina.json("/api/me")).body.user.id as string;
    const o = await internalCall(c.h, "/internal/v1/cloud/offre", { user_id: linaId, job_id: "mus_lina", meta: { musique: fiche() }, ...annonce(octets(10), "a.mp3", "audio/mpeg") });
    assert.deepEqual(o.body, { sauvegarder: false, raison: "non_admin" });
    assert.equal((c.h.s.db.prepare("SELECT count(*) n FROM ytc_cloud_objet WHERE owner_id = ?").get(linaId) as { n: number }).n, 0);
  } finally { await fin(c); }
});
