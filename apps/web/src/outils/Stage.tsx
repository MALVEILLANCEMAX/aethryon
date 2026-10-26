// Scène de l'éditeur : l'aperçu réel (élément <video> natif, flux servi par plages d'octets, ou fichier local blob:
// pendant son envoi), tourné et retourné comme le sera l'export, avec le cadre de recadrage. Le cadre vit dans le
// repère de l'image AVANT rotation (celui de ffmpeg) : il tourne avec elle, et les gestes de l'écran y sont ramenés.
// Clavier : flèches = déplacer le cadre, Maj + flèches = le redimensionner.
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { resize, type Corner, type Crop, type Rotation } from "./edit.ts";

interface Props {
  src: string | null;
  poster?: string | null;
  /** Taille affichée de la source (orientation de la source, pixels carrés). */
  frameW: number;
  frameH: number;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  crop: Crop | null;
  /** Rapport largeur/hauteur imposé au cadre DANS L'IMAGE D'ORIGINE (déjà inversé pour un quart de tour), ou null. */
  ratio: number | null;
  showCrop: boolean;
  onCrop(c: Crop): void;
  audioOnly: boolean;
  children?: ReactNode;
  onVideoReady?(v: HTMLVideoElement | null): void;
  onError?(): void;
  /** Clic sur l'image (lecture / pause) et double clic (plein écran), hors recadrage. */
  onFrameClick?(): void;
  onFrameDoubleClick?(): void;
  /** Lueur d'ambiance depuis la planche de vignettes (déjà décodée) : true si elle a pu être dessinée à l'instant t. */
  glowTile?(cv: HTMLCanvasElement, t: number): boolean;
}


