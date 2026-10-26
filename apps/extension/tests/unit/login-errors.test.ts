// Connexion : chaque cause d'échec a sa phrase (jamais « vérifie ta connexion » à tort) — fenêtre fermée,
// page de connexion qui ne se charge pas (réseau coupé, service pas encore déployé, serveur en erreur),
// refus sur la page de consentement, refus du serveur à l'échange (compte suspendu, trop d'extensions liées,
// code expiré, trop de tentatives).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./fakes/harness.ts";
import { json } from "./fakes/fetch.ts";
import { SITE } from "./fakes/backend.ts";
import { classifyWebAuthFlowError } from "../../src/background/auth.ts";
import { loginPageError, tokenExchangeError } from "../../src/background/errors.ts";

const NB = " ";
const PAGE_FAILED = "Authorization page could not be loaded."; // message réel de Chromium (audit du 2026-10-11)
const CLOSED = "The user did not approve access.";

function failingFlow(message: string) {
  return () => {
    throw new Error(message);
  };
}

test("launchWebAuthFlow : messages réels de Chromium classés (fermée, page non chargée, autre)", () => {
  assert.equal(classifyWebAuthFlowError(new Error(CLOSED)), "cancelled");
  assert.equal(classifyWebAuthFlowError(new Error(PAGE_FAILED)), "page");
  assert.equal(classifyWebAuthFlowError(new Error("net::ERR_INTERNET_DISCONNECTED")), "page");
  assert.equal(classifyWebAuthFlowError(new Error("Function unsupported.")), "other");
});

test("fenêtre fermée par l'utilisateur : « Connexion annulée. » — sauf si la page ne pouvait pas aboutir (hors ligne, 404, 5xx)", async (t) => {
  const cases: [number | "network", string, string][] = [
    [200, "auth_cancelled", "Connexion annulée."],
    ["network", "network", `Impossible de joindre AETHRYON${NB}: vérifie ta connexion à Internet, puis réessaie.`],
    [404, "service_missing", "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard."],
    [503, "service_unavailable", "Le site AETHRYON est momentanément indisponible (erreur 503). Réessaie dans quelques minutes."],
  ];
  for (const [status, code, message] of cases) {
    const h = harness(t, { linked: false });
    h.browser.authFlow = null; // fenêtre fermée (« The user did not approve access. »)
    h.backend.pageStatus = status;
    const r = await h.page({ type: "auth.login" });
    assert.deepEqual(r.error, { code, message, retryable: true }, String(status));
    assert.equal(h.backend.pageProbes, 1, "une seule requête simple vers la page, sans clé ni donnée");
    assert.equal(h.backend.tokenBodies.length, 0);
  }
});

test("page de connexion non chargée : la page est interrogée pour dire POURQUOI (réseau, 404, 5xx, autre)", async (t) => {
  const cases: [number | "network", string, string][] = [
    ["network", "network", `Impossible de joindre AETHRYON${NB}: vérifie ta connexion à Internet, puis réessaie.`],
    [404, "service_missing", "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard."],
    [503, "service_unavailable", "Le site AETHRYON est momentanément indisponible (erreur 503). Réessaie dans quelques minutes."],
    [502, "service_unavailable", "Le site AETHRYON est momentanément indisponible (erreur 502). Réessaie dans quelques minutes."],
    [200, "auth_page", "La page de connexion AETHRYON n'a pas pu s'ouvrir. Réessaie dans un instant."],
  ];
  for (const [status, code, message] of cases) {
    const h = harness(t, { linked: false });
    h.browser.authFlow = failingFlow(PAGE_FAILED);
    h.backend.pageStatus = status;
    const r = await h.page({ type: "auth.login" });
    assert.deepEqual(r.error, { code, message, retryable: true }, String(status));
    assert.equal(h.backend.pageProbes, 1, "une seule requête simple vers la page");
    const probe = h.net.calls.find((c) => c.url === `${SITE}/extension/autoriser`)!;
    assert.equal(probe.method, "GET");
    assert.equal(probe.headers.authorization, undefined, "aucune clé ni donnée envoyée");
    assert.equal(probe.init.credentials, "omit");
    assert.equal(h.backend.tokenBodies.length, 0);
    assert.equal(h.browser.auth, undefined);
  }
});

