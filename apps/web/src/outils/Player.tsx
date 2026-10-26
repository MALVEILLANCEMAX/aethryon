// Lecteur d'édition : barre de lecture sous l'aperçu (image par image, lecture de la sélection, temps au centième,
// volume de l'aperçu, vitesse de l'aperçu, boucle, agrandir, plein écran), états de la vidéo sur l'image (chargement,
// mise en mémoire, erreur, grand bouton de lecture à l'arrêt) et, en plein écran, une barre de progression avec la
// sélection, ses poignées et l'aperçu au survol.
// Rien ici ne se rend à chaque image : le temps est écrit par l'horloge de l'éditeur (ref), la barre de plein écran
// suit la sélection vivante et la tête de lecture par variables CSS.
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { cn } from "../lib/cn.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { IconPause, IconPlay } from "../ui/Icon.tsx";
import type { Storyboard } from "./api.ts";
import type { Commands } from "./commands.ts";
import { timecode } from "./format.ts";
import { IconExpand, IconLoop, IconMute, IconStepBack, IconStepFwd, IconTheater, IconVolume } from "./icons.tsx";
import type { Span, Store } from "./live.ts";
import { DropMenu, Tip } from "./menus.tsx";
import { drawTile, sprite as loadSprite } from "./thumbs.ts";

export const PREVIEW_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const rateLabel = (r: number) => `×${String(r).replace(".", ",")}`;

/** État de la vidéo (événements du lecteur), sans rien rendre au-delà du composant qui l'emploie. */
export function useVideoState(video: RefObject<HTMLVideoElement | null>, src: string | null) {
  const [st, setSt] = useState({ ready: false, error: false, paused: true });
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const set = (patch: Partial<typeof st>) => setSt((s) => {
      for (const k of Object.keys(patch) as (keyof typeof st)[]) if (s[k] !== patch[k]) return { ...s, ...patch };
      return s;
    });
    const ready = () => set({ ready: true, error: false });
    const evs: [string, () => void][] = [["loadeddata", ready], ["error", () => set({ error: true })], ["play", () => set({ paused: false })],
      ["pause", () => set({ paused: true })], ["ended", () => set({ paused: true })], ["emptied", () => set({ ready: false })]];
    for (const [n, f] of evs) v.addEventListener(n, f);
    setSt({ ready: v.readyState >= 2, error: !!v.error, paused: v.paused });
    return () => { for (const [n, f] of evs) v.removeEventListener(n, f); };
  }, [video, src]);
  return st;
}

/** Roue de mise en mémoire : allumée si la lecture attend des données plus de 220 ms, sans aucun rendu React. */
function useBuffering(video: RefObject<HTMLVideoElement | null>, src: string | null, el: RefObject<HTMLSpanElement | null>) {
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => { el.current?.setAttribute("data-on", ""); el.current?.removeAttribute("aria-hidden"); }, 220);
    };
    const off = () => { window.clearTimeout(t); el.current?.removeAttribute("data-on"); el.current?.setAttribute("aria-hidden", "true"); };
    const offs = ["playing", "canplay", "seeked", "pause", "error", "emptied"];
    v.addEventListener("waiting", on);
    for (const n of offs) v.addEventListener(n, off);
    return () => { window.clearTimeout(t); v.removeEventListener("waiting", on); for (const n of offs) v.removeEventListener(n, off); };
  }, [video, src, el]);
}

