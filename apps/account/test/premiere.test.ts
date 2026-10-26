// Connexion du panneau AETHRYON pour Premiere Pro (premiere.ts, V2-CONNEXION.md) : appairage, page d'accord
// (session + CSRF), interrogation /jeton (en attente, clé une seule fois, refus, expiration, cadence, rejeu), clé
// « premiere » (30 jours, ytapi l'accepte comme une clé d'extension, /moi, déconnexion, révocation), limites,
// origines, journaux sans secret, purge, migration 012. Base temporaire ; aucune base réelle, aucun appel réseau.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appliedVersions, migrateDown, migrateUp } from "../src/db.ts";
import { formatUserCode, newUserCode, normalizeUserCode, PAIRING_TTL_S, premiereClock, premiereHash, USER_CODE_ALPHABET } from "../src/premiere.ts";
import { MAX_PREMIERE_KEYS, premiereKeyName } from "../src/keys.ts";
import { Browser, harness, internalCall, newUser, ORIGIN, type Harness } from "./helpers.ts";

const ON = { PREMIERE_CONNEXION: "1" };

// Horloge simulée : chaque test part de l'heure réelle et avance à la main (cadence de 3 s, expiration de 10 min).
let offset = 0;
premiereClock.now = () => Date.now() + offset;
const wait = (s: number) => { offset += s * 1000; };
afterEach(() => { offset = 0; });

let ipN = 1;
const freshIp = () => `192.0.2.${(ipN++ % 250) + 1}`;

/** Requête « du panneau » : aucun cookie, aucune origine par défaut (requête Node). */
async function panel(h: Harness, path: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; origin?: string; token?: string; ip?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { "x-real-ip": init.ip ?? freshIp(), ...(init.headers ?? {}) };
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  let body: string | undefined;
  if (init.raw !== undefined) body = init.raw;
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] ??= "application/json"; }
  const res = await h.s.publicApp.request(path, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as any };
}

const pair = (h: Harness, body: Record<string, unknown> = { hote: "PC-MONTAGE", versionPremiere: "25.2.1", versionExtension: "2.0.0" }, init: Parameters<typeof panel>[2] = {}) =>
  panel(h, "/api/premiere/appairage", { body, ...init });
const poll = (h: Harness, codeAppareil: string, init: Parameters<typeof panel>[2] = {}) =>
  panel(h, "/api/premiere/jeton", { body: { codeAppareil }, ...init });
const site = (b: Browser, action: "demande" | "autoriser" | "refuser", codeUtilisateur: unknown, init: { origin?: string | null; headers?: Record<string, string> } = {}) =>
  b.json(`/api/premiere/${action}`, { method: "POST", body: { codeUtilisateur }, ...init });

/** Parcours complet : appairage → accord sur le site → clé. */
async function connect(h: Harness, b: Browser, hote = "PC-MONTAGE") {
  const p = await pair(h, { hote });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await site(b, "autoriser", p.body.codeUtilisateur)).status, 200);
  const t = await poll(h, p.body.codeAppareil);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  wait(3);
  return { ...(t.body as { cle: string; expireLe: string; compte: { email: string; nom: string } }), pairing: p.body };
}

test("codes utilisateur : 8 lettres sans voyelle, tirage uniforme, saisie tolérante (minuscules, espaces, tirets)", () => {
  const seen = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const c = newUserCode();
    assert.match(c, /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
    for (const ch of c) seen.set(ch, (seen.get(ch) ?? 0) + 1);
  }
  assert.equal(seen.size, USER_CODE_ALPHABET.length, "toutes les lettres sortent");
  for (const n of seen.values()) assert.ok(n > 500 && n < 1100, `répartition ${n}`); // 800 attendus par lettre
  assert.equal(normalizeUserCode("bcdf-ghjk"), "BCDFGHJK");
  assert.equal(normalizeUserCode(" BCDF GHJK "), "BCDFGHJK");
  assert.equal(normalizeUserCode("BCDF–GHJK"), "BCDFGHJK");
  for (const bad of ["ABCD-EFGH", "BCDF-GHJ", "BCDF-GHJKL", "BCDF_GHJK", 12345678, null, "x".repeat(40)]) assert.equal(normalizeUserCode(bad), null, String(bad));
  assert.equal(formatUserCode("BCDFGHJK"), "BCDF-GHJK");
  assert.equal(premiereKeyName("PC-MONTAGE"), "Premiere Pro · PC-MONTAGE");
  assert.equal(Array.from(premiereKeyName("x".repeat(80))).length, 40);
});

