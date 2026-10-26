// Liaison d'AETHRYON Desktop au compte (desktop.ts, migration 014) : appairage par code (page d'accord, session + CSRF),
// interrogation /jeton (en attente, clé une seule fois, refus, expiration, cadence, rejeu), clé « desktop » (30 jours,
// 3 ordinateurs, aucune origine admise), /moi (administrateur, état du cloud), déconnexion, révocation dans « Mes
// jetons », AETHRYON Cloud ouvert à la clé « desktop » de l'administrateur SEULEMENT (11 routes refusées à un compte
// ordinaire, clé révoquée refusée), journaux sans secret, purge, migration 014. Base temporaire, faux stockage en mémoire.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliedVersions, migrateDown, migrateUp } from "../src/db.ts";
import { desktopClock } from "../src/desktop.ts";
import { premiereHash } from "../src/premiere.ts";
import { desktopKeyName, MAX_DESKTOP_KEYS } from "../src/keys.ts";
import { CLOUD_ROUTES } from "../src/cloud/routes.ts";
import { FakeCloudStore } from "./fake-cloud.ts";
import { Browser, harness, internalCall, newUser, ORIGIN, type Harness } from "./helpers.ts";

const ON = { DESKTOP_CONNEXION: "1" };

let offset = 0;
desktopClock.now = () => Date.now() + offset;
const wait = (s: number) => { offset += s * 1000; };
afterEach(() => { offset = 0; });

let ipN = 1;
const freshIp = () => `198.51.100.${(ipN++ % 250) + 1}`;

/** Requête « du cœur Rust » : aucun cookie, AUCUNE origine par défaut. */
async function core(h: Harness, path: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; origin?: string; token?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-real-ip": init.ip ?? freshIp(), ...(init.headers ?? {}) };
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.raw !== undefined) body = init.raw;
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] ??= "application/json"; }
  const res = await h.s.publicApp.request(path, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as any };
}

const pair = (h: Harness, body: Record<string, unknown> = { hote: "PC-STUDIO", versionDesktop: "1.1.0-beta.1" }, init: Parameters<typeof core>[2] = {}) =>
  core(h, "/api/desktop/appairage", { body, ...init });
const poll = (h: Harness, codeAppareil: string, init: Parameters<typeof core>[2] = {}) =>
  core(h, "/api/desktop/jeton", { body: { codeAppareil }, ...init });
const site = (b: Browser, action: "demande" | "autoriser" | "refuser", codeUtilisateur: unknown, init: { origin?: string | null } = {}) =>
  b.json(`/api/desktop/${action}`, { method: "POST", body: { codeUtilisateur }, ...init });

async function connect(h: Harness, b: Browser, hote = "PC-STUDIO") {
  const p = await pair(h, { hote });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await site(b, "autoriser", p.body.codeUtilisateur)).status, 200);
  const t = await poll(h, p.body.codeAppareil);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  wait(3);
  return { ...(t.body as { cle: string; expireLe: string; compte: { email: string; nom: string } }), pairing: p.body };
}

