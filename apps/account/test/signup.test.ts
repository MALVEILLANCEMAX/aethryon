// Inscription et connexion par e-mail et mot de passe (src/signup.ts, src/auth.ts) : adresse vérifiée AVANT la
// création du compte, réponses identiques qu'un compte existe ou non, route d'inscription de Better Auth fermée au
// public, liaison Google sûre, mot de passe oublié, limites, et rien de sensible dans les journaux.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { Browser, fakeMailer, googleLogin, harness, newUser, ORIGIN, type FakeMailer } from "./helpers.ts";
import { buildMessage, SmtpMailer } from "../src/mailer.ts";
import { loadConfig, ConfigError } from "../src/config.ts";

const PASSWORD = "cheval-agrafe-42";
const tokenOf = (m: FakeMailer, i = -1) => {
  const mail = m.sent.at(i)!;
  const t = /#([A-Za-z0-9_-]{20,})/.exec(mail.text)?.[1];
  assert.ok(t, "jeton dans le lien");
  return t!;
};

/** Inscription complète : demande, lien reçu, fin d'inscription ; renvoie le navigateur connecté. */
async function signup(h: Awaited<ReturnType<typeof harness>>, m: FakeMailer, email: string, name = "Léa") {
  const b = new Browser(h);
  assert.equal((await b.json("/api/inscription/demande", { method: "POST", body: { email } })).status, 202);
  const r = await b.json("/api/inscription/terminer", { method: "POST", body: { token: tokenOf(m), name, password: PASSWORD } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return b;
}

test("fermée sans relais d'e-mails : aucune route e-mail, /api/config le dit ; /sign-up/email de Better Auth toujours fermée", async () => {
  const h = await harness();
  try {
    const b = new Browser(h);
    assert.equal((await b.json("/api/config")).body.emailEnabled, false);
    assert.equal((await b.json("/api/inscription/demande", { method: "POST", body: { email: "a@example.test" } })).status, 503);
    for (const p of ["/api/auth/sign-in/email", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/sign-up/email"]) {
      assert.equal((await b.req(p, { method: "POST", body: { email: "a@example.test", password: PASSWORD, name: "x" } })).status, 404, p);
    }
  } finally { h.close(); }
});

test("parcours : demande → lien (jeton haché en base, aucun compte) → vérification → compte vérifié, session, mot de passe haché", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    const b = new Browser(h);
    assert.equal((await b.json("/api/config")).body.emailEnabled, true);
    // Route publique de Better Auth : fermée même quand l'inscription par e-mail est ouverte.
    assert.equal((await b.req("/api/auth/sign-up/email", { method: "POST", body: { email: "x@example.test", password: PASSWORD, name: "x" } })).status, 404);
    for (const email of ["", "pas-une-adresse", "a@b", "a b@example.test", "<a@example.test>", "a@example.test\r\nBcc: x@y.test"]) {
      assert.equal((await b.json("/api/inscription/demande", { method: "POST", body: { email } })).status, 400, JSON.stringify(email));
    }
    assert.equal((await b.json("/api/inscription/demande", { method: "POST", body: { email: "a@example.test", autre: 1 } })).status, 400);
    const d = await b.json("/api/inscription/demande", { method: "POST", body: { email: "  Lea.Martin@Example.TEST " } });
    assert.deepEqual([d.status, d.body], [202, { ok: true, expiresInMinutes: 30, codeLength: 6, codeExpiresInMinutes: 10, resendAfterSeconds: 60 }]);
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0]!.to, "lea.martin@example.test");
    assert.match(m.sent[0]!.subject, /^[0-9]{6} est ton code AETHRYON$/);
    assert.match(m.sent[0]!.text, new RegExp(`${ORIGIN}/inscription#[A-Za-z0-9_-]{43}`));
    assert.match(m.sent[0]!.html, /Créer mon compte/);
    const token = tokenOf(m);
    const row = h.s.db.prepare("SELECT * FROM ytc_signup_token").get() as Record<string, string>;
    assert.notEqual(row.token_hash, token, "seule l'empreinte est gardée");
    assert.equal(row.token_hash?.length, 64);
    assert.equal(h.s.db.prepare('SELECT count(*) AS n FROM "user"').get()!.n, 0, "aucun compte avant le lien");
    // Vérification du lien (page « Termine ton inscription »).
    assert.deepEqual((await b.json("/api/inscription/verifier", { method: "POST", body: { token } })).body, { email: "lea.martin@example.test" });
    assert.equal((await b.json("/api/inscription/verifier", { method: "POST", body: { token: "x".repeat(43) } })).status, 400);
    // Fin : nom et mot de passe contrôlés.
    assert.equal((await b.json("/api/inscription/terminer", { method: "POST", body: { token, name: "Léa", password: "court" } })).body.error, "invalid_password");
    assert.equal((await b.json("/api/inscription/terminer", { method: "POST", body: { token, name: "  ", password: PASSWORD } })).body.error, "invalid_name");
    const f = await b.json("/api/inscription/terminer", { method: "POST", body: { token, name: "  Léa   Martin ", password: PASSWORD } });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    const me = await b.json("/api/me");
    assert.equal(me.status, 200);
    assert.deepEqual([me.body.user.email, me.body.user.name], ["lea.martin@example.test", "Léa Martin"]);
    const u = h.s.db.prepare('SELECT id, "emailVerified", role, status, image FROM "user"').get() as Record<string, unknown>;
    assert.deepEqual([u.emailVerified, u.role, u.status, u.image], [1, "user", "active", null]);
    const acc = h.s.db.prepare("SELECT providerId, password FROM account WHERE userId = ?").get(u.id as string) as { providerId: string; password: string };
    assert.equal(acc.providerId, "credential");
    assert.ok(acc.password && !acc.password.includes(PASSWORD), "mot de passe haché");
    // Le lien a servi : plus jamais.
    assert.equal((await new Browser(h).json("/api/inscription/terminer", { method: "POST", body: { token, name: "X", password: PASSWORD } })).body.error, "invalid_token");
    assert.equal((await new Browser(h).json("/api/inscription/verifier", { method: "POST", body: { token } })).status, 400);
    // Connexion par mot de passe : bonne, mauvaise, puis limite (5 par minute et par IP).
    const c = new Browser(h);
    assert.equal((await c.req("/api/auth/sign-in/email", { method: "POST", body: { email: "lea.martin@example.test", password: PASSWORD } })).status, 200);
    assert.equal((await c.json("/api/me")).body.user.email, "lea.martin@example.test");
    const x = new Browser(h);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await x.req("/api/auth/sign-in/email", { method: "POST", body: { email: "lea.martin@example.test", password: "mauvais-mot-de-passe" } })).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
    // Rien de sensible dans les journaux : ni jeton, ni mot de passe, ni adresse.
    const logs = h.logs.join("\n");
    for (const s of [token, PASSWORD, "lea.martin@example.test"]) assert.ok(!logs.includes(s), `journal : ${s.slice(0, 6)}…`);
  } finally { h.close(); }
});

