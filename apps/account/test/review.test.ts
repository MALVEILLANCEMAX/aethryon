// Tests des corrections issues de la revue de sécurité.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ipInCidr, parseCidr } from "../src/config.ts";
import { Browser, googleLogin, harness, internalCall, newUser } from "./helpers.ts";

test("M1 : supprimer puis recréer son compte ne remet pas le quota à zéro", async () => {
  const h = await harness({ DAILY_CONVERSIONS: "3" });
  try {
    let b = await newUser(h, "abuse@example.test", { sub: "g-abuse" });
    let k = (await b.json("/api/keys", { method: "POST", body: { name: "A" } })).body.secret;
    for (let i = 0; i < 3; i++) assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k, action: "create_job", fmt: "mp3" })).body.allow, true);
    assert.equal((await b.json("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    b = new Browser(h);
    const r = await googleLogin(b, { sub: "g-abuse", email: "abuse@example.test", email_verified: true, name: "A" });
    assert.equal(r.status, 302);
    k = (await b.json("/api/keys", { method: "POST", body: { name: "B" } })).body.secret;
    const again = await internalCall(h, "/internal/v1/authorize", { key: k, action: "create_job", fmt: "mp3" });
    assert.deepEqual([again.body.allow, again.body.reason], [false, "quota_exceeded"]);
    assert.equal((await b.json("/api/me")).body.today.remaining, 0);
    // le registre ne contient pas l'e-mail en clair
    const rows = h.s.db.prepare("SELECT identity FROM ytc_quota_ledger").all() as { identity: string }[];
    assert.ok(rows.length >= 1 && rows.every((x) => !x.identity.includes("abuse")));
  } finally { h.close(); }
});

test("M1 : une unité remboursée l'est aussi dans le registre", async () => {
  const h = await harness({ DAILY_CONVERSIONS: "1" });
  try {
    const b = await newUser(h, "refund@example.test");
    const k = (await b.json("/api/keys", { method: "POST", body: { name: "A" } })).body.secret;
    const r = await internalCall(h, "/internal/v1/authorize", { key: k, action: "create_job", fmt: "mp3" });
    await internalCall(h, `/internal/v1/usage/${r.body.usage_id}`, { state: "refunded" });
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k, action: "create_job", fmt: "mp3" })).body.allow, true);
  } finally { h.close(); }
});

test("B1 : seules les routes Better Auth utilisées sont ouvertes", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "routes@example.test");
    for (const path of ["/api/auth/update-user", "/api/auth/update-session", "/api/auth/link-social", "/api/auth/unlink-account",
      "/api/auth/get-access-token", "/api/auth/refresh-token", "/api/auth/revoke-sessions", "/api/auth/list-sessions", "/api/auth/api-key/create"]) {
      const r = await b.json(path, { method: "POST", body: { image: "https://tracker.example/x.png", name: "x" } });
      assert.equal(r.status, 404, path);
    }
    assert.equal((await b.json("/api/auth/get-session")).status, 200);
    const u = h.s.db.prepare('SELECT image, name FROM "user"').get() as { image: string | null; name: string };
    assert.equal(u.image, null);
  } finally { h.close(); }
});

// Comportement changé par docs/ADMIN.md §1 : ADMIN_EMAILS n'est plus qu'une liste d'amorçage, le rôle
// en base fait foi et il n'y a plus de rétrogradation automatique (elle se fait dans le panneau, avec
// garde du dernier administrateur).
test("B2 (ADMIN.md §1) : retirer une adresse d'ADMIN_EMAILS ne rétrograde plus ; le rôle en base fait foi", async () => {
  const h = await harness({ ADMIN_EMAILS: "boss@example.test" });
  try {
    await newUser(h, "boss@example.test", { sub: "g-boss" });
    assert.equal((h.s.db.prepare('SELECT role FROM "user"').get() as { role: string }).role, "admin");
    h.cfg.adminEmails.clear();
    const b = new Browser(h);
    await googleLogin(b, { sub: "g-boss", email: "boss@example.test", email_verified: true, name: "Boss" });
    assert.equal((await b.json("/api/me")).body.user.role, "admin");
    assert.equal((await b.json("/api/admin/overview")).status, 200);
    // Un rôle retiré en base est retiré aussitôt, même si l'adresse figure dans ADMIN_EMAILS… jusqu'à la
    // prochaine création de session (amorçage idempotent) : c'est le rôle relu à chaque requête qui compte.
    h.s.db.prepare('UPDATE "user" SET role = \'user\'').run();
    assert.equal((await b.json("/api/admin/overview")).status, 403);
  } finally { h.close(); }
});

test("B3 : filtrage réseau de l'API interne (CIDR)", () => {
  const c = parseCidr("10.251.10.0/24");
  assert.equal(ipInCidr("10.251.10.7", c), true);
  assert.equal(ipInCidr("::ffff:10.251.10.7", c), true);
  assert.equal(ipInCidr("10.251.11.7", c), false);
  assert.equal(ipInCidr("192.168.1.2", c), false);
  assert.equal(ipInCidr("", c), false);
  assert.throws(() => parseCidr("10.0.0.0/33"));
});

test("B5 : création de jetons limitée à 10 par heure", async () => {
  const h = await harness({ MAX_KEYS_PER_USER: "20" });
  try {
    const b = await newUser(h, "loop@example.test");
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await b.json("/api/keys", { method: "POST", body: { name: `k${i}` } })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(201));
    assert.equal(codes[10], 429);
  } finally { h.close(); }
});

test("purge : sessions expirées et clés révoquées depuis plus de 30 jours", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "purge@example.test");
    const k = (await b.json("/api/keys", { method: "POST", body: { name: "A" } })).body;
    await b.json(`/api/keys/${k.key.id}/revoke`, { method: "POST" });
    h.s.db.prepare("UPDATE ytc_key_meta SET revoked_at = '2020-01-01T00:00:00.000Z'").run();
    h.s.db.prepare('UPDATE session SET "expiresAt" = \'2020-01-01T00:00:00.000Z\'').run();
    const r = await h.s.usage.purge();
    assert.equal(r.revokedKeys, 1);
    assert.equal(r.sessions, 1);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM apikey").get() as { n: number }).n, 0);
  } finally { h.close(); }
});
