// Modèle d'une retouche d'AETHRYON Tools (pur, testé) : sélection, recadrage, orientation, vitesse, son, réglages de
// sortie ; corps de la demande d'export (ytapi DeriveParams, champs validés une seconde fois par le serveur) ;
// estimation honnête de la taille. Le recadrage est gardé en fractions (0–1) de l'image AFFICHÉE avant la rotation
// choisie dans l'éditeur (l'ordre de ffmpeg : recadrer, puis tourner), converti en pixels au dernier moment.
import type { MediaInfo, ToolsLimits } from "./api.ts";

export type Tool = "couper" | "recadrer" | "audio" | "gif" | "compresser";
export type Ratio = "original" | "libre" | "16:9" | "9:16" | "1:1" | "4:5";
export type Rotation = 0 | 90 | 180 | 270;
export type Container = "mp4" | "mov" | "mkv" | "webm";
export type Quality = "haute" | "standard" | "legere";
export type AudioFormat = "mp3" | "m4a" | "wav" | "ogg" | "flac";
export type Bitrate = 96 | 128 | 192 | 256 | 320;
/** Son accéléré ou ralenti : « keep » garde la tonalité (podcasts, cours), « shift » la fait suivre la vitesse, comme
 *  un disque joué plus vite (Sped Up) ou moins vite (Slowed). */
export type Pitch = "keep" | "shift";

export interface Crop { x: number; y: number; w: number; h: number }

export interface Edit {
  start: number;
  end: number;
  crop: Crop | null;
  ratio: Ratio;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  speed: number;
  pitch: Pitch;
  mute: boolean;
  volumeDb: number;
  fadeIn: number;
  fadeOut: number;
  container: Container;
  quality: Quality;
  height: number | null;
  audioFormat: AudioFormat;
  bitrate: Bitrate;
  gifWidth: number;
  gifFps: number;
  targetMb: number;
}

export const TOOL_ORDER: readonly Tool[] = ["couper", "recadrer", "audio", "gif", "compresser"];
export const RATIOS: readonly { id: Ratio; label: string; value: number | null }[] = [
  { id: "original", label: "Original", value: null },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
  { id: "1:1", label: "1:1", value: 1 },
  { id: "4:5", label: "4:5", value: 4 / 5 },
  { id: "libre", label: "Libre", value: null },
];
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
/** Vitesses courantes (raccourcis sous le curseur) ; le curseur va de ×0,25 à ×4, au centième. */
export const SPEED_PRESETS = [0.75, 1, 1.1, 1.25, 1.5, 2] as const;
export const SPEED_MIN = 0.25, SPEED_MAX = 4;
/** Vitesse au centième, attirée par une vitesse courante toute proche (le curseur s'y pose sans viser au pixel). */
export function roundSpeed(x: number): number {
  const v = Math.min(SPEED_MAX, Math.max(SPEED_MIN, x));
  const near = SPEED_PRESETS.find((p) => Math.abs(p - v) < 0.012);
  return near ?? Math.round(v * 100) / 100;
}
/** Écart de tonalité d'un Sped Up / Slowed, en demi-tons (×1,25 → +3,9). */
export const semitones = (speed: number) => 12 * Math.log2(speed);
/** Le son exporté suit-il la vitesse (Sped Up / Slowed) ? Seulement s'il y a un son et une vitesse ≠ 1. */
export const pitchShift = (e: Edit, withSound: boolean) => withSound && e.speed !== 1 && e.pitch === "shift";
export const GIF_WIDTHS = [240, 320, 480, 640, 800] as const;
export const GIF_FPS = [8, 10, 12, 15, 20, 25] as const;
export const HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240] as const;
/** Cibles de compression (Mio) : Discord gratuit (10), messageries courantes (25), courriel (16 à 25), confort (50). */
export const TARGETS = [8, 10, 16, 25, 50, 100] as const;
export const MIN_SELECTION_S = 0.1;

export function initialEdit(info: MediaInfo, limits?: Partial<ToolsLimits> | null): Edit {
  const d = info.duration || 0;
  const cap = info.has_video ? (limits?.videoMaxS ?? 900) : (limits?.maxDurationS ?? 3600);
  return {
    start: 0,
    end: Math.min(d, cap) || d,
    crop: null,
    ratio: "original",
    rotate: 0,
    flipH: false,
    flipV: false,
    speed: 1,
    pitch: "keep",
    mute: false,
    volumeDb: 0,
    fadeIn: 0,
    fadeOut: 0,
    container: "mp4",
    quality: "standard",
    height: null,
    audioFormat: "mp3",
    bitrate: 192,
    gifWidth: 480,
    gifFps: 12,
    targetMb: 25,
  };
}

