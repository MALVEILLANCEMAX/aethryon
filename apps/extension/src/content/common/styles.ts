// Styles de l'interface intégrée (bouton, menu, panneau flottant), adoptés dans des racines Shadow DOM FERMÉES créées par
// le socle Égide (content/common/apparence.ts) : rien ne fuit vers la page, rien de la page n'entre (« all: initial » sur
// l'hôte et sur .eg-racine coupe aussi l'héritage des propriétés de texte).
// Égide (3.9.0) : TOUTES les couleurs, rayons, durées et courbes viennent des jetons --eg-* du thème choisi par
// l'utilisateur (six thèmes ou le sien) ; les noms courts ci-dessous (--ink, --surface…) sont des alias vers eux, gardés
// pour l'éditeur d'extrait partagé avec le popup. Seule exception : le libellé posé DIRECTEMENT sur la page (bouton rond
// des Shorts et de TikTok) suit le thème clair ou sombre de la page, pour rester lisible sur son fond.
// Mouvement : transform et opacity seulement, durées en jetons (× intensité du thème), mouvement réduit respecté.
import { EXTRAIT_CSS } from "../../extrait/css.ts";

const TOKENS = `
.eg-racine { display: contents; }
.aeth {
  --font: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --p: 0%;
  --ink: var(--eg-c-text); --ink-soft: var(--eg-c-text-2); --muted: var(--eg-c-text-3);
  --surface: var(--eg-c-surface); --surface-2: var(--eg-c-raised); --well: var(--eg-c-sunken);
  --line: var(--eg-c-line); --line-strong: var(--eg-c-line-strong); --control: var(--eg-c-control);
  --gold: var(--eg-c-thread); --gold-light: var(--eg-c-accent-hover); --gold-text: var(--eg-c-accent-text);
  --accent: var(--eg-c-accent); --on-accent: var(--eg-c-on-accent); --accent-soft: var(--eg-c-accent-soft);
  --chip: var(--eg-c-surface); --chip-hover: var(--eg-c-hover); --chip-text: var(--eg-c-text);
  --focus: var(--eg-c-focus);
  --bad: var(--eg-c-err); --bad-bg: var(--eg-c-err-soft); --ok: var(--eg-c-ok); --ok-bg: var(--eg-c-ok-soft);
  --auth-bg: var(--eg-c-accent-soft); --auth-line: var(--eg-c-line-strong);
  --shadow: var(--eg-shadow-pop);
  --button-shadow: none;
  --page-ink: #0f0f0f;
  --d1: var(--eg-d-micro); --d2: var(--eg-d-court); --d3: var(--eg-d-moyen); --e1: var(--eg-e-out);
}
.aeth[data-theme="dark"] { --page-ink: #f1f1f1; }
.aeth, .aeth * , .aeth *::before, .aeth *::after { box-sizing: border-box; }
.aeth { font-family: var(--font); color: var(--ink); -webkit-font-smoothing: antialiased; }
:is([data-eg-motion="reduite"], [data-eg-motion="aucune"]) .aeth .state .draw path { animation: none; stroke-dashoffset: 0; }
/* mouvement réduit du système (sauf choix explicite d'un thème personnel) : les rubans propres à la commande avancent par
   sauts, sans boucle (le socle arrête lui-même la veille et le méandre) */
@media (prefers-reduced-motion: reduce) {
  .aeth :is(.mini > i, .meter > i):not([data-eg-motion-explicite="1"] *) { animation: none; transition: none; }
}
`;

