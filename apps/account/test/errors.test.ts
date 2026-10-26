// Textes d'erreur de l'historique (copie exacte de docs/ERREURS.md), état « ralenti » calculé sur les
// seuls échecs côté service, et journal des transitions d'usage sans donnée personnelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTENT_ERROR_CODES } from "../src/status.ts";
import { ERROR_FALLBACK_TEXT, ERROR_TEXT, errorMessage } from "../src/usage.ts";
import { harness, internalCall, newUser, type Harness } from "./helpers.ts";

/** Table de docs/ERREURS.md : lignes « | `code` | HTTP | catégorie | texte | causes | ». */
function canonicalTable(): Map<string, string> {
  const md = readFileSync(new URL("../../../docs/api/ERREURS.md", import.meta.url), "utf8");
  const table = new Map<string, string>();
  for (const line of md.split("\n")) {
    const m = /^\|\s*`([a-z0-9_]+)`\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    assert.ok(cells.length >= 4, `ligne de table incomplète : ${m[1]}`);
    assert.ok(!table.has(m[1]!), `code en double dans ERREURS.md : ${m[1]}`);
    table.set(m[1]!, cells[3]!);
  }
  return table;
}

test("ERROR_TEXT reprend à l'identique chaque code et chaque texte de docs/ERREURS.md", () => {
  const table = canonicalTable();
  assert.ok(table.size >= 30, `table de ERREURS.md introuvable ou tronquée (${table.size} codes)`);
  for (const [code, text] of table) {
    assert.ok(Object.hasOwn(ERROR_TEXT, code), `code absent de ERROR_TEXT : ${code}`);
    assert.equal(ERROR_TEXT[code], text, `texte différent pour ${code}`);
    assert.equal(errorMessage(code), text);
  }
  const extra = Object.keys(ERROR_TEXT).filter((c) => !table.has(c));
  assert.deepEqual(extra, [], "codes de ERROR_TEXT absents de docs/ERREURS.md");
});

