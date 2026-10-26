// Content script YouTube : pages « watch » (les liens youtu.be redirigent vers watch) et Shorts.
// - watch  : bouton « chouette + Télécharger » à la fin de la rangée d'actions sous la vidéo ;
// - Shorts : bouton rond dans la colonne d'actions du Short ACTIF, qui suit le défilement.
// Aucune donnée de compte, aucun cookie : seule l'URL de la vidéo (validée) part vers le service worker.
import { cleanText } from "../shared/messages.ts";
import type { DetectedMedia } from "../shared/types.ts";
import { mediaKey, parseMediaUrl, youtubeThumbnail, type MediaRef } from "../shared/urls.ts";
import type { ObserveSpec, PlatformAdapter, ScanContext, ScanResult, Target } from "./common/adapter.ts";
import { qs, qsAll, qsRendered, textOf } from "./common/dom.ts";
import { startContentScript } from "./common/runtime.ts";
import { T } from "./common/strings.ts";
import { detectPageTheme } from "./common/theme.ts";
import { mostVisibleElement } from "./common/visibility.ts";

// =================================================================================================
// SÉLECTEURS YOUTUBE — le SEUL endroit à modifier quand YouTube change son DOM.
// Chaque entrée est une liste ordonnée de replis : le premier sélecteur qui trouve un élément gagne.
// Accroches stables privilégiées : éléments personnalisés (ytd-*, *-view-model), identifiants, attributs.
// =================================================================================================
const SEL = {
  /** Racine de l'application. */
  app: ["ytd-app"],
  /** Gestionnaire de pages : ses enfants changent avec le type de page (watch, Shorts, accueil…). */
  pageManager: ["ytd-page-manager#page-manager", "ytd-page-manager", "#page-manager"],

  // ---- watch ----
  /** Conteneur de la page watch, réutilisé d'une vidéo à l'autre ; attribut video-id = vidéo affichée. */
  watchFlexy: ["ytd-watch-flexy"],
  /** Bloc titre + chaîne + actions sous le lecteur : plus petit conteneur stable à observer. */
  watchMetadata: ["ytd-watch-metadata", "#above-the-fold", "ytd-video-primary-info-renderer"],
  /** Rangée des boutons d'action (J'aime, Partager…) : le bouton AETHRYON s'ajoute à la fin. */
  watchActions: [
    "ytd-watch-metadata #actions #top-level-buttons-computed",
    "ytd-watch-metadata #top-level-buttons-computed",
    "#above-the-fold #top-level-buttons-computed",
    "ytd-video-primary-info-renderer #top-level-buttons-computed",
  ],
  /** Élément dont la largeur décide de l'affichage compact (chouette seule). */
  watchSizeRef: ["ytd-watch-metadata #top-row", "ytd-watch-metadata", "#above-the-fold"],
  /** V3.5 : bloc titre + actions sous le lecteur ; la barre AETHRYON se place juste avant lui (dans #below). */
  watchToolbarBefore: ["ytd-watch-flexy #below > ytd-watch-metadata", "#below > ytd-watch-metadata", "ytd-watch-metadata"],
  /** Titre de la vidéo. */
  watchTitle: [
    "ytd-watch-metadata #title h1 yt-formatted-string",
    "ytd-watch-metadata #title h1",
    "ytd-watch-metadata h1",
    "#above-the-fold #title h1",
    "h1.title yt-formatted-string",
  ],

  // ---- Shorts ----
  /** Page Shorts (lecteur vertical). */
  shorts: ["ytd-shorts"],
  /** Short ACTIF : YouTube pose l'attribut is-active sur celui qui est lu. */
  activeReel: ["ytd-reel-video-renderer[is-active]"],
  /** Tous les Shorts chargés (repli : le plus visible). */
  reels: ["ytd-reel-video-renderer"],
  /** Colonne d'actions d'un Short (J'aime, commentaires, partager…) : bouton rond ajouté à la fin. */
  reelActions: [
    "#actions reel-action-bar-view-model",
    "reel-action-bar-view-model",
    "ytd-reel-player-overlay-renderer #actions",
    "#actions",
    "#button-bar",
  ],
  /** Titre d'un Short. */
  reelTitle: [
    "yt-shorts-video-title-view-model h2",
    "yt-shorts-video-title-view-model",
    "ytd-reel-player-overlay-renderer #video-title",
    "#metadata-container h2",
    "h2.title",
  ],
} as const;
// =================================================================================================

/** En dessous de cette largeur de la rangée titre/actions, le bouton n'affiche que la chouette. */
const WATCH_COMPACT_BELOW = 560;

/** Titre du document sans compteur de notifications ni suffixe « - YouTube ». */
function titleFromDocument(doc: Document): string {
  return cleanText(doc.title.replace(/^\(\d+\+?\)\s*/, "").replace(/\s*[-–]\s*YouTube\s*$/i, ""), 200).replace(/^YouTube$/i, "");
}

