// Scène du mode son : une table d'écoute.
// - Le disque : lecture et pause, halo doré pendant la lecture.
// - Le titre et les caractéristiques réelles du fichier (sonde du serveur), en étiquettes.
// - L'onde de TOUT le fichier, à la feuille d'or : la sélection éclairée, la partie déjà lue plus vive, le volume et les
//   fondus de l'export appliqués (ce que tu entendras), les passages qui risquent de saturer signalés. Toucher l'onde
//   place la lecture (le clavier passe par la frise, dont la tête de lecture est un vrai curseur).
// - Dessous, le spectre en direct pendant la lecture (Web Audio) ; quand le navigateur ne le permet pas, le niveau du
//   son lu sur l'onde, dit comme tel. Mouvement réduit : rien ne bouge.
// Toiles redessinées seulement quand il le faut ; tête de lecture posée hors de React (variable CSS).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { IconPause, IconPlay } from "../ui/Icon.tsx";
import type { MediaInfo } from "./api.ts";
import { bandLevel, gainAt, levelAt, logBands, soundFacts, type SoundShape } from "./audio.ts";
import { timecode } from "./format.ts";

export interface AudioStageHandle { setTime(t: number): void }

interface Props {
  title: string;
  info: MediaInfo;
  /** Crêtes de l'onde (0–255) ; null tant qu'elles arrivent. */
  peaks: readonly number[] | null;
  shape: SoundShape;
  playing: boolean;
  analyser: AnalyserNode | null;
  /** Le spectre est impossible ici (navigateur, iPhone sans Audio Session) : le dire, et seulement alors. */
  routeBlocked?: boolean;
  calm: boolean;
  onToggle(): void;
  onSeek(t: number): void;
  currentTime(): number;
}

const GOLD = "#d4af7c";
const GOLD_LIGHT = "#e3cda6";
const GOLD_DEEP = "#8a6a40"; // base des barres du spectre
const CLIP = "#d98a73";
const BARS_WIDE = 56;
const BARS_NARROW = 32;

/** Amplitude affichée (0–1) par colonne : crêtes du serveur, gain de l'export dans la sélection, relief adouci. */
function columns(peaks: readonly number[], d: number, s: SoundShape, cols: number) {
  const n = peaks.length;
  const amp = new Float32Array(cols), clip = new Uint8Array(cols);
  for (let x = 0; x < cols; x++) {
    let m = 0;
    if (n >= cols) {
      const a = Math.floor((x / cols) * n), b = Math.max(a + 1, Math.floor(((x + 1) / cols) * n));
      for (let i = a; i < b && i < n; i++) if (peaks[i]! > m) m = peaks[i]!;
    } else {
      // Moins de points que de colonnes (son court) : interpolation, pas d'escalier.
      const f = ((x + 0.5) / cols) * n - 0.5;
      const i = Math.max(0, Math.min(n - 1, Math.floor(f))), j = Math.min(n - 1, i + 1), k = Math.min(1, Math.max(0, f - i));
      m = peaks[i]! * (1 - k) + peaks[j]! * k;
    }
    const t = ((x + 0.5) / cols) * d;
    const inside = t >= s.start && t <= s.end;
    const g = inside ? gainAt(t, s) : 1;
    clip[x] = inside && m * g > 255.5 ? 1 : 0;
    amp[x] = Math.pow(Math.min(1, (m / 255) * g), 0.72);
  }
  return { amp, clip };
}

