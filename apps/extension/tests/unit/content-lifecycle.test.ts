// Démontage quand le contexte de l'extension est invalidé (extension rechargée ou mise à jour) :
// difficile à provoquer dans un navigateur de test, donc vérifié ici sur la fonction de démontage elle-même.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createLifecycle, extensionContextValid } from "../../src/content/common/lifecycle.ts";

const g = globalThis as { chrome?: unknown };
afterEach(() => {
  delete g.chrome;
});

test("extensionContextValid : id présent → valide ; id disparu, chrome absent ou getter qui lève → invalide", () => {
  assert.equal(extensionContextValid(), false, "pas de chrome");
  g.chrome = { runtime: { id: "dnllfjakdgmgfiompaheickmbjjlgjdc" } };
  assert.equal(extensionContextValid(), true);
  g.chrome = { runtime: { id: undefined } };
  assert.equal(extensionContextValid(), false);
  g.chrome = { runtime: {} };
  assert.equal(extensionContextValid(), false);
  g.chrome = {
    get runtime() {
      throw new Error("Extension context invalidated.");
    },
  };
  assert.equal(extensionContextValid(), false);
});

test("contexte invalidé : tout est démonté UNE fois, en silence, dans l'ordre inverse", () => {
  const runtime: { id?: string } = { id: "dnllfjakdgmgfiompaheickmbjjlgjdc" };
  g.chrome = { runtime };
  const errors: unknown[] = [];
  const lc = createLifecycle(undefined, (e) => errors.push(e));
  const calls: string[] = [];
  lc.add(() => calls.push("observateurs"));
  lc.add(() => {
    calls.push("minuteries");
    throw new Error("échec d'un nettoyage");
  });
  lc.add(() => calls.push("interface"));
  const target = new EventTarget();
  let events = 0;
  lc.listen(target, "fullscreenchange", () => events++);
  let handled = 0;
  const handler = lc.wrap(() => handled++);

  target.dispatchEvent(new Event("fullscreenchange"));
  handler();
  assert.deepEqual([events, handled], [1, 1]);
  assert.equal(lc.check(), true);

  // L'extension est rechargée : chrome.runtime.id devient undefined.
  delete runtime.id;
  assert.doesNotThrow(() => handler());
  assert.equal(handled, 1, "le gestionnaire n'est pas exécuté");
  assert.equal(lc.disposed, true);
  assert.deepEqual(calls, ["interface", "minuteries", "observateurs"]);
  assert.equal(errors.length, 1, "l'erreur d'un nettoyage est avalée, les suivants s'exécutent");

  // Plus rien ne réagit, rien n'est démonté deux fois.
  target.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(events, 1, "écouteur retiré");
  assert.equal(lc.check(), false);
  lc.dispose();
  assert.deepEqual(calls, ["interface", "minuteries", "observateurs"]);
  // Ce qui arrive après le démontage est nettoyé immédiatement.
  let late = 0;
  lc.add(() => late++);
  assert.equal(late, 1);
  lc.listen(target, "x", () => events++);
  target.dispatchEvent(new Event("x"));
  assert.equal(events, 1);
});

test("une exception due à la perte du contexte pendant un traitement démonte aussi", () => {
  const runtime: { id?: string } = { id: "abc" };
  g.chrome = { runtime };
  const lc = createLifecycle();
  let cleaned = 0;
  lc.add(() => cleaned++);
  const handler = lc.wrap(() => {
    delete runtime.id;
    throw new Error("Extension context invalidated.");
  });
  assert.doesNotThrow(() => handler());
  assert.equal(lc.disposed, true);
  assert.equal(cleaned, 1);
});

test("une exception ordinaire ne démonte pas et ne remonte pas à la page", () => {
  g.chrome = { runtime: { id: "abc" } };
  const errors: unknown[] = [];
  const lc = createLifecycle(undefined, (e) => errors.push(e));
  const handler = lc.wrap(() => {
    throw new TypeError("sélecteur cassé");
  });
  assert.doesNotThrow(() => handler());
  assert.equal(lc.disposed, false);
  assert.equal(errors.length, 1);
});