test("fermée par défaut (PREMIERE_CONNEXION ≠ 1) : appairage, jeton et page d'accord en 404 « premiere_closed », rien n'est créé", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "ferme@example.test");
    assert.equal((await pair(h)).body.error, "premiere_closed");
    assert.equal((await poll(h, randomBytes(32).toString("base64url"))).body.error, "premiere_closed");
    for (const a of ["demande", "autoriser", "refuser"] as const) {
      const r = await site(b, a, "BCDF-GHJK");
      assert.deepEqual([r.status, r.body.error], [404, "premiere_closed"], a);
    }
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_premiere_code").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("parcours complet : appairage (empreinte seule) → en attente → page d'accord → clé « premiere » une seule fois → ytapi l'accepte → /moi → déconnexion", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "lea@example.test", { name: "Léa Martin" });
    const uid = (await b.json("/api/me")).body.user.id as string;
    const p = await pair(h);
    assert.equal(p.status, 200);
    assert.deepEqual(Object.keys(p.body).sort(), ["codeAppareil", "codeUtilisateur", "expireDans", "intervalle", "urlVerification"]);
    assert.match(p.body.codeAppareil, /^[A-Za-z0-9_-]{43}$/);
    assert.match(p.body.codeUtilisateur, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.equal(p.body.urlVerification, `${ORIGIN}/premiere/connecter`);
    assert.equal(p.body.expireDans, 600);
    assert.equal(p.body.intervalle, 3);
    // Seule l'empreinte du code d'appareil est gardée.
    const row = h.s.db.prepare("SELECT * FROM ytc_premiere_code").get() as Record<string, string | null>;
    assert.equal(row.device_hash, premiereHash(p.body.codeAppareil));
    assert.ok(!JSON.stringify(row).includes(p.body.codeAppareil));
    assert.deepEqual([row.status, row.user_id, row.host, row.premiere_version, row.extension_version], ["pending", null, "PC-MONTAGE", "25.2.1", "2.0.0"]);
    assert.equal(Date.parse(row.expires_at!) - Date.parse(row.created_at!), PAIRING_TTL_S * 1000);

    const t1 = await poll(h, p.body.codeAppareil);
    assert.deepEqual([t1.status, t1.body.etat, t1.body.intervalle], [428, "en-attente", 3]);

    // Page d'accord : le code (saisi en minuscules, sans tiret) et l'ordinateur.
    const d = await site(b, "demande", p.body.codeUtilisateur.toLowerCase().replace("-", ""));
    assert.equal(d.status, 200);
    assert.deepEqual(d.body.appareil, { hote: "PC-MONTAGE", versionPremiere: "25.2.1", versionExtension: "2.0.0" });
    assert.deepEqual([d.body.codeUtilisateur, d.body.etat], [p.body.codeUtilisateur, "en-attente"]);
    const a = await site(b, "autoriser", p.body.codeUtilisateur);
    assert.deepEqual([a.status, a.body.etat], [200, "autorise"]);
    assert.deepEqual((await site(b, "autoriser", p.body.codeUtilisateur)).body, { etat: "autorise" }, "double clic : sans effet");
    assert.equal((await site(b, "demande", p.body.codeUtilisateur)).body.etat, "autorise");

    wait(3);
    const t2 = await poll(h, p.body.codeAppareil);
    assert.equal(t2.status, 200, JSON.stringify(t2.body));
    assert.deepEqual(Object.keys(t2.body).sort(), ["cle", "compte", "expireLe"]);
    assert.match(t2.body.cle, /^ytc_[A-Za-z]{64}$/);
    assert.deepEqual(t2.body.compte, { email: "lea@example.test", nom: "Léa Martin" });
    const days = (Date.parse(t2.body.expireLe) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `30 jours (${days})`);
    assert.equal((await site(b, "demande", p.body.codeUtilisateur)).body.etat, "utilise");

    // « Mes jetons » : listée à part (type « premiere », nom de l'ordinateur), hors du plafond du raccourci.
    const listed = (await b.json("/api/keys")).body.keys as { id: string; kind: string; name: string; deviceLabel: string | null; status: string }[];
    assert.equal(listed.length, 1);
    assert.deepEqual([listed[0]!.kind, listed[0]!.name, listed[0]!.deviceLabel, listed[0]!.status], ["premiere", "Premiere Pro · PC-MONTAGE", "PC-MONTAGE", "active"]);
    assert.equal((await b.json("/api/me")).body.keys.active, 0, "hors du plafond des jetons du raccourci");

    // ytapi : mêmes droits et même quota qu'une clé d'extension (accès, création de job comptée au compte).
    const acc = await internalCall(h, "/internal/v1/authorize", { key: t2.body.cle, action: "access" });
    assert.deepEqual([acc.body.allow, acc.body.user_id, acc.body.key_kind], [true, uid, "premiere"]);
    const job = await internalCall(h, "/internal/v1/authorize", { key: t2.body.cle, action: "create_job", fmt: "mp4", platform: "youtube" });
    assert.equal(job.body.allow, true);
    assert.equal((await b.json("/api/me")).body.today.used, 1, "quota du compte");
    // (ytapi lui-même : ytapi/tests/test_user_keys.py, et la pile jetable e2e/premiere.test.mjs.)

    const me = await panel(h, "/api/premiere/moi", { token: t2.body.cle });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.deepEqual(me.body.compte, { email: "lea@example.test", nom: "Léa Martin" });
    assert.equal(me.body.quota.utilise, 1);
    assert.equal(me.body.quota.limite, 10);
    assert.equal(me.body.recentes.length, 1);
    assert.deepEqual(Object.keys(me.body.recentes[0]).sort(), ["creeLe", "erreur", "etat", "format", "plateforme"]);
    assert.equal(me.body.conversionsEnCours, 1);
    assert.equal(me.body.cle.expireLe, t2.body.expireLe);

    // Déconnexion depuis le panneau : clé révoquée (motif « user »), ytapi la refuse aussitôt ; idempotente.
    assert.equal((await panel(h, "/api/premiere/deconnexion", { method: "POST", token: t2.body.cle })).status, 204);
    assert.equal((await panel(h, "/api/premiere/deconnexion", { method: "POST", token: t2.body.cle })).status, 204);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: t2.body.cle, action: "access" })).body.reason, "invalid_key");
    const gone = await panel(h, "/api/premiere/moi", { token: t2.body.cle });
    assert.deepEqual([gone.status, gone.body.error, gone.body.revokedBy], [401, "token_revoked", "user"]);

    // Journaux : ni code d'appareil, ni code utilisateur, ni clé, ni e-mail.
    const logs = h.logs.join("\n");
    for (const secret of [p.body.codeAppareil, p.body.codeUtilisateur, p.body.codeUtilisateur.replace("-", ""), t2.body.cle, t2.body.cle.slice(4, 20), "lea@example.test"]) {
      assert.ok(!logs.includes(secret), `absent des journaux : ${secret.slice(0, 6)}…`);
    }
    assert.ok(logs.includes("premiere key issued") && logs.includes("premiere pairing approved"));
  } finally { h.close(); }
});

