// Control Center (docs/ADMIN.md) : rôles et amorçage, outil admin.js, garde /api/admin, quotas
// effectifs, révocation et suspension immédiates, gardes du dernier administrateur, journal, réglages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ADMIN_ROUTES } from "../src/admin.ts";
import { grantAdmin, countActiveAdmins, reactivateUser } from "../src/roles.ts";
import { tx } from "../src/db.ts";
import { Browser, googleLogin, harness, INTERNAL, internalCall, newUser, type Harness } from "./helpers.ts";

const ADMIN = "admin@example.test";
const ICLOUD_A = "https://www.icloud.com/shortcuts/" + "a".repeat(32);
const ICLOUD_B = "https://www.icloud.com/shortcuts/" + "0123456789abcdef".repeat(2);

async function setup(env: Record<string, string> = {}) {
  const h = await harness({ ADMIN_EMAILS: ADMIN, ...env });
  const admin = await newUser(h, ADMIN);
  const u = await newUser(h, "user@example.test");
  const k = (await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body;
  const uid = (await u.json("/api/me")).body.user.id as string;
  const aid = (await admin.json("/api/me")).body.user.id as string;
  return { h, admin, u, uid, aid, key: k.secret as string, keyId: k.key.id as string };
}

const createJob = (h: Harness, key: string, extra: Record<string, unknown> = {}) =>
  internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp3", platform: "youtube", ...extra });

type Ev = { action: string; actor_user_id: string | null; actor_label: string | null; target_type: string | null; target: string | null; details: string; result: string };
const events = (h: Harness, action: string): Ev[] =>
  h.s.db.prepare("SELECT * FROM ytc_admin_event WHERE action = ? ORDER BY created_at, rowid").all(action) as unknown as Ev[];
const roleOf = (h: Harness, id: string) => (h.s.db.prepare('SELECT role FROM "user" WHERE id = ?').get(id) as { role: string }).role;

// ---- §1 rôles -------------------------------------------------------------------------------

test("amorçage : Google vérifié + ADMIN_EMAILS ⇒ admin à la session, audit « système », sans rétrogradation", async () => {
  const h = await harness({ ADMIN_EMAILS: "boss@example.test" });
  try {
    const boss = await newUser(h, "boss@example.test", { sub: "g-boss" });
    const id = (await boss.json("/api/me")).body.user.id;
    assert.equal(roleOf(h, id), "admin");
    const ev = events(h, "role.bootstrap");
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0]!.actor_user_id, ev[0]!.actor_label, ev[0]!.target_type, ev[0]!.target, ev[0]!.result], [null, "système", "user", id, "ok"]);
    // idempotent : nouvelle session, pas de nouvel audit
    await googleLogin(new Browser(h), { sub: "g-boss", email: "boss@example.test", email_verified: true, name: "Boss" });
    assert.equal(events(h, "role.bootstrap").length, 1);
    // plus de rétrogradation automatique
    h.cfg.adminEmails.clear();
    const again = new Browser(h);
    await googleLogin(again, { sub: "g-boss", email: "boss@example.test", email_verified: true, name: "Boss" });
    assert.equal((await again.json("/api/me")).body.user.role, "admin");
    // une autre adresse n'est jamais promue
    const other = await newUser(h, "other@example.test");
    assert.equal((await other.json("/api/me")).body.user.role, "user");
  } finally { h.close(); }
});

