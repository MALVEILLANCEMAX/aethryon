// Lecteur de la page piloté par la vue « Extrait » (V3.5) : la vidéo que l'on regarde sert de mini-lecteur, rien
// n'est téléchargé d'avance. N'agit QUE sur un geste de l'utilisateur dans cette vue (poignée déplacée : l'image à
// cet instant ; « Lire l'extrait » : lecture du passage, arrêt à sa fin ; « Début ici » / « Fin ici » : lecture de
// l'instant). À la fermeture du menu, une lecture d'aperçu en cours s'arrête là où elle est.
import { videoTimes } from "./video.ts";

export class PagePlayer {
  private video: HTMLVideoElement | null = null;
  private end: number | null = null;
  private raf = 0;
  private onStop: (() => void) | null = null;
  /** 3.6.0 : durée d'une image (ms), mesurée sur les images réellement affichées ; null tant qu'elle est inconnue. */
  private frame: number | null = null;
  private measuring = false;

  constructor(private readonly win: Window, private readonly resolve: () => HTMLVideoElement | null) {}

  /** Vidéo de la commande (cherchée de nouveau à chaque appel : les fils remplacent leurs éléments). */
  private current(): HTMLVideoElement | null {
    const v = this.resolve();
    if (v !== this.video) {
      this.stop();
      this.frame = null;
    }
    this.video = v;
    return v;
  }

  times(): { currentTime?: number; duration?: number } {
    return videoTimes(this.current());
  }

  /** 3.6.0 : instant, durée, lecture en cours ou non, aperçu du passage en cours ou non (éditeur d'extrait). */
  snapshot(): { currentTime?: number; duration?: number; paused?: boolean; previewing?: boolean } {
    const v = this.current();
    const out: { currentTime?: number; duration?: number; paused?: boolean; previewing?: boolean } = { ...videoTimes(v), previewing: this.previewing };
    if (v) out.paused = v.paused;
    if (v && !v.paused) this.measure(v);
    return out;
  }

  /**
   * Durée d'une image (ms) pour le pas des flèches : différence entre deux images CONSÉCUTIVES réellement présentées
   * (requestVideoFrameCallback, pendant la lecture) ; null tant que la vidéo n'a pas été lue (pas de cadence inventée).
   */
  frameMs(): number | null {
    return this.frame;
  }

  private measure(v: HTMLVideoElement): void {
    if (this.frame !== null || this.measuring || typeof v.requestVideoFrameCallback !== "function") return;
    this.measuring = true;
    let last: { t: number; n: number } | null = null;
    let tries = 0;
    const cb = (_now: number, meta: VideoFrameCallbackMetadata) => {
      tries++;
      if (last && meta.presentedFrames === last.n + 1) {
        const ms = (meta.mediaTime - last.t) * 1000;
        if (ms >= 5 && ms <= 200) {
          this.frame = Math.round(ms * 1000) / 1000;
          this.measuring = false;
          return;
        }
      }
      last = { t: meta.mediaTime, n: meta.presentedFrames };
      if (tries < 30 && !v.paused && v === this.video) v.requestVideoFrameCallback(cb);
      else this.measuring = false;
    };
    try {
      v.requestVideoFrameCallback(cb);
    } catch {
      this.measuring = false;
    }
  }

  /** Montre l'image de l'instant `t` (vidéo mise en pause : on règle une borne, on ne regarde pas). */
  seek(t: number): void {
    const v = this.current();
    if (!v || !Number.isFinite(t)) return;
    this.stop();
    try {
      if (!v.paused) v.pause();
      v.currentTime = Math.max(0, t);
    } catch {
      /* vidéo pas encore prête */
    }
  }

  /** Lit [start, end] puis s'arrête à `end` (précis à l'image : contrôle à chaque image affichée). */
  async preview(start: number, end: number, onStop: () => void): Promise<boolean> {
    const v = this.current();
    if (!v) return false;
    this.stop();
    this.end = end;
    this.onStop = onStop;
    try {
      v.currentTime = Math.max(0, start);
      await v.play();
    } catch {
      this.end = null;
      this.onStop = null;
      return false;
    }
    const tick = () => {
      this.raf = 0;
      if (this.end === null || !this.video) return;
      if (this.video.paused || this.video.currentTime >= this.end - 0.02) {
        this.stop();
        return;
      }
      this.raf = this.win.requestAnimationFrame(tick);
    };
    this.raf = this.win.requestAnimationFrame(tick);
    return true;
  }

  get previewing(): boolean {
    return this.end !== null;
  }

  /** Fin de l'aperçu : la vidéo s'arrête là où elle est (jamais de saut). */
  stop(): void {
    if (this.raf) this.win.cancelAnimationFrame(this.raf);
    this.raf = 0;
    const was = this.end !== null;
    this.end = null;
    if (was) {
      try {
        this.video?.pause();
      } catch {
        /* ignoré */
      }
      const cb = this.onStop;
      this.onStop = null;
      cb?.();
    }
  }
}
