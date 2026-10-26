// Utilitaires DOM sûrs pour les content scripts :
// - aucun innerHTML : les éléments sont créés un à un, le texte venant de la page passe par textContent ;
// - requêtes tolérantes : un sélecteur refusé (plateforme, version de Chrome) ne lève jamais, on passe
//   au suivant (les sélecteurs de chaque plateforme sont des listes ordonnées de replis).
import { cleanText } from "../../shared/messages.ts";

/** Premier élément trouvé, en essayant les sélecteurs dans l'ordre. */
export function qs<T extends Element = Element>(root: ParentNode | null | undefined, selectors: readonly string[]): T | null {
  if (!root) return null;
  for (const s of selectors) {
    try {
      const el = root.querySelector<T>(s);
      if (el) return el;
    } catch {
      /* sélecteur invalide : repli suivant */
    }
  }
  return null;
}

/** Éléments du premier sélecteur qui donne au moins un résultat. */
export function qsAll<T extends Element = Element>(root: ParentNode | null | undefined, selectors: readonly string[]): T[] {
  if (!root) return [];
  for (const s of selectors) {
    try {
      const list = root.querySelectorAll<T>(s);
      if (list.length) return Array.from(list);
    } catch {
      /* repli suivant */
    }
  }
  return [];
}

/** Union de tous les sélecteurs, dans l'ordre du document, sans doublon. */
export function qsUnion<T extends Element = Element>(root: ParentNode | null | undefined, selectors: readonly string[]): T[] {
  if (!root || selectors.length === 0) return [];
  try {
    return Array.from(root.querySelectorAll<T>(selectors.join(",")));
  } catch {
    const seen = new Set<T>();
    for (const s of selectors) {
      try {
        root.querySelectorAll<T>(s).forEach((e) => seen.add(e));
      } catch {
        /* ignoré */
      }
    }
    return Array.from(seen).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }
}

/** Premier sélecteur dont un résultat est réellement affiché (YouTube garde des copies cachées). */
export function qsRendered<T extends Element = Element>(root: ParentNode | null | undefined, selectors: readonly string[]): T | null {
  if (!root) return null;
  for (const s of selectors) {
    try {
      for (const el of Array.from(root.querySelectorAll<T>(s))) if (isRendered(el)) return el;
    } catch {
      /* repli suivant */
    }
  }
  return null;
}

export function closestAny(el: Element | null | undefined, selectors: readonly string[]): Element | null {
  if (!el) return null;
  for (const s of selectors) {
    try {
      const c = el.closest(s);
      if (c) return c;
    } catch {
      /* repli suivant */
    }
  }
  return null;
}

export function matchesAny(el: Element, selectors: readonly string[]): boolean {
  for (const s of selectors) {
    try {
      if (el.matches(s)) return true;
    } catch {
      /* ignoré */
    }
  }
  return false;
}

/** Garde seulement les éléments qui ne sont contenus dans aucun autre élément de la liste. */
export function outermost<T extends Element>(els: readonly T[]): T[] {
  const set = new Set<Element>(els);
  return els.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

export function isRendered(el: Element): boolean {
  try {
    return el.isConnected && el.getClientRects().length > 0;
  } catch {
    return false;
  }
}

/** Texte d'un élément de la page, nettoyé et borné (affiché ensuite par textContent uniquement). */
export function textOf(el: Element | null | undefined, max = 200): string {
  return el ? cleanText(el.textContent ?? "", max) : "";
}

/** Premier ancêtre commun de deux éléments. */
export function commonAncestor(a: Element, b: Element): Element | null {
  for (let p: Element | null = a; p; p = p.parentElement) if (p.contains(b)) return p;
  return null;
}

type AttrValue = string | number | boolean | null | undefined;

/** Création d'un élément : classe, texte (textContent), attributs, enfants. Jamais de HTML brut. */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  opts: { class?: string; text?: string; attrs?: Record<string, AttrValue> } = {},
  children: readonly (Node | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (opts.class) el.className = opts.class;
  if (opts.text !== undefined) el.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/** Remplace le texte d'un nœud seulement s'il change (évite des mutations inutiles). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/**
 * Les événements nés dans notre interface ne remontent pas jusqu'à la page : un clic sur le bouton
 * ne doit ni ouvrir la publication X, ni mettre en pause la vidéo TikTok, ni déclencher un raccourci
 * clavier de YouTube. (La fermeture « clic à l'extérieur » du popover est gérée par le navigateur.)
 */
const ISOLATED_EVENTS = [
  "click", "dblclick", "auxclick", "contextmenu", "mousedown", "mouseup", "pointerdown", "pointerup",
  "touchstart", "touchend", "keydown", "keyup", "keypress", "input", "change",
] as const;

export function isolateEvents(host: HTMLElement): void {
  const stop = (e: Event) => e.stopPropagation();
  for (const t of ISOLATED_EVENTS) host.addEventListener(t, stop);
}
