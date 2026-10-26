// Outils des tests navigateur (Playwright + Chromium, extension réellement chargée).
// - Aucun accès réseau : TOUTE requête http(s) passe par le routeur ; les pages de plateformes sont des
//   pages FABRIQUÉES (tests/fixtures) servies sous les vrais noms d'hôte, tout le reste est bloqué et
//   journalisé ; en plus, la résolution DNS est coupée (--host-resolver-rules).
// - L'interface AETHRYON vit dans des racines Shadow DOM FERMÉES : on l'inspecte par le protocole
//   DevTools (DOM.getDocument pierce:true), et on clique comme un utilisateur (souris, événements
//   « isTrusted »). Aucun attribut ni crochet de test dans le code de l'extension.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES = join(ROOT, "tests", "fixtures");
const require = createRequire(import.meta.url);

/** playwright-core : variable PLAYWRIGHT_CORE, sinon l'installation npx connue, sinon node_modules. */
export function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright-core"].filter(Boolean);
  const errors = [];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      errors.push(`${c}: ${e.message}`);
    }
  }
  throw new Error(`playwright-core introuvable :\n${errors.join("\n")}`);
}

/** Construit l'extension de développement (dist-dev) et renvoie son chemin. */
export function buildDev() {
  execFileSync(process.execPath, [join(ROOT, "scripts", "build.mjs"), "--target=dev"], { cwd: ROOT, stdio: "pipe" });
  return join(ROOT, "dist-dev");
}

/** Hôtes des plateformes (et de leurs CDN) : aucune requête ne doit les atteindre. */
export const PLATFORM_HOST = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com|ggpht\.com|tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|ibyteimg\.com|tiktokv\.com|x\.com|twitter\.com|twimg\.com|instagram\.com|cdninstagram\.com)$/i;

export async function launch(extPath) {
  const { chromium } = loadPlaywright();
  const userDataDir = mkdtempSync(join(tmpdir(), "aethryon-content-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    // « chromium » = nouveau mode headless de Chromium complet, qui charge les extensions.
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: "fr-FR",
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost",
    ],
  });

  // Routeur : pages fabriquées pour les URL connues, blocage de tout le reste.
  const routes = [];
  const log = { served: [], blocked: [] };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    // Ressources de l'extension elle-même (pages chrome-extension://) : locales, jamais du réseau.
    if (url.startsWith("chrome-extension://")) return route.continue();
    const hit = routes.find((r) => r.test.test(url));
    if (hit) {
      log.served.push(url);
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: hit.body() });
    }
    log.blocked.push(url);
    return route.abort("blockedbyclient");
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;

  return {
    context,
    extensionId,
    log,
    /** Sert un fixture (fichier de tests/fixtures ou HTML littéral) pour les URL qui correspondent. */
    serve(test, fixture) {
      routes.unshift({ test, body: () => (fixture.startsWith("<") ? fixture : readFileSync(join(FIXTURES, fixture), "utf8")) });
    },
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Page de l'extension (réglages) : appels chrome.* réels (storage.sync, tabs.sendMessage). */
export async function extensionPage(env) {
  const page = await env.context.newPage();
  await page.goto(`chrome-extension://${env.extensionId}/options/options.html`);
  return {
    page,
    setSettings: (settings) => page.evaluate((s) => chrome.storage.sync.set({ settings: s }), settings),
    getSettings: () => page.evaluate(async () => (await chrome.storage.sync.get("settings")).settings ?? null),
    clearSettings: () => page.evaluate(() => chrome.storage.sync.clear()),
    /** detect.request envoyé à chaque onglet (sans permission « tabs » : seules les réponses comptent). */
    detect: () => page.evaluate(async () => {
      const out = [];
      for (const t of await chrome.tabs.query({})) {
        try {
          const r = await chrome.tabs.sendMessage(t.id, { type: "detect.request" });
          if (r !== undefined) out.push(r);
        } catch {
          /* onglet sans content script */
        }
      }
      return out;
    }),
    /** job.update envoyé par une page de l'extension (le service worker de cette branche n'est qu'un stub). */
    jobUpdate: (job) => page.evaluate(async (j) => {
      for (const t of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(t.id, { type: "job.update", job: j });
        } catch {
          /* onglet sans content script */
        }
      }
    }, job),
  };
}

