// Frise de l'éditeur : graduations, vignettes (planche du serveur), forme d'onde, sélection aux poignées d'or, tête de
// lecture, guide d'aimantation, aperçu au survol, barre flottante au-dessus de la sélection.
// Performance (mesurée, docs/OUTILS.md) :
// - les toiles (règle, vignettes, onde terne ; onde dorée) ne couvrent que la partie visible et ne sont redessinées
//   qu'au zoom, au défilement, au redimensionnement ou à l'arrivée des données ; la sélection ne fait que découper la
//   toile dorée (clip-path posé par variables CSS) ;
// - pendant un geste (poignée, déplacement, balayage), RIEN n'est rendu par React : la sélection « vivante »
//   (live.ts) est suivie par variables CSS, la retouche n'est validée qu'au lâcher ;
// - tête de lecture déplacée par le compositeur (translate3d), attributs ARIA changés seulement quand le temps dit change.
// Aimantation : tête de lecture, bords de la sélection, début et fin du média, secondes entières quand le zoom le
// permet ; tolérance de 8 px ; Alt maintenue la suspend. Guide doré et poignée qui « s'enclenche » quand elle s'attache.
// Doigt : poignées de 44 px, pincement pour zoomer ; souris : Ctrl + molette, survol = aperçu de l'image.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import type { Storyboard, Waveform } from "./api.ts";
import { spanLabel, timecode } from "./format.ts";
import { IconFitSel, IconGrip, IconMagnet, IconZoomIn, IconZoomOut } from "./icons.tsx";
import type { Snap, Span, Store } from "./live.ts";
import { ContextZone, Tip, type Entry } from "./menus.tsx";
import { drawTile, hasTiles, sprite as loadSprite } from "./thumbs.ts";

export interface TimelineHandle {
  /** Temps de lecture (appelé à chaque image pendant la lecture). */
  setTime(t: number, follow?: boolean): void;
  zoomToSelection(): void;
  zoomAll(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Rectangle de la sélection à l'écran (départ du glisser vers l'export), ou null. */
  selectionRect(): DOMRect | null;
}

type Edge = "start" | "end" | "move";

interface Props {
  duration: number;
  fps?: number | null;
  live: Store<Span>;
  /** Fin d'un geste (ou poignée au clavier) : la retouche est validée. */
  onCommit(start: number, end: number, edge: Edge): void;
  /** Lecture placée : `drag` = pendant un geste (sauts regroupés), `jump` = saut précis. */
  onSeek(t: number, how: "drag" | "jump"): void;
  onScrub?(active: boolean): void;
  board?: Storyboard | null;
  boardUrl?: string | null;
  wave?: Waveform | null;
  /** « audio » : l'onde occupe toute la frise (outil Audio ou média sans image). */
  mode: "video" | "audio";
  disabled?: boolean;
  /** Sélection trop longue pour l'outil (GIF : 30 s) : signalée sur la frise. */
  over?: boolean;
  magnet: boolean;
  onMagnet(): void;
  /** Barre flottante (actions de la sélection), posée au-dessus de la sélection. */
  toolbar?: ReactNode;
  /** Transport de la sélection vers « Exporter » commencé (poignée de transport, Alt + glisser, double-clic maintenu) :
   *  `from` = rectangle de la sélection à l'écran, d'où part la carte. */
  onExportDrag?(e: RPointerEvent, from: DOMRect): void;
  /** Poignée de transport touchée sans glisser (ou Entrée dessus) : « Envoyer vers Export ». */
  onSend?(): void;
  /** Un transport est en cours (la sélection « se soulève »). */
  transporting?: boolean;
  menu?(target: Element | null, at: number): Entry[];
}

const MIN_SEL = 0.1;
/** Paliers de compactage de la ligne de la barre de la sélection (outils.css « data-fit »). */
const FIT_MAX = 6;
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const SNAP_PX = 8;

