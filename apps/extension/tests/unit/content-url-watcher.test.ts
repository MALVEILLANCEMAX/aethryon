import { test } from "node:test";
import assert from "node:assert/strict";
import { createUrlTracker, eventSource, navigationApiSource, stripHash, watchUrl, type Source } from "../../src/content/common/url-watcher.ts";

test("tracker : seuls les vrais changements sont signalés (le fragment # n'est pas une navigation)", () => {
  let href = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  const seen: [string, string][] = [];
  const t = createUrlTracker(() => href, (next, prev) => seen.push([next, prev]));
  assert.equal(t.check(), false);
  href += "#comments";
  assert.equal(t.check(), false);
  href = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
  assert.equal(t.check(), true);
  assert.equal(t.check(), false, "pas de second signal pour la même URL");
  assert.deepEqual(seen, [["https://www.youtube.com/watch?v=bbbbbbbbbbb", "https://www.youtube.com/watch?v=aaaaaaaaaaa"]]);
  assert.equal(t.current, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(stripHash("https://x.com/a#b#c"), "https://x.com/a");
});

test("watchUrl : sources d'événements + vérification périodique, puis dispose", () => {
  let href = "https://x.com/home";
  const changes: string[] = [];
  const notifiers: (() => void)[] = [];
  let unsubscribed = 0;
  const fakeSource: Source = (notify) => {
    notifiers.push(notify);
    return () => unsubscribed++;
  };
  const failing: Source = () => {
    throw new Error("API absente");
  };
  let tick: (() => void) | null = null;
  let cleared = false;
  const w = watchUrl({
    read: () => href,
    onChange: (next) => changes.push(next),
    sources: [fakeSource, failing, fakeSource],
    intervalMs: 1000,
    setInterval: (fn) => {
      tick = fn;
      return 7;
    },
    clearInterval: (id) => {
      cleared = id === 7;
    },
  });
  assert.equal(notifiers.length, 2, "une source qui lève n'empêche pas les autres");
  href = "https://x.com/alice/status/1790000000000000001";
  notifiers[0]!(); // ex. currententrychange
  notifiers[1]!(); // ex. popstate pour la même navigation : pas de doublon
  assert.deepEqual(changes, ["https://x.com/alice/status/1790000000000000001"]);
  href = "https://x.com/explore";
  tick!(); // repli périodique
  assert.deepEqual(changes, ["https://x.com/alice/status/1790000000000000001", "https://x.com/explore"]);
  w.dispose();
  assert.equal(unsubscribed, 2);
  assert.equal(cleared, true);
  href = "https://x.com/home";
  notifiers[0]!();
  assert.equal(w.check(), false, "plus rien après dispose");
  assert.equal(changes.length, 2);
  w.dispose(); // idempotent
});

test("eventSource : écoute en capture, retirée à la désinscription", () => {
  const target = new EventTarget();
  let n = 0;
  const off = eventSource(target, "yt-navigate-finish")(() => n++);
  target.dispatchEvent(new Event("yt-navigate-finish"));
  off();
  target.dispatchEvent(new Event("yt-navigate-finish"));
  assert.equal(n, 1);
});

test("navigationApiSource : currententrychange/navigatesuccess ; API absente = sans effet", () => {
  const navigation = new EventTarget();
  let n = 0;
  const off = navigationApiSource({ navigation } as unknown as Window)(() => n++);
  navigation.dispatchEvent(new Event("currententrychange"));
  navigation.dispatchEvent(new Event("navigatesuccess"));
  off();
  navigation.dispatchEvent(new Event("currententrychange"));
  assert.equal(n, 2);
  const none = navigationApiSource({} as Window)(() => n++);
  none();
  assert.equal(n, 2);
});
