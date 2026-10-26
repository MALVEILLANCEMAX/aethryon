// Barre flottante de la sélection, posée par la frise au-dessus du passage choisi (elle le suit) : glisser vers
// l'export, exporter, temps de début et de fin, durée, rejouer, boucle, zoom sur la sélection, et le menu « ⋯ ».
// Barre d'outils au sens ARIA : une tabulation y entre, les flèches y circulent. Boutons légèrement aimantés vers le
// pointeur (3 px au plus, rien en mouvement réduit), sans rendu React au survol.
import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { IconDownload, IconReplay } from "../ui/Icon.tsx";
import type { Commands } from "./commands.ts";
import { spanLabel, timecode } from "./format.ts";
import { IconArrowRight, IconFitSel, IconGrip, IconLoop, IconMore } from "./icons.tsx";
import type { Span, Store } from "./live.ts";
import { DropMenu, Tip, type Entry } from "./menus.tsx";

/** Aimant discret : le bouton suit un peu le pointeur (variables CSS, sans React). */
export function magnetMove(e: RPointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  el.style.setProperty("--mx", `${(Math.max(-1, Math.min(1, dx)) * 3).toFixed(2)}px`);
  el.style.setProperty("--my", `${(Math.max(-1, Math.min(1, dy)) * 2).toFixed(2)}px`);
}
export function magnetReset(e: RPointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--mx", "0px");
  e.currentTarget.style.setProperty("--my", "0px");
}
const mag = { onPointerMove: magnetMove, onPointerLeave: magnetReset };

/** Flèches gauche/droite, Début, Fin : le focus circule entre les boutons de la barre. */
function rove(e: KeyboardEvent<HTMLDivElement>) {
  // Boutons effacés quand la frise est étroite (outils.css « tlrow ») : sautés.
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter((b) => b.getClientRects().length > 0);
  const i = items.indexOf(document.activeElement as HTMLElement);
  const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
  if (to === null || i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  items[(to + items.length) % items.length]?.focus();
}

/** Temps de la sélection : écrits directement à chaque changement (aucun rendu React pendant un geste). */
function SpanText({ live, compact }: { live: Store<Span>; compact: boolean }) {
  const box = useRef<HTMLSpanElement>(null), a = useRef<HTMLSpanElement>(null), b = useRef<HTMLSpanElement>(null), n = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const put = () => {
      const s = live.get();
      const len = Math.max(0, s.end - s.start);
      if (a.current) a.current.textContent = timecode(s.start, 2);
      if (b.current) b.current.textContent = timecode(s.end, 2);
      if (n.current) n.current.textContent = spanLabel(len);
      box.current?.classList.toggle("is-gesture", !!s.gesture);
      box.current?.setAttribute("aria-label", `Sélection de ${timecode(s.start, 2)} à ${timecode(s.end, 2)}, ${spanLabel(len)}`);
    };
    put();
    return live.subscribe(put);
  }, [live, compact]);
  return (
    <span ref={box} className="ft-span tabular">
      {!compact && <><span ref={a} className="ft-t" /><IconArrowRight size={13} className="ft-arrow" /><span ref={b} className="ft-t" /></>}
      <b ref={n} className="ft-len" />
    </span>
  );
}

export interface ExportButtonProps {
  type: "button"; className: string; onClick(): void; disabled?: boolean; children: ReactNode;
  onPointerMove(e: RPointerEvent<HTMLElement>): void; onPointerLeave(e: RPointerEvent<HTMLElement>): void; "data-ft-export": string;
}

export function Toolbar({ live, commands: c, onGrip, onSend, more, compact, exportLabel, exportButton }: {
  live: Store<Span>;
  commands: Commands;
  /** Poignée de saisie : début du glisser vers l'export. */
  onGrip(e: RPointerEvent<HTMLButtonElement>): void;
  more: Entry[];
  /** Poignée touchée sans glisser (ou Entrée) : « Envoyer vers Export ». */
  onSend(): void;
  compact: boolean;
  exportLabel: string;
  /** Bouton « Exporter » (le panneau d'export s'y déploie) : rendu par l'éditeur. */
  exportButton(props: ExportButtonProps): ReactNode;
}) {
  const grip = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  return (
    <div role="toolbar" aria-label="Sélection" className={cn("ft", compact && "is-compact")} onKeyDown={rove} data-toolbar="">
      <Tip label="Glisser la sélection vers « Exporter »" keys={["E"]}>
        <button type="button" className="ft-grip" aria-label="Envoyer la sélection vers l'export (ou la glisser vers Exporter)" data-export-grip=""
          onPointerDown={(e) => {
            if (e.button > 0) return;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* relâché */ }
            grip.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const g = grip.current;
            // Le transport ne part qu'au-delà de 4 px : un simple clic reste un clic.
            if (!g || g.moved || e.pointerId !== g.id || Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
            g.moved = true;
            e.currentTarget.blur();
            onGrip(e);
          }}
          onPointerUp={(e) => { const g = grip.current; grip.current = null; if (g && !g.moved && e.pointerId === g.id) onSend(); }}
          onPointerCancel={() => { grip.current = null; }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSend(); } }}>
          <IconGrip size={16} />
        </button>
      </Tip>
      {exportButton({
        type: "button", className: "ft-export", onClick: c.export.run, disabled: c.export.disabled, ...mag, "data-ft-export": "",
        children: <><IconDownload size={16} /><span className="ft-export-label">{exportLabel}</span></>,
      })}
      <span className="ft-sep" aria-hidden="true" />
      <SpanText live={live} compact={compact} />
      <span className="ft-sep" aria-hidden="true" />
      {!compact && (
        <Tip label={c.replay.label} keys={c.replay.keys}>
          <button type="button" className="ft-btn" onClick={c.replay.run} disabled={c.replay.disabled} aria-label={c.replay.label} {...mag} data-ft-replay=""><IconReplay size={17} /></button>
        </Tip>
      )}
      <Tip label={c.loop.label} keys={c.loop.keys}>
        <button type="button" className={cn("ft-btn", c.loop.checked && "is-on")} onClick={c.loop.run} aria-pressed={!!c.loop.checked} aria-label={c.loop.label} {...mag} data-ft-loop=""><IconLoop size={17} /></button>
      </Tip>
      {!compact && (
        <Tip label={c.zoomSel.label} keys={c.zoomSel.keys}>
          <button type="button" className="ft-btn" onClick={c.zoomSel.run} disabled={c.zoomSel.disabled} aria-label={c.zoomSel.label} {...mag} data-ft-zoom=""><IconFitSel size={17} /></button>
        </Tip>
      )}
      <DropMenu label="Actions de la sélection" entries={more} side="top" align="end"
        trigger={<button type="button" className="ft-btn" aria-label="Plus d'actions sur la sélection" {...mag} data-ft-more=""><IconMore size={17} /></button>} />
    </div>
  );
}
