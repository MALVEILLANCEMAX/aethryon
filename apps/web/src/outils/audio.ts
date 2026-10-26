// Calculs du mode son d'AETHRYON Tools (purs, testés) : le gain que l'export appliquera à chaque instant de la
// sélection — même chaîne que ytapi (atempo, puis volume, puis fondus linéaires afade comptés en temps de SORTIE) —,
// la part de la sélection qui risque de saturer (l'export n'a pas de limiteur), les bandes logarithmiques du spectre,
// et les caractéristiques du son telles que la sonde du serveur les donne.
import type { MediaInfo } from "./api.ts";
import { duration as dur, kbps } from "./format.ts";

/** « MP3 », « 3 min », « 192 kbit/s », « 44,1 kHz », « Stéréo » : ce que dit vraiment la sonde (débit du son seul). */
export function soundFacts(info: MediaInfo): string[] {
  const khz = info.sample_rate ? `${String(Math.round(info.sample_rate / 100) / 10).replace(".", ",")} kHz` : null;
  const ch = info.channels === 1 ? "Mono" : info.channels === 2 ? "Stéréo" : info.channels ? `${info.channels} canaux` : null;
  const rate = info.audio_bit_rate ?? (info.has_video ? null : info.bit_rate);
  return [info.audio_codec?.toUpperCase() ?? null, dur(info.duration), rate ? kbps(rate) : null, khz, ch].filter((x): x is string => !!x);
}

export interface SoundShape {
  start: number;
  end: number;
  speed: number;
  volumeDb: number;
  fadeIn: number;
  fadeOut: number;
}

/** Gain linéaire de l'export à l'instant t de la source (0 hors de la sélection). */
export function gainAt(t: number, s: SoundShape): number {
  if (!(t >= s.start && t <= s.end)) return 0;
  const speed = s.speed > 0 ? s.speed : 1;
  const len = (s.end - s.start) / speed; // durée exportée
  const u = (t - s.start) / speed; // instant dans le fichier exporté
  let g = Math.pow(10, s.volumeDb / 20);
  if (s.fadeIn > 0 && len > 0) g *= Math.min(1, Math.max(0, u / Math.min(s.fadeIn, len)));
  if (s.fadeOut > 0 && len > 0) g *= Math.min(1, Math.max(0, (len - u) / Math.min(s.fadeOut, len)));
  return g;
}

/**
 * Part (0 à 1) des points de la sélection dont la crête, une fois le gain appliqué, dépasse le niveau maximal (255 sur
 * l'échelle de l'onde du serveur). Approximation honnête : l'onde est calculée en mono à 4 kHz, une crête brève peut
 * lui échapper ; la valeur sert à prévenir d'un risque, jamais à le garantir.
 */
export function clippedShare(peaks: readonly number[], duration: number, s: SoundShape): number {
  const n = peaks.length;
  if (!n || !(duration > 0)) return 0;
  let inside = 0, clipped = 0;
  const first = Math.max(0, Math.floor((s.start / duration) * n));
  const last = Math.min(n - 1, Math.ceil((s.end / duration) * n));
  for (let i = first; i <= last; i++) {
    const t = ((i + 0.5) / n) * duration;
    if (t < s.start || t > s.end) continue;
    inside++;
    if ((peaks[i] ?? 0) * gainAt(t, s) > 255.5) clipped++;
  }
  return inside ? clipped / inside : 0;
}

/**
 * Bandes de fréquences de n barres réparties en échelle logarithmique entre minHz et maxHz, en indices de cases de la
 * FFT [début, fin[ (au moins une case chacune) : les graves ne sont pas écrasés à gauche.
 */
export function logBands(n: number, minHz: number, maxHz: number, sampleRate: number, fftSize: number): [number, number][] {
  const bins = fftSize / 2;
  const hz = sampleRate / fftSize;
  const top = Math.min(maxHz, sampleRate / 2);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const f0 = minHz * Math.pow(top / minHz, i / n);
    const f1 = minHz * Math.pow(top / minHz, (i + 1) / n);
    const a = Math.min(bins - 1, Math.max(1, Math.floor(f0 / hz)));
    const b = Math.min(bins, Math.max(a + 1, Math.ceil(f1 / hz)));
    out.push([a, b]);
  }
  return out;
}

/** Niveau d'une bande (0 à 1) : la case la plus forte de la bande, courbe douce pour garder du relief. */
export function bandLevel(data: Uint8Array, [a, b]: [number, number]): number {
  let m = 0;
  for (let i = a; i < b; i++) if (data[i]! > m) m = data[i]!;
  return Math.pow(m / 255, 1.35);
}

/** Crête de l'onde (0 à 1) au voisinage de l'instant t (fenêtre de « win » secondes) : repli quand le spectre est indisponible. */
export function levelAt(peaks: readonly number[], duration: number, t: number, win = 0.08): number {
  const n = peaks.length;
  if (!n || !(duration > 0)) return 0;
  const a = Math.max(0, Math.floor(((t - win / 2) / duration) * n));
  const b = Math.min(n - 1, Math.ceil(((t + win / 2) / duration) * n));
  let m = 0;
  for (let i = a; i <= b; i++) if ((peaks[i] ?? 0) > m) m = peaks[i]!;
  return m / 255;
}