test("refus : définitif (403 « refuse »), plus aucun accord possible ; la page le dit", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "refus@example.test");
    const p = await pair(h);
    const r = await site(b, "refuser", p.body.codeUtilisateur);
    assert.deepEqual([r.status, r.body.etat], [200, "refuse"]);
    assert.deepEqual((await site(b, "refuser", p.body.codeUtilisateur)).body, { etat: "refuse" }, "idempotent");
    const t = await poll(h, p.body.codeAppareil);
    assert.deepEqual([t.status, t.body.etat], [403, "refuse"]);
    const again = await site(b, "autoriser", p.body.codeUtilisateur);
    assert.deepEqual([again.status, again.body.error, again.body.etat], [409, "code_denied", "refuse"]);
    assert.equal((await site(b, "demande", p.body.codeUtilisateur)).body.etat, "refuse");
    wait(3);
    assert.equal((await poll(h, p.body.codeAppareil)).status, 403);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM apikey").get() as { n: number }).n, 0, "aucune clé");
  } finally { h.close(); }
});

test("expiration (10 min) : 410 « expire » au panneau, 410 à la page ; une demande autorisée mais non retirée expire aussi", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "expire@example.test");
    const p = await pair(h);
    wait(PAIRING_TTL_S + 1);
    const t = await poll(h, p.body.codeAppareil);
    assert.deepEqual([t.status, t.body.etat], [410, "expire"]);
    assert.equal((await site(b, "demande", p.body.codeUtilisateur)).body.etat, "expire");
    const a = await site(b, "autoriser", p.body.codeUtilisateur);
    assert.deepEqual([a.status, a.body.error], [410, "code_expired"]);
    assert.equal((await site(b, "refuser", p.body.codeUtilisateur)).status, 410);

    offset = 0;
    const q = await pair(h);
    assert.equal((await site(b, "autoriser", q.body.codeUtilisateur)).status, 200);
    wait(PAIRING_TTL_S);
    const late = await poll(h, q.body.codeAppareil);
    assert.deepEqual([late.status, late.body.etat], [410, "expire"]);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM apikey").get() as { n: number }).n, 0, "aucune clé remise après l'expiration");
  } finally { h.close(); }
});