/** Harnais avec AETHRYON Cloud activé sur un faux stockage en mémoire. */
async function cloudHarness(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ytc2-desktop-"));
  const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
  const store = new FakeCloudStore();
  const h = await harness({
    ...ON, CLOUD: "on", CLOUD_S3_ENDPOINT: "https://s3.fake.example.test", CLOUD_S3_REGION: "us-east-1", CLOUD_S3_BUCKET: "seau", CLOUD_S3_PATH_STYLE: "1",
    CLOUD_S3_ACCESS_KEY_ID_FILE: w("id", `essai${randomBytes(6).toString("hex")}`), CLOUD_S3_SECRET_ACCESS_KEY_FILE: w("secret", randomBytes(16).toString("hex")),
    CLOUD_QUOTA_BYTES: "1000", CLOUD_GLOBAL_QUOTA_BYTES: "1800", CLOUD_MAX_FILE_BYTES: "600", ADMIN_EMAILS: "admin@example.test", ...extra,
  }, { cloudStore: store });
  return { h, store, close: () => { h.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("fermée par défaut (DESKTOP_CONNEXION ≠ 1) : appairage, jeton et page d'accord en 404 « desktop_closed », rien n'est créé", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "ferme@example.test");
    assert.equal((await pair(h)).body.error, "desktop_closed");
    assert.equal((await poll(h, randomBytes(32).toString("base64url"))).body.error, "desktop_closed");
    for (const a of ["demande", "autoriser", "refuser"] as const) {
      const r = await site(b, a, "BCDF-GHJK");
      assert.deepEqual([r.status, r.body.error], [404, "desktop_closed"], a);
    }
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_desktop_code").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("parcours complet : appairage (empreinte seule) → en attente → page d'accord → clé « desktop » une seule fois → /moi (compte ordinaire : cloud indisponible) → déconnexion", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "nora@example.test", { name: "Nora Vidal" });
    const p = await pair(h);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual(Object.keys(p.body).sort(), ["codeAppareil", "codeUtilisateur", "expireDans", "intervalle", "urlVerification"]);
    assert.match(p.body.codeAppareil, /^[A-Za-z0-9_-]{43}$/);
    assert.match(p.body.codeUtilisateur, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.equal(p.body.urlVerification, `${ORIGIN}/desktop/connecter`);
    assert.deepEqual([p.body.expireDans, p.body.intervalle], [600, 3]);
    const row = h.s.db.prepare("SELECT * FROM ytc_desktop_code").get() as Record<string, string | null>;
    assert.equal(row.device_hash, premiereHash(p.body.codeAppareil));
    assert.ok(!JSON.stringify(row).includes(p.body.codeAppareil), "le code d'appareil n'est jamais stocké");
    assert.deepEqual([row.status, row.user_id, row.host, row.desktop_version], ["pending", null, "PC-STUDIO", "1.1.0-beta.1"]);

    const t1 = await poll(h, p.body.codeAppareil);
    assert.deepEqual([t1.status, t1.body.etat, t1.body.intervalle], [428, "en-attente", 3]);
    const d = await site(b, "demande", p.body.codeUtilisateur.toLowerCase().replace("-", " "));
    assert.equal(d.status, 200);
    assert.deepEqual(d.body.appareil, { hote: "PC-STUDIO", versionDesktop: "1.1.0-beta.1" });
    assert.equal((await site(b, "autoriser", p.body.codeUtilisateur)).body.etat, "autorise");

    wait(3);
    const t2 = await poll(h, p.body.codeAppareil);
    assert.equal(t2.status, 200, JSON.stringify(t2.body));
    assert.deepEqual(Object.keys(t2.body).sort(), ["cle", "compte", "expireLe"]);
    assert.match(t2.body.cle, /^ytc_[A-Za-z]{64}$/);
    assert.deepEqual(t2.body.compte, { email: "nora@example.test", nom: "Nora Vidal" });
    const days = (Date.parse(t2.body.expireLe) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `30 jours (${days})`);

    // « Mes jetons » : listée à part (type « desktop », nom de l'ordinateur), hors du plafond du raccourci.
    const listed = (await b.json("/api/keys")).body.keys as { kind: string; name: string; deviceLabel: string | null; status: string }[];
    assert.deepEqual(listed.map((k) => [k.kind, k.name, k.deviceLabel, k.status]), [["desktop", "AETHRYON Desktop · PC-STUDIO", "PC-STUDIO", "active"]]);
    assert.equal((await b.json("/api/me")).body.keys.active, 0);

    // 3.8.1 : la clé du Desktop ouvre les conversions d'ytapi, comme celle de l'extension (essai dédié plus bas).
    const y = await internalCall(h, "/internal/v1/authorize", { key: t2.body.cle, action: "access" });
    assert.deepEqual([y.body.allow, y.body.key_kind], [true, "desktop"]);
    const me = await core(h, "/api/desktop/moi", { token: t2.body.cle });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.deepEqual(me.body, { compte: { email: "nora@example.test", nom: "Nora Vidal" }, administrateur: false, cloud: { disponible: false, raison: "non_admin" }, cle: { expireLe: t2.body.expireLe } });
    // Cloud coupé sur ce serveur : 404 « cloud_closed » même avec une clé valable.
    assert.equal((await core(h, "/api/cloud/etat", { token: t2.body.cle })).body.error, "cloud_closed");

    assert.equal((await core(h, "/api/desktop/deconnexion", { method: "POST", token: t2.body.cle })).status, 204);
    assert.equal((await core(h, "/api/desktop/deconnexion", { method: "POST", token: t2.body.cle })).status, 204, "idempotente");
    const gone = await core(h, "/api/desktop/moi", { token: t2.body.cle });
    assert.deepEqual([gone.status, gone.body.error, gone.body.revokedBy], [401, "token_revoked", "user"]);

    const logs = h.logs.join("\n");
    for (const secret of [p.body.codeAppareil, p.body.codeUtilisateur, p.body.codeUtilisateur.replace("-", ""), t2.body.cle, t2.body.cle.slice(4, 20), "nora@example.test"]) {
      assert.ok(!logs.includes(secret), `absent des journaux : ${secret.slice(0, 6)}…`);
    }
    assert.ok(logs.includes("desktop key issued") && logs.includes("desktop pairing approved") && logs.includes("desktop logout"));
  } finally { h.close(); }
});

test("3.8.1 : clé « desktop » autorisée aux conversions d'ytapi, MÊMES quotas et refus que l'extension ; refusée dès que le Desktop n'est plus relié", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "lea@example.test");
    const uid = (await b.json("/api/me")).body.user.id as string;
    const { cle } = await connect(h, b);
    const ext = await h.s.keys.createExtensionKey(uid, "Chrome · Linux", () => true);
    assert.ok(ext);
    const auth = (key: string, action: "access" | "create_job", fmt = "mp4") => internalCall(h, "/internal/v1/authorize", { key, action, fmt, platform: "youtube" });
    const d0 = await auth(cle, "access"), e0 = await auth(ext.secret, "access");
    assert.deepEqual([d0.body.allow, d0.body.key_kind, e0.body.key_kind], [true, "desktop", "extension"]);
    assert.deepEqual([d0.body.limits, d0.body.remaining_today], [e0.body.limits, e0.body.remaining_today], "mêmes limites que l'extension");
    // Les conversions du Desktop et de l'extension comptent au MÊME quota du compte, avec le même refus au bout.
    const daily = d0.body.limits.daily as number;
    let ok = 0;
    for (let i = 0; i < daily; i++) if ((await auth(i % 2 ? ext.secret : cle, "create_job")).body.allow) ok++;
    assert.equal(ok, daily);
    const [rd, re] = [await auth(cle, "create_job"), await auth(ext.secret, "create_job")];
    assert.deepEqual([rd.body.allow, rd.body.reason, re.body.reason], [false, "quota_exceeded", "quota_exceeded"]);
    assert.equal(rd.body.message, re.body.message);
    assert.equal((await auth(cle, "create_job", "gif")).body.reason, "format_not_allowed", "même liste de formats");
    // Plus relié : clé révoquée par la déconnexion du Desktop → refusée (invalid_key), l'extension continue.
    assert.equal((await core(h, "/api/desktop/deconnexion", { method: "POST", token: cle })).status, 204);
    for (const action of ["access", "create_job"] as const) {
      const r = await auth(cle, action);
      assert.deepEqual([r.body.allow, r.body.reason], [false, "invalid_key"], action);
    }
    assert.equal((await auth(ext.secret, "access")).body.allow, true);
    // Clé inconnue (Desktop jamais relié) : même refus.
    assert.equal((await auth("ytc_" + "Q".repeat(64), "create_job")).body.reason, "invalid_key");
  } finally { h.close(); }
});

