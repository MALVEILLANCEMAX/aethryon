// Styles de l'éditeur d'extrait — TimeLens (3.8.0) : obsidienne, ivoire, or champagne, bronze pour la limite,
// bordures fines, coins arrondis, chiffres tabulaires. Partagés par le menu des pages (racine Shadow DOM, jetons de
// src/content/common/styles.ts) et le popup (jetons de popup.css, reliés par les variables --ce-*).
// Mouvement : transform et opacity seulement (hauteur du mode précis : morph de dom.ts). La position des poignées, de
// l'aiguille de la lentille et de la bulle de durée n'est JAMAIS animée : elle suit le pointeur à l'image près.
// Mouvement réduit : aucune transition ni animation (lentille instantanée, retour à la limite immédiat).

export const EXTRAIT_CSS = `
.ce, .xp {
  --ce-font: var(--font, system-ui, sans-serif);
  --ce-ink: var(--ink); --ce-soft: var(--ink-soft); --ce-muted: var(--muted);
  --ce-field: var(--surface); --ce-well: var(--surface-2); --ce-line: var(--line); --ce-line-strong: var(--line-strong);
  --ce-gold: var(--gold); --ce-gold-2: var(--gold-light, #e3cda6); --ce-gold-text: var(--gold-text);
  --ce-obsidian: var(--accent); --ce-on-obsidian: var(--on-accent); --ce-focus: var(--focus);
  --ce-bad: var(--bad); --ce-bad-bg: var(--bad-bg); --ce-ok: var(--ok); --ce-ok-bg: var(--ok-bg);
  --ce-shadow: var(--button-shadow, 0 1px 1px rgba(15, 15, 16, .28));
  --ce-band: linear-gradient(180deg, #ecdcc0 0%, #d8b98a 100%);
  --ce-band-line: rgba(122, 95, 56, .55);
  --ce-handle: #0f0f10; --ce-handle-grip: #e3cda6;
  --ce-tip-bg: #0f0f10; --ce-tip-fg: #faf8f3;
  --ce-bronze: #7a5f38; --ce-on-bronze: #faf8f3;
  --ce-lens-bg: #fffdf9; --ce-lens-line: rgba(122, 95, 56, .22); --ce-needle: #7a5f38;
  --ce-ease: cubic-bezier(.22, .8, .26, 1);
  --ce-excl: repeating-linear-gradient(135deg, color-mix(in srgb, var(--ce-gold) 38%, transparent) 0 3px, transparent 3px 7px);
}
/* menu des pages en thème sombre : poignées et infobulles ivoire, passage d'un or plus profond, bronze clair */
.aeth[data-theme="dark"] .ce, .aeth[data-theme="dark"] .xp {
  --ce-band: linear-gradient(180deg, #dcc196 0%, #b8925c 100%); --ce-band-line: rgba(250, 248, 243, .28);
  --ce-handle: #f4efe7; --ce-handle-grip: #a8834f; --ce-tip-bg: #f4efe7; --ce-tip-fg: #0f0f10;
  --ce-bronze: #b8925c; --ce-on-bronze: #0f0f10;
  --ce-lens-bg: #1d1d20; --ce-lens-line: rgba(227, 205, 166, .18); --ce-needle: #e3cda6;
}
.ce { position: relative; display: grid; gap: 10px; min-width: 0; font-family: var(--ce-font); color: var(--ce-ink); }
.ce[hidden], .ce [hidden] { display: none !important; }
.ce button { font-family: inherit; }
/* ordre visuel (l'ordre du DOM est celui de la tabulation) : le mode précis s'ouvre sous la réglette */
.ce-top { order: 1; } .tl { order: 2; } .ce-precis { order: 3; } .ce-marks { order: 4; } .ce-note { order: 5; }
.ce-presets { order: 6; } .ce-fmt { order: 7; } .ce-fline { order: 8; } .ce-foot { order: 9; }
.ce-live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

/* rangée du haut : lire le passage, plage, « Ajuster finement » */
.ce-top { display: flex; align-items: center; gap: 8px; min-height: 32px; min-width: 0; }
.ce-play {
  all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 50%;
  background: var(--ce-obsidian); color: var(--ce-gold); box-shadow: var(--ce-shadow); cursor: pointer;
  transition: transform .12s var(--ce-ease), opacity .15s ease;
}
.ce-play .ico-play { margin-left: 2px; }
@media (hover: hover) and (pointer: fine) { .ce-play:hover:not(:disabled) { transform: scale(1.04); } }
.ce-play:active { transform: scale(.95); }
.ce-play:disabled { opacity: .4; cursor: default; transform: none; }
.ce-play:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 2px; }
/* la plage n'est jamais tronquée : si la place manque (vidéo de 9 h dans le menu de 320 px), elle passe à la ligne après « → » */
.ce-range { flex: 1; min-width: 0; font: 600 13px/16px var(--ce-font); font-variant-numeric: tabular-nums; color: var(--ce-ink); overflow-wrap: normal; }
.ce-fine {
  all: unset; box-sizing: border-box; flex: none; display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px 0 10px; border-radius: 9px;
  cursor: pointer; font: 600 12px/16px var(--ce-font); color: var(--ce-soft); white-space: nowrap; box-shadow: inset 0 0 0 1px var(--ce-line-strong);
  transition: background-color .14s ease, color .14s ease;
}
.ce-fine .ico { color: var(--ce-gold-text); transition: transform .2s var(--ce-ease); }
.ce-fine[aria-expanded="true"] { color: var(--ce-ink); background: color-mix(in srgb, var(--ce-gold) 14%, transparent); }
.ce-fine[aria-expanded="true"] .ico { transform: rotate(180deg); }
.ce-fine:hover { color: var(--ce-ink); }
.ce-fine:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 2px; }
.ce[data-duration="unknown"] .ce-play, .ce[data-duration="unknown"] .ce-fine { display: none; }

/* réglette : bande réservée (bulle, survol), piste, échelle */
.tl { position: relative; display: grid; gap: 4px; min-width: 0; user-select: none; -webkit-user-select: none; }
.tl-lane { position: relative; height: 24px; pointer-events: none; }
.tl-bubble, .tl-htip {
  position: absolute; left: 0; top: 0; height: 22px; padding: 0 8px; border-radius: 11px; white-space: nowrap; pointer-events: none;
  font: 600 12px/22px var(--ce-font); font-variant-numeric: tabular-nums; background: var(--ce-tip-bg); color: var(--ce-tip-fg);
  box-shadow: 0 6px 16px -10px rgba(15, 15, 16, .6);
}
.tl-bubble { z-index: 2; transition: background-color .14s var(--ce-ease), color .14s var(--ce-ease); }
.tl-bubble::after {
  content: ""; position: absolute; top: 100%; left: var(--tip, 50%); margin-left: -3px; border: 3px solid transparent; border-bottom: 0;
  border-top: 4px solid var(--ce-tip-bg); transition: border-color .14s var(--ce-ease);
}
.tl-bubble[data-tone="bronze"] { background: var(--ce-bronze); color: var(--ce-on-bronze); }
.tl-bubble[data-tone="bronze"]::after { border-top-color: var(--ce-bronze); }
.tl-htip { z-index: 1; background: color-mix(in srgb, var(--ce-tip-bg) 88%, transparent); opacity: 0; transition: opacity .12s ease; }
.tl-lane[data-hover] .tl-htip:not([data-hidden]) { opacity: 1; }
.tl[data-dragging] .tl-htip { opacity: 0 !important; }
.tl-track { position: relative; height: 40px; touch-action: none; cursor: pointer; border-radius: 11px; }
.tl-rail {
  position: absolute; inset: 0; border-radius: inherit; background: var(--ce-well);
  box-shadow: inset 0 0 0 1px var(--ce-line), inset 0 1px 2px rgba(15, 15, 16, .06);
}
.tl-area { position: absolute; top: 0; bottom: 0; left: 16px; right: 16px; }
.tl-sel {
  position: absolute; top: 6px; bottom: 6px; left: var(--a, 0%); width: calc(var(--b, 0%) - var(--a, 0%)); min-width: 2px;
  border-radius: 3px; background: var(--ce-band); box-shadow: inset 0 0 0 1px var(--ce-band-line), inset 0 1px 0 rgba(255, 255, 255, .45); cursor: grab;
}
.tl[data-dragging="band"] .tl-sel { cursor: grabbing; }
.tl-excl { position: absolute; top: 6px; bottom: 6px; left: var(--x, 0%); width: calc(var(--b, 0%) - var(--x, 0%)); border-radius: 0 3px 3px 0; background: var(--ce-excl); opacity: .7; display: none; cursor: grab; }
.tl-excl[data-on] { display: block; }
.tl[data-dragging] .tl-rail, .tl[data-dragging] .tl-sel, .tl[data-dragging] .tl-scale { opacity: .94; }
.tl-h {
  position: absolute; top: 0; bottom: 0; width: 14px; z-index: 3; cursor: ew-resize; outline: none;
  background: var(--ce-handle); box-shadow: 0 1px 2px rgba(15, 15, 16, .35), 0 6px 14px -8px rgba(15, 15, 16, .7);
  transition: transform .14s var(--ce-ease);
}
/* Zone de saisie élargie VERS L'EXTÉRIEUR du passage : deux poignées collées restent saisissables chacune. */
.tl-h::before { content: ""; position: absolute; top: -4px; bottom: -4px; }
.tl-h-start::before { left: -10px; right: 0; }
.tl-h-end::before { left: 0; right: -10px; }
.tl-h-start { left: calc(var(--a, 0%) - 14px); border-radius: 8px 2px 2px 8px; transform-origin: 100% 50%; }
.tl-h-end { left: var(--b, 0%); border-radius: 2px 8px 8px 2px; transform-origin: 0 50%; }
.tl-grip { position: absolute; top: calc(50% - 7px); height: 14px; width: 2px; border-radius: 1px; background: var(--ce-handle-grip); }
.tl-h-start .tl-grip { right: 4px; }
.tl-h-end .tl-grip { left: 4px; }
@media (hover: hover) and (pointer: fine) { .tl-h:hover { transform: scaleX(1.14); } }
.tl[data-dragging="start"] .tl-h-start, .tl[data-dragging="end"] .tl-h-end { transform: scaleX(1.14) scaleY(1.06); }
.tl-h:focus-visible { box-shadow: 0 0 0 2px var(--ce-field), 0 0 0 4px var(--ce-focus); }
.tl-h[aria-disabled="true"] { cursor: default; opacity: .55; }
.tl[data-disabled] .tl-track { cursor: default; }
.tl[data-disabled] .tl-sel { cursor: default; filter: saturate(.6); }
.tl-hover { position: absolute; top: 4px; bottom: 4px; left: var(--h, 0%); width: 1px; z-index: 1; background: color-mix(in srgb, var(--ce-ink) 40%, transparent); opacity: 0; transition: opacity .12s ease; pointer-events: none; }
.tl-track[data-hover] .tl-hover { opacity: 1; }
.tl[data-dragging] .tl-hover { opacity: 0 !important; }
/* tête de lecture : filet sur la piste, point dans la bande réservée ; près d'une poignée, le point s'efface et le filet passe dessous */
.tl-ph { position: absolute; top: -12px; bottom: 3px; left: var(--t, 0%); width: 2px; margin-left: -1px; z-index: 2; border-radius: 1px; background: var(--ce-ink); opacity: 0; pointer-events: none; transition: opacity .2s ease; }
.tl-ph::before { content: ""; position: absolute; top: -1px; left: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--ce-ink); box-shadow: 0 0 0 2px var(--ce-field); }
.tl-ph[data-on] { opacity: .9; }
.tl-ph[data-near] { top: 3px; }
.tl-ph[data-near]::before { opacity: 0; }
.tl-scale { display: flex; justify-content: space-between; height: 14px; padding: 0 16px; font: 500 10.5px/14px var(--ce-font); color: var(--ce-muted); font-variant-numeric: tabular-nums; }

/* lentille : flottante sous la piste pendant un geste, ou posée dans le mode précis */
.tl-lens {
  box-sizing: border-box; height: 64px; padding: 6px 0 4px; border-radius: 12px; background: var(--ce-lens-bg);
  box-shadow: 0 0 0 1px var(--ce-lens-line), 0 18px 40px -18px rgba(15, 15, 16, .55); user-select: none; -webkit-user-select: none; touch-action: none;
}
.tl-lens[data-floating] {
  position: absolute; left: 0; right: 0; top: 72px; z-index: 6; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-4px);
  transition: opacity .16s var(--ce-ease), visibility 0s linear .16s, transform 0s linear .16s;
}
.tl-lens[data-floating][data-on] {
  opacity: 1; visibility: visible; pointer-events: auto; transform: none;
  transition: opacity .14s var(--ce-ease), transform .14s var(--ce-ease), visibility 0s;
}
/* ouverte au clavier : aucune animation d'entrée (une action au clavier ne s'anime pas, review-animations) */
.tl-lens[data-floating][data-on][data-instant] { transition: none; }
/* ouverte au clavier, elle informe seulement : un clic passe au travers (« Début ici » dessous reste cliquable) */
.tl-lens[data-floating][data-instant] { pointer-events: none !important; }
.ce-lensslot .tl-lens { position: relative; box-shadow: 0 0 0 1px var(--ce-lens-line); cursor: crosshair; }
.tl-lens-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; height: 22px; padding: 0 16px; }
.tl-lens-edge { font: 600 11px/22px var(--ce-font); color: var(--ce-gold-text); }
.tl-lens-val { font: 600 18px/22px var(--ce-font); font-variant-numeric: tabular-nums; color: var(--ce-ink); }
.tl-lens-band { position: relative; height: 30px; margin: 2px 16px 0; overflow: hidden; }
.tl-lens-strip {
  position: absolute; left: 0; top: 0; bottom: 0; width: 300%; will-change: transform;
  background:
    repeating-linear-gradient(90deg, color-mix(in srgb, var(--ce-ink) 55%, transparent) 0 1px, transparent 1px var(--major, 70px)) left bottom / 100% 12px no-repeat,
    repeating-linear-gradient(90deg, color-mix(in srgb, var(--ce-ink) 26%, transparent) 0 1px, transparent 1px var(--minor, 7px)) left bottom / 100% 6px no-repeat;
}
.tl-lens-labs { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .12s var(--ce-ease); }
.tl-lens[data-window] .tl-lens-labs { opacity: 1; }
.tl-lens-lab { position: absolute; left: 0; top: 1px; font: 500 10px/12px var(--ce-font); color: var(--ce-muted); font-variant-numeric: tabular-nums; white-space: nowrap; will-change: transform; }
.tl-lens-out { position: absolute; top: 0; bottom: 0; left: 0; width: 100%; background: var(--ce-excl); opacity: .7; will-change: transform; }
.tl-lens:not([data-window]) .tl-lens-out { display: none; }
.tl-lens-needle { position: absolute; top: 0; bottom: 0; left: -1px; width: 2px; z-index: 2; background: var(--ce-needle); will-change: transform; }
.tl-lens-needle::before { content: ""; position: absolute; top: -1px; left: -2px; width: 6px; height: 6px; background: var(--ce-needle); transform: rotate(45deg); }
.tl-lens-tip {
  position: absolute; left: 50%; top: 0; display: none; padding: 0 6px; border-radius: 6px; transform: translateX(-50%); white-space: nowrap;
  font: 500 10.5px/14px var(--ce-font); color: var(--ce-gold-text); background: var(--ce-lens-bg);
}
.tl-lens[data-tip][data-mode="suivi"] .tl-lens-tip { display: block; }

/* mode précis : borne, ±1 image, lentille posée, champs, aide du clavier */
.ce-precis { display: grid; gap: 8px; min-width: 0; }
.ce-prow { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; }
.ce-eseg, .ce-steps { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: var(--ce-well); box-shadow: inset 0 0 0 1px var(--ce-line); }
.ce-steps { padding: 0; gap: 4px; background: none; box-shadow: none; }
.ce-eopt, .ce-step {
  all: unset; box-sizing: border-box; display: inline-grid; place-items: center; height: 26px; padding: 0 10px; border-radius: 7px; cursor: pointer;
  font: 600 12px/16px var(--ce-font); color: var(--ce-soft); font-variant-numeric: tabular-nums; white-space: nowrap; transition: background-color .12s ease, color .12s ease;
}
.ce-step { height: 28px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--ce-line-strong); }
.ce-eopt[aria-checked="true"] { background: var(--ce-obsidian); color: var(--ce-on-obsidian); }
.ce-eopt:not([aria-checked="true"]):hover, .ce-step:hover { color: var(--ce-ink); background: color-mix(in srgb, var(--ce-ink) 7%, transparent); }
.ce-step:active:not(:disabled) { transform: scale(.98); }
.ce-eopt:focus-visible, .ce-step:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 1px; }
.ce-eopt:disabled, .ce-step:disabled { opacity: .45; cursor: default; }
.ce-precis:not([data-lens]) .ce-lensslot { display: none; }
.ce-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.ce-field { display: grid; gap: 3px; min-width: 0; }
.ce-flabel { font: 600 11px/14px var(--ce-font); letter-spacing: .02em; color: var(--ce-muted); }
.ce-input {
  box-sizing: border-box; width: 100%; min-width: 0; height: 34px; margin: 0; padding: 0 4px; border-radius: 9px;
  border: 1px solid var(--ce-line-strong); background: var(--ce-field); color: var(--ce-ink);
  font: 600 12.5px/18px var(--ce-font); font-variant-numeric: tabular-nums; letter-spacing: 0; text-align: center;
  transition: border-color .14s ease, box-shadow .14s ease, background-color .14s ease;
}
.ce-input::placeholder { color: var(--ce-muted); font-weight: 500; }
.ce-input:hover:not(:disabled) { border-color: color-mix(in srgb, var(--ce-gold) 70%, var(--ce-line-strong)); }
.ce-input:focus { outline: none; border-color: var(--ce-gold); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ce-gold) 30%, transparent); }
.ce-input[data-pending] { border-style: dashed; }
.ce-input[aria-invalid="true"] { border-color: var(--ce-bad); background: var(--ce-bad-bg); box-shadow: none; }
.ce-input:disabled { opacity: .55; }
.ce-keys { margin: 0 2px; font: 500 10.5px/14px var(--ce-font); color: var(--ce-muted); }
.ce[data-duration="unknown"] .ce-keys { font-size: 12px; line-height: 16px; color: var(--ce-soft); }

/* marques : instant du lecteur, « Début ici », « Fin ici » */
.ce-marks { display: flex; align-items: center; gap: 6px; min-height: 32px; min-width: 0; }
.ce-now { flex: 1; min-width: 0; font: 500 12.5px/16px var(--ce-font); color: var(--ce-soft); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ce-mark {
  all: unset; box-sizing: border-box; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px;
  border-radius: 9px; cursor: pointer; font: 600 12px/16px var(--ce-font); color: var(--ce-soft); white-space: nowrap;
  box-shadow: inset 0 0 0 1px var(--ce-line-strong); transition: background-color .12s ease, color .12s ease, transform .08s var(--ce-ease);
}
.ce-mark .ico { flex: none; color: var(--ce-gold-text); }
.ce-mark:hover:not(:disabled) { color: var(--ce-ink); background: color-mix(in srgb, var(--ce-gold) 12%, transparent); }
.ce-mark:active:not(:disabled) { transform: scale(.98); }
.ce-mark:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 2px; }
.ce-mark:disabled { opacity: .45; cursor: default; }
.ce[data-duration="unknown"] .ce-marks .ce-mark { display: none; }

/* note : message (corrigé, erreur) ou astuce ; rien au repos */
.ce-note { display: grid; gap: 6px; min-width: 0; }
.ce-note:not(:has(.ce-msg:not(:empty), .ce-hint)) { display: none; }
.ce-msg { margin: 0 2px; font: 500 12px/16px var(--ce-font); color: var(--ce-soft); overflow-wrap: anywhere; }
.ce-msg:empty { display: none; }
.ce-msg[data-tone="bad"] { color: var(--ce-bad); }
.ce-hint {
  display: grid; grid-template-columns: 24px minmax(0, 1fr) 24px; gap: 8px; align-items: start; padding: 8px 6px 8px 8px; border-radius: 12px;
  background: color-mix(in srgb, var(--ce-gold) 9%, var(--ce-well)); box-shadow: inset 0 0 0 1px var(--ce-line);
  transition: opacity .16s var(--ce-ease), transform .16s var(--ce-ease);
}
@starting-style { .ce-hint { opacity: 0; transform: translateY(4px); } }
.ce-hint-owl { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #0f0f10; box-shadow: inset 0 0 0 1px rgba(215, 190, 152, .55); }
.ce-hint-svg { display: block; width: 20px; height: 20px; }
.ce-hint-svg .owl-eyes { transform: translateY(-1.2px); }
.ce-hint-body { display: grid; gap: 2px; min-width: 0; }
.ce-hint-t { margin: 2px 0 0; font: 500 12px/16px var(--ce-font); color: var(--ce-soft); overflow-wrap: anywhere; }
.ce-hint-off, .ce-hint-x { all: unset; box-sizing: border-box; cursor: pointer; color: var(--ce-muted); }
.ce-hint-off { justify-self: start; font: 500 11px/16px var(--ce-font); text-decoration: underline; text-underline-offset: 2px; }
.ce-hint-x { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; font: 500 15px/1 var(--ce-font); }
.ce-hint-off:hover, .ce-hint-x:hover { color: var(--ce-ink); }
.ce-hint-off:focus-visible, .ce-hint-x:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 1px; }

/* durée (préréglages) et format */
.ce-presets, .ce-fmt { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ce-legend { flex: none; width: 42px; font: 600 11px/14px var(--ce-font); letter-spacing: .02em; color: var(--ce-muted); }
.ce-seg { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 3px; border-radius: 11px; background: var(--ce-well); box-shadow: inset 0 0 0 1px var(--ce-line); min-width: 0; }
.ce-pseg { grid-auto-columns: auto; }
.ce-opt {
  all: unset; box-sizing: border-box; display: grid; place-items: center; height: 28px; border-radius: 8px; cursor: pointer; white-space: nowrap;
  font: 600 12.5px/16px var(--ce-font); color: var(--ce-soft); transition: background-color .15s ease, color .15s ease;
}
.ce-popt { min-width: 40px; height: 26px; padding: 0 7px; font-size: 12px; }
.ce-opt:not([aria-checked="true"]):hover:not(:disabled):not([aria-disabled="true"]) { color: var(--ce-ink); }
.ce-opt[aria-checked="true"] { background: var(--ce-obsidian); color: var(--ce-on-obsidian); box-shadow: var(--ce-shadow); }
.ce-opt:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 1px; }
.ce-opt:disabled { cursor: default; opacity: .55; }
.ce-opt[aria-disabled="true"] { cursor: not-allowed; opacity: .4; }
/* popup (éditeur d'environ 318 px dans sa carte) et menu de 320 px (fenêtre de moins de 376 px : le menu y passe de 352 à 320 px ; le popup fait toujours 380 px) : les
   légendes « Durée » et « Format » restent pour les lecteurs d'écran, la ligne tient. Pas de requête de conteneur : elle
   ajouterait un recalcul des styles à chaque mise en page pendant un glisser. */
.ce[data-variant="popup"] .ce-legend { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 375.98px) {
  .ce-legend { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
.ce-fline {
  display: flex; align-items: baseline; gap: 6px; margin: -2px 2px 0; font: 500 12px/16px var(--ce-font); color: var(--ce-soft);
  transition: opacity .14s ease;
}
@starting-style { .ce-fline { opacity: 0; } }
.ce-fline::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ce-bronze); transform: translateY(-1px); }

/* export */
.ce-foot { display: grid; gap: 8px; }
.ce-gowrap { display: grid; gap: 6px; }
.ce-go {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; height: 44px; border-radius: 12px; cursor: pointer;
  background: var(--ce-obsidian); color: var(--ce-on-obsidian); font: 600 14px/20px var(--ce-font); font-variant-numeric: tabular-nums; box-shadow: var(--ce-shadow);
  transition: transform .12s var(--ce-ease), opacity .15s ease;
}
.ce-go .ico { color: var(--ce-gold); }
@media (hover: hover) and (pointer: fine) { .ce-go:hover:not(:disabled) { transform: translateY(-1px); } }
.ce-go:active:not(:disabled) { transform: scale(.98); transition-duration: .08s; }
.ce-go:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 2px; }
.ce-go:disabled { opacity: .42; cursor: default; }
.ce-why { margin: 0 2px; min-height: 0; font: 500 12px/16px var(--ce-font); color: var(--ce-bad); }
.ce-why:empty { display: none; }
.ce-tools {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; border-radius: 8px;
  cursor: pointer; font: 600 12.5px/16px var(--ce-font); color: var(--ce-soft);
}
.ce-tools .ico { color: var(--ce-gold-text); }
.ce-tools:hover { color: var(--ce-ink); }
.ce-tools:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 2px; }
.ce-quota { margin: 0; text-align: center; font: 500 12px/16px var(--ce-font); color: var(--ce-muted); }

/* avancement de l'export */
.xp { display: grid; gap: 10px; padding: 12px; border-radius: 14px; background: var(--ce-well); box-shadow: inset 0 0 0 1px var(--ce-line); font-family: var(--ce-font); color: var(--ce-ink); }
.xp[hidden] { display: none; }
.xp[data-tone="ok"] { background: var(--ce-ok-bg); box-shadow: none; }
.xp[data-tone="bad"] { background: var(--ce-bad-bg); box-shadow: none; }
.xp-top { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 10px; align-items: center; }
.xp-txt { display: grid; gap: 2px; min-width: 0; }
.xp-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.xp-title { margin: 0; min-width: 0; font: 600 13.5px/18px var(--ce-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.xp-pct { margin-left: auto; flex: none; font: 600 12.5px/18px var(--ce-font); font-variant-numeric: tabular-nums; color: var(--ce-gold-text); }
.xp-pct:empty { display: none; }
.xp-foot { display: flex; align-items: center; gap: 10px; min-height: 0; }
.xp-foot .xp-bar { flex: 1; }
.xp[data-tone="ok"] .xp-title { color: var(--ce-ok); }
.xp[data-tone="bad"] .xp-title { color: var(--ce-bad); }
.xp-detail { margin: 0; font: 500 12px/16px var(--ce-font); color: var(--ce-soft); overflow-wrap: anywhere; }
.xp-acts { display: flex; gap: 6px; margin-left: auto; }
.xp-acts:not(:has(.xp-btn:not([hidden]))) { display: none; }
.xp-foot:not(:has(.xp-bar:not([hidden]))):not(:has(.xp-btn:not([hidden]))) { display: none; }
.xp-btn {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 14px; cursor: pointer;
  font: 600 12px/16px var(--ce-font); color: var(--ce-soft); box-shadow: inset 0 0 0 1px var(--ce-line-strong); transition: background-color .12s ease, color .12s ease;
}
.xp-btn:hover { color: var(--ce-ink); background: color-mix(in srgb, var(--ce-ink) 6%, transparent); }
.xp-btn:focus-visible { outline: 2px solid var(--ce-focus); outline-offset: 2px; }
.xp-btn[hidden] { display: none; }
.xp[data-tone="bad"] .xp-retry { color: var(--ce-bad); box-shadow: inset 0 0 0 1px currentColor; }

/* la chouette officielle et son anneau champagne */
.xp-owl { position: relative; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #0f0f10; box-shadow: inset 0 0 0 1px rgba(215, 190, 152, .55); }
.xp-owl-svg { display: block; width: 24px; height: 24px; transform-origin: 50% 55%; }
.xp-owl .owl-eyes { transform-box: fill-box; transform-origin: 50% 50%; }
.xp-ring {
  position: absolute; inset: -4px; border-radius: 50%; opacity: 0; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0 58%, color-mix(in srgb, var(--ce-gold) 35%, transparent) 72%, var(--ce-gold) 100%);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.6px), #000 calc(100% - 1.6px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 1.6px), #000 calc(100% - 1.6px));
  transition: opacity .45s ease;
}
.xp[data-mood="launch"] .xp-ring, .xp[data-mood="busy"] .xp-ring { opacity: 1; animation: xp-turn 1.2s linear infinite; }
.xp[data-mood="launch"] .xp-owl-svg { animation: xp-react .64s var(--ce-ease); }
.xp[data-mood="launch"] .owl-eyes { animation: xp-look .64s var(--ce-ease); }
.xp[data-mood="busy"] .owl-eyes { animation: xp-scan 2.8s ease-in-out infinite; }
.xp[data-mood="done"] .xp-owl-svg { animation: xp-settle .7s var(--ce-ease); }
.xp[data-mood="error"] .owl-eyes { transform: translateY(1.4px); transition: transform .4s var(--ce-ease); }
@keyframes xp-turn { to { transform: rotate(1turn); } }
@keyframes xp-react { 0% { transform: scale(1); } 38% { transform: scale(1.07); } 100% { transform: scale(1); } }
@keyframes xp-look { 0% { transform: translateY(0); } 35%, 60% { transform: translateY(-2.2px); } 100% { transform: translateY(0); } }
@keyframes xp-scan { 0%, 100% { transform: translateX(0); } 30% { transform: translateX(-1.4px); } 70% { transform: translateX(1.4px); } }
@keyframes xp-settle { 0% { transform: scale(1.05); } 100% { transform: scale(1); } }

/* étapes */
.xp-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; }
.xp-step { position: relative; display: grid; justify-items: center; gap: 4px; min-width: 0; }
.xp-step::before { content: ""; position: absolute; top: 4px; right: 50%; width: 100%; height: 1px; background: var(--ce-line-strong); }
.xp-step:first-child::before { display: none; }
.xp-step[data-state="done"]::before, .xp-step[data-state="current"]::before, .xp-step[data-state="failed"]::before { background: var(--ce-gold); }
.xp-dot { position: relative; z-index: 1; width: 9px; height: 9px; border-radius: 50%; background: var(--ce-well); box-shadow: inset 0 0 0 1.5px var(--ce-line-strong); transition: background-color .25s ease, box-shadow .25s ease; }
.xp-step[data-state="done"] .xp-dot { background: var(--ce-gold); box-shadow: none; }
.xp-step[data-state="current"] .xp-dot { background: var(--ce-field); box-shadow: inset 0 0 0 2px var(--ce-gold), 0 0 0 3px color-mix(in srgb, var(--ce-gold) 25%, transparent); animation: xp-breathe 1.6s ease-in-out infinite; }
.xp-step[data-state="failed"] .xp-dot { background: var(--ce-bad); box-shadow: none; }
.xp[data-phase="done"] .xp-step .xp-dot { background: var(--ce-ok); }
.xp[data-phase="done"] .xp-step::before { background: color-mix(in srgb, var(--ce-ok) 60%, transparent); }
/* Libellés entiers (jamais tronqués) : une étape plus longue que sa colonne déborde sur les marges des voisines. */
.xp-slabel { font: 500 9.5px/13px var(--ce-font); letter-spacing: -.005em; color: var(--ce-muted); white-space: nowrap; }
.xp-step[data-state="current"] .xp-slabel { color: var(--ce-ink); font-weight: 600; }
/* popup (plus étroit) : un peu plus de place pour les cinq étapes */
.ce[data-variant="popup"] .xp { padding: 12px 10px; }
.ce[data-variant="popup"] .xp-slabel { font-size: 9px; letter-spacing: -.01em; }
@keyframes xp-breathe { 50% { box-shadow: inset 0 0 0 2px var(--ce-gold), 0 0 0 5px color-mix(in srgb, var(--ce-gold) 12%, transparent); } }

/* barre : mesurée, ou indéterminée */
.xp-bar { height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--ce-gold) 20%, transparent); }
.xp-bar[hidden] { display: none; }
.xp-bar > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--ce-gold-2), var(--ce-gold)); transform-origin: 0 50%; transform: scaleX(0); transition: transform .3s ease; }
.xp-bar[data-indeterminate] > i { width: 38%; transform: translateX(-100%); animation: xp-slide 1.4s ease-in-out infinite; }
@keyframes xp-slide { from { transform: translateX(-100%); } to { transform: translateX(265%); } }

@media (prefers-reduced-motion: reduce) {
  .ce *, .xp *, .tl *, .tl-lens, .tl-lens * { transition: none !important; animation: none !important; }
  .xp[data-mood="launch"] .xp-ring, .xp[data-mood="busy"] .xp-ring { background: none; box-shadow: inset 0 0 0 1.5px var(--ce-gold); }
  .xp-bar[data-indeterminate] > i { width: 100%; transform: none; opacity: .45; }
}
@media (pointer: coarse) {
  .tl-track { height: 52px; }
  .tl-lens[data-floating] { top: 84px; }
  .tl-h { width: 18px; }
  .tl-h-start { left: calc(var(--a, 0%) - 18px); }
  .tl-grip { top: calc(50% - 9px); height: 18px; }
  .ce-mark, .ce-eopt, .ce-step, .ce-fine, .ce-tools, .ce-opt, .ce-hint-x { min-height: 36px; }
  .ce-input { height: 36px; }
}
`;
