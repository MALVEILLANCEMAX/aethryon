// Composants de référence Égide, en fonctions DOM + classes CSS (genere/egide.css) : utilisables tels quels dans
// l'extension (page, popup, racine Shadow DOM fermée) et depuis React (même balisage en JSX, puis les fonctions
// « attacher… » pour le comportement, qui rendent une fonction de nettoyage pour useEffect).
// Pourquoi pas des Web Components : customElements est indisponible dans les content scripts des extensions
// (monde isolé de Chrome) ; des classes + fonctions marchent partout, y compris au pré-rendu statique du site.
// Accessibilité : noms accessibles, aria-pressed / aria-expanded / aria-disabled, focus visible, Échap rend le focus.
import type { NomIcone } from "../icones.ts";
import { coucheDe, h, icone, idUnique, poserAttributs, s, type Enfant } from "./base.ts";

/* ---------------------------------------------------------------- Bouton ---------------------------------------------------------------- */
export type VarianteBouton = "principal" | "secondaire" | "discret" | "icone" | "mini";

export interface OptionsBouton {
  libelle: string;
  /** principal = l'or, une seule fois par vue ; secondaire ; discret ; icone (libellé = nom accessible + infobulle) ; mini. */
  variante?: VarianteBouton;
  icone?: NomIcone;
  /** Raccourci affiché (bureau seulement) et annoncé (aria-keyshortcuts), ex. « Entrée ». */
  raccourci?: string;
  desactive?: boolean;
  type?: "button" | "submit" | "reset";
  surClic?: (e: MouseEvent) => void;
  doc?: Document;
}

export function bouton(o: OptionsBouton): HTMLButtonElement {
  const v = o.variante ?? "secondaire";
  const seuleIcone = v === "icone";
  const b = h("button", {
    doc: o.doc, class: `eg-btn eg-btn--${v}`,
    attrs: { type: o.type ?? "button", "aria-label": seuleIcone ? o.libelle : null, title: seuleIcone ? o.libelle : null, "aria-keyshortcuts": o.raccourci ?? null },
  }, [
    o.icone ? icone(o.icone, { taille: v === "mini" ? "s" : undefined, doc: o.doc }) : null,
    seuleIcone ? null : h("span", { doc: o.doc, text: o.libelle }),
    o.raccourci && !seuleIcone ? h("kbd", { doc: o.doc, class: "eg-touche", text: o.raccourci }) : null,
  ]);
  activerBouton(b, !o.desactive);
  if (o.surClic) b.addEventListener("click", (e) => { if (b.getAttribute("aria-disabled") !== "true") o.surClic?.(e); });
  return b;
}

/** Désactive sans retirer du parcours clavier (aria-disabled), comme le veut DESIGN_SYSTEM.md § 10. */
export function activerBouton(b: HTMLElement, actif: boolean): void {
  if (actif) b.removeAttribute("aria-disabled"); else b.setAttribute("aria-disabled", "true");
}

/* ---------------------------------------------------------------- Champ ---------------------------------------------------------------- */
export interface OptionsChamp {
  libelle: string;
  nom?: string;
  type?: "text" | "url" | "email" | "search" | "password";
  valeur?: string;
  aide?: string;
  placeholder?: string;
  /** « lien » : l'établi (champ de lien, icône lien à gauche, bord or au focus). */
  variante?: "standard" | "lien";
  /** Libellé visuellement caché (toujours présent pour les lecteurs d'écran). */
  libelleCache?: boolean;
  doc?: Document;
}

export interface Champ {
  racine: HTMLDivElement;
  input: HTMLInputElement;
  /** Affiche (texte) ou retire (null) un message d'erreur relié au champ. */
  erreur(message: string | null): void;
}

