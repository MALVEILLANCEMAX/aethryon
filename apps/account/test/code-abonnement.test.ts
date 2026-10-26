// AETHRYON V3 : inscription par code à 6 chiffres (signup.ts), politique des mots de passe (password-policy.ts, mêmes
// règles que le site), e-mails en ligne (chouette jointe, aucun lien d'image distant), abonnement et « Me prévenir »
// (abonnement.ts), migration 009.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Browser, fakeMailer, harness, newUser, type FakeMailer } from "./helpers.ts";
import { appliedVersions, migrateDown, migrateUp } from "../src/db.ts";
import { COMMON_BASES, isCommonPassword, PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "../src/password-policy.ts";
import { buildMessage } from "../src/mailer.ts";

const PASSWORD = "cheval-agrafe-42";
const codeOf = (m: FakeMailer, i = -1) => {
  const mail = m.sent.at(i)!;
  const c = /^([0-9]{6}) est ton code AETHRYON$/.exec(mail.subject)?.[1];
  assert.ok(c, `code dans l'objet : ${mail.subject}`);
  return c!;
};
const linkTokenOf = (m: FakeMailer, i = -1) => /\/inscription#([A-Za-z0-9_-]{43})/.exec(m.sent.at(i)!.text)![1]!;
const demande = (b: Browser, email: string) => b.json("/api/inscription/demande", { method: "POST", body: { email } });
const saisir = (b: Browser, email: string, code: string) => b.json("/api/inscription/code", { method: "POST", body: { email, code } });

test("code : demande → e-mail (code en grand, chouette jointe, lien de secours) → code juste → jeton → compte ; code à usage unique", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    const b = new Browser(h);
    assert.equal((await demande(b, "code@example.test")).status, 202);
    const mail = m.sent[0]!;
    const code = codeOf(m);
    // E-mail : code (texte et HTML), lien de secours, chouette jointe en ligne, aucune image distante.
    assert.match(mail.text, new RegExp(`Ton code de vérification AETHRYON : ${code.slice(0, 3)} ${code.slice(3)}`));
    assert.match(mail.text, /\/inscription#[A-Za-z0-9_-]{43}/);
    assert.ok(mail.html.includes(`>${code}<`), "code en grand dans le HTML");
    assert.ok(mail.html.includes('src="cid:chouette@aethryon"'), "chouette jointe");
    assert.doesNotMatch(mail.html, /<img[^>]+src="https?:/, "aucune image chargée depuis un serveur");
    // Délivrabilité (mail-tester sur de vrais envois Brevo, 2026-10-14) : aucun texte invisible (FONT_INVIS_MSGID),
    // aucun lien dont le texte est une adresse (Brevo réécrit les liens : domaine affiché ≠ cible).
    assert.doesNotMatch(mail.html, /display:\s*none|font-size:\s*[01]px|font-size:\s*0\b|max-height:\s*0|mso-hide/i, "aucun texte invisible");
    for (const [, text = ""] of mail.html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)) assert.doesNotMatch(text, /https?:|\.[a-z]{2,}\b/i, `lien dont le texte est une adresse : ${text}`);
    assert.equal(mail.inline?.[0]?.contentType, "image/png");
    assert.ok((mail.inline?.[0]?.content.length ?? 0) > 1000);
    // Message MIME : alternative [ texte, related [ HTML, image en ligne ] ].
    const raw = buildMessage("AETHRYON <auth@example.test>", mail);
    assert.match(raw, /^Message-ID: <[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.test>$/m, "Message-ID de forme courante");
    assert.match(raw, /multipart\/alternative/);
    assert.match(raw, /multipart\/related/);
    assert.match(raw, /Content-ID: <chouette@aethryon>/);
    // En base : l'empreinte, jamais le code.
    const row = h.s.db.prepare("SELECT code_hash, code_expires_at, code_attempts FROM ytc_signup_token").get() as Record<string, string | number>;
    assert.equal(String(row.code_hash).length, 64);
    assert.ok(!String(row.code_hash).includes(code));
    assert.equal(row.code_attempts, 0);
    const ttl = Date.parse(String(row.code_expires_at)) - Date.now();
    assert.ok(ttl > 9 * 60_000 && ttl <= 10 * 60_000, "code valable 10 minutes");
    // Code juste : jeton neuf ; le lien de l'e-mail ne sert plus (le jeton a été remplacé).
    const link = linkTokenOf(m);
    const ok = await saisir(b, " CODE@example.test ", code);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.email, "code@example.test");
    assert.match(ok.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await b.json("/api/inscription/verifier", { method: "POST", body: { token: link } })).status, 400, "lien remplacé");
    assert.deepEqual((await b.json("/api/inscription/verifier", { method: "POST", body: { token: ok.body.token } })).body, { email: "code@example.test" });
    // Le même code ne resert pas.
    assert.equal((await saisir(new Browser(h), "code@example.test", code)).body.error, "invalid_code");
    // Étape suivante : nom et mot de passe, compte créé, session ouverte.
    const f = await b.json("/api/inscription/terminer", { method: "POST", body: { token: ok.body.token, name: "Léa", password: PASSWORD } });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    assert.equal((await b.json("/api/me")).body.user.email, "code@example.test");
    // Journaux : ni le code, ni le jeton, ni l'adresse.
    const logs = h.logs.join("\n");
    for (const s of [code, ok.body.token, link, "code@example.test"]) assert.ok(!logs.includes(s), `journal : ${String(s).slice(0, 6)}…`);
  } finally { h.close(); }
});

