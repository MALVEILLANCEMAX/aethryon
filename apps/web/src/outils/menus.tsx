// Menus de l'éditeur (Radix, habillés AETHRYON : verre obsidienne, ivoire, or champagne) : menu contextuel (clic droit,
// appui long au doigt, touche Menu ou Maj + F10), menu déroulant (« ⋯ », vitesse) et info-bulles.
// - Chaque entrée est une COMMANDE de l'éditeur (commands.ts) : même nom, même raccourci, même effet partout.
// - Non modaux : rien n'est injecté dans la page (la CSP du site refuse les feuilles de style en ligne), le reste de
//   l'éditeur ne se fige pas ; un clic dehors ou Échap ferme le menu, le focus revient où il était.
// - Placés près du pointeur et jamais coupés par le bord de l'écran (marge de 8 px), sous-menus compris.
// - Plein écran : les menus s'ouvrent DANS l'élément en plein écran (sinon ils seraient invisibles).
import * as CM from "@radix-ui/react-context-menu";
import * as DM from "@radix-ui/react-dropdown-menu";
import * as TT from "@radix-ui/react-tooltip";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ComponentType, type ReactElement, type ReactNode } from "react";
import type React from "react";
import { cn } from "../lib/cn.ts";
import { IconCheck } from "../ui/Icon.tsx";
import { onDigitLabels, readDigitLabels, type Command } from "./commands.ts";

type Icon = ComponentType<{ size?: number; className?: string }>;

export type Entry =
  | { kind: "cmd"; cmd: Command; label?: string; icon?: Icon }
  | { kind: "sep" }
  | { kind: "label"; text: string }
  | { kind: "sub"; label: string; icon?: Icon; disabled?: boolean; items: Entry[] }
  | { kind: "radio"; value: string; options: { value: string; label: string }[]; onChange(v: string): void };

export const cmd = (c: Command, label?: string, icon?: Icon): Entry => ({ kind: "cmd", cmd: c, label, icon });
export const sep: Entry = { kind: "sep" };

/** Conteneur des menus et info-bulles : l'élément en plein écran s'il y en a un. */
export const PortalTarget = createContext<HTMLElement | null>(null);

// ---- touches -----------------------------------------------------------------------------------------------------

/** Flèches dessinées : « ← » et « → » manquent à la police du site (sous-ensemble latin de Hanken Grotesk) ; la police de secours
 *  du système les montrait parfois comme de simples tirets, sans direction. */
const ARROWS: Record<string, { d: string; label: string }> = {
  "←": { d: "M19 12H5M10.5 6.5 5 12l5.5 5.5", label: "Flèche gauche" },
  "→": { d: "M5 12h14M13.5 6.5 19 12l-5.5 5.5", label: "Flèche droite" },
  "↑": { d: "M12 19V5M6.5 10.5 12 5l5.5 5.5", label: "Flèche haut" },
  "↓": { d: "M12 5v14M6.5 13.5 12 19l5.5-5.5", label: "Flèche bas" },
};

/** Caractères imprimés sur les touches 1 à 5 de CE clavier (« & », « é »… en AZERTY), si le navigateur les donne. */
export function useDigitLabels(): Record<string, string> | null {
  return useSyncExternalStore(onDigitLabels, readDigitLabels, () => null);
}

/** « Maj+← » → ["Maj", "←"] ; « + » reste « + ». */
const parts = (combo: string) => (combo === "+" ? ["+"] : combo.split(/\+(?=.)/));

/** Une combinaison, telle qu'on la tape : flèches dessinées, chiffre accompagné du signe de la touche (AZERTY). */
export function KeyCombo({ combo }: { combo: string }) {
  const digits = useDigitLabels();
  return (
    <>
      {parts(combo).map((part) => {
        const arrow = ARROWS[part];
        if (arrow) {
          return (
            <kbd key={part} className="kc-ico">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={arrow.d} />
              </svg>
              <span className="sr-only">{arrow.label}</span>
            </kbd>
          );
        }
        const alt = digits?.[part];
        if (alt) return <kbd key={part} className="kc-dual"><span aria-hidden="true">{alt}</span><span aria-hidden="true">{part}</span><span className="sr-only">{`Touche ${alt} ${part}`}</span></kbd>;
        return <kbd key={part}>{part}</kbd>;
      })}
    </>
  );
}