// Réglages d'un média gardés dans CE navigateur, 24 h au plus : revenir sur l'éditeur (retour, rechargement, autre
// onglet) les retrouve. Rien ne part au serveur ; un réglage incompatible avec le média n'est jamais repris.
const REGLAGES = "aethryon.tools.reglages";
const REGLAGES_TTL_MS = 24 * 3600_000;
type Garde = Record<string, { at: number; d: number; e: Partial<Edit> }>;
const lireGarde = (): Garde => { try { return JSON.parse(localStorage.getItem(REGLAGES) ?? "{}") as Garde; } catch { return {}; } };

export function savedEdit(id: string, info: MediaInfo, base: Edit): Edit | null {
  const x = lireGarde()[id];
  const d = info.duration || 0;
  if (!x || Date.now() - x.at > REGLAGES_TTL_MS || Math.abs(x.d - d) > 0.01) return null;
  const e = { ...base, ...x.e };
  const nombres = [e.start, e.end, e.speed, e.volumeDb, e.fadeIn, e.fadeOut, e.gifWidth, e.gifFps, e.targetMb];
  if (!nombres.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (e.pitch !== "keep" && e.pitch !== "shift") e.pitch = "keep";
  if (e.speed < SPEED_MIN || e.speed > SPEED_MAX) e.speed = 1;
  if (e.start < 0 || e.end > d + 0.001 || e.end - e.start < MIN_SELECTION_S) return null;
  return e;
}

export function keepEdit(id: string, info: MediaInfo, e: Edit): void {
  try {
    const all = lireGarde();
    const now = Date.now();
    for (const [k, v] of Object.entries(all)) if (!v || now - v.at > REGLAGES_TTL_MS) delete all[k];
    all[id] = { at: now, d: info.duration || 0, e };
    localStorage.setItem(REGLAGES, JSON.stringify(all));
  } catch { /* stockage indisponible (navigation privée…) : rien n'est gardé */ }
}

export const selection = (e: Edit) => Math.max(0, e.end - e.start);
export const outputLength = (e: Edit) => selection(e) / (e.speed || 1);

/** Taille de l'image en sortie (pixels) : recadrage, rotation, hauteur choisie (jamais agrandie). */
export function outputDims(e: Edit, info: MediaInfo, tool: Tool): { w: number; h: number } {
  const W = info.width ?? 0;
  const H = info.height ?? 0;
  let w = e.crop ? Math.max(16, Math.floor((e.crop.w * W) / 2) * 2) : W;
  let h = e.crop ? Math.max(16, Math.floor((e.crop.h * H) / 2) * 2) : H;
  if (e.rotate === 90 || e.rotate === 270) [w, h] = [h, w];
  if (tool === "gif") {
    const gw = Math.min(e.gifWidth, w);
    return { w: gw, h: Math.max(2, Math.round((h * gw) / Math.max(1, w) / 2) * 2) };
  }
  if ((tool === "couper" || tool === "recadrer") && e.height && e.height < h) {
    return { w: Math.round((w * e.height) / h / 2) * 2, h: e.height };
  }
  return { w, h };
}

/** Rectangle en pixels de l'image affichée (orientation de la source), pour ytapi. */
export function cropPixels(c: Crop, info: MediaInfo): { x: number; y: number; w: number; h: number } {
  const W = info.width ?? 0;
  const H = info.height ?? 0;
  const x = Math.max(0, Math.min(W - 16, Math.round(c.x * W)));
  const y = Math.max(0, Math.min(H - 16, Math.round(c.y * H)));
  const w = Math.max(16, Math.min(W - x, Math.round(c.w * W)));
  const h = Math.max(16, Math.min(H - y, Math.round(c.h * H)));
  return { x, y, w, h };
}

/**
 * Rectangle le plus grand possible, centré sur `around` (ou l'image), au rapport de SORTIE `ratio` ; avec une rotation
 * d'un quart de tour, le rapport à appliquer sur l'image d'origine est l'inverse.
 */
export function fitRatio(ratio: number, frameW: number, frameH: number, rotate: Rotation, around?: Crop | null): Crop {
  const r = rotate === 90 || rotate === 270 ? 1 / ratio : ratio; // largeur/hauteur dans l'image d'origine
  const frame = frameW / Math.max(1, frameH);
  // Fractions de l'image : w * frameW / (h * frameH) = r
  let w = 1, h = 1;
  if (r > frame) h = frame / r; else w = r / frame;
  const cx = around ? around.x + around.w / 2 : 0.5;
  const cy = around ? around.y + around.h / 2 : 0.5;
  const x = Math.min(1 - w, Math.max(0, cx - w / 2));
  const y = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}

/** Champs communs (passage, orientation, vitesse, son) en noms de l'API. */
function common(e: Edit, info: MediaInfo, withSound: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { start_s: round3(e.start), duration_s: round3(selection(e)) };
  if (e.crop && info.has_video) body.crop = cropPixels(e.crop, info);
  if (e.rotate) body.rotate = e.rotate;
  const flip = `${e.flipH ? "h" : ""}${e.flipV ? "v" : ""}`;
  if (flip) body.flip = flip;
  if (e.speed !== 1) body.speed = e.speed;
  if (pitchShift(e, withSound)) body.pitch = "shift";
  if (withSound) {
    if (e.volumeDb) body.volume_db = e.volumeDb;
    if (e.fadeIn) body.fade_in_s = e.fadeIn;
    if (e.fadeOut) body.fade_out_s = e.fadeOut;
  }
  return body;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Corps de POST /api/outils/medias/{id}/exports pour l'outil courant. */
export function exportBody(tool: Tool, e: Edit, info: MediaInfo): Record<string, unknown> {
  if (tool === "audio") {
    const body: Record<string, unknown> = { op: "audio", ...common(e, info, true), audio_format: e.audioFormat };
    delete body.crop; delete body.rotate; delete body.flip;
    if (e.audioFormat === "mp3" || e.audioFormat === "m4a") body.bitrate = e.bitrate;
    return body;
  }
  if (tool === "gif") {
    return { op: "gif", ...common(e, info, false), gif_width: e.gifWidth, gif_fps: e.gifFps };
  }
  if (tool === "compresser") {
    const body: Record<string, unknown> = { op: "compress", ...common(e, info, info.has_audio && !e.mute), max_bytes: Math.round(e.targetMb * 1024 * 1024) };
    if (e.mute) body.mute = true;
    return body;
  }
  const body: Record<string, unknown> = { op: "video", ...common(e, info, info.has_audio && !e.mute) };
  if (e.mute) body.mute = true;
  if (e.container !== "mp4") body.container = e.container;
  if (e.quality !== "standard") body.quality = e.quality;
  if (e.height && e.height < (info.height ?? Infinity)) body.height = e.height;
  return body;
}

/** Corps d'un échantillon de compression (2 s encodées avec le plan du passage entier). */
export function sampleBody(e: Edit, info: MediaInfo): Record<string, unknown> {
  return { ...exportBody("compresser", e, info), op: "echantillon" };
}

export interface Carried { id: string; label: string; clear: Partial<Edit> }

/**
 * Retouches réglées dans un AUTRE panneau qui s'appliquent quand même à l'export de cet outil (le recadrage vaut pour
 * le GIF et la compression, le volume pour la vidéo…) : dites dans le bloc d'export et retirables de là.
 */
export function carriedEdits(tool: Tool, e: Edit, info: MediaInfo): Carried[] {
  const out: Carried[] = [];
  if (tool !== "audio" && tool !== "recadrer" && info.has_video) {
    if (e.crop) out.push({ id: "crop", label: `Recadrage ${RATIOS.find((r) => r.id === e.ratio && r.value)?.label ?? "libre"}`, clear: { crop: null, ratio: "original" } });
    if (e.rotate) out.push({ id: "rotate", label: `Rotation ${e.rotate} °`, clear: { rotate: 0 } });
    const flip = e.flipH && e.flipV ? "Miroirs horizontal et vertical" : e.flipH ? "Miroir horizontal" : e.flipV ? "Miroir vertical" : "";
    if (flip) out.push({ id: "flip", label: flip, clear: { flipH: false, flipV: false } });
  }
  if ((tool === "recadrer" || tool === "compresser") && e.speed !== 1) {
    out.push({ id: "speed", label: speedTag(e, info.has_audio && !e.mute), clear: { speed: 1 } });
  }
  if (tool === "compresser" && e.mute && info.has_audio) out.push({ id: "mute", label: "Sans le son", clear: { mute: false } });
  if ((tool === "couper" || tool === "recadrer" || tool === "compresser") && info.has_audio && !e.mute) {
    if (e.volumeDb) out.push({ id: "volume", label: `Volume ${e.volumeDb > 0 ? "+" : "−"}${Math.abs(e.volumeDb)} dB`, clear: { volumeDb: 0 } });
    if (e.fadeIn || e.fadeOut) out.push({ id: "fades", label: e.fadeIn && e.fadeOut ? "Fondus" : e.fadeIn ? "Fondu au début" : "Fondu à la fin", clear: { fadeIn: 0, fadeOut: 0 } });
  }
  return out;
}

/** Problème bloquant pour exporter, ou null. Les mêmes limites que le serveur (qui les vérifie de toute façon). */
export function exportProblem(tool: Tool, e: Edit, info: MediaInfo, limits?: Partial<ToolsLimits> | null): string | null {
  const len = outputLength(e);
  if (selection(e) < MIN_SELECTION_S) return "Sélectionne un passage d'au moins 0,1\u00a0s.";
  if (tool === "audio") {
    if (!info.has_audio) return "Ce média n'a pas de son.";
    const max = limits?.maxDurationS ?? 3600;
    if (len > max + 0.5) return `Un export audio dure au plus ${Math.round(max / 60)}\u00a0min.`;
    return null;
  }
  if (!info.has_video) return "Ce média n'a pas d'image\u00a0: utilise l'outil Audio.";
  if (tool === "gif") {
    const max = limits?.gifMaxS ?? 30;
    if (len > max + 0.05) return `Un GIF dure au plus ${max}\u00a0s\u00a0: raccourcis la sélection.`;
    return null;
  }
  const max = limits?.videoMaxS ?? 900;
  if (len > max + 0.5) return `Un export vidéo dure au plus ${Math.round(max / 60)}\u00a0min\u00a0: raccourcis la sélection.`;
  if (tool === "compresser") {
    const audioKbps = info.has_audio && !e.mute ? 96 : 0;
    const videoKbps = (e.targetMb * 1024 * 1024 * 8 * 0.94) / Math.max(0.1, len) / 1000 - audioKbps;
    if (videoKbps < 80) return `Ce passage est trop long pour tenir dans ${e.targetMb}\u00a0Mo\u00a0: choisis une taille plus grande ou un passage plus court.`;
  }
  return null;
}

/**
 * Estimation de la taille du fichier exporté : plafond pour une compression, très proche pour un son à débit constant,
 * approchée à partir du débit de la source sinon ; jamais présentée comme exacte. null quand rien d'honnête n'est possible.
 */
export function estimateSize(tool: Tool, e: Edit, info: MediaInfo): { bytes: number; exact: boolean; range?: [number, number] } | null {
  const len = outputLength(e);
  if (len <= 0) return null;
  if (tool === "audio") {
    const kbps = e.audioFormat === "wav" ? 1536 : e.audioFormat === "flac" ? 850 : e.audioFormat === "ogg" ? 192 : e.bitrate;
    // Débit constant : très proche, jamais exact (trames MP3, en-têtes) — dit « ≈ » comme le reste.
    return { bytes: (kbps * 1000 * len) / 8, exact: false };
  }
  if (tool === "compresser") return { bytes: e.targetMb * 1024 * 1024, exact: false };
  const out = outputDims(e, info, tool);
  if (!out.w || !out.h) return null;
  if (tool === "gif") {
    // Une image de GIF tramée pèse de 0,08 octet par pixel (aplats, dessin) à 0,32 (vraie vidéo qui bouge : ciel,
    // feuillage) — mesuré : 0,29 sur un décollage filmé. Trop variable pour un seul chiffre : une fourchette.
    const px = out.w * out.h * e.gifFps * len;
    return { bytes: px * 0.2, exact: false, range: [px * 0.08, px * 0.32] };
  }
  const srcPixels = (info.width ?? out.w) * (info.height ?? out.h);
  const srcVideoBps = Math.max(200_000, (info.bit_rate ?? 2_000_000) - (info.audio_bit_rate ?? (info.has_audio ? 128_000 : 0)));
  const scale = Math.pow((out.w * out.h) / Math.max(1, srcPixels), 0.75);
  const q = e.quality === "haute" ? 1.35 : e.quality === "legere" ? 0.55 : 1;
  const audio = info.has_audio && !e.mute ? (e.container === "webm" ? 128_000 : 192_000) : 0;
  return { bytes: ((srcVideoBps * scale * q + audio) * len) / 8, exact: false };
}

/** Qualité attendue d'une compression : bits par pixel de l'image réduite par le plan du serveur. */
export function compressionQuality(e: Edit, info: MediaInfo): { label: "Excellente" | "Bonne" | "Correcte" | "Faible"; videoKbps: number; side: number } | null {
  if (!info.has_video || !info.width || !info.height) return null;
  const len = outputLength(e);
  const audioKbps = info.has_audio && !e.mute ? 96 : 0;
  const videoKbps = Math.floor((e.targetMb * 1024 * 1024 * 8 * 0.94) / Math.max(0.1, len) / 1000 - audioKbps);
  if (videoKbps < 80) return null;
  const dims = outputDims(e, info, "compresser");
  const short = Math.min(dims.w, dims.h);
  const fps = Math.min(30, (info.fps ?? 30) * e.speed);
  let side = Math.min(short, 240);
  for (const s of [1080, 720, 540, 480, 360, 240]) {
    if (s > short) continue;
    const long = (Math.max(dims.w, dims.h) * s) / short;
    if ((videoKbps * 1000) / (s * long * fps) >= 0.045) { side = s; break; }
  }
  const long = (Math.max(dims.w, dims.h) * side) / short;
  const bpp = (videoKbps * 1000) / (side * long * fps);
  const label = bpp >= 0.12 ? "Excellente" : bpp >= 0.075 ? "Bonne" : bpp >= 0.05 ? "Correcte" : "Faible";
  return { label, videoKbps, side };
}

// ---- cadre de recadrage (gestes de la scène) -----------------------------------------------------------------------

export type Corner = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const MIN = 0.06;

/** Nouveau cadre après un geste (fractions de l'image) ; rapport imposé conservé, toujours dans l'image. */
export function resize(c: Crop, kind: Corner | "move", dx: number, dy: number, ratio: number | null, frameAspect: number): Crop {
  if (kind === "move") {
    return { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) };
  }
  let { x, y, w, h } = c;
  if (kind.includes("e")) w = clamp(c.w + dx, MIN, 1 - c.x);
  if (kind.includes("s")) h = clamp(c.h + dy, MIN, 1 - c.y);
  if (kind.includes("w")) { const nx = clamp(c.x + dx, 0, c.x + c.w - MIN); w = c.w + (c.x - nx); x = nx; }
  if (kind.includes("n")) { const ny = clamp(c.y + dy, 0, c.y + c.h - MIN); h = c.h + (c.y - ny); y = ny; }
  if (ratio) {
    // w (fraction) * frameAspect / h (fraction) = ratio  → on suit le côté tiré, l'autre s'ajuste.
    const horizontal = kind === "e" || kind === "w" || (kind.length === 2 && Math.abs(dx) >= Math.abs(dy));
    if (horizontal) h = (w * frameAspect) / ratio; else w = (h * ratio) / frameAspect;
    if (h > 1) { h = 1; w = (h * ratio) / frameAspect; }
    if (w > 1) { w = 1; h = (w * frameAspect) / ratio; }
    if (kind.includes("n")) y = c.y + c.h - h;
    if (kind.includes("w")) x = c.x + c.w - w;
    if (kind === "n" || kind === "s") x = c.x + (c.w - w) / 2;
    if (kind === "e" || kind === "w") y = c.y + (c.h - h) / 2;
    x = clamp(x, 0, 1 - w);
    y = clamp(y, 0, 1 - h);
  }
  return { x, y, w, h };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** « ×1,25 », « ×1,1 », « ×2 » : au centième, sans zéro inutile. */
export const speedText = (s: number) => `×${String(Math.round(s * 100) / 100).replace(".", ",")}`;
/** Étiquette d'une vitesse d'export : « Sped up ×1,25 », « Slowed ×0,8 » ou « Vitesse ×1,25 » (tonalité gardée). */
export function speedTag(e: Edit, withSound: boolean): string {
  if (pitchShift(e, withSound)) return `${e.speed > 1 ? "Sped up" : "Slowed"} ${speedText(e.speed)}`;
  return `Vitesse ${speedText(e.speed)}`;
}