function drawWave(cv: HTMLCanvasElement, peaks: readonly number[], d: number, s: SoundShape, lit: boolean) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cols = Math.max(2, Math.floor(w));
  const { amp, clip } = columns(peaks, d, s, cols);
  const mid = h / 2, half = h / 2 - 3;
  const sel0 = Math.max(0, (s.start / d) * w), sel1 = Math.min(w, (s.end / d) * w);

  // Silhouette pleine, en miroir : le contour haut de gauche à droite, le bas en revenant.
  const shape = new Path2D();
  shape.moveTo(0, mid - amp[0]! * half);
  for (let x = 1; x < cols; x++) shape.lineTo(x + 0.5, mid - amp[x]! * half);
  for (let x = cols - 1; x >= 0; x--) shape.lineTo(x + 0.5, mid + amp[x]! * half);
  shape.closePath();
  const edge = new Path2D();
  edge.moveTo(0, mid - amp[0]! * half);
  for (let x = 1; x < cols; x++) edge.lineTo(x + 0.5, mid - amp[x]! * half);
  edge.moveTo(0, mid + amp[0]! * half);
  for (let x = 1; x < cols; x++) edge.lineTo(x + 0.5, mid + amp[x]! * half);

  // Hors de la sélection : ce qui ne sera pas exporté, en retrait.
  g.save();
  g.beginPath();
  g.rect(0, 0, sel0, h);
  g.rect(sel1, 0, w - sel1, h);
  g.clip();
  g.fillStyle = lit ? "rgba(179,169,153,0.46)" : "rgba(179,169,153,0.2)";
  g.fill(shape);
  g.restore();

  // La sélection : feuille d'or (plus vive dans la partie déjà lue), contour fin.
  g.save();
  g.beginPath();
  g.rect(sel0, 0, Math.max(0, sel1 - sel0), h);
  g.clip();
  g.fillStyle = lit ? "rgba(227,205,166,0.06)" : "rgba(212,175,124,0.035)";
  g.fillRect(sel0, 0, sel1 - sel0, h);
  if (lit) {
    // Partie déjà lue : feuille d'or pleine, reflets clairs aux crêtes, léger rayonnement.
    const grad = g.createLinearGradient(0, mid - half, 0, mid + half);
    grad.addColorStop(0, GOLD_LIGHT); grad.addColorStop(0.5, GOLD); grad.addColorStop(1, GOLD_LIGHT);
    g.fillStyle = grad;
    g.shadowColor = "rgba(212,175,124,0.45)";
    g.shadowBlur = 14;
    g.fill(shape);
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(250,248,243,0.8)";
  } else {
    // À lire : la même onde, en or translucide, contour net.
    g.fillStyle = "rgba(212,175,124,0.34)";
    g.fill(shape);
    g.strokeStyle = "rgba(227,205,166,0.62)";
  }
  g.lineWidth = 1;
  g.stroke(edge);
  // Passages qui risquent de saturer : marques aux crêtes.
  g.fillStyle = CLIP;
  for (let x = 0; x < cols; x++) if (clip[x]) { g.fillRect(x, mid - half - 1, 1, 3); g.fillRect(x, mid + half - 2, 1, 3); }
  g.restore();

  // Ligne médiane et bords de la sélection.
  g.fillStyle = "rgba(250,248,243,0.07)";
  g.fillRect(0, Math.round(mid), w, 1);
  g.fillStyle = "rgba(212,175,124,0.75)";
  g.fillRect(Math.round(sel0), 0, 1, h);
  g.fillRect(Math.round(sel1) - 1, 0, 1, h);

  // Fondus : la courbe du niveau, lisible d'un coup d'œil.
  if (s.fadeIn > 0 || s.fadeOut > 0) {
    const flat: SoundShape = { ...s, volumeDb: 0 };
    g.strokeStyle = "rgba(250,248,243,0.62)";
    g.setLineDash([3, 3]);
    g.beginPath();
    const steps = Math.max(2, Math.round(sel1 - sel0));
    for (let k = 0; k <= steps; k++) {
      const x = sel0 + ((sel1 - sel0) * k) / steps;
      const t = (x / w) * d;
      const y = mid - half * Math.min(1, gainAt(Math.min(s.end, Math.max(s.start, t)), flat));
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
  }
}