/** Raccourcis d'une commande : les `max` premiers (le principal d'abord). */
export function Keys({ keys, className, max = 2 }: { keys: string[]; className?: string; max?: number }) {
  return (
    <span className={cn("mn-keys", className)} aria-hidden="true">
      {keys.slice(0, max).map((k, i) => (
        <span key={k} className="kc-combo">{i > 0 && <span className="kc-or">ou</span>}<KeyCombo combo={k} /></span>
      ))}
    </span>
  );
}

/** Largeur prévue d'un menu (CSS .mn : 230 à 320 px) : sert à le garder entier sur un écran étroit. */
const MENU_W = 288;
const narrowScreen = () => typeof window !== "undefined" && window.innerWidth < 600;

/** Rendu commun des entrées, pour le menu contextuel comme pour le menu déroulant (mêmes composants Radix). */
type NS = typeof CM | typeof DM;
function Items({ ns, entries }: { ns: NS; entries: Entry[] }) {
  const N = ns as typeof CM;
  const container = useContext(PortalTarget);
  // Écran étroit : pas de sous-menu (il n'aurait la place ni à droite ni à gauche) ; ses entrées suivent, sous un titre.
  if (narrowScreen() && entries.some((e) => e.kind === "sub")) {
    entries = entries.flatMap((e) => (e.kind === "sub" ? [{ kind: "label", text: e.label } as Entry, ...e.items] : [e]));
  }
  return (
    <>
      {entries.map((e, k) => {
        if (e.kind === "sep") return <N.Separator key={k} className="mn-sep" />;
        if (e.kind === "label") return <N.Label key={k} className="mn-label">{e.text}</N.Label>;
        if (e.kind === "radio") {
          return (
            <N.RadioGroup key={k} value={e.value} onValueChange={e.onChange}>
              {e.options.map((o) => (
                <N.RadioItem key={o.value} value={o.value} className="mn-item" onSelect={(ev) => ev.preventDefault()}>
                  <span className="mn-ico"><N.ItemIndicator><IconCheck size={16} /></N.ItemIndicator></span>
                  <span className="mn-text">{o.label}</span>
                </N.RadioItem>
              ))}
            </N.RadioGroup>
          );
        }
        if (e.kind === "sub") {
          const I = e.icon;
          return (
            <N.Sub key={k}>
              <N.SubTrigger className="mn-item mn-subtrigger" disabled={e.disabled}>
                <span className="mn-ico">{I && <I size={17} />}</span>
                <span className="mn-text">{e.label}</span>
                <span className="mn-chev" aria-hidden="true">›</span>
              </N.SubTrigger>
              <N.Portal container={container ?? undefined}>
                <N.SubContent className="mn" sideOffset={6} alignOffset={-6} collisionPadding={8} data-menu="">
                  <Items ns={ns} entries={e.items} />
                </N.SubContent>
              </N.Portal>
            </N.Sub>
          );
        }
        const c = e.cmd;
        const I = e.icon ?? c.icon;
        const body = (
          <>
            <span className="mn-ico">{I && <I size={17} />}</span>
            <span className="mn-text">{e.label ?? c.label}</span>
            {c.checked !== undefined && <span className={cn("mn-state", c.checked && "is-on")} aria-hidden="true">{c.checked ? <IconCheck size={15} /> : null}</span>}
            {c.keys && <Keys keys={c.keys} max={1} />}
          </>
        );
        if (c.checked !== undefined) {
          return (
            <N.CheckboxItem key={k} className="mn-item" checked={c.checked} disabled={c.disabled} onSelect={() => c.run()} data-cmd={c.id}>
              {body}
            </N.CheckboxItem>
          );
        }
        return <N.Item key={k} className="mn-item" disabled={c.disabled} onSelect={() => c.run()} data-cmd={c.id}>{body}</N.Item>;
      })}
    </>
  );
}

/** Entrées calculées à l'ouverture (le contenu du menu n'est rendu qu'ouvert). */
function ZoneItems({ entries, target }: { entries(target: Element | null): Entry[]; target: { current: Element | null } }) {
  return <Items ns={CM} entries={entries(target.current)} />;
}

const LONG_PRESS_MS = 520;
const LONG_PRESS_SLOP = 10;

/**
 * Zone à menu contextuel. `entries(cible)` est calculé à l'ouverture, d'après l'élément visé (poignée, sélection,
 * frise vide, image, onde…). Les champs de saisie n'en contiennent jamais : leur menu natif reste le leur.
 * Au doigt : appui long (520 ms, 10 px de tolérance — un doigt tremble toujours un peu), qui ouvre le même menu.
 */