test("amorçage refusé : e-mail non vérifié ou compte sans liaison Google", async () => {
  const h = await harness({ ADMIN_EMAILS: "nogoogle@example.test,unverified@example.test" });
  try {
    const ctx = await h.s.auth.$context;
    const a = await ctx.internalAdapter.createUser({ email: "nogoogle@example.test", name: "n", emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.createSession(a.id);
    assert.equal(roleOf(h, a.id), "user");
    const b = await ctx.internalAdapter.createUser({ email: "unverified@example.test", name: "u", emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: b.id, providerId: "google", accountId: "g-unverified" });
    h.s.db.prepare('UPDATE "user" SET "emailVerified" = 0 WHERE id = ?').run(b.id);
    await ctx.internalAdapter.createSession(b.id);
    assert.equal(roleOf(h, b.id), "user");
    // la liaison Google ajoutée, la session suivante promeut
    await ctx.internalAdapter.linkAccount({ userId: a.id, providerId: "google", accountId: "g-nogoogle" });
    await ctx.internalAdapter.createSession(a.id);
    assert.equal(roleOf(h, a.id), "admin");
    assert.deepEqual(events(h, "role.bootstrap").map((e) => e.target), [a.id]);
  } finally { h.close(); }
});

test("outil admin.js : grant idempotent avec mêmes vérifications, refus explicites, codes de sortie, list", async () => {
  const h = await harness();
  try {
    const u = await newUser(h, "owner@example.test");
    const uid = (await u.json("/api/me")).body.user.id;
    const ctx = await h.s.auth.$context;
    const lone = await ctx.internalAdapter.createUser({ email: "lone@example.test", name: "l", emailVerified: true }, { method: "admin" });
    // fonction : refus (inconnu, sans Google), promotion, idempotence
    assert.deepEqual(tx(h.s.db, () => grantAdmin(h.s.db, "nobody@example.test", "test")), { ok: false, code: "user_not_found", message: "Aucun compte avec cette adresse.", userId: null });
    const r1 = tx(h.s.db, () => grantAdmin(h.s.db, "lone@example.test", "test"));
    assert.equal(r1.ok, false);
    assert.equal(r1.code, "no_google_account");
    assert.equal(roleOf(h, lone.id), "user");
    // processus réel (dist/tools/admin.js compilé à l'identique depuis src/tools/admin.ts)
    const tool = fileURLToPath(new URL("../src/tools/admin.ts", import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", tool, ...args],
      { env: { PATH: process.env.PATH ?? "", ...h.env }, encoding: "utf8" });
    const g1 = run("grant", "--email", "Owner@Example.test");
    assert.equal(g1.status, 0, g1.stderr);
    assert.match(g1.stdout, /owner@example\.test est maintenant administrateur/);
    assert.equal(roleOf(h, uid), "admin");
    const g2 = run("grant", "--email", "owner@example.test");
    assert.equal(g2.status, 0, g2.stderr);
    assert.match(g2.stdout, /déjà administrateur/);
    const g3 = run("grant", "--email", "lone@example.test");
    assert.equal(g3.status, 1);
    assert.match(g3.stderr, /refusé\u00a0: Ce compte n'est lié à aucune connexion Google\./);
    assert.equal(run("grant", "--email", "inconnu@example.test").status, 1);
    assert.equal(run("grant").status, 2);
    assert.equal(run("bogus").status, 2);
    // reactivate : secours d'un compte suspendu (processus réel)
    h.s.db.prepare('UPDATE "user" SET status = \'suspended\' WHERE id = ?').run(uid);
    const g4 = run("grant", "--email", "owner@example.test");
    assert.equal(g4.status, 1, "un administrateur suspendu n'est pas « déjà administrateur »");
    const re = run("reactivate", "--email", "owner@example.test");
    assert.equal(re.status, 0, re.stderr);
    assert.match(re.stdout, /compte réactivé/);
    assert.equal(run("reactivate").status, 2);
    const list = run("list");
    assert.equal(list.status, 0);
    assert.match(list.stdout, /owner@example\.test\tactif/);
    // audit : une promotion, des refus
    const ev = events(h, "role.grant");
    assert.equal(ev.filter((e) => e.result === "ok").length, 1);
    assert.equal(ev.find((e) => e.result === "ok")!.actor_label, "outil admin.js");
    assert.ok(ev.filter((e) => e.result === "refused").length >= 3);
  } finally { h.close(); }
});

// ---- §2 autorisation ------------------------------------------------------------------------

test("garde /api/admin : 401 sans session, 403 pour un utilisateur standard sur chaque route (liste complète)", async () => {
  const { h, u, admin, uid } = await setup();
  try {
    const registered = h.s.publicApp.routes.filter((r) => r.path.startsWith("/api/admin/") && r.method !== "ALL").map((r) => `${r.method} ${r.path}`);
    assert.deepEqual([...new Set(registered)].sort(), ADMIN_ROUTES.map(([m, p]) => `${m} ${p}`).sort(), "ADMIN_ROUTES doit lister toutes les routes");
    const anon = new Browser(h);
    for (const [method, path] of ADMIN_ROUTES) {
      const p = path.replace(":id", uid);
      const body = method === "GET" ? undefined : {};
      const r = await u.req(p, { method, body });
      assert.equal(r.status, 403, `${method} ${path}`);
      const text = await r.text();
      if (path === "/api/admin/session") assert.equal(text, "", "pas de corps pour auth_request");
      else assert.equal(JSON.parse(text).error, "forbidden");
      const a = await anon.req(p, { method, body });
      assert.equal(a.status, 401, `${method} ${path} (anonyme)`);
    }
    // tentative journalisée, au plus une fois par utilisateur et par 10 minutes
    const denied = events(h, "admin.access_denied");
    assert.equal(denied.length, 1);
    assert.deepEqual([denied[0]!.actor_user_id, denied[0]!.actor_label, denied[0]!.result], [uid, "user@example.test", "refused"]);
    // rien n'a changé
    assert.equal(roleOf(h, uid), "user");
    assert.equal((await admin.req("/api/admin/session")).status, 204);
    assert.equal(await (await admin.req("/api/admin/session")).text(), "");
    const me = await admin.json("/api/admin/me");
    assert.deepEqual(Object.keys(me.body).sort(), ["email", "id", "name", "role"]);
  } finally { h.close(); }
});

test("mutations : origine + JSON exigés, limiteur 60/min par admin, validation des requêtes", async () => {
  const { h, admin } = await setup();
  try {
    assert.equal((await admin.json("/api/admin/settings", { method: "PUT", body: { signupsOpen: true }, origin: "https://evil.example" })).status, 403);
    assert.equal((await admin.json("/api/admin/users?pageSize=101")).status, 400);
    assert.equal((await admin.json("/api/admin/users?page=0")).status, 400);
    assert.equal((await admin.json("/api/admin/users?sort=password")).body.error, "invalid_sort");
    assert.equal((await admin.json("/api/admin/users?dir=sideways")).status, 400);
    assert.equal((await admin.json("/api/admin/conversions?state=bogus")).status, 400);
    assert.equal((await admin.json("/api/admin/analytics?period=1y")).status, 400);
    assert.equal((await admin.json("/api/admin/users/inexistant")).status, 404);
    assert.equal((await admin.json("/api/admin/users/..%2Fx")).status, 404);
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await admin.json("/api/admin/settings", { method: "PUT", body: { signupsOpen: i % 2 === 0 } })).status);
    assert.deepEqual(codes.slice(0, 60), Array(60).fill(200));
    assert.equal(codes[60], 429);
    assert.equal((await admin.json("/api/admin/settings")).status, 200); // lecture toujours permise
  } finally { h.close(); }
});

// ---- §3 quotas ------------------------------------------------------------------------------

test("admin : quota illimité appliqué par consume() au-delà de la limite, max_active = plafond technique", async () => {
  const { h, admin, aid, u, key } = await setup({ DAILY_CONVERSIONS: "2" });
  try {
    const ak = (await admin.json("/api/keys", { method: "POST", body: { name: "Admin" } })).body.secret as string;
    for (let i = 0; i < 5; i++) {
      const r = await createJob(h, ak);
      assert.equal(r.body.allow, true, `création ${i + 1}`);
      assert.deepEqual(r.body.limits, { daily: 1_000_000, max_active: 5 });
    }
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_usage WHERE user_id = ?").get(aid) as { n: number }).n, 5); // usage enregistré
    const me = (await admin.json("/api/me")).body;
    assert.deepEqual([me.today.used, me.today.limit, me.today.remaining, me.today.unlimited, me.maxActive], [5, null, null, true, 5]);
    const p = h.s.usage.policyFor(aid);
    assert.deepEqual([p.unlimited, p.unlimitedByRole, p.maxActive], [true, true, 5]);
    // l'utilisateur standard reste limité (2 par jour, concurrence commerciale 1)
    const a = await createJob(h, key);
    assert.deepEqual(a.body.limits, { daily: 2, max_active: 1 });
    await createJob(h, key);
    assert.equal((await createJob(h, key)).body.reason, "quota_exceeded");
    const um = (await u.json("/api/me")).body;
    assert.deepEqual([um.today.limit, um.today.remaining, um.today.unlimited, um.maxActive], [2, 0, false, 1]);
  } finally { h.close(); }
  const h2 = await harness({ ADMIN_EMAILS: ADMIN, TECH_MAX_ACTIVE_PER_USER: "3" });
  try {
    const admin = await newUser(h2, ADMIN);
    const ak = (await admin.json("/api/keys", { method: "POST", body: { name: "Admin" } })).body.secret as string;
    assert.equal((await internalCall(h2, "/internal/v1/authorize", { key: ak, action: "access" })).body.limits.max_active, 3);
    assert.equal((await admin.json("/api/admin/settings")).body.techMaxActive, 3);
  } finally { h2.close(); }
});

test("quota d'un utilisateur : limite 1, bonus +1, remise à zéro, illimité, concurrence ; audit", async () => {
  const { h, admin, uid, key } = await setup();
  try {
    const put = (body: unknown) => admin.json(`/api/admin/users/${uid}/quota`, { method: "PUT", body });
    let r = await put({ dailyLimit: 1, unlimited: false, maxActive: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.policy, { dailyLimit: 1, unlimited: false, maxActive: null, resetAt: null });
    assert.deepEqual([r.body.effective.dailyLimit, r.body.effective.remaining], [1, 1]);
    assert.equal((await createJob(h, key)).body.allow, true);
    assert.equal((await createJob(h, key)).body.reason, "quota_exceeded");
    r = await admin.json(`/api/admin/users/${uid}/quota/grant`, { method: "POST", body: { amount: 1, reason: "Geste commercial" } });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.effective.dailyLimit, r.body.effective.todayBonus, r.body.effective.remaining], [2, 1, 1]);
    assert.equal((await createJob(h, key)).body.allow, true);
    assert.equal((await createJob(h, key)).body.reason, "quota_exceeded");
    r = await admin.json(`/api/admin/users/${uid}/quota/reset`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.effective.todayUsed, r.body.effective.remaining], [0, 2]);
    assert.equal((await createJob(h, key)).body.allow, true);
    assert.equal(h.s.usage.today(uid).used, 1);
    // concurrence personnalisée (≤ plafond technique), puis illimité
    r = await put({ maxActive: 3 });
    assert.equal(r.status, 200);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.limits.max_active, 3);
    r = await put({ unlimited: true });
    assert.deepEqual([r.body.effective.unlimited, r.body.effective.dailyLimit, r.body.effective.remaining, r.body.effective.maxActive], [true, null, null, 5]);
    for (let i = 0; i < 4; i++) assert.equal((await createJob(h, key)).body.allow, true);
    // validation
    assert.equal((await put({ dailyLimit: -1 })).status, 400);
    assert.equal((await put({ dailyLimit: 10_001 })).status, 400);
    assert.equal((await put({ dailyLimit: 1.5 })).status, 400);
    assert.equal((await put({ maxActive: 6 })).body.error, "invalid_max_active");
    assert.equal((await put({ unlimited: "yes" })).status, 400);
    assert.equal((await put({ role: "admin" })).body.error, "unknown_field");
    assert.equal((await admin.json(`/api/admin/users/${uid}/quota/grant`, { method: "POST", body: { amount: 0 } })).status, 400);
    assert.equal((await admin.json(`/api/admin/users/${uid}/quota/grant`, { method: "POST", body: { amount: 1001 } })).status, 400);
    assert.equal((await admin.json(`/api/admin/users/${uid}/quota/grant`, { method: "POST", body: { amount: 1, reason: "x".repeat(141) } })).status, 400);
    assert.equal((await admin.json("/api/admin/users/inconnu1234/quota", { method: "PUT", body: { dailyLimit: 1 } })).status, 404);
    // journal : acteur (e-mail), cible, résultat, avant/après
    for (const action of ["quota.update", "quota.grant", "quota.reset"]) {
      const ev = events(h, action);
      assert.ok(ev.length >= 1, action);
      for (const e of ev) assert.deepEqual([e.actor_label, e.target_type, e.target, e.result], [ADMIN, "quota", uid, "ok"]);
    }
    const first = JSON.parse(events(h, "quota.update")[0]!.details);
    assert.deepEqual([first.before.dailyLimit, first.after.dailyLimit], [null, 1]);
    // vue d'administration
    const d = (await admin.json(`/api/admin/users/${uid}`)).body;
    assert.equal(d.user.unlimited, true);
    assert.equal(d.policy.unlimited, true);
    assert.ok(d.audit.some((e: { action: string }) => e.action === "quota.grant"));
    const q = (await admin.json("/api/admin/quotas")).body;
    assert.deepEqual(q.global, { dailyLimit: 10, maxActive: 1, techMaxActive: 5 });
    assert.equal(q.custom.length, 1);
    assert.equal(q.custom[0].id, uid);
    assert.equal(q.custom[0].policy.maxActive, 3);
    assert.equal(q.series.length, 30);
  } finally { h.close(); }
});