export function champ(o: OptionsChamp): Champ {
  const id = idUnique("eg-champ"), idAide = `${id}-aide`, idErr = `${id}-err`;
  const input = h("input", {
    doc: o.doc, class: "eg-champ-input",
    attrs: { id, name: o.nom ?? null, type: o.type ?? (o.variante === "lien" ? "url" : "text"), placeholder: o.placeholder ?? null, spellcheck: "false", autocomplete: "off", "aria-describedby": o.aide ? idAide : null },
  });
  if (o.valeur) input.value = o.valeur;
  const msgErr = h("p", { doc: o.doc, class: "eg-champ-erreur", attrs: { id: idErr, hidden: true } });
  const zone = o.variante === "lien"
    ? h("div", { doc: o.doc, class: "eg-etabli" }, [h("span", { doc: o.doc, class: "eg-etabli-lien", attrs: { "aria-hidden": "true" } }, [icone("lien", { doc: o.doc })]), input])
    : input;
  const racine = h("div", { doc: o.doc, class: "eg-champ" }, [
    h("label", { doc: o.doc, class: o.libelleCache ? "eg-vh" : "eg-champ-libelle", attrs: { for: id }, text: o.libelle }),
    zone,
    o.aide ? h("p", { doc: o.doc, class: "eg-champ-aide", attrs: { id: idAide }, text: o.aide }) : null,
    msgErr,
  ]);
  return {
    racine, input,
    erreur(message) {
      msgErr.textContent = message ?? "";
      msgErr.hidden = !message;
      poserAttributs(input, { "aria-invalid": message ? "true" : null, "aria-describedby": [o.aide ? idAide : "", message ? idErr : ""].filter(Boolean).join(" ") || null });
    },
  };
}

/* ---------------------------------------------------------------- Segments ---------------------------------------------------------------- */
export interface OptionSegment { valeur: string; libelle: string; icone?: NomIcone }

/** Segments : 2 à 4 choix exclusifs (qualité, destination, filtres), boutons aria-pressed dans un groupe nommé. */
export function segment(o: { libelle: string; options: readonly OptionSegment[]; valeur: string; surChoix?: (v: string) => void; doc?: Document }): HTMLDivElement {
  const g = h("div", { doc: o.doc, class: "eg-seg", attrs: { role: "group", "aria-label": o.libelle } },
    o.options.map((x) => h("button", { doc: o.doc, attrs: { type: "button", "data-valeur": x.valeur, "aria-pressed": String(x.valeur === o.valeur) } },
      [x.icone ? icone(x.icone, { taille: "s", doc: o.doc }) : null, h("span", { doc: o.doc, text: x.libelle })])));
  attacherSegment(g, o.surChoix);
  return g;
}

/** Comportement d'un groupe de segments déjà rendu (React) : un seul aria-pressed="true". Rend le nettoyage. */
export function attacherSegment(groupe: HTMLElement, surChoix?: (v: string) => void): () => void {
  const clic = (e: Event) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button[data-valeur]");
    if (!b || !groupe.contains(b) || b.getAttribute("aria-disabled") === "true") return;
    choisirSegment(groupe, b.dataset.valeur ?? "");
    surChoix?.(b.dataset.valeur ?? "");
  };
  groupe.addEventListener("click", clic);
  return () => groupe.removeEventListener("click", clic);
}

export function choisirSegment(groupe: HTMLElement, valeur: string): void {
  for (const b of Array.from(groupe.querySelectorAll<HTMLButtonElement>("button[data-valeur]"))) b.setAttribute("aria-pressed", String(b.dataset.valeur === valeur));
}

/* ---------------------------------------------------------------- Pastille d'état ---------------------------------------------------------------- */
export type Ton = "ok" | "warn" | "err" | "neutre" | "accent";

export function pastille(o: { libelle: string; ton?: Ton; icone?: NomIcone; doc?: Document }): HTMLSpanElement {
  return h("span", { doc: o.doc, class: "eg-pastille", attrs: { "data-ton": o.ton ?? "neutre" } },
    [o.icone ? icone(o.icone, { taille: "s", doc: o.doc }) : h("span", { doc: o.doc, class: "eg-pastille-point", attrs: { "aria-hidden": "true" } }), h("span", { doc: o.doc, text: o.libelle })]);
}

