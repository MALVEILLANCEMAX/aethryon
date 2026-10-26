import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, isExtensionPage, parseBgRequest } from "../../src/shared/messages.ts";

test("job.start : champs valides acceptés, titre nettoyé", () => {
  const r = parseBgRequest({ type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4", quality: "720", index: 2, title: "  Titre\u0000 ‮à l'envers  " });
  assert.deepEqual(r, { type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4", quality: "720", index: 2, title: "Titre à l'envers" });
});

test("rejets : type inconnu, champ en trop, valeurs hors liste, mauvais types", () => {
  for (const bad of [
    null, 42, "job.start", [], {},
    { type: "eval", code: "x" },
    { type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "gif" },
    { type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4", quality: "4320" },
    { type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp3", bitrate: 256 },
    { type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4", index: 0 },
    { type: "job.start", url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4", token: "ytc_x" },
    { type: "job.start", url: 12, fmt: "mp4" },
    { type: "job.retry", key: "../../etc" },
    { type: "auth.logout", extra: true },
  ]) assert.equal(parseBgRequest(bad), null, JSON.stringify(bad));
});

test("requêtes sans paramètre", () => {
  for (const type of ["jobs.list", "popup.init", "account.refresh", "auth.login", "auth.logout"]) {
    assert.deepEqual(parseBgRequest({ type }), { type });
  }
  assert.deepEqual(parseBgRequest({ type: "job.cancel", key: "abcdefgh12" }), { type: "job.cancel", key: "abcdefgh12" });
});

test("expéditeur : page de l'extension seulement (pas un content script, pas une autre extension)", () => {
  const id = "dnllfjakdgmgfiompaheickmbjjlgjdc";
  assert.equal(isExtensionPage({ id, url: `chrome-extension://${id}/popup/popup.html` }, id), true);
  // Réglages ouverts dans un onglet (options_ui.open_in_tab) : page de l'extension, acceptée.
  assert.equal(isExtensionPage({ id, url: `chrome-extension://${id}/options/options.html`, tab: { id: 1 } as chrome.tabs.Tab }, id), true);
  // Content script de notre extension sur une page web : refusé (son URL est celle de la page).
  assert.equal(isExtensionPage({ id, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", tab: { id: 1 } as chrome.tabs.Tab }, id), false);
  assert.equal(isExtensionPage({ id: "autre", url: `chrome-extension://autre/popup.html` }, id), false);
  assert.equal(isExtensionPage({ id, url: "https://www.youtube.com/" }, id), false);
});

test("cleanText : contrôle, bidi et longueur", () => {
  assert.equal(cleanText("a\nb\tc​d", 100), "a b c d");
  assert.equal(cleanText("x".repeat(500), 10).length, 10);
  // espace insécable gardée (typographie des messages du service worker affichés dans les pages)
  assert.equal(cleanText("Réessaie \u00a0: maintenant  \u00a0 ;", 100), "Réessaie\u00a0: maintenant\u00a0;");
});
