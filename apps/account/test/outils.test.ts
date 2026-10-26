// AETHRYON Tools (docs/OUTILS.md) : relais /api/outils/* vers ytapi, clés « outils » gardées par account, import par
// morceaux, lecture par plages, liens « Ouvrir dans AETHRYON Tools » du bot, migration 010.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appliedVersions, migrateDown, migrateUp, tx } from "../src/db.ts";
import { harness, newUser, ORIGIN, type Browser, type Harness } from "./helpers.ts";
import { YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT } from "../src/youtube-music.ts";


/** Faux ytapi des outils : la clé est validée par account (comme ytapi), chaque job appartient à un compte. */
function fakeTools(h: Harness) {
  const jobs = new Map<string, { user: string; status: string; kind: string; body: string; title: string }>();
  const seen: { method: string; path: string; key: string | null; body: unknown }[] = [];
  const derived = new Map<string, string>(); // même demande sur la même source → même export (ytapi : idempotent)
  const media = { duration: 3600, width: 1920, height: 1080 };
  let refuseNext = false;
  let n = 0;
  const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
  const view = (id: string) => {
    const j = jobs.get(id)!;
    return { job_id: id, kind: j.kind, status: j.status, stage: j.status, progress: j.status === "done" ? 100 : 10,
             platform: j.kind === "upload" ? "fichier" : "tiktok", params: { fmt: "mp4" }, title: j.title,
             filename: `${j.title}.mp4`, size_bytes: j.body.length, media_type: "video/mp4",
             status_url: `http://ytapi-internal:8000/jobs/${id}`, file_url: `http://ytapi-internal:8000/jobs/${id}/file`,
             created_at: "2026-10-14T20:00:00Z", updated_at: "2026-10-14T20:00:00Z", expires_at: "2026-10-14T21:00:00Z" };
  };
  h.ytapi.handler = async ({ method, url, headers, body }) => {
    const p = url.pathname;
    const tools = /^\/(preview|jobs|uploads)(\/|$)/.test(p);
    if (!tools || /^\/jobs\/[^/]+\/file$/.test(p) && !jobs.has(decodeURIComponent(p.split("/")[2]!))) return null;
    const key = /^Bearer (ytc_\S+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? null;
    seen.push({ method, path: p + url.search, key, body: typeof body === "string" ? JSON.parse(body) : body });
    const d = key ? await h.s.authorizer.authorize({ key, action: "access" }) : null;
    if (!d || "badRequest" in d || !d.allow) return json({ error: "unauthorized", detail: "Jeton absent ou invalide." }, 401);
    const user = d.user_id;
    const own = (id: string) => { const j = jobs.get(id); return j && j.user === user ? j : null; };
    if (p === "/preview" && method === "POST") {
      return json({ platform: "tiktok", title: "Coucher de soleil", uploader: "nasa", duration: 21.5,
                    thumbnail: "https://p16-sign.tiktokcdn.com/x.jpg", thumbnail_id: "tid-abcdefgh12345", audio: "yes",
                    qualities: [{ quality: 1080, est_size_bytes: 9000000, h264: true }], media_count: 1 });
    }
    if (p === "/preview/thumbnail/tid-abcdefgh12345") return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1]), { headers: { "content-type": "image/jpeg" } });
    if (p === "/jobs" && method === "POST") {
      const c = await h.s.authorizer.authorize({ key: key!, action: "create_job", fmt: "mp4", platform: "tiktok" });
      if ("badRequest" in c || !c.allow) return json({ error: "quota_exceeded", detail: "Limite atteinte." }, 429, { "retry-after": "3600" });
      const id = `src${++n}`;
      jobs.set(id, { user, status: "done", kind: "download", body: "0123456789".repeat(10), title: "Coucher de soleil" });
      return json(view(id), 200);
    }
    if (p === "/jobs" && method === "GET") {
      return json({ jobs: [...jobs.keys()].filter((id) => own(id)).map(view), ttl_min: 60, keep_min: 120, keep_max_min: 360,
                    max_upload_mb: 1024, chunk_mb: 5, max_duration_s: 3600, video_max_s: 900, gif_max_s: 30 });
    }
    if (p === "/uploads" && method === "POST") {
      const id = `up${++n}`;
      jobs.set(id, { user, status: "running", kind: "upload", body: "", title: "Vacances" });
      return json({ ...view(id), upload: { size_bytes: 12, chunk_bytes: 5 * 2 ** 20, chunks: 1, received: [] } }, 201);
    }
    const chunk = /^\/uploads\/([^/]+)\/chunks\/(\d+)$/.exec(p);
    if (chunk && method === "PUT") {
      const j = own(chunk[1]!);
      if (!j) return json({ error: "job_not_found", detail: "Job inconnu." }, 404);
      j.body += Buffer.from(body as Uint8Array).toString("latin1");
      return json({ job_id: chunk[1], received: 1, chunks: 1 });
    }
    const complete = /^\/uploads\/([^/]+)\/complete$/.exec(p);
    if (complete && method === "POST") {
      const j = own(complete[1]!);
      if (!j) return json({ error: "job_not_found", detail: "Job inconnu." }, 404);
      j.status = "done";
      return json(view(complete[1]!), 200);
    }
    const one = /^\/jobs\/([^/]+)(\/[a-z.]+)?$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1]!);
      const j = own(id);
      if (!j) return json({ error: "job_not_found", detail: "Job inconnu ou expiré." }, 404);
      const sub = one[2] ?? "";
      if (sub === "" && method === "GET") return json(view(id));
      if (sub === "" && method === "DELETE") { jobs.delete(id); return json({ job_id: id, deleted: true }); }
      if (sub === "/file") {
        const range = headers.get("range");
        const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
        if (m) {
          const part = j.body.slice(Number(m[1]), Number(m[2]) + 1);
          return new Response(part, { status: 206, headers: { "content-type": "video/mp4", "content-length": String(part.length),
            "content-range": `bytes ${m[1]}-${m[2]}/${j.body.length}`, "accept-ranges": "bytes", "content-disposition": `attachment; filename="${j.title}.mp4"` } });
        }
        return new Response(j.body, { headers: { "content-type": "video/mp4", "content-length": String(j.body.length), "accept-ranges": "bytes",
          "content-disposition": `attachment; filename="${j.title}.mp4"` } });
      }
      if (sub === "/storyboard") return json({ count: 8, cols: 8, rows: 1, tile_w: 200, tile_h: 112, interval_s: 1.5, image_url: `http://ytapi-internal:8000/jobs/${id}/storyboard.jpg` });
      if (sub === "/media" && method === "GET") return json({ ...media, has_video: true, has_audio: true, container: "mp4", playable: true, size_bytes: 1000, bit_rate: null });
      if (sub === "/derive" && method === "POST") {
        if (refuseNext) { refuseNext = false; return json({ error: "transcode_too_long", detail: "Un export vidéo dure au plus 15 min." }, 413); }
        const k = id + JSON.stringify(seen.at(-1)!.body);
        const again = derived.get(k);
        if (again && jobs.has(again)) return json({ ...view(again), merged: true, derive: { op: (seen.at(-1)!.body as { op: string }).op, source_job_id: id } }, 200);
        const e = `ex${++n}`;
        derived.set(k, e);
        jobs.set(e, { user, status: "done", kind: "derive", body: "x", title: j.title });
        return json({ ...view(e), merged: false, derive: { op: (seen.at(-1)!.body as { op: string }).op, source_job_id: id } }, 200);
      }
      if (sub === "/keep" && method === "POST") return json({ job_id: id, expires_at: "2026-10-14T23:00:00Z" });
    }
    return json({ error: "not_found", detail: "Route inconnue." }, 404);
  };
  return { jobs, seen, media, refuse() { refuseNext = true; } };
}

