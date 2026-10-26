// PILE JETABLE de la page Musique du site (manuelle, hors `npm test`) : le VRAI account (MUSIC_RELAY=1, CLOUD coupé)
// sur une base temporaire, le site construit (web/dist) servi comme le fait nginx (coque et en-têtes de
// web/nginx/security-headers-musique.conf pour /dashboard/musique), et un ytapi d'ESSAI minuscule (HTTP, 127.0.0.1)
// qui répond aux routes /music/* avec les formes de cloud-music/MUSIC-API.md : il vérifie la clé auprès d'account
// (comme ytapi), garde chaque import pour son compte, avance la progression par étapes et sert un vrai MP3 (ffmpeg).
// Le VRAI ytapi est essayé derrière le même relais par test/music-relais-e2e.ts. Tout écoute sur 127.0.0.1.
//   WEB_DIST=../web/dist PILE_JSON=<fichier 600> node test/pile-musique.ts
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

const ici = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(process.env.WEB_DIST ?? join(ici, "../../web/dist"));
const SORTIE = process.env.PILE_JSON;
if (!SORTIE || !existsSync(join(DIST, "app.html"))) { console.error("PILE_JSON et WEB_DIST (avec app.html) requis"); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), "ytc2-pile-musique-"));
const w = (n: string, v: string | Buffer) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
const libre = () => new Promise<number>((ok) => { const t = createHttpServer().listen(0, "127.0.0.1", () => { const p = (t.address() as { port: number }).port; t.close(() => ok(p)); }); });
const port = Number(process.env.PILE_PORT ?? 0) || await libre();
const yport = await libre();
const origin = `http://127.0.0.1:${port}`;
const internalToken = randomBytes(32).toString("hex");
const s = await buildServer(loadConfig({
  PUBLIC_URL: origin, DB_PATH: join(dir, "account.sqlite"), BACKUP_DIR: join(dir, "b"), YTAPI_INTERNAL_URL: `http://127.0.0.1:${yport}`,
  BETTER_AUTH_SECRET_FILE: w("auth", randomBytes(32).toString("hex")), INTERNAL_TOKEN_FILE: w("internal", internalToken),
  MUSIC_RELAY: "1", LOG_LEVEL: "error",
} as NodeJS.ProcessEnv));
const ctx = await s.auth.$context;
async function session(email: string, admin: boolean): Promise<string> {
  let user = (await ctx.internalAdapter.findUserByEmail(email))?.user;
  if (!user) user = await ctx.internalAdapter.createUser({ email, name: email.split("@")[0]!, emailVerified: true }, { method: "admin" } as never);
  s.db.prepare('UPDATE "user" SET role = ?, status = \'active\' WHERE id = ?').run(admin ? "admin" : "user", user.id);
  const sess = await ctx.internalAdapter.createSession(user.id);
  const sig = createHmac("sha256", ctx.secret).update(sess.token).digest("base64");
  return `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${sess.token}.${sig}`)}`;
}
const lina = await session("lina@pile.test", false);

// ---- ytapi d'essai (routes /music/*) --------------------------------------------------------------------------------
const son = join(dir, "son.mp3");
execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "96k", son]);
const mp3 = readFileSync(son);
const FICHES: Record<string, unknown> = {
  spotify: { connecteur: "spotify", type: "titre", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", etat: "identifie", titre: "Titre commercial (essai)", artistes: [], pochette: "https://i.scdn.co/image/essai", capacites: ["Metadata", "Playback"],
    actions: [{ id: "ouvrir", libelle: "Ouvrir dans Spotify", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }, { id: "lecteur_officiel", embed: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", hauteur: 152 }, { id: "enregistrer_lien", executePar: "client" }],
    restrictions: ["Spotify n'autorise aucun téléchargement : lecture par le lecteur officiel ou dans Spotify."], manque: ["Artiste et durée : identifiants de l'application Spotify du propriétaire non saisis."] },
  apple: { connecteur: "apple", type: "titre", url: "https://music.apple.com/fr/album/essai/1?i=2", etat: "identifie", titre: "Morceau Apple Music (essai)", artistes: ["Artiste d'essai"], album: "Album d'essai", dureeS: 212, pochette: "https://is1-ssl.mzstatic.com/image/essai.jpg", capacites: ["Metadata", "Preview", "Playback"],
    actions: [{ id: "ouvrir", libelle: "Ouvrir dans Apple Music", url: "https://music.apple.com/fr/album/essai/1?i=2" }, { id: "apercu", url: "https://audio-ssl.itunes.apple.com/essai.m4a", dureeS: 30, libelle: "Aperçu de 30 s", mention: "Aperçu fourni par Apple, jamais enregistré.", lien: { libelle: "Ouvrir dans Apple Music", url: "https://music.apple.com/fr/album/essai/1?i=2" } }],
    restrictions: ["Apple Music n'autorise aucun téléchargement."] },
  archive: { connecteur: "archive", type: "element", url: "https://archive.org/details/essai-satie", etat: "telechargeable", titre: "Pièces pour piano (essai)", artistes: ["Archive libre"], date: "1888",
    licence: { code: "cc0", nom: "CC0 1.0 (domaine public)", url: "https://creativecommons.org/publicdomain/zero/1.0/", libre: true }, attribution: "« Pièces pour piano (essai) », CC0, via Internet Archive", capacites: ["Metadata", "AuthorizedDownload", "Import"],
    pistes: [{ titre: "Gymnopédie n° 1", artistes: ["Archive libre"], dureeS: 191, fichiers: [{ nom: "g1.mp3", format: "VBR MP3", taille: mp3.length, original: true }] }, { titre: "Gymnopédie n° 2", artistes: ["Archive libre"], dureeS: 158, fichiers: [{ nom: "g2.mp3", original: true }] }],
    actions: [{ id: "ouvrir", libelle: "Ouvrir sur Internet Archive", url: "https://archive.org/details/essai-satie" }, { id: "importer", requete: { methode: "POST", chemin: "/media/music/imports", corps: { url: "https://archive.org/details/essai-satie", fichier: "g1.mp3" } } }] },
};
const imports = new Map<string, { user: string; etape: number; corps: Record<string, unknown>; annule: boolean }>();
const ETAPES = ["en_file", "telechargement", "telechargement", "verification", "etiquetage", "termine"];
const vue = (id: string) => {
  const i = imports.get(id)!;
  const etat = i.annule ? "annule" : ETAPES[Math.min(i.etape, ETAPES.length - 1)]!;
  const octets = etat === "en_file" ? 0 : etat === "telechargement" ? Math.round(mp3.length * (i.etape === 1 ? 0.4 : 0.8)) : mp3.length;
  return { id, etat, connecteur: "archive", titre: i.corps.fichier === "g2.mp3" ? "Gymnopédie n° 2" : "Gymnopédie n° 1", artistes: ["Archive libre"], sourceUrl: i.corps.url,
    progression: { octets, total: mp3.length, pourcentage: Math.round((octets / mp3.length) * 1000) / 10 }, erreur: null, licence: { code: "cc0", nom: "CC0 1.0 (domaine public)", libre: true },
    fichier: etat === "termine" ? { nom: "Archive libre - Gymnopédie.mp3", type: "audio/mpeg", taille: mp3.length, url: `/media/music/imports/${id}/fichier` } : null, cloud: null,
    disponibleJusquA: etat === "termine" ? new Date(Date.now() + 3_600_000).toISOString() : null };
};
const lire = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => ok(b)); });
const ytapi = createHttpServer(async (req, res) => {
  const json = (v: unknown, st = 200) => { res.writeHead(st, { "content-type": "application/json" }).end(JSON.stringify(v)); };
  const key = /^Bearer (ytc_\S+)$/.exec(req.headers.authorization ?? "")?.[1];
  const d = key ? await s.authorizer.authorize({ key, action: "access" }) : null;
  if (!d || "badRequest" in d || !d.allow) return json({ error: "unauthorized", detail: "Jeton absent ou invalide." }, 401);
  const u = new URL(req.url ?? "/", "http://x");
  const corps = req.method === "POST" ? JSON.parse((await lire(req)) || "{}") : {};
  if (u.pathname === "/music/analyser") {
    const f = /spotify/.test(corps.url) ? FICHES.spotify : /apple/.test(corps.url) ? FICHES.apple : /archive\.org/.test(corps.url) ? FICHES.archive : null;
    return f ? json({ fiche: f }) : json({ error: "plateforme_inconnue", detail: "Ce lien ne vient d'aucune plateforme reconnue par AETHRYON Music." }, 400);
  }
  if (u.pathname === "/music/imports" && req.method === "POST") {
    if (!/archive\.org/.test(corps.url)) return json({ error: "telechargement_non_autorise", detail: "Cette source n'autorise pas le téléchargement." }, 403);
    const id = `mus_${randomBytes(6).toString("hex")}`;
    imports.set(id, { user: d.user_id, etape: 0, corps, annule: false });
    return json({ import: vue(id) }, 202);
  }
  const m = /^\/music\/imports\/(mus_[A-Za-z0-9_-]+)(\/fichier)?$/.exec(u.pathname);
  if (m) {
    const i = imports.get(m[1]!);
    if (!i || i.user !== d.user_id) return json({ error: "import_introuvable", detail: "Import introuvable." }, 404);
    if (req.method === "DELETE") { i.annule = true; return json({ import: vue(m[1]!) }); }
    if (m[2]) { res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(mp3.length), "content-disposition": 'attachment; filename="Archive libre - Gymnopedie.mp3"' }).end(mp3); return; }
    if (!i.annule) i.etape++;
    return json({ import: vue(m[1]!) });
  }
  return json({ error: "introuvable", detail: "Route inconnue." }, 404);
});
await new Promise<void>((ok) => ytapi.listen(yport, "127.0.0.1", ok));

// ---- Serveur « nginx » ----------------------------------------------------------------------------------------------
const api = getRequestListener(s.publicApp.fetch);
const entetes = (fichier: string) => {
  const t = readFileSync(resolve(ici, "../../web/nginx", fichier), "utf8");
  return Object.fromEntries([...t.matchAll(/^add_header ([\w-]+) "([^"]*)" always;/gm)].filter((m) => m[1] !== "X-Robots-Tag").map((m) => [m[1]!, m[2]!]));
};
const SECU = entetes("security-headers.conf");
const SECU_MUSIQUE = entetes("security-headers-musique.conf");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain" };
function statique(req: IncomingMessage, res: ServerResponse) {
  const chemin = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const candidat = (p: string) => { const f = join(DIST, p); return f.startsWith(DIST) && existsSync(f) && statSync(f).isFile() ? f : null; };
  const f = chemin === "/" ? candidat("index.html") : candidat(chemin) ?? candidat(join(chemin, "index.html")) ?? candidat("app.html");
  res.writeHead(200, { ...(chemin === "/dashboard/musique" ? SECU_MUSIQUE : SECU), "Content-Type": TYPES[extname(f!)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(readFileSync(f!));
}
const http = createHttpServer((req, res) => {
  if ((req.url ?? "").startsWith("/api/")) { req.headers["x-real-ip"] = "127.0.0.1"; return void api(req, res); }
  statique(req, res);
});
await new Promise<void>((ok) => http.listen(port, "127.0.0.1", ok));
writeFileSync(SORTIE, JSON.stringify({ url: origin, lina, octets: mp3.length }), { mode: 0o600 });
console.log(`pile musique prête : ${origin}`);
const fin = async () => { http.close(); ytapi.close(); s.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); };
process.on("SIGTERM", () => void fin());
process.on("SIGINT", () => void fin());