// ---- révocation, suspension, gardes --------------------------------------------------------

test("révocation par l'admin : refus dès l'appel suivant ; jamais la valeur du jeton ; audit", async () => {
  const { h, admin, uid, key, keyId } = await setup();
  try {
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.allow, true);
    const r = await admin.json(`/api/admin/keys/${keyId}/revoke`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.key.state, r.body.key.revokedReason, r.body.key.userId], ["revoked", "admin", uid]);
    const after = await internalCall(h, "/internal/v1/authorize", { key, action: "access" });
    assert.deepEqual([after.body.allow, after.body.reason], [false, "invalid_key"]);
    const list = await admin.json("/api/admin/keys?state=revoked");
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].userEmail, "user@example.test");
    assert.ok(list.body.items[0].start.startsWith("ytc_"));
    assert.ok(!JSON.stringify(list.body).includes(key));
    assert.equal((await admin.json("/api/admin/keys?state=active")).body.total, 0);
    const ev = events(h, "key.revoke");
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0]!.actor_label, ev[0]!.target_type, ev[0]!.target, ev[0]!.result], [ADMIN, "key", keyId, "ok"]);
    assert.ok(!ev[0]!.details.includes(key));
    assert.equal((await admin.json("/api/admin/keys/inconnu12345/revoke", { method: "POST" })).status, 404);
  } finally { h.close(); }
});

