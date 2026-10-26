// PRÉPRODUCTION / TESTS UNIQUEMENT : crée (ou réutilise) un utilisateur de test et une session, sans
// passer par Google. Refuse de fonctionner sans YTC_ALLOW_TEST_SESSIONS=1 et pour un e-mail qui ne
// finit pas par « .test ». L'en-tête Cookie prêt à l'emploi est écrit dans un fichier (mode 600),
// jamais sur la sortie standard.
//   node dist/tools/create-test-session.js --email alice@preprod.test [--admin] --out /tmp/alice.cookie
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { buildServer } from "../server.ts";

export async function signedSessionCookie(name: string, token: string, secret: string): Promise<string> {
  const sig = createHmac("sha256", secret).update(token).digest("base64");
  return `${name}=${encodeURIComponent(`${token}.${sig}`)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const email = (opt("--email") ?? "").toLowerCase();
  const out = opt("--out");
  const admin = args.includes("--admin");
  if (process.env.YTC_ALLOW_TEST_SESSIONS !== "1") { console.error("refusé : YTC_ALLOW_TEST_SESSIONS=1 requis (préproduction uniquement)"); process.exit(2); }
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.test$/.test(email) || !out) { console.error("usage : --email <adresse en .test> --out <fichier> [--admin]"); process.exit(2); }

  const cfg = loadConfig();
  if (cfg.publicUrl.startsWith("https://")) { console.error("refusé : outil réservé à la préproduction (PUBLIC_URL en https)"); process.exit(2); }
  const s = await buildServer(cfg);
  const ctx = await s.auth.$context;
  let user = (await ctx.internalAdapter.findUserByEmail(email))?.user;
  if (!user) {
    user = await ctx.internalAdapter.createUser({ email, name: email.split("@")[0]!, emailVerified: true }, { method: "admin" } as never);
  }
  s.db.prepare('UPDATE "user" SET role = ?, status = \'active\' WHERE id = ?').run(admin ? "admin" : "user", user.id);
  const session = await ctx.internalAdapter.createSession(user.id);
  const cookie = await signedSessionCookie(ctx.authCookies.sessionToken.name, session.token, ctx.secret);
  writeFileSync(out, cookie + "\n", { mode: 0o600 });
  console.log(`session de test créée pour ${email}${admin ? " (administrateur)" : ""} ; en-tête Cookie écrit dans ${out}`);
  s.close();
}
