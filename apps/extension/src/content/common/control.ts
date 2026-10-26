// Commande AETHRYON (V3.5) : bouton de la page (chouette + « Télécharger ») ou barre repliable (YouTube), qui ouvre
// un MENU à la manière de macOS : une action par ligne (télécharger la vidéo, extraire l'audio, extrait rapide,
// image, miniature, continuer dans AETHRYON Tools), deux sous-vues glissées (qualité ou débit ; extrait réglé sur le
// lecteur même de la page), et l'état réel du travail de CE média (progression, Annuler, Afficher, Réessayer,
// connexion). Rien n'est montré qui ne puisse pas aboutir : Tools seulement s'il est ouvert sur le serveur, rien qui
// dépende du serveur quand la plateforme y est en pause, miniature seulement si elle est connue.
// Construit sans innerHTML ; tout texte venant de la page passe par textContent. Le menu est un popover (couche
// supérieure : jamais rogné par un conteneur « overflow: hidden » ni décalé par un ancêtre transformé).
import { KEYS_URL } from "../../shared/config.ts";
import { platformIcon } from "../../shared/icons.ts";
import type { StartJob } from "../../shared/messages.ts";
import { owlSvg } from "../../shared/owl.ts";
import type { Clip, Destination } from "../../shared/types.ts";
import type { Settings } from "../../shared/types.ts";
import { premiereReencodes } from "../../shared/premiere.ts";
import { PLATFORM_LABEL, type Platform } from "../../shared/urls.ts";
import { toSeconds, type ClipFormat } from "../../shared/extrait.ts";
import type { LimitsView } from "../../shared/limites.ts";
import { ClipEditor, type PlayerLink } from "../../extrait/editor.ts";
import type { ExportView } from "../../extrait/progress.ts";
import type { Target, Variant } from "./adapter.ts";
import { h, isolateEvents, setAttr, setText } from "./dom.ts";
import { placePopover } from "./geometry.ts";
import { IDLE, MP3_BITRATES, buildStartJob, initialChoice, qualityChoices, qualityLabel, type Choice, type JobDisplay } from "./job.ts";
import { menuIcon, type MenuIcon } from "./menu-icons.ts";
import type { PagePlayer } from "./player.ts";
import type { JobStore, Slot } from "./store.ts";
import type { PlayerSnapshot } from "../../extrait/editor.ts";
import { CONTROL_CSS } from "./styles.ts";
import { M, T, kbps, triggerAria, videoCount, videoN } from "./strings.ts";
import type { Theme } from "./theme.ts";

/** Capacités du serveur et du compte, vues du service worker (dernier état connu). */
export interface Caps {
  /** AETHRYON Tools ouvert sur ce serveur : « Continuer dans AETHRYON Tools ». */
  tools: boolean;
  /** Plateforme de la page en pause côté serveur (ex. vérification anti-robot de YouTube) : message à dire. */
  paused: string | null;
}
export const DEFAULT_CAPS: Caps = { tools: true, paused: null };

export interface ControlHooks {
  doc: Document;
  win: Window;
  platform: Platform;
  fontFamily: string;
  settings(): Settings;
  store: JobStore;
  start(mediaKey: string, payload: StartJob): void;
  retry(mediaKey: string): void;
  fail(mediaKey: string, message: string): void;
  /** « Se connecter à AETHRYON » : vraie connexion, par le service worker (launchWebAuthFlow). */
  login(mediaKey: string): void;
  /** « Lire la notice » : la page d'accueil de l'extension s'ouvre sur la notice sur les données. */
  openNotice(mediaKey: string): void;
  /** Outils : extrait (MP4, MP3, GIF), image de la vidéo, miniature, AETHRYON Tools. `near` : la commande. */
  quick?(mediaKey: string, action: QuickAction, near: Element): void;
  /** Instant de lecture et durée de la vidéo de la commande, s'ils sont connus. */
  playback?(near: Element): { currentTime?: number; duration?: number };
  /** V3.5 : capacités (réponse du service worker, en cache) ; absent → DEFAULT_CAPS. */
  caps?(): Promise<Caps>;
  /** V3.5 : lecteur de la page de la commande (vue Extrait). */
  player?(near: Element): PagePlayer;
  /** 3.6.0 : limites des extraits annoncées par le serveur et reste du quota du jour (null : inconnues). */
  limits?(): Promise<LimitsView | null>;
  /** V3.5 : Annuler le travail de CE média, ou afficher son fichier dans le dossier. */
  jobAction?(mediaKey: string, action: "cancel" | "show"): void;
  /** V3.5 : barre YouTube repliée ou non (réglage mémorisé). */
  saveToolbar?(collapsed: boolean): void;
  /** 3.5.1 : destination choisie dans le menu (réglage mémorisé, le même que dans le popup et les réglages). */
  saveDestination?(dest: Destination): void;
}

export type QuickAction =
  | { kind: "clip"; output: "mp4" | "mp3" | "gif"; choice: Choice; media: Target["media"]; range?: Clip }
  | { kind: "frame" | "thumb"; media: Target["media"] }
  | { kind: "tools"; media: Target["media"]; range?: Clip };

type View = "main" | "quality" | "bitrate" | "clip";
type Row = "video" | "audio" | "clip" | "frame" | "thumb" | "tools";

/** Tête maître sur la pastille obsidienne : dessin exact (fond sombre), petit logo jusqu'à 24 px. */
const OWL_PX: Record<Variant, number> = { bar: 18, round: 26, x: 16, quote: 16, panel: 18, toolbar: 16 };
function owlFor(doc: Document, variant: Variant): SVGSVGElement {
  return owlSvg(doc, { size: OWL_PX[variant] ?? 18, surface: "dark" });
}

/** Durée pendant laquelle le bouton affiche « Enregistré » / « Échec » avant de revenir à « Télécharger ». */
const SETTLED_MS = 8000;
let seq = 0;

function stateIcon(doc: Document, kind: "done" | "error"): SVGSVGElement {
  const svg = menuIcon(doc, kind === "done" ? "check" : "alert", 14);
  svg.classList.add(kind === "done" ? "draw" : "warn");
  return svg;
}

