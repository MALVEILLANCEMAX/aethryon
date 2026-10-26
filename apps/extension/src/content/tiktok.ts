// Content script TikTok : page d'une vidéo (/@compte/video/<id>, y compris la vue détaillée ouverte
// par-dessus le fil) et fils « Pour toi » / « Abonnements », où la commande suit la vidéo actuellement
// affichée (la plus visible). Bouton rond dans la colonne d'actions de cette vidéo.
// Aucun diaporama (/photo/), aucun direct : parseMediaUrl les refuse.
import type { DetectedMedia } from "../shared/types.ts";
import { mediaKey, parseMediaUrl, safeThumbnail, type MediaRef } from "../shared/urls.ts";
import type { ObserveSpec, PlatformAdapter, ScanContext, ScanResult, Target, Variant } from "./common/adapter.ts";
import { commonAncestor, qs, qsAll, textOf } from "./common/dom.ts";
import { startContentScript } from "./common/runtime.ts";
import { T } from "./common/strings.ts";
import { detectPageTheme } from "./common/theme.ts";
import { mostVisibleElement } from "./common/visibility.ts";

// =================================================================================================
// SÉLECTEURS TIKTOK — le SEUL endroit à modifier quand TikTok change son DOM.
// Accroches stables privilégiées : attributs data-e2e (posés par TikTok pour ses propres tests), id du
// lecteur ; les classes CSS de TikTok sont générées et ne servent qu'en dernier repli.
// =================================================================================================
const SEL = {
  /** Racine de l'application (amorçage uniquement). */
  app: ["#app", "#main-content-homepage_hot", "body"],
  /** Élément d'un fil (une vidéo par élément). */
  feedItem: ['[data-e2e="recommend-list-item-container"]', "article[data-scroll-index]", '[data-e2e="feed-item"]'],
  /** Vue détaillée d'une vidéo (page /@compte/video/<id> ou fenêtre par-dessus le fil). */
  detail: ['[data-e2e="browse-video"]', '[data-e2e="detail-video"]', "#main-content-video_detail", '[class*="DivBrowserModeContainer"]'],
  video: ["video"],
  /** Icônes de la colonne d'actions : leur premier ancêtre commun est la colonne (ancrage). */
  likeIcon: ['[data-e2e="like-icon"]', '[data-e2e="browse-like-icon"]'],
  shareIcon: ['[data-e2e="share-icon"]', '[data-e2e="browse-share-icon"]', '[data-e2e="share-btn"]'],
  commentIcon: ['[data-e2e="comment-icon"]', '[data-e2e="browse-comment-icon"]'],
  /** Mêmes icônes, propres à la vue détaillée (repli dans toute la page : jamais celles du fil derrière). */
  browseLikeIcon: ['[data-e2e="browse-like-icon"]'],
  browseOtherIcon: ['[data-e2e="browse-share-icon"]', '[data-e2e="browse-comment-icon"]'],
  browseDesc: ['[data-e2e="browse-video-desc"]'],
  /** Repli si les icônes ne sont pas trouvées (classes générées : fragiles). */
  actionBar: ['section[class*="ActionBar"]', '[class*="ActionBarContainer"]'],
  /** Description (sert de titre). */
  desc: ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="new-desc-span"]'],
  /** Auteur : lien vers /@compte. */
  authorLink: ['a[data-e2e="video-author-avatar"]', 'a[data-e2e="video-author-uniqueid"]', 'a[href^="/@"]'],
  authorText: ['[data-e2e="video-author-uniqueid"]', '[data-e2e="browse-username"]'],
  /** Lien direct vers une vidéo. */
  videoLink: ['a[href*="/video/"]'],
  /** Lecteur dont l'id contient l'identifiant de la vidéo : « xgwrapper-0-7312345678901234567 ». */
  player: ['[id^="xgwrapper-"]'],
  ogImage: ['meta[property="og:image"]'],
} as const;
const PLAYER_ID = /^xgwrapper-\d+-(\d{6,25})$/;
const HANDLE = /^[A-Za-z0-9._-]{1,40}$/;
// =================================================================================================

function absolute(href: string | null, base: string): string {
  try {
    return href ? new URL(href, base).href : "";
  } catch {
    return "";
  }
}

function handleOf(item: Element, base: string): string | null {
  for (const a of qsAll<HTMLAnchorElement>(item, SEL.authorLink)) {
    try {
      const m = /^\/@([^/]+)\/?$/.exec(new URL(a.getAttribute("href") ?? "", base).pathname);
      if (m && m[1] && HANDLE.test(m[1])) return m[1];
    } catch {
      /* lien suivant */
    }
  }
  const t = textOf(qs(item, SEL.authorText), 60).replace(/^@/, "");
  return HANDLE.test(t) ? t : null;
}

