// FAUX serveur OAuth2 de Discord (tests seulement ; aucune requête vers Discord) : vrai serveur HTTP local qui
// imite les trois adresses utilisées par account (docs/DISCORD-BOT.md §3.1) :
//   GET  /oauth2/authorize   page d'autorisation (navigateur) → redirige vers redirect_uri ?code&state (ou ?error)
//   POST /api/oauth2/token   échange du code (client confidentiel, HTTP Basic, formulaire) → jeton d'accès
//   GET  /api/v10/users/@me  utilisateur du jeton (Bearer)
//   GET  /avatars/…, /embed/avatars/…  faux CDN des images de profil (DISCORD_CDN_BASE)
// et une adresse de pilotage pour les tests : POST /__fake/next {profile?, deny?, fail?}.
// Vérifie ce que Discord vérifie : client_id et secret, redirect_uri exacte, scope identify, code à usage unique.
// Utilisable comme module (tests d'account) ou comme serveur autonome (tests de bout en bout, conteneur jetable) :
//   node fake-discord.ts --port 8087 --client-id <id> --client-secret-file <fichier> --redirect-uri <uri>
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

/** PNG 1 × 1 pixel doré (image de profil factice du faux CDN). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+v9/PQAIYAOBUCgiNwAAAABJRU5ErkJggg==", "base64");

export interface FakeProfile { id: string; username: string; discriminator?: string; global_name?: string | null; avatar?: string | null; bot?: boolean }
export type FakeFailure = "token_500" | "token_invalid_json" | "me_500" | "me_bot" | "token_slow";

export interface FakeDiscord {
  url: string;
  /** Profil remis au prochain passage par /oauth2/authorize ; `deny` simule « Annuler » chez Discord. */
  next: { profile: FakeProfile; deny: boolean };
  fail: FakeFailure | null;
  /** Journal des appels (chemin, client authentifié ?, jeton présent ?) — jamais de secret. */
  calls: { method: string; path: string; clientOk?: boolean; grant?: string }[];
  /** Demandes d'autorisation reçues (paramètres, sans le state). */
  authorizeParams: Record<string, string>[];
  /** Codes et jetons d'accès émis (tests : vérifier qu'aucun n'est conservé ni journalisé par account). */
  issued: string[];
  close(): Promise<void>;
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const p of req) parts.push(p as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

export async function startFakeDiscord(opts: { clientId: string; clientSecret: string; redirectUri: string; port?: number; host?: string }): Promise<FakeDiscord> {
  const codes = new Map<string, { profile: FakeProfile; redirectUri: string; used: boolean }>();
  const tokens = new Map<string, FakeProfile>();
  const fake: FakeDiscord = {
    url: "",
    next: { profile: { id: "123456789012345678", username: "testeur" }, deny: false },
    fail: null,
    calls: [],
    authorizeParams: [],
    issued: [],
    close: async () => undefined,
  };
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://fake");
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && u.pathname === "/oauth2/authorize") {
        fake.calls.push({ method, path: u.pathname });
        const p = Object.fromEntries(u.searchParams);
        const { state, ...rest } = p;
        fake.authorizeParams.push(rest);
        if (p.client_id !== opts.clientId) return send(res, 400, { error: "invalid_client" });
        if (p.redirect_uri !== opts.redirectUri) return send(res, 400, { error: "invalid_redirect_uri" });
        if (p.response_type !== "code" || p.scope !== "identify") return send(res, 400, { error: "invalid_scope" });
        const back = new URL(opts.redirectUri);
        if (fake.next.deny) {
          back.searchParams.set("error", "access_denied");
          back.searchParams.set("error_description", "The resource owner or authorization server denied the request");
        } else {
          const code = randomBytes(15).toString("hex");
          codes.set(code, { profile: fake.next.profile, redirectUri: p.redirect_uri, used: false });
          fake.issued.push(code);
          back.searchParams.set("code", code);
        }
        if (state !== undefined) back.searchParams.set("state", state);
        res.writeHead(302, { location: back.href });
        return res.end();
      }
      if (method === "POST" && u.pathname === "/api/oauth2/token") {
        const auth = req.headers.authorization ?? "";
        const expected = "Basic " + Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString("base64");
        const clientOk = auth === expected;
        const form = new URLSearchParams(await readBody(req));
        fake.calls.push({ method, path: u.pathname, clientOk, grant: form.get("grant_type") ?? undefined });
        if (fake.fail === "token_slow") await new Promise((r) => setTimeout(r, 10_000));
        if (fake.fail === "token_500") return send(res, 500, { message: "Internal Server Error" });
        if (!clientOk) return send(res, 401, { error: "invalid_client" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) return send(res, 400, { error: "invalid_request" });
        if (form.get("grant_type") !== "authorization_code") return send(res, 400, { error: "unsupported_grant_type" });
        const entry = codes.get(form.get("code") ?? "");
        if (!entry || entry.used || entry.redirectUri !== form.get("redirect_uri")) return send(res, 400, { error: "invalid_grant", error_description: 'Invalid "code" in request.' });
        entry.used = true;
        if (fake.fail === "token_invalid_json") return send(res, 200, "pas du json");
        const access = randomBytes(20).toString("base64url");
        tokens.set(access, entry.profile);
        fake.issued.push(access);
        return send(res, 200, { access_token: access, token_type: "Bearer", expires_in: 604800, refresh_token: randomBytes(20).toString("base64url"), scope: "identify" });
      }
      if (method === "GET" && u.pathname === "/api/v10/users/@me") {
        fake.calls.push({ method, path: u.pathname });
        if (fake.fail === "me_500") return send(res, 500, { message: "Internal Server Error" });
        const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
        const profile = m ? tokens.get(m[1]!) : undefined;
        if (!profile) return send(res, 401, { message: "401: Unauthorized", code: 0 });
        return send(res, 200, {
          id: profile.id, username: profile.username, discriminator: profile.discriminator ?? "0",
          global_name: profile.global_name ?? null, avatar: profile.avatar ?? null, public_flags: 0, flags: 0,
          ...(fake.fail === "me_bot" || profile.bot ? { bot: true } : {}),
        });
      }
      // Faux CDN (DISCORD_CDN_BASE) : images de profil, 1 × 1 pixel PNG, pour le relais /api/discord/avatar.
      if (method === "GET" && (/^\/avatars\/\d{17,20}\/(a_)?[0-9a-f]{32}\.png$/.test(u.pathname) || /^\/embed\/avatars\/[0-5]\.png$/.test(u.pathname))) {
        fake.calls.push({ method, path: u.pathname });
        res.writeHead(200, { "content-type": "image/png", "content-length": String(PIXEL.length) });
        return res.end(PIXEL);
      }
      if (method === "POST" && u.pathname === "/__fake/next") {
        const b = JSON.parse((await readBody(req)) || "{}") as { profile?: FakeProfile; deny?: boolean; fail?: FakeFailure | null };
        if (b.profile) fake.next.profile = b.profile;
        fake.next.deny = b.deny === true;
        fake.fail = b.fail ?? null;
        return send(res, 200, { ok: true });
      }
      if (method === "GET" && u.pathname === "/__fake/calls") return send(res, 200, { calls: fake.calls, authorize: fake.authorizeParams });
      send(res, 404, { message: "404: Not Found", code: 0 });
    } catch {
      send(res, 500, { message: "fake error" });
    }
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  fake.url = `http://${opts.host === "0.0.0.0" ? "127.0.0.1" : opts.host ?? "127.0.0.1"}:${port}`;
  fake.close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}

// Serveur autonome (conteneur jetable des tests de bout en bout) : aucune donnée réelle, secret lu dans un fichier.
if (process.argv[1]?.endsWith("fake-discord.ts")) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const f = await startFakeDiscord({
    clientId: arg("--client-id") ?? "123456789012345678",
    clientSecret: readFileSync(arg("--client-secret-file") ?? "/run/secrets/discord_client_secret", "utf8").trim(),
    redirectUri: arg("--redirect-uri") ?? "http://localhost:18110/api/discord/callback",
    port: Number(arg("--port") ?? "8087"),
    host: arg("--host") ?? "0.0.0.0",
  });
  process.stdout.write(`faux Discord prêt sur le port ${new URL(f.url).port}\n`);
  process.on("SIGTERM", () => { void f.close().then(() => process.exit(0)); });
}