export class Control {
  readonly el: HTMLDivElement;
  private readonly hooks: ControlHooks;
  private target: Target;
  private readonly variant: Variant;
  private readonly uid = `aeth${++seq}`;
  /** Bouton qui a ouvert le menu (le bouton unique, ou un bouton de la barre YouTube). */
  private anchor: HTMLButtonElement;
  private readonly trigger: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly disc: HTMLSpanElement;
  private readonly bar: HTMLDivElement | null = null;
  private readonly barChip: HTMLSpanElement | null = null;
  private readonly pop: HTMLDivElement;
  private readonly titleEl: HTMLParagraphElement;
  private readonly ctxEl: HTMLParagraphElement;
  private readonly thumb: HTMLSpanElement;
  private readonly views: Record<View, HTMLDivElement>;
  private readonly rows: Record<Row, HTMLButtonElement>;
  private readonly rowValue: Record<"video" | "audio", HTMLSpanElement>;
  private readonly subBtns: Record<"video" | "audio", HTMLButtonElement>;
  private readonly pausedEl: HTMLParagraphElement;
  private readonly videoGroup: HTMLDivElement;
  private readonly qualityList: HTMLDivElement;
  private readonly bitrateList: HTMLDivElement;
  // destination (3.5.1)
  private readonly destBox: HTMLDivElement;
  private readonly destSeg: HTMLDivElement;
  private readonly destNote: HTMLParagraphElement;
  private readonly destWarn: HTMLParagraphElement;
  private dest: Destination;
  // vue Extrait (3.6.0 : éditeur partagé avec le popup, src/extrait)
  private readonly editor: ClipEditor;
  private readonly clipBody: HTMLDivElement;
  private readonly clipEmpty: HTMLParagraphElement;
  private clipOut: ClipFormat = "mp4";
  /** Vidéo pour laquelle l'éditeur a déjà un passage réglé (gardé si le menu est rouvert sur la même). */
  private clipFor: string | null = null;
  // état du travail
  private readonly status: HTMLDivElement;
  private readonly stateEl: HTMLSpanElement;
  private readonly meter: HTMLDivElement;
  private readonly msg: HTMLParagraphElement;
  /** 3.5.2 : ligne calme sous l'état (envoi vers Premiere non suivi par AETHRYON Desktop). */
  private readonly noteEl: HTMLParagraphElement;
  private readonly retryBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly showBtn: HTMLButtonElement;
  private readonly actionBtn: HTMLButtonElement;
  private readonly keysLink: HTMLAnchorElement;
  private choice: Choice;
  /** L'utilisateur a modifié le choix : on ne réapplique plus la présélection des réglages. */
  private touched = false;
  private slot: Slot | null = null;
  private display: JobDisplay = IDLE;
  private caps: Caps = DEFAULT_CAPS;
  private view: View = "main";
  private unsub: () => void;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private moveRaf = 0;
  private listening = false;
  private destroyed = false;
  private groupSeq = 0;
  private readonly onMove = () => {
    if (this.moveRaf) return;
    this.moveRaf = this.hooks.win.requestAnimationFrame(() => {
      this.moveRaf = 0;
      if (!this.isOpen()) return;
      const r = this.anchor.getBoundingClientRect();
      if (!this.anchor.isConnected || (r.width === 0 && r.height === 0)) this.close();
      else this.place();
    });
  };

