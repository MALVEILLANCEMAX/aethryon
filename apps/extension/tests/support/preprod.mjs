// Accès à la PRÉPRODUCTION isolée (site + compte http://127.0.0.1:18110, ytapi à faux worker
// http://127.0.0.1:18111), comme e2e/api.test.mjs : utilisateur jetable créé par l'outil de session de
// test, clé ytc_ créée par l'API du site, compte supprimé à la fin. Les secrets (cookie, clé) restent en
// mémoire, ne sont jamais affichés ; le fichier de session temporaire est lu puis supprimé du conteneur.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

export const WEB = process.env.WEB ?? "http://127.0.0.1:18110";
export const ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:18110";
export const YTAPI = process.env.YTAPI ?? "http://127.0.0.1:18111";
/**
 * Conteneurs de la pile visée : la préproduction (ytc2-pp-*) par défaut ; PP=<préfixe> pour une pile d'essai isolée
 * construite depuis une branche (mêmes rôles : site, account avec sessions de test, ytapi à faux worker).
 */
export const PP_PREFIX = process.env.PP ?? "ytc2-pp";
export const CONTAINERS = { web: `${PP_PREFIX}-web`, account: `${PP_PREFIX}-account`, ytapi: `${PP_PREFIX}-ytapi` };

export function preprodAvailable() {
  try {
    const s = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", CONTAINERS.account, CONTAINERS.ytapi, CONTAINERS.web], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return s.trim().split(/\s+/).every((x) => x === "healthy");
  } catch {
    return false;
  }
}

/** Session Better Auth d'un utilisateur de test (adresse en .test, préproduction seulement) ; admin : rôle administrateur. */
export function testSession(email, { admin = false } = {}) {
  const inner = `/tmp/${email.replace(/\W/g, "_")}.cookie`;
  const args = ["exec", CONTAINERS.account, "node", "dist/tools/create-test-session.js", "--email", email, "--out", inner];
  if (admin) args.push("--admin");
  execFileSync("docker", args, { stdio: ["ignore", "ignore", "inherit"] });
  const cookie = execFileSync("docker", ["exec", CONTAINERS.account, "cat", inner]).toString().trim();
  execFileSync("docker", ["exec", CONTAINERS.account, "rm", "-f", inner]);
  return cookie;
}

export async function web(cookie, path, { method = "GET", body } = {}) {
  const headers = { cookie };
  if (method !== "GET") {
    headers.origin = ORIGIN;
    headers["content-type"] = "application/json";
  }
  const res = await fetch(WEB + path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, body: data };
}

/** Identifiant figé du build de développement (src/manifest-key.dev.json), autorisé en préproduction. */
export const DEV_EXTENSION_ID = "dnllfjakdgmgfiompaheickmbjjlgjdc";

/**
 * Jeton d'extension RÉEL obtenu par le contrat serveur (docs/EXTENSION.md §7), sans fenêtre : consentement
 * HTTP avec la session (comme la page /extension/autoriser), puis échange PKCE comme le service worker.
 * La fenêtre launchWebAuthFlow elle-même est couverte par tests/browser/login.test.mjs.
 * Renvoie {token, expiresAt, user} ; rien n'est affiché.
 */
export async function extensionToken(cookie, { appareil = "Chrome · Linux", extensionId = DEV_EXTENSION_ID } = {}) {
  const redirect_uri = `https://${extensionId}.chromiumapp.org/aethryon`;
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const code_challenge = createHash("sha256").update(verifier).digest("base64url");
  const a = await web(cookie, "/api/extension/authorize", { method: "POST", body: { redirect_uri, state, code_challenge, code_challenge_method: "S256", appareil } });
  if (a.status !== 200) throw new Error(`consentement refusé : HTTP ${a.status} ${a.body?.error ?? ""}`);
  const back = new URL(a.body.redirect);
  if (back.searchParams.get("state") !== state) throw new Error("state différent au retour");
  const res = await fetch(`${WEB}/api/extension/token`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `chrome-extension://${extensionId}` },
    body: JSON.stringify({ code: back.searchParams.get("code"), code_verifier: verifier, redirect_uri }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) throw new Error(`échange refusé : HTTP ${res.status} ${body?.error ?? ""}`);
  return body;
}