test("cadence : interrogation trop rapide → 429 « trop-rapide » (Retry-After 3) sans repousser la suivante ; course : une seule clé", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "rapide@example.test");
    const p = await pair(h);
    assert.equal((await poll(h, p.body.codeAppareil)).status, 428);
    const fast = await poll(h, p.body.codeAppareil);
    assert.deepEqual([fast.status, fast.body.etat, fast.body.intervalle, fast.headers.get("retry-after")], [429, "trop-rapide", 3, "3"]);
    wait(1.5);
    assert.equal((await poll(h, p.body.codeAppareil)).status, 429);
    wait(1.0); // 2,5 s après la dernière interrogation acceptée : marge de 0,5 s admise
    assert.equal((await poll(h, p.body.codeAppareil)).status, 428);

    // Deux interrogations simultanées après l'accord : une clé, un 429 ; jamais deux clés.
    assert.equal((await site(b, "autoriser", p.body.codeUtilisateur)).status, 200);
    wait(3);
    const [x, y] = await Promise.all([poll(h, p.body.codeAppareil), poll(h, p.body.codeAppareil)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 429]);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_key_meta WHERE kind = 'premiere'").get() as { n: number }).n, 1);
  } finally { h.close(); }
});

test("rejeu du code d'appareil après la remise : 410 « deja-utilise » et la clé remise est révoquée (motif « replay »), ytapi la refuse", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "rejeu@example.test");
    const { cle, pairing } = await connect(h, b);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: cle, action: "access" })).body.allow, true);
    const again = await poll(h, pairing.codeAppareil);
    assert.deepEqual([again.status, again.body.etat], [410, "deja-utilise"]);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: cle, action: "access" })).body.reason, "invalid_key");
    const me = await panel(h, "/api/premiere/moi", { token: cle });
    assert.deepEqual([me.status, me.body.error, me.body.revokedBy], [401, "token_revoked", "replay"]);
    assert.ok(h.logs.some((l) => l.includes("premiere device code replayed")));
  } finally { h.close(); }
});