function playerIdOf(item: Element): string | null {
  const candidates = [item, ...qsAll(item, SEL.player)];
  for (const el of candidates) {
    const m = PLAYER_ID.exec(el.id);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** Vidéo d'un élément du fil : lien direct, sinon identifiant du lecteur + compte. */
function refOfItem(item: Element, base: string): MediaRef | null {
  for (const a of qsAll<HTMLAnchorElement>(item, SEL.videoLink)) {
    const ref = parseMediaUrl(absolute(a.getAttribute("href"), base));
    if (ref?.platform === "tiktok" && ref.kind === "video") return ref;
  }
  const id = playerIdOf(item);
  const handle = handleOf(item, base);
  if (id && handle) {
    const ref = parseMediaUrl(`https://www.tiktok.com/@${handle}/video/${id}`);
    if (ref?.platform === "tiktok" && ref.kind === "video") return ref;
  }
  return null;
}

/** Colonne (ou rangée) d'actions : premier ancêtre commun des icônes J'aime et Partager/Commentaires. */
function actionBarOf(scope: Element | Document, icons: { like: readonly string[]; others: readonly (readonly string[])[] } = { like: SEL.likeIcon, others: [SEL.shareIcon, SEL.commentIcon] }): Element | null {
  const like = qs(scope, icons.like);
  if (like) {
    let other: Element | null = null;
    for (const sel of icons.others) other ??= qs(scope, sel);
    const bar = other ? commonAncestor(like, other) : like.closest("section");
    if (bar && bar !== scope && (!(scope instanceof Element) || scope.contains(bar))) return bar;
  }
  return qs(scope, SEL.actionBar);
}

/** Vue détaillée dont le conteneur n'englobe pas les actions : repli sur les icônes browse-* de la page. */
function detailActionBar(doc: Document): Element | null {
  return actionBarOf(doc, { like: SEL.browseLikeIcon, others: [SEL.browseOtherIcon] });
}

function variantOf(bar: Element, win: Window): Exclude<Variant, "panel"> {
  try {
    return win.getComputedStyle(bar).flexDirection.startsWith("row") ? "bar" : "round";
  } catch {
    return "round";
  }
}

function thumbnailOf(scope: Element | Document, doc: Document, isDetailPage: boolean): string | null {
  const v = qs<HTMLVideoElement>(scope, SEL.video);
  const poster = safeThumbnail(v?.getAttribute("poster") ?? "");
  if (poster) return poster;
  // og:image décrit la vidéo de la PAGE : seulement sur la page de cette vidéo.
  return isDetailPage ? safeThumbnail(qs(doc, SEL.ogImage)?.getAttribute("content") ?? "") : null;
}

function makeTarget(ref: MediaRef, scope: Element | Document, ctx: ScanContext, isDetailPage: boolean): Target {
  const m: DetectedMedia = { platform: "tiktok", kind: "video", url: ref.url, id: ref.id };
  const title = textOf(qs(scope, SEL.desc), 200) || (isDetailPage ? textOf(qs(ctx.doc, SEL.browseDesc), 200) : "");
  if (title) m.title = title;
  const thumb = thumbnailOf(scope, ctx.doc, isDetailPage);
  if (thumb) m.thumbnail = thumb;
  const bar = actionBarOf(scope) ?? (isDetailPage && scope !== ctx.doc ? detailActionBar(ctx.doc) : null);
  const handle = /^\/(@[^/]+)\//.exec(new URL(ref.url).pathname)?.[1] ?? null;
  return {
    key: mediaKey(ref),
    media: m,
    anchor: bar ? { parent: bar } : null,
    variant: bar ? variantOf(bar, ctx.win) : "round",
    context: handle,
  };
}

function bootstrap(doc: Document): ObserveSpec {
  return { node: qs(doc, SEL.app) ?? doc.documentElement, options: { childList: true, subtree: true } };
}

function scan(ctx: ScanContext): ScanResult {
  const { doc, win, href } = ctx;
  const urlRef = parseMediaUrl(href);

  // Page d'une vidéo, ou vue détaillée ouverte par-dessus le fil : la vidéo est celle de l'URL.
  if (urlRef?.platform === "tiktok" && urlRef.kind === "video") {
    const detail = qs(doc, SEL.detail);
    const t = makeTarget(urlRef, detail ?? doc, ctx, true);
    const observe: ObserveSpec[] = [detail ? { node: detail, options: { childList: true, subtree: true } } : bootstrap(doc)];
    return { targets: [t], primary: t, observe };
  }

  // Fil : la vidéo la plus visible.
  const items = qsAll(doc, SEL.feedItem);
  const withVideo = items.filter((i) => qs(i, SEL.video));
  const current = mostVisibleElement(withVideo, win);
  const observe: ObserveSpec[] = [];
  const list = items[0]?.parentElement;
  if (list) observe.push({ node: list, options: { childList: true } });
  else observe.push(bootstrap(doc));
  if (current) observe.push({ node: current, options: { childList: true, subtree: true } });
  const ref = current ? refOfItem(current, href) : null;
  if (!current || !ref) return { targets: [], primary: null, observe, visibility: items };
  const t = makeTarget(ref, current, ctx, false);
  return { targets: [t], primary: t, observe, visibility: items };
}

export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",
  fontFamily: 'TikTokFont, "Proxima Nova", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  scan,
  detect(ctx) {
    const r = scan(ctx);
    return r.primary ? { media: r.primary.media, hint: null } : { media: null, hint: T.hintTikTok };
  },
  theme(doc) {
    return detectPageTheme(doc, { extra: [qs(doc, ["#app"])] });
  },
};

startContentScript(tiktokAdapter);