test("refus sur la page de consentement (« Refuser ») : autorisation refusée, rien d'enregistré", async (t) => {
  const h = harness(t, { linked: false });
  h.browser.authFlow = (url) => h.backend.authorize(url, { deny: true });
  const r = await h.page({ type: "auth.login" });
  assert.deepEqual(r.error, { code: "auth_denied", message: `Autorisation refusée${NB}: l'extension n'est pas connectée à ton compte.`, retryable: true });
  assert.equal(h.backend.tokenBodies.length, 0);
});

test("refus du serveur à l'échange du code : compte suspendu, trop d'extensions (limite de 3, « Mes jetons »), code expiré, 404, 5xx, réseau", async (t) => {
  const cases: [() => any, { code: string; message: string; retryable: boolean }][] = [
    [() => json(403, { error: "account_suspended", message: "Ce compte est suspendu." }),
      { code: "account_suspended", message: `Ton compte AETHRYON est suspendu${NB}: l'extension ne peut pas s'y connecter.`, retryable: false }],
    [() => json(409, { error: "too_many_extensions", message: "Tu as déjà 3 extensions connectées à ton compte : révoque un appareil dans « Mes jetons », puis reconnecte l'extension." }),
      { code: "too_many_extensions", message: `Limite atteinte${NB}: 3 extensions au plus peuvent être connectées à un même compte. Révoque un appareil dans «${NB}Mes jetons${NB}», puis reconnecte-toi.`, retryable: false }],
    [() => json(400, { error: "invalid_grant" }),
      { code: "auth_code", message: `Le code de connexion a expiré ou a déjà servi${NB}: recommence la connexion.`, retryable: true }],
    [() => json(429, { error: "rate_limited", message: "Trop de tentatives de connexion : réessaie dans une minute." }),
      { code: "rate_limited", message: `Trop de tentatives de connexion${NB}: réessaie dans une minute.`, retryable: true }],
    [() => json(404, { error: "not_found" }),
      { code: "service_missing", message: "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard.", retryable: true }],
    [() => json(502, { error: "bad_gateway" }),
      { code: "service_unavailable", message: "Le site AETHRYON est momentanément indisponible (erreur 502). Réessaie dans quelques minutes.", retryable: true }],
    [() => "network",
      { code: "network", message: `Impossible de joindre AETHRYON${NB}: vérifie ta connexion à Internet, puis réessaie.`, retryable: true }],
  ];
  for (const [reply, expected] of cases) {
    const h = harness(t, { linked: false });
    h.browser.authFlow = (url) => h.backend.authorize(url);
    h.backend.onToken = reply;
    const r = await h.page({ type: "auth.login" });
    assert.deepEqual(r.error, expected, expected.code);
    assert.equal(h.browser.auth, undefined, "aucune liaison");
  }
});

test("fonctions de correspondance : codes HTTP de la page et de l'échange", () => {
  assert.equal(loginPageError("network").code, "network");
  assert.equal(loginPageError(404).code, "service_missing");
  assert.equal(loginPageError(429).code, "service_unavailable");
  assert.equal(loginPageError(500).code, "service_unavailable");
  assert.equal(loginPageError(403).code, "auth_page");
  assert.equal(tokenExchangeError(0, null).code, "auth_failed");
  assert.equal(tokenExchangeError(418, { message: "Texte du serveur." }).message, "Texte du serveur.");
  assert.equal(tokenExchangeError(403, { error: "invalid_origin", message: "Requête refusée (origine inattendue)." }).code, "auth_failed");
});