const CONTROL = `
:host { all: initial; display: inline-flex; flex: none; align-items: center; vertical-align: middle; }
:host([hidden]) { display: none !important; }
:host([data-variant="bar"]) { margin-left: 8px; }
:host([data-variant="round"]) { margin: 8px 0; justify-content: center; }
:host([data-variant="x"]) { margin-left: 4px; }
:host([data-variant="quote"]) { display: flex; justify-content: flex-end; margin: 6px 0 2px; }

.aeth { display: inline-flex; align-items: center; position: relative; }

/* ---- bouton : la marque AETHRYON dans la page (chouette maître seule + un mot), au thème de l'utilisateur ---- */
.trigger {
  all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px 0 8px; border-radius: max(var(--eg-r-control), 10px); cursor: pointer; user-select: none;
  font: 600 14px/20px var(--font); color: var(--ink); background: var(--surface); box-shadow: inset 0 0 0 1px var(--control);
  white-space: nowrap; overflow: hidden; -webkit-tap-highlight-color: transparent;
  transition: background-color var(--d2) ease, transform var(--d1) var(--e1);
}
.trigger:active { transform: scale(calc(1 - .03 * var(--eg-move))); }
.trigger[aria-expanded="true"] { box-shadow: inset 0 0 0 1px var(--gold-text); }
@media (hover: hover) and (pointer: fine) { .trigger:hover { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--ink-soft); } }
.trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.mark { position: relative; display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; }
.disc { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; }
.disc svg { display: block; width: 20px; height: 20px; }
.label { display: inline-block; }
.aeth[data-phase="done"] .label { color: var(--ok); }
.aeth[data-phase="error"] .label { color: var(--bad); }
/* fil de progression sous le mot (transform seulement, interpolé entre deux mesures) */
.mini { position: absolute; left: 10px; right: 10px; bottom: 3px; height: 2px; border-radius: 1px; overflow: hidden; opacity: 0; transition: opacity var(--d2) ease; }
.mini > i { display: block; height: 100%; width: 100%; background: var(--gold); transform-origin: 0 50%; transform: scaleX(0); transition: transform var(--eg-d-fil) linear; }
.aeth[data-busy] .mini { opacity: 1; background: var(--line-strong); }
.aeth[data-busy][data-indeterminate] .mini > i { transform: scaleX(.35); animation: aeth-slide calc(1300ms * max(var(--eg-motion-scale), .01)) ease-in-out infinite; }
.aeth[data-compact] .label { display: none; }
.aeth[data-compact] .trigger { padding: 0 7px; }

/* rond (Shorts, TikTok) : pastille de 48 px au thème AETHRYON, libellé dessous (sur la page : couleur de la page) */
.aeth[data-variant="round"] .trigger {
  flex-direction: column; gap: 6px; width: 48px; height: auto; padding: 0; overflow: visible;
  border-radius: 0; background: none; box-shadow: none; font-size: 12px; line-height: 16px; color: var(--page-ink);
}
.aeth[data-variant="round"] .mark { width: 48px; height: 48px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--control); transition: background-color var(--d2) ease; }
@media (hover: hover) and (pointer: fine) { .aeth[data-variant="round"] .trigger:hover .mark { background: var(--surface-2); } .aeth[data-variant="round"] .trigger:hover { background: none; box-shadow: none; } }
.aeth[data-variant="round"] .trigger:focus-visible { outline: none; }
.aeth[data-variant="round"] .trigger:focus-visible .mark { outline: 2px solid var(--focus); outline-offset: 2px; }
.aeth[data-variant="round"] .disc { width: 30px; height: 30px; }
.aeth[data-variant="round"] .disc svg { width: 28px; height: 28px; }
.aeth[data-variant="round"] .label { margin: 0 -16px; text-align: center; }
.aeth[data-variant="round"][data-phase="done"] .label, .aeth[data-variant="round"][data-phase="error"] .label { color: var(--page-ink); }
.aeth[data-variant="round"] .mini { display: none; }
.aeth[data-variant="round"] .mark::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; opacity: 0; transition: opacity var(--d2) ease;
  background: conic-gradient(var(--gold) var(--p, 0%), var(--line-strong) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
}
.aeth[data-variant="round"][data-busy] .mark::before { opacity: 1; }
.aeth[data-variant="round"][data-compact] .label { display: inline-block; }

/* X : plus petit, dans la rangée des actions natives */
.aeth[data-variant="x"] .trigger, .aeth[data-variant="quote"] .trigger { height: 32px; padding: 0 10px 0 6px; gap: 6px; font-size: 13px; }
.aeth[data-variant="x"] .mark, .aeth[data-variant="quote"] .mark,
.aeth[data-variant="x"] .disc, .aeth[data-variant="quote"] .disc { width: 20px; height: 20px; }
.aeth[data-variant="x"] .disc svg, .aeth[data-variant="quote"] .disc svg { width: 18px; height: 18px; }
.aeth[data-variant="x"][data-compact] .trigger { padding: 0 6px; }

/* panneau flottant : bouton principal (l'or : une seule action principale) */
.aeth[data-variant="panel"] .trigger { background: var(--accent); color: var(--on-accent); box-shadow: none; }
@media (hover: hover) and (pointer: fine) { .aeth[data-variant="panel"] .trigger:hover { background: var(--gold-light); box-shadow: none; } }
.aeth[data-variant="panel"][data-phase="done"] .label, .aeth[data-variant="panel"][data-phase="error"] .label { color: inherit; }

/* ---- barre YouTube : sous le lecteur, repliable en une pastille ---------------------------------- */
:host([data-variant="toolbar"]) { display: block; margin: 12px 0 2px; }
.aeth[data-variant="toolbar"] { display: block; }
.tbar {
  container-type: inline-size; display: flex; align-items: center; gap: 2px; min-height: 44px; padding: 4px 6px 4px 4px;
  border-radius: max(var(--eg-r-panel), 12px); background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-strong);
  background-image: var(--eg-sheen);
}
.tbar[data-folded] { container-type: normal; display: inline-flex; min-height: 0; padding: 0; background: none; box-shadow: none; }
.tbar .trigger.tb-brand { height: 36px; padding: 0 12px 0 7px; gap: 8px; background: transparent; box-shadow: none; font: 400 12px/14px var(--eg-f-marque, var(--font)); letter-spacing: .22em; text-transform: uppercase; color: var(--ink); }
@media (hover: hover) and (pointer: fine) { .tbar .trigger.tb-brand:hover { background: var(--chip-hover); box-shadow: none; } }
.tbar[data-folded] .trigger.tb-brand { background: var(--surface); box-shadow: inset 0 0 0 1px var(--control); }
.tbar .tb-brand .mark, .tbar .tb-brand .disc { width: 22px; height: 22px; }
.tbar .tb-brand .disc svg { width: 20px; height: 20px; }
.tbar .tb-brand .mini { display: none; }
.tb-actions { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1 1 auto; }
.tbar[data-folded] .tb-actions, .tbar[data-folded] .tb-chip { display: none; }
.tb-btn {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px;
  border-radius: max(var(--eg-r-control), 8px); cursor: pointer; white-space: nowrap; font: 600 13.5px/20px var(--font); color: var(--ink-soft);
  transition: background-color var(--d2) ease, color var(--d2) ease, transform var(--d1) var(--e1);
}
@media (hover: hover) and (pointer: fine) { .tb-btn:hover { background: var(--chip-hover); color: var(--ink); } }
.tb-btn:active { transform: scale(calc(1 - .03 * var(--eg-move))); }
.tb-btn:focus-visible, .tb-fold:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.tb-btn:disabled { color: var(--muted); cursor: default; transform: none; background: none; }
.tb-btn[hidden] { display: none; }
.tb-btn .ico { color: var(--gold-text); }
.tb-btn:disabled .ico { color: var(--muted); }
/* « Télécharger » : l'action principale de la barre (l'or, une seule fois) */
.tb-dl { background: var(--accent); color: var(--on-accent); }
.tb-dl .ico { color: var(--on-accent); }
@media (hover: hover) and (pointer: fine) { .tb-dl:hover { background: var(--gold-light); color: var(--on-accent); } }
.tb-dl:disabled { background: var(--well); color: var(--muted); }
.tb-chip { margin-left: auto; padding: 0 10px; height: 26px; display: inline-flex; align-items: center; border-radius: 999px; font: 600 12.5px/16px var(--font); color: var(--ink-soft); background: var(--accent-soft); font-variant-numeric: tabular-nums; }
.tb-chip:empty { display: none; }
.tb-chip[data-phase="done"] { color: var(--ok); background: var(--surface); box-shadow: inset 0 0 0 1px var(--ok); }
.tb-chip[data-phase="error"], .tb-chip[data-phase="cancelled"] { color: var(--bad); background: var(--bad-bg); }
.tb-fold { all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; width: 32px; height: 32px; margin-left: 2px; border-radius: 50%; cursor: pointer; color: var(--ink-soft); }
.tb-chip:empty + .tb-fold { margin-left: auto; }
@media (hover: hover) and (pointer: fine) { .tb-fold:hover { background: var(--chip-hover); color: var(--ink); } }
.tbar[data-folded] .tb-fold { margin-left: 4px; color: var(--page-ink); }
@container (max-width: 640px) { .tb-btn:not(.tb-dl) > span { display: none; } .tb-btn:not(.tb-dl) { padding: 0 10px; } }
@container (max-width: 380px) { .tb-brand .label { display: none; } }

/* ---- menu (couche supérieure du navigateur : jamais rogné par la page), 320 px, s'ouvre depuis le bouton ---- */
.pop {
  position: fixed; inset: auto; margin: 0; padding: 10px; width: 320px; max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px); overflow: auto; border: 1px solid var(--line-strong); border-radius: var(--eg-r-panel);
  background: var(--surface); background-image: var(--eg-sheen); color: var(--ink); box-shadow: var(--shadow);
  font: 400 var(--eg-fs-s)/1.45 var(--eg-f-ui); letter-spacing: normal; text-align: left; text-transform: none;
  visibility: hidden; overscroll-behavior: contain; scrollbar-width: thin; --eg-fil-fond: var(--surface);
}
.pop:popover-open { display: flex; flex-direction: column; gap: 8px; }
.pop[data-placed] { visibility: visible; }
.pop::backdrop { background: transparent; }
/* Ouverture : fondu et scale(.96) → 1 depuis le bouton (court, courbe de sortie) ; fermeture plus courte. */
.pop { opacity: 1; transform: none; transform-origin: 0 0; transition: opacity var(--d2) var(--e1), transform var(--d2) var(--e1), display var(--d2) allow-discrete, overlay var(--d2) allow-discrete; }
.pop[data-side="above"] { transform-origin: 0 100%; }
@starting-style { .pop:popover-open { opacity: 0; transform: scale(calc(1 - .04 * var(--eg-move))); } }
.pop[popover]:not(:popover-open) { opacity: 0; transition-duration: var(--d1); }
.head { display: flex; align-items: center; gap: 8px; padding: 0 2px; min-height: 26px; }
.head .disc { width: 22px; height: 22px; }
.head .disc svg { width: 20px; height: 20px; }
.brand { font: 400 12px/14px var(--eg-f-marque, var(--eg-f-ui)); letter-spacing: .22em; text-transform: uppercase; color: var(--ink); }
.plat { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 999px; color: var(--ink-soft); font-size: 12px; font-weight: 600; box-shadow: inset 0 0 0 1px var(--line-strong); }
.plat svg { width: 12px; height: 12px; display: block; }
.views { display: grid; }
.view { display: grid; gap: 8px; min-width: 0; }
.view[hidden] { display: none; }
.view.in-fwd { animation: aeth-in-fwd var(--d2) var(--e1); }
.view.in-back { animation: aeth-in-back var(--d2) var(--e1); }
@keyframes aeth-in-fwd { from { opacity: 0; transform: translateX(calc(10px * var(--eg-move))); } }
@keyframes aeth-in-back { from { opacity: 0; transform: translateX(calc(-10px * var(--eg-move))); } }

/* carte du média : la vidéo d'abord */
.card { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px; border-radius: var(--eg-r-media); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
.thumb { position: relative; display: grid; place-items: center; width: 64px; height: 40px; border-radius: max(calc(var(--eg-r-media) - 2px), 2px); overflow: hidden; background: var(--well); color: var(--muted); }
.thumb img { width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity var(--d3) ease; }
.thumb img[data-loaded] { opacity: 1; }
.thumb svg { width: 16px; height: 16px; }
.card-txt { display: grid; gap: 1px; min-width: 0; }
.title { margin: 0; font: 600 13px/17px var(--eg-f-ui); color: var(--ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.title:empty { display: none; }
.ctx { margin: 0; color: var(--ink-soft); font-size: 12px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctx:empty { display: none; }
.paused { margin: 0; padding: 8px 10px; border-radius: var(--eg-r-control); background: var(--auth-bg); box-shadow: inset 0 0 0 1px var(--auth-line); color: var(--ink-soft); font-size: 12.5px; line-height: 17px; }
.paused[hidden] { display: none; }

/* actions : Vidéo et Audio en deux grandes tuiles, puis Extrait, Image, Miniature, Tools en petites tuiles */
.rows { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.rows[hidden] { display: none; }
.pair { grid-column: span 2; position: relative; display: grid; min-width: 0; }
.sep { display: none; }
.row, .r-more, .choice, .back {
  all: unset; box-sizing: border-box; cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: background-color var(--d2) ease, color var(--d2) ease, border-color var(--d2) ease, transform var(--d1) var(--e1);
}
.row {
  position: relative; display: grid; justify-items: center; align-content: center; gap: 4px; min-height: 64px; padding: 8px 4px; text-align: center;
  border-radius: var(--eg-r-control); color: var(--ink); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line-strong);
}
.row[hidden], .r-more[hidden] { display: none; }
.row:active { transform: scale(calc(1 - .02 * var(--eg-move))); }
.r-ico { display: grid; place-items: center; color: var(--gold-text); }
.r-txt { display: grid; min-width: 0; justify-items: center; }
.r-label { font: 600 12.5px/16px var(--eg-f-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.r-sub { font-size: 11.5px; line-height: 15px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.r-val { font-variant-numeric: tabular-nums; }
.r-go { display: none; }
/* grande tuile : l'icône, l'action (deux lignes au plus), le réglage (qualité ou débit) ; la flèche du réglage à droite */
.r-video, .r-audio { min-height: 78px; padding: 9px 30px 9px 10px; justify-items: start; align-content: start; text-align: left; gap: 3px; }
.r-video .r-txt, .r-audio .r-txt { justify-items: start; }
.r-video .r-label, .r-audio .r-label { font-size: 13px; white-space: normal; line-height: 16px; }
.r-video { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--gold-text); }
.r-more { position: absolute; top: 4px; right: 4px; bottom: 4px; display: grid; place-items: center; width: 24px; border-radius: max(calc(var(--eg-r-control) - 3px), 4px); color: var(--ink-soft); }
@media (hover: hover) and (pointer: fine) {
  .row:hover { box-shadow: inset 0 0 0 1px var(--ink-soft); }
  .r-video:hover { box-shadow: inset 0 0 0 2px var(--gold-text); }
  .r-more:hover, .choice:hover, .back:hover { background: var(--chip-hover); color: var(--ink); }
}
.row:focus-visible, .r-more:focus-visible, .choice:focus-visible, .back:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.row:disabled, .r-more:disabled { color: var(--muted); cursor: default; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); transform: none; }
.row:disabled .r-ico, .row:disabled .r-sub { color: var(--muted); }
.group { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.group[hidden] { display: none; }
.legend { padding: 0; font: 600 12px/16px var(--eg-f-ui); color: var(--ink-soft); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.opt {
  all: unset; box-sizing: border-box; position: relative; display: grid; place-items: center; min-height: 30px; padding: 0 12px; border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--control); font: 600 12.5px/16px var(--eg-f-ui); color: var(--ink-soft); cursor: pointer; user-select: none;
  transition: background-color var(--d2) ease, color var(--d2) ease;
}
.opt input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .opt:hover { color: var(--ink); } }
.opt:has(input:checked), .opt[aria-checked="true"] { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 1px var(--gold-text); }
.opt:has(input:focus-visible), .opt:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.opt:has(input:disabled) { color: var(--muted); cursor: default; }

/* sous-vues : Qualité, Débit */
.vhead { display: flex; align-items: center; }
.back { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px 0 6px; border-radius: var(--eg-r-control); font: 600 13px/18px var(--eg-f-ui); color: var(--ink); }
.back .ico { color: var(--ink-soft); }
.choices { display: grid; gap: 2px; }
.choice { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 0 10px; border-radius: var(--eg-r-control); font: 500 13.5px/18px var(--eg-f-ui); color: var(--ink); }
.choice .tick { color: var(--gold-text); opacity: 0; transition: opacity var(--d2) ease; }
.choice[aria-checked="true"] { font-weight: 600; background: var(--accent-soft); }
.choice[aria-checked="true"] .tick { opacity: 1; }

/* sous-vue Extrait : éditeur partagé avec le popup (src/extrait/css.ts) ; menu un peu plus large pour la réglette. */
.pop[data-view="clip"] { width: 352px; }
.c-empty { margin: 4px 6px 8px; color: var(--ink-soft); font-size: 12.5px; line-height: 17px; }
.c-empty[hidden], .c-body[hidden] { display: none; }
.c-body { display: grid; padding: 2px 2px 4px; min-width: 0; }
.status[data-in-editor] { display: none; }
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 2px; border-radius: var(--eg-r-control); background: var(--well); box-shadow: inset 0 0 0 1px var(--control); }
.seg .opt { box-shadow: none; border-radius: max(calc(var(--eg-r-control) - 2px), 0px); min-height: 30px; }
.seg .opt:has(input:checked), .seg .opt[aria-checked="true"] { background: var(--surface-2); box-shadow: 0 0 0 1px var(--line-strong); }
/* destination (Téléchargements | Premiere Pro), au-dessus des tuiles Vidéo et Audio */
.dest { display: grid; gap: 6px; margin: 0; min-width: 0; }
.dest[hidden] { display: none; }
.d-seg .opt { padding: 0 8px; white-space: nowrap; }
.d-note { margin: 0 2px; color: var(--ink-soft); font-size: 12px; line-height: 16px; }
.d-note[hidden] { display: none; }
.go {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 42px; border-radius: var(--eg-r-control); cursor: pointer; background: var(--accent); color: var(--on-accent);
  font: 600 14px/20px var(--eg-f-ui); transition: background-color var(--d2) ease, transform var(--d1) var(--e1);
}
.go .ico { color: var(--on-accent); }
@media (hover: hover) and (pointer: fine) { .go:hover { background: var(--gold-light); } }
.go:active { transform: scale(calc(1 - .03 * var(--eg-move))); }
.go:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.go:disabled { background: var(--well); color: var(--muted); cursor: default; transform: none; }
.go:disabled .ico { color: var(--muted); }
.linkish { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; border-radius: var(--eg-r-control); color: var(--ink-soft); font: 600 12.5px/16px var(--eg-f-ui); cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .linkish:hover { color: var(--ink); } }
.linkish .ico { color: var(--gold-text); }
.linkish:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.linkish[hidden] { display: none; }

/* état du travail de CE média : le fil, le nœud, puis le résultat */
.status { display: grid; gap: 8px; padding: 10px 12px; border-radius: var(--eg-r-control); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line-strong); transition: opacity var(--d3) var(--e1), transform var(--d3) var(--e1); }
@starting-style { .status { opacity: 0; transform: translateY(calc(4px * var(--eg-move))); } }
.status[hidden] { display: none; }
.s-top { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.state { display: flex; align-items: center; gap: 6px; margin-right: auto; font-weight: 600; font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
.state svg { width: 14px; height: 14px; flex: none; }
.state .draw path { stroke-dasharray: 16; stroke-dashoffset: 16; animation: aeth-draw calc(200ms * var(--eg-motion-scale)) calc(120ms * var(--eg-motion-scale)) var(--e1) forwards; }
@keyframes aeth-draw { to { stroke-dashoffset: 0; } }
.sbtn {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: var(--eg-r-control); cursor: pointer;
  font: 600 12px/16px var(--eg-f-ui); color: var(--ink-soft); box-shadow: inset 0 0 0 1px var(--control); transition: background-color var(--d2) ease, color var(--d2) ease;
}
@media (hover: hover) and (pointer: fine) { .sbtn:hover { background: var(--chip-hover); color: var(--ink); } }
.sbtn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.sbtn[hidden] { display: none; }
.sbtn.retry { justify-self: start; color: var(--bad); box-shadow: inset 0 0 0 1px currentColor; }
.meter { position: relative; height: 4px; border-radius: 2px; overflow: hidden; background: var(--line-strong); }
.meter[hidden] { display: none; }
.meter > i { display: block; height: 100%; width: 100%; border-radius: inherit; background: var(--gold); transform-origin: 0 50%; transform: scaleX(0); transition: transform var(--eg-d-fil) linear; }
.status[data-indeterminate] .meter > i { transform: scaleX(.35); animation: aeth-slide calc(1300ms * max(var(--eg-motion-scale), .01)) ease-in-out infinite; }
:is([data-eg-motion="reduite"], [data-eg-motion="aucune"]) .aeth :is(.meter > i, .mini > i) { transition: none; animation: none; }
/* le vert du sens n'est jamais posé sur son fond doux (paire non garantie par le socle) : surface et liseré */
.status[data-phase="done"] { background: var(--surface); box-shadow: inset 0 0 0 1px var(--ok); }
.status[data-phase="done"] .state { color: var(--ok); }
.status[data-phase="done"] .sbtn { box-shadow: inset 0 0 0 1px var(--ok); color: var(--ok); }
.status[data-phase="error"], .status[data-phase="cancelled"] { background: var(--bad-bg); box-shadow: none; }
.status[data-phase="error"] .state, .status[data-phase="cancelled"] .state { color: var(--bad); }
.msg { margin: 0; font-size: 12.5px; line-height: 17px; color: var(--ink); overflow-wrap: anywhere; }
.msg:empty { display: none; }
.s-note { color: var(--ink-soft); font-size: 12px; line-height: 16px; }
/* connexion depuis la page : « Se connecter à AETHRYON », « Lire la notice », lien « Mes jetons » */
.act {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 38px; padding: 0 14px; border-radius: var(--eg-r-control); cursor: pointer; text-align: center;
  background: var(--accent); color: var(--on-accent); font: 600 13.5px/18px var(--eg-f-ui);
  transition: background-color var(--d2) ease, transform var(--d1) var(--e1);
}
.act[hidden] { display: none; }
@media (hover: hover) and (pointer: fine) { .act:hover { background: var(--gold-light); } }
.act:active { transform: scale(calc(1 - .03 * var(--eg-move))); }
.act:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.act:disabled { background: var(--well); color: var(--ink-soft); cursor: progress; transform: none; }
.keys { justify-self: start; color: var(--ink); font: 600 12.5px/16px var(--eg-f-ui); text-decoration: underline; text-decoration-color: var(--gold); text-underline-offset: 3px; }
.keys[hidden] { display: none; }
.keys:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.status[data-phase="auth"], .status[data-phase="signing"] { background: var(--auth-bg); box-shadow: inset 0 0 0 1px var(--auth-line); }
.status[data-phase="auth"] .state, .status[data-phase="signing"] .state { color: var(--ink); }
.status[data-phase="linked"] { background: var(--surface); box-shadow: inset 0 0 0 1px var(--ok); }
.status[data-phase="linked"] .state { color: var(--ok); }
/* doigt : cibles de 44 px */
@media (pointer: coarse) {
  .choice, .back { min-height: 44px; }
  .r-more { width: 40px; }
  .sbtn { min-height: 40px; }
  .opt { min-height: 40px; }
}
@keyframes aeth-slide { from { transform: translateX(-35%) scaleX(.35); } to { transform: translateX(100%) scaleX(.35); } }
`;

