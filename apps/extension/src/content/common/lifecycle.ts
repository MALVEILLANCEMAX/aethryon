// Cycle de vie d'un content script et démontage quand le contexte de l'extension est invalidé.
// Après un rechargement ou une mise à jour de l'extension, l'ancien content script reste dans la page
// mais chrome.runtime.id devient undefined et tout appel chrome.* lève « Extension context invalidated ».
// On vérifie donc le contexte avant chaque traitement (wrap) et périodiquement (check) ; s'il est perdu,
// on démonte TOUT en silence : observateurs, écouteurs, minuteries, éléments insérés dans la page.
// Testé par tests/unit/content-lifecycle.test.ts.

export type Disposer = () => void;

export interface Lifecycle {
  readonly disposed: boolean;
  /** Enregistre une fonction de nettoyage (exécutée immédiatement si déjà démonté). */
  add(dispose: Disposer): void;
  /** addEventListener + retrait automatique au démontage. */
  listen(target: EventTarget, type: string, fn: (ev: Event) => void, opts?: AddEventListenerOptions | boolean): void;
  /** Enveloppe un gestionnaire : ne fait rien après démontage, démonte si le contexte est perdu, n'émet jamais d'exception. */
  wrap<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
  /** true si le contexte est valide ; sinon démonte et renvoie false. */
  check(): boolean;
  dispose(): void;
}

/** Le contexte de l'extension est-il encore valide ? (ne lève jamais) */
export function extensionContextValid(): boolean {
  try {
    const c = (globalThis as { chrome?: { runtime?: { id?: unknown } } }).chrome;
    return typeof c?.runtime?.id === "string" && c.runtime.id.length > 0;
  } catch {
    return false;
  }
}

export function createLifecycle(isValid: () => boolean = extensionContextValid, onError?: (e: unknown) => void): Lifecycle {
  const disposers: Disposer[] = [];
  let disposed = false;

  const runSafely = (fn: Disposer) => {
    try {
      fn();
    } catch (e) {
      onError?.(e);
    }
  };

  const lc: Lifecycle = {
    get disposed() {
      return disposed;
    },
    add(fn) {
      if (disposed) runSafely(fn);
      else disposers.push(fn);
    },
    listen(target, type, fn, opts) {
      if (disposed) return;
      target.addEventListener(type, fn, opts);
      const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
      lc.add(() => target.removeEventListener(type, fn, capture));
    },
    wrap(fn) {
      return (...args) => {
        if (disposed) return;
        if (!lc.check()) return;
        try {
          fn(...args);
        } catch (e) {
          onError?.(e);
          // Une exception due à la perte du contexte entre-temps : démontage silencieux.
          if (!isValid()) lc.dispose();
        }
      };
    },
    check() {
      if (disposed) return false;
      let ok = false;
      try {
        ok = isValid();
      } catch {
        ok = false;
      }
      if (!ok) lc.dispose();
      return ok;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Ordre inverse de l'enregistrement (on défait d'abord ce qui a été construit en dernier).
      for (const fn of disposers.splice(0).reverse()) runSafely(fn);
    },
  };
  return lc;
}