test("origines : le cœur du Desktop n'envoie AUCUNE origine — page web, « null », file:// et extension refusées sur ses routes ; page d'accord = origine du site + session", async () => {
  const h = await harness({ ...ON, EXTENSION_IDS: "abcdefghijklmnopabcdefghijklmnop" });
  try {
    for (const origin of [ORIGIN, "https://evil.example", "null", "file://", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]) {
      const r = await pair(h, { hote: "X" }, { origin });
      assert.deepEqual([r.status, r.body.error], [403, "invalid_origin"], origin);
    }
    assert.equal((await pair(h, { hote: "X" }, { raw: "hote=X", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 415);
    assert.equal((await pair(h, { hote: "X", autre: 1 })).status, 400, "champ inconnu refusé");
    assert.equal((await pair(h, { hote: "X", versionDesktop: "1.0 <script>" })).status, 400, "version mal formée refusée");
    const b = await newUser(h, "origines@example.test");
    const p = await pair(h);
    // Page d'accord : sans l'origine du site → 403 (contrôle CSRF d'app.ts) ; sans session → 401.
    assert.equal((await site(b, "autoriser", p.body.codeUtilisateur, { origin: "https://evil.example" })).status, 403);
    const anonyme = await h.s.publicApp.request("/api/desktop/autoriser", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ codeUtilisateur: p.body.codeUtilisateur }) });
    assert.equal(anonyme.status, 401);
    const { cle } = await connect(h, b);
    const web = await core(h, "/api/desktop/moi", { token: cle, origin: ORIGIN });
    assert.deepEqual([web.status, web.body.error], [403, "invalid_origin"], "une page web ne lit pas /moi même avec la clé");
  } finally { h.close(); }
});