test("errorMessage : textes clés et repli générique", () => {
  assert.equal(errorMessage("upstream_forbidden"), "Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403).");
  assert.equal(errorMessage("unavailable"), "Vidéo supprimée ou inaccessible depuis le serveur : la plateforme ne la fournit pas (retirée, masquée ou bloquée dans le pays du serveur).");
  assert.equal(errorMessage(null), null);
  assert.equal(errorMessage(""), null);
  assert.equal(ERROR_FALLBACK_TEXT, "La conversion a échoué.");
  for (const code of ["code_inconnu", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(errorMessage(code), "La conversion a échoué.", code);
  }
});

test("CONTENT_ERROR_CODES : uniquement des codes connus, aucune erreur de service", () => {
  const table = canonicalTable();
  for (const code of CONTENT_ERROR_CODES) assert.ok(table.has(code), `code inconnu : ${code}`);
  assert.equal(new Set(CONTENT_ERROR_CODES).size, CONTENT_ERROR_CODES.length);
  for (const code of ["upstream_forbidden", "download_failed", "bot_check", "upstream_error", "extractor_broken", "conversion_failed",
    "timeout", "internal_error", "worker_crashed", "server_busy", "insufficient_storage", "format_unavailable"]) {
    assert.ok(!CONTENT_ERROR_CODES.includes(code), `${code} est une erreur de service`);
  }
});

async function setup(env: Record<string, string> = {}) {
  const h = await harness({ DAILY_CONVERSIONS: "100", ...env });
  const u = await newUser(h, "historique@example.test");
  const k = (await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body;
  return { h, u, key: k.secret as string };
}

/** Une conversion complète vue par l'API interne : réservation puis état terminal. */
async function conversion(h: Harness, key: string, state: "done" | "error", errorCode?: string): Promise<string> {
  const r = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp4", platform: "youtube" });
  assert.equal(r.body.allow, true);
  const id = r.body.usage_id as string;
  const res = await internalCall(h, `/internal/v1/usage/${id}`, state === "error" ? { state, error_code: errorCode } : { state, size_bytes: 1000 });
  assert.equal(res.status, 200);
  return id;
}

test("historique : upstream_forbidden et unavailable affichent le texte exact et le code", async () => {
  const { h, u, key } = await setup();
  try {
    await conversion(h, key, "error", "upstream_forbidden");
    await conversion(h, key, "error", "unavailable");
    await conversion(h, key, "error", "code_futur");
    const items = (await u.json("/api/activity")).body.items as { errorCode: string; errorMessage: string }[];
    const byCode = new Map(items.map((i) => [i.errorCode, i.errorMessage]));
    assert.equal(byCode.get("upstream_forbidden"), "Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403).");
    assert.equal(byCode.get("unavailable"), ERROR_TEXT.unavailable);
    assert.equal(byCode.get("code_futur"), "La conversion a échoué.");
  } finally { h.close(); }
});

test("état du service : les erreurs de contenu ne rendent pas le service « ralenti »", async () => {
  const { h, u, key } = await setup();
  const state = async () => { h.s.status.invalidate(); return (await u.json("/api/status")).body.state as string; };
  try {
    // 5 réussites + 10 erreurs de contenu : 10/15 avant correction (ralenti) ; 0/5 désormais.
    for (let i = 0; i < 5; i++) await conversion(h, key, "done");
    for (const code of ["not_found", "no_video", "private", "age_restricted", "login_required", "unsupported_url", "too_long", "too_large", "no_audio", "live_not_supported"]) {
      await conversion(h, key, "error", code);
    }
    assert.equal(h.s.usage.errorRatioLastHour(CONTENT_ERROR_CODES), 0);
    assert.equal(h.s.usage.errorRatioLastHour(), 10 / 15); // sans exclusion : l'ancien calcul
    assert.equal(await state(), "ok");
    // Échecs côté service : 5 sur 10 = 0,5 → seuil non dépassé (> 0,5 exigé), puis 6 sur 11 → ralenti.
    for (let i = 0; i < 5; i++) await conversion(h, key, "error", "upstream_forbidden");
    assert.equal(h.s.usage.errorRatioLastHour(CONTENT_ERROR_CODES), 0.5);
    assert.equal(await state(), "ok");
    await conversion(h, key, "error", "download_failed");
    assert.equal(h.s.usage.errorRatioLastHour(CONTENT_ERROR_CODES), 6 / 11);
    assert.equal(await state(), "degraded");
  } finally { h.close(); }
});

test("état du service : un blocage de la plateforme (unavailable, geo_restricted) reste compté", async () => {
  const { h, key } = await setup();
  try {
    // TikTok refusant tous les posts à l'IP du serveur (statut 10204) doit pouvoir marquer le service « ralenti ».
    for (let i = 0; i < 2; i++) await conversion(h, key, "done");
    for (const code of ["unavailable", "unavailable", "geo_restricted"]) await conversion(h, key, "error", code);
    assert.equal(h.s.usage.errorRatioLastHour(CONTENT_ERROR_CODES), 3 / 5);
  } finally { h.close(); }
});

test("état du service : moins de 5 conversions comptées → pas de ratio (seuil conservé)", async () => {
  const { h, u, key } = await setup();
  try {
    // 4 échecs de service et beaucoup d'erreurs de contenu : seules 4 lignes comptent → pas de verdict.
    for (let i = 0; i < 4; i++) await conversion(h, key, "error", "bot_check");
    for (let i = 0; i < 6; i++) await conversion(h, key, "error", "private");
    assert.equal(h.s.usage.errorRatioLastHour(CONTENT_ERROR_CODES), null);
    h.s.status.invalidate();
    assert.equal((await u.json("/api/status")).body.state, "ok");
    // Un échec sans code reste un échec de service.
    await conversion(h, key, "error");
    assert.equal(h.s.usage.errorRatioLastHour(CONTENT_ERROR_CODES), 1);
    h.s.status.invalidate();
    assert.equal((await u.json("/api/status")).body.state, "degraded");
  } finally { h.close(); }
});

test("journal : une ligne « usage update » par transition, sans e-mail ni jeton", async () => {
  const { h, key } = await setup();
  try {
    const before = h.logs.length;
    const id = await conversion(h, key, "error", "upstream_forbidden");
    assert.equal((await internalCall(h, "/internal/v1/usage/inexistant123", { state: "done" })).status, 404);
    const lines = h.logs.slice(before);
    const updates = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === "usage update");
    assert.equal(updates.length, 2);
    const [hit, miss] = updates;
    assert.deepEqual([hit!.level, hit!.usage, hit!.state, hit!.error_code, hit!.found], ["info", id, "error", "upstream_forbidden", true]);
    assert.deepEqual([miss!.usage, miss!.state, miss!.error_code, miss!.found], ["inexistant123", "done", null, false]);
    const text = lines.join("\n");
    assert.ok(!text.includes("historique@example.test"), "e-mail dans les journaux");
    assert.ok(!text.includes(key) && !text.includes(key.slice(4, 24)), "jeton dans les journaux");
    for (const u of updates) assert.ok(!JSON.stringify(u).includes("@"));
  } finally { h.close(); }
});