test("suspension : sessions supprimées, jetons refusés aussitôt (user_suspended) ; réactivation", async () => {
  const { h, admin, u, uid, key } = await setup();
  try {
    const s = await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "suspended" } });
    assert.equal(s.status, 200);
    assert.equal(s.body.user.status, "suspended");
    assert.equal((h.s.db.prepare('SELECT count(*) n FROM session WHERE "userId" = ?').get(uid) as { n: number }).n, 0);
    assert.equal((await u.json("/api/me")).status, 401);
    assert.equal((await createJob(h, key)).body.reason, "user_suspended");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.reason, "user_suspended");
    const ev = events(h, "user.suspend");
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.actor_label, ADMIN);
    assert.ok(JSON.parse(ev[0]!.details).sessionsDeleted >= 1);
    assert.equal((await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "active" } })).status, 200);
    assert.equal((await createJob(h, key)).body.allow, true);
    assert.equal(events(h, "user.reactivate").length, 1);
    assert.equal((await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "banned" } })).status, 400);
  } finally { h.close(); }
});

test("gardes : pas de rétrogradation ni de suspension de soi-même, dernier admin protégé, promotion vérifiée", async () => {
  const { h, admin, aid, u, uid } = await setup();
  try {
    let r = await admin.json(`/api/admin/users/${aid}/role`, { method: "POST", body: { role: "user" } });
    assert.deepEqual([r.status, r.body.error], [400, "self_action"]);
    r = await admin.json(`/api/admin/users/${aid}/status`, { method: "POST", body: { status: "suspended" } });
    assert.deepEqual([r.status, r.body.error], [400, "self_action"]);
    assert.equal(roleOf(h, aid), "admin");
    assert.equal(countActiveAdmins(h.s.db), 1);
    assert.equal(countActiveAdmins(h.s.db, aid), 0); // ce que vérifient les gardes « dernier admin »
    const refused = [...events(h, "user.role"), ...events(h, "user.suspend")].filter((e) => e.result === "refused");
    assert.equal(refused.length, 2);
    assert.ok(refused.every((e) => e.actor_label === ADMIN && e.target === aid));
    // promotion d'un compte Google vérifié
    r = await admin.json(`/api/admin/users/${uid}/role`, { method: "POST", body: { role: "admin" } });
    assert.deepEqual([r.status, r.body.user.role], [200, "admin"]);
    assert.equal((await u.json("/api/admin/overview")).status, 200);
    assert.equal((await admin.json(`/api/admin/users/${uid}/role`, { method: "POST", body: { role: "admin" } })).body.changed, false);
    // l'ancien admin figure dans ADMIN_EMAILS : sa rétrogradation est refusée (elle serait annulée à sa
    // prochaine connexion) et il garde l'accès
    r = await u.json(`/api/admin/users/${aid}/role`, { method: "POST", body: { role: "user" } });
    assert.deepEqual([r.status, r.body.error], [409, "admin_email_configured"]);
    assert.equal((await admin.json("/api/admin/overview")).status, 200);
    assert.equal((await u.json(`/api/admin/users/${uid}/role`, { method: "POST", body: { role: "user" } })).body.error, "self_action");
    // promotion refusée : compte sans liaison Google, compte suspendu
    const ctx = await h.s.auth.$context;
    const lone = await ctx.internalAdapter.createUser({ email: "lone@example.test", name: "l", emailVerified: true }, { method: "admin" });
    r = await u.json(`/api/admin/users/${lone.id}/role`, { method: "POST", body: { role: "admin" } });
    assert.deepEqual([r.status, r.body.error], [409, "not_eligible"]);
    const sus = await newUser(h, "suspendu@example.test");
    const sid = (await sus.json("/api/me")).body.user.id as string;
    await u.json(`/api/admin/users/${sid}/status`, { method: "POST", body: { status: "suspended" } });
    r = await u.json(`/api/admin/users/${sid}/role`, { method: "POST", body: { role: "admin" } });
    assert.deepEqual([r.status, r.body.error], [409, "user_suspended"]);
    assert.equal((await u.json(`/api/admin/users/${aid}/role`, { method: "POST", body: { role: "owner" } })).status, 400);
    const ok = events(h, "user.role").filter((e) => e.result === "ok");
    assert.equal(ok.length, 1);
    assert.deepEqual(JSON.parse(ok[0]!.details), { before: { role: "user" }, after: { role: "admin" } });
  } finally { h.close(); }
});