export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline(p, ref) {
  const root = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const baseCv = useRef<HTMLCanvasElement>(null);
  const goldCv = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const float = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  // Compactage de la ligne « barre de la sélection + outils » : niveau 0 (tout) à FIT_MAX (le secondaire effacé,
  // outils.css « data-fit »).
  const fit = useRef({ level: 0, raf: 0 });
  const hover = useRef<HTMLDivElement>(null);
  const hoverCv = useRef<HTMLCanvasElement>(null);
  const hoverTime = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const lenLabel = useRef<HTMLSpanElement>(null);
  const sprite = useRef<HTMLImageElement | null>(null);
  const menuX = useRef<number | null>(null);
  const time = useRef(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [width, setWidth] = useState(0);
  const raf = useRef(0);
  const d = Math.max(0.001, p.duration);
  const maxZoom = Math.max(1, Math.min(64, d / 1.5));
  const props = useRef(p);
  props.current = p;
  /** Largeur, bord gauche à l'écran et défilement de la fenêtre de la frise, relus au redimensionnement et au
   *  défilement seulement. */
  const geo = useRef({ w: 0, left: 0, scroll: 0, rootLeft: 0, rootW: 0 });
  const remember = () => {
    const vp = viewport.current, rt = root.current;
    if (!vp || !rt) return;
    const r = vp.getBoundingClientRect(), r0 = rt.getBoundingClientRect();
    geo.current = { w: vp.clientWidth, left: r.left, scroll: vp.scrollLeft, rootLeft: r0.left, rootW: r0.width };
  };
  const scrollTo = (x: number) => {
    const vp = viewport.current;
    if (!vp) return;
    vp.scrollLeft = x;
    geo.current.scroll = vp.scrollLeft;
  };

  // ---- dessin des toiles (partie visible seulement ; jamais à cause de la sélection) ------------------------------
  const draw = useCallback(() => {
    raf.current = 0;
    const vp = viewport.current, bc = baseCv.current, gc = goldCv.current, rc = ruler.current;
    if (!vp || !bc || !gc || !rc) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = geo.current.w || vp.clientWidth;
    const total = w * zoomRef.current;
    const left = geo.current.scroll;
    const t0 = (left / total) * d, t1 = ((left + w) / total) * d;
    const pxPerS = total / d;
    const { board: b, wave, mode } = props.current;
    // Règle : graduations lisibles (72 px au moins entre deux étiquettes).
    const rh = rc.clientHeight;
    rc.width = Math.round(w * dpr); rc.height = Math.round(rh * dpr);
    const r = rc.getContext("2d");
    if (r) {
      r.setTransform(dpr, 0, 0, dpr, 0, 0);
      r.clearRect(0, 0, w, rh);
      const step = STEPS.find((s) => s * pxPerS >= 72) ?? 3600;
      const minor = step / 5;
      r.fillStyle = "rgba(179,169,153,0.55)";
      for (let t = Math.floor(t0 / minor) * minor; t <= t1 + minor; t += minor) {
        const x = (t / d) * total - left;
        if (x < -1 || x > w + 1) continue;
        const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
        r.fillRect(Math.round(x), major ? rh - 9 : rh - 5, 1, major ? 9 : 5);
      }
      r.fillStyle = "rgba(179,169,153,0.95)";
      r.font = "500 10.5px 'Inter Variable', system-ui, sans-serif";
      r.textBaseline = "top";
      for (let t = Math.floor(t0 / step) * step; t <= t1 + step; t += step) {
        const x = (t / d) * total - left;
        if (x < -40 || x > w + 4 || t < 0 || t > d + 1e-6) continue;
        r.fillText(timecode(t, step < 1 ? 1 : 0), Math.round(x) + 4, 1);
      }
    }
    const fh = bc.clientHeight;
    for (const cv of [bc, gc]) { cv.width = Math.round(w * dpr); cv.height = Math.round(fh * dpr); }
    const g = bc.getContext("2d"), gg = gc.getContext("2d");
    if (!g || !gg) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); gg.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, fh); gg.clearRect(0, 0, w, fh);
    const audioMode = mode === "audio";
    const waveH = audioMode ? fh : wave?.count ? 18 : 0;
    const thumbH = audioMode ? 0 : fh - waveH;
    const img = sprite.current;
    if (thumbH > 0) {
      g.fillStyle = "#18181a";
      g.fillRect(0, 0, w, thumbH);
      if (hasTiles(b) && img?.complete && img.naturalWidth) {
        const tw = Math.max(24, (thumbH * b.tile_w) / b.tile_h);
        const firstSlot = Math.floor(left / tw);
        for (let k = firstSlot; k * tw < left + w; k++) {
          const tMid = ((k + 0.5) * tw / total) * d;
          const idx = Math.min(b.count - 1, Math.max(0, Math.floor(tMid / b.interval_s)));
          const sx = (idx % b.cols) * b.tile_w, sy = Math.floor(idx / b.cols) * b.tile_h;
          g.drawImage(img, sx, sy, b.tile_w, b.tile_h, Math.round(k * tw - left), 0, Math.ceil(tw), thumbH);
        }
        g.fillStyle = "rgba(15,15,16,0.55)";
        for (let k = firstSlot; k * tw < left + w; k++) g.fillRect(Math.round(k * tw - left), 0, 1, thumbH);
      }
    }
    const peaks = wave?.peaks;
    if (waveH > 0 && peaks?.length) {
      const top = thumbH, mid = top + waveH / 2;
      let max = 1;
      for (const v of peaks) if (v > max) max = v;
      // Son : barres fines arrondies ; terne sur la toile de fond, dorée (feuille d'or) sur la toile découpée par la
      // sélection.
      const step = audioMode ? 3 : 1, bar = audioMode ? 2 : 1;
      const gold = gg.createLinearGradient(0, mid - waveH / 2, 0, mid + waveH / 2);
      gold.addColorStop(0, "#e3cda6"); gold.addColorStop(0.5, "#b8925f"); gold.addColorStop(1, "#e3cda6");
      g.fillStyle = audioMode ? "rgba(179,169,153,0.34)" : "rgba(179,169,153,0.45)";
      gg.fillStyle = audioMode ? gold : "rgba(227,205,166,0.9)";
      const round = audioMode && typeof g.roundRect === "function";
      if (round) { g.beginPath(); gg.beginPath(); }
      for (let x = 0; x < w; x += step) {
        const a = Math.floor(((left + x) / total) * peaks.length);
        const z = Math.max(a + 1, Math.floor(((left + x + step) / total) * peaks.length));
        let v = 0;
        for (let i = a; i < z && i < peaks.length; i++) if (peaks[i]! > v) v = peaks[i]!;
        const amp = Math.max(1, Math.pow(v / max, 0.7) * (waveH / 2 - 3));
        if (round) { g.roundRect(x, mid - amp, bar, amp * 2, 1); gg.roundRect(x, mid - amp, bar, amp * 2, 1); }
        else { g.fillRect(x, mid - amp, bar, Math.max(1, amp * 2)); gg.fillRect(x, mid - amp, bar, Math.max(1, amp * 2)); }
      }
      if (round) { g.fill(); gg.fill(); }
    }
    place();
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useRef(draw);
  latest.current = draw;
  const queue = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(() => latest.current());
  }, []);
  useEffect(() => { queue(); }, [draw, queue, zoom, p.board, p.wave, p.mode, width]);

  useEffect(() => {
    sprite.current = loadSprite(p.boardUrl, () => queue());
    queue();
  }, [p.boardUrl, queue]);

  // ---- positions : sélection, découpe dorée, barre flottante (hors de React) -------------------------------------
  const floatBox = useRef({ w: 0, toolsLeft: 0 });
  // La barre et les outils ne doivent jamais se recouvrir : on part du niveau 0 et on efface un palier de plus tant
  // qu'ils ne tiennent pas côte à côte avec 16 px de réserve (un temps qui s'allonge pendant un geste). Pendant un
  // geste, on ne fait qu'effacer, jamais réapparaître. Hors d'un rendu React, une fois par image au plus ; la ligne est
  // confinée (contain), chaque essai ne recalcule qu'elle.
  const adjustFit = useCallback(() => {
    const s = fit.current;
    s.raf = 0;
    const r = row.current, f = float.current, tl = tools.current;
    if (!r || !f || !tl) return;
    const apply = (level: number) => {
      s.level = level;
      if (level) r.dataset.fit = Array.from({ length: level }, (_, i) => i + 1).join(" "); else delete r.dataset.fit;
    };
    const fits = () => f.offsetWidth + tl.offsetWidth + 12 + 16 <= r.clientWidth;
    if (!props.current.live.get().gesture && s.level) apply(0);
    while (!fits() && s.level < FIT_MAX) apply(s.level + 1);
  }, []);
  const scheduleFit = useCallback(() => { if (!fit.current.raf) fit.current.raf = requestAnimationFrame(adjustFit); }, [adjustFit]);
  const place = useCallback(() => {
    const el = content.current, st = stack.current, vp = viewport.current;
    if (!el || !st || !vp) return;
    const { start, end, gesture } = props.current.live.get();
    if (!gesture) scheduleFit();
    const z = zoomRef.current;
    const vw = geo.current.w;
    if (!vw) return;
    const total = vw * z;
    el.style.setProperty("--tl-a", `${(start / d) * 100}%`);
    el.style.setProperty("--tl-b", `${(end / d) * 100}%`);
    const x0 = (start / d) * total - geo.current.scroll, x1 = (end / d) * total - geo.current.scroll;
    st.style.setProperty("--sel-x0", `${Math.max(0, x0)}px`);
    st.style.setProperty("--sel-x1", `${Math.min(vw, Math.max(0, x1))}px`);
    // Sélection trop étroite pour sa durée entre les poignées : l'étiquette passe à côté.
    const px = x1 - x0;
    const narrow = total > 0 && px < 84;
    el.classList.toggle("is-narrow", narrow);
    el.classList.toggle("is-narrow-left", narrow && x1 > vw - 64);
    if (lenLabel.current) lenLabel.current.textContent = spanLabel(end - start);
    if (bubble.current) {
      bubble.current.textContent = timecode(gesture === "start" ? start : end, 2);
      bubble.current.dataset.edge = gesture === "start" ? "start" : gesture === "end" ? "end" : "";
    }
    // Barre flottante : centrée sur la sélection, gardée dans la largeur utile, 8 px avant les outils de droite (quand la
    // frise est étroite, les deux se compactent par paliers, outils.css « tlrow » : ils ne se recouvrent jamais).
    const f = float.current;
    if (f) {
      const fw = floatBox.current.w || f.offsetWidth;
      const limit = (floatBox.current.toolsLeft || geo.current.rootW || vw) - 8;
      const cx = (x0 + x1) / 2 + (geo.current.left - geo.current.rootLeft);
      const x = Math.max(2, Math.min(limit - fw, cx - fw / 2));
      f.style.transform = `translate3d(${Math.round(x)}px,0,0)`;
      if (x1 < 0 || x0 > vw) f.dataset.offscreen = ""; else delete f.dataset.offscreen;
    }
    // Valeurs dites par les poignées (lecteurs d'écran), suivies aussi pendant le geste.
    for (const h of el.querySelectorAll<HTMLElement>("[data-handle]")) {
      const v = h.dataset.handle === "start" ? start : end;
      const label = timecode(v);
      if (h.getAttribute("aria-valuetext") !== label) { h.setAttribute("aria-valuenow", v.toFixed(2)); h.setAttribute("aria-valuetext", label); }
    }
  }, [d, scheduleFit]);

  useEffect(() => props.current.live.subscribe(place), [p.live, place]);
  useLayoutEffect(() => { place(); }, [place, zoom, width]);

  useEffect(() => {
    const vp = viewport.current, f = float.current, tl = tools.current, rt = root.current;
    if (!vp || !rt) return;
    const measure = () => {
      remember();
      setWidth(geo.current.w);
      floatBox.current = { w: f?.offsetWidth ?? 0, toolsLeft: tl ? tl.getBoundingClientRect().left - geo.current.rootLeft : geo.current.rootW };
      queue();
      place();
      scheduleFit();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    if (f) ro.observe(f);
    if (tl) ro.observe(tl);
    const onScroll = () => { geo.current.scroll = vp.scrollLeft; queue(); place(); };
    // La page bouge (fenêtre, panneau replié, plein écran) : le bord gauche de la frise est relu.
    const onWin = () => remember();
    vp.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onWin);
    document.addEventListener("fullscreenchange", onWin);
    return () => {
      ro.disconnect(); vp.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onWin); document.removeEventListener("fullscreenchange", onWin);
      if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0;
      cancelAnimationFrame(fit.current.raf); fit.current.raf = 0;
    };
  }, [queue, place, scheduleFit]);
  useLayoutEffect(() => { adjustFit(); }, [adjustFit]);

  // Tête de lecture appelée à chaque image pendant la lecture : déplacée par le compositeur (translate3d).
  const placeHead = useCallback((t: number) => {
    const h = head.current;
    if (!h) return;
    h.style.transform = `translate3d(${(Math.min(d, Math.max(0, t)) / d) * geo.current.w * zoomRef.current}px,0,0)`;
    const label = timecode(t);
    if (h.getAttribute("aria-valuetext") !== label) {
      h.setAttribute("aria-valuenow", t.toFixed(2));
      h.setAttribute("aria-valuetext", label);
    }
  }, [d]);
  useLayoutEffect(() => { placeHead(time.current); }, [placeHead, zoom, width]);

  // ---- zoom autour d'un point --------------------------------------------------------------------------------------
  const zoomTo = useCallback((next: number, anchorX?: number, focusT?: number) => {
    const vp = viewport.current;
    const z = Math.min(maxZoom, Math.max(1, next));
    if (!vp) { setZoom(z); return; }
    const w = geo.current.w || vp.clientWidth;
    const ax = anchorX ?? w / 2;
    const t = focusT ?? ((geo.current.scroll + ax) / (w * zoomRef.current)) * d;
    zoomRef.current = z;
    setZoom(z);
    requestAnimationFrame(() => { scrollTo((t / d) * w * z - ax); queue(); place(); });
  }, [d, maxZoom, queue, place]);

  useImperativeHandle(ref, () => ({
    setTime(t: number, follow = false) {
      time.current = t;
      placeHead(t);
      const { w, scroll } = geo.current;
      if (follow && zoomRef.current > 1) {
        const x = (t / d) * w * zoomRef.current;
        if (x < scroll + 24 || x > scroll + w - 24) scrollTo(x - w * 0.2);
      }
    },
    zoomToSelection() {
      const vp = viewport.current;
      if (!vp) return;
      const { start, end } = props.current.live.get();
      const len = Math.max(MIN_SEL, end - start);
      // La sélection occupe 80 % de la largeur, centrée.
      zoomTo(d / (len / 0.8), geo.current.w / 2, (start + end) / 2);
    },
    zoomAll() { zoomTo(1); },
    zoomIn() { zoomTo(zoomRef.current * 1.6); },
    zoomOut() { zoomTo(zoomRef.current / 1.6); },
    selectionRect() {
      const sel = content.current?.querySelector<HTMLElement>("[data-selection]");
      return sel ? sel.getBoundingClientRect() : null;
    },
  }), [d, placeHead, zoomTo]);

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.0025), e.clientX - geo.current.left);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // ---- aimantation ---------------------------------------------------------------------------------------------------
  const guide = useRef<HTMLDivElement>(null);
  const snapped = useRef<Snap | null>(null);
  const showSnap = (s: Snap | null, edge: Edge | "seek" | null) => {
    const g = guide.current, el = content.current;
    if (!g || !el) return;
    const was = snapped.current;
    snapped.current = s;
    if (s) {
      el.style.setProperty("--tl-g", `${(s.t / d) * 100}%`);
      g.dataset.on = "";
      g.dataset.what = s.what;
    } else delete g.dataset.on;
    // La poignée « s'enclenche » une fois, à l'attache (et le doigt la sent, quand l'appareil le permet).
    if (s && (!was || Math.abs(was.t - s.t) > 1e-6)) {
      const h = edge === "start" || edge === "end" ? el.querySelector<HTMLElement>(`[data-handle=${edge}]`) : null;
      if (h) { h.classList.remove("is-snap"); void h.offsetWidth; h.classList.add("is-snap"); }
      if (pointerKind.current === "touch" && navigator.vibrate) try { navigator.vibrate(6); } catch { /* sans vibreur */ }
    }
  };
  const fps = p.fps && p.fps > 0 && p.fps < 241 ? p.fps : null;
  const quantize = (t: number) => (fps ? Math.round(t * fps) / fps : t);
  /** Temps aimanté pour un geste : cibles possibles selon ce qu'on tire ; Alt suspend l'aimant. */
  const snapTime = (t: number, kind: Edge | "seek", free: boolean): { t: number; snap: Snap | null } => {
    const vp = viewport.current;
    // La tête de lecture suit la poignée pendant qu'on la tire : on s'attache à sa place du DÉBUT du geste.
    const ph = drag.current?.playhead ?? time.current;
    const { start, end } = props.current.live.get();
    if (!vp || !props.current.magnet || free) return { t: quantize(t), snap: null };
    const pxPerS = (geo.current.w * zoomRef.current) / d;
    const tol = SNAP_PX / pxPerS;
    const cands: Snap[] = [{ t: 0, what: "media-start" }, { t: d, what: "media-end" }];
    if (kind !== "seek") cands.push({ t: ph, what: "playhead" });
    if (kind === "seek") cands.push({ t: start, what: "start" }, { t: end, what: "end" });
    if (pxPerS >= 48) {
      const s = Math.round(t);
      if (s >= 0 && s <= d) cands.push({ t: s, what: "second" });
    }
    let best: Snap | null = null;
    for (const c of cands) if (Math.abs(c.t - t) <= tol && (!best || Math.abs(c.t - t) < Math.abs(best.t - t))) best = c;
    return best ? { t: best.t, snap: best } : { t: quantize(t), snap: null };
  };

  // ---- gestes : une seule intention par geste ------------------------------------------------------------------------
  // seek       frise vide ou tête de lecture : placer la lecture (tout de suite, puis en suivant le pointeur) ;
  // start/end  poignées : régler le début ou la fin ;
  // move       corps de la sélection : la déplacer (même durée), décidé après 4 px (8 au doigt) ; relâché avant, c'est un
  //            clic : la tête de lecture y va ;
  // transport  porter la sélection vers « Exporter » : poignée de transport (au-dessus de la sélection, ou dans la barre
  //            flottante), Alt + glisser, ou double-clic maintenu sur la sélection ; décidé après 4 px. Pendant le
  //            transport la frise ne bouge plus du tout : ni lecture, ni sélection, ni défilement (la carte et le dépôt
  //            sont à DragExport) ; les temps ne changent JAMAIS.
  // Le geste est verrouillé dès que son intention est connue (pointeur capturé) ; Échap, perte du focus de la fenêtre,
  // pointeur annulé ou perdu, menu contextuel : annulé, la sélection revient où elle était.
  const timeAt = (clientX: number) => {
    const { left, scroll, w } = geo.current;
    return Math.min(d, Math.max(0, ((clientX - left + scroll) / (Math.max(1, w) * zoomRef.current)) * d));
  };
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const pointerKind = useRef<string>("mouse");
  type Mode = "seek" | "start" | "end" | "move" | "transport" | "pending-move" | "pending-transport";
  interface Gesture {
    mode: Mode; pointerId: number; x0: number; y0: number; offset: number; length: number;
    /** Sélection et tête de lecture au début du geste : l'annulation y revient, l'aimant s'attache à la tête d'alors. */
    start: number; end: number; playhead: number;
    /** Commencé sur la poignée de transport : relâché sans bouger, c'est « Envoyer vers Export ». */
    grip: boolean;
    /** Instant de l'appui (un clic long ne compte pas comme premier clic d'un double-clic). */
    t0: number;
  }
  const drag = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState<Edge | "seek" | null>(null);
  /** Dernier clic BREF sur la sélection : un second appui tout près, dans les 400 ms, est un double-clic maintenu
   *  (transport), même s'il tombe sur la tête de lecture que ce premier clic vient d'amener sous le pointeur. */
  const lastClick = useRef({ t: -1e9, x: 0, y: 0 });
  const unlisten = useRef<(() => void) | null>(null);

  const setLive = (start: number, end: number, gesture: Edge | null) => props.current.live.set({ start, end, gesture });

  /** Fin du geste en cours, quelle qu'elle soit : écouteurs retirés, guide et état effacés. */
  const finish = () => {
    drag.current = null;
    unlisten.current?.();
    unlisten.current = null;
    showSnap(null, null);
    setDragging(null);
  };
  /** Annulation : la sélection revient où elle était, rien n'est validé. */
  const cancel = () => {
    const g = drag.current;
    if (!g) return;
    if (g.mode === "move" || g.mode === "start" || g.mode === "end") setLive(g.start, g.end, null);
    const scrubbing = g.mode === "seek" || g.mode === "move" || g.mode === "start" || g.mode === "end";
    finish();
    if (scrubbing) props.current.onScrub?.(false);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => () => { unlisten.current?.(); }, []);

  const begin = (kind: "seek" | "start" | "end" | "move" | "grip") => (e: RPointerEvent) => {
    if (p.disabled || e.button > 0) return;
    pointerKind.current = e.pointerType;
    pointers.current.set(e.pointerId, e.clientX);
    if (pointers.current.size === 2 && e.pointerType === "touch") {
      // Deuxième doigt : pincement pour zoomer ; le geste du premier est annulé (sauf un transport déjà parti).
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.abs(a! - b!), zoom: zoomRef.current };
      if (drag.current?.mode !== "transport") cancel();
      return;
    }
    if (drag.current) return; // un seul geste à la fois
    // Poignées, sélection, poignée de transport : rien plus haut ne réagit (pas de saut de lecture dessous).
    if (kind !== "seek") e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    hideHover();
    const t = timeAt(e.clientX);
    const { start, end } = props.current.live.get();
    let mode: Mode = kind === "grip" ? "pending-transport" : kind;
    const lc = lastClick.current;
    const second = (kind === "move" || kind === "seek") && performance.now() - lc.t < 400 && Math.hypot(e.clientX - lc.x, e.clientY - lc.y) < 10;
    lastClick.current.t = -1e9;
    if (second) mode = "pending-transport";
    else if (kind === "move") mode = e.altKey ? "pending-transport" : "pending-move";
    drag.current = { mode, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, offset: t - start, length: end - start, start, end, playhead: time.current, grip: kind === "grip", t0: performance.now() };
    // Échap, fenêtre quittée, menu contextuel : le geste s'annule.
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape" || !drag.current || drag.current.mode === "transport") return;
      ev.preventDefault(); ev.stopPropagation();
      cancelRef.current();
    };
    const onBlur = () => { if (drag.current && drag.current.mode !== "transport") cancelRef.current(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    unlisten.current = () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", onBlur); };
    if (mode === "seek") { const s = snapTime(t, "seek", e.altKey); showSnap(s.snap, "seek"); p.onSeek(s.t, "drag"); }
    if (mode === "seek" || mode === "start" || mode === "end") { setDragging(mode); p.onScrub?.(true); }
  };
  const moveDrag = (e: RPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(1, Math.abs(a! - b!));
      zoomTo(pinch.current.zoom * (dist / Math.max(1, pinch.current.dist)), (a! + b!) / 2 - geo.current.left);
      return;
    }
    const g = drag.current;
    if (!g || e.pointerId !== g.pointerId) { if (!g && e.pointerType === "mouse") showHover(e.clientX); return; }
    if (g.mode === "transport") return; // la frise reste immobile : la carte suit le pointeur (DragExport)
    const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (g.mode === "pending-transport") {
      if (dist < 4) return;
      g.mode = "transport";
      const from = content.current?.querySelector<HTMLElement>("[data-selection]")?.getBoundingClientRect() ?? new DOMRect(e.clientX - 40, e.clientY - 20, 80, 40);
      p.onExportDrag?.(e, from);
      return;
    }
    if (g.mode === "pending-move") {
      if (dist < (e.pointerType === "touch" ? 8 : 4)) return;
      g.mode = "move";
      setDragging("move");
      p.onScrub?.(true);
    }
    // Bords : la frise défile toute seule pendant qu'on tire.
    const { left: gl, w: gw, scroll: gs } = geo.current;
    if (zoomRef.current > 1 && e.clientX < gl + 24) scrollTo(gs - 12);
    if (zoomRef.current > 1 && e.clientX > gl + gw - 24) scrollTo(gs + 12);
    const raw = timeAt(e.clientX);
    if (g.mode === "seek") { const s = snapTime(raw, "seek", e.altKey); showSnap(s.snap, "seek"); p.onSeek(s.t, "drag"); return; }
    const { start, end } = props.current.live.get();
    if (g.mode === "start") {
      const s = snapTime(raw, "start", e.altKey);
      const v = Math.max(0, Math.min(s.t, end - MIN_SEL));
      showSnap(s.snap && Math.abs(v - s.t) < 1e-6 ? s.snap : null, "start");
      setLive(v, end, "start");
      p.onSeek(v, "drag");
      return;
    }
    if (g.mode === "end") {
      const s = snapTime(raw, "end", e.altKey);
      const v = Math.min(d, Math.max(s.t, start + MIN_SEL));
      showSnap(s.snap && Math.abs(v - s.t) < 1e-6 ? s.snap : null, "end");
      setLive(start, v, "end");
      p.onSeek(v, "drag");
      return;
    }
    // Déplacement de la sélection (même durée), aimant sur le bord le plus proche d'une cible.
    const len = g.length;
    let s0 = Math.min(d - len, Math.max(0, raw - g.offset));
    const a = snapTime(s0, "move", e.altKey), b = snapTime(s0 + len, "move", e.altKey);
    let snap: Snap | null = null;
    if (a.snap && (!b.snap || Math.abs(a.t - s0) <= Math.abs(b.t - (s0 + len)))) { s0 = a.t; snap = a.snap; }
    else if (b.snap) { s0 = b.t - len; snap = b.snap; }
    else s0 = a.t;
    s0 = Math.min(d - len, Math.max(0, s0));
    showSnap(snap, "move");
    setLive(s0, s0 + len, "move");
  };
  const endDrag = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = drag.current;
    if (!g || e.pointerId !== g.pointerId) return;
    finish();
    switch (g.mode) {
      case "transport": return; // dépôt ou retour : DragExport ; les temps n'ont pas bougé
      case "pending-transport":
        // Poignée de transport touchée sans glisser : « Envoyer vers Export » ; double-clic sans glisser : un clic.
        if (g.grip) p.onSend?.(); else p.onSeek(timeAt(g.x0), "jump");
        return;
      case "pending-move":
        if (performance.now() - g.t0 < 300) lastClick.current = { t: performance.now(), x: g.x0, y: g.y0 };
        p.onSeek(timeAt(g.x0), "jump"); // simple clic : la tête y va
        return;
      case "seek":
        p.onSeek(time.current, "jump");
        break;
      default: {
        const { start, end } = props.current.live.get();
        setLive(start, end, null);
        if (Math.abs(start - g.start) > 1e-6 || Math.abs(end - g.end) > 1e-6) p.onCommit(start, end, g.mode as Edge);
        if (g.mode !== "move") p.onSeek(g.mode === "start" ? start : end, "jump");
      }
    }
    p.onScrub?.(false);
  };
  /** Pointeur annulé par le système ou capture perdue avant le lâcher : rien n'est validé. */
  const lostDrag = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = drag.current;
    if (!g || e.pointerId !== g.pointerId || g.mode === "transport") return;
    cancel();
  };

  // ---- aperçu au survol (souris) -----------------------------------------------------------------------------------
  const showHover = (clientX: number) => {
    const h = hover.current;
    if (!h || p.disabled) return;
    const t = timeAt(clientX);
    const { rootLeft, rootW } = geo.current;
    const x = clientX - rootLeft;
    const w = 168;
    h.style.transform = `translate3d(${Math.round(Math.max(4, Math.min(rootW - w - 4, x - w / 2)))}px,0,0)`;
    content.current?.style.setProperty("--tl-h", `${(t / d) * 100}%`);
    if (hoverTime.current) hoverTime.current.textContent = timecode(t, 2);
    const img = hoverCv.current ? drawTile(hoverCv.current, props.current.board, sprite.current, t, { w: 168, h: 94 }) : false;
    if (img) h.dataset.thumb = ""; else delete h.dataset.thumb;
    h.dataset.on = "";
    content.current?.setAttribute("data-hovering", "");
  };
  const hideHover = () => {
    if (hover.current) delete hover.current.dataset.on;
    content.current?.removeAttribute("data-hovering");
  };

  // ---- clavier ------------------------------------------------------------------------------------------------------
  const frame = fps ? 1 / fps : 0.1;
  const keyStep = (e: KeyboardEvent) => {
    if (e.key === "PageUp") return 10;
    if (e.key === "PageDown") return -10;
    const unit = e.shiftKey ? 1 : frame;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") return unit;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") return -unit;
    return 0;
  };
  const onHandleKey = (edge: "start" | "end") => (e: KeyboardEvent) => {
    if (p.disabled) return;
    let { start: s, end: en } = props.current.live.get();
    if (e.key === "Home") { if (edge === "start") s = 0; else en = s + MIN_SEL; }
    else if (e.key === "End") { if (edge === "start") s = en - MIN_SEL; else en = d; }
    else {
      const step = keyStep(e);
      if (!step) return;
      if (edge === "start") s = Math.min(en - MIN_SEL, Math.max(0, s + step));
      else en = Math.max(s + MIN_SEL, Math.min(d, en + step));
    }
    e.preventDefault();
    setLive(s, en, null);
    p.onCommit(s, en, edge);
    p.onSeek(edge === "start" ? s : en, "jump");
  };
  const onHeadKey = (e: KeyboardEvent) => {
    let t = time.current;
    if (e.key === "Home") t = 0;
    else if (e.key === "End") t = d;
    else { const step = keyStep(e); if (!step) return; t = Math.min(d, Math.max(0, t + step)); }
    e.preventDefault();
    p.onSeek(t, "jump");
  };

  const zoomLabel = useMemo(() => (zoom < 1.05 ? "Tout" : `×${zoom < 10 ? zoom.toFixed(1).replace(".", ",") : Math.round(zoom)}`), [zoom]);
  const sel = p.live.get();

  return (
    <div ref={root} className={cn("tl", p.mode === "audio" && "tl-audio", p.disabled && "tl-disabled", p.over && "tl-over", dragging && `is-${dragging}`, p.transporting && "is-transport")}
      data-timeline="" data-width={width} data-magnet={p.magnet || undefined}>
      <div ref={row} className="tl-row">
        <div ref={float} className="tl-float" data-float="">{p.toolbar}</div>
        <div ref={tools} className="tl-tools" role="group" aria-label="Frise">
          <Tip label={p.magnet ? "Aimantation activée" : "Aimantation désactivée"} keys={["N"]}>
            <button type="button" className={cn("tl-zbtn tl-magnet", p.magnet && "is-on")} onClick={p.onMagnet} aria-pressed={p.magnet} aria-label="Aimantation" data-magnet-toggle="">
              <IconMagnet size={17} />
            </button>
          </Tip>
          <span className="tl-sepv" aria-hidden="true" />
          <Tip label="Dézoomer" keys={["−"]}>
            <button type="button" className="tl-zbtn" onClick={() => zoomTo(zoom / 1.6)} disabled={zoom <= 1} aria-label="Dézoomer" data-zoom-out=""><IconZoomOut size={17} /></button>
          </Tip>
          <input type="range" className="tl-zrange" min={0} max={100} step={1} aria-label="Zoom de la frise"
            value={Math.round((Math.log(zoom) / Math.log(maxZoom || 1.0001)) * 100) || 0}
            onChange={(e) => zoomTo(Math.exp((Number(e.target.value) / 100) * Math.log(maxZoom)))} disabled={maxZoom <= 1} />
          <Tip label="Zoomer" keys={["+"]}>
            <button type="button" className="tl-zbtn" onClick={() => zoomTo(zoom * 1.6)} disabled={zoom >= maxZoom} aria-label="Zoomer" data-zoom-in=""><IconZoomIn size={17} /></button>
          </Tip>
          <Tip label="Zoom sur la sélection" keys={["Z"]}>
            <button type="button" className="tl-zbtn" onClick={() => { const { start, end } = props.current.live.get(); zoomTo(d / (Math.max(MIN_SEL, end - start) / 0.8), undefined, (start + end) / 2); }}
              disabled={maxZoom <= 1} aria-label="Zoom sur la sélection" data-zoom-sel=""><IconFitSel size={17} /></button>
          </Tip>
          <Tip label="Toute la durée" keys={["Maj+Z"]}>
            <button type="button" className="tl-zfit tabular" onClick={() => zoomTo(1)} disabled={zoom <= 1} data-zoom-fit="">{zoomLabel}</button>
          </Tip>
        </div>
      </div>
      <ContextZone label="Menu de la frise" entries={(target) => p.menu?.(target, hoverAt(target)) ?? []} disabled={!p.menu || p.disabled}>
        <div ref={stack} className="tl-stack" onContextMenuCapture={(e) => { menuX.current = e.clientX; if (drag.current && drag.current.mode !== "transport") cancel(); }}>
          <canvas ref={ruler} className="tl-ruler" aria-hidden="true" />
          <canvas ref={baseCv} className="tl-canvas" aria-hidden="true" />
          <canvas ref={goldCv} className="tl-canvas tl-gold" aria-hidden="true" />
          <div className="tl-viewport" ref={viewport} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={lostDrag} onLostPointerCapture={lostDrag}
            onPointerLeave={(e) => { if (e.pointerType === "mouse") hideHover(); }}>
            <div ref={content} className="tl-content" onPointerDown={begin("seek")} data-zoom={zoom} data-scrub="">
              <div className="tl-dim tl-dim-a" aria-hidden="true" />
              <div className="tl-dim tl-dim-b" aria-hidden="true" />
              <div className={cn("tl-sel", dragging === "move" && "is-active")} onPointerDown={begin("move")} aria-hidden="true" data-selection="">
                <span ref={lenLabel} className="tl-sel-len">{spanLabel(sel.end - sel.start)}</span>
              </div>
              {p.onExportDrag && (
                <Tip label="Glisser vers « Exporter »" keys={["E"]}>
                  <button type="button" className="tl-carry" onPointerDown={begin("grip")} disabled={p.disabled}
                    onClick={(e) => { if (e.detail === 0) p.onSend?.(); }} aria-label="Envoyer la sélection vers l'export" data-carry="">
                    <IconGrip size={14} />
                  </button>
                </Tip>
              )}
              <div ref={guide} className="tl-guide" aria-hidden="true" />
              <div className="tl-hoverline" aria-hidden="true" />
              {(["start", "end"] as const).map((edge) => (
                <div
                  key={edge}
                  role="slider"
                  tabIndex={p.disabled ? -1 : 0}
                  aria-label={edge === "start" ? "Début de la sélection" : "Fin de la sélection"}
                  aria-valuemin={0}
                  aria-valuemax={Number(d.toFixed(2))}
                  aria-valuenow={Number((edge === "start" ? sel.start : sel.end).toFixed(2))}
                  aria-valuetext={timecode(edge === "start" ? sel.start : sel.end)}
                  aria-disabled={p.disabled || undefined}
                  className={cn("tl-handle", edge === "start" ? "tl-handle-a" : "tl-handle-b", dragging === edge && "is-active")}
                  onPointerDown={begin(edge)}
                  onKeyDown={onHandleKey(edge)}
                  onAnimationEnd={(e) => e.currentTarget.classList.remove("is-snap")}
                  data-handle={edge}
                >
                  <span className="tl-grip" aria-hidden="true" />
                </div>
              ))}
              <div
                ref={head}
                role="slider"
                tabIndex={0}
                aria-label="Position de lecture"
                aria-valuemin={0}
                aria-valuemax={Number(d.toFixed(2))}
                aria-valuenow={0}
                aria-valuetext={timecode(0)}
                className="tl-head"
                onKeyDown={onHeadKey}
                onPointerDown={begin("seek")}
                data-playhead=""
              />
              <div ref={bubble} className="tl-bubble" aria-hidden="true" />
            </div>
          </div>
        </div>
      </ContextZone>
      <div ref={hover} className="tl-hover" aria-hidden="true">
        <canvas ref={hoverCv} className="tl-hover-cv" />
        <span ref={hoverTime} className="tl-hover-time tabular" />
      </div>
    </div>
  );

  /** Temps sous le pointeur au moment du menu (pour « Placer la tête ici », « Début ici »…). */
  function hoverAt(target: Element | null): number {
    void target;
    return menuX.current !== null && viewport.current ? timeAt(menuX.current) : time.current;
  }
});