const tooled = (env: Record<string, string> = {}) => harness({ TOOLS_ENABLED: "1", ...env });

async function chunk(b: Browser, path: string, bytes: Uint8Array, init: { origin?: string; type?: string } = {}) {
  return b.h.s.publicApp.request(path, {
    method: "PUT",
    headers: { cookie: b.cookie(), origin: init.origin ?? ORIGIN, "x-real-ip": b.ip, "content-type": init.type ?? "application/octet-stream",
               "content-length": String(bytes.byteLength) },
    body: bytes,
  });
}

test("Tools fermé sans TOOLS_ENABLED (404) ; sans session : 401", async () => {
  const closed = await harness();
  try {
    const u = await newUser(closed, "ferme@example.test");
    assert.equal((await u.json("/api/outils/medias")).status, 404);
  } finally { closed.close(); }
  const h = await tooled();
  try {
    fakeTools(h);
    const anon = await h.s.publicApp.request("/api/outils/medias");
    assert.equal(anon.status, 401);
    assert.equal(((await anon.json()) as { message: string }).message, "Connecte-toi pour utiliser AETHRYON Tools.");
  } finally { h.close(); }
});

test("relais : aperçu (vignette réécrite), ouverture d'un lien (une unité du quota), liste et limites, adresses internes jamais renvoyées", async () => {
  const h = await tooled();
  try {
    const { seen } = fakeTools(h);
    const u = await newUser(h, "outils@example.test");
    const preview = await u.json("/api/outils/apercu", { method: "POST", body: { url: "https://www.tiktok.com/@nasa/video/7691727731800673549" } });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.thumbnail, "/api/outils/vignettes/tid-abcdefgh12345");
    assert.equal(preview.body.title, "Coucher de soleil");
    assert.equal(JSON.stringify(preview.body).includes("tiktokcdn"), false, "l'adresse de la plateforme ne sort pas");
    const thumb = await u.req("/api/outils/vignettes/tid-abcdefgh12345");
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get("content-type"), "image/jpeg");
    assert.equal(thumb.headers.get("cache-control"), "private, max-age=600");
    const before = (await u.json("/api/me")).body.today.used;
    const src = await u.json("/api/outils/sources", { method: "POST", body: { url: "https://www.tiktok.com/@nasa/video/7691727731800673549", quality: "1080", transcode: true, extra: "ignoré" } });
    assert.equal(src.status, 200);
    assert.equal((await u.json("/api/me")).body.today.used, before + 1, "une unité du quota du jour");
    assert.deepEqual(seen.at(-1)!.body, { url: "https://www.tiktok.com/@nasa/video/7691727731800673549", fmt: "mp4", quality: "1080", transcode: true });
    assert.equal(src.body.statusUrl, `/api/outils/medias/${src.body.id}`);
    assert.equal(src.body.streamUrl, `/api/outils/medias/${src.body.id}/flux`);
    assert.equal(JSON.stringify(src.body).includes("ytapi-internal"), false);
    const list = await u.json("/api/outils/medias");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((i: { id: string }) => i.id), [src.body.id]);
    assert.deepEqual(list.body.limits, { ttlMin: 60, keepMin: 120, keepMaxMin: 360, maxUploadMb: 1024, chunkMb: 5, maxDurationS: 3600, videoMaxS: 900, gifMaxS: 30,
      exportMinutes: { used: 0, limit: null } });
    const board = await u.json(`/api/outils/medias/${src.body.id}/planche`);
    assert.equal(board.body.image, `/api/outils/medias/${src.body.id}/planche.jpg`);
    assert.equal(JSON.stringify(board.body).includes("ytapi-internal"), false);
    // Historique : la conversion vient d'AETHRYON Tools.
    const act = await u.json("/api/activity");
    assert.equal(act.body.items[0].source, "outils");
  } finally { h.close(); }
});

