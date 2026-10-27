// Graphiques SVG légers et accessibles (aucune dépendance) : colonnes empilées, courbes, anneau, barres
// horizontales. Couleurs de la marque : or pour la série principale, graphite en contrepoint, rouge
// « bad » pour les échecs (or ↔ rouge et or ↔ graphite séparés pour les daltonismes, vérifié avec
// l'outil de palette : ΔE ≥ 27). L'or clair (1,9:1 sur ivoire) n'est jamais seul porteur d'information :
// chaque graphique a une légende (≥ 2 séries), un résumé (aria-label) et la table des données.
// Traits fins, extrémités arrondies de 4 px, 2 px de fond entre segments, chiffres tabulaires.
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { fmtNum } from "./format.ts";

export interface Series { key: string; label: string; fill: string; stroke: string; swatch: string }

export const SERIES = {
  gold: { fill: "fill-gold", stroke: "stroke-gold-text", swatch: "bg-gold" },
  graphite: { fill: "fill-raised", stroke: "stroke-line-strong", swatch: "bg-raised" },
  bad: { fill: "fill-bad", stroke: "stroke-bad", swatch: "bg-bad" },
} as const;

/** Parts d'un anneau (classes écrites en entier : Tailwind ne voit que les noms complets). */
export const SLICE = {
  gold: { fill: "fill-gold", ring: "stroke-gold", swatch: "bg-gold" },
  graphite: { fill: "fill-raised", ring: "stroke-line-strong", swatch: "bg-raised" },
} as const;

export interface Point { label: string; full: string; values: Record<string, number | null> }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Échelle « ronde » : 0 → sommet, 3 à 5 graduations. */
function niceScale(max: number, integer = true): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: integer ? 4 : 1, ticks: integer ? [0, 2, 4] : [0, 0.5, 1] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

function roundedTop(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ---- Cadre : titre, légende, résumé, données -----------------------------------------------------

export function Legend({ series, kind = "rect" }: { series: Pick<Series, "key" | "label" | "swatch">[]; kind?: "rect" | "line" }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-2">
          <span aria-hidden className={cn(kind === "line" ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-[3px]", s.swatch)} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export interface ChartTable { caption: string; columns: string[]; rows: (string | number)[][] }

/** Table des données d'un graphique, repliée par défaut (lisible au clavier et par les lecteurs d'écran). */
export function DataDetails({ table }: { table: ChartTable }) {
  return (
    <details className="group mt-3 text-[13.5px]">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full px-1 text-gold-text underline decoration-gold/50 underline-offset-4 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Voir les données</span><span className="hidden group-open:inline">Masquer les données</span>
      </summary>
      <div className="relative mt-2 max-h-72 overflow-auto rounded-[12px] border border-line bg-ivory">
        <table className="w-full text-left">
          <caption className="sr-only">{table.caption}</caption>
          <thead className="sticky top-0 bg-pearl text-[12.5px] text-ink-soft">
            <tr>{table.columns.map((c, i) => <th key={c} scope="col" className={cn("px-3 py-2 font-medium", i > 0 && "text-right")}>{c}</th>)}</tr>
          </thead>
          <tbody className="tabular divide-y divide-line">
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => (j === 0 ? <th key={j} scope="row" className="px-3 py-1.5 text-left font-normal text-ink-soft">{v}</th> : <td key={j} className="px-3 py-1.5 text-right">{v}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.max(84, Math.min(width - 84, x));
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-[12px] border border-line bg-ivory/[0.97] px-3 py-2 text-[12.5px] shadow-float" style={{ left }}>
      {children}
    </div>
  );
}
function TipRow({ swatch, label, value, line = false }: { swatch: string; label: string; value: string; line?: boolean }) {
  return (
    <p className="flex items-center gap-2 leading-relaxed">
      <span className={cn(line ? "h-0.5 w-3 rounded-full" : "h-0.5 w-3", swatch)} />
      <span className="tabular font-semibold text-ink">{value}</span>
      <span className="text-ink-soft">{label}</span>
    </p>
  );
}

const PAD = { l: 38, r: 14, t: 12, b: 26 };

function xLabelEvery(n: number, plotW: number) {
  const maxLabels = Math.max(2, Math.floor(plotW / 58));
  return Math.max(1, Math.ceil(n / maxLabels));
}

function YAxis({ ticks, top, plotH, width, fmt }: { ticks: number[]; top: number; plotH: number; width: number; fmt: (n: number) => string }) {
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.t + plotH - (t / top) * plotH;
        return (
          <g key={t}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} className={t === 0 ? "stroke-line-strong" : "stroke-line"} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={PAD.l - 7} y={y} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">{fmt(t)}</text>
          </g>
        );
      })}
    </g>
  );
}

// ---- Colonnes empilées -------------------------------------------------------------------------------

