// Styles de l'interface intégrée, injectés dans des racines Shadow DOM fermées : rien ne fuit vers la
// page, rien de la page n'entre (« all: initial » coupe aussi l'héritage des propriétés de texte).
// Couleurs : jetons du kit AETHRYON (web/src/styles.css) — ivoire, perle, sable, obsidienne, or antique.
import { EXTRAIT_CSS } from "../../extrait/css.ts";

const TOKENS = `
.aeth {
  --font: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --p: 0%;
  --ink: #141413; --ink-soft: #4a463f; --muted: #6b6459;
  --surface: #faf8f3; --surface-2: #f4efe7; --line: #e2d8c9; --line-strong: #cfbfa7;
  --gold: #d4af7c; --gold-light: #e3cda6; --gold-text: #7a5f38;
  --accent: #0f0f10; --on-accent: #faf8f3;
  --chip: rgba(0, 0, 0, .05); --chip-hover: rgba(0, 0, 0, .1); --chip-text: #0f0f0f;
  --x-text: #536471; --focus: #7a5f38;
  --bad: #a3372b; --bad-bg: #f6e3de; --ok: #2f6b47; --ok-bg: #e6efe6;
  --auth-bg: #f5eddf; --auth-line: rgba(168, 131, 79, .35);
  --shadow: 0 1px 0 rgba(255, 255, 255, .7) inset, 0 24px 60px -28px rgba(15, 15, 16, .42), 0 0 0 1px rgba(15, 15, 16, .05);
  /* pastille de la chouette (tête maître sur obsidienne, cercle champagne) et ombre du bouton principal */
  --disc-bg: #0f0f10; --disc-ring: rgba(215, 190, 152, .6);
  --button-shadow: inset 0 1px 0 rgba(255, 255, 255, .14), 0 1px 1px rgba(15, 15, 16, .28), 0 12px 24px -14px rgba(15, 15, 16, .7);
}
.aeth[data-theme="dark"] {
  --ink: #faf8f3; --ink-soft: #d9d1c4; --muted: #b3a999;
  --surface: #18181a; --surface-2: #232325; --line: #2e2c29; --line-strong: #4a463f;
  --gold-text: #e3cda6; --accent: #faf8f3; --on-accent: #0f0f10;
  --chip: rgba(255, 255, 255, .1); --chip-hover: rgba(255, 255, 255, .2); --chip-text: #f1f1f1;
  --x-text: #71767b; --focus: #d4af7c;
  --bad: #f2a497; --bad-bg: #3b1f1a; --ok: #9fd3b0; --ok-bg: #1b2d22;
  --auth-bg: #2a2419; --auth-line: rgba(212, 175, 124, .3);
  --shadow: inset 0 1px 0 rgba(255, 255, 255, .05), 0 18px 44px -22px rgba(0, 0, 0, .85), 0 0 0 1px rgba(255, 255, 255, .06);
}
.aeth, .aeth * , .aeth *::before, .aeth *::after { box-sizing: border-box; }
.aeth { font-family: var(--font); color: var(--ink); -webkit-font-smoothing: antialiased; }
@media (prefers-reduced-motion: reduce) {
  .aeth *, .aeth *::before, .aeth *::after { transition: none !important; animation: none !important; }
  .aeth .state .draw path { stroke-dashoffset: 0 !important; }
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

/* ---- bouton ---------------------------------------------------------------------------- */
.trigger {
  all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px 0 6px; border-radius: 18px; cursor: pointer; user-select: none;
  font: 500 14px/20px var(--font); color: var(--chip-text); background: var(--chip);
  white-space: nowrap; overflow: hidden; -webkit-tap-highlight-color: transparent;
  transition: background-color .15s ease, color .15s ease;
}
.trigger:hover { background: var(--chip-hover); }
.trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.mark { position: relative; display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 50%; }
.disc {
  display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
  background: var(--disc-bg); box-shadow: inset 0 0 0 1px var(--disc-ring);
}
.disc svg { display: block; width: 18px; height: 18px; }
.label { display: inline-block; }
.aeth[data-phase="done"] .label { color: var(--ok); }
.aeth[data-phase="error"] .label { color: var(--bad); }
.mini { position: absolute; left: 12px; right: 12px; bottom: 3px; height: 2px; border-radius: 1px; overflow: hidden; opacity: 0; transition: opacity .2s; }
.mini > i { display: block; height: 100%; width: var(--p, 0%); background: var(--gold); transition: width .3s ease; }
.aeth[data-busy] .mini { opacity: 1; background: color-mix(in srgb, var(--gold) 25%, transparent); }
.aeth[data-busy][data-indeterminate] .mini > i { width: 35%; animation: aeth-slide 1.3s ease-in-out infinite; }
.aeth[data-compact] .label { display: none; }
.aeth[data-compact] .trigger { padding: 0 6px; }

/* rond (Shorts, TikTok) : bouton de 48 px, libellé dessous, anneau de progression */
.aeth[data-variant="round"] .trigger {
  flex-direction: column; gap: 6px; width: 48px; height: auto; padding: 0; overflow: visible;
  border-radius: 0; background: none; font-size: 12px; line-height: 16px;
}
.aeth[data-variant="round"] .mark { width: 48px; height: 48px; background: var(--chip); transition: background-color .15s ease; }
.aeth[data-variant="round"] .trigger:hover .mark { background: var(--chip-hover); }
.aeth[data-variant="round"] .trigger:focus-visible { outline: none; }
.aeth[data-variant="round"] .trigger:focus-visible .mark { outline: 2px solid var(--focus); outline-offset: 2px; }
.aeth[data-variant="round"] .disc { width: 34px; height: 34px; }
.aeth[data-variant="round"] .disc svg { width: 26px; height: 26px; }
.aeth[data-variant="round"] .label { margin: 0 -16px; text-align: center; }
.aeth[data-variant="round"] .mini { display: none; }
.aeth[data-variant="round"] .mark::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; opacity: 0; transition: opacity .2s;
  background: conic-gradient(var(--gold) var(--p, 0%), color-mix(in srgb, var(--gold) 22%, transparent) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
}
.aeth[data-variant="round"][data-busy] .mark::before { opacity: 1; }
.aeth[data-variant="round"][data-compact] .label { display: inline-block; }

/* X : discret, couleur des actions natives */
.aeth[data-variant="x"] .trigger, .aeth[data-variant="quote"] .trigger {
  height: 32px; padding: 0 10px 0 5px; gap: 6px; border-radius: 16px; font-size: 13px; color: var(--x-text); background: transparent;
}
.aeth[data-variant="quote"] .trigger { background: var(--chip); }
.aeth[data-variant="x"] .trigger:hover, .aeth[data-variant="quote"] .trigger:hover { background: color-mix(in srgb, var(--gold) 18%, transparent); color: var(--chip-text); }
.aeth[data-variant="x"] .mark, .aeth[data-variant="quote"] .mark,
.aeth[data-variant="x"] .disc, .aeth[data-variant="quote"] .disc { width: 22px; height: 22px; }
.aeth[data-variant="x"] .disc svg, .aeth[data-variant="quote"] .disc svg { width: 16px; height: 16px; }
.aeth[data-variant="x"][data-compact] .trigger { padding: 0 5px; }

/* panneau flottant : bouton principal */
.aeth[data-variant="panel"] .trigger { background: var(--accent); color: var(--on-accent); }
.aeth[data-variant="panel"] .trigger:hover { background: var(--accent); opacity: .9; }
.aeth[data-variant="panel"] .aeth-ok, .aeth[data-variant="panel"][data-phase="done"] .label { color: inherit; }

/* ---- barre YouTube (V3.5) : sous le lecteur, repliable en une pastille ----------------------- */
:host([data-variant="toolbar"]) { display: block; margin: 12px 0 2px; }
.aeth[data-variant="toolbar"] { display: block; }
.tbar {
  container-type: inline-size; display: flex; align-items: center; gap: 2px; min-height: 44px; padding: 4px 6px 4px 4px;
  border-radius: 14px; background: var(--chip); color: var(--chip-text);
}
.tbar[data-folded] { container-type: normal; display: inline-flex; min-height: 0; padding: 0; background: none; }
.tbar .trigger.tb-brand { height: 36px; padding: 0 12px 0 5px; gap: 7px; background: transparent; font: 600 11.5px/14px var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--gold-text); }
.tbar .trigger.tb-brand:hover { background: var(--chip-hover); }
.tbar[data-folded] .trigger.tb-brand { background: var(--chip); }
.tbar .tb-brand .mark, .tbar .tb-brand .disc { width: 24px; height: 24px; }
.tbar .tb-brand .disc svg { width: 16px; height: 16px; }
.tbar .tb-brand .mini { display: none; }
.tb-actions { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1 1 auto; }
.tbar[data-folded] .tb-actions, .tbar[data-folded] .tb-chip { display: none; }
.tb-btn {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px;
  border-radius: 18px; cursor: pointer; white-space: nowrap; font: 500 14px/20px var(--font); color: var(--chip-text);
  transition: background-color .15s ease, transform .1s ease;
}
.tb-btn:hover { background: var(--chip-hover); }
.tb-btn:active { transform: scale(.97); }
.tb-btn:focus-visible, .tb-fold:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.tb-btn:disabled { opacity: .45; cursor: default; transform: none; }
.tb-btn[hidden] { display: none; }
.tb-btn .ico { color: var(--gold-text); }
.tb-dl { font-weight: 600; }
.tb-chip { margin-left: auto; padding: 0 10px; height: 26px; display: inline-flex; align-items: center; border-radius: 13px; font: 600 12.5px/16px var(--font); color: var(--gold-text); background: color-mix(in srgb, var(--gold) 16%, transparent); font-variant-numeric: tabular-nums; }
.tb-chip:empty { display: none; }
.tb-chip[data-phase="done"] { color: var(--ok); background: var(--ok-bg); }
.tb-chip[data-phase="error"], .tb-chip[data-phase="cancelled"] { color: var(--bad); background: var(--bad-bg); }
.tb-fold { all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; width: 32px; height: 32px; margin-left: 2px; border-radius: 50%; cursor: pointer; color: var(--muted); }
.tb-chip:empty + .tb-fold { margin-left: auto; }
.tb-fold:hover { background: var(--chip-hover); color: var(--chip-text); }
.tbar[data-folded] .tb-fold { margin-left: 4px; }
@container (max-width: 640px) { .tb-btn:not(.tb-dl) > span { display: none; } .tb-btn:not(.tb-dl) { padding: 0 10px; } }
@container (max-width: 380px) { .tb-brand .label { display: none; } }

/* ---- menu (couche supérieure du navigateur : jamais rogné par la page) ---------------------- */
.pop {
  position: fixed; inset: auto; margin: 0; padding: 8px; width: 316px; max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px); overflow: auto; border: 1px solid var(--line); border-radius: 16px;
  background: var(--surface); color: var(--ink); box-shadow: var(--shadow);
  font: 400 13px/18px var(--font); letter-spacing: normal; text-align: left; text-transform: none;
  visibility: hidden; overscroll-behavior: contain; scrollbar-width: thin;
}
.pop:popover-open { display: flex; flex-direction: column; gap: 6px; }
.pop[data-placed] { visibility: visible; }
.pop::backdrop { background: transparent; }
/* Ouverture : fondu et léger agrandissement depuis le bouton (160 ms) ; fermeture : fondu court. */
.pop { opacity: 1; transform: none; transform-origin: 50% 0; transition: opacity .16s ease, transform .18s cubic-bezier(.2, .8, .2, 1), display .16s allow-discrete, overlay .16s allow-discrete; }
.pop[data-side="above"] { transform-origin: 50% 100%; }
@starting-style { .pop:popover-open { opacity: 0; transform: translateY(-4px) scale(.98); } }
.pop[popover]:not(:popover-open) { opacity: 0; transition-duration: .1s; }
.head { display: flex; align-items: center; gap: 8px; padding: 4px 6px 2px; }
.head .disc { width: 22px; height: 22px; }
.head .disc svg { width: 16px; height: 16px; }
.brand { font: 600 11px/14px var(--font); letter-spacing: .16em; text-transform: uppercase; color: var(--gold-text); }
.plat { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 11.5px; }
.plat svg { width: 12px; height: 12px; display: block; }
.views { display: grid; }
.view { display: grid; gap: 4px; min-width: 0; }
.view[hidden] { display: none; }
.view.in-fwd { animation: aeth-in-fwd .18s cubic-bezier(.2, .8, .2, 1); }
.view.in-back { animation: aeth-in-back .18s cubic-bezier(.2, .8, .2, 1); }
@keyframes aeth-in-fwd { from { opacity: 0; transform: translateX(10px); } }
@keyframes aeth-in-back { from { opacity: 0; transform: translateX(-10px); } }

/* carte du média */
.card { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px; border-radius: 12px; background: var(--surface-2); }
.thumb { position: relative; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 10px; overflow: hidden; background: var(--line); color: var(--muted); }
.thumb img { width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .25s ease; }
.thumb img[data-loaded] { opacity: 1; }
.thumb svg { width: 16px; height: 16px; }
.card-txt { display: grid; gap: 2px; min-width: 0; }
.title { margin: 0; font: 600 13.5px/18px var(--font); color: var(--ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.title:empty { display: none; }
.ctx { margin: 0; color: var(--muted); font-size: 12px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctx:empty { display: none; }
.paused { margin: 2px 0; padding: 8px 10px; border-radius: 10px; background: var(--auth-bg); border: 1px solid var(--auth-line); color: var(--gold-text); font-size: 12.5px; line-height: 17px; }
.paused[hidden] { display: none; }

/* lignes d'action */
.rows { display: grid; gap: 1px; }
.rows[hidden] { display: none; }
.pair { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px; align-items: stretch; }
.row, .r-more, .choice, .back {
  all: unset; box-sizing: border-box; cursor: pointer; border-radius: 9px; -webkit-tap-highlight-color: transparent;
  transition: background-color .12s ease, color .12s ease;
}
.row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 36px; padding: 6px 10px; color: var(--ink); }
.row[hidden], .r-more[hidden] { display: none; }
.r-ico { display: grid; place-items: center; color: var(--gold-text); }
.r-txt { display: grid; min-width: 0; }
.r-label { font: 500 13.5px/18px var(--font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r-sub { font-size: 11.5px; line-height: 15px; color: var(--muted); }
.r-val { font-variant-numeric: tabular-nums; }
.r-go { display: grid; place-items: center; color: var(--muted); }
.r-more { display: grid; place-items: center; width: 32px; color: var(--muted); }
.row:hover, .r-more:hover, .choice:hover, .back:hover { background: var(--chip); }
.row:focus-visible, .r-more:focus-visible, .choice:focus-visible, .back:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.row:active, .r-more:active { background: var(--chip-hover); }
.row:disabled, .r-more:disabled { opacity: .45; cursor: default; background: none; }
.r-video .r-label { font-weight: 600; }
.sep { height: 1px; margin: 3px 8px; border: 0; background: var(--line); }
.sep[hidden] { display: none; }
.group { display: grid; gap: 6px; margin: 2px 4px 4px; padding: 0; border: 0; min-width: 0; }
.group[hidden] { display: none; }
.legend { padding: 0; font: 600 11px/14px var(--font); letter-spacing: .04em; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.opt {
  all: unset; box-sizing: border-box; position: relative; display: grid; place-items: center; min-height: 28px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--line-strong); font: 600 12.5px/16px var(--font); color: var(--ink-soft); cursor: pointer; user-select: none;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}
.opt input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.opt:hover { color: var(--ink); }
.opt:has(input:checked), .opt[aria-checked="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.opt:has(input:focus-visible), .opt:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.opt:has(input:disabled) { opacity: .55; cursor: default; }

/* sous-vues : Qualité, Débit */
.vhead { display: flex; align-items: center; padding: 0 0 2px; }
.back { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px 0 6px; font: 600 13px/18px var(--font); color: var(--ink); }
.back .ico { color: var(--muted); }
.choices { display: grid; gap: 1px; }
.choice { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 0 10px; font: 500 13.5px/18px var(--font); color: var(--ink); }
.choice .tick { color: var(--gold-text); opacity: 0; }
.choice[aria-checked="true"] { font-weight: 600; }
.choice[aria-checked="true"] .tick { opacity: 1; }

/* sous-vue Extrait (3.6.0) : éditeur partagé avec le popup (src/extrait/css.ts) ; le menu s'élargit un peu pour la
   réglette, sans jamais dépasser la fenêtre. */
.pop[data-view="clip"] { width: 352px; }
.c-empty { margin: 4px 6px 8px; color: var(--muted); font-size: 12.5px; line-height: 17px; }
.c-empty[hidden], .c-body[hidden] { display: none; }
.c-body { display: grid; padding: 2px 4px 4px; min-width: 0; }
.status[data-in-editor] { display: none; }
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 3px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); }
.seg .opt { border: 0; border-radius: 9px; min-height: 28px; }
/* 3.5.1 : destination (Téléchargements | Premiere Pro), au-dessus des lignes Vidéo et Audio */
.dest { display: grid; gap: 6px; margin: 2px 4px 4px; min-width: 0; }
.dest[hidden] { display: none; }
.d-seg .opt { padding: 0 8px; white-space: nowrap; }
.d-note { margin: 0 2px; color: var(--muted); font-size: 12px; line-height: 16px; }
.d-note[hidden] { display: none; }
.go {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 40px; border-radius: 12px; cursor: pointer; background: var(--accent); color: var(--on-accent);
  font: 600 14px/20px var(--font); box-shadow: var(--button-shadow);
  transition: opacity .15s ease, transform .1s ease;
}
.go .ico { color: var(--gold); }
.go:hover { opacity: .92; }
.go:active { transform: translateY(1px) scale(.995); }
.go:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.go:disabled { opacity: .45; cursor: default; transform: none; }
.linkish { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; border-radius: 8px; color: var(--ink-soft); font: 600 12.5px/16px var(--font); cursor: pointer; }
.linkish:hover { color: var(--ink); }
.linkish .ico { color: var(--gold-text); }
.linkish:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.linkish[hidden] { display: none; }

/* état du travail de CE média */
.status { display: grid; gap: 8px; margin-top: 2px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); animation: aeth-rise .2s cubic-bezier(.2, .8, .2, 1); }
.status[hidden] { display: none; }
@keyframes aeth-rise { from { opacity: 0; transform: translateY(4px); } }
.s-top { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.state { display: flex; align-items: center; gap: 6px; margin-right: auto; font-weight: 600; font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
.state svg { width: 14px; height: 14px; flex: none; }
.state .draw path { stroke-dasharray: 16; stroke-dashoffset: 16; animation: aeth-draw .34s .04s cubic-bezier(.3, .7, .2, 1) forwards; }
@keyframes aeth-draw { to { stroke-dashoffset: 0; } }
.sbtn {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 13px; cursor: pointer;
  font: 600 12px/16px var(--font); color: var(--ink-soft); border: 1px solid var(--line-strong); transition: background-color .12s ease;
}
.sbtn:hover { background: var(--chip); color: var(--ink); }
.sbtn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.sbtn[hidden] { display: none; }
.sbtn.retry { justify-self: start; border-color: currentColor; color: var(--bad); }
.meter { height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--gold) 22%, transparent); }
.meter[hidden] { display: none; }
.meter > i { display: block; height: 100%; width: var(--p, 0%); border-radius: inherit; background: linear-gradient(90deg, var(--gold-light), var(--gold)); transition: width .3s ease; }
.status[data-indeterminate] .meter > i { width: 35%; animation: aeth-slide 1.3s ease-in-out infinite; }
.status[data-phase="done"] { background: var(--ok-bg); border-color: transparent; }
.status[data-phase="done"] .state { color: var(--ok); }
.status[data-phase="done"] .sbtn { border-color: color-mix(in srgb, var(--ok) 45%, transparent); color: var(--ok); }
.status[data-phase="error"], .status[data-phase="cancelled"] { background: var(--bad-bg); border-color: transparent; }
.status[data-phase="error"] .state, .status[data-phase="cancelled"] .state { color: var(--bad); }
.msg { margin: 0; font-size: 12.5px; line-height: 17px; color: var(--ink); overflow-wrap: anywhere; }
.msg:empty { display: none; }
.s-note { color: var(--muted); font-size: 12px; line-height: 16px; }
/* connexion depuis la page : « Se connecter à AETHRYON », « Lire la notice », lien « Mes jetons » */
.act {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 36px; padding: 0 14px; border-radius: 10px; cursor: pointer; text-align: center;
  background: var(--accent); color: var(--on-accent); font: 600 13.5px/18px var(--font); box-shadow: var(--button-shadow);
  transition: opacity .15s ease;
}
.act[hidden] { display: none; }
.act:hover { opacity: .92; }
.act:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.act:disabled { opacity: .7; cursor: progress; }
.keys { justify-self: start; color: var(--ink); font: 600 12.5px/16px var(--font); text-decoration: underline; text-decoration-color: var(--gold); text-underline-offset: 3px; }
.keys[hidden] { display: none; }
.keys:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.status[data-phase="auth"], .status[data-phase="signing"] { background: var(--auth-bg); border-color: var(--auth-line); }
.status[data-phase="auth"] .state, .status[data-phase="signing"] .state { color: var(--gold-text); }
.status[data-phase="linked"] { background: var(--ok-bg); border-color: transparent; }
.status[data-phase="linked"] .state { color: var(--ok); }
/* doigt : cibles de 44 px */
@media (pointer: coarse) {
  .row, .choice { min-height: 44px; }
  .r-more { width: 44px; }
  .sbtn { min-height: 40px; }
}
@keyframes aeth-slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
`;