test("journal : liste filtrée (action, résultat, acteur, cible), forme AuditEvent", async () => {
  const { h, admin, uid } = await setup();
  try {
    await admin.json(`/api/admin/users/${uid}/quota/grant`, { method: "POST", body: { amount: 2 } });
    await admin.json(`/api/admin/users/${uid}/quota/reset`, { method: "POST" });
    await admin.json("/api/admin/settings", { method: "PUT", body: { signupsOpen: false } });
    const all = (await admin.json("/api/admin/audit?pageSize=100")).body;
    assert.ok(all.total >= 4); // + role.bootstrap
    assert.deepEqual(Object.keys(all.items[0]).sort(), ["action", "actorId", "actorLabel", "at", "details", "id", "result", "target", "targetType"]);
    const q = (await admin.json("/api/admin/audit?action=quota")).body;
    assert.deepEqual(q.items.map((e: { action: string }) => e.action).sort(), ["quota.grant", "quota.reset"]);
    assert.equal((await admin.json("/api/admin/audit?action=quota.grant")).body.total, 1);
    assert.equal((await admin.json(`/api/admin/audit?target=${uid}`)).body.total, 2);
    assert.equal((await admin.json("/api/admin/audit?target=setting")).body.total, 1);
    assert.equal((await admin.json("/api/admin/audit?actor=admin@example")).body.total, 3);
    assert.equal((await admin.json("/api/admin/audit?result=refused")).body.total, 0);
    assert.equal((await admin.json("/api/admin/audit?result=maybe")).status, 400);
    const s = (await admin.json("/api/admin/audit?action=settings.update")).body.items[0];
    assert.deepEqual([s.details.before.signupsOpen, s.details.after.signupsOpen, s.result, s.actorLabel], [true, false, "ok", ADMIN]);
  } finally { h.close(); }
});

// ---- §6 réglages, §7 lien du raccourci --------------------------------------------------------

test("réglages : validation (lien iCloud, message ≤ 280, plateformes, concurrence), /api/config suit le réglage", async () => {
  const { h, admin, key } = await setup({ ICLOUD_SHORTCUT_URL: ICLOUD_A });
  try {
    const pub = new Browser(h);
    const cfg0 = (await pub.json("/api/config")).body;
    assert.deepEqual([cfg0.icloudUrl, cfg0.maintenanceMessage, cfg0.platforms, cfg0.quotas.maxActive], [ICLOUD_A, null, { youtube: true, tiktok: true, twitter: true }, 1]);
    const st0 = (await admin.json("/api/admin/settings")).body;
    assert.deepEqual(st0, {
      dailyLimit: 10, maxActive: 1, conversionsPaused: false, signupsOpen: true, maintenanceMessage: null,
      platforms: { youtube: true, tiktok: true, twitter: true }, shortcutUrl: ICLOUD_A, techMaxActive: 5, updatedAt: null, updatedBy: null,
    });
    const put = (body: unknown) => admin.json("/api/admin/settings", { method: "PUT", body });
    for (const bad of ["https://evil.example/shortcuts/" + "a".repeat(32), "http://www.icloud.com/shortcuts/" + "a".repeat(32),
      "https://www.icloud.com/shortcuts/" + "A".repeat(32), "https://www.icloud.com/shortcuts/" + "a".repeat(31), ICLOUD_A + "?x=1", 42]) {
      const r = await put({ shortcutUrl: bad });
      assert.deepEqual([r.status, r.body.error], [400, "invalid_shortcut_url"], String(bad));
    }
    assert.equal((await put({ maintenanceMessage: "é".repeat(281) })).body.error, "invalid_message");
    assert.equal((await put({ maintenanceMessage: "a\u0007b" })).status, 400);
    assert.equal((await put({ maxActive: 6 })).body.error, "invalid_max_active");
    assert.equal((await put({ platforms: { myspace: true } })).body.error, "invalid_platforms");
    assert.equal((await put({ platforms: { youtube: "non" } })).status, 400);
    assert.equal((await put({ conversionsPaused: "true" })).status, 400);
    assert.equal((await put({ bogus: 1 })).body.error, "unknown_field");
    assert.equal(events(h, "settings.update").length, 0); // rien d'écrit
    let r = await put({ shortcutUrl: ICLOUD_B, maintenanceMessage: "é".repeat(280), maxActive: 2 });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.shortcutUrl, r.body.maxActive, r.body.updatedBy], [ICLOUD_B, 2, ADMIN]);
    const cfg1 = (await pub.json("/api/config")).body;
    assert.deepEqual([cfg1.icloudUrl, cfg1.maintenanceMessage, cfg1.quotas.maxActive], [ICLOUD_B, "é".repeat(280), 2]);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.limits.max_active, 2);
    const ev = events(h, "settings.update");
    assert.equal(ev.length, 1);
    const d = JSON.parse(ev[0]!.details);
    assert.deepEqual([d.before.shortcutUrl, d.after.shortcutUrl, d.before.maxActive, d.after.maxActive], [ICLOUD_A, ICLOUD_B, 1, 2]);
    assert.deepEqual([ev[0]!.actor_label, ev[0]!.target_type, ev[0]!.result], [ADMIN, "setting", "ok"]);
    // retour aux valeurs du serveur
    r = await put({ shortcutUrl: null, maintenanceMessage: "", maxActive: null });
    assert.deepEqual([r.body.shortcutUrl, r.body.maintenanceMessage, r.body.maxActive], [ICLOUD_A, null, 1]);
    assert.equal((await pub.json("/api/config")).body.icloudUrl, ICLOUD_A);
    // plateformes : mise à jour partielle
    r = await put({ platforms: { tiktok: false } });
    assert.deepEqual(r.body.platforms, { youtube: true, tiktok: false, twitter: true });
    assert.deepEqual((await pub.json("/api/config")).body.platforms, { youtube: true, tiktok: false, twitter: true });
    // ancienne forme POST conservée ; quotas globaux
    assert.equal((await admin.json("/api/admin/settings", { method: "POST", body: { dailyLimit: 3 } })).body.dailyLimit, 3);
    r = await admin.json("/api/admin/quotas/global", { method: "PUT", body: { dailyLimit: 4, maxActive: 2 } });
    assert.deepEqual(r.body.global, { dailyLimit: 4, maxActive: 2, techMaxActive: 5 });
    assert.equal(events(h, "quota.global").length, 1);
    assert.equal((await admin.json("/api/admin/quotas/global", { method: "PUT", body: { dailyLimit: -2 } })).status, 400);
  } finally { h.close(); }
});

test("/api/config : icloudUrl absent sans variable ni réglage", async () => {
  const { h, admin } = await setup();
  try {
    assert.equal((await new Browser(h).json("/api/config")).body.icloudUrl, null);
    await admin.json("/api/admin/settings", { method: "PUT", body: { shortcutUrl: ICLOUD_B } });
    assert.equal((await new Browser(h).json("/api/config")).body.icloudUrl, ICLOUD_B);
  } finally { h.close(); }
});