  constructor(hooks: ControlHooks, target: Target, variant: Variant, theme: Theme) {
    this.hooks = hooks;
    this.target = target;
    this.variant = variant;
    this.choice = initialChoice(hooks.settings());
    this.dest = hooks.settings().destination === "premiere" ? "premiere" : "downloads";
    const d = hooks.doc;
    const popId = `${this.uid}-pop`;

    this.el = h(d, "div", { class: "aeth", attrs: { "data-variant": variant, "data-theme": theme, "data-phase": "idle" } });
    this.el.style.setProperty("--font", hooks.fontFamily);

    // ---- bouton (ou barre YouTube) ----------------------------------------------------------------
    this.label = h(d, "span", { class: "label", text: T.trigger });
    this.disc = h(d, "span", { class: "disc" }, [owlFor(d, variant)]);
    this.trigger = h(d, "button", { class: "trigger", attrs: { type: "button", "aria-haspopup": "dialog", popovertarget: popId } }, [
      h(d, "span", { class: "mark" }, [this.disc]),
      this.label,
      h(d, "span", { class: "mini" }, [h(d, "i")]),
    ]);
    this.anchor = this.trigger;
    if (variant === "toolbar") {
      this.barChip = h(d, "span", { class: "tb-chip", attrs: { "aria-hidden": "true" } });
      const tb = (cls: string, icon: MenuIcon, text: string, aria: string, menu: boolean) => h(d, "button", {
        class: `tb-btn ${cls}`,
        attrs: { type: "button", "aria-label": aria, ...(menu ? { popovertarget: popId, popovertargetaction: "show", "aria-haspopup": "dialog" } : {}) },
      }, [menuIcon(d, icon, 16), h(d, "span", { text })]);
      const dl = tb("tb-dl", "download", T.trigger, M.tbDownloadAria, true);
      const au = tb("tb-au", "audio", "MP3", M.tbAudioAria, true);
      const cl = tb("tb-clip", "scissors", M.tbClip, M.tbClipAria, true);
      const fr = tb("tb-frame", "image", M.tbFrame, T.quickFrameAria, false);
      const to = tb("tb-tools", "tools", "Tools", T.quickToolsAria, false);
      const collapse = h(d, "button", { class: "tb-fold", attrs: { type: "button", "aria-expanded": "true", "aria-label": M.tbFold } }, [menuIcon(d, "chevronUp", 14)]);
      // La marque ouvre le menu ; repliée, la barre n'est plus qu'elle (un clic la rouvre).
      this.trigger.classList.add("tb-brand");
      setText(this.label, T.brand);
      this.bar = h(d, "div", { class: "tbar", attrs: { role: "toolbar", "aria-label": M.tbLabel } }, [
        this.trigger,
        h(d, "span", { class: "tb-actions" }, [dl, au, cl, fr, to]),
        this.barChip,
        collapse,
      ]);
      this.invoker(dl, "main", "video");
      this.invoker(au, "main", "audio");
      this.invoker(cl, "clip");
      fr.addEventListener("click", (e) => { if (e.isTrusted) this.quickAction("frame", fr); });
      to.addEventListener("click", (e) => { if (e.isTrusted) this.quickAction("tools", to); });
      const setFolded = (folded: boolean) => {
        setAttr(this.bar!, "data-folded", folded ? "" : null);
        setAttr(collapse, "aria-expanded", folded ? "false" : "true");
        setAttr(collapse, "aria-label", folded ? M.tbUnfold : M.tbFold);
        collapse.replaceChildren(menuIcon(d, folded ? "chevronDown" : "chevronUp", 14));
        setAttr(this.trigger, "aria-label", folded ? M.tbUnfold : M.tbLabel);
      };
      setFolded(hooks.settings().ytToolbar === "collapsed");
      const fold = (folded: boolean) => {
        setFolded(folded);
        this.close();
        hooks.saveToolbar?.(folded);
      };
      collapse.addEventListener("click", (e) => { if (e.isTrusted) fold(!this.bar!.hasAttribute("data-folded")); });
      // Repliée : la marque rouvre la barre (le menu ne s'ouvre pas : on l'en empêche avant son ouverture).
      this.trigger.addEventListener("click", (e) => {
        if (!e.isTrusted || !this.bar!.hasAttribute("data-folded")) return;
        e.preventDefault();
        fold(false);
      });
      this.tbButtons = { dl, au, cl, fr, to };
    }

    // ---- menu --------------------------------------------------------------------------------------
    this.thumb = h(d, "span", { class: "thumb", attrs: { "aria-hidden": "true" } });
    this.titleEl = h(d, "p", { class: "title" });
    this.ctxEl = h(d, "p", { class: "ctx" });
    const card = h(d, "div", { class: "card" }, [this.thumb, h(d, "div", { class: "card-txt" }, [this.titleEl, this.ctxEl])]);

    this.pausedEl = h(d, "p", { class: "paused", attrs: { role: "note" } });
    this.videoGroup = this.group(T.video);
    const row = (name: Row, icon: MenuIcon, text: string, sub?: string) => {
      const b = h(d, "button", { class: `row r-${name}`, attrs: { type: "button", "data-row": name } }, [
        h(d, "span", { class: "r-ico" }, [menuIcon(d, icon, 16)]),
        h(d, "span", { class: "r-txt" }, [h(d, "span", { class: "r-label", text }), ...(sub ? [h(d, "span", { class: "r-sub", text: sub })] : [])]),
      ]);
      return b;
    };
    // Format et qualité (ou débit) en seconde ligne : jamais de libellé coupé, quelle que soit la police de la page.
    this.rowValue = { video: h(d, "span", { class: "r-sub r-val" }), audio: h(d, "span", { class: "r-sub r-val" }) };
    this.rows = {
      video: row("video", "download", M.rowVideo),
      audio: row("audio", "audio", M.rowAudio),
      clip: row("clip", "scissors", M.rowClip),
      frame: row("frame", "image", M.rowFrame, M.rowFrameSub),
      thumb: row("thumb", "thumb", M.rowThumb),
      tools: row("tools", "tools", M.rowTools),
    };
    this.rows.video.querySelector(".r-txt")!.append(this.rowValue.video);
    this.rows.audio.querySelector(".r-txt")!.append(this.rowValue.audio);
    this.rows.clip.append(h(d, "span", { class: "r-go" }, [menuIcon(d, "chevronRight", 14)]));
    this.rows.tools.append(h(d, "span", { class: "r-go" }, [menuIcon(d, "tools", 13)]));
    const sub = (name: "video" | "audio", aria: string) => h(d, "button", { class: "r-more", attrs: { type: "button", "aria-label": aria, "data-more": name } }, [menuIcon(d, "chevronRight", 14)]);
    this.subBtns = { video: sub("video", M.chooseQuality), audio: sub("audio", M.chooseBitrate) };
    const pair = (name: "video" | "audio") => h(d, "div", { class: "pair" }, [this.rows[name], this.subBtns[name]]);
    const list = h(d, "div", { class: "rows" }, [
      pair("video"),
      pair("audio"),
      h(d, "hr", { class: "sep" }),
      this.rows.clip,
      this.rows.frame,
      this.rows.thumb,
      this.rows.tools,
    ]);
    // Destination (3.5.1) : Téléchargements | Premiere Pro, juste au-dessus des lignes Vidéo et Audio qu'elle concerne.
    const destId = `${this.uid}-dest`;
    this.destNote = h(d, "p", { class: "d-note", attrs: { id: `${destId}-note`, hidden: true } });
    this.destWarn = h(d, "p", { class: "d-note d-warn", attrs: { id: `${destId}-warn`, hidden: true } });
    this.destSeg = h(d, "div", { class: "seg d-seg", attrs: { role: "radiogroup", "aria-labelledby": destId } });
    // Explication et avertissement : description du groupe (lus avec le choix qui garde le focus).
    this.destBox = h(d, "div", { class: "dest" }, [
      h(d, "span", { class: "legend", text: M.destTitle, attrs: { id: destId } }), this.destSeg, this.destNote, this.destWarn,
    ]);
    const main = h(d, "div", { class: "view", attrs: { "data-view": "main" } }, [card, this.pausedEl, this.videoGroup, this.destBox, list]);

    // sous-vues Qualité et Débit
    const back = (title: string) => {
      const b = h(d, "button", { class: "back", attrs: { type: "button", "aria-label": M.back } }, [menuIcon(d, "chevronLeft", 14), h(d, "span", { text: title })]);
      b.addEventListener("click", (e) => { if (e.isTrusted) this.show("main", true); });
      return h(d, "div", { class: "vhead" }, [b]);
    };
    this.qualityList = h(d, "div", { class: "choices", attrs: { role: "radiogroup", "aria-label": M.qualityTitle } });
    this.bitrateList = h(d, "div", { class: "choices", attrs: { role: "radiogroup", "aria-label": M.bitrateTitle } });
    const quality = h(d, "div", { class: "view", attrs: { "data-view": "quality", hidden: true } }, [back(M.qualityTitle), this.qualityList]);
    const bitrate = h(d, "div", { class: "view", attrs: { "data-view": "bitrate", hidden: true } }, [back(M.bitrateTitle), this.bitrateList]);

    // sous-vue Extrait (3.6.0) : réglette premium et loupe, champs HH:MM:SS.mmm, lecteur de la page en mini-lecteur,
    // limites du serveur, export et avancement réel (src/extrait).
    this.editor = new ClipEditor(d, {
      player: () => this.playerLink(),
      export: (r, f) => this.exportClip(r, f),
      tools: (r) => this.quickAction("tools", this.anchor, toSeconds(r)),
      cancel: () => this.hooks.jobAction?.(this.target.key, "cancel"),
      show: () => this.hooks.jobAction?.(this.target.key, "show"),
      retry: () => this.hooks.retry(this.target.key),
      // Avancement apparu ou effacé : le menu se replace, et le pied de l'éditeur reste visible s'il défile.
      resized: () => {
        if (!this.isOpen()) return;
        this.place();
        if (this.view === "clip") this.reveal(this.editor.footEl);
      },
      formatChanged: (f) => { this.clipOut = f; this.touched = true; },
    }, "menu");
    this.clipEmpty = h(d, "p", { class: "c-empty", text: T.clipNoTime });
    this.clipBody = h(d, "div", { class: "c-body" }, [this.editor.el]);
    const clip = h(d, "div", { class: "view", attrs: { "data-view": "clip", hidden: true } }, [back(M.clipTitle), this.clipEmpty, this.clipBody]);
    this.views = { main, quality, bitrate, clip };

    // état du travail de CE média
    this.stateEl = h(d, "span", { class: "state" });
    this.meter = h(d, "div", { class: "meter", attrs: { "aria-hidden": "true" } }, [h(d, "i")]);
    this.msg = h(d, "p", { class: "msg" });
    this.noteEl = h(d, "p", { class: "msg s-note" });
    const small = (cls: string, text: string, icon?: MenuIcon) => h(d, "button", { class: `sbtn ${cls}`, attrs: { type: "button", hidden: true } }, [...(icon ? [menuIcon(d, icon, 13)] : []), h(d, "span", { text })]);
    this.retryBtn = small("retry", T.retry);
    this.cancelBtn = small("cancel", M.cancel, "close");
    this.showBtn = small("show", M.showFile, "folder");
    this.actionBtn = h(d, "button", { class: "act", text: T.signIn, attrs: { type: "button", hidden: true } });
    this.keysLink = h(d, "a", { class: "keys", text: T.openKeys, attrs: { href: KEYS_URL, target: "_blank", rel: "noopener noreferrer", hidden: true } });
    this.status = h(d, "div", { class: "status", attrs: { role: "status", "aria-live": "polite", hidden: true } }, [
      h(d, "div", { class: "s-top" }, [this.stateEl, this.cancelBtn, this.showBtn]),
      this.meter, this.msg, this.noteEl, this.actionBtn, this.keysLink, this.retryBtn,
    ]);

    this.pop = h(d, "div", { class: "pop", attrs: { id: popId, popover: "auto", role: "dialog", "aria-label": T.dialogLabel, "data-view": "main" } }, [
      h(d, "div", { class: "head" }, [
        h(d, "span", { class: "disc" }, [owlSvg(d, { size: 16, surface: "dark" })]),
        h(d, "span", { class: "brand", text: T.brand }),
        h(d, "span", { class: "plat" }, [platformIcon(d, hooks.platform, 12), h(d, "span", { text: PLATFORM_LABEL[hooks.platform] })]),
      ]),
      h(d, "div", { class: "views" }, [main, quality, bitrate, clip]),
      this.status,
    ]);
    this.el.append(this.bar ?? this.trigger, this.pop);

    // ---- événements (actions acceptées seulement si elles viennent réellement de l'utilisateur) ------
    this.rows.video.addEventListener("click", (e) => { if (e.isTrusted) this.download("mp4"); });
    this.rows.audio.addEventListener("click", (e) => { if (e.isTrusted) this.download("mp3"); });
    this.rows.clip.addEventListener("click", (e) => { if (e.isTrusted) this.show("clip"); });
    this.rows.frame.addEventListener("click", (e) => { if (e.isTrusted) this.quickAction("frame", this.rows.frame); });
    this.rows.thumb.addEventListener("click", (e) => { if (e.isTrusted) this.quickAction("thumb", this.rows.thumb); });
    this.rows.tools.addEventListener("click", (e) => { if (e.isTrusted) this.quickAction("tools", this.rows.tools); });
    this.subBtns.video.addEventListener("click", (e) => { if (e.isTrusted) this.show("quality"); });
    this.subBtns.audio.addEventListener("click", (e) => { if (e.isTrusted) this.show("bitrate"); });
    this.retryBtn.addEventListener("click", (e) => { if (e.isTrusted) this.hooks.retry(this.target.key); });
    this.cancelBtn.addEventListener("click", (e) => { if (e.isTrusted) this.hooks.jobAction?.(this.target.key, "cancel"); });
    this.showBtn.addEventListener("click", (e) => { if (e.isTrusted) this.hooks.jobAction?.(this.target.key, "show"); });
    this.actionBtn.addEventListener("click", (e) => {
      if (!e.isTrusted || this.display.busy) return;
      if (this.display.action === "consent") this.hooks.openNotice(this.target.key);
      else this.hooks.login(this.target.key);
    });

    this.invoker(this.trigger, "main");
    this.pop.addEventListener("keydown", (e) => this.onKey(e));
    this.pop.addEventListener("beforetoggle", (e) => {
      if ((e as ToggleEvent).newState === "open") this.prepare();
      else this.pop.removeAttribute("data-placed");
    });
    this.pop.addEventListener("toggle", (e) => {
      const open = (e as ToggleEvent).newState === "open";
      setAttr(this.anchor, "aria-expanded", open ? "true" : "false");
      if (open) {
        this.place();
        this.listenMoves(true);
        // Ouverture au clavier : le focus est déjà dans le menu ; à la souris, on l'y met maintenant.
        const active = (this.el.getRootNode() as ShadowRoot | Document).activeElement;
        if (!active || !this.pop.contains(active)) this.focusView(this.pendingFocus);
        void this.refreshCaps();
      } else {
        this.listenMoves(false);
        this.editor.close();
        this.hooks.player?.(this.el).stop();
      }
    });

    this.applyTarget(target);
    this.renderChoices();
    this.unsub = hooks.store.subscribe(target.key, (s) => this.render(s));
    this.render(hooks.store.get(target.key));
  }

