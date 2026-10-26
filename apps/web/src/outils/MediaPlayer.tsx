// Lecteur des fichiers EXPORTÉS (le vrai fichier, lu par /api/outils/medias/{id}/flux : session exigée, plages HTTP,
// jamais public ; aucun téléchargement automatique — « Télécharger » est un bouton à part, /fichier).
// - Vidéo : commandes AETHRYON (lecture, barre de lecture avec la part chargée, temps, volume, vitesse, plein écran,
//   téléchargement), cadre au rapport RÉEL du fichier (métadonnées), jamais à sa résolution : une vidéo 1920 × 1080
//   n'impose aucune largeur. Commandes masquées après 2,5 s sans mouvement pendant la lecture, jamais au clavier.
// - Son : grande touche de lecture, onde du passage (planche d'onde de la source, au rythme de l'export), temps.
// - GIF : l'image animée en boucle, « Pause » fige l'image (un GIF ne se met pas en pause tout seul).
// Rien n'est rendu par React pendant la lecture : position et temps écrits directement (une fois par image).
// Fermeture : lecture arrêtée, fichier lâché (plus aucune requête), décodeur libéré.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { IconAlert, IconDownload, IconPause, IconPlay } from "../ui/Icon.tsx";
import type { ToolsJob } from "./api.ts";
import { timecode } from "./format.ts";
import { IconExpand, IconLoop, IconMute, IconVolume } from "./icons.tsx";
import { DropMenu, Tip } from "./menus.tsx";
import { seeker } from "./seeker.ts";

export type MediaKind = "video" | "audio" | "gif";

export function kindOf(job: ToolsJob): MediaKind {
  if ((job.mediaType ?? "").startsWith("image/") || job.derive?.op === "gif") return "gif";
  if (job.media ? !job.media.has_video : (job.mediaType ?? "").startsWith("audio/") || job.derive?.op === "audio") return "audio";
  return "video";
}