export const AudioStage = forwardRef<AudioStageHandle, Props>(function AudioStage(p, ref) {
  const box = useRef<HTMLDivElement>(null);
  const wave = useRef<HTMLDivElement>(null);
  const baseCv = useRef<HTMLCanvasElement>(null);
  const litCv = useRef<HTMLCanvasElement>(null);
  const specBox = useRef<HTMLDivElement>(null);
  const specCv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, sw: 0, sh: 0 });
  const d = Math.max(0.001, p.info.duration);
  const facts = useMemo(() => soundFacts(p.info), [p.info]);
  const { start, end, speed, volumeDb, fadeIn, fadeOut } = p.shape;
  const shape = useMemo<SoundShape>(() => ({ start, end, speed, volumeDb, fadeIn, fadeOut }), [start, end, speed, volumeDb, fadeIn, fadeOut]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({
      w: wave.current?.clientWidth ?? 0, h: wave.current?.clientHeight ?? 0,
      sw: specBox.current?.clientWidth ?? 0, sh: specBox.current?.clientHeight ?? 0,
    });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Onde : redessinée quand la taille, l'onde ou la forme de l'export changent — une fois par image au plus (poignée
  // tirée, curseur de volume glissé).
  useEffect(() => {
    const peaks = p.peaks;
    if (!peaks?.length) return;
    const frame = requestAnimationFrame(() => {
      if (!baseCv.current || !litCv.current) return;
      drawWave(baseCv.current, peaks, d, shape, false);
      drawWave(litCv.current, peaks, d, shape, true);
    });
    return () => cancelAnimationFrame(frame);
  }, [p.peaks, d, shape, size.w, size.h]);

  useImperativeHandle(ref, () => ({
    setTime(t: number) {
      wave.current?.style.setProperty("--au-ph", `${(Math.min(d, Math.max(0, t)) / d) * 100}%`);
    },
  }), [d]);

  // Toucher l'onde : la lecture s'y place (et la suit au glisser).
  const seeking = useRef(false);
  const seekAt = (clientX: number) => {
    const r = wave.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    p.onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * d);
  };
  const down = (e: RPointerEvent) => {
    if (e.button > 0) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointeur relâché */ }
    seeking.current = true;
    seekAt(e.clientX);
  };
  const move = (e: RPointerEvent) => { if (seeking.current) seekAt(e.clientX); };
  const up = () => { seeking.current = false; };

  // ---- spectre ---------------------------------------------------------------------------------------------------
  const nBars = size.sw && size.sw < 520 ? BARS_NARROW : BARS_WIDE;
  const bars = useRef(new Float32Array(BARS_WIDE));
  const hold = useRef(new Float32Array(BARS_WIDE));
  const live = !!p.analyser;
  const mode = p.calm ? "still" : !p.playing ? "idle" : live ? "live" : p.peaks?.length ? "level" : "idle";
  const bands = useMemo(() => (p.analyser ? logBands(nBars, 45, 16000, p.analyser.context.sampleRate, p.analyser.fftSize) : null), [p.analyser, nBars]);
  const paint = useCallback((g: CanvasRenderingContext2D, w: number, h: number) => {
    g.clearRect(0, 0, w, h);
    const base = h - 1;
    g.fillStyle = "rgba(250,248,243,0.09)";
    g.fillRect(0, base, w, 1);
    const gap = w > 640 ? 4 : w > 360 ? 3 : 2;
    const bw = Math.max(1.5, (w - gap * (nBars - 1)) / nBars);
    const top = h - 8;
    const grad = g.createLinearGradient(0, base, 0, base - top);
    grad.addColorStop(0, GOLD_DEEP); grad.addColorStop(0.55, GOLD); grad.addColorStop(1, GOLD_LIGHT);
    g.fillStyle = grad;
    const r = Math.min(2, bw / 2);
    for (let i = 0; i < nBars; i++) {
      const bh = Math.max(2, bars.current[i]! * top);
      const x = i * (bw + gap);
      g.beginPath();
      if (typeof g.roundRect === "function") g.roundRect(x, base - bh, bw, bh, [r, r, 0, 0]); else g.rect(x, base - bh, bw, bh);
      g.fill();
    }
    g.fillStyle = "rgba(250,248,243,0.85)";
    for (let i = 0; i < nBars; i++) {
      const v = hold.current[i]!;
      if (v > 0.02) g.fillRect(i * (bw + gap), base - v * top - 4, bw, 1.5);
    }
  }, [nBars]);

  useEffect(() => {
    const cv = specCv.current, holder = specBox.current;
    if (!cv || !holder || !size.sw || !size.sh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size.sw * dpr);
    cv.height = Math.round(size.sh * dpr);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    holder.dataset.spectrum = mode;
    if (mode === "still") {
      bars.current.fill(0); hold.current.fill(0);
      paint(g, size.sw, size.sh);
      return;
    }
    const data = p.analyser ? new Uint8Array(p.analyser.frequencyBinCount) : null;
    let raf = 0, last = 0, report = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      const b = bars.current, hd = hold.current;
      let active = false;
      if (mode === "live" && data && bands && p.analyser) {
        p.analyser.getByteFrequencyData(data);
        for (let i = 0; i < nBars; i++) {
          const v = bandLevel(data, bands[i]!);
          b[i] = v > b[i]! ? b[i]! + (v - b[i]!) * Math.min(1, dt * 28) : b[i]! + (v - b[i]!) * Math.min(1, dt * 9);
        }
        active = true;
      } else if (mode === "level" && p.peaks?.length) {
        // Repli : le niveau autour de l'instant lu, de part et d'autre (la barre du milieu = maintenant).
        const t = p.currentTime();
        for (let i = 0; i < nBars; i++) {
          const v = levelAt(p.peaks, d, t + ((i - nBars / 2) / nBars) * 1.6, 0.06);
          b[i] = b[i]! + (Math.pow(v, 0.9) - b[i]!) * Math.min(1, dt * 14);
        }
        active = true;
      } else {
        for (let i = 0; i < nBars; i++) { b[i] = b[i]! * Math.pow(0.04, dt); if (b[i]! > 0.005) active = true; }
      }
      for (let i = 0; i < nBars; i++) {
        if (b[i]! >= hd[i]!) hd[i] = b[i]!;
        else { hd[i] = Math.max(0, hd[i]! - dt * 0.55); if (hd[i]! > 0.005) active = true; }
      }
      paint(g, size.sw, size.sh);
      if (now - report > 400) {
        report = now;
        let peak = 0, sum = 0;
        for (let i = 0; i < nBars; i++) { sum += b[i]!; if (b[i]! > b[peak]!) peak = i; }
        holder.dataset.peak = String(peak);
        holder.dataset.energy = String(Math.round((sum / nBars) * 100));
      }
      if (active || mode === "live" || mode === "level") raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, p.analyser, bands, nBars, paint, size.sw, size.sh, p.peaks, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const caption = mode === "still" ? "Spectre immobile : mouvement réduit activé."
    : mode === "live" ? "Spectre en direct, des graves aux aigus."
    : mode === "level" ? (p.routeBlocked ? "Niveau du son autour de la lecture (spectre indisponible dans ce navigateur)." : "Niveau du son autour de la lecture.")
    : "Lance la lecture pour voir le spectre.";

  return (
    <motion.div ref={box} className={cn("au", p.playing && "is-playing")} data-audio-stage=""
      initial={p.calm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }}>
      <div className="au-id">
        <button type="button" className="au-disc" onClick={p.onToggle} aria-label={p.playing ? "Pause" : "Lecture"} data-au-play="">
          <span className="au-halo" aria-hidden="true" />
          {p.playing ? <IconPause size={24} className="relative" /> : <IconPlay size={26} className="relative au-play-icon" />}
        </button>
        <div className="au-text">
          <p className="au-title" title={p.title}>{p.title}</p>
          <ul className="au-facts tabular" aria-label="Caractéristiques du son">
            {facts.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </div>
      <div className="au-wave" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true" data-au-wave="">
        <div ref={wave} className="au-track">
          {p.peaks?.length ? (
            <>
              <canvas ref={baseCv} className="au-cv" />
              <canvas ref={litCv} className="au-cv au-cv-lit" />
              <span className="au-ph" />
            </>
          ) : <span className="au-wave-wait">{p.peaks ? "Onde indisponible pour ce fichier." : "Lecture de l'onde…"}</span>}
        </div>
        <span className="au-end au-end-a tabular">0:00</span>
        <span className="au-end au-end-b tabular">{timecode(d, 0)}</span>
      </div>
      <div ref={specBox} className="au-spec" data-spectrum={mode}>
        <canvas ref={specCv} className="au-cv" aria-hidden="true" />
        {mode === "idle" && !p.playing && (
          <button type="button" className="au-spec-go" onClick={p.onToggle} data-au-listen="">
            <IconPlay size={14} />Écouter pour voir le spectre
          </button>
        )}
      </div>
      {mode !== "idle" && <p className="au-cap">{caption}</p>}
    </motion.div>
  );
});
