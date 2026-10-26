// Image de la vidéo (V3), côté service worker : vérification d'un PNG reçu d'une page, et repli quand la page ne peut
// pas lire l'image elle-même (vidéo d'une autre origine sans autorisation) : capture de l'onglet visible
// (chrome.tabs.captureVisibleTab, permise par « activeTab » : clic sur l'icône de l'extension), recadrée sur la vidéo.
// Une image entièrement noire est refusée (vidéo protégée : le navigateur ne la montre pas aux captures).

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PREFIX = "data:image/png;base64,";

/** PNG en data: : signature lue dans les premiers octets décodés (le reste est l'affaire du navigateur). */
export function isPngDataUrl(dataUrl: string): boolean {
  if (!dataUrl.startsWith(PREFIX)) return false;
  try {
    const head = atob(dataUrl.slice(PREFIX.length, PREFIX.length + 12));
    return PNG_SIG.every((b, i) => head.charCodeAt(i) === b);
  } catch {
    return false;
  }
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface Region { x: number; y: number; width: number; height: number }

/** Proportion de pixels non noirs sur un échantillon (au plus ~4 000 points). */
function litShare(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor((w * h) / 4000));
  let lit = 0;
  let seen = 0;
  for (let p = 0; p < w * h; p += step) {
    const i = p * 4;
    if (data[i]! > 10 || data[i + 1]! > 10 || data[i + 2]! > 10) lit++;
    seen++;
  }
  return seen ? lit / seen : 0;
}

/**
 * Capture de l'onglet visible, recadrée sur `rect` (pixels CSS de la fenêtre `viewport`) → PNG en data:, ou
 * « black » si l'image est entièrement noire (contenu protégé), ou null si la capture est impossible.
 */
export async function captureRegion(windowId: number | undefined, rect: Region, viewport: { width: number; height: number }): Promise<string | "black" | null> {
  let shot: string;
  try {
    shot = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: "png" });
  } catch {
    return null;
  }
  if (!isPngDataUrl(shot)) return null;
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const scale = viewport.width > 0 ? bmp.width / viewport.width : 1;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bmp.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(bmp.height - sy, Math.round(rect.height * scale));
  if (sw < 16 || sh < 16) return null;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  if (litShare(ctx, sw, sh) < 0.002) return "black";
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return PREFIX + base64(await blob.arrayBuffer());
}
