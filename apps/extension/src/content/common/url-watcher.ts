// Surveillance de l'URL d'une application monopage (SPA).
// Un content script vit dans un monde isolé : il ne peut pas intercepter history.pushState de la page.
// On combine donc des sources d'événements (API Navigation « currententrychange », popstate, événements
// propres à la plateforme comme « yt-navigate-finish ») et une vérification périodique peu coûteuse
// (comparaison de chaînes) en dernier recours. La logique est pure et testable : les sources et les
// minuteries sont injectées (tests/unit/content-url-watcher.test.ts).

export type Unsubscribe = () => void;
export type Source = (notify: () => void) => Unsubscribe;

export interface UrlTracker {
  /** Relit l'URL ; appelle onChange si elle a changé (après normalisation). Renvoie true si changement. */
  check(): boolean;
  readonly current: string;
}

/** URL sans fragment : un changement d'ancre (#) n'est pas une navigation. */
export function stripHash(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

export function createUrlTracker(
  read: () => string,
  onChange: (next: string, prev: string) => void,
  normalize: (href: string) => string = stripHash,
): UrlTracker {
  let last = normalize(read());
  return {
    check() {
      const cur = normalize(read());
      if (cur === last) return false;
      const prev = last;
      last = cur;
      onChange(cur, prev);
      return true;
    },
    get current() {
      return last;
    },
  };
}

export interface WatchOptions {
  read: () => string;
  onChange: (next: string, prev: string) => void;
  sources: readonly Source[];
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  normalize?: (href: string) => string;
}

export interface UrlWatcher extends UrlTracker {
  dispose(): void;
}

export function watchUrl(opts: WatchOptions): UrlWatcher {
  const tracker = createUrlTracker(opts.read, opts.onChange, opts.normalize);
  let disposed = false;
  const check = () => (disposed ? false : tracker.check());
  const unsubs: Unsubscribe[] = [];
  for (const src of opts.sources) {
    try {
      unsubs.push(src(() => void check()));
    } catch {
      /* source indisponible (API absente) : la vérification périodique reste */
    }
  }
  const setI = opts.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearI = opts.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  const timer = opts.intervalMs && opts.intervalMs > 0 ? setI(() => void check(), opts.intervalMs) : null;
  return {
    check,
    get current() {
      return tracker.current;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const u of unsubs.splice(0)) {
        try {
          u();
        } catch {
          /* ignoré */
        }
      }
      if (timer !== null) clearI(timer);
    },
  };
}

/** Source : un événement DOM (popstate, yt-navigate-finish…). */
export function eventSource(target: EventTarget, type: string, capture = true): Source {
  return (notify) => {
    const fn = () => notify();
    target.addEventListener(type, fn, { capture, passive: true });
    return () => target.removeEventListener(type, fn, { capture });
  };
}

/** Source : API Navigation de Chrome (pushState/replaceState/retour arrière inclus), si disponible. */
export function navigationApiSource(win: Window): Source {
  return (notify) => {
    const nav = (win as unknown as { navigation?: EventTarget }).navigation;
    if (!nav || typeof nav.addEventListener !== "function") return () => {};
    const fn = () => notify();
    nav.addEventListener("currententrychange", fn);
    nav.addEventListener("navigatesuccess", fn);
    return () => {
      nav.removeEventListener("currententrychange", fn);
      nav.removeEventListener("navigatesuccess", fn);
    };
  };
}