test("YouTube Music fermé (2026-10-23) : refus clair par account avant tout relais, sans quota ; le refus d'ytapi traverse tel quel ; les liens classiques passent", async () => {
  const h = await tooled();
  try {
    const { seen } = fakeTools(h);
    const u = await newUser(h, "musique@example.test");
    const used = (await u.json("/api/me")).body.today.used;
    const forms = [
      "https://music.youtube.com/watch?v=jNQXAC9IVRw", "https://MUSIC.YOUTUBE.COM/watch?v=jNQXAC9IVRw", "http://music.youtube.com/playlist?list=PLx",
      "https://music.youtube.com./watch?v=jNQXAC9IVRw", "https://music.youtube.com:443/watch?v=jNQXAC9IVRw", "https://m.music.youtube.com/watch?v=jNQXAC9IVRw",
      "https://user:pw@music.youtube.com/watch?v=jNQXAC9IVRw", "music.youtube.com/watch?v=jNQXAC9IVRw", "//music.youtube.com/watch?v=jNQXAC9IVRw",
      "https://music.youtu.be/jNQXAC9IVRw", "https://youtubemusic.com/", "  https://music.youtube.com/watch?v=jNQXAC9IVRw  ",
    ];
    for (const url of forms) {
      for (const path of ["/api/outils/apercu", "/api/outils/sources"]) {
        const r = await u.json(path, { method: "POST", body: { url } });
        assert.equal(r.status, 400, `${path} ${url}`);
        assert.deepEqual([r.body.error, r.body.message], [YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT], `${path} ${url}`);
      }
    }
    assert.equal(YOUTUBE_MUSIC_TEXT, "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.");
    assert.equal(seen.length, 0, "rien n'est relayé à ytapi");
    assert.equal((await u.json("/api/me")).body.today.used, used, "aucune unité du quota");
    // Les liens classiques et ceux qui ressemblent à « music » sans l'être passent comme avant.
    for (const url of ["https://youtu.be/jNQXAC9IVRw", "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDAMVMjNQXAC9IVRw", "https://m.youtube.com/shorts/18NGQq7p3LY",
                       "https://notmusic.youtube.com/watch?v=jNQXAC9IVRw", "https://www.youtube.com/watch?v=jNQXAC9IVRw&feature=music"]) {
      assert.equal((await u.json("/api/outils/apercu", { method: "POST", body: { url } })).status, 200, url);
    }
    assert.equal(seen.length, 5, "les cinq liens classiques sont relayés");
    // Une forme que seul ytapi reconnaît (redirection youtube.com/redirect) : son refus traverse le relais, code et texte intacts.
    const inner = h.ytapi.handler!;
    h.ytapi.handler = async (req) => req.url.pathname === "/preview" && JSON.stringify(req.body).includes("/redirect")
      ? new Response(JSON.stringify({ error: YOUTUBE_MUSIC_CODE, detail: YOUTUBE_MUSIC_TEXT }), { status: 400, headers: { "content-type": "application/json" } })
      : inner(req);
    const viaRedirect = await u.json("/api/outils/apercu", { method: "POST", body: { url: "https://www.youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw" } });
    assert.deepEqual([viaRedirect.status, viaRedirect.body.error, viaRedirect.body.message], [400, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT]);
  } finally { h.close(); }
});