/**
 * États d'une plateforme (catalogue-plateformes.json, champ « statut », + deux états d'interface) : icône neutre +
 * mot, jamais de logo de marque. « temporairement_indisponible » = panne passagère signalée par GET /platforms.
 */
export const STATUTS_PLATEFORME = {
  disponible: { ton: "ok", icone: "ok", libelle: "En ligne" },
  prete_a_ouvrir: { ton: "accent", icone: "horloge", libelle: "Bientôt" },
  preproduction: { ton: "neutre", icone: "reglages", libelle: "En préproduction" },
  non_proposee: { ton: "neutre", icone: "barre", libelle: "Non proposée" },
  indisponible: { ton: "warn", icone: "alerte", libelle: "Indisponible" },
  temporairement_indisponible: { ton: "warn", icone: "retour", libelle: "Temporairement indisponible" },
  refusee: { ton: "err", icone: "interdit", libelle: "Refusée" },
} as const satisfies Record<string, { ton: Ton; icone: NomIcone; libelle: string }>;
export type StatutPlateforme = keyof typeof STATUTS_PLATEFORME;

export function pastillePlateforme(statut: StatutPlateforme, doc?: Document): HTMLSpanElement {
  const x = STATUTS_PLATEFORME[statut];
  return pastille({ libelle: x.libelle, ton: x.ton, icone: x.icone, doc });
}

/* ---------------------------------------------------------------- Nœud et fil ---------------------------------------------------------------- */
/** attente (creux), cours (anneau + point), pause, ok (plein + coche tracée), err (anneau rouge). */
export type EtatNoeud = "attente" | "cours" | "pause" | "ok" | "err";

export function noeud(etat: EtatNoeud = "attente", doc?: Document): HTMLSpanElement {
  return h("span", { doc, class: "eg-noeud", attrs: { "data-etat": etat, "aria-hidden": "true" } },
    [s("svg", { viewBox: "0 0 24 24", focusable: "false" }, [s("path", { d: "m5 12.5 4.5 4.5L19 7.5" }, [], doc)], doc)]);
}
export const majNoeud = (el: HTMLElement, etat: EtatNoeud): void => el.setAttribute("data-etat", etat);

/** Le fil (progression, role=progressbar) : ruban et nœud de tête en translateX, interpolés en 260 ms linéaires. */
export function fil(o: { libelle: string; valeur?: number; epais?: boolean; doc?: Document }): HTMLDivElement {
  const run = h("span", { doc: o.doc, class: "eg-fil-run" });
  const tete = h("span", { doc: o.doc, class: "eg-fil-tete" });
  const el = h("div", {
    doc: o.doc, class: `eg-fil${o.epais ? " eg-fil--epais" : ""}`,
    attrs: { role: "progressbar", "aria-label": o.libelle, "aria-valuemin": 0, "aria-valuemax": 100 },
  }, [h("span", { doc: o.doc, class: "eg-fil-piste" }, [run]), tete]);
  majFil(el, o.valeur ?? 0);
  return el;
}

/** Met le fil à `p` (0 à 1). Les chiffres affichés à côté ne s'animent pas. */
export function majFil(el: HTMLElement, p: number): void {
  const pc = Math.max(0, Math.min(100, Math.round((Number.isFinite(p) ? p : 0) * 1000) / 10));
  el.setAttribute("aria-valuenow", String(Math.round(pc)));
  el.setAttribute("data-p", pc ? "1" : "0");
  const t = `translateX(${pc - 100}%)`;
  for (const c of Array.from(el.querySelectorAll<HTMLElement>(".eg-fil-run, .eg-fil-tete"))) c.style.transform = t;
}