export async function waitFor(fn, { timeout = 6000, interval = 50, message = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`délai dépassé : ${message} (dernier résultat : ${last instanceof Error ? last.message : JSON.stringify(last)})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ---- Inspection des racines Shadow DOM fermées (protocole DevTools) ------------------------------

/** Lecture de l'état de chaque hôte AETHRYON de la page, dans l'ordre du document. */
const READ_HOST = function () {
  const host = this;
  const anchorEl = host.closest("[data-fixture]");
  const parent = host.parentElement;
  return {
    tag: host.tagName.toLowerCase(),
    fixture: anchorEl ? anchorEl.getAttribute("data-fixture") : null,
    parentId: parent ? parent.id || null : null,
    parentTag: parent ? parent.tagName.toLowerCase() : null,
    inQuote: !!host.closest(".fx-quote"),
    afterQuote: !!(host.previousElementSibling && host.previousElementSibling.classList.contains("fx-quote")),
    variant: host.getAttribute("data-variant"),
    hidden: host.hidden,
    display: getComputedStyle(host).display,
    rect: (() => { const r = host.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
  };
};
const READ_UI = function () {
  const q = (s) => this.querySelector(s);
  const text = (s) => (q(s) ? q(s).textContent : null);
  const root = this.classList.contains("aeth") ? this : q(".aeth");
  const ctl = root.querySelector(".trigger")?.closest(".aeth") ?? null;
  const pop = ctl ? ctl.querySelector(".pop") : null;
  const shown = (el) => !!el && !el.hidden && !el.closest("[hidden]");
  const choices = (box) => (box ? [...box.querySelectorAll(".choice")].map((b) => ({ label: b.firstElementChild.textContent, checked: b.getAttribute("aria-checked") === "true" })) : []);
  const views = pop ? Object.fromEntries([...pop.querySelectorAll(".view")].map((v) => [v.getAttribute("data-view"), v])) : {};
  const vg = pop?.querySelector(".group");
  const bar = ctl?.querySelector(".tbar") ?? null;
  return {
    theme: root.getAttribute("data-theme"),
    phase: ctl?.getAttribute("data-phase") ?? null,
    compact: ctl?.hasAttribute("data-compact") ?? false,
    label: ctl?.querySelector(".label")?.textContent ?? null,
    aria: ctl?.querySelector(".trigger")?.getAttribute("aria-label") ?? null,
    open: pop ? pop.matches(":popover-open") : false,
    view: pop?.getAttribute("data-view") ?? null,
    title: pop?.querySelector(".title")?.textContent ?? null,
    ctx: pop?.querySelector(".ctx")?.textContent ?? null,
    /** Lignes du menu principal visibles (même menu fermé) : nom, libellé, seconde ligne, désactivée. */
    rows: pop ? [...pop.querySelectorAll(".view[data-view=main] .row")].filter((r) => !r.hidden && !r.parentElement.closest(".rows[hidden]")).map((r) => ({
      row: r.getAttribute("data-row"), label: r.querySelector(".r-label")?.textContent ?? null, sub: r.querySelector(".r-sub")?.textContent ?? null, disabled: r.disabled,
    })) : [],
    paused: pop && shown(pop.querySelector(".paused")) ? pop.querySelector(".paused").textContent : null,
    /** Choix de la vidéo d'une publication X (null s'il n'y a qu'une vidéo). */
    videos: vg && !vg.hidden ? [...vg.querySelectorAll(".opt")].map((o) => ({ label: o.textContent, checked: o.querySelector("input").checked, disabled: o.querySelector("input").disabled })) : null,
    quality: choices(views.quality),
    bitrate: choices(views.bitrate),
    /** 3.5.1 : destination (Téléchargements | Premiere Pro), son explication et son avertissement. */
    dest: pop?.querySelector(".dest") ? (() => {
      const box = pop.querySelector(".dest");
      const seg = box.querySelector(".d-seg");
      const legend = seg.getAttribute("aria-labelledby") ? pop.querySelector(`[id="${seg.getAttribute("aria-labelledby")}"]`)?.textContent ?? null : null;
      return {
        shown: shown(box),
        role: seg.getAttribute("role"),
        legend,
        options: [...seg.querySelectorAll(".opt")].map((o) => ({ label: o.textContent, role: o.getAttribute("role"), checked: o.getAttribute("aria-checked") === "true", tabindex: o.getAttribute("tabindex") })),
        note: shown(box.querySelector(".d-note:not(.d-warn)")) ? box.querySelector(".d-note:not(.d-warn)").textContent : null,
        warn: shown(box.querySelector(".d-warn")) ? box.querySelector(".d-warn").textContent : null,
        describedBy: (seg.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => pop.querySelector(`[id="${id}"]`)?.textContent ?? `#${id} absent`),
      };
    })() : null,
    // 3.6.0 : éditeur d'extrait (src/extrait) — champs HH:MM:SS.mmm, réglette, format, lecture du passage, Tools.
    clip: views.clip ? {
      empty: shown(views.clip.querySelector(".c-empty")),
      times: views.clip.querySelector(".ce-f-start input") ? `${views.clip.querySelector(".ce-f-start input").value} → ${views.clip.querySelector(".ce-f-end input").value}` : null,
      // 3.8.0 (TimeLens) : durée dans la bulle de la réglette, note du format en infobulle, limites lues (data-limits).
      len: views.clip.querySelector(".tl-bubble")?.textContent ?? null,
      out: views.clip.querySelector(".ce-fmt .ce-opt[aria-checked=true]")?.textContent ?? null,
      note: views.clip.querySelector(".ce-fmt .ce-opt[aria-checked=true]")?.getAttribute("title") ?? null,
      limits: views.clip.querySelector(".ce")?.getAttribute("data-limits") ?? "",
      handles: [...views.clip.querySelectorAll(".tl-h")].map((h) => Number(h.getAttribute("aria-valuenow"))),
      playing: views.clip.querySelector(".ce-play")?.getAttribute("aria-pressed") === "true",
      tools: shown(views.clip.querySelector(".ce-tools")),
    } : null,
    toolbar: bar ? {
      folded: bar.hasAttribute("data-folded"),
      width: Math.round(bar.getBoundingClientRect().width),
      chip: bar.querySelector(".tb-chip")?.textContent ?? "",
      buttons: [...bar.querySelectorAll(".tb-btn")].filter((b) => !b.hidden).map((b) => ({ cls: [...b.classList].find((c) => c.startsWith("tb-") && c !== "tb-btn"), label: b.querySelector("span")?.textContent ?? null, text: getComputedStyle(b.querySelector("span")).display !== "none", disabled: b.disabled })),
    } : null,
    status: pop && !pop.querySelector(".status").hidden ? {
      phase: pop.querySelector(".status").getAttribute("data-phase"),
      role: pop.querySelector(".status").getAttribute("role"),
      state: pop.querySelector(".state").textContent,
      message: pop.querySelector(".msg").textContent,
      retry: !pop.querySelector(".retry").hidden,
      cancel: !pop.querySelector(".sbtn.cancel").hidden,
      show: !pop.querySelector(".sbtn.show").hidden,
      action: pop.querySelector(".act") && !pop.querySelector(".act").hidden ? pop.querySelector(".act").textContent : null,
      actionDisabled: pop.querySelector(".act")?.disabled ?? null,
      keys: pop.querySelector(".keys") && !pop.querySelector(".keys").hidden ? pop.querySelector(".keys").getAttribute("href") : null,
    } : null,
    owl: (() => { const svg = ctl?.querySelector(".trigger .disc svg"); return svg ? { small: svg.hasAttribute("data-small"), surface: svg.getAttribute("data-surface"), size: svg.getAttribute("width") } : null; })(),
    panelTitle: text(".ptitle"),
    fontFamily: getComputedStyle(root).getPropertyValue("--font").trim(),
  };
};

