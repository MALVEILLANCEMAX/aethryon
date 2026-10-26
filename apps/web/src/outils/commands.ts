// Commandes de l'éditeur : UNE définition par action (nom, pictogramme, raccourci, état), partagée par le clavier, les
// menus contextuels, la barre flottante, les info-bulles et l'aide des raccourcis. Une action garde le même nom partout.
//
// Raccourcis fiables sur tous les claviers :
// - lettres et signes : le CARACTÈRE tapé (KeyboardEvent.key), donc « A » est la touche A, en AZERTY comme en QWERTY ;
// - chiffres des outils : la POSITION de la touche (KeyboardEvent.code « Digit1 »…, pavé numérique compris), avec ou
//   sans Maj. En AZERTY, la touche « & 1 » donne « & » sans Maj : comparer key à « 1 » ne marchait jamais ;
// - jamais avec Ctrl, Alt (AltGr) ou Cmd : ces combinaisons restent au navigateur et au système ; jamais pendant une
//   saisie (champ, zone de texte, élément éditable, composition d'un caractère accentué).
import type { ComponentType } from "react";

export type CommandId =
  | "play" | "replay" | "loop" | "prevFrame" | "nextFrame" | "back1s" | "fwd1s"
  | "setIn" | "setOut" | "goIn" | "goOut" | "goStart" | "goEnd" | "selectAll" | "copyTimes"
  | "export" | "sendExport" | "exportVideo" | "exportAudio" | "exportGif" | "exportCompress"
  | "zoomSel" | "zoomAll" | "zoomIn" | "zoomOut" | "magnet"
  | "mute" | "fullscreen" | "theater" | "panel" | "help" | "undo" | "redo"
  | "tool1" | "tool2" | "tool3" | "tool4" | "tool5";

export interface Command {
  /** Commande de l'éditeur, ou action locale d'un menu (« libPlay »… d'une carte d'export). */
  id: CommandId | (string & {});
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Touches affichées, une par raccourci (« Espace », « Maj+← », « 1 »…) ; la première est la principale. */
  keys?: string[];
  run(): void;
  disabled?: boolean;
  /** Bascule (boucle, aimantation, son coupé…) : cochée ou non. */
  checked?: boolean;
}

export type Commands = Record<CommandId, Command>;

/**
 * Un raccourci : `key` (caractère, en minuscule pour les lettres) OU `code` (position physique). `shift` : exigée
 * (true), interdite (absent) ou indifférente (« any » : « ? », « + » et les chiffres, que Maj produit selon le clavier).
 */
interface Binding { key?: string; code?: string; shift?: true | "any"; cmd: CommandId }

const digit = (n: number, cmd: CommandId): Binding[] => [
  { code: `Digit${n}`, shift: "any", cmd },
  // Pavé numérique (verrouillage actif ; sinon ses touches sont Fin, flèches… et gardent ce sens) et claviers virtuels
  // (code vide) : le caractère.
  { key: String(n), shift: "any", cmd },
];

const KEYMAP: Binding[] = [
  { key: " ", cmd: "play" }, { key: "k", cmd: "play" },
  { key: "r", cmd: "replay" }, { key: "l", cmd: "loop" },
  { key: "arrowleft", cmd: "prevFrame" }, { key: "arrowright", cmd: "nextFrame" },
  { key: "arrowleft", shift: true, cmd: "back1s" }, { key: "arrowright", shift: true, cmd: "fwd1s" },
  { key: "i", cmd: "setIn" }, { key: "o", cmd: "setOut" },
  { key: "home", cmd: "goIn" }, { key: "end", cmd: "goOut" },
  { key: "home", shift: true, cmd: "goStart" }, { key: "end", shift: true, cmd: "goEnd" },
  { key: "a", cmd: "selectAll" },
  { key: "e", cmd: "export" },
  { key: "z", cmd: "zoomSel" }, { key: "z", shift: true, cmd: "zoomAll" },
  { key: "+", shift: "any", cmd: "zoomIn" }, { key: "=", cmd: "zoomIn" }, { key: "-", cmd: "zoomOut" },
  { key: "n", cmd: "magnet" }, { key: "m", cmd: "mute" }, { key: "f", cmd: "fullscreen" },
  { key: "t", cmd: "theater" }, { key: "?", shift: "any", cmd: "help" },
  // Outils : chiffre (position) ou lettre à retenir (X couper, C cadrer, S son, G GIF).
  ...digit(1, "tool1"), ...digit(2, "tool2"), ...digit(3, "tool3"), ...digit(4, "tool4"), ...digit(5, "tool5"),
  { key: "x", cmd: "tool1" }, { key: "c", cmd: "tool2" }, { key: "s", cmd: "tool3" }, { key: "g", cmd: "tool4" },
];

/** Commande d'une touche (sans Ctrl, Alt/AltGr ni Cmd : celles du navigateur et du système restent les leurs). */
export function commandFor(e: KeyboardEvent): CommandId | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.key === "Process" || e.key === "Dead") return null;
  const key = e.key.toLowerCase();
  const ok = (b: Binding) => b.shift === "any" || !!b.shift === e.shiftKey;
  // La position d'abord (chiffres), puis le caractère.
  const hit = (e.code ? KEYMAP.find((b) => b.code === e.code && ok(b)) : undefined) ?? KEYMAP.find((b) => b.key === key && ok(b));
  return hit?.cmd ?? null;
}

/**
 * Cible où une touche garde son sens premier : champ de saisie, élément éditable et menu ouvert (toutes les touches) ;
 * poignée, cadre de recadrage, séparateur, groupe de pastilles, onglets, barre d'outils (leurs touches de déplacement) ;
 * bouton, lien, pastille, onglet (Espace et Entrée). Les autres raccourcis restent actifs partout ailleurs.
 */
export function nativeKeyTarget(el: Element | null, key: string): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox], [role=menu], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=listbox]")) return true;
  const nav = key.startsWith("Arrow") || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown";
  if (nav && el.closest("[role=slider], [data-crop], [role=separator], [role=radiogroup], [role=tablist], [role=toolbar]")) return true;
  if ((key === " " || key === "Enter") && el.closest("button, a[href], [role=radio], [role=tab], summary, [role=button]")) return true;
  if (key === "Enter" && el.closest("[role=separator]")) return true;
  return false;
}

// ---- touches telles qu'elles sont imprimées sur CE clavier -----------------------------------------------------------

/**
 * Caractère imprimé sans Maj sur les touches 1 à 5 (« & », « é »… en AZERTY), quand le navigateur sait le dire
 * (navigator.keyboard.getLayoutMap, Chromium) ; sinon null, et l'aide montre simplement le chiffre.
 */
let digitLabels: Record<string, string> | null | undefined;
const listeners = new Set<() => void>();
export function readDigitLabels(): Record<string, string> | null {
  if (digitLabels !== undefined) return digitLabels;
  digitLabels = null;
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?(): Promise<Map<string, string>> } }).keyboard;
  kb?.getLayoutMap?.().then((m) => {
    const out: Record<string, string> = {};
    for (let n = 1; n <= 5; n++) {
      const c = m.get(`Digit${n}`);
      if (c && c !== String(n)) out[String(n)] = c;
    }
    digitLabels = Object.keys(out).length ? out : null;
    for (const f of listeners) f();
  }).catch(() => undefined);
  return digitLabels;
}
export function onDigitLabels(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
