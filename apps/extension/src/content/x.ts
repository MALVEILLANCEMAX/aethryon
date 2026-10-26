// Content script X / Twitter (x.com, twitter.com) : un bouton dans la barre d'actions de CHAQUE
// publication qui contient une vidéo, lié au lien /status/<id> de cette publication. Une vidéo d'une
// publication citée appartient à la publication citée (bouton sous sa carte). Plusieurs vidéos : le
// popover propose « Vidéo 1, 2… » (index). Aucun bouton sans vidéo.
// Le fil X recycle ses nœuds <article> : à chaque mutation pertinente (dont le changement d'un href),
// l'identifiant lié est recalculé depuis le DOM et la commande est déplacée, recréée ou retirée.
import type { DetectedMedia } from "../shared/types.ts";
import { mediaKey, parseMediaUrl, safeThumbnail } from "../shared/urls.ts";
import type { ObserveSpec, PlatformAdapter, ScanContext, ScanResult, Target } from "./common/adapter.ts";
import { closestAny, outermost, qs, qsAll, qsUnion, textOf } from "./common/dom.ts";
import { startContentScript } from "./common/runtime.ts";
import { T, quotedContext } from "./common/strings.ts";
import { detectPageTheme } from "./common/theme.ts";
import { mostVisibleElement } from "./common/visibility.ts";
import { chooseOwnStatus, chooseQuoteStatus, planXBindings, type XBinding, type XLinkInfo } from "./common/x-status.ts";

// =================================================================================================
// SÉLECTEURS X — le SEUL endroit à modifier quand X change son DOM.
// Accroches stables privilégiées : attributs data-testid (posés par X pour ses propres tests), rôles
// ARIA, élément <time> dans le lien de la publication. Les classes CSS de X sont générées : jamais utilisées.
// =================================================================================================
const SEL = {
  /** Racine de l'application (amorçage uniquement). */
  app: ["#react-root", "body"],
  /** Colonne principale (fil, page d'une publication) : conteneur stable observé. */
  primaryColumn: ['[data-testid="primaryColumn"]', 'main[role="main"]', "main"],
  /** Une publication. */
  article: ['article[data-testid="tweet"]', 'article[role="article"]'],
  /** Vidéo ou GIF : on garde l'élément le plus extérieur, pour compter une seule fois chaque vidéo. */
  video: ['[data-testid="videoPlayer"]', '[data-testid="videoComponent"]', "video"],
  /** Barre d'actions (Répondre, Republier, J'aime, Signets…) : rôle ARIA « group ». */
  actionBar: ['[role="group"]'],
  /** Boutons qui identifient une vraie barre d'actions. */
  actionButtons: ['[data-testid="reply"]', '[data-testid="retweet"]', '[data-testid="unretweet"]', '[data-testid="like"]', '[data-testid="unlike"]', '[data-testid="bookmark"]'],
  /** Carte d'une publication citée (bloc cliquable contenant un auteur ou un horodatage). */
  quote: ['div[role="link"]'],
  /** Liens de publication : horodatage (<time> dans le lien), statistiques, médias. */
  statusLink: ['a[href*="/status/"]'],
  userName: ['[data-testid="User-Name"]'],
  text: ['[data-testid="tweetText"]'],
} as const;
// =================================================================================================

/** En dessous de cette largeur de la barre d'actions, le bouton n'affiche que la chouette. */
const X_COMPACT_BELOW = 400;

function articleOf(el: Element): Element | null {
  return closestAny(el, SEL.article);
}

/** Carte de la publication citée dans cette publication (la plus extérieure), ou null. */
function quoteOf(article: Element): Element | null {
  const cards = qsAll(article, SEL.quote).filter((el) => el !== article && articleOf(el) === article && (el.querySelector("time") || qs(el, SEL.userName)));
  return outermost(cards)[0] ?? null;
}

/** Vidéos de « scope » qui appartiennent à la publication « article », hors « exclude » (citation). */
function videosIn(scope: Element, article: Element, exclude: Element | null): Element[] {
  return outermost(qsUnion(scope, SEL.video)).filter((v) => articleOf(v) === article && !(exclude && exclude.contains(v)));
}

function linksOf(article: Element, quote: Element | null): XLinkInfo[] {
  return qsUnion<HTMLAnchorElement>(article, SEL.statusLink)
    .filter((a) => articleOf(a) === article)
    .map((a) => ({ href: a.getAttribute("href") ?? "", hasTime: !!a.querySelector("time"), inQuote: !!quote && quote.contains(a) }));
}

function actionBarOf(article: Element, quote: Element | null): Element | null {
  const bars = qsAll(article, SEL.actionBar).filter((g) => articleOf(g) === article && !(quote && quote.contains(g)) && qs(g, SEL.actionButtons));
  return bars[bars.length - 1] ?? null;
}