test("mauvais codes : code d'appareil inconnu (400 « invalide »), mal formé (400), code utilisateur inconnu (404) ou mal formé (400) ; essais limités", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "mauvais@example.test");
    const ip = freshIp();
    const unknown = await poll(h, randomBytes(32).toString("base64url"), { ip });
    assert.deepEqual([unknown.status, unknown.body.error, unknown.body.etat], [400, "invalid_grant", "invalide"]);
    for (const bad of ["court", "x".repeat(44), 42, null]) {
      const r = await panel(h, "/api/premiere/jeton", { body: { codeAppareil: bad } });
      assert.deepEqual([r.status, r.body.error], [400, "invalid_request"], String(bad));
    }
    assert.equal((await panel(h, "/api/premiere/jeton", { body: {} })).status, 400);
    assert.equal((await panel(h, "/api/premiere/jeton", { body: { codeAppareil: randomBytes(32).toString("base64url"), autre: 1 } })).status, 400, "champ inconnu");
    // 20 codes inconnus par 10 min et par IP, puis 429.
    for (let i = 1; i < 20; i++) assert.equal((await poll(h, randomBytes(32).toString("base64url"), { ip })).status, 400);
    assert.equal((await poll(h, randomBytes(32).toString("base64url"), { ip })).status, 429);

    assert.deepEqual([(await site(b, "demande", "ABCD-EFGH")).status, (await site(b, "demande", "ABCD-EFGH")).body.error], [400, "invalid_code"]);
    assert.equal((await site(b, "autoriser", { code: 1 })).status, 400);
    // 10 codes utilisateur inconnus par 10 min et par compte, puis 429 (même pour un bon code).
    const p = await pair(h);
    for (let i = 0; i < 10; i++) {
      const r = await site(b, "demande", newUserCode());
      assert.deepEqual([r.status, r.body.error], [404, "unknown_code"]);
    }
    assert.equal((await site(b, "autoriser", newUserCode())).status, 429);
    const other = await newUser(h, "autre@example.test");
    assert.equal((await site(other, "demande", p.body.codeUtilisateur)).status, 200, "limite par compte");
  } finally { h.close(); }
});

test("révocation dans « Mes jetons » : ytapi refuse la clé, /moi répond « token_revoked » (user) ; régénération et renommage refusés", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "revoque@example.test");
    const { cle } = await connect(h, b);
    const id = ((await b.json("/api/keys")).body.keys as { id: string }[])[0]!.id;
    const rot = await b.json(`/api/keys/${id}/rotate`, { method: "POST" });
    assert.deepEqual([rot.status, rot.body.error], [409, "premiere_key"]);
    assert.equal((await b.json(`/api/keys/${id}`, { method: "PATCH", body: { name: "Autre" } })).body.error, "rename_forbidden");
    const r = await b.json(`/api/keys/${id}/revoke`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(r.body.key.status, "revoked");
    const d = await internalCall(h, "/internal/v1/authorize", { key: cle, action: "create_job", fmt: "mp3" });
    assert.deepEqual([d.body.allow, d.body.reason], [false, "invalid_key"]);
    const me = await panel(h, "/api/premiere/moi", { token: cle });
    assert.deepEqual([me.status, me.body.error, me.body.revokedBy], [401, "token_revoked", "user"]);
    assert.equal(me.headers.get("www-authenticate"), 'Bearer realm="aethryon"');
  } finally { h.close(); }
});

test("CSRF et origines : page d'accord = origine du site + JSON + session ; routes du panneau = origine absente, « null » ou « file:// »", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "csrf@example.test");
    const p = await pair(h);
    for (const origin of ["https://evil.example", null]) {
      const r = await site(b, "autoriser", p.body.codeUtilisateur, { origin });
      assert.deepEqual([r.status, r.body.error], [403, "invalid_origin"], String(origin));
    }
    // Type « simple » (formulaire, texte) : refusé, même avec la session et l'origine du site.
    const text = await h.s.publicApp.request("/api/premiere/autoriser", {
      method: "POST", body: JSON.stringify({ codeUtilisateur: p.body.codeUtilisateur }),
      headers: { cookie: b.cookie(), origin: ORIGIN, "content-type": "text/plain", "x-real-ip": b.ip },
    });
    assert.equal(text.status, 415);
    const anon = new Browser(h);
    assert.equal((await site(anon, "autoriser", p.body.codeUtilisateur)).status, 401);
    assert.equal((await site(anon, "demande", p.body.codeUtilisateur)).status, 401);
    assert.equal((h.s.db.prepare("SELECT status FROM ytc_premiere_code").get() as { status: string }).status, "pending", "rien n'a changé");

    // Routes du panneau : une page web (origine https://…) est refusée ; Node (aucune) et la page locale CEP acceptées.
    assert.deepEqual([(await pair(h, {}, { origin: "https://evil.example" })).status], [403]);
    assert.equal((await pair(h, {}, { origin: ORIGIN })).status, 403, "même l'origine du site : ces routes ne servent qu'au panneau");
    assert.equal((await pair(h, {}, { origin: "null" })).status, 200);
    assert.equal((await pair(h, {}, { origin: "file://" })).status, 200);
    assert.equal((await poll(h, p.body.codeAppareil, { origin: "https://evil.example" })).status, 403);
    assert.equal((await panel(h, "/api/premiere/appairage", { raw: "{}", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await panel(h, "/api/premiere/appairage", { raw: "{}" })).status, 415, "JSON exigé");
    assert.equal((await pair(h, { hote: 12 })).status, 400);
    assert.equal((await pair(h, { inconnu: "x" })).status, 400);

    // Un cookie de session n'ouvre jamais les routes du panneau.
    const cookie = b.cookie();
    const me = await panel(h, "/api/premiere/moi", { cookie });
    assert.deepEqual([me.status, me.body.error], [401, "invalid_token"]);
    assert.equal((await panel(h, "/api/premiere/deconnexion", { method: "POST", cookie })).status, 401);
    // Une clé d'extension n'ouvre pas les routes du panneau (et inversement).
    const { cle } = await connect(h, b);
    assert.equal((await panel(h, "/api/extension/me", { token: cle })).body.error, "invalid_token");
    const short = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret as string;
    assert.equal((await panel(h, "/api/premiere/moi", { token: short })).body.error, "invalid_token");
  } finally { h.close(); }
});