// ---- API interne ----------------------------------------------------------------------------

test("plateforme désactivée : refus platform_disabled à la création, sans réservation ; le polling reste permis", async () => {
  const { h, admin, uid, key } = await setup();
  try {
    await admin.json("/api/admin/settings", { method: "PUT", body: { platforms: { tiktok: false, twitter: false } } });
    const r = await createJob(h, key, { platform: "tiktok" });
    assert.deepEqual(r.body, { allow: false, reason: "platform_disabled", message: "Cette plateforme est temporairement désactivée." });
    assert.equal((await createJob(h, key, { platform: "x" })).body.reason, "platform_disabled");
    assert.equal((await createJob(h, key, { platform: "youtube" })).body.allow, true);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access", platform: "tiktok" })).body.allow, true);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_usage WHERE user_id = ?").get(uid) as { n: number }).n, 1);
    assert.equal((h.s.db.prepare("SELECT count FROM ytc_auth_failure WHERE reason = 'platform_disabled'").get() as { count: number }).count, 2);
  } finally { h.close(); }
});

test("événements d'usage : job_id retenu, started_at posé, cause nettoyée (URL, jetons, suites opaques)", async () => {
  const { h, admin, key } = await setup();
  try {
    const id = (await createJob(h, key)).body.usage_id as string;
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "running", job_id: "job_AbC-123" })).status, 200);
    let row = h.s.db.prepare("SELECT job_id, started_at, cause FROM ytc_usage WHERE id = ?").get(id) as { job_id: string; started_at: string | null; cause: string | null };
    assert.equal(row.job_id, "job_AbC-123");
    assert.ok(row.started_at);
    const started = row.started_at;
    await internalCall(h, `/internal/v1/usage/${id}`, { state: "running", job_id: "job_AbC-123" });
    const raw = "ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 403: Forbidden https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&sig=AAAA " +
      "Authorization: Bearer abc.def-ghi ytc_SecretToken123 cookie=" + "Z".repeat(40) + " owner@example.test youtube.com/watch?v=x\n" + "y".repeat(400);
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "error", error_code: "upstream_forbidden", job_id: "job_AbC-123", cause: raw })).status, 200);
    row = h.s.db.prepare("SELECT job_id, started_at, cause FROM ytc_usage WHERE id = ?").get(id) as typeof row;
    assert.equal(row.started_at, started);
    const cause = row.cause!;
    assert.ok(cause.length <= 300, String(cause.length));
    assert.match(cause, /^ERROR: \[youtube\] dQw4w9WgXcQ: HTTP Error 403: Forbidden \[url\]/);
    for (const leak of ["http", "googlevideo", "sig=", "abc.def", "ytc_Secret", "ZZZZZZZZ", "@", "youtube.com", "\n", "yyyyyyyy"]) {
      assert.ok(!cause.includes(leak), `fuite : ${leak} dans « ${cause} »`);
    }
    // job_id mal formé : ignoré, la transition est gardée
    const id2 = (await createJob(h, key)).body.usage_id as string;
    assert.equal((await internalCall(h, `/internal/v1/usage/${id2}`, { state: "done", job_id: "bad id!", size_bytes: 10 })).status, 200);
    const row2 = h.s.db.prepare("SELECT state, job_id, started_at FROM ytc_usage WHERE id = ?").get(id2) as { state: string; job_id: string | null; started_at: string | null };
    assert.deepEqual([row2.state, row2.job_id, row2.started_at], ["done", null, null]);
    // vue d'administration
    const c = (await admin.json(`/api/admin/conversions/${id}`)).body;
    assert.deepEqual([c.jobId, c.state, c.errorCode, c.keyName, c.userEmail], ["job_AbC-123", "error", "upstream_forbidden", "iPhone", "user@example.test"]);
    assert.equal(c.cause, cause);
    assert.equal(c.errorMessage, "Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403).");
    assert.ok(typeof c.processingS === "number" && c.processingS >= 0);
    assert.ok(typeof c.durationS === "number" && c.durationS >= c.processingS);
    assert.equal((await admin.json(`/api/admin/conversions?q=job_AbC-123`)).body.total, 1);
    assert.equal((await admin.json(`/api/admin/conversions?state=done`)).body.items[0].id, id2);
    // la liste ne transporte jamais la cause
    assert.ok(!JSON.stringify((await admin.json("/api/admin/conversions")).body).includes("dQw4w9WgXcQ"));
  } finally { h.close(); }
});

test("refus agrégés par jour et motif ; dernière utilisation du jeton (au plus 1 écriture/min)", async () => {
  const { h, admin, u, key, keyId } = await setup();
  try {
    for (let i = 0; i < 3; i++) await internalCall(h, "/internal/v1/authorize", { key: "ytc_" + "Z".repeat(64), action: "access" });
    await internalCall(h, "/internal/v1/authorize", { key: "pas-un-jeton", action: "access" });
    await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "gif" });
    const rows = h.s.db.prepare("SELECT reason, count FROM ytc_auth_failure ORDER BY reason").all() as { reason: string; count: number }[];
    assert.deepEqual(rows.map((r) => [r.reason, r.count]), [["format_not_allowed", 1], ["invalid_key", 4]]);
    assert.equal(h.s.authorizer.recentAuthFailures(), 4);
    const af = (await admin.json("/api/admin/keys/auth-failures?days=7")).body;
    assert.deepEqual(af.byReason, [{ reason: "invalid_key", count: 4 }, { reason: "format_not_allowed", count: 1 }]);
    assert.equal(af.series.length, 7);
    assert.equal(af.series[6].count, 5);
    assert.ok(af.lastAt);
    assert.equal((await admin.json("/api/admin/keys/auth-failures?days=0")).status, 400);
    // last_used_at : posé à l'autorisation, pas réécrit dans la minute
    const lastUsed = () => (h.s.db.prepare("SELECT last_used_at FROM ytc_key_meta WHERE key_id = ?").get(keyId) as { last_used_at: string | null } | undefined)?.last_used_at;
    assert.equal(lastUsed() ?? null, null); // un refus ne compte pas comme utilisation
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.allow, true);
    const t1 = lastUsed();
    assert.ok(t1);
    await new Promise((r) => setTimeout(r, 5));
    await internalCall(h, "/internal/v1/authorize", { key, action: "access" });
    assert.equal(lastUsed(), t1);
    // ligne de métadonnées absente : recréée
    const k2 = (await u.json("/api/keys", { method: "POST", body: { name: "iPad" } })).body;
    h.s.db.prepare("DELETE FROM ytc_key_meta WHERE key_id = ?").run(k2.key.id);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k2.secret, action: "access" })).body.allow, true);
    assert.ok((h.s.db.prepare("SELECT last_used_at FROM ytc_key_meta WHERE key_id = ?").get(k2.key.id) as { last_used_at: string }).last_used_at);
    const keys = (await admin.json("/api/admin/keys?sort=lastUsedAt")).body.items;
    assert.equal(keys.length, 2);
    assert.ok(keys.every((k: { lastUsedAt: string | null }) => k.lastUsedAt));
    void INTERNAL;
  } finally { h.close(); }
});

