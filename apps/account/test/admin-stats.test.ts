// Statistiques du Control Center : les chiffres renvoyés sont exactement ceux des lignes insérées
// (vue d'ensemble, utilisateurs, conversions, quotas, analyses), et l'état système / les alertes
// viennent de l'API interne de ytapi (fausse ici) et de la base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parisDay } from "../src/time.ts";
import { initials, lastParisDays, p90, parisDayStart } from "../src/stats.ts";
import { harness, INTERNAL, internalCall, newUser, type Harness } from "./helpers.ts";

const MIN = 60_000;
const DAY = 86_400_000;

interface Fx { id: string; state: string; fmt: string; platform: string; agoMs: number; dur?: number; started?: number; size?: number; code?: string }
const FIXTURES: Fx[] = [
  { id: "fx-a-000001", state: "done", fmt: "mp3", platform: "youtube", agoMs: 10 * MIN, started: 2, dur: 10, size: 1000 },
  { id: "fx-b-000002", state: "done", fmt: "mp3", platform: "youtube", agoMs: 9 * MIN, dur: 20, size: 2000 },
  { id: "fx-c-000003", state: "done", fmt: "mp4", platform: "youtube", agoMs: 8 * MIN, dur: 30, size: 3000 },
  { id: "fx-d-000004", state: "error", fmt: "mp4", platform: "tiktok", agoMs: 7 * MIN, dur: 5, code: "private" },
  { id: "fx-e-000005", state: "running", fmt: "mp3", platform: "x", agoMs: 1 * MIN, started: 1 },
  { id: "fx-f-000006", state: "refunded", fmt: "mp3", platform: "youtube", agoMs: 2 * MIN, dur: 1 },
  { id: "fx-g-000007", state: "done", fmt: "mp3", platform: "youtube", agoMs: 40 * DAY, dur: 60, size: 4000 },
];

async function setup() {
  const h = await harness({ ADMIN_EMAILS: "admin@example.test" });
  const admin = await newUser(h, "admin@example.test");
  const u = await newUser(h, "stats@example.test");
  const uid = (await u.json("/api/me")).body.user.id as string;
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const ins = h.s.db.prepare(
    "INSERT INTO ytc_usage (id, user_id, key_id, day, fmt, platform, state, error_code, size_bytes, created_at, updated_at, finished_at, job_id, started_at) " +
    "VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const f of FIXTURES) {
    const created = now - f.agoMs;
    const finished = f.dur !== undefined ? created + f.dur * 1000 : null;
    ins.run(f.id, uid, parisDay(new Date(created)), f.fmt, f.platform, f.state, f.code ?? null, f.size ?? null, iso(created),
      iso(finished ?? created), finished === null ? null : iso(finished), `job-${f.id}`, f.started !== undefined ? iso(created + f.started * 1000) : null);
  }
  // Conversions du jour (heure de Paris) : calculées à partir des fixtures, sans dépendre de l'heure du test.
  const today = parisDay();
  const todayCount = FIXTURES.filter((f) => f.state !== "refunded" && parisDay(new Date(now - f.agoMs)) === today).length;
  // Quota consommé : ni les unités rendues ni les échecs (2026-10-13) ; les statistiques comptent toujours les échecs.
  const todayUsed = FIXTURES.filter((f) => f.state !== "refunded" && f.state !== "error" && parisDay(new Date(now - f.agoMs)) === today).length;
  return { h, admin, u, uid, now, todayCount, todayUsed };
}

test("vue d'ensemble : chiffres égaux aux lignes insérées", async () => {
  const { h, admin, todayCount } = await setup();
  try {
    const ov = (await admin.json("/api/admin/overview")).body;
    const users = h.s.db.prepare('SELECT "createdAt" AS c FROM "user"').all() as { c: string }[];
    assert.deepEqual(ov.users, {
      total: 2, newToday: users.filter((x) => parisDay(new Date(x.c)) === parisDay()).length, new30d: 2, active24h: 2, active30d: 2,
    });
    assert.deepEqual(ov.conversions, {
      today: todayCount, last30d: 5, running: 1, successRate30d: 0.75, failures30d: 1, avgDurationS30d: 20,
      byFormat: { mp3: 3, mp4: 2 }, byPlatform: { youtube: 3, tiktok: 1, twitter: 1, other: 0 },
    });
    assert.deepEqual(ov.jobs, { active: 1, queued: 0 }); // file de ytapi (API interne)
    assert.deepEqual(ov.alerts, []);
  } finally { h.close(); }
});