test("même réponse qu'un compte existe ou non ; le propriétaire seul est prévenu ; lien expiré ; un lien = un compte", async () => {
  const m = fakeMailer();
  // SIGNUP_RESEND_S=0 : les adresses sont redemandées moins d'une minute après leur inscription.
  const h = await harness({ SIGNUP_RESEND_S: "0" }, { mailer: m });
  try {
    await signup(h, m, "deja@example.test");
    await newUser(h, "google@example.test");
    const b = new Browser(h);
    const r1 = await b.json("/api/inscription/demande", { method: "POST", body: { email: "deja@example.test" } });
    const r2 = await b.json("/api/inscription/demande", { method: "POST", body: { email: "google@example.test" } });
    const r3 = await b.json("/api/inscription/demande", { method: "POST", body: { email: "neuf@example.test" } });
    assert.deepEqual([r1, r2, r3].map((r) => [r.status, JSON.stringify(r.body)]), Array(3).fill([202, JSON.stringify({ ok: true, expiresInMinutes: 30, codeLength: 6, codeExpiresInMinutes: 10, resendAfterSeconds: 0 })]));
    const [m1, m2, m3] = m.sent.slice(-3);
    assert.equal(m1!.subject, "Tu as déjà un compte AETHRYON");
    assert.match(m1!.text, /connecte-toi avec ton adresse e-mail et ton mot de passe/);
    assert.ok(!/#[A-Za-z0-9_-]{43}/.test(m1!.text), "aucun lien d'inscription pour une adresse déjà prise");
    assert.match(m2!.text, /connecte-toi avec Google/);
    assert.match(m2!.text, /ou pour en ajouter un/);
    assert.match(m3!.subject, /^[0-9]{6} est ton code AETHRYON$/);
    // Lien expiré : refusé.
    h.s.db.prepare("UPDATE ytc_signup_token SET expires_at = ? WHERE used_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
    assert.equal((await b.json("/api/inscription/terminer", { method: "POST", body: { token: tokenOf(m), name: "N", password: PASSWORD } })).body.error, "invalid_token");
    // Deux demandes pour la même adresse : la seconde annule la première (un seul code et un seul lien valables).
    const c = new Browser(h);
    await c.json("/api/inscription/demande", { method: "POST", body: { email: "double@example.test" } });
    const t1 = tokenOf(m);
    await c.json("/api/inscription/demande", { method: "POST", body: { email: "double@example.test" } });
    const t2 = tokenOf(m);
    assert.equal((await c.json("/api/inscription/terminer", { method: "POST", body: { token: t1, name: "D", password: PASSWORD } })).body.error, "invalid_token", "premier lien annulé");
    assert.equal((await c.json("/api/inscription/terminer", { method: "POST", body: { token: t2, name: "D", password: PASSWORD } })).status, 201);
  } finally { h.close(); }
});

test("délai entre deux envois (60 s par défaut) : une nouvelle demande dans la minute reçoit la même réponse, sans e-mail", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    const b = new Browser(h);
    const r1 = await b.json("/api/inscription/demande", { method: "POST", body: { email: "vite@example.test" } });
    const r2 = await b.json("/api/inscription/demande", { method: "POST", body: { email: "vite@example.test" } });
    assert.deepEqual([r1.status, r2.status, r1.body.resendAfterSeconds], [202, 202, 60]);
    assert.deepEqual(r1.body, r2.body);
    assert.equal(m.sent.length, 1, "un seul e-mail dans la minute");
    // Le premier code reste valable (rien n'a été remplacé).
    const code = /^([0-9]{6}) est ton code/.exec(m.sent[0]!.subject)![1]!;
    assert.equal((await b.json("/api/inscription/code", { method: "POST", body: { email: "vite@example.test", code } })).status, 200);
  } finally { h.close(); }
});