test("code : réponses identiques (code faux, adresse avec compte, aucune demande, format invalide) ; 5 échecs annulent la demande, lien compris", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    await newUser(h, "deja@example.test");
    const b = new Browser(h);
    await demande(b, "essais@example.test");
    const code = codeOf(m);
    const link = linkTokenOf(m);
    const wrong = code === "000000" ? "111111" : "000000";
    // Adresse qui a déjà un compte : aucune demande en base, mais la même réponse qu'un code faux.
    await demande(b, "deja@example.test");
    const responses = [
      await saisir(new Browser(h), "deja@example.test", "123456"),
      await saisir(new Browser(h), "personne@example.test", "123456"),
      await saisir(new Browser(h), "essais@example.test", wrong),
      await saisir(new Browser(h), "essais@example.test", "12a456"),
      await saisir(new Browser(h), "pas-une-adresse", "123456"),
    ];
    assert.deepEqual(new Set(responses.map((r) => JSON.stringify([r.status, r.body]))).size, 1, "une seule réponse d'erreur");
    assert.equal(responses[0]!.body.error, "invalid_code");
    // Quatre autres échecs (5 en tout) : la demande est annulée ; même le bon code et le lien ne servent plus.
    for (let i = 0; i < 4; i++) assert.equal((await saisir(new Browser(h), "essais@example.test", wrong)).body.error, "invalid_code");
    const r = h.s.db.prepare("SELECT code_attempts, used_at FROM ytc_signup_token WHERE email = ?").get("essais@example.test") as { code_attempts: number; used_at: string | null };
    assert.equal(r.code_attempts, 5);
    assert.ok(r.used_at, "demande annulée");
    assert.equal((await saisir(new Browser(h), "essais@example.test", code)).body.error, "invalid_code");
    assert.equal((await b.json("/api/inscription/verifier", { method: "POST", body: { token: link } })).status, 400);
  } finally { h.close(); }
});