test("clé « outils » : gardée par account, jamais montrée (Mes jetons, réponses), réutilisée ; une clé refusée est remplacée", async () => {
  const h = await tooled();
  try {
    const { seen } = fakeTools(h);
    const u = await newUser(h, "cle@example.test");
    await u.json("/api/outils/medias");
    await u.json("/api/outils/medias");
    const keys = new Set(seen.map((s) => s.key));
    assert.equal(keys.size, 1, "une seule clé pour les deux demandes");
    const [secret] = [...keys];
    assert.ok(secret!.startsWith("ytc_"));
    const mine = await u.json("/api/keys");
    assert.deepEqual(mine.body.keys, [], "absente de « Mes jetons »");
    for (const log of h.logs) assert.equal(log.includes(secret!), false, "jamais journalisée");
    // Clé révoquée entre-temps : refus 401 de ytapi, une nouvelle clé est créée et la demande passe.
    tx(h.s.db, () => h.s.db.prepare("UPDATE ytc_key_meta SET revoked_at = ?, revoked_reason = 'admin' WHERE kind = 'outils'").run(new Date().toISOString()));
    const again = await u.json("/api/outils/medias");
    assert.equal(again.status, 200);
    assert.notEqual(seen.at(-1)!.key, secret);
    const exp = await u.json("/api/account/export");
    assert.ok(exp.body.keys.every((k: { kind: string }) => k.kind !== "outils" || typeof k.kind === "string"));
  } finally { h.close(); }
});

