// Relais AETHRYON Music (music.ts, migration 015) : coupé par défaut ; session du site SANS filtre de rôle ; clé
// « desktop » acceptée sur les seules routes Music (moindre privilège : refusée par /api/outils/* et par l'autorisation
// d'ytapi) ; toute autre clé refusée ; origine refusée pour une clé ; adresses d'ytapi réécrites ; import, suivi,
// annulation et fichier relayés ; historique de l'espace (200 au plus) ; corps de 2 Mio pour les correspondances ;
// migration 015 réversible. Faux ytapi (handler de helpers.ts) qui valide la clé comme ytapi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appliedVersions, migrateDown, migrateUp } from "../src/db.ts";
import { MUSIC_ROUTES, rewrite } from "../src/music.ts";
import { Browser, harness, newUser, type Harness } from "./helpers.ts";

const ON = { DESKTOP_CONNEXION: "1", MUSIC_RELAY: "1" };
let ipN = 1;
const freshIp = () => `198.51.100.${(ipN++ % 250) + 1}`;

async function core(h: Harness, path: string, init: { method?: string; body?: unknown; raw?: string; token?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "x-real-ip": freshIp() };
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.raw !== undefined) { body = init.raw; headers["content-type"] = "application/json"; }
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] = "application/json"; }
  const res = await h.s.publicApp.request(path, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, body });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return { status: res.status, headers: res.headers, body: null as any, bytes: new Uint8Array(await res.arrayBuffer()) };
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as any, bytes: null };
}

/** Clé « desktop » obtenue par le vrai parcours d'appairage (desktop.ts). */
async function desktopKey(h: Harness, b: Browser): Promise<string> {
  const p = await core(h, "/api/desktop/appairage", { body: { hote: "PC-MUSIQUE", versionDesktop: "1.1.0-beta.1" } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await b.json("/api/desktop/autoriser", { method: "POST", body: { codeUtilisateur: p.body.codeUtilisateur } })).status, 200);
  const t = await core(h, "/api/desktop/jeton", { body: { codeAppareil: p.body.codeAppareil } });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return t.body.cle as string;
}

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...randomBytes(64)]);