test("code : expiré → refusé ; nouvelle demande (après le délai) → l'ancien code et l'ancien lien sont annulés ; 10 essais par 15 min et par adresse", async () => {
  const m = fakeMailer();
  const h = await harness({ SIGNUP_RESEND_S: "0" }, { mailer: m });
  try {
    const b = new Browser(h);
    await demande(b, "exp@example.test");
    const c1 = codeOf(m);
    h.s.db.prepare("UPDATE ytc_signup_token SET code_expires_at = ? WHERE email = ?").run(new Date(Date.now() - 1000).toISOString(), "exp@example.test");
    assert.equal((await saisir(b, "exp@example.test", c1)).body.error, "invalid_code", "code expiré");
    // Nouvelle demande : un nouveau code ; l'ancien lien ne sert plus.
    await demande(b, "renvoi@example.test");
    const old = { code: codeOf(m), link: linkTokenOf(m) };
    await demande(b, "renvoi@example.test");
    const fresh = codeOf(m);
    if (fresh !== old.code) assert.equal((await saisir(new Browser(h), "renvoi@example.test", old.code)).body.error, "invalid_code", "ancien code annulé");
    assert.equal((await b.json("/api/inscription/verifier", { method: "POST", body: { token: old.link } })).status, 400, "ancien lien annulé");
    assert.equal((await saisir(new Browser(h), "renvoi@example.test", fresh)).status, 200);
    // Limite par adresse : au-delà de 10 essais en 15 minutes, 429 (quelle que soit l'adresse).
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await saisir(new Browser(h), "inconnu@example.test", "123456")).status);
    assert.deepEqual(codes.slice(-2), [400, 429]);
  } finally { h.close(); }
});

test("politique des mots de passe : 10 à 128 caractères, rien d'imposé d'autre ; mots de passe courants refusés même décorés ; jamais l'adresse", async () => {
  // Acceptés : phrases de passe, caractères variés ou non, émojis, accents.
  for (const pw of ["lune de miel à Dinard", "correcthorsebattery", "Tr0ub4dor&3xyz", "8462910374", "🌙 et ☀️ ensemble", "été-indien-2031"]) {
    assert.equal(passwordProblem(pw), null, pw);
  }
  // Refusés : trop court, trop long, courants (même décorés), suites, répétitions.
  assert.equal(passwordProblem("court")?.code, "password_too_short");
  assert.equal(passwordProblem("x".repeat(PASSWORD_MAX + 1))?.code, "password_too_long");
  for (const pw of ["Motdepasse1!", "Azerty2024!", "PASSWORD1234", "1234567890", "abcdefghijkl", "aaaaaaaaaaaa", "qwertyuiop12", "Soleil 2024 !!", "azazazazazaz", "abcabcabcabc", "AETHRYON2026"]) {
    assert.equal(passwordProblem(pw)?.code, "password_common", pw);
    assert.ok(isCommonPassword(pw), pw);
  }
  // À l'inscription : ni l'adresse, ni sa partie avant « @ », ni le nom (même suivis de chiffres).
  assert.equal(passwordProblem("lea.martin@example.test", { email: "lea.martin@example.test" })?.code, "password_personal");
  assert.equal(passwordProblem("leamartin2026", { email: "lea.martin@example.test" })?.code, "password_personal");
  assert.equal(passwordProblem("Léa Durand-Martin", { name: "Léa Durand-Martin" })?.code, "password_personal");
  assert.equal(passwordProblem("léa est partie au large", { email: "lea@example.test", name: "Léa" }), null);
  assert.equal(PASSWORD_MIN, 10);
});

