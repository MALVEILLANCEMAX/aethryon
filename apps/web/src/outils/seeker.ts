// Sauts de la vidéo pendant un glisser, « dernier gagnant » et espacés : un seul saut en cours à la fois, au plus un
// toutes les 110 ms ; le suivant part de la DERNIÈRE position voulue. Avant, chaque mouvement du pointeur relançait un
// décodage depuis l'image clé : près de 900 images décodées pour un glisser de 60 mouvements, et des tâches longues
// du lecteur sur le fil principal (mesuré, docs/OUTILS.md). L'interface (tête de lecture, minutage, sélection) suit le
// pointeur à chaque image ; l'image de la vidéo rattrape, et le saut final (lâcher, clic) est immédiat et précis.

export interface Seeker {
  /** Pendant un geste : saut regroupé et espacé. */
  to(t: number): void;
  /** Saut immédiat et précis (clic, fin d'un geste) : annule le saut en attente. */
  now(t: number): void;
}

const GAP_MS = 110;

export function seeker(video: () => HTMLMediaElement | null): Seeker {
  let pending: number | null = null;
  let busy = false;
  let guard = 0;
  let timer = 0;
  let last = -1e9;
  let el: HTMLMediaElement | null = null;

  const later = () => {
    if (timer || busy || pending === null) return;
    const wait = GAP_MS - (performance.now() - last);
    if (wait <= 0) { flush(); return; }
    timer = window.setTimeout(() => { timer = 0; flush(); }, wait);
  };
  const flush = () => {
    if (busy || pending === null) return;
    const t = pending;
    pending = null;
    go(t);
  };
  const done = () => {
    busy = false;
    window.clearTimeout(guard);
    later();
  };
  const go = (t: number) => {
    const v = video();
    if (!v) return;
    if (el !== v) {
      el?.removeEventListener("seeked", done);
      v.addEventListener("seeked", done);
      el = v;
    }
    busy = true;
    last = performance.now();
    // Un saut qui ne s'achève jamais (média en erreur) ne bloque pas les suivants.
    window.clearTimeout(guard);
    guard = window.setTimeout(done, 600);
    v.currentTime = t;
  };

  return {
    to(t) {
      pending = t;
      later();
    },
    now(t) {
      pending = null;
      window.clearTimeout(timer);
      timer = 0;
      go(t);
    },
  };
}