function textOutside(scope: Element, exclude: Element | null): string {
  const el = qsAll(scope, SEL.text).find((t) => !(exclude && exclude.contains(t)));
  return textOf(el, 140);
}

interface ArticleScan {
  article: Element;
  quote: Element | null;
  bindings: XBinding[];
}

function scanArticle(article: Element): ArticleScan {
  const quote = quoteOf(article);
  const links = linksOf(article, quote);
  const own = chooseOwnStatus(links);
  const ownVideos = videosIn(article, article, quote).length;
  const quoteInfo = quote ? { status: chooseQuoteStatus(links, own), videos: videosIn(quote, article, null).length } : null;
  return { article, quote, bindings: planXBindings({ own, ownVideos, quote: quoteInfo }) };
}

function targetOf(s: ArticleScan, b: XBinding): Target {
  const scope = b.placement === "quote" && s.quote ? s.quote : s.article;
  const exclude = b.placement === "quote" ? null : s.quote;
  const m: DetectedMedia = { platform: "twitter", kind: "post", url: b.status.url, id: b.status.id, videoCount: b.videoCount };
  const title = textOutside(scope, exclude);
  if (title) m.title = title;
  const firstVideo = videosIn(scope, s.article, exclude)[0];
  const poster = firstVideo ? (firstVideo.matches("video") ? firstVideo : firstVideo.querySelector("video"))?.getAttribute("poster") : null;
  const thumb = safeThumbnail(poster ?? "");
  if (thumb) m.thumbnail = thumb;
  const key = mediaKey({ platform: "twitter", id: b.status.id });
  if (b.placement === "quote" && s.quote) {
    const parent = s.quote.parentElement;
    return {
      key,
      media: m,
      anchor: parent ? { parent, before: s.quote.nextSibling } : null,
      variant: "quote",
      context: quotedContext(b.status.handle),
    };
  }
  const bar = actionBarOf(s.article, s.quote);
  return {
    key,
    media: m,
    anchor: bar ? { parent: bar } : null,
    variant: "x",
    context: b.status.handle ? `@${b.status.handle}` : null,
    sizeRef: bar,
    compactBelow: X_COMPACT_BELOW,
  };
}

function scan(ctx: ScanContext): ScanResult {
  const { doc, win, href } = ctx;
  const column = qs(doc, SEL.primaryColumn);
  const observe: ObserveSpec[] = [column
    ? { node: column, options: { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] } }
    : { node: qs(doc, SEL.app) ?? doc.documentElement, options: { childList: true, subtree: true } }];
  const scans = qsAll(column ?? doc, SEL.article).map(scanArticle);
  const targets: Target[] = [];
  const roots = new Map<Target, Element>();
  for (const s of scans) {
    for (const b of s.bindings) {
      const t = targetOf(s, b);
      targets.push(t);
      roots.set(t, b.placement === "quote" && s.quote ? s.quote : s.article);
    }
  }
  // Vidéo courante : sur la page d'une publication, cette publication ; dans un fil, la plus visible
  // (calculée seulement en mode panneau, pour ne pas mesurer la page à chaque défilement).
  const urlRef = parseMediaUrl(href);
  let primary: Target | null = null;
  let visibility: Element[] | undefined;
  if (urlRef?.platform === "twitter") {
    primary = targets.find((t) => t.media.id === urlRef.id && t.variant === "x") ?? null;
  } else if (ctx.mode === "panel") {
    const els = targets.map((t) => roots.get(t)!).filter(Boolean);
    const best = mostVisibleElement(els, win);
    primary = targets.find((t) => roots.get(t) === best) ?? null;
    visibility = els;
  }
  return { targets, primary, observe, visibility };
}

export const xAdapter: PlatformAdapter = {
  platform: "twitter",
  fontFamily: 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  scan,
  detect(ctx) {
    // Page d'une publication : la publication principale si elle contient une vidéo (videoCount = nombre
    // de vidéos). Partout ailleurs : pas de vidéo « courante » — le bouton sous chaque publication.
    const ref = parseMediaUrl(ctx.href);
    if (ref?.platform === "twitter") {
      const column = qs(ctx.doc, SEL.primaryColumn) ?? ctx.doc;
      for (const article of qsAll(column, SEL.article)) {
        const s = scanArticle(article);
        const own = s.bindings.find((b) => b.placement === "actions" && b.status.id === ref.id);
        if (own) return { media: targetOf(s, own).media, hint: null };
      }
    }
    return { media: null, hint: T.hintX };
  },
  theme(doc) {
    return detectPageTheme(doc);
  },
};

startContentScript(xAdapter);