test("informations du panneau nettoyées (contrôle, direction, longueur) ; appairage limité par IP (10 / 10 min)", async () => {
  const h = await harness(ON);
  try {
    const p = await pair(h, { hote: "PC‮-de\u0007-Léa  " + "x".repeat(100), versionPremiere: "25.2\n.1", versionExtension: "" });
    assert.equal(p.status, 200);
    const row = h.s.db.prepare("SELECT host, premiere_version, extension_version FROM ytc_premiere_code").get() as Record<string, string | null>;
    assert.ok(!/[\u0000-\u001f‮]/.test(row.host!));
    assert.ok(Array.from(row.host!).length <= 60);
    assert.equal(row.premiere_version, "25.2 .1");
    assert.equal(row.extension_version, null);
    assert.equal((await pair(h, {})).status, 200, "aucune information : accepté");
    const ip = freshIp();
    for (let i = 0; i < 10; i++) assert.equal((await pair(h, {}, { ip })).status, 200);
    const r = await pair(h, {}, { ip });
    assert.deepEqual([r.status, r.body.error], [429, "rate_limited"]);
  } finally { h.close(); }
});

test("autre compte : la demande autorisée par Léa apparaît « déjà utilisée » sans l'ordinateur ; compte suspendu → 403 ; plafond de 3 ordinateurs", async () => {
  const h = await harness({ ...ON, ADMIN_EMAILS: "admin@example.test" });
  try {
    const lea = await newUser(h, "lea2@example.test");
    const bob = await newUser(h, "bob@example.test");
    const p = await pair(h);
    assert.equal((await site(lea, "autoriser", p.body.codeUtilisateur)).status, 200);
    const seen = await site(bob, "demande", p.body.codeUtilisateur);
    assert.deepEqual([seen.body.etat, seen.body.appareil], ["utilise", null]);
    assert.equal((await site(bob, "autoriser", p.body.codeUtilisateur)).body.error, "code_used");
    assert.equal((await site(bob, "refuser", p.body.codeUtilisateur)).status, 409);

    // Compte suspendu entre l'accord et le retrait de la clé : refus définitif, aucune clé.
    const bobId = (await bob.json("/api/me")).body.user.id as string;
    const q = await pair(h);
    assert.equal((await site(bob, "autoriser", q.body.codeUtilisateur)).status, 200);
    h.s.db.prepare("UPDATE \"user\" SET status = 'suspended' WHERE id = ?").run(bobId);
    const t = await poll(h, q.body.codeAppareil);
    assert.deepEqual([t.status, t.body.error, t.body.etat], [403, "account_suspended", "refuse"]);
    h.s.db.prepare("UPDATE \"user\" SET status = 'active' WHERE id = ?").run(bobId);
    wait(3);
    assert.equal((await poll(h, q.body.codeAppareil)).status, 403, "définitif");

    // Plafond : 3 ordinateurs connectés, le 4e est refusé dès la page d'accord.
    const carl = await newUser(h, "carl@example.test");
    for (let i = 0; i < MAX_PREMIERE_KEYS; i++) await connect(h, carl, `PC-${i}`);
    const r = await pair(h);
    const a = await site(carl, "autoriser", r.body.codeUtilisateur);
    assert.deepEqual([a.status, a.body.error], [409, "too_many_premiere"]);
    assert.match(a.body.message, /Mes jetons/);
    assert.equal((await site(carl, "demande", r.body.codeUtilisateur)).body.etat, "en-attente", "la demande reste libre");
  } finally { h.close(); }
});