test("refus, expiration, cadence, rejeu : 403 « refuse » définitif ; 410 « expire » ; 429 « trop-rapide » ; code rejoué → clé révoquée (« replay »)", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "etats@example.test");
    const r1 = await pair(h);
    assert.equal((await site(b, "refuser", r1.body.codeUtilisateur)).body.etat, "refuse");
    assert.deepEqual([(await poll(h, r1.body.codeAppareil)).status, (await site(b, "autoriser", r1.body.codeUtilisateur)).status], [403, 409]);

    const r2 = await pair(h);
    wait(601);
    const e = await poll(h, r2.body.codeAppareil);
    assert.deepEqual([e.status, e.body.etat], [410, "expire"]);
    assert.equal((await site(b, "autoriser", r2.body.codeUtilisateur)).status, 410);
    offset = 0;

    const r3 = await pair(h);
    const ip = freshIp();
    assert.equal((await poll(h, r3.body.codeAppareil, { ip })).status, 428);
    const vite = await poll(h, r3.body.codeAppareil, { ip });
    assert.deepEqual([vite.status, vite.body.etat, vite.headers.get("retry-after")], [429, "trop-rapide", "3"]);

    const { cle, pairing } = await connect(h, b, "PC-REJEU");
    const again = await poll(h, pairing.codeAppareil);
    assert.deepEqual([again.status, again.body.etat], [410, "deja-utilise"]);
    const me = await core(h, "/api/desktop/moi", { token: cle });
    assert.deepEqual([me.status, me.body.revokedBy], [401, "replay"]);

    // Codes mal formés ou inconnus.
    assert.equal((await poll(h, "court")).status, 400);
    assert.equal((await poll(h, randomBytes(32).toString("base64url"))).body.etat, "invalide");
    assert.equal((await site(b, "demande", "ABCD-EFGH")).status, 400, "voyelles : jamais un code");
    assert.equal((await site(b, "demande", "BCDF-GHJK")).status, 404);
  } finally { h.close(); }
});

test("plafond de 3 ordinateurs, autre compte, compte suspendu ; « Mes jetons » : révocation (refusée ensuite), ni régénération ni renommage", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "trois@example.test");
    for (let i = 1; i <= MAX_DESKTOP_KEYS; i++) await connect(h, b, `PC-${i}`);
    const p4 = await pair(h, { hote: "PC-4" });
    assert.deepEqual([(await site(b, "autoriser", p4.body.codeUtilisateur)).status, (await site(b, "autoriser", p4.body.codeUtilisateur)).body.error], [409, "too_many_desktop"]);

    const autre = await newUser(h, "autre@example.test");
    const p = await pair(h, { hote: "PC-LEA" });
    assert.equal((await site(autre, "autoriser", p.body.codeUtilisateur)).status, 200);
    const vu = await site(b, "demande", p.body.codeUtilisateur);
    assert.deepEqual([vu.body.etat, vu.body.appareil], ["utilise", null], "l'ordinateur d'une demande d'autrui n'est pas montré");

    const keys = (await b.json("/api/keys")).body.keys as { id: string; kind: string }[];
    const id = keys.find((k) => k.kind === "desktop")!.id;
    assert.equal((await b.json(`/api/keys/${id}/rotate`, { method: "POST" })).body.error, "desktop_key");
    assert.equal((await b.json(`/api/keys/${id}`, { method: "PATCH", body: { name: "Autre" } })).body.error, "rename_forbidden");
    assert.equal(desktopKeyName("x".repeat(80)).length <= 40, true);
  } finally { h.close(); }
});