  private tbButtons: Record<"dl" | "au" | "cl" | "fr" | "to", HTMLButtonElement> | null = null;

  get key(): string {
    return this.target.key;
  }

  setTarget(t: Target): void {
    if (this.destroyed) return;
    const countChanged = (t.media.videoCount ?? 1) !== (this.target.media.videoCount ?? 1);
    this.applyTarget(t);
    if (countChanged) {
      this.choice.index = 1;
      this.renderChoices();
    }
  }

  setVariant(v: Variant): void {
    if (this.el.getAttribute("data-variant") === v || this.variant === "toolbar" || v === "toolbar") return;
    setAttr(this.el, "data-variant", v);
    this.disc.replaceChildren(owlFor(this.hooks.doc, v));
  }

  setTheme(t: Theme): void {
    setAttr(this.el, "data-theme", t);
  }

  setCompact(c: boolean): void {
    setAttr(this.el, "data-compact", c ? "" : null);
  }

  /** Les réglages ont changé : nouvelle présélection si l'utilisateur n'a encore rien choisi. */
  settingsChanged(): void {
    if (this.destroyed || this.isOpen()) return;
    if (!this.touched && !this.display.busy) this.choice = { ...initialChoice(this.hooks.settings()), index: this.choice.index };
    // Destination : réglage commun (menu de chaque page, popup, réglages) ; changée ailleurs, elle l'est ici aussi.
    this.dest = this.hooks.settings().destination === "premiere" ? "premiere" : "downloads";
    this.renderChoices();
    if (this.bar) {
      const folded = this.hooks.settings().ytToolbar === "collapsed";
      if (folded !== this.bar.hasAttribute("data-folded")) this.bar.querySelector<HTMLButtonElement>(".tb-fold")?.click();
    }
  }

  isOpen(): boolean {
    try {
      return this.pop.matches(":popover-open");
    } catch {
      return false;
    }
  }