/** Sur l'image : chargement, mise en mémoire, erreur (avec « Réessayer »), grand bouton de lecture à l'arrêt. */
export function StageOverlay({ video, src, calm, onPlay, showPlay }: {
  video: RefObject<HTMLVideoElement | null>; src: string | null; calm: boolean; onPlay(): void; showPlay: boolean;
}) {
  const st = useVideoState(video, src);
  const spin = useRef<HTMLSpanElement>(null);
  useBuffering(video, src, spin);
  if (!src) return null;
  return (
    <>
      <span ref={spin} className="so-spin" role="status" aria-label="Mise en mémoire…" aria-hidden="true" data-buffering="" />
      <AnimatePresence>
        {st.error ? (
          <motion.div key="err" className="so-card" role="alert" data-video-error=""
            initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: DUR.exit } }}>
            <p>La lecture de l'aperçu a échoué.</p>
            <button type="button" className="so-btn" onClick={() => { const v = video.current; if (v) { v.load(); } }}>Réessayer</button>
          </motion.div>
        ) : !st.ready ? (
          <motion.div key="load" className="so-load" aria-hidden="true" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: DUR.exit } }} />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {showPlay && st.ready && st.paused && !st.error && (
          <motion.button key="big" type="button" className="so-play" onClick={onPlay} aria-label="Lire la sélection" data-big-play=""
            initial={calm ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            exit={calm ? { opacity: 0, transition: { duration: DUR.calm } } : { opacity: 0, scale: 1.08, transition: { duration: DUR.exit, ease: EASE.exit } }}
            transition={{ duration: 0.2, ease: EASE.soft }}>
            <IconPlay size={30} className="translate-x-0.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

export interface PlayerBarProps {
  commands: Commands;
  playing: boolean;
  clock: RefObject<HTMLSpanElement | null>;
  duration: number;
  /** Volume de l'aperçu (0–1) et son coupé : n'agissent pas sur l'export. */
  volume: number;
  muted: boolean;
  onVolume(v: number): void;
  rate: number;
  onRate(r: number): void;
  disabled: boolean;
  hasAudio: boolean;
  compact: boolean;
}

export function PlayerBar(p: PlayerBarProps) {
  const c = p.commands;
  const vol = useRef<HTMLInputElement>(null);
  useEffect(() => { vol.current?.style.setProperty("--p", `${(p.muted ? 0 : p.volume) * 100}%`); }, [p.volume, p.muted]);
  return (
    <div className="pb" role="group" aria-label="Lecture" data-player-bar="">
      <div className="pb-side">
        <Tip label={c.prevFrame.label} keys={c.prevFrame.keys}>
          <button type="button" className="pb-icon" onClick={c.prevFrame.run} disabled={p.disabled} aria-label={c.prevFrame.label} data-prev-frame=""><IconStepBack size={18} /></button>
        </Tip>
        <Tip label={p.playing ? "Pause" : "Lire la sélection"} keys={["Espace"]}>
          <button type="button" className="pb-play" onClick={c.play.run} disabled={p.disabled} aria-label={p.playing ? "Pause" : "Lire la sélection"} data-play="">
            {p.playing ? <IconPause size={20} /> : <IconPlay size={20} className="translate-x-px" />}
          </button>
        </Tip>
        <Tip label={c.nextFrame.label} keys={c.nextFrame.keys}>
          <button type="button" className="pb-icon" onClick={c.nextFrame.run} disabled={p.disabled} aria-label={c.nextFrame.label} data-next-frame=""><IconStepFwd size={18} /></button>
        </Tip>
        <span className="pb-time tabular" aria-live="off"><span ref={p.clock} className="pb-clock">0:00,00</span><span className="pb-dur"> / {timecode(p.duration, 2)}</span></span>
      </div>
      <div className="pb-side pb-end">
        {p.hasAudio && !p.compact && (
          <div className="pb-vol">
            <Tip label={p.muted ? "Remettre le son de l'aperçu" : "Couper le son de l'aperçu"} keys={["M"]}>
              <button type="button" className="pb-icon" onClick={c.mute.run} aria-pressed={p.muted} aria-label="Couper le son de l'aperçu" data-mute="">
                {p.muted || p.volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
              </button>
            </Tip>
            <input ref={vol} type="range" className="pb-range" min={0} max={1} step={0.02} value={p.muted ? 0 : p.volume} aria-label="Volume de l'aperçu (sans effet sur l'export)"
              aria-valuetext={`${Math.round((p.muted ? 0 : p.volume) * 100)} %`} onChange={(e) => p.onVolume(Number(e.target.value))} />
          </div>
        )}
        {p.hasAudio && p.compact && (
          <button type="button" className="pb-icon" onClick={c.mute.run} aria-pressed={p.muted} aria-label="Couper le son de l'aperçu" data-mute="">
            {p.muted ? <IconMute size={18} /> : <IconVolume size={18} />}
          </button>
        )}
        {!p.compact && (
          <DropMenu label="Vitesse de l'aperçu" side="top" align="end"
            entries={[{ kind: "label", text: "Vitesse de l'aperçu (pas de l'export)" }, { kind: "radio", value: String(p.rate), options: PREVIEW_RATES.map((r) => ({ value: String(r), label: rateLabel(r) })), onChange: (v) => p.onRate(Number(v)) }]}
            trigger={
              <button type="button" className={cn("pb-rate tabular", p.rate !== 1 && "is-on")} aria-label={`Vitesse de l'aperçu : ${rateLabel(p.rate)}`} disabled={p.disabled} data-rate="">{rateLabel(p.rate)}</button>
            } />
        )}
        <Tip label={c.loop.label} keys={c.loop.keys}>
          <button type="button" className={cn("pb-icon", c.loop.checked && "is-on")} aria-pressed={!!c.loop.checked} onClick={c.loop.run} disabled={p.disabled} aria-label={c.loop.label} data-loop=""><IconLoop size={18} /></button>
        </Tip>
        {!p.compact && (
          <Tip label={c.theater.checked ? "Rétablir les panneaux" : c.theater.label} keys={c.theater.keys}>
            <button type="button" className={cn("pb-icon", c.theater.checked && "is-on")} aria-pressed={!!c.theater.checked} onClick={c.theater.run} aria-label={c.theater.label} data-theater=""><IconTheater size={18} /></button>
          </Tip>
        )}
        <Tip label={c.fullscreen.label} keys={c.fullscreen.keys}>
          <button type="button" className="pb-icon" onClick={c.fullscreen.run} disabled={p.disabled} aria-label={c.fullscreen.label} data-fullscreen=""><IconExpand size={18} /></button>
        </Tip>
      </div>
    </div>
  );
}

export interface ScrubberHandle { setTime(t: number): void }

/**
 * Barre de progression du plein écran : tout le média, la sélection en or avec ses deux poignées, la tête de lecture,
 * l'aperçu de l'image au survol. Cliquer ou glisser place la lecture ; tirer une poignée règle la sélection (validée au
 * lâcher, comme sur la frise).
 */
export const Scrubber = forwardRef<ScrubberHandle, {
  duration: number; live: Store<Span>; onSeek(t: number, how: "drag" | "jump"): void; onCommit(a: number, b: number, edge: "start" | "end"): void;
  onScrub(active: boolean): void; board: Storyboard | null; boardUrl: string | null;
}>(function Scrubber(p, ref) {
  const bar = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipCv = useRef<HTMLCanvasElement>(null);
  const tipTime = useRef<HTMLSpanElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const d = Math.max(0.001, p.duration);
  const drag = useRef<null | { kind: "seek" | "start" | "end"; start: number; end: number }>(null);
  useEffect(() => { img.current = loadSprite(p.boardUrl); }, [p.boardUrl]);
  useEffect(() => {
    const place = () => {
      const { start, end } = p.live.get();
      bar.current?.style.setProperty("--sa", `${(start / d) * 100}%`);
      bar.current?.style.setProperty("--sb", `${(end / d) * 100}%`);
    };
    place();
    return p.live.subscribe(place);
  }, [p.live, d]);
  useImperativeHandle(ref, () => ({ setTime(t) { bar.current?.style.setProperty("--sp", `${(Math.min(d, Math.max(0, t)) / d) * 100}%`); } }), [d]);
  const at = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((x - r.left) / r.width) * d));
  };
  const down = (kind: "seek" | "start" | "end") => (e: RPointerEvent) => {
    if (e.button > 0) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* relâché */ }
    const { start, end } = p.live.get();
    drag.current = { kind, start, end };
    p.onScrub(true);
    if (kind === "seek") p.onSeek(at(e.clientX), "drag");
  };
  const move = (e: RPointerEvent) => {
    const g = drag.current;
    const t = at(e.clientX);
    if (!g) {
      // Aperçu au survol.
      const r = bar.current!.getBoundingClientRect();
      const tp = tip.current;
      if (tp && e.pointerType === "mouse") {
        const w = tp.offsetWidth || 160;
        tp.style.transform = `translate3d(${Math.round(Math.max(0, Math.min(r.width - w, e.clientX - r.left - w / 2)))}px,0,0)`;
        if (tipTime.current) tipTime.current.textContent = timecode(t, 2);
        if (tipCv.current && drawTile(tipCv.current, p.board, img.current, t, { w: 168, h: 94 })) tp.dataset.thumb = ""; else delete tp.dataset.thumb;
        tp.dataset.on = "";
      }
      return;
    }
    const { start, end } = p.live.get();
    if (g.kind === "seek") p.onSeek(t, "drag");
    else if (g.kind === "start") { const v = Math.min(t, end - 0.1); p.live.set({ start: v, end, gesture: "start" }); p.onSeek(v, "drag"); }
    else { const v = Math.max(t, start + 0.1); p.live.set({ start, end: v, gesture: "end" }); p.onSeek(v, "drag"); }
  };
  const up = () => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    const { start, end } = p.live.get();
    if (g.kind !== "seek") {
      p.live.set({ start, end, gesture: null });
      if (start !== g.start || end !== g.end) p.onCommit(start, end, g.kind);
    }
    p.onScrub(false);
  };
  return (
    <div className="sc" data-scrubber="">
      <div ref={tip} className="sc-tip" aria-hidden="true"><canvas ref={tipCv} className="sc-tip-cv" /><span ref={tipTime} className="tabular" /></div>
      <div ref={bar} className="sc-bar" onPointerDown={down("seek")} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={() => { if (tip.current) delete tip.current.dataset.on; }} aria-hidden="true">
        <span className="sc-track" />
        <span className="sc-sel" />
        <span className="sc-knob sc-knob-a" onPointerDown={down("start")} />
        <span className="sc-knob sc-knob-b" onPointerDown={down("end")} />
        <span className="sc-head" />
      </div>
    </div>
  );
});