test("AETHRYON Cloud et la clé « desktop » : administrateur → /moi « disponible », envoi direct (réservation, PUT, confirmation) et lecture ; compte ordinaire → 403 sur les 11 routes ; origine web refusée ; clé révoquée → 401", async () => {
  const c = await cloudHarness();
  const h = c.h;
  try {
    const admin = await newUser(h, "admin@example.test");
    const { cle } = await connect(h, admin, "PC-ADMIN");
    const me = await core(h, "/api/desktop/moi", { token: cle });
    assert.deepEqual([me.body.administrateur, me.body.cloud], [true, { disponible: true, raison: null }]);

    const etat = await core(h, "/api/cloud/etat", { token: cle });
    assert.equal(etat.status, 200, JSON.stringify(etat.body));
    assert.equal(etat.body.quota.max, 1000);

    // Envoi direct depuis le Desktop : réservation (origine « desktop » déduite de la clé), PUT sur l'URL signée, HEAD.
    const body = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 251));
    const annonce = { nom: "Plan large.mp4", type: "video/mp4", taille: body.length, sha256: createHash("sha256").update(body).digest("hex"), md5: createHash("md5").update(body).digest("base64") };
    const r = await core(h, "/api/cloud/envois", { body: annonce, token: cle });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.objet.origine, "desktop");
    assert.equal(c.store.put(r.body.envoi.url, body, r.body.envoi.entetes), 200);
    const ok = await core(h, `/api/cloud/envois/${r.body.objet.id}/confirmer`, { method: "POST", token: cle });
    assert.deepEqual([ok.status, ok.body.objet.statut, ok.body.objet.expireDansJours], [200, "sauvegarde", 30]);
    const deux = await core(h, "/api/cloud/envois", { body: { ...annonce, nom: "Copie.mp4" }, token: cle });
    assert.deepEqual([deux.status, deux.body.error], [409, "deja_dans_le_cloud"], "mêmes octets : aucune seconde copie");
    const liste = await core(h, "/api/cloud/objets", { token: cle });
    assert.deepEqual(liste.body.items.map((o: { nom: string }) => o.nom), ["Plan large.mp4"]);
    const lien = await core(h, `/api/cloud/objets/${r.body.objet.id}/lien`, { body: { usage: "telecharger" }, token: cle });
    assert.equal(c.store.get(lien.body.url).status, 200);

    // Une page web (Origin) ne peut pas se servir de la clé du Desktop.
    const web = await core(h, "/api/cloud/etat", { token: cle, origin: "https://evil.example" });
    assert.deepEqual([web.status, web.body.error], [403, "invalid_origin"]);

    // Compte ordinaire relié : la clé est valable, mais le cloud lui est refusé partout (403), même par appel direct.
    const user = await newUser(h, "lina@example.test");
    const u = await connect(h, user, "PC-LINA");
    assert.deepEqual((await core(h, "/api/desktop/moi", { token: u.cle })).body.cloud, { disponible: false, raison: "non_admin" });
    for (const [method, path] of CLOUD_ROUTES) {
      const p = path.replace(":id", r.body.objet.id);
      const res = await core(h, p, { method, token: u.cle, ...(method === "GET" ? {} : { body: method === "PUT" ? { sauvegardeAuto: true } : {} }) });
      assert.deepEqual([res.status, res.body.error], [403, "forbidden"], `${method} ${path}`);
    }
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_cloud_objet WHERE owner_id <> ?").get((await admin.json("/api/me")).body.user.id) as { n: number }).n, 0);

    // Révocation depuis « Mes jetons » : le cloud la refuse aussitôt (401 token_revoked).
    const id = ((await admin.json("/api/keys")).body.keys as { id: string; kind: string }[]).find((k) => k.kind === "desktop")!.id;
    assert.equal((await admin.json(`/api/keys/${id}/revoke`, { method: "POST" })).status, 200);
    const rev = await core(h, "/api/cloud/objets", { token: cle });
    assert.deepEqual([rev.status, rev.body.error], [401, "token_revoked"]);
    const logs = h.logs.join("\n");
    for (const s of [cle, u.cle, r.body.envoi.url, lien.body.url]) assert.ok(!logs.includes(s), "aucun secret ni URL signée dans les journaux");
  } finally { c.close(); }
});