/* ---------------------------------------------------------------- Carte média ---------------------------------------------------------------- */
export interface OptionsCarteMedia {
  titre: string;
  /** Métadonnées séparées par des espaces (jamais par des points médians). */
  meta?: readonly string[];
  duree?: string;
  /** Image de la vignette (même origine) ; sinon un fond neutre. */
  vignette?: { src: string; alt?: string };
  actions?: readonly HTMLElement[];
  /** Pastille (format, état) posée sur la vignette. */
  badge?: HTMLElement;
  doc?: Document;
}

/** Carte média (grille de bibliothèque) : article focalisable, actions au survol / focus, visibles en tactile. */
export function carteMedia(o: OptionsCarteMedia): HTMLElement {
  const idTitre = idUnique("eg-media");
  return h("article", { doc: o.doc, class: "eg-carte-media", attrs: { tabindex: 0, "aria-labelledby": idTitre } }, [
    h("div", { doc: o.doc, class: "eg-carte-media-vignette" }, [
      o.vignette ? h("img", { doc: o.doc, attrs: { src: o.vignette.src, alt: o.vignette.alt ?? "", loading: "lazy", decoding: "async" } }) : null,
      o.duree ? h("span", { doc: o.doc, class: "eg-duree", text: o.duree }) : null,
      o.badge ?? null,
      o.actions?.length ? h("div", { doc: o.doc, class: "eg-carte-media-actions" }, [...o.actions]) : null,
    ]),
    h("div", { doc: o.doc, class: "eg-carte-media-texte" }, [
      h("h3", { doc: o.doc, class: "eg-carte-media-titre", attrs: { id: idTitre }, text: o.titre }),
      o.meta?.length ? h("p", { doc: o.doc, class: "eg-carte-media-meta" }, o.meta.map((m) => h("span", { doc: o.doc, text: m }))) : null,
    ]),
  ]);
}

/* ---------------------------------------------------------------- Menu ---------------------------------------------------------------- */
export interface ElementMenu { libelle: string; icone?: NomIcone; raccourci?: string; danger?: boolean; action: () => void }

/**
 * Comportement d'un menu déjà rendu (React) : `menu` contient des éléments [role=menuitem]. Ouverture au clic sur le
 * déclencheur (aria-expanded), flèches haut / bas, Début / Fin, Échap et Tab ferment, Échap rend le focus, clic
 * extérieur ferme. Le menu s'ouvre DEPUIS son déclencheur (transform-origin). Rend le nettoyage.
 */