test("import : octets bruts de même origine acceptés ; mauvaise origine, type « simple » et corps trop gros refusés ; JSON exigé ailleurs", async () => {
  const h = await tooled();
  try {
    const { jobs } = fakeTools(h);
    const u = await newUser(h, "import@example.test");
    const created = await u.json("/api/outils/imports", { method: "POST", body: { name: "Vacances.mp4", size: 12, type: "video/mp4" } });
    assert.equal(created.status, 201);
    const id = created.body.id as string;
    const bytes = new TextEncoder().encode("Hello AETHRY");
    assert.equal((await chunk(u, `/api/outils/imports/${id}/morceaux/0`, bytes, { origin: "https://evil.example" })).status, 403);
    assert.equal((await chunk(u, `/api/outils/imports/${id}/morceaux/0`, bytes, { type: "text/plain" })).status, 415);
    const ok = await chunk(u, `/api/outils/imports/${id}/morceaux/0`, bytes);
    assert.equal(ok.status, 200);
    assert.equal(jobs.get(id)!.body, "Hello AETHRY");
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    assert.equal((await chunk(u, `/api/outils/imports/${id}/morceaux/1`, big)).status, 413);
    // Ailleurs, la limite de 32 Kio et le JSON restent exigés.
    const other = await h.s.publicApp.request("/api/outils/sources", { method: "POST", headers: { cookie: u.cookie(), origin: ORIGIN, "content-type": "application/octet-stream" }, body: "x" });
    assert.equal(other.status, 415);
    const done = await u.json(`/api/outils/imports/${id}/terminer`, { method: "POST" });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, "done");
  } finally { h.close(); }
});

