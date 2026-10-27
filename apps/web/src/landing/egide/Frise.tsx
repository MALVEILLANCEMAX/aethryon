// Frise d'extrait (DESIGN_SYSTEM.md § 10) : deux poignées (sliders accessibles), tête de lecture, ombre hors sélection.
// Manipulation directe : la poignée suit le pointeur (capture, décalage de saisie respecté), positions écrites par CSSOM
// (transform seulement, jamais d'attribut style ni d'état React par image). Clavier : flèches ±1 s, Maj ±10 s,
// Début / Fin. Pour le récit de la démonstration : `glisser()` (≈ 1 s, courbe de déplacement), instantané si le
// mouvement est réduit.
import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEvent, type PointerEvent as PointerEventR } from "react";
import { tcParle } from "./format.ts";

export interface FriseApi {
  set(a: number, b: number): void;
  glisser(a: number, b: number, ms?: number): Promise<void>;
}

export const Frise = forwardRef<FriseApi, {
  duree: number; debut: number; fin: number; lecture?: number; etiquette: string; reduit: boolean;
  onChange: (a: number, b: number) => void;
}>(function Frise({ duree, debut, fin, lecture, etiquette, reduit, onChange }, api) {
  const racine = useRef<HTMLDivElement>(null);
  const og = useRef<HTMLDivElement>(null), od = useRef<HTMLDivElement>(null);
  const sh = useRef<HTMLDivElement>(null), sb = useRef<HTMLDivElement>(null);
  const tete = useRef<HTMLSpanElement>(null);
  const ha = useRef<HTMLSpanElement>(null), hb = useRef<HTMLSpanElement>(null);
  const st = useRef({ a: debut, b: fin, t: lecture ?? debut, w: 1, min: 1 });
  const rappel = useRef(onChange);
  rappel.current = onChange;

  const maj = (silence = false) => {
    const s = st.current, pa = s.a / duree, pb = s.b / duree, w = s.w;
    og.current?.style.setProperty("transform", `scaleX(${pa})`);
    od.current?.style.setProperty("transform", `scaleX(${1 - pb})`);
    for (const el of [sh.current, sb.current]) el?.style.setProperty("transform", `translateX(${pa * w}px) scaleX(${pb - pa})`);
    ha.current?.style.setProperty("transform", `translateX(${pa * w}px)`);
    hb.current?.style.setProperty("transform", `translateX(${pb * w}px)`);
    tete.current?.style.setProperty("transform", `translateX(${(s.t / duree) * w}px)`);
    for (const [h, v, mn, mx] of [[ha.current, s.a, 0, s.b - s.min], [hb.current, s.b, s.a + s.min, duree]] as const) {
      if (!h) continue;
      h.setAttribute("aria-valuenow", String(Math.round(v * 10) / 10));
      h.setAttribute("aria-valuemin", String(Math.round(mn)));
      h.setAttribute("aria-valuemax", String(Math.round(mx)));
      h.setAttribute("aria-valuetext", tcParle(v));
    }
    if (!silence) rappel.current(s.a, s.b);
  };
  const borne = (v: number, mn: number, mx: number) => Math.min(mx, Math.max(mn, v));
  const poser = (qui: 0 | 1, v: number) => {
    const s = st.current;
    v = Math.round(v * 10) / 10;
    if (qui === 0) s.a = borne(v, 0, s.b - s.min); else s.b = borne(v, s.a + s.min, duree);
    maj();
  };

  useEffect(() => {
    const fr = racine.current!;
    const ro = new ResizeObserver(() => { st.current.w = fr.clientWidth || 1; maj(true); });
    ro.observe(fr);
    st.current.w = fr.clientWidth || 1;
    maj(true);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(api, () => ({
    set(a, b) { const s = st.current; s.a = borne(a, 0, duree); s.b = borne(b, s.a + s.min, duree); maj(true); },
    glisser(a, b, ms = 1000) {
      const s = st.current;
      if (reduit) { s.a = a; s.b = b; maj(); return Promise.resolve(); }
      const a0 = s.a, b0 = s.b, t0 = performance.now();
      const e = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      return new Promise((fini) => {
        const pas = (now: number) => {
          const x = Math.min(1, (now - t0) / ms), k = e(x);
          s.a = a0 + (a - a0) * k; s.b = b0 + (b - b0) * k;
          maj(x < 1);
          if (x < 1) requestAnimationFrame(pas); else fini();
        };
        requestAnimationFrame(pas);
      });
    },
  }), [duree, reduit]);

  const saisir = (i: 0 | 1) => (e: PointerEventR<HTMLSpanElement>) => {
    e.preventDefault(); e.stopPropagation();
    const h = e.currentTarget;
    h.setPointerCapture(e.pointerId);
    h.focus({ preventScroll: true });
    const r = racine.current!.getBoundingClientRect(); st.current.w = r.width;
    const decal = e.clientX - (r.left + ((i ? st.current.b : st.current.a) / duree) * r.width);
    const bouge = (ev: PointerEvent) => poser(i, ((ev.clientX - decal - r.left) / r.width) * duree);
    const fin = () => { h.removeEventListener("pointermove", bouge); h.removeEventListener("pointerup", fin); h.removeEventListener("pointercancel", fin); };
    h.addEventListener("pointermove", bouge); h.addEventListener("pointerup", fin); h.addEventListener("pointercancel", fin);
  };
  const clavier = (i: 0 | 1) => (e: KeyboardEvent) => {
    const s = st.current, pas = e.shiftKey ? 10 : 1, v = i ? s.b : s.a;
    const k = ({ ArrowLeft: v - pas, ArrowDown: v - pas, ArrowRight: v + pas, ArrowUp: v + pas, Home: 0, End: duree } as Record<string, number>)[e.key];
    if (k != null) { e.preventDefault(); poser(i, k); }
  };

  return (
    <div ref={racine} className="s-frise" role="group" aria-label={etiquette}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).classList.contains("s-poignee")) return;
        const r = racine.current!.getBoundingClientRect();
        st.current.t = borne(((e.clientX - r.left) / r.width) * duree, 0, duree); maj(true);
      }}>
      <div className="s-frise-images"><div ref={og} className="s-frise-ombre" /><div ref={od} className="s-frise-ombre s-frise-ombre--d" /></div>
      <div ref={sh} className="s-frise-sel s-frise-sel--haut" /><div ref={sb} className="s-frise-sel s-frise-sel--bas" />
      <span ref={tete} className="s-frise-tete" />
      <span ref={ha} className="s-poignee" role="slider" tabIndex={0} aria-label="Début du passage" onPointerDown={saisir(0)} onKeyDown={clavier(0)} />
      <span ref={hb} className="s-poignee" role="slider" tabIndex={0} aria-label="Fin du passage" onPointerDown={saisir(1)} onKeyDown={clavier(1)} />
    </div>
  );
});