test("utilisateurs : UserRow complet, tri, filtres, pagination ; fiche détaillée", async () => {
  const { h, admin, uid, todayUsed } = await setup();
  try {
    const list = (await admin.json("/api/admin/users?sort=conversions")).body;
    assert.deepEqual([list.total, list.page, list.pageSize, list.items.length], [2, 1, 25, 2]);
    const s = list.items[0];
    assert.deepEqual(Object.keys(s).sort(), ["activeKeys", "conversions30d", "conversionsTotal", "createdAt", "dailyLimit", "email", "id", "initials",
      "lastActiveAt", "name", "role", "status", "todayUsed", "unlimited"]);
    assert.deepEqual([s.id, s.initials, s.conversions30d, s.conversionsTotal, s.todayUsed, s.dailyLimit, s.unlimited, s.activeKeys, s.role, s.status],
      [uid, "S", 5, 6, todayUsed, 10, false, 0, "user", "active"]);
    assert.ok(s.lastActiveAt && s.lastActiveAt >= s.createdAt);
    assert.ok(!("image" in s) && !("avatar" in s));
    const a = list.items[1];
    assert.deepEqual([a.role, a.unlimited, a.dailyLimit, a.initials], ["admin", true, null, "A"]);
    assert.equal((await admin.json("/api/admin/users?sort=email&dir=asc")).body.items[0].email, "admin@example.test");
    const p2 = (await admin.json("/api/admin/users?pageSize=1&page=2&sort=email&dir=asc")).body;
    assert.deepEqual([p2.total, p2.items.length, p2.items[0].email], [2, 1, "stats@example.test"]);
    assert.equal((await admin.json("/api/admin/users?role=admin")).body.total, 1);
    assert.equal((await admin.json("/api/admin/users?status=suspended")).body.total, 0);
    assert.equal((await admin.json("/api/admin/users?q=STATS")).body.total, 1);
    assert.equal((await admin.json("/api/admin/users?q=%25")).body.total, 0); // % littéral
    const d = (await admin.json(`/api/admin/users/${uid}`)).body;
    assert.deepEqual(d.stats, { total: 6, done: 4, error: 1, byFormat: { mp3: 4, mp4: 2 }, byPlatform: { youtube: 4, tiktok: 1, twitter: 1, other: 0 }, avgDurationS: 30 });
    assert.deepEqual(d.policy, { dailyLimit: null, unlimited: false, maxActive: null, resetAt: null });
    assert.deepEqual(d.effective, { dailyLimit: 10, unlimited: false, maxActive: 1, todayUsed, todayBonus: 0, remaining: 10 - todayUsed });
    assert.equal(d.recentActivity.length, 7);
    assert.deepEqual(d.recentErrors.map((c: { id: string }) => c.id), ["fx-d-000004"]);
    assert.deepEqual(d.keys, []);
    assert.ok(Array.isArray(d.audit));
  } finally { h.close(); }
});

test("conversions : forme Conversion, durées, filtres, tri par durée (nulles en dernier)", async () => {
  const { h, admin, uid } = await setup();
  try {
    const all = (await admin.json("/api/admin/conversions?pageSize=100")).body;
    assert.equal(all.total, 7);
    const a = all.items.find((c: { id: string }) => c.id === "fx-a-000001");
    assert.deepEqual(Object.keys(a).sort(), ["createdAt", "durationS", "errorCode", "errorMessage", "finishedAt", "fmt", "id", "jobId", "platform",
      "processingS", "sizeBytes", "startedAt", "state", "userEmail", "userId"]);
    assert.deepEqual([a.jobId, a.userId, a.userEmail, a.durationS, a.processingS, a.sizeBytes], ["job-fx-a-000001", uid, "stats@example.test", 10, 8, 1000]);
    const d = all.items.find((c: { id: string }) => c.id === "fx-d-000004");
    assert.deepEqual([d.errorCode, d.errorMessage, d.processingS], ["private", "La vidéo est privée.", null]);
    const asc = (await admin.json("/api/admin/conversions?sort=durationS&dir=asc")).body.items.map((c: { id: string }) => c.id.slice(3, 4));
    assert.deepEqual(asc, ["f", "d", "a", "b", "c", "g", "e"]);
    const desc = (await admin.json("/api/admin/conversions?sort=durationS&dir=desc")).body.items.map((c: { id: string }) => c.id.slice(3, 4));
    assert.deepEqual(desc, ["g", "c", "b", "a", "d", "f", "e"]);
    assert.deepEqual((await admin.json("/api/admin/conversions?sort=createdAt&dir=desc&pageSize=2")).body.items.map((c: { id: string }) => c.id.slice(3, 4)), ["e", "f"]);
    assert.equal((await admin.json("/api/admin/conversions?platform=twitter")).body.items[0].id, "fx-e-000005");
    assert.equal((await admin.json("/api/admin/conversions?platform=other")).body.total, 0);
    assert.equal((await admin.json("/api/admin/conversions?fmt=mp4")).body.total, 2);
    assert.equal((await admin.json("/api/admin/conversions?state=refunded")).body.total, 1);
    assert.equal((await admin.json(`/api/admin/conversions?userId=${uid}&state=done`)).body.total, 4);
    assert.equal((await admin.json("/api/admin/conversions?q=stats@")).body.total, 7);
    assert.equal((await admin.json("/api/admin/conversions/fx-z-999999")).status, 404);
  } finally { h.close(); }
});

