// Outils DOM de l'éditeur d'extrait : création sans innerHTML (le menu vit dans des pages tierces, dans une racine
// Shadow DOM fermée ; le popup sous une CSP stricte), animation de hauteur sans saut, mouvement réduit.

type Child = Node | string | null | undefined | false;

/**
 * Apostrophe de l'interface : typographique (’) dans le menu des pages, comme les autres textes des content scripts ;
 * droite (') dans le popup, comme le site et le reste du popup (vérifié par ses essais de typographie).
 */
let apostrophe: "’" | "'" = "’";
export function setApostrophe(a: "’" | "'"): void {
  apostrophe = a;
}
/** Texte de l'interface à la typographie de la page qui l'affiche. */
export const tx = (s: string): string => (apostrophe === "'" ? s.replace(/’/g, "'") : s);

export interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, o: ElOptions = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (o.class) e.className = o.class;
  if (o.text !== undefined) e.textContent = tx(o.text);
  for (const [k, v] of Object.entries(o.attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    e.setAttribute(k, v === true ? "" : tx(String(v)));
  }
  for (const c of children) if (c) e.append(typeof c === "string" ? doc.createTextNode(tx(c)) : c);
  return e;
}

export function setAttr(e: Element, name: string, v: string | null): void {
  if (v === null) e.removeAttribute(name);
  else {
    const t = tx(v);
    if (e.getAttribute(name) !== t) e.setAttribute(name, t);
  }
}

export function setText(e: Element, t: string): void {
  const v = tx(t);
  if (e.textContent !== v) e.textContent = v;
}

/** Élément muni d'un nœud texte (vide) créé d'avance, pour setData. */
export function textEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = cls;
  e.appendChild(doc.createTextNode(tx(text)));
  return e;
}

/**
 * Texte d'un élément changé en réutilisant son nœud texte (aucune mutation « childList » : rien n'est créé ni retiré
 * pendant un geste de la réglette ou de la lentille).
 */
export function setData(e: Element, t: string): void {
  const v = tx(t);
  const n = e.firstChild;
  if (n && n.nodeType === 3 && !n.nextSibling) {
    if ((n as Text).data !== v) (n as Text).data = v;
    return;
  }
  if (e.textContent !== v) e.textContent = v;
}

/** L'utilisateur a demandé moins d'animations (préférence du système). */
export function reducedMotion(win: Window | null | undefined): boolean {
  try {
    return !!win?.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Change le contenu de `box` sans saut de hauteur : la hauteur passe en douceur de l'ancienne à la nouvelle (220 ms,
 * animation Web, contenu rogné le temps du mouvement). Aucune animation si l'utilisateur réduit les mouvements.
 * `after` : appelé une fois la hauteur finale atteinte (repositionner un menu, par exemple).
 */
export function morph(box: HTMLElement, mutate: () => void, after?: () => void): void {
  const win = box.ownerDocument.defaultView;
  if (!box.isConnected || reducedMotion(win) || typeof box.animate !== "function") {
    mutate();
    after?.();
    return;
  }
  const from = box.getBoundingClientRect().height;
  mutate();
  const to = box.getBoundingClientRect().height;
  if (Math.abs(to - from) < 1 || from === 0 && to === 0) {
    after?.();
    return;
  }
  for (const a of box.getAnimations()) if ((a as Animation & { id?: string }).id === "ce-morph") a.cancel();
  const prev = box.style.overflow;
  box.style.overflow = "hidden";
  const anim = box.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 220, easing: "cubic-bezier(.2, .8, .2, 1)" });
  anim.id = "ce-morph";
  const done = () => {
    box.style.overflow = prev;
    after?.();
  };
  anim.addEventListener("finish", done, { once: true });
  anim.addEventListener("cancel", () => { box.style.overflow = prev; }, { once: true });
}