const PANEL = `
:host { all: initial; position: fixed !important; z-index: 2147483000 !important; display: block !important; margin: 0 !important; }
:host([hidden]) { display: none !important; }
.panel {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px;
  width: 340px; max-width: calc(100vw - 32px); padding: 8px 8px 8px 4px; border-radius: 18px;
  background: var(--surface); color: var(--ink); border: 1px solid var(--line); box-shadow: var(--shadow);
}
.grip {
  all: unset; box-sizing: border-box; display: grid; place-items: center; width: 22px; height: 40px;
  border-radius: 8px; color: var(--muted); cursor: grab; touch-action: none;
}
.grip::before { content: ""; width: 8px; height: 16px; background: radial-gradient(circle, currentColor 1.2px, transparent 1.7px) 0 0 / 4px 4px; }
.grip:hover { background: var(--chip); }
.grip:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.panel[data-dragging] .grip, .panel[data-dragging] .info { cursor: grabbing; }
.info { display: grid; gap: 1px; min-width: 0; cursor: grab; touch-action: none; user-select: none; }
.kicker { display: flex; align-items: center; gap: 6px; font: 600 10.5px/14px var(--font); letter-spacing: .16em; text-transform: uppercase; color: var(--gold-text); }
.kicker svg { width: 11px; height: 11px; display: block; color: var(--muted); }
.ptitle { font: 500 13px/18px var(--font); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.glyph-acc { color: var(--gold); }
`;

export const CONTROL_CSS = TOKENS + CONTROL + EXTRAIT_CSS;
export const PANEL_CSS = TOKENS + CONTROL + EXTRAIT_CSS + PANEL;