test("quotas : séries sur 30 jours, utilisateurs à la limite", async () => {
  const { h, admin, uid, todayCount, todayUsed } = await setup();
  try {
    let q = (await admin.json("/api/admin/quotas")).body;
    assert.deepEqual(q.global, { dailyLimit: 10, maxActive: 1, techMaxActive: 5 });
    assert.deepEqual(q.today, { conversions: todayCount, users: todayCount > 0 ? 1 : 0 });
    assert.equal(q.series.length, 30);
    assert.equal(q.series[29].day, parisDay());
    assert.equal(q.series.reduce((s: number, x: { conversions: number }) => s + x.conversions, 0), 5);
    assert.deepEqual(q.atLimit, []);
    if (todayUsed > 0) {
      await admin.json(`/api/admin/users/${uid}/quota`, { method: "PUT", body: { dailyLimit: todayUsed } });
      q = (await admin.json("/api/admin/quotas")).body;
      assert.deepEqual(q.atLimit.map((r: { id: string }) => r.id), [uid]);
      assert.equal(q.custom[0].policy.dailyLimit, todayUsed);
    }
  } finally { h.close(); }
});

test("analyses : seaux (24 h horaires, 7 j et 30 j quotidiens, heure de Paris) égaux aux lignes insérées", async () => {
  const { h, admin, now, todayCount, todayUsed } = await setup();
  try {
    const sum = (b: Record<string, number>[], k: string) => b.reduce((s, x) => s + (x[k] ?? 0), 0);
    const a7 = (await admin.json("/api/admin/analytics?period=7d")).body;
    assert.equal(a7.period, "7d");
    assert.equal(a7.buckets.length, 7);
    assert.deepEqual(a7.buckets.map((b: { start: string }) => b.start), lastParisDays(7).map((d) => parisDayStart(d).toISOString()));
    assert.deepEqual(["conversions", "done", "error", "mp3", "mp4", "signups"].map((k) => sum(a7.buckets, k)), [5, 3, 1, 3, 2, 2]);
    assert.equal(a7.buckets[6].conversions, todayCount);
    assert.deepEqual(a7.successByPlatform, [
      { platform: "youtube", done: 3, error: 0, rate: 1 }, { platform: "tiktok", done: 0, error: 1, rate: 0 },
      { platform: "twitter", done: 0, error: 0, rate: null }, { platform: "other", done: 0, error: 0, rate: null },
    ]);
    assert.deepEqual(a7.durationByPlatform[0], { platform: "youtube", avgS: 20, p90S: 30 });
    assert.deepEqual(a7.durationByPlatform[1], { platform: "tiktok", avgS: null, p90S: null });
    assert.deepEqual(a7.formats, { mp3: 3, mp4: 2 });
    assert.deepEqual(a7.topErrors, [{ code: "private", message: "La vidéo est privée.", count: 1 }]);
    assert.equal(a7.bytesServed, 6000);
    assert.deepEqual(a7.quota, { usersAtLimit: 0, avgUsedPct: todayUsed > 0 ? todayUsed * 10 : null });
    assert.ok(a7.measured.length > 0);
    assert.ok(a7.notMeasured.some((m: string) => m.startsWith("CPU")) && a7.notMeasured.some((m: string) => m.startsWith("mémoire")));
    const a24 = (await admin.json("/api/admin/analytics?period=24h")).body;
    assert.equal(a24.buckets.length, 24);
    const h0 = Math.floor(now / 3_600_000) * 3_600_000;
    assert.ok([h0, h0 + 3_600_000].includes(Date.parse(a24.buckets[23].start)));
    assert.equal(Date.parse(a24.buckets[1].start) - Date.parse(a24.buckets[0].start), 3_600_000);
    assert.deepEqual(["conversions", "done", "error", "signups"].map((k) => sum(a24.buckets, k)), [5, 3, 1, 2]);
    const withDur = a24.buckets.filter((b: { avgDurationS: number | null }) => b.avgDurationS !== null);
    assert.ok(withDur.length >= 1);
    const a30 = (await admin.json("/api/admin/analytics?period=30d")).body;
    assert.equal(a30.buckets.length, 30);
    assert.equal(sum(a30.buckets, "conversions"), 5); // la conversion d'il y a 40 jours est hors période
    assert.equal(a30.bytesServed, 6000);
    assert.equal((await admin.json("/api/admin/analytics")).body.period, "7d");
  } finally { h.close(); }
});

