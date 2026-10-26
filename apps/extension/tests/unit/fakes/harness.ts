// Banc de test du service worker : faux navigateur + faux serveurs + worker réel (src/background).
/* eslint-disable @typescript-eslint/no-explicit-any */
import "./setup.ts";
import type { TestContext } from "node:test";
import { createWorker, type Worker } from "../../../src/background/worker.ts";
import { CONSENT_VERSION } from "../../../src/shared/consent.ts";
import type { Timing } from "../../../src/background/timing.ts";
import { FakeBackend, TOKEN } from "./backend.ts";
import { FakeBrowser } from "./chrome.ts";
import { createFakeFetch } from "./fetch.ts";

/** Délais réduits (les mêmes chemins de code, en millisecondes). */
export const FAST: Partial<Timing> = {
  pollWaitS: 0, pollTimeoutMs: 2_000, minPollIntervalMs: 0, requestTimeoutMs: 2_000, accountTimeoutMs: 500, popupAccountTimeoutMs: 300,
  detectTimeoutMs: 60, logoutTimeoutMs: 300, backoffMs: [5, 5, 5], maxPollFailures: 3, progressIntervalMs: 10,
  accountBusyMaxWaitMs: 2_000, retryAfterMinMs: 5, retryAfterMaxMs: 25,
  desktopProgressMs: 40, desktopIdleMs: 30, desktopRetryMs: 2_000,
};

export const LINKED = { token: TOKEN, expiresAt: null, email: "alice@example.test", name: "Alice", linkedAt: "2026-10-10T10:00:00.000Z" };
export const TT_URL = "https://www.tiktok.com/@e2e/video/7123456789012345678";
export const YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** Accord à la notice sur les données (src/shared/consent.ts), tel que l'écrit le service worker. */
export const CONSENTED = { version: CONSENT_VERSION, at: "2026-10-11T08:00:00.000Z" };

export function harness(t: TestContext, opts: { linked?: boolean; consent?: boolean; updateDue?: boolean; timing?: Partial<Timing> } = {}) {
  const browser = new FakeBrowser();
  const backend = new FakeBackend();
  const net = createFakeFetch(backend.handle);
  if (opts.consent !== false) browser.store.local.set("consent", structuredClone(CONSENTED));
  // Vérification de mise à jour faite à l'instant (aucune requête latest.json), sauf pour les tests qui en parlent.
  if (!opts.updateDue) browser.store.local.set("update", { checkedAt: Date.now() });
  if (opts.linked !== false) browser.store.local.set("auth", structuredClone(LINKED));
  const make = (): Worker => {
    const w = createWorker({ fetch: net.fetch, timing: { ...FAST, ...opts.timing } });
    w.install();
    void w.resume();
    return w;
  };
  let worker = make();
  t.after(() => worker.stop());
  return {
    browser, backend, net,
    get worker() { return worker; },
    /** Arrêt du service worker puis nouveau démarrage (mémoire perdue, stockage et téléchargements gardés). */
    restart(): Worker {
      worker.stop();
      browser.restartWorker();
      worker = make();
      return worker;
    },
    page: (msg: unknown): Promise<any> => browser.send(msg, browser.pageSender()),
    content: (msg: unknown, url = "https://www.tiktok.com/@e2e/video/7123456789012345678", tabId = 7): Promise<any> =>
      browser.send(msg, browser.contentSender(url, tabId)),
    job: (key?: string): any => (key ? browser.jobs.find((j: any) => j.key === key) : browser.jobs[0]),
    /** Toutes les chaînes qui ont quitté le worker : URL appelées, téléchargements, messages, stockage de session. */
    leaks(): string[] {
      return [
        ...net.calls.map((c) => c.url),
        ...browser.downloadCalls.map((d) => d.url),
        ...browser.authFlows.map((f) => f.url),
        JSON.stringify(browser.pageMessages),
        JSON.stringify(browser.tabMessages),
        JSON.stringify([...browser.store.session.entries()]),
        JSON.stringify(browser.notifications),
        // 3.5.2 : canal Native Messaging vers AETHRYON Desktop.
        JSON.stringify(browser.nativeMessages),
      ];
    },
  };
}