function media(ref: MediaRef, title: string): DetectedMedia {
  const m: DetectedMedia = { platform: "youtube", kind: ref.kind, url: ref.url, id: ref.id };
  if (title) m.title = title;
  const thumb = youtubeThumbnail(ref.id);
  if (thumb) m.thumbnail = thumb;
  return m;
}

function pageManagerSpec(doc: Document): ObserveSpec[] {
  const pm = qs(doc, SEL.pageManager);
  return pm ? [{ node: pm, options: { childList: true } }] : [];
}

/** Conteneur d'amorçage tant que celui de la page n'existe pas encore (rappel léger, travail regroupé). */
function bootstrapSpec(doc: Document): ObserveSpec {
  const root = qs(doc, SEL.pageManager) ?? qs(doc, SEL.app) ?? doc.body ?? doc.documentElement;
  return { node: root, options: { childList: true, subtree: true } };
}

function scanWatch(doc: Document, ref: MediaRef): ScanResult {
  const flexy = qs(doc, SEL.watchFlexy);
  // Titre : seulement si le DOM affiche déjà CETTE vidéo (pendant une navigation, l'ancien titre reste
  // un instant) ; sinon titre du document.
  const shown = flexy?.getAttribute("video-id");
  const h1 = !shown || shown === ref.id ? textOf(qsRendered(doc, SEL.watchTitle) ?? qs(doc, SEL.watchTitle)) : "";
  const actions = qsRendered(doc, SEL.watchActions);
  // V3.5 : barre AETHRYON repliable sous le lecteur, avant le titre ; à défaut, le bouton dans la rangée d'actions.
  const before = qsRendered(doc, SEL.watchToolbarBefore) ?? qs(doc, SEL.watchToolbarBefore);
  const below = before?.parentElement ?? null;
  const target: Target = below
    ? { key: mediaKey(ref), media: media(ref, h1 || titleFromDocument(doc)), anchor: { parent: below, before }, variant: "toolbar", context: null }
    : {
      key: mediaKey(ref),
      media: media(ref, h1 || titleFromDocument(doc)),
      anchor: actions ? { parent: actions } : null,
      variant: "bar",
      context: null,
      sizeRef: qs(doc, SEL.watchSizeRef),
      compactBelow: WATCH_COMPACT_BELOW,
    };
  const metadata = qsRendered(doc, SEL.watchMetadata) ?? qs(doc, SEL.watchMetadata);
  const observe = pageManagerSpec(doc);
  observe.push(metadata ? { node: metadata, options: { childList: true, subtree: true } } : flexy ? { node: flexy, options: { childList: true, subtree: true } } : bootstrapSpec(doc));
  // La barre vit dans #below : on voit si YouTube l'en retire (re-rendu) sans observer toute la page.
  if (below && below !== metadata) observe.push({ node: below, options: { childList: true } });
  return { targets: [target], primary: target, observe };
}

function scanShort(doc: Document, win: Window, ref: MediaRef): ScanResult {
  const shorts = qs(doc, SEL.shorts);
  const scope = shorts ?? doc;
  const reels = qsAll(scope, SEL.reels);
  // Short actif : attribut is-active ; à défaut, le plus visible.
  const reel = qs(scope, SEL.activeReel) ?? mostVisibleElement(reels, win);
  const actions = reel ? qsRendered(reel, SEL.reelActions) ?? qs(reel, SEL.reelActions) : null;
  const title = reel ? textOf(qs(reel, SEL.reelTitle)) : "";
  const target: Target = {
    key: mediaKey(ref),
    media: media(ref, title || titleFromDocument(doc)),
    anchor: actions ? { parent: actions } : null,
    variant: "round",
    context: null,
  };
  const observe = pageManagerSpec(doc);
  observe.push(shorts
    ? { node: shorts, options: { childList: true, subtree: true, attributes: true, attributeFilter: ["is-active"] } }
    : bootstrapSpec(doc));
  return { targets: [target], primary: target, observe, visibility: qs(scope, SEL.activeReel) ? [] : reels };
}

function scan(ctx: ScanContext): ScanResult {
  const ref = parseMediaUrl(ctx.href);
  if (ref?.platform === "youtube" && ref.kind === "video") return scanWatch(ctx.doc, ref);
  if (ref?.platform === "youtube" && ref.kind === "short") return scanShort(ctx.doc, ctx.win, ref);
  // Autre page (accueil, recherche, chaîne…) : seulement de quoi voir arriver une page watch/Shorts.
  return { targets: [], primary: null, observe: pageManagerSpec(ctx.doc) };
}

export const youtubeAdapter: PlatformAdapter = {
  platform: "youtube",
  fontFamily: '"Roboto", "Arial", sans-serif',
  navigationEvents: ["yt-navigate-finish", "yt-page-data-updated"],
  scan,
  detect(ctx) {
    const r = scan(ctx);
    return r.primary ? { media: r.primary.media, hint: null } : { media: null, hint: T.hintYouTube };
  },
  theme(doc) {
    return detectPageTheme(doc, { darkAttribute: "dark", extra: [qs(doc, SEL.app)] });
  },
};

startContentScript(youtubeAdapter);
