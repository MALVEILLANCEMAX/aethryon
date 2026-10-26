// Regroupement du travail : toutes les demandes d'examen d'une même image (mutations, navigation,
// visibilité, réglages) sont fusionnées en UN passage dans requestAnimationFrame. Repli par minuterie
// quand l'onglet est en arrière-plan (requestAnimationFrame y est suspendu).

export interface Scheduler {
  request(): void;
  /** Demande un passage au plus tard à l'instant donné (ms, horloge Date.now()). */
  at(time: number): void;
  cancel(): void;
}

export function createScheduler(run: () => void, win: Window, fallbackMs = 200): Scheduler {
  let pending = false;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let later: ReturnType<typeof setTimeout> | null = null;
  let laterAt = Infinity;

  const clear = () => {
    if (raf) win.cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    raf = 0;
    timer = null;
  };
  const flush = () => {
    if (!pending) return;
    pending = false;
    clear();
    run();
  };
  const api: Scheduler = {
    request() {
      if (pending) return;
      pending = true;
      raf = win.requestAnimationFrame(flush);
      timer = setTimeout(flush, fallbackMs);
    },
    at(time) {
      if (time >= laterAt) return;
      if (later !== null) clearTimeout(later);
      laterAt = time;
      later = setTimeout(() => {
        later = null;
        laterAt = Infinity;
        api.request();
      }, Math.max(0, time - Date.now()));
    },
    cancel() {
      pending = false;
      clear();
      if (later !== null) clearTimeout(later);
      later = null;
      laterAt = Infinity;
    },
  };
  return api;
}
