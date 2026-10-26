// Bouton intégré aux pages, compte non connecté : jamais « Échec » quand rien n'a échoué ; l'action utile est
// proposée (« Se connecter à AETHRYON », « Lire la notice », « Mes jetons ») avec une explication claire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFailure, describeJob, describeNoticeOpened, describeSignedIn, describeSigningIn, describeSignInFailure } from "../../src/content/common/job.ts";
import { interpretLoginResponse, NO_ANSWER } from "../../src/content/common/protocol.ts";
import { T, kbps } from "../../src/content/common/strings.ts";

const NB = " ";

test("non connecté (auth_required) : « Connexion requise », motif du service worker, action « Se connecter », pas « Échec »", () => {
  const d = describeFailure({ code: "auth_required", message: `Connexion expirée (30 jours)${NB}: reconnecte-toi.`, retryable: false });
  assert.equal(d.phase, "auth");
  assert.equal(d.label, "Connexion requise");
  assert.equal(d.short, T.trigger, "le bouton garde « Télécharger » : rien n'a échoué");
  assert.equal(d.message, `Connexion expirée (30 jours)${NB}: reconnecte-toi.`);
  assert.equal(d.action, "login");
  assert.equal(d.retryable, false);
  // job refusé en cours de route (clé révoquée) : même présentation
  const j = describeJob({ state: "error", error: { code: "auth_required", message: "Reconnecte-toi.", retryable: false } });
  assert.deepEqual([j.phase, j.action], ["auth", "login"]);
});

test("notice pas encore acceptée (consent_required) : action « Lire la notice » ; puis « ouverte dans un nouvel onglet »", () => {
  const d = describeFailure({ code: "consent_required", message: "Avant la première connexion, lis la notice sur les données et accepte-la.", retryable: false });
  assert.deepEqual([d.phase, d.label, d.action], ["auth", "Notice à accepter", "consent"]);
  const o = describeNoticeOpened();
  assert.deepEqual([o.phase, o.action, o.message], ["auth", "consent", `La notice s’ouvre dans un nouvel onglet${NB}: accepte-la, puis reviens ici.`]);
});

test("connexion depuis la page : attente honnête, réussite (formulaire libre), échec avec la cause ; trop d'extensions → « Mes jetons »", () => {
  const w = describeSigningIn();
  assert.deepEqual([w.phase, w.busy, w.message], ["signing", true, `Une fenêtre AETHRYON s’ouvre${NB}: connecte-toi, puis autorise l’extension.`]);
  const ok = describeSignedIn();
  assert.deepEqual([ok.phase, ok.busy, ok.label, ok.short], ["linked", false, "Connecté", T.trigger]);
  const ko = describeSignInFailure({ code: "service_missing", message: "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard.", retryable: true });
  assert.deepEqual([ko.phase, ko.label, ko.action], ["auth", "Connexion impossible", "login"]);
  assert.equal(describeSignInFailure({ code: "too_many_extensions", message: "Limite atteinte.", retryable: false }).action, "keys");
  assert.equal(describeSignInFailure({ code: "consent_required", message: "Notice.", retryable: false }).action, "consent");
});

test("réponse à auth.login vue par la page : seulement { connected } ; sinon la cause, ou « ne répond pas »", () => {
  assert.deepEqual(interpretLoginResponse({ ok: true, data: { connected: true } }), { ok: true });
  assert.equal(interpretLoginResponse({ ok: true, data: { connected: false } }).ok, false);
  assert.deepEqual(interpretLoginResponse({ ok: false, error: { code: "auth_cancelled", message: "Connexion annulée.", retryable: true } }), { ok: false, error: { code: "auth_cancelled", message: "Connexion annulée.", retryable: true } });
  assert.deepEqual(interpretLoginResponse(undefined), { ok: false, error: NO_ANSWER });
});

test("débits : « kbit/s » partout (même unité que le popup et les réglages)", () => {
  assert.equal(kbps(320), `320${NB}kbit/s`);
  assert.doesNotMatch(kbps(128), /kb\//);
});