test("politique des mots de passe : la MÊME que celle du site (web/src/lib/password.ts : bornes et liste)", () => {
  const web = readFileSync(new URL("../../web/src/lib/password.ts", import.meta.url), "utf8");
  assert.match(web, new RegExp(`export const PASSWORD_MIN = ${PASSWORD_MIN};`));
  assert.match(web, new RegExp(`export const PASSWORD_MAX = ${PASSWORD_MAX};`));
  const list = /export const COMMON_BASES: readonly string\[\] = \[([\s\S]*?)\];/.exec(web)?.[1];
  assert.ok(list, "liste du site introuvable");
  const webBases = [...list!.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(webBases, [...COMMON_BASES]);
});

test("politique appliquée par le serveur : inscription (sans consommer le lien), changement et réinitialisation", async () => {
  const m = fakeMailer();
  const h = await harness({}, { mailer: m });
  try {
    const b = new Browser(h);
    await demande(b, "pol@example.test");
    const ticket = (await saisir(b, "pol@example.test", codeOf(m))).body.token as string;
    // Refusé, et le jeton reste valable : on peut en choisir un autre.
    const r1 = await b.json("/api/inscription/terminer", { method: "POST", body: { token: ticket, name: "Pol", password: "Motdepasse2024!" } });
    assert.deepEqual([r1.status, r1.body.error], [400, "password_common"]);
    const r2 = await b.json("/api/inscription/terminer", { method: "POST", body: { token: ticket, name: "Pol", password: "pol@example.test" } });
    assert.equal(r2.body.error, "password_personal");
    assert.equal((await b.json("/api/inscription/terminer", { method: "POST", body: { token: ticket, name: "Pol", password: PASSWORD } })).status, 201);
    // Changement : refusé s'il est courant (même message que le site), accepté sinon.
    const ch = await b.json("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "Azerty2024!!", revokeOtherSessions: true } });
    assert.deepEqual([ch.status, String(ch.body.code).toLowerCase()], [400, "password_common"]);
    // … et s'il reprend l'adresse du compte (la session donne l'adresse et le nom).
    const chp = await b.json("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "Pol@Example.test", revokeOtherSessions: true } });
    assert.deepEqual([chp.status, String(chp.body.code).toLowerCase()], [400, "password_personal"]);
    assert.equal((await b.req("/api/auth/change-password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "une toute autre phrase", revokeOtherSessions: true } })).status, 200);
    // Réinitialisation : même règle.
    await b.json("/api/auth/request-password-reset", { method: "POST", body: { email: "pol@example.test" } });
    const t = /\/mot-de-passe\/nouveau#([A-Za-z0-9_-]+)/.exec(m.sent.at(-1)!.text)![1]!;
    const rs = await b.json("/api/auth/reset-password", { method: "POST", body: { newPassword: "1234567890", token: t } });
    assert.deepEqual([rs.status, String(rs.body.code).toLowerCase()], [400, "password_common"]);
    const rsp = await b.json("/api/auth/reset-password", { method: "POST", body: { newPassword: "polexampletest2026", token: t } });
    assert.deepEqual([rsp.status, String(rsp.body.code).toLowerCase()], [400, "password_personal"], "le lien donne le compte : adresse refusée");
    assert.equal((await b.json("/api/auth/reset-password", { method: "POST", body: { newPassword: "encore une autre phrase", token: t } })).status, 200, "le lien sert encore après un refus");
  } finally { h.close(); }
});

test("abonnement : offre réelle (Gratuit, aucun paiement) ; « Me prévenir » ajouté, retiré, exporté, effacé avec le compte", async () => {
  const h = await harness();
  try {
    assert.equal((await new Browser(h).json("/api/abonnement")).status, 401);
    const u = await newUser(h, "abo@example.test");
    assert.deepEqual((await u.json("/api/abonnement")).body, { plan: { id: "free", name: "Gratuit", beta: true }, checkout: false, prevenir: false });
    const set = (body: unknown) => u.json("/api/abonnement/prevenir", { method: "POST", body });
    assert.deepEqual((await set({ actif: true })).body, { prevenir: true });
    assert.deepEqual((await set({ actif: true })).body, { prevenir: true }, "idempotent");
    assert.deepEqual((await set({ plan: "pro", actif: true })).body, { prevenir: true }, "page de l'ancienne grille : « plan » sans effet");
    assert.deepEqual((await set({ actif: false })).body, { prevenir: false });
    assert.deepEqual((await set({ actif: true })).body, { prevenir: true });
    for (const bad of [{ plan: "plus" }, { actif: "oui" }, { actif: true, autre: 1 }, null]) {
      assert.equal((await set(bad)).status, 400, JSON.stringify(bad));
    }
    // Origine étrangère : refusée comme toute modification.
    assert.equal((await u.json("/api/abonnement/prevenir", { method: "POST", body: { actif: false }, origin: "https://evil.example" })).status, 403);
    const exp = (await u.json("/api/account/export")).body.abonnement;
    assert.equal(exp.offre, "free");
    assert.equal(exp.prevenir, true);
    assert.deepEqual([exp.droits, exp.abonnements, exp.achats, exp.consentements], [[], [], [], []]);
    const uid = (await u.json("/api/me")).body.user.id as string;
    assert.equal((await u.req("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.equal(h.s.db.prepare("SELECT count(*) AS n FROM ytc_offer_waitlist WHERE user_id = ?").get(uid)!.n, 0, "effacé avec le compte");
  } finally { h.close(); }
});

test("migration 011 : les demandes « Me prévenir » de l'ancienne grille (Plus, Pro) sont reprises, une par compte ; ytc_plan_waitlist intacte", async () => {
  const h = await harness();
  try {
    const db = h.s.db;
    const a = await newUser(h, "ancien-a@example.test");
    const b = await newUser(h, "ancien-b@example.test");
    const ida = (await a.json("/api/me")).body.user.id as string, idb = (await b.json("/api/me")).body.user.id as string;
    assert.deepEqual(migrateDown(db, 6), [16, 15, 14, 13, 12, 11]); // le panneau Premiere (012) est au-dessus
    const ins = db.prepare("INSERT INTO ytc_plan_waitlist (user_id, plan, created_at) VALUES (?, ?, ?)");
    ins.run(ida, "plus", "2026-10-14T10:00:00.000Z"); ins.run(ida, "pro", "2026-10-14T09:00:00.000Z"); ins.run(idb, "pro", "2026-10-14T11:00:00.000Z");
    assert.deepEqual(migrateUp(db), [11, 12, 13, 14, 15, 16]);
    assert.deepEqual(db.prepare("SELECT user_id, created_at FROM ytc_offer_waitlist ORDER BY created_at").all().map((r) => ({ ...r })),
      [{ user_id: ida, created_at: "2026-10-14T09:00:00.000Z" }, { user_id: idb, created_at: "2026-10-14T11:00:00.000Z" }]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM ytc_plan_waitlist").get()!.n, 3, "table d'origine intacte");
    assert.equal((await a.json("/api/abonnement")).body.prevenir, true);
  } finally { h.close(); }
});

test("migration 009 : up → down → up ; anciennes demandes intactes (lien sans code), table « Me prévenir » neuve", async () => {
  const h = await harness();
  try {
    const db = h.s.db;
    assert.equal(appliedVersions(db).at(-1), 16);
    assert.deepEqual(migrateDown(db, 7), [16, 15, 14, 13, 12, 11, 10]); // panneau Premiere (012), facturation (011) et AETHRYON Tools (010) sont au-dessus
    db.prepare("INSERT INTO ytc_signup_token (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)").run("a".repeat(64), "ancien@example.test", new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    assert.deepEqual(migrateDown(db, 1), [9]);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('ytc_signup_token')").all() as { name: string }[]).map((r) => r.name);
    assert.deepEqual(cols, ["token_hash", "email", "created_at", "expires_at", "used_at"]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ytc_plan_waitlist'").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM ytc_signup_token").get()!.n, 1, "demande conservée");
    assert.deepEqual(migrateUp(db), [9, 10, 11, 12, 13, 14, 15, 16]);
    const r = db.prepare("SELECT code_hash, code_attempts FROM ytc_signup_token").get() as { code_hash: string | null; code_attempts: number };
    assert.deepEqual([r.code_hash, r.code_attempts], [null, 0]);
    assert.throws(() => db.prepare("INSERT INTO ytc_plan_waitlist (user_id, plan, created_at) VALUES ('x', 'gold', 'x')").run());
  } finally { h.close(); }
});