test("lecture par plages (206, inline) et téléchargement (attachment) ; un autre compte : 404", async () => {
  const h = await tooled();
  try {
    const { seen } = fakeTools(h);
    const u = await newUser(h, "flux@example.test");
    const other = await newUser(h, "autre@example.test");
    const src = (await u.json("/api/outils/sources", { method: "POST", body: { url: "https://www.tiktok.com/@nasa/video/7691727731800673549" } })).body;
    const part = await u.req(`/api/outils/medias/${src.id}/flux`, { headers: { range: "bytes=10-19" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 10-19/100");
    assert.equal(part.headers.get("content-disposition"), "inline");
    assert.equal(await part.text(), "0123456789");
    const file = await u.req(`/api/outils/medias/${src.id}/fichier`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition") ?? "", /^attachment/);
    assert.equal(file.headers.get("cache-control"), "private, no-store");
    const stolen = await other.req(`/api/outils/medias/${src.id}/flux`);
    assert.equal(stolen.status, 404);
    assert.equal((await other.json(`/api/outils/medias/${src.id}`)).status, 404);
    assert.equal((await u.json("/api/outils/medias/..%2F..%2Finternal")).status, 404);
    const exp = await u.json(`/api/outils/medias/${src.id}/exports`, { method: "POST", body: { op: "video", start_s: 1, duration_s: 2 } });
    assert.equal(exp.status, 200);
    assert.equal(exp.body.derive.op, "video");
    assert.equal(exp.body.derive.sourceId, src.id);
    const kept = await u.json(`/api/outils/medias/${src.id}/garder`, { method: "POST" });
    assert.deepEqual(kept.body, { expiresAt: "2026-10-14T23:00:00Z" });
    const del = await u.json(`/api/outils/medias/${src.id}`, { method: "DELETE" });
    assert.deepEqual(del.body, { deleted: true });
    // Supprimer un média emporte ses exports (ytapi les retire avec lui).
    assert.ok(seen.some((x) => x.method === "DELETE" && x.path === `/jobs/${src.id}?with_exports=true`), JSON.stringify(seen.filter((x) => x.method === "DELETE")));
  } finally { h.close(); }
});

test("lien « Ouvrir dans AETHRYON Tools » du bot : seulement pour le compte lié, 55 min ; autre compte ou lien expiré : même refus", async () => {
  const h = await tooled();
  try {
    fakeTools(h);
    const owner = await newUser(h, "lie@example.test");
    const intruder = await newUser(h, "intrus@example.test");
    const ownerId = (await owner.json("/api/me")).body.user.id as string;
    const { token } = await h.s.tools.createRef(ownerId, "src42", "discord");
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const stored = h.s.db.prepare("SELECT token_hash, job_id FROM ytc_outils_ref").all() as { token_hash: string; job_id: string }[];
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0]!.token_hash, token, "seule l'empreinte est gardée");
    const intrusion = await intruder.json("/api/outils/references", { method: "POST", body: { ref: token } });
    assert.equal(intrusion.status, 404);
    const ok = await owner.json("/api/outils/references", { method: "POST", body: { ref: token } });
    assert.deepEqual(ok.body, { id: "src42" });
    tx(h.s.db, () => h.s.db.prepare("UPDATE ytc_outils_ref SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString()));
    const late = await owner.json("/api/outils/references", { method: "POST", body: { ref: token } });
    assert.equal(late.status, 404);
    assert.equal(late.body.message, intrusion.body.message);
  } finally { h.close(); }
});

test("migration 010 : up → down → up ; clés « outils » effacées au retour arrière, liens supprimés, autres clés intactes", async () => {
  const h = await tooled();
  try {
    fakeTools(h);
    const db = h.s.db;
    const u = await newUser(h, "mig10@example.test");
    const short = (await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.key.id as string;
    await u.json("/api/outils/medias"); // crée une clé « outils »
    const uid = (await u.json("/api/me")).body.user.id as string;
    await h.s.tools.createRef(uid, "src1", "discord");
    const kinds = () => (db.prepare("SELECT kind FROM ytc_key_meta ORDER BY kind").all() as { kind: string }[]).map((r) => r.kind);
    assert.deepEqual(kinds(), ["outils", "shortcut"]);
    assert.deepEqual(migrateDown(db, 6), [15, 14, 13, 12, 11, 10]); // le panneau Premiere (012) et la facturation (011) sont au-dessus
    assert.deepEqual(kinds(), ["shortcut"]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM apikey").get()!.n, 1, "la clé du raccourci reste, celle des outils est effacée");
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ytc_outils_ref'").get()!.n, 0);
    assert.throws(() => db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES ('z', ?, 'x', 'outils')").run(uid));
    assert.deepEqual(migrateUp(db), [10, 11, 12, 13, 14, 15]);
    assert.deepEqual(appliedVersions(db).at(-1), 15);
    assert.deepEqual(kinds(), ["shortcut"]);
    assert.equal((db.prepare("SELECT key_id FROM ytc_key_meta").get() as { key_id: string }).key_id, short);
  } finally { h.close(); }
});

test("quota d'export de Tools : coupé par défaut (aucune limite nouvelle sans décision), minutes comptées quand même", async () => {
  const h = await tooled();
  try {
    fakeTools(h);
    const u = await newUser(h, "sans-limite@example.test");
    const src = (await u.json("/api/outils/sources", { method: "POST", body: { url: "https://www.tiktok.com/@nasa/video/7691727731800673549" } })).body;
    const exp = (body: Record<string, unknown>) => u.json(`/api/outils/medias/${src.id}/exports`, { method: "POST", body });
    assert.equal((await exp({ op: "video", start_s: 0, duration_s: 1200 })).status, 200);
    assert.equal((await exp({ op: "video", start_s: 0, duration_s: 900, height: 2160 })).status, 200, "52,5 min de 4K : acceptées, comme avant la 3.5");
    assert.deepEqual((await u.json("/api/outils/medias")).body.limits.exportMinutes, { used: 72.5, limit: null });
    assert.deepEqual((await u.json("/api/me")).body.exportMinutes, { used: 72.5, limit: null });
  } finally { h.close(); }
});

test("quota d'export de Tools : minutes pondérées réservées avant ytapi, refus clair au-delà, rendues si ytapi refuse ou rejoint un export identique", async () => {
  const h = await tooled({ TOOLS_EXPORT_LIMIT: "1" });
  try {
    const t = fakeTools(h);
    const u = await newUser(h, "quota-export@example.test");
    const src = (await u.json("/api/outils/sources", { method: "POST", body: { url: "https://www.tiktok.com/@nasa/video/7691727731800673549" } })).body;
    const exp = (body: Record<string, unknown>) => u.json(`/api/outils/medias/${src.id}/exports`, { method: "POST", body });
    const limits = async () => (await u.json("/api/outils/medias")).body.limits.exportMinutes;
    assert.deepEqual(await limits(), { used: 0, limit: 30 }, "Gratuit : 30 min par jour, sans offres actives, avec TOOLS_EXPORT_LIMIT=1");
    assert.equal((await exp({ op: "video", start_s: 0, duration_s: 1200 })).status, 200, "20 min de 1080p");
    assert.deepEqual(await limits(), { used: 20, limit: 30 });
    // Même demande : ytapi rejoint l'export déjà fait → aucune minute de plus.
    assert.equal((await exp({ op: "video", start_s: 0, duration_s: 1200 })).status, 200);
    assert.deepEqual(await limits(), { used: 20, limit: 30 }, "export identique : rendu");
    // Le son ne compte pas ; un GIF compte 0,55.
    assert.equal((await exp({ op: "audio", start_s: 0, duration_s: 3600 })).status, 200);
    assert.equal((await exp({ op: "gif", start_s: 0, duration_s: 30 })).status, 200);
    assert.deepEqual(await limits(), { used: 20.3, limit: 30 });
    // Au-delà : refus clair, avec ce que l'export compte et quand la limite revient.
    const over = await exp({ op: "video", start_s: 0, duration_s: 900, height: 2160 });
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "export_quota");
    assert.match(over.body.message, /20,3 min utilisées sur 30, cet export en compte 52,5/);
    // ytapi refuse (export trop long) : les minutes réservées sont rendues.
    t.refuse();
    assert.equal((await exp({ op: "video", start_s: 0, duration_s: 300 })).status, 413);
    assert.deepEqual(await limits(), { used: 20.3, limit: 30 });
    assert.equal((await exp({ op: "video", start_s: 60, duration_s: 540 })).status, 200, "9 min : 29,3");
    assert.equal((await exp({ op: "video", start_s: 600, duration_s: 60 })).status, 429, "1 min de plus : 30,3 > 30");
    // À la limite, la MÊME demande (double clic, autre onglet, « Réessayer ») n'est pas refusée : ytapi la rejoint.
    assert.equal((await exp({ op: "video", start_s: 60, duration_s: 540 })).status, 200);
    assert.deepEqual(await limits(), { used: 29.3, limit: 30 });
    const rows = h.s.db.prepare("SELECT op, minutes, state FROM ytc_tools_export ORDER BY created_at").all().map((r) => ({ ...r }));
    assert.deepEqual(rows.map((r) => r.state), ["compte", "rendu", "compte", "compte", "rendu", "compte", "rendu"]);
  } finally { h.close(); }
});

test("quota d'export : offre payante (À vie) 120 min ; rôle admin sans limite", async () => {
  const h = await tooled({ PLANS_ACTIVE: "1" });
  try {
    fakeTools(h);
    const u = await newUser(h, "vie-export@example.test");
    const uid = (await u.json("/api/me")).body.user.id as string;
    const now = new Date().toISOString();
    h.s.db.prepare("INSERT INTO ytc_entitlement (id, user_id, plan, source, external_id, starts_at, ends_at, revoked_at, created_at, updated_at) VALUES ('e1', ?, 'vie', 'web', 'cs_test_essai', ?, NULL, NULL, ?, ?)").run(uid, now, now, now);
    assert.deepEqual((await u.json("/api/outils/medias")).body.limits.exportMinutes, { used: 0, limit: 120 });
    h.s.db.prepare('UPDATE "user" SET role = \'admin\' WHERE id = ?').run(uid);
    assert.deepEqual((await u.json("/api/outils/medias")).body.limits.exportMinutes, { used: 0, limit: null });
  } finally { h.close(); }
});

test("minutes d'export : effacées avec l'historique (90 jours par défaut), celles du jour gardées", async () => {
  const h = await tooled();
  try {
    fakeTools(h);
    const u = await newUser(h, "purge-export@example.test");
    const uid = (await u.json("/api/me")).body.user.id as string;
    const ins = h.s.db.prepare("INSERT INTO ytc_tools_export (id, user_id, day, cle, job_id, op, minutes, state, created_at) VALUES (?, ?, ?, ?, NULL, 'video', 1, 'compte', ?)");
    const old = new Date(Date.now() - 100 * 86_400_000);
    ins.run("vieux", uid, old.toISOString().slice(0, 10), "a".repeat(64), old.toISOString());
    ins.run("recent", uid, new Date().toISOString().slice(0, 10), "b".repeat(64), new Date().toISOString());
    await h.s.usage.purge();
    assert.deepEqual(h.s.db.prepare("SELECT id FROM ytc_tools_export ORDER BY id").all().map((r) => (r as { id: string }).id), ["recent"]);
  } finally { h.close(); }
});
