// Page d'accord d'AETHRYON pour Premiere Pro (src/lib/premiere.ts) : code utilisateur (même règle que le serveur,
// account/src/premiere.ts), chemin de retour après la connexion (accepté par safeReturnPath), réponses vérifiées.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectPath, formatUserCode, normalizeUserCode, parseDemande, stateOfRefusal } from "../src/lib/premiere.ts";
import { safeReturnPath } from "../src/lib/safe.ts";

test("code utilisateur : 8 consonnes, saisie tolérante, rien d'autre", () => {
  assert.equal(normalizeUserCode("BCDF-GHJK"), "BCDFGHJK");
  assert.equal(normalizeUserCode("bcdf ghjk"), "BCDFGHJK");
  assert.equal(normalizeUserCode("bcdf—ghjk"), "BCDFGHJK");
  for (const bad of [null, undefined, "", "ABCD-EFGH", "BCDF-GHJ", "BCDF-GHJKL", "BCDF/GHJK", "<script>", "B".repeat(40)]) {
    assert.equal(normalizeUserCode(bad), null, String(bad));
  }
  assert.equal(formatUserCode("BCDFGHJK"), "BCDF-GHJK");
});

test("retour après la connexion : chemin relatif de cette page, avec le seul code vérifié", () => {
  assert.equal(connectPath("BCDFGHJK"), "/premiere/connecter?code=BCDF-GHJK");
  assert.equal(connectPath(null), "/premiere/connecter");
  const origin = "https://raccourci.malvu.fr";
  assert.equal(safeReturnPath(connectPath("BCDFGHJK"), origin), "/premiere/connecter?code=BCDF-GHJK");
});

test("réponse de /api/premiere/demande vérifiée champ par champ ; état d'un refus 409/410", () => {
  const ok = { codeUtilisateur: "BCDF-GHJK", etat: "en-attente", appareil: { hote: "PC", versionPremiere: "25.2", versionExtension: null }, creeLe: "2026-10-18T10:00:00.000Z", expireLe: "2026-10-18T10:10:00.000Z" };
  assert.deepEqual(parseDemande(ok), { ...ok, appareil: { hote: "PC", versionPremiere: "25.2", versionExtension: null } });
  assert.equal(parseDemande({ ...ok, appareil: null })!.appareil, null);
  for (const bad of [null, "x", { ...ok, etat: "autre" }, { ...ok, expireLe: 3 }, { ...ok, codeUtilisateur: undefined }]) assert.equal(parseDemande(bad), null);
  assert.equal(stateOfRefusal({ error: "code_used", etat: "utilise" }), "utilise");
  assert.equal(stateOfRefusal({ error: "too_many_premiere" }), null);
  assert.equal(stateOfRefusal(null), null);
});