export async function cdpFor(page) {
  const cdp = await page.context().newCDPSession(page);
  // Contextes d'exécution (dont le monde isolé du content script) : annoncés à Runtime.enable.
  const contexts = new Map();
  cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.set(context.id, context));
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => contexts.delete(executionContextId));
  cdp.on("Runtime.executionContextsCleared", () => contexts.clear());
  await cdp.send("DOM.enable");
  await cdp.send("Runtime.enable");

  /** Évalue une expression dans le monde isolé du content script de l'extension (inspection de test). */
  async function evalInContentScript(extensionId, expression) {
    const ctx = [...contexts.values()].find((c) => c.auxData?.type === "isolated" && c.origin === `chrome-extension://${extensionId}`);
    if (!ctx) throw new Error("monde isolé du content script introuvable");
    const r = await cdp.send("Runtime.evaluate", { contextId: ctx.id, expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Arbre complet, racines fantômes comprises (un premier appel peut les omettre : on recommence). */
  async function snapshot(selector) {
    let list = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      const byId = new Map();
      const walk = (n) => {
        byId.set(n.nodeId, n);
        for (const c of n.children ?? []) walk(c);
        for (const r of n.shadowRoots ?? []) walk(r);
        if (n.contentDocument) walk(n.contentDocument);
      };
      walk(root);
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
      list = nodeIds.map((id) => {
        const n = byId.get(id);
        const r = n?.shadowRoots?.[0];
        return { nodeId: id, backend: n?.backendNodeId, shadowNodeId: r?.nodeId ?? null, shadowBackend: r?.backendNodeId ?? null, shadowType: r?.shadowRootType ?? null };
      });
      if (list.every((h) => h.shadowNodeId !== null)) return list;
    }
    return list;
  }
  async function callOn(target, fn, ...args) {
    const { object } = await cdp.send("DOM.resolveNode", target);
    try {
      const r = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: fn.toString(),
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
    }
  }
  /** Identifiant courant (nodeId) de la racine fantôme d'un hôte, retrouvée par son backendNodeId stable. */
  async function shadowOf(h) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      let found = null;
      const walk = (n) => {
        if (found) return;
        if (n.backendNodeId === h.shadowBackend) found = n.nodeId;
        for (const c of n.children ?? []) walk(c);
        for (const r of n.shadowRoots ?? []) walk(r);
      };
      walk(root);
      if (found) return found;
    }
    throw new Error("racine fantôme introuvable (hôte retiré ?)");
  }
  async function query(shadowNodeId, selector) {
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: shadowNodeId, selector });
    return nodeIds;
  }
  /** État complet de chaque commande (hôte + interface dans la racine fermée), dans l'ordre du document. */
  async function controls(selector = "aethryon-control, aethryon-panel") {
    const out = [];
    for (const h of await snapshot(selector)) {
      const info = await callOn({ backendNodeId: h.backend }, READ_HOST);
      info.shadowMode = h.shadowType;
      const [aeth] = h.shadowNodeId !== null ? await query(h.shadowNodeId, ".aeth") : [];
      info.ui = aeth ? await callOn({ nodeId: aeth }, READ_UI) : null;
      if (!info.ui) throw new Error("interface illisible dans la racine fermée");
      info.handle = { backend: h.backend, shadowBackend: h.shadowBackend };
      out.push(info);
    }
    return out;
  }
  /** Centre (coordonnées de la fenêtre) d'un élément de la racine fermée, choisi par sélecteur et texte. */
  async function centerOf(h, selector, textEquals) {
    for (const id of await query(await shadowOf(h), selector)) {
      const r = await callOn({ nodeId: id }, function (t) {
        if (t !== null && this.textContent.trim() !== t) return null;
        const b = this.getBoundingClientRect();
        return b.width && b.height ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
      }, textEquals ?? null);
      if (r) return r;
    }
    throw new Error(`élément introuvable dans la racine fermée : ${selector}${textEquals ? ` « ${textEquals} »` : ""}`);
  }
  /** Clic réel (souris) sur un élément de la racine fermée. */
  async function click(h, selector, textEquals) {
    const p = await centerOf(h, selector, textEquals);
    await page.mouse.click(p.x, p.y);
  }
  return { cdp, controls, centerOf, click, callOn, evalInContentScript, detach: () => cdp.detach().catch(() => {}) };
}