/** Rapport largeur / hauteur du fichier réel (rotation des métadonnées comprise), 16:9 à défaut. */
export function ratioOf(job: ToolsJob): number {
  const m = job.media;
  if (!m?.width || !m.height) return 16 / 9;
  const r = m.rotation === 90 || m.rotation === 270 || m.rotation === -90 ? m.height / m.width : m.width / m.height;
  return Number.isFinite(r) && r > 0.2 && r < 5 ? r : 16 / 9;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const rateLabel = (r: number) => `×${String(r).replace(".", ",")}`;

type Why = { gone: boolean; message: string };

/** Réponse du serveur pour UN octet du fichier (le lecteur du navigateur ne la dit pas) : son statut, 0 sans réponse. */
async function probe(url: string): Promise<number> {
  try {
    return (await fetch(url, { headers: { range: "bytes=0-0" }, credentials: "same-origin", cache: "no-store" })).status;
  } catch {
    return 0;
  }
}

/** Refus du serveur : session expirée, autre compte, fichier effacé ; null s'il sert le fichier ou ne répond pas. */
function refused(status: number): Why | null {
  if (status === 401) return { gone: false, message: "Ta session a expiré : reconnecte-toi pour lire ce fichier." };
  if (status === 403) return { gone: false, message: "Ce fichier n'est pas accessible depuis ce compte." };
  if (status === 404 || status === 410) return { gone: true, message: "Ce fichier n'est plus disponible : il a expiré ou il a été supprimé." };
  return null;
}

/** Pourquoi un fichier ne se lit pas : le refus du serveur, sinon le format ou le réseau. */
export async function whyUnplayable(url: string): Promise<Why> {
  const s = await probe(url);
  return refused(s) ?? (s >= 200 && s < 300
    ? { gone: false, message: "Ce navigateur ne sait pas lire ce format : télécharge le fichier pour l'ouvrir." }
    : { gone: false, message: "La lecture a échoué : vérifie ta connexion, puis réessaie." });
}

/** Écrit une variable CSS sans rendu React. */
const setVar = (el: HTMLElement | null, name: string, v: string) => { if (el && el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };

function Unavailable({ message, onRetry }: { message: string; onRetry?(): void }) {
  return (
    <div className="mp-error" role="alert" data-player-error="">
      <IconAlert size={20} />
      <p>{message}</p>
      {onRetry && <button type="button" className="mp-text" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

interface Common {
  job: ToolsJob;
  /** Panneau d'export (réussite) : cadre plus bas, commandes plus serrées. */
  compact?: boolean;
  autoPlay?: boolean;
  /** Onde de la SOURCE (0–255) et passage exporté, pour dessiner l'onde d'un son. */
  peaks?: readonly number[] | null;
  sourceDuration?: number;
  /** Le fichier n'existe plus (404, 410) : la carte de la médiathèque passe « indisponible ». */
  onGone?(): void;
  /** Contenu ajouté sous les commandes (rien par défaut). */
  extra?: ReactNode;
}

export function MediaPlayer(p: Common) {
  const kind = kindOf(p.job);
  if (!p.job.streamUrl) return <Unavailable message="Ce fichier n'est pas encore prêt." />;
  if (kind === "gif") return <GifViewer {...p} />;
  if (kind === "audio") return <AudioPlayer {...p} />;
  return <VideoPlayer {...p} />;
}

/**
 * État commun d'un élément média (vidéo ou son) : peu de rendus, le temps passe par des refs. `attempt` change à
 * chaque « Réessayer » (nouvel élément) : les écouteurs le suivent. À la fermeture, le fichier est lâché.
 */
function useMedia(el: React.RefObject<HTMLMediaElement | null>, src: string, p: Common, attempt: number) {
  const [st, setSt] = useState({ playing: false, ready: false, waiting: false, duration: 0, muted: false, volume: 1, rate: 1, error: null as string | null, gone: false });
  const set = useCallback((patch: Partial<typeof st>) => setSt((s) => {
    for (const k of Object.keys(patch) as (keyof typeof st)[]) if (s[k] !== patch[k]) return { ...s, ...patch };
    return s;
  }), []);
  const onGone = useRef(p.onGone);
  onGone.current = p.onGone;
  useEffect(() => {
    const m = el.current;
    if (!m) return;
    let wait = 0, check = 0, alive = true;
    const stop = (w: Why) => {
      if (w.gone) onGone.current?.();
      if (!alive) return;
      // Plus rien ne joue depuis la mémoire du navigateur, plus aucune requête.
      m.pause();
      m.removeAttribute("src");
      m.load();
      set({ error: w.message, gone: w.gone, waiting: false, playing: false, ready: false });
    };
    const fail = () => { void whyUnplayable(src).then(stop); };
    // Un fichier effacé (ou une session expirée) depuis sa dernière lecture : le navigateur le lit depuis sa mémoire,
    // puis réessaie la suite sans fin, sans jamais d'erreur (plus de 90 s mesurées). Le serveur est donc interrogé à
    // l'ouverture, puis quand le chargement cale : saut ou lecture sans données depuis 3 s.
    const ask = () => { void probe(src).then((s) => { const w = refused(s); if (w) stop(w); }); };
    const hold = () => { window.clearTimeout(check); check = window.setTimeout(ask, 3000); };
    const settle = () => { window.clearTimeout(wait); window.clearTimeout(check); set({ waiting: false }); };
    const evs: [string, () => void][] = [
      ["loadedmetadata", () => set({ duration: Number.isFinite(m.duration) ? m.duration : 0 })],
      ["loadeddata", () => set({ ready: true })],
      ["play", () => set({ playing: true })],
      ["pause", () => set({ playing: false })],
      ["ended", () => set({ playing: false })],
      ["waiting", () => { window.clearTimeout(wait); wait = window.setTimeout(() => set({ waiting: true }), 220); hold(); }],
      ["seeking", hold],
      ["playing", settle],
      ["canplay", settle],
      ["seeked", settle],
      ["volumechange", () => set({ muted: m.muted, volume: m.volume })],
      ["ratechange", () => set({ rate: m.playbackRate })],
      ["stalled", ask],
      ["error", fail],
    ];
    for (const [n, f] of evs) m.addEventListener(n, f);
    if (m.error) fail(); else ask();
    return () => { alive = false; window.clearTimeout(wait); window.clearTimeout(check); for (const [n, f] of evs) m.removeEventListener(n, f); };
  }, [el, src, set, attempt]);
  // Fermeture du lecteur : plus de lecture, plus de requête, décodeur libéré.
  useEffect(() => () => {
    const m = el.current;
    if (!m) return;
    m.pause();
    m.removeAttribute("src");
    m.load();
  }, [el]);
  const retry = useCallback(() => set({ error: null, ready: false, waiting: false }), [set]);
  return { st, set, retry };
}

/** Position et part chargée, écrites une fois par image pendant la lecture (et à chaque saut à l'arrêt). */
function useClock(el: React.RefObject<HTMLMediaElement | null>, root: React.RefObject<HTMLElement | null>, timeText: React.RefObject<HTMLSpanElement | null>, range: React.RefObject<HTMLInputElement | null>, playing: boolean, duration: number) {
  const paint = useCallback(() => {
    const m = el.current;
    if (!m) return;
    const d = duration || m.duration || 0;
    const t = m.currentTime;
    setVar(root.current, "--p", `${d ? Math.min(100, (t / d) * 100) : 0}%`);
    let b = 0;
    for (let i = 0; i < m.buffered.length; i++) if (m.buffered.start(i) <= t + 0.5) b = Math.max(b, m.buffered.end(i));
    setVar(root.current, "--b", `${d ? Math.min(100, (b / d) * 100) : 0}%`);
    const txt = timecode(t, 0);
    if (timeText.current && timeText.current.textContent !== txt) timeText.current.textContent = txt;
    const r = range.current;
    if (r && document.activeElement !== r) r.value = String(t);
    r?.setAttribute("aria-valuetext", `${timecode(t, 0)} sur ${timecode(d, 0)}`);
  }, [el, root, timeText, range, duration]);
  useEffect(() => {
    const m = el.current;
    if (!m) return;
    let raf = 0;
    const tick = () => { paint(); raf = requestAnimationFrame(tick); };
    if (playing) raf = requestAnimationFrame(tick); else paint();
    const still = () => { if (m.paused) paint(); };
    m.addEventListener("seeked", still);
    m.addEventListener("progress", still);
    m.addEventListener("loadedmetadata", still);
    return () => { cancelAnimationFrame(raf); m.removeEventListener("seeked", still); m.removeEventListener("progress", still); m.removeEventListener("loadedmetadata", still); };
  }, [el, playing, paint]);
  return paint;
}

/** Barre de lecture : vrai curseur (clavier, lecteurs d'écran), part lue en or, part chargée en ivoire léger. */
function SeekBar({ range, duration, onSeek, onScrub, label }: {
  range: React.RefObject<HTMLInputElement | null>; duration: number; onSeek(t: number, final: boolean): void; onScrub(active: boolean): void; label: string;
}) {
  return (
    <span className="mp-seek">
      <span className="mp-track" aria-hidden="true"><span className="mp-buf" /><span className="mp-fill" /></span>
      <input ref={range} type="range" className="mp-range" min={0} max={duration || 0} step={0.01} defaultValue={0} disabled={!duration} aria-label={label}
        onPointerDown={() => onScrub(true)} onPointerUp={() => onScrub(false)} onPointerCancel={() => onScrub(false)}
        onInput={(e) => onSeek(Number(e.currentTarget.value), false)} onChange={(e) => onSeek(Number(e.currentTarget.value), true)} />
    </span>
  );
}

function Volume({ m, muted, volume, compact }: { m: HTMLMediaElement | null; muted: boolean; volume: number; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { setVar(ref.current, "--v", `${(muted ? 0 : volume) * 100}%`); }, [muted, volume]);
  return (
    <span className="mp-vol">
      <Tip label={muted ? "Remettre le son" : "Couper le son"} keys={["M"]}>
        <button type="button" className="mp-btn" onClick={() => { if (m) m.muted = !m.muted; }} aria-pressed={muted} aria-label="Couper le son" data-mp-mute="">
          {muted || volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
        </button>
      </Tip>
      {!compact && (
        <input ref={ref} type="range" className="mp-vrange" min={0} max={1} step={0.02} value={muted ? 0 : volume} aria-label="Volume"
          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} %`} onChange={(e) => { if (m) { m.volume = Number(e.target.value); m.muted = Number(e.target.value) === 0; } }} />
      )}
    </span>
  );
}

function Rate({ m, rate }: { m: HTMLMediaElement | null; rate: number }) {
  return (
    <DropMenu label="Vitesse de lecture" side="top" align="end"
      entries={[{ kind: "label", text: "Vitesse de lecture (le fichier ne change pas)" }, { kind: "radio", value: String(rate), options: RATES.map((r) => ({ value: String(r), label: rateLabel(r) })), onChange: (v) => { if (m) m.playbackRate = Number(v); } }]}
      trigger={<button type="button" className={cn("mp-btn mp-rate tabular", rate !== 1 && "is-on")} aria-label={`Vitesse de lecture : ${rateLabel(rate)}`} data-mp-rate="">{rateLabel(rate)}</button>} />
  );
}

function Download({ job }: { job: ToolsJob }) {
  if (!job.fileUrl) return null;
  return (
    <Tip label="Télécharger le fichier">
      <a className="mp-btn" href={job.fileUrl} download aria-label={`Télécharger ${job.filename ?? "le fichier"}`} data-mp-download=""><IconDownload size={18} /></a>
    </Tip>
  );
}

/** Touches du lecteur (focus dans le lecteur, hors bouton et curseur qui ont les leurs). */
function playerKeys(e: KeyboardEvent, m: HTMLMediaElement | null, toggle: () => void, fullscreen?: () => void) {
  if (!m || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement;
  const native = t.closest("input, a, [role=menuitem], [role=menuitemradio]") || (t.closest("button") && (e.key === " " || e.key === "Enter"));
  if (native) return;
  const k = e.key.toLowerCase();
  if (k === " " || k === "k") toggle();
  else if (k === "arrowleft") m.currentTime = Math.max(0, m.currentTime - 5);
  else if (k === "arrowright") m.currentTime = Math.min(m.duration || 0, m.currentTime + 5);
  else if (k === "m") m.muted = !m.muted;
  else if (k === "f" && fullscreen) fullscreen();
  else return;
  e.preventDefault();
  e.stopPropagation();
}

function VideoPlayer(p: Common) {
  const { job, compact } = p;
  const src = job.streamUrl!;
  const v = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const timeText = useRef<HTMLSpanElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const [retry, setRetry] = useState(0);
  const { st, retry: clearError } = useMedia(v, src, p, retry);
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const scrubbing = useRef(false);
  const wasPlaying = useRef(false);
  const paint = useClock(v, root, timeText, range, st.playing, st.duration);
  const seek = useMemo(() => seeker(() => v.current), []);
  const ar = ratioOf(job);
  useLayoutEffect(() => { setVar(root.current, "--ar", String(ar)); }, [ar]);
  useEffect(() => {
    const f = () => setFs(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  // Commandes masquées après 2,5 s d'immobilité pendant la lecture ; un mouvement, une touche ou l'arrêt les rendent.
  const idleTimer = useRef(0);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => { if (!v.current?.paused && !root.current?.matches(":focus-within")) setIdle(true); }, 2500);
  }, []);
  useEffect(() => { if (!st.playing) { window.clearTimeout(idleTimer.current); setIdle(false); } else wake(); }, [st.playing, wake]);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);
  const toggle = useCallback(() => {
    const m = v.current;
    if (!m) return;
    if (m.paused) { if (m.ended) m.currentTime = 0; void m.play().catch(() => undefined); } else m.pause();
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    const el = root.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else (v.current as unknown as { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
  }, []);
  if (st.error) return <Unavailable message={st.error} onRetry={st.gone ? undefined : () => { clearError(); setRetry((n) => n + 1); }} />;
  return (
    <div ref={root} className={cn("mp mp-video", compact && "is-compact", fs && "is-fs", idle && "is-idle", st.playing && "is-playing")} data-player="video" tabIndex={-1}
      onPointerMove={wake} onKeyDown={(e) => { wake(); playerKeys(e, v.current, toggle, fullscreen); }}>
      <div className="mp-frame">
        <video key={retry} ref={v} className="mp-media" src={src} playsInline preload="metadata" autoPlay={p.autoPlay}
          onClick={toggle} onDoubleClick={fullscreen} aria-label={`Lecture de ${job.filename ?? "la vidéo exportée"}`} data-mp-media="" />
        {!st.ready && <span className="mp-load" aria-hidden="true" />}
        {st.waiting && <span className="mp-spin" role="status" aria-label="Chargement…" />}
        {st.ready && !st.playing && (
          <button type="button" className="mp-big" onClick={toggle} aria-label="Lire" data-mp-big=""><IconPlay size={compact ? 24 : 30} className="translate-x-0.5" /></button>
        )}
      </div>
      <div className="mp-bar" role="group" aria-label="Commandes de lecture">
        <Tip label={st.playing ? "Pause" : "Lire"} keys={["Espace"]}>
          <button type="button" className="mp-btn mp-play" onClick={toggle} aria-label={st.playing ? "Pause" : "Lire"} data-mp-play="">
            {st.playing ? <IconPause size={18} /> : <IconPlay size={18} className="translate-x-px" />}
          </button>
        </Tip>
        <SeekBar range={range} duration={st.duration} label="Position dans la vidéo exportée"
          onScrub={(a) => { const m = v.current; if (!m) return; scrubbing.current = a; if (a) { wasPlaying.current = !m.paused; m.pause(); } else if (wasPlaying.current) void m.play().catch(() => undefined); }}
          onSeek={(t, final) => { if (final) seek.now(t); else seek.to(t); paint(); }} />
        <span className="mp-time tabular"><span ref={timeText}>0:00</span><span className="mp-dur"> / {timecode(st.duration, 0)}</span></span>
        <Volume m={v.current} muted={st.muted} volume={st.volume} compact={compact} />
        {!compact && <Rate m={v.current} rate={st.rate} />}
        <Tip label={fs ? "Quitter le plein écran" : "Plein écran"} keys={["F"]}>
          <button type="button" className="mp-btn" onClick={fullscreen} aria-label={fs ? "Quitter le plein écran" : "Plein écran"} data-mp-fullscreen=""><IconExpand size={18} /></button>
        </Tip>
        {!compact && <Download job={job} />}
      </div>
      {p.extra}
    </div>
  );
}

/** Onde du passage exporté : tirée de l'onde de la source (aucune requête de plus), au rythme de l'export. */
function Wave({ peaks, from, to, sourceDuration }: { peaks?: readonly number[] | null; from: number; to: number; sourceDuration?: number }) {
  const base = useRef<HTMLCanvasElement>(null);
  const gold = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const draw = () => {
      for (const [cv, fill] of [[base.current, "rgba(179,169,153,0.45)"], [gold.current, "#d4af7c"]] as const) {
        if (!cv) continue;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) continue;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        const g = cv.getContext("2d");
        if (!g) continue;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.fillStyle = fill;
        const n = peaks?.length ?? 0;
        const dur = sourceDuration || 0;
        let max = 1;
        if (peaks) for (const x of peaks) if (x > max) max = x;
        for (let x = 0; x < w; x += 3) {
          let amp = 0.18;
          if (n && dur) {
            const a = Math.floor(((from + ((to - from) * x) / w) / dur) * n);
            const z = Math.max(a + 1, Math.floor(((from + ((to - from) * (x + 3)) / w) / dur) * n));
            let pk = 0;
            for (let i = a; i < z && i < n; i++) if (peaks![i]! > pk) pk = peaks![i]!;
            amp = Math.pow(pk / max, 0.7);
          }
          const bh = Math.max(2, amp * (h - 4));
          g.fillRect(x, (h - bh) / 2, 2, bh);
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (base.current) ro.observe(base.current);
    return () => ro.disconnect();
  }, [peaks, from, to, sourceDuration]);
  return (
    <span className="mp-wave" aria-hidden="true">
      <canvas ref={base} className="mp-wave-cv" />
      <canvas ref={gold} className="mp-wave-cv mp-wave-gold" />
    </span>
  );
}

function AudioPlayer(p: Common) {
  const { job, compact } = p;
  const src = job.streamUrl!;
  const a = useRef<HTMLAudioElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const timeText = useRef<HTMLSpanElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const [retry, setRetry] = useState(0);
  const { st, retry: clearError } = useMedia(a, src, p, retry);
  const paint = useClock(a, root, timeText, range, st.playing, st.duration);
  const seek = useMemo(() => seeker(() => a.current), []);
  const wasPlaying = useRef(false);
  const toggle = useCallback(() => {
    const m = a.current;
    if (!m) return;
    if (m.paused) { if (m.ended) m.currentTime = 0; void m.play().catch(() => undefined); } else m.pause();
  }, []);
  const from = Number(job.derive?.start_s ?? 0);
  const speed = Number((job.derive as { speed?: number } | undefined)?.speed ?? 1) || 1;
  const to = from + (Number(job.derive?.duration_s ?? 0) || (job.media?.duration ?? 0) * speed);
  if (st.error) return <Unavailable message={st.error} onRetry={st.gone ? undefined : () => { clearError(); setRetry((n) => n + 1); }} />;
  return (
    <div ref={root} className={cn("mp mp-audio", compact && "is-compact", st.playing && "is-playing")} data-player="audio" tabIndex={-1} onKeyDown={(e) => playerKeys(e, a.current, toggle)}>
      <audio key={retry} ref={a} src={src} preload="metadata" autoPlay={p.autoPlay} data-mp-media="" />
      <button type="button" className="mp-abig" onClick={toggle} aria-label={st.playing ? "Pause" : "Écouter"} data-mp-play="">
        {st.playing ? <IconPause size={22} /> : <IconPlay size={22} className="translate-x-0.5" />}
      </button>
      <div className="mp-amain">
        <span className="mp-awave">
          <Wave peaks={p.peaks} from={from} to={to} sourceDuration={p.sourceDuration} />
          <SeekBar range={range} duration={st.duration} label="Position dans le son exporté"
            onScrub={(on) => { const m = a.current; if (!m) return; if (on) { wasPlaying.current = !m.paused; m.pause(); } else if (wasPlaying.current) void m.play().catch(() => undefined); }}
            onSeek={(t, final) => { if (final) seek.now(t); else seek.to(t); paint(); }} />
        </span>
        <span className="mp-arow">
          <span className="mp-time tabular"><span ref={timeText}>0:00</span><span className="mp-dur"> / {timecode(st.duration, 0)}</span></span>
          {st.waiting && <span className="mp-spin is-inline" role="status" aria-label="Chargement…" />}
          <span className="mp-grow" />
          <Volume m={a.current} muted={st.muted} volume={st.volume} compact />
          {!compact && <Rate m={a.current} rate={st.rate} />}
          {!compact && <Download job={job} />}
        </span>
      </div>
      {p.extra}
    </div>
  );
}

function GifViewer(p: Common) {
  const { job, compact } = p;
  const img = useRef<HTMLImageElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ar = ratioOf(job);
  useLayoutEffect(() => { setVar(root.current, "--ar", String(ar)); }, [ar]);
  // Comme la vidéo et le son : un GIF effacé depuis reste affiché depuis la mémoire du navigateur ; le serveur dit
  // s'il existe encore.
  const onGone = useRef(p.onGone);
  onGone.current = p.onGone;
  const src = job.streamUrl!;
  useEffect(() => {
    let alive = true;
    void probe(src).then((s) => {
      const w = refused(s);
      if (!w) return;
      if (w.gone) onGone.current?.();
      if (alive) setError(w.message);
    });
    return () => { alive = false; };
  }, [src]);
  const freeze = () => {
    const i = img.current, c = still.current;
    if (!i || !c) return;
    if (!paused) {
      c.width = i.naturalWidth; c.height = i.naturalHeight;
      c.getContext("2d")?.drawImage(i, 0, 0);
    }
    setPaused(!paused);
  };
  if (error) return <Unavailable message={error} />;
  return (
    <div ref={root} className={cn("mp mp-gif", compact && "is-compact", paused && "is-paused")} data-player="gif" tabIndex={-1}>
      <div className="mp-frame">
        <img ref={img} className="mp-media" src={src} alt={`GIF exporté : ${job.filename ?? ""}`} data-mp-media=""
          onError={() => { void whyUnplayable(src).then((w) => { setError(w.message); if (w.gone) onGone.current?.(); }); }} />
        <canvas ref={still} className="mp-still" aria-hidden="true" />
        <span className="mp-loop-badge"><IconLoop size={14} />Boucle infinie</span>
      </div>
      <div className="mp-bar" role="group" aria-label="Commandes du GIF">
        <button type="button" className="mp-btn mp-play" onClick={freeze} aria-label={paused ? "Reprendre l'animation" : "Figer l'image"} aria-pressed={paused} data-mp-play="">
          {paused ? <IconPlay size={18} className="translate-x-px" /> : <IconPause size={18} />}
        </button>
        <span className="mp-time">{paused ? "Image figée" : "En boucle"}</span>
        <span className="mp-grow" />
        {!compact && <Download job={job} />}
      </div>
      {p.extra}
    </div>
  );
}