export function StackedColumns({ data, series, summary, height = 220, fmt = fmtNum, emptyText = "Aucune donnée sur la période." }: {
  data: Point[]; series: Series[]; summary: string; height?: number; fmt?: (n: number) => string; emptyText?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = data.length;
  const totals = data.map((d) => series.reduce((s, se) => s + (d.values[se.key] ?? 0), 0));
  const { top, ticks } = niceScale(Math.max(0, ...totals));
  const plotW = Math.max(0, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const band = n ? plotW / n : 0;
  const barW = band >= 6 ? Math.min(24, Math.max(3, band * 0.62)) : Math.max(1, band - 1);
  const every = xLabelEvery(n, plotW);
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.l) / Math.max(1, band));
    setActive(i >= 0 && i < n ? i : null);
  };
  const allZero = totals.every((t) => t === 0);
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary} onPointerMove={onMove} onPointerLeave={() => setActive(null)} className="block touch-pan-y select-none">
          <YAxis ticks={ticks} top={top} plotH={plotH} width={width} fmt={fmt} />
          {data.map((d, i) => {
            const cx = PAD.l + band * i + band / 2;
            let y = PAD.t + plotH;
            const segs = series.map((se) => ({ se, v: d.values[se.key] ?? 0 })).filter((s) => s.v > 0);
            return (
              <g key={i} className={cn("transition-opacity duration-150 motion-reduce:transition-none", active !== null && active !== i && "opacity-45")}>
                {segs.map(({ se, v }, j) => {
                  const h = (v / top) * plotH;
                  const gap = j > 0 ? Math.min(2, h / 2) : 0;
                  y -= h;
                  const isTop = j === segs.length - 1;
                  const segH = Math.max(0.5, h - gap);
                  return isTop
                    ? <path key={se.key} d={roundedTop(cx - barW / 2, y, barW, segH)} className={se.fill} />
                    : <rect key={se.key} x={cx - barW / 2} y={y} width={barW} height={segH} className={se.fill} />;
                })}
                {i % every === (n - 1) % every && (
                  <text x={Math.min(Math.max(cx, PAD.l + 16), width - PAD.r - 16)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">{d.label}</text>
                )}
              </g>
            );
          })}
          {allZero && <text x={PAD.l + plotW / 2} y={PAD.t + plotH / 2} textAnchor="middle" className="fill-muted text-[13px]">{emptyText}</text>}
        </svg>
      )}
      {active !== null && data[active] && (
        <Tooltip x={PAD.l + band * active + band / 2} width={width}>
          <p className="mb-1 font-medium text-ink">{data[active]!.full}</p>
          {[...series].reverse().map((se) => <TipRow key={se.key} swatch={se.swatch} label={se.label} value={fmt(data[active]!.values[se.key] ?? 0)} />)}
          <p className="mt-1 border-t border-line pt-1 text-ink-soft">Total <span className="tabular font-semibold text-ink">{fmt(totals[active] ?? 0)}</span></p>
        </Tooltip>
      )}
    </div>
  );
}

// ---- Courbes ------------------------------------------------------------------------------------------

export function LineChart({ data, series, summary, height = 200, fmt = fmtNum, integer = true, area = series.length === 1 }: {
  data: Point[]; series: Series[]; summary: string; height?: number; fmt?: (n: number) => string; integer?: boolean; area?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = data.length;
  const max = Math.max(0, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const { top, ticks } = niceScale(max, integer);
  const plotW = Math.max(0, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const every = xLabelEvery(n, plotW);
  const paths = series.map((s) => {
    let d = "";
    let started = false;
    data.forEach((p, i) => {
      const v = p.values[s.key];
      if (v === null || v === undefined) { started = false; return; }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      started = true;
    });
    return d;
  });
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.l;
    const i = n <= 1 ? 0 : Math.round((px / Math.max(1, plotW)) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };
  const last = n - 1;
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary} onPointerMove={onMove} onPointerLeave={() => setActive(null)} className="block touch-pan-y select-none">
          <YAxis ticks={ticks} top={top} plotH={plotH} width={width} fmt={fmt} />
          {area && series[0] && paths[0] && n > 1 && (
            <path d={`${paths[0]}L${x(last).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`} className="fill-gold/15" />
          )}
          {series.map((s, k) => <path key={s.key} d={paths[k]} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={s.stroke} />)}
          {active === null && series.map((s) => {
            const v = data[last]?.values[s.key];
            return v === null || v === undefined ? null : <circle key={s.key} cx={x(last)} cy={y(v)} r={4} strokeWidth={2} className={cn(s.fill === SERIES.gold.fill ? "fill-gold-text" : s.fill, "stroke-canvas")} />;
          })}
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={PAD.t + plotH} className="stroke-line-strong" strokeWidth={1} />
              {series.map((s) => {
                const v = data[active]?.values[s.key];
                return v === null || v === undefined ? null : <circle key={s.key} cx={x(active)} cy={y(v)} r={4} strokeWidth={2} className={cn(s.fill === SERIES.gold.fill ? "fill-gold-text" : s.fill, "stroke-canvas")} />;
              })}
            </g>
          )}
          {data.map((d, i) => (i % every === last % every ? (
            <text key={i} x={Math.min(Math.max(x(i), PAD.l + 16), width - PAD.r - 16)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">{d.label}</text>
          ) : null))}
          {max === 0 && <text x={PAD.l + plotW / 2} y={PAD.t + plotH / 2 - 8} textAnchor="middle" className="fill-muted text-[13px]">Aucune valeur sur la période.</text>}
        </svg>
      )}
      {active !== null && data[active] && (
        <Tooltip x={x(active)} width={width}>
          <p className="mb-1 font-medium text-ink">{data[active]!.full}</p>
          {series.map((s) => {
            const v = data[active]!.values[s.key];
            return <TipRow key={s.key} line swatch={s.fill === SERIES.gold.fill ? "bg-gold-text" : s.swatch} label={s.label} value={v === null || v === undefined ? "—" : fmt(v)} />;
          })}
        </Tooltip>
      )}
    </div>
  );
}