  close(): void {
    try {
      if (this.isOpen()) this.pop.hidePopover();
    } catch {
      /* déjà fermé */
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.close();
    this.listenMoves(false);
    this.unsub();
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    if (this.moveRaf) this.hooks.win.cancelAnimationFrame(this.moveRaf);
    this.el.remove();
  }

  // ---- ouverture, vues ---------------------------------------------------------------------------
  private pendingView: View = "main";
  private pendingFocus: Row | undefined;

  /**
   * Bouton qui ouvre le menu (attribut popovertarget : le navigateur l'exclut de la fermeture par clic extérieur).
   * La souris garde le comportement natif ; au clavier (Entrée, Espace), ouverture ET mise au point synchrones,
   * pour qu'une touche tapée juste après arrive dans le menu. Menu déjà ouvert par un autre bouton de la barre :
   * il passe sous ce bouton, sur sa vue.
   */
  private invoker(btn: HTMLButtonElement, view: View, focus?: Row): void {
    const aim = () => {
      if (this.anchor !== btn) setAttr(this.anchor, "aria-expanded", "false");
      this.anchor = btn;
      this.pendingView = view;
      this.pendingFocus = focus;
    };
    btn.addEventListener("click", (e) => {
      if (!e.isTrusted || e.defaultPrevented) return;
      const switching = this.isOpen() && this.anchor !== btn;
      aim();
      if (switching) {
        setAttr(btn, "aria-expanded", "true");
        this.show(view, false, focus);
        this.place();
      }
    });
    btn.addEventListener("keydown", (e) => {
      if ((e.key !== "Enter" && e.key !== " ") || !e.isTrusted || e.repeat) return;
      if (this.bar?.hasAttribute("data-folded") && btn === this.trigger) return; // le clic rouvre la barre
      e.preventDefault();
      if (this.isOpen() && this.anchor === btn) {
        this.close();
        return;
      }
      aim();
      try {
        if (!this.isOpen()) this.pop.showPopover();
        else this.prepare();
      } catch {
        return;
      }
      setAttr(btn, "aria-expanded", "true");
      this.place();
      this.focusView(focus);
    });
  }

  /** Avant l'ouverture : présélection, lignes possibles, vue demandée. */
  private prepare(): void {
    if (!this.touched && !this.display.busy) this.choice = { ...initialChoice(this.hooks.settings()), index: this.choice.index };
    this.renderChoices();
    this.renderRows();
    this.show(this.pendingView, false, this.pendingFocus);
  }

  private async refreshCaps(): Promise<void> {
    if (!this.hooks.caps) return;
    try {
      const c = await this.hooks.caps();
      if (this.destroyed) return;
      this.caps = c;
      this.renderRows();
      if (this.isOpen()) this.place();
    } catch {
      /* dernier état connu */
    }
  }

  private show(view: View, backward = false, focus?: Row): void {
    const prev = this.view;
    this.view = view;
    setAttr(this.pop, "data-view", view);
    for (const [name, el] of Object.entries(this.views) as [View, HTMLDivElement][]) {
      const on = name === view;
      el.hidden = !on;
      el.classList.remove("in-fwd", "in-back");
      if (on && prev !== view && this.isOpen()) {
        void el.offsetWidth; // relance l'entrée
        el.classList.add(backward ? "in-back" : "in-fwd");
      }
    }
    if (view === "clip") this.enterClip();
    else if (prev === "clip") {
      this.editor.close();
      this.hooks.player?.(this.el).stop();
    }
    this.syncStatus();
    if (this.isOpen()) {
      this.place();
      this.focusView(focus ?? (backward ? (prev === "quality" ? "video" : prev === "bitrate" ? "audio" : prev === "clip" ? "clip" : undefined) : undefined));
    }
  }

  private focusView(focus?: Row): void {
    let el: HTMLElement | null = null;
    if (!this.status.hidden && this.display.action && !this.actionBtn.hidden) el = this.actionBtn;
    else if (this.view === "main") {
      const want = focus ? this.rows[focus] : this.choice.fmt === "mp3" ? this.rows.audio : this.rows.video;
      el = !want.hidden && !want.disabled ? want : this.firstRow();
    } else if (this.view === "clip") {
      el = this.clipBody.hidden ? this.views.clip.querySelector<HTMLElement>(".back") : this.views.clip.querySelector<HTMLElement>(".tl-h-start");
    } else {
      el = this.views[this.view].querySelector<HTMLElement>("[aria-checked=true]") ?? this.views[this.view].querySelector<HTMLElement>(".back");
    }
    try {
      el?.focus({ preventScroll: true });
    } catch {
      /* ignoré */
    }
  }

  private firstRow(): HTMLButtonElement | null {
    return this.visibleRows()[0] ?? null;
  }

  /** Lignes atteignables aux flèches (les chevrons « › » restent au Tab ; → les ouvre depuis la ligne). */
  private visibleRows(): HTMLButtonElement[] {
    return [...this.views.main.querySelectorAll<HTMLButtonElement>(".row")].filter((b) => !b.hidden && !b.disabled);
  }

  /** Clavier : flèches entre les lignes ; → ouvre une sous-vue ; ← ou Échap y revient (Échap ferme le menu principal). */
  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (this.view !== "main") {
        e.preventDefault();
        e.stopPropagation();
        this.show("main", true);
        return;
      }
      try {
        this.anchor.focus({ preventScroll: true });
      } catch {
        /* ignoré */
      }
      return; // le navigateur ferme ensuite le popover
    }
    const active = (this.el.getRootNode() as ShadowRoot | Document).activeElement as HTMLElement | null;
    if (this.view === "main" && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End")) {
      const list = this.visibleRows();
      if (!list.length) return;
      e.preventDefault();
      const i = active ? list.indexOf(active as HTMLButtonElement) : -1;
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus({ preventScroll: true });
      return;
    }
    if (this.view === "main" && e.key === "ArrowRight" && active) {
      const r = active.getAttribute("data-row");
      if (r === "video" || r === "audio") { e.preventDefault(); this.show(r === "video" ? "quality" : "bitrate"); }
      else if (r === "clip") { e.preventDefault(); this.show("clip"); }
      return;
    }
    if (this.view !== "main" && e.key === "ArrowLeft" && active?.classList.contains("back")) {
      e.preventDefault();
      this.show("main", true);
    }
  }

  // ---- lignes et choix -------------------------------------------------------------------------------
  private group(legend: string): HTMLDivElement {
    const d = this.hooks.doc;
    const id = `${this.uid}-g${++this.groupSeq}`;
    return h(d, "div", { class: "group", attrs: { role: "radiogroup", "aria-labelledby": id } }, [h(d, "span", { class: "legend", text: legend, attrs: { id } })]);
  }

  /** Liste de choix (role=radio) : flèches pour changer, Entrée ou clic pour choisir et revenir au menu. */
  private fillChoices(box: HTMLDivElement, options: { value: string; label: string }[], checked: string, onPick: (v: string) => void): void {
    const d = this.hooks.doc;
    const items = options.map((o) => {
      const on = o.value === checked;
      const b = h(d, "button", { class: "choice", attrs: { type: "button", role: "radio", "aria-checked": on ? "true" : "false", tabindex: on ? "0" : "-1", "data-value": o.value } }, [
        h(d, "span", { text: o.label }),
        h(d, "span", { class: "tick" }, [menuIcon(d, "check", 14)]),
      ]);
      b.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        this.touched = true;
        onPick(o.value);
      });
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const all = [...box.querySelectorAll<HTMLButtonElement>(".choice")];
        const i = all.indexOf(b);
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus({ preventScroll: true });
      });
      return b;
    });
    box.replaceChildren(...items);
  }

  private fillGroup(group: HTMLDivElement, name: string, options: { value: string; label: string }[], checked: string, onPick: (v: string) => void): void {
    const d = this.hooks.doc;
    const box = h(d, "div", { class: "chips" });
    for (const o of options) {
      const input = h(d, "input", { attrs: { type: "radio", name: `${this.uid}-${name}`, value: o.value } });
      input.checked = o.value === checked;
      input.disabled = this.display.busy;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.touched = true;
        onPick(o.value);
      });
      const lab = h(d, "label", { class: "opt" }, [input]);
      lab.appendChild(d.createTextNode(o.label));
      box.appendChild(lab);
    }
    const legend = group.firstElementChild;
    group.replaceChildren(...(legend ? [legend] : []), box);
  }

  private renderChoices(): void {
    const s = this.hooks.settings();
    const qualities = qualityChoices(s.quality);
    if (!qualities.includes(this.choice.quality)) this.choice.quality = "best";
    const premiere = this.dest === "premiere";
    this.fillChoices(this.qualityList, qualities.map((q) => ({ value: q, label: q === "best" ? (premiere ? M.premiereBest : M.qualityBest) : qualityLabel(q) })), this.choice.quality, (v) => {
      this.choice.quality = v as Choice["quality"];
      this.renderChoices();
      this.show("main", true, "video");
    });
    this.fillChoices(this.bitrateList, MP3_BITRATES.map((b) => ({ value: String(b), label: kbps(b) })), String(this.choice.bitrate), (v) => {
      this.choice.bitrate = Number(v) as Choice["bitrate"];
      this.renderChoices();
      this.show("main", true, "audio");
    });
    // Premiere : MP4 H.264 + AAC (transcode=true côté serveur) ; « Auto » s'arrête à 1080p (src/shared/premiere.ts).
    if (premiere) setText(this.rowValue.video, M.premiereVideo(this.choice.quality === "best" ? M.premiereBest.toLowerCase() : qualityLabel(this.choice.quality)));
    else setText(this.rowValue.video, `MP4 · ${this.choice.quality === "best" ? M.qualityBest.toLowerCase() : qualityLabel(this.choice.quality)}`);
    this.renderDest();
    setText(this.rowValue.audio, `MP3 · ${kbps(this.choice.bitrate)}`);
    const count = this.videoTotal();
    if (count > 1) {
      if (this.choice.index < 1 || this.choice.index > count) this.choice.index = 1;
      const opts = Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: videoN(i + 1) }));
      this.fillGroup(this.videoGroup, "v", opts, String(this.choice.index), (v) => {
        this.choice.index = Number(v);
      });
      this.videoGroup.hidden = false;
    } else {
      this.videoGroup.hidden = true;
    }
  }

  /** Lignes possibles pour CE média, maintenant : serveur en pause, Tools fermé, miniature inconnue, travail en cours. */
  private renderRows(): void {
    const busy = this.display.busy;
    const paused = this.caps.paused;
    // Travail en cours pour ce média : le menu se résume à son état (progression, Annuler), sans lignes grisées.
    this.views.main.querySelector<HTMLElement>(".rows")!.hidden = busy;
    this.destBox.hidden = busy;
    if (busy) this.videoGroup.hidden = true;
    else this.videoGroup.hidden = this.videoTotal() <= 1;
    setText(this.pausedEl, paused ?? "");
    this.pausedEl.hidden = !paused;
    const serverRows: Row[] = ["video", "audio", "clip"];
    for (const r of serverRows) this.rows[r].disabled = busy || !!paused;
    this.subBtns.video.disabled = busy || !!paused;
    this.subBtns.audio.disabled = busy || !!paused;
    this.rows.frame.disabled = busy;
    this.rows.thumb.hidden = !this.target.media.thumbnail;
    this.rows.thumb.disabled = busy;
    this.rows.tools.hidden = !this.caps.tools || !this.hooks.quick;
    this.rows.tools.disabled = busy;
    const quick = this.hooks.settings().pageTools !== false && !!this.hooks.quick;
    this.rows.clip.hidden = !quick;
    this.rows.frame.hidden = !quick;
    if (!quick) this.rows.thumb.hidden = true;
    this.views.main.querySelector<HTMLElement>(".sep")!.hidden = !quick && this.rows.tools.hidden;
    if (this.tbButtons) {
      this.tbButtons.dl.disabled = busy || !!paused;
      this.tbButtons.au.disabled = busy || !!paused;
      this.tbButtons.cl.disabled = busy || !!paused;
      this.tbButtons.fr.disabled = busy;
      this.tbButtons.to.hidden = !this.caps.tools || !this.hooks.quick;
      this.tbButtons.to.disabled = busy;
    }
    this.editor.setBlocked(paused);
    this.editor.setToolsVisible(this.caps.tools && !!this.hooks.quick);
  }

  private videoTotal(): number {
    const n = this.target.media.videoCount;
    return typeof n === "number" && Number.isInteger(n) && n > 1 ? Math.min(n, 50) : 1;
  }

  private applyTarget(t: Target): void {
    this.target = t;
    setText(this.titleEl, t.media.title ?? "");
    const count = this.videoTotal();
    setText(this.ctxEl, [t.context, count > 1 ? videoCount(count) : null].filter(Boolean).join(" · "));
    // Miniature : seulement une adresse déjà validée (serveurs d'images des plateformes, https).
    const src = t.media.thumbnail ?? "";
    const img = this.thumb.firstElementChild as HTMLImageElement | null;
    if (!src) this.thumb.replaceChildren(platformIcon(this.hooks.doc, this.hooks.platform, 16));
    else if (!img || img.getAttribute("src") !== src) {
      const im = h(this.hooks.doc, "img", { attrs: { alt: "", decoding: "async", loading: "lazy", referrerpolicy: "no-referrer", src } });
      im.addEventListener("load", () => im.setAttribute("data-loaded", ""), { once: true });
      im.addEventListener("error", () => this.thumb.replaceChildren(platformIcon(this.hooks.doc, this.hooks.platform, 16)), { once: true });
      this.thumb.replaceChildren(im);
    }
    this.renderTriggerLabel();
    this.renderRows();
  }

  /**
   * Destination (3.5.1) : deux choix (role=radio, un seul arrêt de tabulation ; ← → pour changer), l'explication
   * de Premiere tant qu'elle n'a pas servi, et l'avertissement de réencodage au-delà de 1080p.
   */
  private renderDest(): void {
    const d = this.hooks.doc;
    const opts: { value: Destination; label: string }[] = [{ value: "downloads", label: M.destDownloads }, { value: "premiere", label: M.destPremiere }];
    const pick = (v: Destination, focus: boolean) => {
      if (this.display.busy) return;
      if (v !== this.dest) {
        this.dest = v;
        this.hooks.saveDestination?.(v);
        this.renderChoices();
        if (this.isOpen()) this.place();
      }
      if (focus) this.destSeg.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus({ preventScroll: true });
    };
    const items = opts.map((o) => {
      const on = o.value === this.dest;
      const b = h(d, "button", { class: "opt", text: o.label, attrs: { type: "button", role: "radio", "aria-checked": on ? "true" : "false", tabindex: on ? "0" : "-1", "data-dest": o.value } });
      b.addEventListener("click", (e) => { if (e.isTrusted) pick(o.value, true); });
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        e.stopPropagation();
        pick(this.dest === "premiere" ? "downloads" : "premiere", true);
      });
      return b;
    });
    this.destSeg.replaceChildren(...items);
    const premiere = this.dest === "premiere";
    const hint = premiere && !this.hooks.settings().premiereHintSeen;
    const warn = premiere && premiereReencodes(this.choice.quality);
    setText(this.destNote, hint ? M.destHint : "");
    this.destNote.hidden = !hint;
    setText(this.destWarn, warn ? M.destReencode : "");
    this.destWarn.hidden = !warn;
    const described = [hint ? this.destNote.id : "", warn ? this.destWarn.id : ""].filter(Boolean).join(" ");
    setAttr(this.destSeg, "aria-describedby", described || null);
  }

  // ---- actions ------------------------------------------------------------------------------------------
  private download(fmt: "mp4" | "mp3"): void {
    if (this.display.busy || this.caps.paused) return;
    this.choice.fmt = fmt;
    const payload = buildStartJob(this.target.media, this.choice, this.dest);
    if (!payload) {
      this.hooks.fail(this.target.key, T.errInvalidLink);
      return;
    }
    this.hooks.start(this.target.key, payload);
  }

  private quickAction(name: "frame" | "thumb" | "tools", from: HTMLButtonElement, range?: Clip): void {
    if (this.display.busy || !this.hooks.quick) return;
    const media = this.target.media;
    if (from !== this.anchor && !this.pop.contains(from)) this.anchor = from; // barre : l'état s'affiche sous ce bouton
    if (name === "tools") this.hooks.quick(this.target.key, { kind: "tools", media, ...(range ? { range } : {}) }, this.el);
    else this.hooks.quick(this.target.key, { kind: name, media }, this.el);
  }

  // ---- vue Extrait (3.6.0) -------------------------------------------------------------------------------
  /** Lecteur de la page vu par l'éditeur (instant lu toutes les 100 ms pendant que la vue est ouverte). */
  private playerLink(): PlayerLink | null {
    const p = this.hooks.player?.(this.el);
    if (!p) return null;
    return {
      pollMs: 100,
      snapshot: (): Promise<PlayerSnapshot> => Promise.resolve(p.snapshot()),
      seek: (t) => p.seek(t),
      preview: (start, end) => p.preview(start, end, () => undefined),
      stop: () => p.stop(),
      frameMs: () => p.frameMs(),
    };
  }

  private enterClip(): void {
    const pb = this.hooks.player?.(this.el).times() ?? this.hooks.playback?.(this.el) ?? {};
    const s = this.hooks.settings();
    const ok = typeof pb.duration === "number" && pb.duration > 0;
    this.clipEmpty.hidden = ok;
    this.clipBody.hidden = !ok;
    if (!ok) return;
    if (!this.touched) this.clipOut = s.defaultFmt === "mp3" ? "mp3" : "mp4";
    const media = this.target.key;
    this.editor.open({
      durationMs: Math.round(pb.duration! * 1000),
      currentMs: typeof pb.currentTime === "number" ? Math.round(pb.currentTime * 1000) : null,
      lengthMs: s.clipLength * 1000,
      anchor: s.clipAnchor,
      format: this.clipOut,
      quality: qualityLabel(this.choice.quality),
      keep: this.clipFor === media,
    });
    this.clipFor = media;
    this.syncStatus();
    void this.refreshLimits();
  }

  private async refreshLimits(): Promise<void> {
    if (!this.hooks.limits) {
      this.editor.setLimits(null);
      return;
    }
    try {
      const v = await this.hooks.limits();
      if (!this.destroyed) this.editor.setLimits(v ?? { limits: null, quota: null, source: "indisponible" });
    } catch {
      this.editor.setLimits({ limits: null, quota: null, source: "indisponible" });
    }
  }

  private exportClip(r: { startMs: number; endMs: number }, format: ClipFormat): void {
    if (this.display.busy || this.caps.paused || !this.hooks.quick) return;
    this.clipOut = format;
    this.hooks.player?.(this.el).stop();
    this.hooks.quick(this.target.key, {
      kind: "clip", output: format, choice: { ...this.choice, fmt: format === "mp3" ? "mp3" : "mp4" }, media: this.target.media, range: toSeconds(r),
    }, this.el);
  }

  /**
   * Avancement d'un extrait de CE média pour l'éditeur (étapes réelles, pourcentage seulement s'il est mesuré) ; null
   * si le travail en cours n'est pas un extrait, ou s'il n'y a rien (connexion requise : état général du menu).
   */
  private exportView(slot: Slot | null): ExportView | null {
    if (!slot) return null;
    const d = slot.display;
    const job = slot.job;
    const isClip = job ? !!job.clip : !!slot.payload?.clip;
    if (!isClip) return null;
    const gif = job ? !!job.gif : !!slot.payload?.gif;
    const fmt = job?.fmt ?? slot.payload?.fmt;
    const format: ClipFormat = gif ? "gif" : fmt === "mp3" ? "mp3" : "mp4";
    const canAct = !!this.hooks.jobAction && !!slot.jobKey;
    const base = { format, etape: job?.etape ?? null, progress: d.progress, canCancel: canAct, canShow: canAct };
    switch (d.phase) {
      case "sending":
        return { ...base, phase: "sending", progress: null, canCancel: false };
      case "queued":
      case "converting":
      case "downloading":
      case "done":
      case "cancelled":
        return { ...base, phase: d.phase };
      case "error":
        return { ...base, phase: "error", error: { code: job?.error?.code ?? d.code ?? "unknown", message: d.message ?? T.errGeneric, retryable: d.retryable } };
      default:
        return null;
    }
  }

  /** Vue Extrait avec un extrait de ce média en cours ou fini : son avancement remplace l'état général du menu. */
  private syncStatus(): void {
    const v = this.exportView(this.slot);
    this.editor.setJob(v);
    const inEditor = this.view === "clip" && !this.clipBody.hidden && v !== null;
    setAttr(this.status, "data-in-editor", inEditor ? "" : null);
  }

  // ---- placement --------------------------------------------------------------------------------------
  private place(): void {
    const win = this.hooks.win;
    const r = this.anchor.getBoundingClientRect();
    const vp = { width: win.document.documentElement.clientWidth || win.innerWidth, height: win.innerHeight };
    let p = placePopover({ x: r.left, y: r.top, width: r.width, height: r.height }, { width: this.pop.offsetWidth, height: this.pop.offsetHeight }, vp);
    // Menu déjà ouvert au-dessus du bouton : il y reste en changeant de vue (pas de saut d'un côté à l'autre).
    if (this.pop.hasAttribute("data-placed") && this.pop.getAttribute("data-side") === "above" && p.side === "below") {
      const y = r.top - 8 - this.pop.offsetHeight;
      if (y >= 12) p = { x: p.x, y, side: "above" };
    }
    this.pop.style.left = `${p.x}px`;
    this.pop.style.top = `${p.y}px`;
    setAttr(this.pop, "data-side", p.side);
    this.pop.setAttribute("data-placed", "");
  }

  private listenMoves(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const win = this.hooks.win;
    if (on) {
      win.addEventListener("scroll", this.onMove, { capture: true, passive: true });
      win.addEventListener("resize", this.onMove, { passive: true });
    } else {
      win.removeEventListener("scroll", this.onMove, { capture: true });
      win.removeEventListener("resize", this.onMove);
    }
  }

  /** Fait voir `el` dans le menu (il défile quand la fenêtre est basse), sans faire défiler la page. */
  private reveal(el: HTMLElement): void {
    const box = this.pop.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom > box.bottom) this.pop.scrollTop += r.bottom - box.bottom + 8;
    else if (r.top < box.top) this.pop.scrollTop -= box.top - r.top + 8;
  }

  // ---- état du travail ------------------------------------------------------------------------------
  private render(slot: Slot): void {
    if (this.destroyed) return;
    this.slot = slot;
    const d = slot.display;
    const wasBusy = this.display.busy;
    const prevPhase = this.display.phase;
    this.display = d;
    setAttr(this.el, "data-phase", d.phase);
    setAttr(this.el, "data-busy", d.busy ? "" : null);
    setAttr(this.el, "data-indeterminate", d.busy && d.progress === null ? "" : null);
    this.el.style.setProperty("--p", `${d.progress ?? 0}%`);

    let revealStatus = false;
    if (d.phase === "idle") {
      this.status.hidden = true;
      this.actionBtn.hidden = true;
      this.keysLink.hidden = true;
    } else {
      const appeared = this.status.hidden || prevPhase !== d.phase;
      this.status.hidden = false;
      setAttr(this.status, "data-phase", d.phase);
      setAttr(this.status, "data-indeterminate", d.busy && d.progress === null ? "" : null);
      setAttr(this.status, "role", d.phase === "error" ? "alert" : "status");
      if (this.stateEl.textContent !== d.label || this.stateEl.getAttribute("data-phase") !== d.phase) {
        const icon = d.phase === "done" ? stateIcon(this.hooks.doc, "done") : d.phase === "error" ? stateIcon(this.hooks.doc, "error") : null;
        this.stateEl.replaceChildren(...(icon ? [icon] : []), this.hooks.doc.createTextNode(d.label));
        this.stateEl.setAttribute("data-phase", d.phase);
      }
      this.meter.hidden = !d.busy || d.phase === "signing" || d.phase === "sending";
      setText(this.msg, d.message ?? "");
      setText(this.noteEl, d.note ?? "");
      this.retryBtn.hidden = !!d.action || !(d.retryable && (d.phase === "error" || d.phase === "cancelled"));
      const showAction = d.action === "login" || d.action === "consent";
      this.actionBtn.hidden = !showAction && d.phase !== "signing";
      this.actionBtn.disabled = d.phase === "signing";
      setText(this.actionBtn, d.phase === "signing" ? T.signingIn : d.action === "consent" ? T.readNotice : T.signIn);
      setAttr(this.actionBtn, "aria-busy", d.phase === "signing" ? "true" : null);
      this.keysLink.hidden = d.action !== "keys";
      if (d.action === "keys") this.actionBtn.hidden = true;
      // Annuler : un vrai travail du serveur en cours ; Afficher : un fichier écrit par le navigateur.
      this.cancelBtn.hidden = !(this.hooks.jobAction && slot.jobKey && (d.phase === "queued" || d.phase === "converting" || d.phase === "downloading"));
      this.showBtn.hidden = !(this.hooks.jobAction && slot.jobKey && d.phase === "done");
      revealStatus = appeared;
    }
    if (this.barChip) {
      // Pastille de la barre : l'état d'un travail, jamais « Télécharger » (connexion requise : rien n'a commencé).
      setText(this.barChip, d.phase === "idle" || d.short === T.trigger ? "" : d.short);
      setAttr(this.barChip, "data-phase", d.phase);
    }
    if (wasBusy !== d.busy) {
      for (const input of this.views.main.querySelectorAll<HTMLInputElement>("input")) input.disabled = d.busy;
      this.renderRows();
    }
    this.syncStatus();
    // Fin de la connexion depuis la page : le focus (perdu par le bouton désactivé) va à la suite logique.
    if (prevPhase === "signing" && d.phase !== "signing" && this.isOpen()) {
      const next = d.phase === "linked" ? this.firstRow() : !this.keysLink.hidden ? this.keysLink : !this.actionBtn.hidden ? this.actionBtn : this.firstRow();
      try {
        next?.focus({ preventScroll: true });
      } catch {
        /* ignoré */
      }
    }
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (d.phase === "done" || d.phase === "error" || d.phase === "cancelled" || d.phase === "linked") {
      const left = slot.at + SETTLED_MS - Date.now();
      if (left > 0) this.settleTimer = setTimeout(() => this.renderTriggerLabel(), left + 20);
    }
    this.renderTriggerLabel();
    if (this.isOpen()) this.place();
    // Après place() (qui peut réduire la hauteur du menu) : un état qui apparaît, avec son action, est toujours visible,
    // même dans une fenêtre basse où il tombe sous les lignes.
    if (revealStatus && this.isOpen()) this.reveal(this.status);
  }

  private renderTriggerLabel(): void {
    const d = this.display;
    const settled = d.phase === "done" || d.phase === "error" || d.phase === "cancelled" || d.phase === "auth" || d.phase === "linked";
    const fresh = !!this.slot && Date.now() - this.slot.at < SETTLED_MS;
    if (this.variant !== "toolbar") setText(this.label, d.phase === "idle" || (settled && !fresh) ? T.trigger : d.short);
    else if (this.barChip && settled && !fresh) setText(this.barChip, "");
    const base = triggerAria(this.target.context);
    if (this.variant !== "toolbar") {
      setAttr(this.trigger, "aria-label", d.phase === "idle" ? base : `${base} — ${d.message ? `${d.label}. ${d.message}` : d.label}`);
      setAttr(this.trigger, "title", T.dialogLabel);
    }
  }
}