export const Stage = forwardRef<HTMLVideoElement, Props>(function Stage(p, videoRef) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLVideoElement | null>(null);
  const glow = useRef<HTMLCanvasElement>(null);
  const calm = useCalm();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const glowRef = useRef(p.glowTile);
  glowRef.current = p.glowTile;
  // Taille de l'image telle que le navigateur l'affiche (rotation des métadonnées, pixels non carrés) : la vidéo elle-
  // même fait foi dès qu'elle est connue ; avant, celle du serveur.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const setRef = useCallback((v: HTMLVideoElement | null) => {
    own.current = v;
    if (typeof videoRef === "function") videoRef(v); else if (videoRef) videoRef.current = v;
    p.onVideoReady?.(v);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = own.current;
    if (!v) return;
    const read = () => { if (v.videoWidth && v.videoHeight) setNatural({ w: v.videoWidth, h: v.videoHeight }); };
    read();
    v.addEventListener("loadedmetadata", read);
    v.addEventListener("resize", read);
    return () => { v.removeEventListener("loadedmetadata", read); v.removeEventListener("resize", read); };
  }, [p.src]);

  // Lumière d'ambiance : l'image courante, très floue et sombre, derrière l'aperçu (une vidéo verticale ne flotte plus
  // dans un grand vide noir). Pendant la lecture, une fois par seconde : réduire une image 1080p prenait ~10 % du fil
  // principal d'un téléphone modeste à quatre passages par seconde (mesuré, processeur ×4). Aux sauts et au glisser d'une
  // poignée, quatre fois par seconde au plus ; aux sauts et aux pauses seulement en mouvement réduit. Le flou est fait
  // DANS la toile de 32 × 18, agrandie en douceur par le navigateur : un filtre CSS sur le grand calque coûtait un quart
  // des images au glisser.
  useEffect(() => {
    const v = own.current, cv = glow.current;
    if (!v || !cv || p.audioOnly) return;
    const g = cv.getContext("2d");
    if (!g) return;
    cv.width = 32; cv.height = 18;
    let last = 0, later = 0, timer = 0;
    const draw = () => {
      last = performance.now();
      // D'abord la vignette de la planche (petite image déjà décodée) ; sinon l'image de la vidéo — copier une image
      // 1080p coûtait jusqu'à 40 ms par copie sur un processeur modeste (mesuré, processeur ×4).
      if (glowRef.current?.(cv, v.currentTime)) { cv.dataset.on = ""; return; }
      if (v.readyState < 2 || v.seeking) return;
      try {
        g.clearRect(0, 0, cv.width, cv.height);
        g.filter = "blur(1.6px) saturate(1.15)"; // sans effet là où le filtre de toile n'existe pas : l'agrandissement adoucit déjà
        g.drawImage(v, 0, 0, cv.width, cv.height);
        cv.dataset.on = "";
      } catch { /* image pas encore décodable */ }
    };
    const soon = () => {
      const wait = 250 - (performance.now() - last);
      if (wait <= 0) draw();
      else if (!later) later = window.setTimeout(() => { later = 0; draw(); }, wait);
    };
    const play = () => { if (!calm && !timer) timer = window.setInterval(soon, 1000); };
    const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } soon(); };
    v.addEventListener("loadeddata", draw);
    v.addEventListener("seeked", soon);
    v.addEventListener("play", play);
    v.addEventListener("pause", stop);
    draw();
    if (!v.paused) play();
    return () => {
      if (timer) window.clearInterval(timer);
      if (later) window.clearTimeout(later);
      v.removeEventListener("loadeddata", draw);
      v.removeEventListener("seeked", soon);
      v.removeEventListener("play", play);
      v.removeEventListener("pause", stop);
    };
  }, [p.src, p.audioOnly, calm]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Taille de l'image à l'écran : elle tient dans la scène une fois tournée.
  const quarter = p.rotate === 90 || p.rotate === 270;
  const fw = Math.max(1, natural?.w ?? p.frameW), fh = Math.max(1, natural?.h ?? p.frameH);
  const scale = size.w && size.h ? Math.min(size.w / (quarter ? fh : fw), size.h / (quarter ? fw : fh)) : 0;
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    el.style.setProperty("--fw", `${fw * scale}px`);
    el.style.setProperty("--fh", `${fh * scale}px`);
    el.style.setProperty("--rot", `${p.rotate}deg`);
    el.style.setProperty("--sx", p.flipH ? "-1" : "1");
    el.style.setProperty("--sy", p.flipV ? "-1" : "1");
  }, [fw, fh, scale, p.rotate, p.flipH, p.flipV]);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el || !p.crop) return;
    el.style.setProperty("--cx", `${p.crop.x * 100}%`);
    el.style.setProperty("--cy", `${p.crop.y * 100}%`);
    el.style.setProperty("--cw", `${p.crop.w * 100}%`);
    el.style.setProperty("--ch", `${p.crop.h * 100}%`);
  }, [p.crop]);

  // Geste de l'écran → repère de l'image (rotation, miroir et échelle annulés).
  const toLocal = useCallback((dx: number, dy: number) => {
    let x = dx, y = dy;
    const a = (-p.rotate * Math.PI) / 180;
    [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    if (p.flipH) x = -x;
    if (p.flipV) y = -y;
    return { x: x / (fw * scale || 1), y: y / (fh * scale || 1) };
  }, [p.rotate, p.flipH, p.flipV, fw, fh, scale]);

  const drag = useRef<{ kind: Corner | "move"; x0: number; y0: number; c0: Crop } | null>(null);
  const begin = (kind: Corner | "move") => (e: RPointerEvent) => {
    if (!p.crop) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    drag.current = { kind, x0: e.clientX, y0: e.clientY, c0: p.crop };
  };
  const move = (e: RPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const { x: dx, y: dy } = toLocal(e.clientX - g.x0, e.clientY - g.y0);
    p.onCrop(resize(g.c0, g.kind, dx, dy, p.ratio, fw / fh));
  };
  const end = () => { drag.current = null; };

  const onKey = (e: KeyboardEvent) => {
    if (!p.crop) return;
    const step = e.altKey ? 0.002 : 0.01;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    p.onCrop(e.shiftKey ? resize(p.crop, "se", k[0]!, k[1]!, p.ratio, fw / fh) : resize(p.crop, "move", k[0]!, k[1]!, null, fw / fh));
  };

  return (
    <div ref={box} className={cn("stage", p.audioOnly && "stage-audio")} data-stage="">
      <canvas ref={glow} className="stage-glow" aria-hidden="true" />
      <div ref={frame} className="stage-frame" onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onClick={(e) => { if (!p.showCrop && e.target === own.current) p.onFrameClick?.(); }}
        onDoubleClick={(e) => { if (!p.showCrop && e.target === own.current) p.onFrameDoubleClick?.(); }} data-frame="">
        {p.src ? (
          <video
            ref={setRef}
            className="stage-video"
            src={p.src}
            poster={p.poster ?? undefined}
            preload="auto"
            playsInline
            onError={p.onError}
            data-video=""
          />
        ) : p.poster ? (
          <img className="stage-video" src={p.poster} alt="" />
        ) : null}
        {!p.showCrop && p.crop && <div className="crop-ghost" aria-hidden="true" data-crop-ghost="" />}
        {p.showCrop && p.crop && (
          <>
            <div className="crop-shade" aria-hidden="true" />
            <div
              className="crop-box"
              role="group"
              tabIndex={0}
              aria-label="Cadre du recadrage : flèches pour le déplacer, Maj et flèches pour le redimensionner"
              onPointerDown={begin("move")}
              onKeyDown={onKey}
              data-crop=""
            >
              <span className="crop-grid" aria-hidden="true" />
              {(["nw", "ne", "sw", "se", "n", "s", "e", "w"] as Corner[]).map((c) => (
                <span key={c} className={`crop-h crop-h-${c}`} onPointerDown={begin(c)} aria-hidden="true" />
              ))}
            </div>
          </>
        )}
      </div>
      {p.children}
    </div>
  );
});