/** Faux AETHRYON Music : vérifie la clé par account (comme ytapi), garde les appels vus. */
function fakeMusic(h: Harness) {
  const seen: { method: string; path: string; user: string; kind: string; body: unknown }[] = [];
  const imports = new Map<string, { user: string; etat: string }>();
  let fileType = "audio/mpeg";
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const view = (id: string) => ({ id, etat: imports.get(id)!.etat, connecteur: "archive", titre: "Gymnopédie n° 1", artistes: ["Erik Satie"],
    sourceUrl: "https://archive.org/details/gymnopedie", progression: { octets: MP3.length, total: MP3.length, pourcentage: 100 },
    fichier: imports.get(id)!.etat === "termine" ? { nom: "Erik Satie - Gymnopédie n° 1.mp3", type: "audio/mpeg", taille: MP3.length, url: `/media/music/imports/${id}/fichier` } : null, cloud: null });
  h.ytapi.handler = async ({ method, url, headers, body }) => {
    const p = url.pathname;
    if (!p.startsWith("/music/")) return null;
    const key = /^Bearer (ytc_\S+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? null;
    const d = key ? await h.s.authorizer.authorize({ key, action: "access" }) : null;
    if (!d || "badRequest" in d || !d.allow) return json({ error: "unauthorized", detail: "Jeton absent ou invalide." }, 401);
    seen.push({ method, path: p + url.search, user: d.user_id, kind: d.key_kind, body: typeof body === "string" ? JSON.parse(body) : body });
    if (p === "/music/connecteurs") return json({ connecteurs: [{ id: "archive", capacites: ["Metadata", "AuthorizedDownload", "Import"] }] });
    if (p === "/music/analyser") {
      const b = (typeof body === "string" ? JSON.parse(body) : body) as { url: string };
      if (b.url.includes("spotify")) return json({ fiche: { connecteur: "spotify", type: "titre", url: b.url, etat: "identifie", titre: "Titre commercial", artistes: ["X"], pochette: "https://i.scdn.co/image/ab", actions: [{ id: "ouvrir", libelle: "Ouvrir dans Spotify", url: b.url }], capacites: ["Metadata", "Playback"] } });
      return json({ fiche: { connecteur: "archive", type: "element", url: "https://archive.org/details/gymnopedie", etat: "telechargeable", titre: "Gymnopédie n° 1", artistes: ["Erik Satie"],
        actions: [{ id: "importer", requete: { methode: "POST", chemin: "/media/music/imports", corps: { url: "https://archive.org/details/gymnopedie", fichier: "g.mp3" } } }] } });
    }
    if (p === "/music/correspondances") return json({ pistes: [], telechargements: 0 });
    if (p === "/music/rechercher") return json({ resultats: [], source: url.searchParams.get("source") });
    if (p === "/music/playlists/synchroniser") return json({ playlist: { pistes: [] }, stats: {}, telechargements: 0 });
    if (p === "/music/imports" && method === "POST") {
      const id = `mus_${randomBytes(6).toString("hex")}`;
      imports.set(id, { user: d.user_id, etat: "en_file" });
      return json({ import: view(id) }, 202);
    }
    if (p === "/music/imports" && method === "GET") return json({ imports: [...imports.keys()].filter((i) => imports.get(i)!.user === d.user_id).map(view) });
    const m = /^\/music\/imports\/(mus_[A-Za-z0-9_-]+)(\/fichier)?$/.exec(p);
    if (m) {
      const imp = imports.get(m[1]!);
      if (!imp || imp.user !== d.user_id) return json({ error: "import_introuvable", detail: "Import introuvable." }, 404);
      if (method === "DELETE") { imp.etat = "annule"; return json({ import: view(m[1]!) }); }
      if (m[2]) return new Response(MP3, { headers: { "content-type": fileType, "content-length": String(MP3.length), "content-disposition": 'attachment; filename="g.mp3"' } });
      imp.etat = "termine";
      return json({ import: view(m[1]!) });
    }
    return json({ error: "introuvable", detail: "?" }, 404);
  };
  return { seen, imports, setFileType: (t: string) => { fileType = t; } };
}

test("coupé par défaut (MUSIC_RELAY ≠ 1) : 404 « music_closed » pour la session et la clé, rien n'est relayé", async () => {
  const h = await harness({ DESKTOP_CONNEXION: "1" });
  try {
    const f = fakeMusic(h);
    const b = await newUser(h, "ferme@example.test");
    const k = await desktopKey(h, b);
    assert.equal((await b.json("/api/music/connecteurs")).body.error, "music_closed");
    assert.equal((await core(h, "/api/music/analyser", { token: k, body: { url: "https://archive.org/details/x" } })).body.error, "music_closed");
    assert.equal(f.seen.length, 0);
  } finally { h.close(); }
});

test("session d'un compte ORDINAIRE : analyse relayée avec la clé « outils » (jamais la session), adresses réécrites, historique", async () => {
  const h = await harness(ON);
  try {
    const f = fakeMusic(h);
    const b = await newUser(h, "lina@example.test");
    const r = await b.json("/api/music/analyser", { method: "POST", body: { url: "https://archive.org/details/gymnopedie", inconnu: 1 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.fiche.actions[0].requete.chemin, "/api/music/imports", "chemin d'ytapi réécrit");
    assert.equal(f.seen[0]!.kind, "outils");
    assert.deepEqual(f.seen[0]!.body, { url: "https://archive.org/details/gymnopedie" }, "champs inconnus non transmis");
    await b.json("/api/music/analyser", { method: "POST", body: { url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" } });
    const hist = await b.json("/api/music/historique");
    assert.equal(hist.body.entrees.length, 2);
    assert.equal(hist.body.entrees[0].etat, "identifie");
    assert.equal(hist.body.entrees[0].pochette, "https://i.scdn.co/image/ab");
    assert.equal(hist.body.entrees[0].origine, "site");
    // Sans session : 401 ; mutation sans l'origine du site : 403 (contrôle CSRF commun).
    assert.equal((await new Browser(h).json("/api/music/connecteurs")).status, 401);
    assert.equal((await b.json("/api/music/analyser", { method: "POST", body: { url: "https://x.y/a.mp3" }, origin: "https://evil.example" })).status, 403);
  } finally { h.close(); }
});

test("clé « desktop » : les 11 routes Music ouvertes, origine refusée ; autres clés refusées ; /api/outils et ytapi restent fermés", async () => {
  const h = await harness({ ...ON, TOOLS_ENABLED: "1" });
  try {
    const f = fakeMusic(h);
    const b = await newUser(h, "nora@example.test");
    const k = await desktopKey(h, b);
    const imp = await core(h, "/api/music/imports", { token: k, body: { url: "https://archive.org/details/gymnopedie", fichier: "g.mp3", taille: 1 } });
    assert.equal(imp.status, 202, JSON.stringify(imp.body));
    const id = imp.body.import.id as string;
    assert.deepEqual(f.seen.at(-1)!.body, { url: "https://archive.org/details/gymnopedie", fichier: "g.mp3" }, "champs fermés");
    for (const [method, path] of MUSIC_ROUTES) {
      const p = path.replace(":id", id) + (path.endsWith("rechercher") ? "?q=satie&source=archive" : "");
      const body = method === "POST" ? (path.endsWith("analyser") || path.endsWith("synchroniser") || path === "/api/music/imports" ? { url: "https://archive.org/details/gymnopedie" } : path.endsWith("correspondances") ? { pistes: [{ titre: "a" }], candidats: [] } : {}) : undefined;
      const r = await core(h, p, { method, token: k, body });
      assert.ok(r.status < 400, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
    }
    assert.ok(f.seen.every((x) => x.kind === "outils"), "la clé « desktop » ne quitte jamais account");
    // Origine présente avec une clé : refusée (le cœur Rust n'en envoie aucune).
    assert.equal((await core(h, "/api/music/connecteurs", { token: k, origin: "https://app.example.test" })).status, 403);
    // Une clé « raccourci » (ou d'un autre type), une clé inventée : refusées partout.
    const sc = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret as string;
    for (const t of [sc, `ytc_${"A".repeat(64)}`]) {
      for (const [method, path] of MUSIC_ROUTES) {
        const r = await core(h, path.replace(":id", id), { method, token: t, body: method === "POST" ? {} : undefined });
        assert.equal(r.status, 401, `${method} ${path} avec une clé non « desktop »`);
      }
    }
    // Moindre privilège : la clé « desktop » n'ouvre ni AETHRYON Tools ni les conversions d'ytapi.
    assert.equal((await core(h, "/api/outils/medias", { token: k })).status, 401);
    const a = await h.s.authorizer.authorize({ key: k, action: "access" });
    assert.ok(!("badRequest" in a) && !a.allow, "ytapi refuse la clé « desktop »");
    // Clé révoquée dans « Mes jetons » : 401 token_revoked.
    const list = (await b.json("/api/keys")).body;
    const dk = (list.keys ?? list).find((x: { kind?: string; name: string }) => x.kind === "desktop" || /Desktop/.test(x.name));
    assert.ok(dk, JSON.stringify(list));
    assert.equal((await b.json(`/api/keys/${dk.id}/revoke`, { method: "POST" })).status, 200);
    assert.equal((await core(h, "/api/music/connecteurs", { token: k })).body.error, "token_revoked");
  } finally { h.close(); }
});

test("import : relayé, fichier audio transmis tel quel, type inattendu refusé, autre compte 404, annulation, historique à jour", async () => {
  const h = await harness(ON);
  try {
    const f = fakeMusic(h);
    const b = await newUser(h, "eli@example.test");
    const k = await desktopKey(h, b);
    const imp = await core(h, "/api/music/imports", { token: k, body: { url: "https://archive.org/details/gymnopedie", fichier: "g.mp3" } });
    const id = imp.body.import.id as string;
    const v = await core(h, `/api/music/imports/${id}`, { token: k });
    assert.equal(v.body.import.etat, "termine");
    assert.equal(v.body.import.fichier.url, `/api/music/imports/${id}/fichier`, "adresse d'ytapi réécrite");
    const fic = await core(h, `/api/music/imports/${id}/fichier`, { token: k });
    assert.equal(fic.status, 200);
    assert.deepEqual(fic.bytes, MP3, "octets identiques");
    assert.equal(fic.headers.get("cache-control"), "no-store");
    f.setFileType("text/html");
    assert.equal((await core(h, `/api/music/imports/${id}/fichier`, { token: k })).status, 502);
    // Un autre compte ne voit rien (404 d'ytapi transmis) ; identifiant mal formé : 404 sans appel.
    const autre = await newUser(h, "autre@example.test");
    assert.equal((await autre.json(`/api/music/imports/${id}`)).status, 404);
    const n = f.seen.length;
    assert.equal((await core(h, "/api/music/imports/..%2Fadmin", { token: k })).status, 404);
    assert.equal(f.seen.length, n);
    const hist = (await core(h, "/api/music/historique", { token: k })).body.entrees;
    assert.equal(hist.length, 1, "un import = une entrée mise à jour");
    assert.deepEqual([hist[0].etat, hist[0].origine, hist[0].importId], ["termine", "desktop", id]);
    // Annulation d'un second import en file.
    const i2 = (await b.json("/api/music/imports", { method: "POST", body: { url: "https://archive.org/details/gymnopedie", fichier: "g.mp3" } })).body.import.id;
    assert.equal((await b.json(`/api/music/imports/${i2}/annuler`, { method: "POST" })).status, 200);
    assert.equal(f.seen.at(-1)!.method, "DELETE");
    assert.equal((await b.json("/api/music/historique")).body.entrees.find((e: { importId: string }) => e.importId === i2).etat, "annule");
  } finally { h.close(); }
});

test("corps : 2 Mio admis pour les correspondances, 32 Kio ailleurs ; historique borné à 200 ; ytapi absent → 503 lisible", async () => {
  const h = await harness(ON);
  try {
    fakeMusic(h);
    const b = await newUser(h, "zoe@example.test");
    const k = await desktopKey(h, b);
    const candidats = Array.from({ length: 6000 }, (_, i) => ({ ref: `bib:${i}`, origine: "bibliotheque", titre: `Titre numéro ${i}`, artistes: ["Artiste"] }));
    const gros = JSON.stringify({ pistes: [{ titre: "a" }], candidats });
    assert.ok(gros.length > 32 * 1024 && gros.length < 2 * 1024 * 1024);
    assert.equal((await core(h, "/api/music/correspondances", { token: k, raw: gros })).status, 200);
    assert.equal((await core(h, "/api/music/analyser", { token: k, raw: JSON.stringify({ url: "https://x.y/" + "a".repeat(40_000) }) })).status, 413);
    for (let i = 0; i < 205; i++) await core(h, "/api/music/analyser", { token: k, body: { url: `https://archive.org/details/x${i}` } });
    const c = h.s.db.prepare("SELECT COUNT(*) AS n FROM ytc_music_historique").get() as { n: number };
    assert.equal(c.n, 200);
    h.ytapiUp.value = false;
    const r = await core(h, "/api/music/connecteurs", { token: k });
    assert.ok(r.status >= 500, String(r.status));
  } finally { h.close(); }
});

test("réécriture : seules les adresses d'ytapi changent", () => {
  assert.deepEqual(rewrite({ fichier: { url: "/media/music/imports/mus_a1/fichier" }, actions: [{ url: "https://open.spotify.com/x" }, { requete: { chemin: "/music/imports" } }] }),
    { fichier: { url: "/api/music/imports/mus_a1/fichier" }, actions: [{ url: "https://open.spotify.com/x" }, { requete: { chemin: "/api/music/imports" } }] });
});

test("migration 015 : réversible, le reste intact ; effacée avec le compte", async () => {
  const h = await harness(ON);
  try {
    const db = h.s.db;
    assert.ok(appliedVersions(db).includes(15));
    fakeMusic(h);
    const b = await newUser(h, "mig@example.test");
    await b.json("/api/music/analyser", { method: "POST", body: { url: "https://archive.org/details/gymnopedie" } });
    const users = (db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n;
    assert.deepEqual(migrateDown(db, 1), [15]);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ytc_music_historique'").get(), undefined);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n, users);
    assert.deepEqual(migrateUp(db), [15]);
    await b.json("/api/music/analyser", { method: "POST", body: { url: "https://archive.org/details/gymnopedie" } });
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare('DELETE FROM "user" WHERE email = ?').run("mig@example.test");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ytc_music_historique").get() as { n: number }).n, 0);
  } finally { h.close(); }
});
