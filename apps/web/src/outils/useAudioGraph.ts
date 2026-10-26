// Son de l'aperçu passé par Web Audio, seulement quand c'est sûr : spectre en direct (AnalyserNode) et volume réel de
// l'export, amplification comprise (GainNode ; l'élément <video> seul ne sait qu'atténuer).
// - Branché au premier geste de lecture (règle des navigateurs), une seule fois par élément, pour toute la visite.
// - Jamais pour un flux d'une autre origine : le navigateur y couperait le son (ici, flux du site ou fichier local).
// - Sur iPhone et iPad, seulement avec l'API Audio Session (type « playback ») : sans elle, le bouton « silencieux »
//   couperait le son de l'aperçu, ce que l'élément seul ne fait pas. Sinon : pas de spectre, son inchangé.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface Graph { ctx: AudioContext; gain: GainNode; analyser: AnalyserNode }
const graphs = new WeakMap<HTMLMediaElement, Graph>();

type AudioCtor = typeof AudioContext;
const audioCtor = (): AudioCtor | null =>
  (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) ?? null;

function appleTouch(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Le flux de cet élément peut-il passer par Web Audio sans risque pour le son ? */
export function canRoute(el: HTMLMediaElement): boolean {
  if (!audioCtor()) return false;
  const src = el.currentSrc || el.src;
  if (!src) return false;
  try {
    const u = new URL(src, location.href);
    if (u.protocol !== "blob:" && u.origin !== location.origin) return false;
  } catch {
    return false;
  }
  if (appleTouch()) {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (!session) return false;
    try { session.type = "playback"; } catch { return false; }
  }
  return true;
}

export function useAudioGraph(video: RefObject<HTMLVideoElement | null>) {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [blocked, setBlocked] = useState(false); // vrai seulement si ce navigateur (ou ce flux) ne permet pas le spectre
  const graph = useRef<Graph | null>(null);
  const level = useRef(1); // gain linéaire voulu (0 : muet)

  const apply = useCallback(() => {
    const el = video.current, g = graph.current;
    if (!el) return;
    if (g) {
      el.muted = false;
      el.volume = 1;
      g.gain.gain.setTargetAtTime(level.current, g.ctx.currentTime, 0.015);
    } else {
      el.muted = level.current === 0;
      el.volume = Math.min(1, level.current);
    }
  }, [video]);

  /** À appeler dans un geste de l'utilisateur (clic, touche), juste avant la lecture. */
  const connect = useCallback(() => {
    const el = video.current;
    if (!el) return;
    let g = graphs.get(el) ?? null;
    if (!g) {
      if (!canRoute(el)) { setBlocked(true); return; }
      try {
        const Ctor = audioCtor()!;
        const ctx = new Ctor({ latencyHint: "playback" });
        const source = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        const an = ctx.createAnalyser();
        an.fftSize = 4096;
        an.smoothingTimeConstant = 0.78;
        an.minDecibels = -92;
        an.maxDecibels = -20;
        source.connect(gain);
        gain.connect(an);
        an.connect(ctx.destination);
        g = { ctx, gain, analyser: an };
        graphs.set(el, g);
      } catch {
        setBlocked(true);
        return;
      }
    }
    graph.current = g;
    if (g.ctx.state !== "running") void g.ctx.resume().catch(() => undefined);
    apply();
    setAnalyser(g.analyser);
  }, [video, apply]);

  /** Volume de l'aperçu : gain linéaire (1 = inchangé, 0 = muet), amplification réelle une fois branché. */
  const setLevel = useCallback((gain: number) => {
    level.current = Math.max(0, gain);
    apply();
  }, [apply]);

  // En quittant l'éditeur : le contexte audio est fermé (le son de l'élément part avec lui).
  useEffect(() => () => { void graph.current?.ctx.close().catch(() => undefined); graph.current = null; }, []);

  return { analyser, blocked, connect, setLevel };
}