export function attacherMenu(declencheur: HTMLElement, menu: HTMLElement): () => void {
  if (!menu.id) menu.id = idUnique("eg-menu");
  poserAttributs(declencheur, { "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menu.id });
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
  const placer = () => {
    const r = declencheur.getBoundingClientRect();
    const vw = declencheur.ownerDocument.documentElement.clientWidth;
    const droite = r.left + r.width / 2 > vw / 2;
    menu.style.setProperty("--eg-menu-haut", `${Math.round(r.bottom + 6)}px`);
    menu.style.setProperty(droite ? "--eg-menu-droite" : "--eg-menu-gauche", `${Math.round(droite ? vw - r.right : r.left)}px`);
    menu.style.removeProperty(droite ? "--eg-menu-gauche" : "--eg-menu-droite");
    menu.dataset.ancre = droite ? "droite" : "gauche";
  };
  const ouvert = () => !menu.hidden;
  const fermer = (rendreFocus: boolean) => {
    if (!ouvert()) return;
    menu.hidden = true;
    declencheur.setAttribute("aria-expanded", "false");
    if (rendreFocus) declencheur.focus();
  };
  const ouvrir = (premier: "premier" | "dernier" = "premier") => {
    placer();
    menu.hidden = false;
    declencheur.setAttribute("aria-expanded", "true");
    const l = items();
    (premier === "dernier" ? l[l.length - 1] : l[0])?.focus();
  };
  const surDeclencheur = () => (ouvert() ? fermer(true) : ouvrir());
  const surToucheDeclencheur = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); ouvrir("premier"); }
    if (e.key === "ArrowUp") { e.preventDefault(); ouvrir("dernier"); }
  };
  const surToucheMenu = (e: KeyboardEvent) => {
    const l = items(), i = l.indexOf(e.target as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); l[(i + 1) % l.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); l[(i - 1 + l.length) % l.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); l[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); l[l.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fermer(true); }
    else if (e.key === "Tab") fermer(false);
  };
  const surClicMenu = (e: Event) => {
    const it = (e.target as Element).closest<HTMLElement>('[role="menuitem"]');
    if (it && it.getAttribute("aria-disabled") !== "true") fermer(true);
  };
  // Clic extérieur : la racine du menu (document ou racine Shadow DOM FERMÉE, dont le chemin n'est pas visible depuis
  // le document) note si le geste est dedans ; le document, en bouillonnement, ferme sinon.
  const racine = menu.getRootNode() as Document | ShadowRoot;
  let dedans = false;
  const noter = (e: Event) => { const p = e.composedPath(); dedans = p.includes(menu) || p.includes(declencheur); };
  const surPointeurDehors = () => { if (ouvert() && !dedans) fermer(false); dedans = false; };
  const d = declencheur.ownerDocument;
  declencheur.addEventListener("click", surDeclencheur);
  declencheur.addEventListener("keydown", surToucheDeclencheur);
  menu.addEventListener("keydown", surToucheMenu);
  menu.addEventListener("click", surClicMenu);
  racine.addEventListener("pointerdown", noter, true);
  d.addEventListener("pointerdown", surPointeurDehors);
  return () => {
    declencheur.removeEventListener("click", surDeclencheur);
    declencheur.removeEventListener("keydown", surToucheDeclencheur);
    menu.removeEventListener("keydown", surToucheMenu);
    menu.removeEventListener("click", surClicMenu);
    racine.removeEventListener("pointerdown", noter, true);
    d.removeEventListener("pointerdown", surPointeurDehors);
  };
}

/** Construit un menu (éléments du menu) pour un déclencheur et l'insère dans la couche de la page ou de la racine Shadow DOM. */
export function menu(declencheur: HTMLElement, o: { libelle: string; elements: readonly ElementMenu[]; doc?: Document }): { element: HTMLDivElement; detruire: () => void } {
  const el = h("div", { doc: o.doc, class: "eg-menu", attrs: { "aria-label": o.libelle } }, o.elements.map((x) => {
    const b = h("button", { doc: o.doc, class: `eg-menu-item${x.danger ? " eg-menu-item--danger" : ""}`, attrs: { type: "button", role: "menuitem", tabindex: -1, "aria-keyshortcuts": x.raccourci ?? null } },
      [x.icone ? icone(x.icone, { taille: "s", doc: o.doc }) : null, h("span", { doc: o.doc, text: x.libelle }), x.raccourci ? h("kbd", { doc: o.doc, class: "eg-touche", text: x.raccourci }) : null]);
    b.addEventListener("click", () => x.action());
    return b;
  }));
  coucheDe(declencheur).append(el);
  const net = attacherMenu(declencheur, el);
  return { element: el, detruire: () => { net(); el.remove(); } };
}

/* ---------------------------------------------------------------- Dialogue ---------------------------------------------------------------- */
export interface Dialogue { element: HTMLDialogElement; corps: HTMLDivElement; ouvrir(): void; fermer(): void; detruire(): void }

/**
 * Comportement d'un <dialog> déjà rendu : modal natif (piège du focus, Échap, arrière-plan inerte), fermeture au clic
 * sur le voile, focus RENDU à l'élément qui l'a ouvert. Rend { ouvrir, fermer, nettoyage }.
 */