// ---- conversions : annulation via ytapi ------------------------------------------------------

test("annulation : seulement reserved/running avec job connu ; appel ytapi avec le jeton interne ; 409/502 ; audit", async () => {
  const { h, admin, key } = await setup();
  try {
    const id = (await createJob(h, key)).body.usage_id as string;
    let r = await admin.json(`/api/admin/conversions/${id}/cancel`, { method: "POST" });
    assert.deepEqual([r.status, r.body.error], [409, "not_cancellable"]); // job inconnu
    await internalCall(h, `/internal/v1/usage/${id}`, { state: "running", job_id: "job1" });
    // progression en POURCENTAGE (0–100), telle que ytapi la mesure (docs/ADMIN.md §6)
    h.ytapi.jobs = [{ job_id: "job1", usage_id: id, stage: "download", progress: 40, url: "https://never.example/x" }];
    const live = (await admin.json(`/api/admin/conversions/${id}`)).body;
    assert.deepEqual(live.live, { stage: "download", progress: 40 });
    assert.ok(!JSON.stringify(live).includes("never.example"));
    r = await admin.json(`/api/admin/conversions/${id}/cancel`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.deepEqual(h.ytapi.cancelled, ["job1"]);
    const call = h.ytapi.calls.find((c) => c.path === "/internal/v1/jobs/job1/cancel")!;
    assert.deepEqual([call.method, call.token], ["POST", INTERNAL]);
    assert.equal((h.s.db.prepare("SELECT state FROM ytc_usage WHERE id = ?").get(id) as { state: string }).state, "running"); // ytapi enverra « cancelled »
    h.ytapi.cancelStatus = 404;
    assert.equal((await admin.json(`/api/admin/conversions/${id}/cancel`, { method: "POST" })).status, 409);
    h.ytapi.cancelStatus = 200;
    h.ytapiUp.value = false;
    r = await admin.json(`/api/admin/conversions/${id}/cancel`, { method: "POST" });
    assert.deepEqual([r.status, r.body.error], [502, "ytapi_unreachable"]);
    h.ytapiUp.value = true;
    await internalCall(h, `/internal/v1/usage/${id}`, { state: "cancelled", error_code: "cancelled" });
    assert.equal((await admin.json(`/api/admin/conversions/${id}/cancel`, { method: "POST" })).status, 409);
    const ev = events(h, "conversion.cancel");
    assert.deepEqual(ev.map((e) => e.result), ["refused", "ok", "refused", "error", "refused"]);
    assert.ok(ev.every((e) => e.actor_label === ADMIN && e.target_type === "job"));
    assert.equal(ev[1]!.target, "job1");
  } finally { h.close(); }
});

// ---- migration 003 --------------------------------------------------------------------------

test("migration 003 : reprise de dailyLimitOverride, down puis up idempotents", async () => {
  const { migrateDown, migrateUp, appliedVersions } = await import("../src/db.ts");
  const h = await harness();
  try {
    const db = h.s.db;
    const u = await newUser(h, "mig@example.test");
    const uid = (await u.json("/api/me")).body.user.id as string;
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    const tables = () => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ytc_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    // 004 (extension) et 005 (Discord) sont au-dessus de 003 : on redescend des trois, puis on remonte des trois.
    assert.deepEqual(migrateDown(db, 13), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    assert.ok(!cols("ytc_usage").some((c) => ["job_id", "started_at", "cause"].includes(c)));
    assert.ok(!cols("ytc_key_meta").includes("last_used_at"));
    assert.ok(!cols("ytc_admin_event").some((c) => ["actor_label", "target_type", "result"].includes(c)));
    assert.deepEqual(tables(), ["ytc_admin_event", "ytc_key_meta", "ytc_migration", "ytc_quota_ledger", "ytc_setting", "ytc_usage"]);
    // ancien quota personnalisé → repris dans ytc_user_policy
    db.prepare('UPDATE "user" SET "dailyLimitOverride" = 3 WHERE id = ?').run(uid);
    assert.deepEqual(migrateUp(db), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.equal(h.s.usage.policyRow(uid)!.daily_limit, 3);
    assert.equal(h.s.usage.policyFor(uid).dailyLimit, 3);
    assert.equal((await u.json("/api/me")).body.today.limit, 3);
    // retour arrière : la valeur courante revient dans la colonne lue par l'ancien code
    tx(db, () => h.s.usage.setPolicySync(uid, { dailyLimit: 7, unlimited: false, maxActive: null }, null));
    assert.deepEqual(migrateDown(db, 13), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    assert.equal((db.prepare('SELECT "dailyLimitOverride" AS o FROM "user" WHERE id = ?').get(uid) as { o: number }).o, 7);
    assert.deepEqual(migrateUp(db), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.equal(h.s.usage.policyRow(uid)!.daily_limit, 7);
    assert.deepEqual(migrateUp(db), []);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.ok(tables().includes("ytc_user_policy") && tables().includes("ytc_quota_grant") && tables().includes("ytc_auth_failure"));
  } finally { h.close(); }
});

// ---- relecture du Control Center (2026-10-10) -------------------------------------------------

test("rétrogradation d'une adresse d'ADMIN_EMAILS refusée (elle serait re-promue à la connexion)", async () => {
  const { h, admin, aid, u, uid } = await setup();
  try {
    assert.equal((await admin.json(`/api/admin/users/${uid}/role`, { method: "POST", body: { role: "admin" } })).status, 200);
    const r = await u.json(`/api/admin/users/${aid}/role`, { method: "POST", body: { role: "user" } });
    assert.deepEqual([r.status, r.body.error], [409, "admin_email_configured"]);
    assert.match(r.body.message, /ADMIN_EMAILS/);
    assert.equal(roleOf(h, aid), "admin");
    const ev = events(h, "user.role").at(-1)!;
    assert.deepEqual([ev.result, ev.target, JSON.parse(ev.details).reason], ["refused", aid, "admin_email_configured"]);
    // une adresse hors ADMIN_EMAILS reste rétrogradable par un autre administrateur
    assert.equal((await admin.json(`/api/admin/users/${uid}/role`, { method: "POST", body: { role: "user" } })).status, 200);
  } finally { h.close(); }
});

test("dernier administrateur actif : suppression de son propre compte refusée ; permise s'il y en a un autre", async () => {
  const { h, admin, aid, uid } = await setup();
  try {
    const r = await admin.json("/api/auth/delete-user", { method: "POST", body: {} });
    assert.notEqual(r.status, 200);
    assert.equal(r.body?.code ?? r.body?.error, "last_admin");
    assert.ok(h.s.db.prepare('SELECT id FROM "user" WHERE id = ?').get(aid), "le compte existe toujours");
    // avec un second administrateur actif, la suppression passe
    assert.equal((await admin.json(`/api/admin/users/${uid}/role`, { method: "POST", body: { role: "admin" } })).status, 200);
    const ok = await admin.json("/api/auth/delete-user", { method: "POST", body: {} });
    assert.equal(ok.status, 200);
    assert.equal(h.s.db.prepare('SELECT id FROM "user" WHERE id = ?').get(aid), undefined);
  } finally { h.close(); }
});

test("outil : grant sur un administrateur suspendu refusé (pas « déjà admin »), reactivate explicite et journalisé", async () => {
  const { h, aid } = await setup();
  try {
    h.s.db.prepare('UPDATE "user" SET status = \'suspended\' WHERE id = ?').run(aid);
    const g = tx(h.s.db, () => grantAdmin(h.s.db, ADMIN, "test"));
    assert.deepEqual([g.ok, g.code], [false, "user_suspended"]);
    const r1 = tx(h.s.db, () => reactivateUser(h.s.db, ADMIN, "test"));
    assert.deepEqual([r1.ok, r1.code], [true, "reactivated"]);
    assert.equal((h.s.db.prepare('SELECT status FROM "user" WHERE id = ?').get(aid) as { status: string }).status, "active");
    const r2 = tx(h.s.db, () => reactivateUser(h.s.db, ADMIN, "test"));
    assert.deepEqual([r2.ok, r2.code], [true, "already_active"]);
    assert.equal(tx(h.s.db, () => reactivateUser(h.s.db, "absent@example.test", "test")).ok, false);
    const ev = events(h, "user.status");
    assert.deepEqual(ev.map((e) => [e.actor_label, e.result]), [["test", "ok"], ["test", "refused"]]);
  } finally { h.close(); }
});

test("annulation d'une conversion encore en file : job retrouvé auprès de ytapi par l'identifiant d'usage", async () => {
  const { h, admin, key } = await setup();
  try {
    const id = (await createJob(h, key)).body.usage_id as string; // « reserved », pas encore de job_id
    h.ytapi.jobs = [{ job_id: "jobQ", usage_id: id, stage: "queued", progress: 0 }];
    const r = await admin.json(`/api/admin/conversions/${id}/cancel`, { method: "POST" });
    assert.deepEqual([r.status, r.body.jobId], [200, "jobQ"]);
    assert.deepEqual(h.ytapi.cancelled, ["jobQ"]);
    assert.equal(events(h, "conversion.cancel").at(-1)!.target, "jobQ");
  } finally { h.close(); }
});

test("API interne de ytapi non configurée (https://) : avertissement de configuration, pas « ytapi ne répond pas »", async () => {
  const { h, admin } = await setup({ YTAPI_INTERNAL_URL: "https://api.example.test/media" });
  try {
    const alerts = (await admin.json("/api/admin/overview")).body.alerts as { level: string; code: string }[];
    assert.ok(alerts.some((a) => a.code === "ytapi_internal_unconfigured" && a.level === "warning"), JSON.stringify(alerts));
    assert.ok(!alerts.some((a) => a.code === "ytapi_unreachable"));
    assert.equal(h.ytapi.calls.length, 0, "le jeton interne n'est jamais envoyé en https");
  } finally { h.close(); }
});

test("compteurs « en cours » : une ligne reserved/running de plus de 3 h (job perdu par ytapi) n'est pas comptée", async () => {
  const { h, admin, key } = await setup();
  try {
    const fresh = (await createJob(h, key)).body.usage_id as string;
    await internalCall(h, `/internal/v1/usage/${fresh}`, { state: "running", job_id: "jobF" });
    const old = (await createJob(h, key)).body.usage_id as string;
    await internalCall(h, `/internal/v1/usage/${old}`, { state: "running", job_id: "jobO" });
    h.s.db.prepare("UPDATE ytc_usage SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 4 * 3_600_000).toISOString(), old);
    const o = (await admin.json("/api/admin/overview")).body;
    assert.equal(o.conversions.running, 1);
  } finally { h.close(); }
});
