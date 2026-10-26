// Contrat entre le moteur commun (runtime.ts) et chaque plateforme (youtube.ts, tiktok.ts, x.ts).
// Une plateforme ne fait que LIRE la page : elle décrit les vidéos trouvées (cibles), où insérer la
// commande, quoi observer. Le moteur décide de l'affichage (bouton intégré, panneau, rien) et écrit
// dans le DOM.
import type { DetectResponse } from "../../shared/messages.ts";
import type { DetectedMedia } from "../../shared/types.ts";
import type { Platform } from "../../shared/urls.ts";
import type { Theme } from "./theme.ts";

/**
 * Apparence du bouton intégré :
 * - bar   : pastille « chouette + Télécharger » dans une rangée d'actions (YouTube watch) ;
 * - round : bouton rond + libellé dessous, dans une colonne d'actions (Shorts, TikTok) ;
 * - x     : bouton discret dans la barre d'actions d'une publication X ;
 * - quote : même bouton, sous la carte d'une publication citée (X) ;
 * - toolbar : barre AETHRYON repliable sous le lecteur (YouTube watch, V3.5) ;
 * - panel : dans le panneau flottant (choisi par le moteur, jamais par une plateforme).
 */
export type Variant = "bar" | "round" | "x" | "quote" | "toolbar" | "panel";

/** Point d'insertion : à la fin de parent, ou juste avant « before » s'il est encore enfant de parent. */
export interface Anchor {
  parent: Element;
  before?: Node | null;
}

export interface Target {
  /** Clé d'unicité (mediaKey de src/shared/urls.ts) : une seule commande par clé dans la page. */
  key: string;
  media: DetectedMedia;
  /** null : ancrage introuvable (le moteur bascule sur le panneau flottant après un délai). */
  anchor: Anchor | null;
  variant: Exclude<Variant, "panel">;
  /** Précision affichée et lue par les lecteurs d'écran (« @alice », « Publication citée · @bob »). */
  context: string | null;
  /** Élément dont la largeur décide de l'affichage compact (icône seule) en dessous de compactBelow px. */
  sizeRef?: Element | null;
  compactBelow?: number;
}

export interface ObserveSpec {
  node: Node;
  options: MutationObserverInit;
}

export interface ScanResult {
  /** Vidéos de la page qui peuvent recevoir un bouton intégré (avec ou sans ancrage). */
  targets: Target[];
  /** Vidéo « courante » (lecture, la plus visible…) : panneau flottant et détection. */
  primary: Target | null;
  /** Conteneurs à observer, les plus petits et les plus stables possible. */
  observe: ObserveSpec[];
  /** Éléments dont la visibilité décide de la vidéo courante (fil TikTok, X). */
  visibility?: Element[];
}

export interface ScanContext {
  doc: Document;
  win: Window;
  href: string;
  /** Mode d'affichage en cours : « panel » = la vidéo courante (primary) doit toujours être déterminée. */
  mode: "inline" | "panel" | "detect";
}

export interface PlatformAdapter {
  platform: Platform;
  /** Police de la plateforme pour notre interface (les @font-face de la page restent utilisables). */
  fontFamily: string;
  /** Ne lève jamais ; renvoie une liste vide si la page n'a rien d'exploitable. */
  scan(ctx: ScanContext): ScanResult;
  /** Réponse à « detect.request » (popup). */
  detect(ctx: ScanContext): DetectResponse;
  theme(doc: Document): Theme;
  /** Événements DOM de la plateforme qui signalent une navigation terminée (ex. « yt-navigate-finish »). */
  navigationEvents?: readonly string[];
}

export const EMPTY_SCAN: ScanResult = { targets: [], primary: null, observe: [] };