test("purge : demandes effacées 24 h après expiration ; suppression du compte → demandes et clés « desktop » effacées", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "purge@example.test");
    await connect(h, b);
    const old = await pair(h);
    h.s.db.prepare("UPDATE ytc_desktop_code SET expires_at = ? WHERE device_hash = ?").run(new Date(Date.now() - 25 * 3_600_000).toISOString(), premiereHash(old.body.codeAppareil));
    await h.s.usage.purge();
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_desktop_code").get() as { n: number }).n, 1);
    assert.equal((await b.json("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_desktop_code").get() as { n: number }).n, 0);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_key_meta WHERE kind = 'desktop'").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("migration 014 : up → down → up ; clés « desktop » et demandes effacées au retour arrière, autres clés intactes ; contraintes", async () => {
  const h = await harness({ ...ON, PREMIERE_CONNEXION: "1" });
  try {
    const db = h.s.db;
    assert.equal(appliedVersions(db).at(-1), 15);
    const b = await newUser(h, "mig14@example.test");
    await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } });
    const { cle } = await connect(h, b);
    await pair(h);
    const snap = () => JSON.stringify(db.prepare("SELECT k.id, k.name, m.kind, m.revoked_at, m.device_label FROM apikey k JOIN ytc_key_meta m ON m.key_id = k.id WHERE m.kind <> 'desktop' ORDER BY k.id").all());
    const ref = snap();
    const kinds = () => (db.prepare("SELECT kind FROM ytc_key_meta ORDER BY kind").all() as { kind: string }[]).map((r) => r.kind);
    assert.deepEqual(kinds(), ["desktop", "shortcut"]);

    assert.deepEqual(migrateDown(db, 2), [15, 14]);
    assert.deepEqual(kinds(), ["shortcut"]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM apikey").get() as { n: number }).n, 1, "la clé du raccourci reste, celle du Desktop est effacée");
    assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ytc_desktop_code'").get() as { n: number }).n, 0);
    assert.throws(() => db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES ('z', 'u', 'x', 'desktop')").run());
    assert.equal(snap(), ref);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: cle, action: "access" })).body.allow, false, "clé effacée : refusée");

    assert.deepEqual(migrateUp(db), [14, 15]);
    assert.equal(snap(), ref);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    assert.deepEqual((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ytc_key_meta' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name), ["ytc_key_meta_user"]);
    assert.throws(() => db.prepare("INSERT INTO ytc_desktop_code (device_hash, user_code, status, created_at, expires_at) VALUES ('h', 'BCDFGHJK', 'autre', 'x', 'x')").run(), "état inconnu refusé");
    db.prepare("INSERT INTO ytc_desktop_code (device_hash, user_code, created_at, expires_at) VALUES ('h1', 'BCDFGHJK', 'x', 'x')").run();
    assert.throws(() => db.prepare("INSERT INTO ytc_desktop_code (device_hash, user_code, created_at, expires_at) VALUES ('h2', 'BCDFGHJK', 'x', 'x')").run(), "code utilisateur unique");
    const again = await connect(h, b, "PC-APRES");
    assert.equal((await core(h, "/api/desktop/moi", { token: again.cle })).status, 200, "le service remarche après la remontée");
  } finally { h.close(); }
});