test("outils de calcul : p90, jours de Paris (changements d'heure), monogrammes", () => {
  assert.equal(p90([]), null);
  assert.equal(p90([5]), 5);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(parisDayStart("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z"); // jour de 23 h
  assert.equal(parisDayStart("2026-03-30").toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(parisDayStart("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z"); // jour de 25 h
  assert.equal(parisDayStart("2026-10-26").toISOString(), "2026-10-25T23:00:00.000Z");
  assert.deepEqual(lastParisDays(3, new Date("2026-03-30T22:30:00Z")), ["2026-03-29", "2026-03-30", "2026-03-31"]);
  assert.equal(initials("Alice Bernard", "x@y.z"), "AB");
  assert.equal(initials("élodie", "x@y.z"), "É");
  assert.equal(initials("", "jean.dupont@example.test"), "JD");
  assert.equal(initials("  ", "@"), "?");
});

// ---- système et alertes ---------------------------------------------------------------------

test("système : ytapi (API interne, jeton interne), base, versions, plateformes ; ytapi injoignable", async () => {
  const { h, admin } = await setup();
  try {
    const s = (await admin.json("/api/admin/system")).body;
    assert.equal(s.ytapi.reachable, true);
    assert.equal(typeof s.ytapi.latencyMs, "number");
    assert.ok(s.ytapi.status.queue && !("tokens" in s.ytapi.status));
    assert.deepEqual(s.jobs, { active: 1, queued: 0, capacity: 6 });
    assert.deepEqual(s.disk, { freeBytes: 50 * 2 ** 30, floorBytes: 2 ** 30 });
    assert.deepEqual(s.versions, { ytDlp: "2026.09.27", ffmpeg: "7.1.1", deno: "2.5.2", ytDlpEjs: "0.3.0" });
    assert.deepEqual([s.database.ok, s.database.integrity], [true, "ok"]);
    assert.ok(s.database.sizeBytes > 0 && s.database.walBytes >= 0 && s.database.latencyMs >= 0);
    assert.deepEqual([s.account.version, typeof s.account.uptimeS], ["2.0.0", "number"]);
    assert.deepEqual([s.platforms.youtube.enabled, s.platforms.youtube.state, s.platforms.twitter.state], [true, "ok", "unknown"]);
    assert.deepEqual(s.recentErrors.map((c: { id: string }) => c.id), ["fx-d-000004"]);
    const call = h.ytapi.calls.find((c) => c.path === "/internal/v1/status")!;
    assert.equal(call.token, INTERNAL);
    // injoignable : HTTP 503 puis erreur réseau
    h.ytapiUp.value = false;
    const down = (await admin.json("/api/admin/system")).body;
    assert.deepEqual([down.ytapi.reachable, down.ytapi.error, down.jobs.active, down.disk.freeBytes], [false, "HTTP 503", null, null]);
    h.ytapi.networkError = true;
    assert.equal((await admin.json("/api/admin/system")).body.ytapi.error, "connexion impossible");
    h.s.ytapi.invalidate();
    const ov = (await admin.json("/api/admin/overview")).body;
    assert.deepEqual(ov.alerts.map((a: { level: string; code: string }) => [a.level, a.code]), [["critical", "ytapi_unreachable"]]);
    assert.deepEqual(ov.jobs, { active: 1, queued: 0 }); // repli sur la base (1 conversion « running »)
  } finally { h.close(); }
});

test("alertes : plateforme bloquée, disque, pause, plateformes désactivées, taux d'échec, refus d'authentification", async () => {
  const { h, admin, uid } = await setup();
  const alerts = async () => { h.s.ytapi.invalidate(); return (await admin.json("/api/admin/overview")).body.alerts as { level: string; code: string; message: string; at: string }[]; };
  try {
    const until = new Date(Date.now() + 30 * MIN).toISOString();
    const st = h.ytapi.status as { platforms: Record<string, Record<string, unknown>>; disk: Record<string, number> };
    st.platforms.youtube = { state: "bot_check", since: new Date(Date.now() - MIN).toISOString(), cooldown_until: until };
    st.platforms.tiktok = { state: "upstream_rate_limited", since: null, cooldown_until: null };
    st.disk = { free_bytes: 1.5 * 2 ** 30, floor_bytes: 2 ** 30 };
    let a = await alerts();
    assert.deepEqual(a.map((x) => x.code), ["platform_bot_check", "platform_cooldown", "disk_low"]);
    assert.match(a[0]!.message, /^YouTube\u00a0: contrôle anti-robot.*pause automatique jusqu'à \d\d:\d\d\)\.$/);
    assert.match(a[1]!.message, /^TikTok\u00a0: /);
    assert.match(a[2]!.message, /1,5\u00a0Gio libres \(plancher 1,0\u00a0Gio\)/);
    st.disk = { free_bytes: 0.5 * 2 ** 30, floor_bytes: 2 ** 30 };
    st.platforms.youtube = { state: "ok" };
    st.platforms.tiktok = { state: "ok" };
    await admin.json("/api/admin/settings", { method: "PUT", body: { conversionsPaused: true, platforms: { twitter: false } } });
    a = await alerts();
    assert.deepEqual(a.map((x) => [x.level, x.code]), [["critical", "disk_full"], ["info", "conversions_paused"], ["info", "platform_disabled"]]);
    assert.match(a[2]!.message, /Plateformes désactivées\u00a0: X\./);
    st.disk = { free_bytes: 50 * 2 ** 30, floor_bytes: 2 ** 30 };
    await admin.json("/api/admin/settings", { method: "PUT", body: { conversionsPaused: false, platforms: { twitter: true } } });
    assert.deepEqual(await alerts(), []);
    // taux d'échec de la dernière heure (erreurs du service seulement) : 3 réussites, 4 échecs
    const ins = h.s.db.prepare("INSERT INTO ytc_usage (id, user_id, day, fmt, state, error_code, created_at, updated_at, finished_at) VALUES (?, ?, ?, 'mp3', 'error', 'upstream_forbidden', ?, ?, ?)");
    const t = new Date().toISOString();
    for (let i = 0; i < 4; i++) ins.run(`fx-err-${i}00000`, uid, parisDay(), t, t, t);
    a = await alerts();
    assert.deepEqual(a.map((x) => x.code), ["error_ratio"]);
    assert.match(a[0]!.message, /^57\u00a0% des conversions/);
    // plus de 50 refus d'authentification sur la dernière heure
    h.s.db.prepare("DELETE FROM ytc_usage WHERE id LIKE 'fx-err-%'").run();
    for (let i = 0; i < 51; i++) await internalCall(h, "/internal/v1/authorize", { key: "ytc_" + "Q".repeat(64), action: "access" });
    a = await alerts();
    assert.deepEqual(a.map((x) => [x.level, x.code]), [["warning", "auth_failures"]]);
    assert.match(a[0]!.message, /^51 refus/);
  } finally { h.close(); }
});

test("API interne de ytapi : jamais appelée (ni jeton envoyé) vers une adresse https publique", async () => {
  const h: Harness = await harness({ ADMIN_EMAILS: "admin@example.test", YTAPI_INTERNAL_URL: "https://api.example.test/media" });
  try {
    const admin = await newUser(h, "admin@example.test");
    const s = (await admin.json("/api/admin/system")).body;
    assert.equal(s.ytapi.reachable, false);
    assert.match(s.ytapi.error, /http:\/\//);
    assert.ok(!h.ytapi.calls.some((c) => c.path.startsWith("/media/internal") || c.path.startsWith("/internal")));
  } finally { h.close(); }
});