export function attacherDialogue(dlg: HTMLDialogElement): { ouvrir(): void; fermer(): void; nettoyage(): void } {
  let retour: HTMLElement | null = null;
  const surClic = (e: MouseEvent) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  };
  const surFermeture = () => { const r = retour; retour = null; if (r && r.isConnected) r.focus(); };
  dlg.addEventListener("click", surClic);
  dlg.addEventListener("close", surFermeture);
  return {
    ouvrir() {
      const actif = dlg.ownerDocument.activeElement;
      retour = actif instanceof HTMLElement ? actif : null;
      if (!dlg.open) dlg.showModal();
    },
    fermer() { if (dlg.open) dlg.close(); },
    nettoyage() { dlg.removeEventListener("click", surClic); dlg.removeEventListener("close", surFermeture); },
  };
}

/** Construit un dialogue (titre, contenu, actions ; un bouton porteur de data-eg-fermer ferme). */
export function dialogue(o: { titre: string; contenu?: Enfant[]; actions?: HTMLElement[]; parent?: ParentNode; doc?: Document }): Dialogue {
  const idTitre = idUnique("eg-dlg");
  const corps = h("div", { doc: o.doc, class: "eg-dialogue-corps" }, o.contenu ?? []);
  const el = h("dialog", { doc: o.doc, class: "eg-dialogue", attrs: { "aria-labelledby": idTitre } }, [
    h("h2", { doc: o.doc, class: "eg-dialogue-titre eg-titre", attrs: { id: idTitre }, text: o.titre }),
    corps,
    o.actions?.length ? h("div", { doc: o.doc, class: "eg-dialogue-pied" }, o.actions) : null,
  ]);
  (o.parent ?? (o.doc ?? document).body).append(el);
  const c = attacherDialogue(el);
  const surFermer = (e: Event) => { if ((e.target as Element).closest("[data-eg-fermer]")) c.fermer(); };
  el.addEventListener("click", surFermer);
  return {
    element: el, corps, ouvrir: c.ouvrir, fermer: c.fermer,
    detruire() { c.fermer(); c.nettoyage(); el.removeEventListener("click", surFermer); el.remove(); },
  };
}

/* ---------------------------------------------------------------- Infobulle ---------------------------------------------------------------- */
/**
 * Infobulle d'un élément (icône seule, rail) : au survol (pointeur fin, après 400 ms) et au focus clavier
 * (immédiat), cachée par Échap, la sortie et la perte du focus. Reliée par aria-describedby. Rend le nettoyage.
 */