// ---- Anneau (parts) -----------------------------------------------------------------------------------

export interface Slice { key: string; label: string; value: number; fill: string; ring: string; swatch: string }

function arcPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  return `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
}

export function Donut({ slices, summary, centerLabel, size = 148 }: { slices: Slice[]; summary: string; centerLabel: string; size?: number }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = size / 2;
  const r = R - 18;
  const nonZero = slices.filter((s) => s.value > 0);
  const gap = nonZero.length > 1 ? 2 / R : 0;
  let a = -Math.PI / 2;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={summary} className="shrink-0">
        <circle cx={R} cy={R} r={(R + r) / 2} fill="none" strokeWidth={R - r} className="stroke-sand" />
        {total > 0 && nonZero.map((s) => {
          const span = (s.value / total) * Math.PI * 2;
          const a0 = a + gap / 2;
          const a1 = a + span - gap / 2;
          a += span;
          if (nonZero.length === 1) return <circle key={s.key} cx={R} cy={R} r={(R + r) / 2} fill="none" strokeWidth={R - r} className={s.ring} />;
          return a1 > a0 ? <path key={s.key} d={arcPath(R, R, R, r, a0, a1)} className={s.fill} /> : null;
        })}
        <text x={R} y={R - 4} textAnchor="middle" className="fill-ink text-[20px] font-semibold tabular">{fmtNum(total)}</text>
        <text x={R} y={R + 15} textAnchor="middle" className="fill-muted text-[11.5px]">{centerLabel}</text>
      </svg>
      <ul className="w-full min-w-0 space-y-2 text-[14px]">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", s.swatch)} />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{s.label}</span>
            <span className="tabular font-semibold text-ink">{fmtNum(s.value)}</span>
            <span className="tabular w-14 text-right text-muted">{total > 0 ? `${Math.round((s.value / total) * 100)} %` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Barres horizontales (HTML : libellés et valeurs visibles, lisibles sans le graphique) ----------

export interface HBar { key: string; label: ReactNode; value: number | null; display: ReactNode; sub?: ReactNode; marker?: number | null }

export function HBars({ items, max, barClass = "bg-gold", markerLabel, empty = "Aucune donnée.", className }: {
  items: HBar[]; max?: number; barClass?: string; markerLabel?: string; empty?: ReactNode; className?: string;
}) {
  const top = max ?? Math.max(0, ...items.map((i) => Math.max(i.value ?? 0, i.marker ?? 0)));
  if (!items.length) return <p className="text-[14px] text-muted">{empty}</p>;
  return (
    <ul className={cn("space-y-3.5", className)}>
      {items.map((it) => (
        <li key={it.key}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate text-ink-soft">{it.label}</span>
            <span className="tabular shrink-0 font-semibold text-ink">{it.display}</span>
          </div>
          <div aria-hidden className="relative mt-1.5 h-2.5 rounded-full bg-sand/80">
            {it.value !== null && top > 0 && (
              <div className={cn("h-full rounded-full transition-[width] duration-500 ease-[var(--ease-soft)] motion-reduce:transition-none", barClass)} style={{ width: `${Math.max(it.value > 0 ? 1.5 : 0, (it.value / top) * 100)}%` }} />
            )}
            {it.marker !== null && it.marker !== undefined && top > 0 && (
              <span title={markerLabel} className="absolute -top-[3px] h-4 w-[3px] -translate-x-1/2 rounded-full bg-raised ring-2 ring-canvas" style={{ left: `${Math.min(100, (it.marker / top) * 100)}%` }} />
            )}
          </div>
          {it.sub && <p className="tabular mt-1 text-[12.5px] text-muted">{it.sub}</p>}
        </li>
      ))}
    </ul>
  );
}
