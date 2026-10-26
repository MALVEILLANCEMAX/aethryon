// Vignettes tirées de la planche du serveur (une seule image : la grille de toutes les vignettes du média). Sert à
// l'aperçu au survol de la frise, à la carte glissée vers l'export et à la miniature de la réussite : aucune requête de
// plus, aucune image décodée en plus.
import type { Storyboard } from "./api.ts";

/** Planches déjà chargées, par adresse (la frise, la carte et la réussite partagent la même image). */
const loaded = new Map<string, HTMLImageElement>();

/** Planche partagée ; `onLoad(image)` est appelé quand elle est prête (tout de suite si elle l'est déjà). */
export function sprite(url: string | null | undefined, onLoad?: (img: HTMLImageElement) => void): HTMLImageElement | null {
  if (!url) return null;
  let img = loaded.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = url;
    loaded.set(url, img);
  }
  if (onLoad) {
    const ready = img;
    if (ready.complete && ready.naturalWidth) onLoad(ready);
    else ready.addEventListener("load", () => onLoad(ready), { once: true });
  }
  return img;
}

export function hasTiles(b: Storyboard | null | undefined): b is Storyboard & { count: number; cols: number; tile_w: number; tile_h: number; interval_s: number } {
  return !!(b && b.count && b.cols && b.tile_w && b.tile_h && b.interval_s);
}

/**
 * Dessine la vignette de l'instant `t` dans la toile, en « contain ». `size` : taille CSS de la toile quand elle n'est
 * pas encore affichée (fenêtre pas encore ouverte, carte masquée) ; sinon sa taille à l'écran. false si impossible.
 */
export function drawTile(cv: HTMLCanvasElement, b: Storyboard | null | undefined, img: HTMLImageElement | null, t: number, size?: { w: number; h: number }): boolean {
  if (!hasTiles(b) || !img?.complete || !img.naturalWidth) return false;
  const w = size?.w ?? cv.clientWidth, h = size?.h ?? cv.clientHeight;
  if (!w || !h) return false;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d");
  if (!g) return false;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const idx = Math.min(b.count - 1, Math.max(0, Math.floor(t / b.interval_s)));
  const sx = (idx % b.cols) * b.tile_w, sy = Math.floor(idx / b.cols) * b.tile_h;
  const s = Math.min(w / b.tile_w, h / b.tile_h);
  const dw = b.tile_w * s, dh = b.tile_h * s;
  g.drawImage(img, sx, sy, b.tile_w, b.tile_h, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}