export const HOST_TAG = "aethryon-control";

/** Commande intégrée dans la page : hôte <aethryon-control> + racine Shadow DOM fermée. */
export class InlineHost {
  readonly host: HTMLElement;
  readonly control: Control;
  private ro: ResizeObserver | null = null;
  private sizeRef: Element | null = null;
  private compactBelow = 0;
  private lastParent: Element | null = null;

  constructor(hooks: ControlHooks, target: Target, theme: Theme) {
    const d = hooks.doc;
    this.host = d.createElement(HOST_TAG);
    this.host.setAttribute("data-variant", target.variant);
    const root = this.host.attachShadow({ mode: "closed" });
    this.control = new Control(hooks, target, target.variant, theme);
    root.append(h(d, "style", { text: CONTROL_CSS }), this.control.el);
    isolateEvents(this.host);
    this.watchSize(target);
  }

  /**
   * Insère ou déplace l'hôte vers son ancrage. « reinserted » : la page avait retiré l'hôte du MÊME
   * parent (re-rendu) ; « moved » : nouvel ancrage (première insertion, nœud recyclé, autre vidéo).
   */
  place(t: Target): "none" | "moved" | "reinserted" {
    const a = t.anchor;
    if (!a) return "none";
    // Déjà dans le bon parent, et avant « before » s'il y en a un : rien à faire (jamais de déplacement pour un
    // voisin ajouté par la page : déplacer l'hôte fermerait son menu ouvert).
    const placed = this.host.parentNode === a.parent && this.host.isConnected;
    if (placed && (!a.before || a.before.parentNode !== a.parent || (this.host.compareDocumentPosition(a.before) & Node.DOCUMENT_POSITION_FOLLOWING))) return "none";
    const again = this.lastParent === a.parent;
    if (a.before && a.before.parentNode === a.parent) a.parent.insertBefore(this.host, a.before);
    else a.parent.appendChild(this.host);
    this.lastParent = a.parent;
    return again ? "reinserted" : "moved";
  }

  update(t: Target): void {
    setAttr(this.host, "data-variant", t.variant);
    this.control.setVariant(t.variant);
    this.control.setTarget(t);
    this.watchSize(t);
  }

  setHidden(hidden: boolean): void {
    if (this.host.hidden !== hidden) this.host.hidden = hidden;
    if (hidden) this.control.close();
  }

  destroy(): void {
    this.ro?.disconnect();
    this.ro = null;
    this.control.destroy();
    this.host.remove();
  }

  private watchSize(t: Target): void {
    const ref = t.sizeRef ?? null;
    this.compactBelow = t.compactBelow ?? 0;
    if (ref === this.sizeRef) return;
    this.ro?.disconnect();
    this.ro = null;
    this.sizeRef = ref;
    if (!ref || !this.compactBelow || typeof ResizeObserver !== "function") {
      this.control.setCompact(false);
      return;
    }
    this.ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      this.control.setCompact(w > 0 && w < this.compactBelow);
    });
    this.ro.observe(ref);
  }
}