test("purge : demandes effacées 24 h après expiration ; suppression du compte → demandes et clés effacées", async () => {
  const h = await harness(ON);
  try {
    const b = await newUser(h, "purge@example.test");
    await connect(h, b);
    const old = await pair(h);
    h.s.db.prepare("UPDATE ytc_premiere_code SET expires_at = ? WHERE device_hash = ?").run(new Date(Date.now() - 25 * 3_600_000).toISOString(), premiereHash(old.body.codeAppareil));
    await h.s.usage.purge();
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_premiere_code").get() as { n: number }).n, 1, "seule la demande récente reste");
    assert.equal((await b.json("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_premiere_code").get() as { n: number }).n, 0);
    assert.equal((h.s.db.prepare("SELECT count(*) AS n FROM ytc_key_meta WHERE kind = 'premiere'").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("migration 012 : up → down → up ; clés « premiere » et demandes effacées au retour arrière, autres clés intactes ; contraintes", async () => {
  const h = await harness({ ...ON, EXTENSION_IDS: "abcdefghijklmnopabcdefghijklmnop" });
  try {
    const db = h.s.db;
    assert.equal(appliedVersions(db).at(-1), 16);
    const b = await newUser(h, "mig12@example.test");
    const short = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.key.id as string;
    const { cle } = await connect(h, b);
    await pair(h);
    const snap = () => JSON.stringify(db.prepare("SELECT k.id, k.name, m.kind, m.revoked_at FROM apikey k JOIN ytc_key_meta m ON m.key_id = k.id WHERE m.kind <> 'premiere' ORDER BY k.id").all());
    const ref = snap();
    const kinds = () => (db.prepare("SELECT kind FROM ytc_key_meta ORDER BY kind").all() as { kind: string }[]).map((r) => r.kind);
    assert.deepEqual(kinds(), ["premiere", "shortcut"]);

    assert.deepEqual(migrateDown(db, 5), [16, 15, 14, 13, 12]);
    assert.deepEqual(kinds(), ["shortcut"]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM apikey").get() as { n: number }).n, 1, "la clé du raccourci reste, celle de Premiere est effacée");
    assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ytc_premiere_code'").get() as { n: number }).n, 0);
    assert.throws(() => db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES ('z', 'u', 'x', 'premiere')").run());
    assert.equal(snap(), ref);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: cle, action: "access" })).body.allow, false, "clé effacée : refusée");

    assert.deepEqual(migrateUp(db), [12, 13, 14, 15, 16]);
    assert.equal(snap(), ref);
    assert.equal((db.prepare("SELECT key_id FROM ytc_key_meta").get() as { key_id: string }).key_id, short);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    assert.deepEqual((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ytc_key_meta' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name), ["ytc_key_meta_user"]);
    assert.throws(() => db.prepare("INSERT INTO ytc_premiere_code (device_hash, user_code, status, created_at, expires_at) VALUES ('h', 'BCDFGHJK', 'autre', 'x', 'x')").run(), "état inconnu refusé");
    assert.throws(() => db.prepare("INSERT INTO ytc_premiere_code (device_hash, user_code, created_at, expires_at) VALUES ('h', 'BCD', 'x', 'x')").run(), "code de 8 lettres");
    db.prepare("INSERT INTO ytc_premiere_code (device_hash, user_code, created_at, expires_at) VALUES ('h1', 'BCDFGHJK', 'x', 'x')").run();
    assert.throws(() => db.prepare("INSERT INTO ytc_premiere_code (device_hash, user_code, created_at, expires_at) VALUES ('h2', 'BCDFGHJK', 'x', 'x')").run(), "code utilisateur unique");
    // Le service remarche après la remontée.
    const again = await connect(h, b, "PC-APRES");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: again.cle, action: "access" })).body.key_kind, "premiere");
  } finally { h.close(); }
});