export function attacherInfobulle(cible: HTMLElement, texte: string): () => void {
  const d = cible.ownerDocument;
  const bulle = h("div", { doc: d, class: "eg-infobulle", attrs: { role: "tooltip", id: idUnique("eg-bulle"), hidden: true }, text: texte });
  coucheDe(cible).append(bulle);
  const decrit = (cible.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  // Une icône seule a déjà ce texte pour nom accessible : ne pas le faire lire deux fois.
  if (cible.getAttribute("aria-label") !== texte) cible.setAttribute("aria-describedby", [...decrit, bulle.id].join(" "));
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const montrer = () => {
    clearTimeout(minuterie);
    const r = cible.getBoundingClientRect();
    bulle.hidden = false;
    const b = bulle.getBoundingClientRect();
    const vw = d.documentElement.clientWidth;
    const gauche = Math.max(8, Math.min(vw - b.width - 8, r.left + r.width / 2 - b.width / 2));
    const enHaut = r.top - b.height - 8 >= 0;
    bulle.style.setProperty("--eg-bulle-x", `${Math.round(gauche)}px`);
    bulle.style.setProperty("--eg-bulle-y", `${Math.round(enHaut ? r.top - b.height - 8 : r.bottom + 8)}px`);
    bulle.dataset.cote = enHaut ? "haut" : "bas";
  };
  const cacher = () => { clearTimeout(minuterie); bulle.hidden = true; };
  const entrer = (e: PointerEvent) => { if (e.pointerType === "mouse") { clearTimeout(minuterie); minuterie = setTimeout(montrer, 400); } };
  const touche = (e: KeyboardEvent) => { if (e.key === "Escape" && !bulle.hidden) { e.stopPropagation(); cacher(); } };
  const focus = () => { if (cible.matches(":focus-visible")) montrer(); };
  cible.addEventListener("pointerenter", entrer);
  cible.addEventListener("pointerleave", cacher);
  cible.addEventListener("focus", focus);
  cible.addEventListener("blur", cacher);
  cible.addEventListener("keydown", touche);
  return () => {
    cacher();
    cible.removeEventListener("pointerenter", entrer);
    cible.removeEventListener("pointerleave", cacher);
    cible.removeEventListener("focus", focus);
    cible.removeEventListener("blur", cacher);
    cible.removeEventListener("keydown", touche);
    cible.setAttribute("aria-describedby", decrit.join(" "));
    if (!decrit.length) cible.removeAttribute("aria-describedby");
    bulle.remove();
  };
}

/* ---------------------------------------------------------------- Toasts ---------------------------------------------------------------- */
/** Région des toasts (« Notifications ») : bas droite au bureau, haut en mobile. */
export function regionToasts(parent?: ParentNode, doc?: Document): HTMLDivElement {
  const el = h("div", { doc, class: "eg-toasts", attrs: { role: "region", "aria-label": "Notifications" } });
  (parent ?? (doc ?? document).body).append(el);
  return el;
}

export interface OptionsToast {
  titre: string;
  texte?: string;
  etat?: "ok" | "err";
  action?: { libelle: string; faire: () => void };
  /** Durée d'affichage (ms), 4 s par défaut ; en pause au survol et quand l'onglet est caché. */
  duree?: number;
}

export function toast(region: HTMLElement, o: OptionsToast): { element: HTMLDivElement; fermer: () => void } {
  const d = region.ownerDocument;
  const err = o.etat === "err";
  const bouton = o.action ? h("button", { doc: d, class: "eg-btn eg-btn--discret", attrs: { type: "button" }, text: o.action.libelle }) : null;
  const t = h("div", { doc: d, class: "eg-toast", attrs: { role: err ? "alert" : "status", "data-etat": err ? "err" : "ok" } }, [
    noeud(err ? "err" : "ok", d),
    h("div", { doc: d, class: "eg-toast-texte" }, [h("b", { doc: d, text: o.titre }), o.texte ? h("span", { doc: d, text: o.texte }) : null]),
    bouton,
  ]);
  let reste = o.duree ?? 4000, debut = Date.now(), minuterie: ReturnType<typeof setTimeout> | undefined, ferme = false;
  const fermer = () => {
    if (ferme) return;
    ferme = true;
    clearTimeout(minuterie);
    d.removeEventListener("visibilitychange", visibilite);
    t.classList.add("eg-toast--sort");
    setTimeout(() => t.remove(), 200);
  };
  const pause = () => { clearTimeout(minuterie); reste -= Date.now() - debut; };
  const reprise = () => { if (ferme) return; debut = Date.now(); clearTimeout(minuterie); minuterie = setTimeout(fermer, Math.max(800, reste)); };
  const visibilite = () => (d.hidden ? pause() : reprise());
  if (bouton && o.action) { const a = o.action; bouton.addEventListener("click", () => { a.faire(); fermer(); }); }
  t.addEventListener("pointerenter", pause);
  t.addEventListener("pointerleave", reprise);
  t.addEventListener("focusin", pause);
  t.addEventListener("focusout", reprise);
  d.addEventListener("visibilitychange", visibilite);
  region.append(t);
  minuterie = setTimeout(fermer, reste);
  return { element: t, fermer };
}