export function ContextZone({ entries, children, label, disabled = false }: {
  entries(target: Element | null): Entry[];
  children: ReactElement;
  label: string;
  disabled?: boolean;
}) {
  const target = useRef<Element | null>(null);
  const press = useRef<{ x: number; y: number; timer: number; el: Element } | null>(null);
  // Après un appui long, le doigt se lève : le navigateur peut encore envoyer un « clic » de compatibilité à cet
  // endroit, qui volerait le focus et refermerait le menu. Ces événements-là (hors du menu) sont ignorés un instant.
  const fired = useRef(-1e9);
  useEffect(() => {
    const block = (e: Event) => {
      if (performance.now() - fired.current > 900) return;
      if ((e.target as Element | null)?.closest?.("[data-menu]")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: false };
    for (const t of ["touchend", "mousedown", "click"]) window.addEventListener(t, block, opts);
    return () => { for (const t of ["touchend", "mousedown", "click"]) window.removeEventListener(t, block, opts); };
  }, []);
  const container = useContext(PortalTarget);
  const note = (e: { target: EventTarget | null }) => { target.current = e.target as Element | null; };
  /** Point d'ouverture gardé à l'écran : le menu (près de 300 px de large) tient en entier, au plus près du pointeur. */
  const keepX = (x: number) => (narrowScreen() ? Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8)) : x);
  const onContextMenuCapture = (e: React.MouseEvent) => {
    note(e);
    // Clic droit sur un écran étroit : relancé un peu plus à gauche s'il le faut (le menu ne dépasse jamais).
    if (e.nativeEvent.isTrusted && narrowScreen() && keepX(e.clientX) !== e.clientX) {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: keepX(e.clientX), clientY: e.clientY, button: 2 }));
    }
  };
  const cancel = () => { if (press.current) { window.clearTimeout(press.current.timer); press.current = null; } };
  const down = (e: React.PointerEvent) => {
    note(e);
    cancel();
    if (disabled || e.pointerType === "mouse" || !e.isPrimary) return;
    const el = e.target as Element;
    const { clientX: x, clientY: y } = e;
    press.current = {
      x, y, el,
      timer: window.setTimeout(() => {
        press.current = null;
        fired.current = performance.now();
        // Le menu s'ouvre comme au clic droit, au point touché.
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: keepX(x), clientY: y, button: 2 }));
        if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* sans vibreur */ }
      }, LONG_PRESS_MS),
    };
  };
  const move = (e: React.PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) cancel();
  };
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild disabled={disabled} onContextMenuCapture={onContextMenuCapture} onPointerDownCapture={down} onPointerMoveCapture={move}
        onPointerUpCapture={cancel} onPointerCancelCapture={cancel}>
        {children}
      </CM.Trigger>
      <CM.Portal container={container ?? undefined}>
        <CM.Content className="mn" collisionPadding={8} loop aria-label={label} data-menu="">
          <ZoneItems entries={entries} target={target} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/** Menu déroulant (« ⋯ », vitesse de lecture) : mêmes entrées, ouvert par un bouton. */
export function DropMenu({ trigger, entries, label, align = "end", side = "top" }: {
  trigger: ReactElement; entries: Entry[]; label: string; align?: "start" | "center" | "end"; side?: "top" | "bottom" | "left" | "right";
}) {
  const container = useContext(PortalTarget);
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal container={container ?? undefined}>
        <DM.Content className="mn" side={side} align={align} sideOffset={8} collisionPadding={8} loop aria-label={label} data-menu="">
          <Items ns={DM} entries={entries} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Info-bulle : nom de l'action et son raccourci, après un court temps de survol (ou au focus du clavier). */
export function Tip({ label, keys, side = "top", children }: { label: ReactNode; keys?: string[]; side?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  const container = useContext(PortalTarget);
  return (
    <TT.Root>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal container={container ?? undefined}>
        <TT.Content className="tip" side={side} sideOffset={8} collisionPadding={8}>
          <span>{label}</span>
          {keys && <Keys keys={keys} className="tip-keys" />}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

export function TipProvider({ children }: { children: ReactNode }) {
  return <TT.Provider delayDuration={420} skipDelayDuration={260}>{children}</TT.Provider>;
}