const PANEL = `
:host { all: initial; position: fixed !important; z-index: 2147483000 !important; display: block !important; margin: 0 !important; }
:host([hidden]) { display: none !important; }
.panel {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px;
  width: 340px; max-width: calc(100vw - 32px); padding: 8px 8px 8px 4px; border-radius: var(--eg-r-sheet);
  background: var(--surface); background-image: var(--eg-sheen); color: var(--ink); border: 1px solid var(--line-strong); box-shadow: var(--shadow);
  font-family: var(--eg-f-ui);
}
.grip {
  all: unset; box-sizing: border-box; display: grid; place-items: center; width: 22px; height: 40px;
  border-radius: var(--eg-r-control); color: var(--ink-soft); cursor: grab; touch-action: none;
}
.grip::before { content: ""; width: 8px; height: 16px; background: radial-gradient(circle, currentColor 1.2px, transparent 1.7px) 0 0 / 4px 4px; }
@media (hover: hover) and (pointer: fine) { .grip:hover { background: var(--chip-hover); } }
.grip:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.panel[data-dragging] .grip, .panel[data-dragging] .info { cursor: grabbing; }
.info { display: grid; gap: 1px; min-width: 0; cursor: grab; touch-action: none; user-select: none; }
.kicker { display: flex; align-items: center; gap: 6px; font: 400 11px/14px var(--eg-f-marque, var(--eg-f-ui)); letter-spacing: .22em; text-transform: uppercase; color: var(--ink); }
.kicker svg { width: 11px; height: 11px; display: block; color: var(--ink-soft); }
.ptitle { font: 500 13px/18px var(--eg-f-ui); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.glyph-acc { color: var(--gold); }
`;

export const CONTROL_CSS = TOKENS + CONTROL + EXTRAIT_CSS;
/** Panneau flottant : adopté APRÈS CONTROL_CSS dans la même racine (feuilles partagées, jamais deux fois le même texte). */
export const PANEL_CSS = PANEL;