test("Better Auth ne crée JAMAIS de compte e-mail sans la marque interne (appel direct refusé)", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    await assert.rejects(h.s.auth.api.signUpEmail({ body: { email: "pirate@example.test", password: PASSWORD, name: "P" } }));
    await assert.rejects(h.s.auth.api.signUpEmail({ body: { email: "pirate@example.test", password: PASSWORD, name: "P" }, headers: new Headers({ "x-ytc-signup": "devine" }) }));
    assert.equal(h.s.db.prepare('SELECT count(*) AS n FROM "user"').get()!.n, 0);
  } finally { h.close(); }
});

test("Google ↔ mot de passe : même adresse vérifiée → même compte ; compte Google : mot de passe ajouté par « mot de passe oublié »", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    // Compte e-mail, puis connexion Google avec la même adresse : relié, pas de second compte.
    await signup(h, m, "mixte@example.test", "Mixte");
    const g = new Browser(h);
    const r = await googleLogin(g, { sub: "g-mixte", email: "mixte@example.test", email_verified: true, name: "Mixte G" });
    assert.equal(r.status, 302);
    assert.match(String(r.location), /\/dashboard$/);
    assert.equal(h.s.db.prepare('SELECT count(*) AS n FROM "user"').get()!.n, 1);
    const provs = (h.s.db.prepare("SELECT providerId FROM account ORDER BY providerId").all() as { providerId: string }[]).map((x) => x.providerId);
    assert.deepEqual(provs, ["credential", "google"]);
    assert.equal((await g.json("/api/me")).body.user.name, "Mixte", "nom inchangé par Google");
    // Compte Google seul : « mot de passe oublié » ajoute un mot de passe (l'adresse est prouvée par le lien).
    await newUser(h, "gseul@example.test");
    const b = new Browser(h);
    const rq = await b.json("/api/auth/request-password-reset", { method: "POST", body: { email: "gseul@example.test" } });
    assert.equal(rq.status, 200);
    const reset = m.sent.at(-1)!;
    assert.equal(reset.subject, "Ton nouveau mot de passe AETHRYON");
    const t = /\/mot-de-passe\/nouveau#([A-Za-z0-9_-]+)/.exec(reset.text)![1]!;
    // Adresse inconnue : même réponse, aucun e-mail.
    const before = m.sent.length;
    const unknown = await new Browser(h).json("/api/auth/request-password-reset", { method: "POST", body: { email: "inconnu@example.test" } });
    assert.deepEqual([unknown.status, unknown.body], [rq.status, rq.body]);
    assert.equal(m.sent.length, before);
    assert.equal((await b.json("/api/auth/reset-password", { method: "POST", body: { newPassword: "court", token: t } })).status, 400);
    assert.equal((await b.json("/api/auth/reset-password", { method: "POST", body: { newPassword: PASSWORD, token: t } })).status, 200);
    assert.equal((await b.json("/api/auth/reset-password", { method: "POST", body: { newPassword: PASSWORD, token: t } })).status, 400, "jeton à usage unique");
    const c = new Browser(h);
    assert.equal((await c.req("/api/auth/sign-in/email", { method: "POST", body: { email: "gseul@example.test", password: PASSWORD } })).status, 200);
    // Suppression du compte : comme pour un compte Google (session récente).
    assert.equal((await c.req("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.equal(h.s.db.prepare('SELECT count(*) AS n FROM "user" WHERE email = ?').get("gseul@example.test")!.n, 0);
  } finally { h.close(); }
});

test("page « Ton compte » : façons de se connecter dans /api/me ; changement de mot de passe (mot de passe actuel exigé, autres sessions fermées, limite)", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    const g = await newUser(h, "g@example.test");
    assert.deepEqual((await g.json("/api/me")).body.login, { google: true, password: false });
    const b = await signup(h, m, "mdp@example.test");
    assert.deepEqual((await b.json("/api/me")).body.login, { google: false, password: true });
    // Une deuxième session du même compte : fermée par le changement.
    const other = new Browser(h);
    assert.equal((await other.req("/api/auth/sign-in/email", { method: "POST", body: { email: "mdp@example.test", password: PASSWORD } })).status, 200);
    assert.equal((await b.req("/api/auth/change-password", { method: "POST", body: { currentPassword: "pas-le-bon-mot", newPassword: "nouveau-mot-de-passe-1", revokeOtherSessions: true } })).status, 400);
    assert.equal((await b.req("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "court", revokeOtherSessions: true } })).status, 400);
    assert.equal((await b.req("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "nouveau-mot-de-passe-1", revokeOtherSessions: true } })).status, 200);
    assert.equal((await b.json("/api/me")).status, 200, "la session en cours reste ouverte");
    assert.equal((await other.json("/api/me")).status, 401, "les autres sessions sont fermées");
    assert.equal((await new Browser(h).req("/api/auth/sign-in/email", { method: "POST", body: { email: "mdp@example.test", password: PASSWORD } })).status, 401, "ancien mot de passe refusé");
    assert.equal((await new Browser(h).req("/api/auth/sign-in/email", { method: "POST", body: { email: "mdp@example.test", password: "nouveau-mot-de-passe-1" } })).status, 200);
    // Sans session : refusé.
    assert.equal((await new Browser(h).req("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "encore-un-autre-1" } })).status, 401);
    // Compte Google sans mot de passe : rien à changer.
    assert.notEqual((await g.req("/api/auth/change-password", { method: "POST", body: { currentPassword: "x".repeat(12), newPassword: "encore-un-autre-1" } })).status, 200);
  } finally { h.close(); }
});

test("limites et fermetures : 5 demandes par IP, 3 e-mails par adresse et par heure, inscriptions fermées, liste d'invités, relais en panne", async () => {
  const m = fakeMailer();
  // SIGNUP_RESEND_S=0 : sans le délai d'une minute entre deux envois, pour mesurer le plafond horaire seul.
  const h = await harness({ SIGNUP_RESEND_S: "0", ALLOWED_EMAILS: "invite@example.test,a1@example.test,a2@example.test,a3@example.test,a4@example.test,a5@example.test,b@example.test" }, { mailer: m });
  try {
    const b = new Browser(h);
    const codes: number[] = [];
    for (let i = 1; i <= 6; i++) codes.push((await b.json("/api/inscription/demande", { method: "POST", body: { email: `a${i}@example.test` } })).status);
    assert.deepEqual(codes, [202, 202, 202, 202, 202, 429]);
    const n0 = m.sent.length;
    for (let i = 0; i < 4; i++) assert.equal((await new Browser(h).json("/api/inscription/demande", { method: "POST", body: { email: "b@example.test" } })).status, 202);
    assert.equal(m.sent.length - n0, 3, "3 e-mails au plus par heure pour une adresse, même réponse ensuite");
    const n1 = m.sent.length;
    assert.equal((await new Browser(h).json("/api/inscription/demande", { method: "POST", body: { email: "pas-invite@example.test" } })).status, 202);
    assert.equal(m.sent.length, n1, "adresse non invitée : même réponse, aucun e-mail");
    // Relais en panne : la réponse ne change pas (envoi en arrière-plan), l'échec est journalisé sans adresse.
    m.fail = true;
    assert.equal((await new Browser(h).json("/api/inscription/demande", { method: "POST", body: { email: "invite@example.test" } })).status, 202);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(h.logs.some((l) => l.includes('"mail failed"') && !l.includes("invite@example.test")));
    m.fail = false;
    // Inscriptions fermées (réglage du Control Center).
    h.s.db.prepare("INSERT INTO ytc_setting (key, value, updated_at, updated_by) VALUES ('signups_open', 'false', ?, NULL) ON CONFLICT(key) DO UPDATE SET value = 'false'").run(new Date().toISOString());
    assert.equal((await new Browser(h).json("/api/inscription/demande", { method: "POST", body: { email: "invite@example.test" } })).body.error, "signups_closed");
  } finally { h.close(); }
});

test("plafond global d'e-mails par jour (relais partagé) : au-delà, même réponse, rien ne part", async () => {
  const m = fakeMailer();
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const pw = join(tmpdir(), `smtp-${process.pid}`);
  writeFileSync(pw, "secret-relais", { mode: 0o600 });
  const h = await harness({ SMTP_HOST: "smtp-relay.example.test", SMTP_USER: "u@relay.test", SMTP_PASSWORD_FILE: pw, MAIL_FROM: "AETHRYON <auth@example.test>", MAIL_DAILY_MAX: "2" }, { mailer: m });
  try {
    for (let i = 1; i <= 3; i++) assert.equal((await new Browser(h).json("/api/inscription/demande", { method: "POST", body: { email: `cap${i}@example.test` } })).status, 202);
    assert.equal(m.sent.length, 2);
    assert.ok(h.logs.some((l) => l.includes('"mail daily cap"')));
  } finally { h.close(); (await import("node:fs")).rmSync(pw, { force: true }); }
});

test("plafond d'inscriptions atteint entre le lien et la fin : refus net, aucun compte", async () => {
  const m = fakeMailer();
  const h = await harness({ MAX_USERS: "1" }, { mailer: m });
  try {
    const b = new Browser(h);
    await b.json("/api/inscription/demande", { method: "POST", body: { email: "tard@example.test" } });
    const t = tokenOf(m);
    await newUser(h, "premier@example.test");
    const r = await b.json("/api/inscription/terminer", { method: "POST", body: { token: t, name: "T", password: PASSWORD } });
    assert.equal(r.body.error, "signups_closed");
    assert.equal(h.s.db.prepare('SELECT count(*) AS n FROM "user"').get()!.n, 1);
  } finally { h.close(); }
});

test("SMTP : STARTTLS exigé (jamais de mot de passe en clair) ; faux serveur local : conversation et message MIME conformes", async () => {
  const received: string[] = [];
  let tls = false;
  const srv = createServer((sock: Socket) => {
    sock.setEncoding("utf8");
    let data = false, buf = "";
    sock.write("220 faux SMTP\r\n");
    sock.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        received.push(line);
        if (data) { if (line === ".") { data = false; sock.write("250 accepté\r\n"); } continue; }
        if (/^EHLO /.test(line)) sock.write(tls ? "250-faux\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n" : "250-faux\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN /.test(line)) sock.write("235 ok\r\n");
        else if (/^(MAIL FROM|RCPT TO):/.test(line)) sock.write("250 ok\r\n");
        else if (line === "DATA") { data = true; sock.write("354 vas-y\r\n"); }
        else if (line === "QUIT") sock.end("221 au revoir\r\n");
        else if (line === "STARTTLS") sock.write("454 pas maintenant\r\n");
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  try {
    const cfg = { host: "127.0.0.1", port, user: "u@relay.test", password: "mot-de-passe-relais", from: "AETHRYON <auth@example.test>", dailyMax: 10 };
    // Sans STARTTLS proposé et sans exception locale : refus AVANT l'envoi du mot de passe.
    await assert.rejects(new SmtpMailer({ ...cfg, insecureLocal: false }).send({ to: "dest@example.test", subject: "s", text: "t", html: "<p>h</p>" }), /STARTTLS indisponible/);
    assert.ok(!received.some((l) => l.startsWith("AUTH")), "aucun AUTH sans TLS");
    received.length = 0;
    await new SmtpMailer({ ...cfg, insecureLocal: true }).send({ to: "dest@example.test", subject: "Termine ton inscription à AETHRYON", text: "Bonjour\n.\nfin", html: "<p>é</p>" });
    assert.equal(received[0], "EHLO example.test");
    assert.equal(received[1], `AUTH PLAIN ${Buffer.from("\0u@relay.test\0mot-de-passe-relais").toString("base64")}`);
    assert.deepEqual(received.slice(2, 5), ["MAIL FROM:<auth@example.test>", "RCPT TO:<dest@example.test>", "DATA"]);
    const msg = received.slice(5, received.indexOf(".")).join("\n");
    assert.match(msg, /^From: AETHRYON <auth@example\.test>$/m);
    assert.match(msg, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
    assert.match(msg, /^Content-Type: multipart\/alternative; boundary="ae-[0-9a-f]{24}"$/m);
    assert.equal(received.at(-1), "QUIT");
    // Contrôle du relais (outil smtp-check) : authentification puis QUIT, jamais MAIL FROM ni DATA.
    received.length = 0;
    await new SmtpMailer({ ...cfg, insecureLocal: true }).verify();
    assert.deepEqual(received.map((l) => l.split(" ")[0]), ["EHLO", "AUTH", "QUIT"]);
    // Destinataire avec retour à la ligne : refusé avant toute connexion.
    await assert.rejects(new SmtpMailer({ ...cfg, insecureLocal: true }).send({ to: "a@example.test\r\nRCPT TO:<b@example.test>", subject: "s", text: "t", html: "h" }), /invalide/);
  } finally { srv.close(); }
  // Message : le texte « . » seul sur une ligne est encodé en base64 (aucune fin de DATA prématurée).
  const raw = buildMessage("AETHRYON <auth@example.test>", { to: "d@example.test", subject: "x", text: "a\n.\nb", html: "h" });
  assert.ok(!raw.split("\r\n").includes("."));
});

test("configuration SMTP : fermée sans mot de passe ; adresses et hôtes contrôlés ; exception locale bornée", async () => {
  const h = await harness();
  try {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const pw = join(h.dir, "smtp");
    writeFileSync(pw, "secret-relais\n", { mode: 0o600 });
    const base = { ...h.env, SMTP_HOST: "smtp-relay.example.test", SMTP_USER: "u@relay.test", MAIL_FROM: "AETHRYON <auth@example.test>" };
    assert.equal(loadConfig(base as NodeJS.ProcessEnv).mail, null, "mot de passe absent : fermée");
    const c = loadConfig({ ...base, SMTP_PASSWORD_FILE: pw } as NodeJS.ProcessEnv).mail!;
    assert.deepEqual([c.host, c.port, c.user, c.password, c.insecureLocal, c.dailyMax], ["smtp-relay.example.test", 587, "u@relay.test", "secret-relais", false, 150]);
    assert.equal(loadConfig({ ...base, SMTP_PASSWORD_FILE: pw, MAIL_DAILY_MAX: "20" } as NodeJS.ProcessEnv).mail!.dailyMax, 20);
    assert.throws(() => loadConfig({ ...base, SMTP_PASSWORD_FILE: pw, MAIL_FROM: "auth@example.test" } as NodeJS.ProcessEnv), ConfigError);
    assert.throws(() => loadConfig({ ...base, SMTP_PASSWORD_FILE: pw, SMTP_HOST: "" } as NodeJS.ProcessEnv), ConfigError);
    assert.throws(() => loadConfig({ ...base, SMTP_PASSWORD_FILE: pw, SMTP_INSECURE_LOCAL: "1" } as NodeJS.ProcessEnv), ConfigError, "jamais sur un vrai relais");
    assert.equal(loadConfig({ ...base, SMTP_PASSWORD_FILE: pw, SMTP_HOST: "faux-smtp", SMTP_INSECURE_LOCAL: "1" } as NodeJS.ProcessEnv).mail!.insecureLocal, true);
  } finally { h.close(); }
});
