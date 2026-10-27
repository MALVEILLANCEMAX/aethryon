// L'ÉDITEUR DE THÈMES (Réglages › Apparence, THEME_ENGINE.md § 6), en fonctions DOM : même éditeur pour l'app web,
// Desktop et les réglages de l'extension. Aperçu immédiat (sous-arbre aux jetons du brouillon), 27 contrastes vérifiés
// à chaque geste, correction automatique, export (copier ET télécharger) et import JSON validés, réinitialisation
// par section et totale (avec « Annuler »), sauvegarde locale. Le thème reste une donnée : aucun code, aucune URL.
// Écarts corrigés par rapport à la démonstration : aucun style en ligne écrit en HTML (pastilles par CSSOM), aucun
// gestionnaire en ligne, groupes radio au clavier (flèches), export copiable même quand le téléchargement est bloqué.
import { appliquerTheme } from "../appliquer.ts";
import { hexVersOklch } from "../couleur.ts";
import { DENSITES, MOUVEMENTS, TYPOS } from "../jetons.ts";
import { NOMS_ROLES, corrigerContrastes, couleursCompletes, resoudreTheme, verifierContrastes, type ThemeResolu } from "../moteur.ts";
import type { Persistance } from "../persistance.ts";
import { exporterTheme, idDepuisNom, importerTheme, nomFichierTheme, normaliserDoc, validerTexte } from "../schema.ts";
import { ACCENTS, BASES, CUSTOM_EXEMPLE, OFFICIELS, TAILLE_MAX, cloner, docOfficiel, type BaseId, type DocTheme, type Graines, type Role } from "../themes.ts";
import { h, icone, idUnique, type Enfant } from "./base.ts";
import { chouette } from "./chouette.ts";
import { activerBouton, bouton, dialogue, fil, majFil, majNoeud, noeud, regionToasts, segment, choisirSegment, toast } from "./composants.ts";

export interface OptionsEditeur {
  /** Où la préférence est gardée (creerPersistance()). */
  persistance: Persistance;
  /** Portée à laquelle « Appliquer » applique le thème (défaut : la racine du document). */
  cible?: HTMLElement;
  /** Région des toasts existante (sinon l'éditeur en crée une). */
  toasts?: HTMLElement;
  /** Appelé après « Appliquer » et « Tout réinitialiser ». */
  surApplique?: (theme: ThemeResolu, doc: DocTheme | null) => void;
  doc?: Document;
}

const PRECISES: readonly Role[] = ["canvas", "surface", "raised", "text", "text-2", "text-3", "accent", "thread"];
const NEUTRES_ROLES: readonly Role[] = ["canvas", "surface", "raised", "sunken", "line", "line-strong", "control", "text", "text-2", "text-3", "ok", "warn", "err"];
const LIB_DENSITE: Record<keyof typeof DENSITES, string> = { compacte: "Compacte", standard: "Standard", aeree: "Aérée" };
const LIB_MOUV: Record<keyof typeof MOUVEMENTS, string> = { complete: "Complètes", douce: "Douces", reduite: "Réduites", aucune: "Aucune" };
const virgule = (v: number): string => String(v).replace(".", ",");
const majuscule = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export function creerEditeurThemes(hote: HTMLElement, o: OptionsEditeur): { element: HTMLElement; detruire: () => void } {
  const d = o.doc ?? hote.ownerDocument;
  const cible = o.cible ?? d.documentElement;
  const region = o.toasts ?? regionToasts(undefined, d);
  const notifier = (titre: string, texte = "", etat: "ok" | "err" = "ok", action?: { libelle: string; faire: () => void }) =>
    toast(region, { titre, texte, etat, ...(action ? { action } : {}) });
  const nettoyages: (() => void)[] = [];
  const E = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", enfants: Enfant[] = [], attrs: Record<string, string | number | boolean | null> = {}) =>
    h(tag, { doc: d, class: cls, attrs }, enfants);

  /* ---------- État du brouillon ---------- */
  const pref = o.persistance.lire();
  let doc: DocTheme = normaliserDoc(pref.actif === "custom" ? (pref.perso ?? CUSTOM_EXEMPLE) : docOfficiel(pref.actif));
  let modifie = pref.actif === "custom";
  if (!modifie) doc.id = "perso.mon-theme";
  let r: ThemeResolu = resoudreTheme(doc);
  const graines = (): Graines => (doc.seeds = doc.seeds ?? {});
  const jetons = () => (doc.tokens = doc.tokens ?? {});
  const base = () => OFFICIELS[doc.base];

  /* ---------- Construction ---------- */
  const id = idUnique("eg-ed");
  const radio = (cls: string, libelle: string, attrs: Record<string, string>, enfants: Enfant[]) =>
    E("button", cls, enfants, { type: "button", role: "radio", "aria-checked": "false", tabindex: -1, ...attrs, "aria-label": libelle });
  const pastilles = (b: BaseId) => E("span", "eg-ed-pastilles", (["canvas", "surface", "accent", "thread"] as const).map((k) => {
    const i = E("i"); i.style.setProperty("--eg-sw", OFFICIELS[b].c[k]); return i;
  }), { "aria-hidden": "true" });
  const bases = E("div", "eg-ed-bases", BASES.map((b) => radio("eg-ed-base", OFFICIELS[b].nom, { "data-base": b }, [pastilles(b), E("span", "", [OFFICIELS[b].nom])])), { role: "radiogroup", "aria-label": "Thème de départ" });
  const accents = E("div", "eg-ed-accents", ACCENTS.map(([hex, nom]) => {
    const b = radio("eg-ed-accent", nom, { "data-accent": hex, title: nom }, []);
    b.style.setProperty("--eg-sw", hex);
    return b;
  }), { role: "radiogroup", "aria-labelledby": `${id}-acc` });
  const accentLibre = E("input", "", [], { type: "color", "aria-label": "Autre couleur d'accent" }) as HTMLInputElement;
  const curseur = (cle: string, libelle: string, min: number, max: number, pas: number) => {
    const input = E("input", "eg-ed-range", [], { type: "range", id: `${id}-${cle}`, min, max, step: pas, "data-cle": cle }) as HTMLInputElement;
    const sortie = E("output", "eg-mono", [], { for: `${id}-${cle}` });
    return { input, sortie, bloc: E("div", "eg-ed-champ", [E("label", "eg-ed-lib", [libelle], { for: `${id}-${cle}` }), E("div", "eg-ed-curseur", [input, sortie])]) };
  };
  const cTeinte = curseur("neutralHue", "Teinte des fonds", 0, 360, 1);
  const cSat = curseur("neutralChroma", "Saturation des fonds", 0, 40, 1);
  const cLum = curseur("background", "Clarté du fond", 0, 100, 1);
  const cRayon = curseur("r", "Arrondis", 0, 20, 1);
  const cTexte = curseur("t", "Taille du texte", 90, 125, 5);
  cTeinte.input.classList.add("eg-ed-range--teinte");
  const segContraste = segment({ libelle: "Contraste", options: [{ valeur: "standard", libelle: "Standard" }, { valeur: "eleve", libelle: "Élevé" }], valeur: "standard", doc: d });
  const segDensite = segment({ libelle: "Densité", options: Object.keys(DENSITES).map((k) => ({ valeur: k, libelle: LIB_DENSITE[k as keyof typeof DENSITES] })), valeur: "standard", doc: d });
  const segTypo = segment({ libelle: "Typographie", options: Object.entries(TYPOS).map(([k, l]) => ({ valeur: k, libelle: l })), valeur: "egide", doc: d });
  segTypo.classList.add("eg-ed-typos");
  for (const b of Array.from(segTypo.querySelectorAll<HTMLElement>("button"))) b.prepend(E("span", `eg-ed-aa eg-ed-aa--${b.dataset.valeur}`, ["Aa"], { "aria-hidden": "true" }));
  const segMouv = segment({ libelle: "Animations", options: Object.keys(MOUVEMENTS).map((k) => ({ valeur: k, libelle: LIB_MOUV[k as keyof typeof MOUVEMENTS] })), valeur: "complete", doc: d });
  const interrupteur = (effet: "sheen" | "grain", libelle: string) => {
    const lid = `${id}-${effet}`;
    const b = E("button", "eg-interrupteur", [], { type: "button", role: "switch", "aria-checked": "false", "data-effet": effet, "aria-labelledby": lid });
    return { b, bloc: E("div", "eg-ed-champ eg-ed-inter", [E("span", "eg-ed-lib", [libelle], { id: lid }), b]) };
  };
  const iReflet = interrupteur("sheen", "Reflet des panneaux");
  const iGrain = interrupteur("grain", "Grain du papier");
  const precises = PRECISES.map((k) => {
    const input = E("input", "", [], { type: "color", "data-token": `c-${k}` }) as HTMLInputElement;
    const sortie = E("output", "eg-mono");
    return { k, input, sortie, bloc: E("label", "eg-ed-couleur", [input, E("span", "", [majuscule(NOMS_ROLES[k])]), sortie]) };
  });
  const raz = (section: string) => bouton({ libelle: "Réinitialiser", variante: "mini", icone: "retour", doc: d, surClic: () => razSection(section) });
  const champ = (libelle: string, lid: string, controle: HTMLElement) => E("div", "eg-ed-champ", [E("span", "eg-ed-lib", [libelle], { id: lid }), controle]);
  segContraste.removeAttribute("aria-label"); segContraste.setAttribute("aria-labelledby", `${id}-ct`);
  segDensite.removeAttribute("aria-label"); segDensite.setAttribute("aria-labelledby", `${id}-de`);
  segTypo.removeAttribute("aria-label"); segTypo.setAttribute("aria-labelledby", `${id}-ty`);
  segMouv.removeAttribute("aria-label"); segMouv.setAttribute("aria-labelledby", `${id}-mv`);
  const section = (titre: string, raz_: HTMLElement | null, enfants: Enfant[]) =>
    E("section", "eg-ed-sec", [E("div", "eg-ed-sec-tete", [E("h3", "", [titre]), raz_]), ...enfants]);

  const reglages = E("div", "eg-ed-reglages", [
    section("Thème de départ", null, [bases]),
    section("Couleurs", raz("couleurs"), [
      E("div", "eg-ed-champ", [E("span", "eg-ed-lib", ["Accent"], { id: `${id}-acc` }), E("div", "eg-ed-accents-ligne", [accents, E("label", "eg-ed-accent eg-ed-autre", [icone("plus", { taille: "s", doc: d }), accentLibre], { title: "Autre couleur" })])]),
      cTeinte.bloc, cSat.bloc, cLum.bloc,
      champ("Contraste", `${id}-ct`, segContraste),
      E("details", "eg-ed-precises", [E("summary", "", [icone("chevron", { taille: "s", doc: d }), "Couleurs précises"]), E("div", "eg-ed-precises-g", precises.map((p) => p.bloc))]),
    ]),
    section("Forme et taille", raz("forme"), [cRayon.bloc, champ("Densité", `${id}-de`, segDensite), cTexte.bloc, champ("Typographie", `${id}-ty`, segTypo)]),
    section("Mouvement et effets", raz("mouvement"), [champ("Animations", `${id}-mv`, segMouv), iReflet.bloc, iGrain.bloc]),
  ]);

  /* Aperçu : un vrai fragment d'interface, portée aux jetons du brouillon (inert : rien n'y est cliquable). */
  const apFil = fil({ libelle: "Aperçu de progression", valeur: 0.35, doc: d });
  const apNoeud = noeud("cours", d);
  const apPc = E("span", "eg-mono eg-ed-ap-pc", ["35 %"]);
  const apToast = E("div", "eg-ed-ap-toast", [noeud("ok", d), E("b", "", ["Converti"]), E("span", "", ["La nuit des chouettes"])]);
  const tuile = (ic: "video" | "son" | "gif", nom: string, choisie: boolean) =>
    E("span", "eg-tuile", [E("span", "eg-tuile-coche", [icone("ok", { doc: d })]), icone(ic, { taille: "l", doc: d }), E("b", "", [nom])], { "aria-pressed": String(choisie) });
  const apercu = E("div", "eg-ed-apercu eg-scope", [
    E("div", "eg-ed-ap-barre", [E("span", "eg-marque", [chouette({ taille: 14, doc: d }), "AETHRYON"]), E("span", "eg-ed-ap-cmd", [icone("cherche", { taille: "s", doc: d }), E("span", "", ["Chercher"]), E("kbd", "eg-touche", ["Ctrl K"])])]),
    E("div", "eg-ed-ap-corps", [
      E("div", "eg-ed-ap-nav", [
        E("span", "", [icone("convertir", { taille: "s", doc: d }), E("span", "", ["Convertir"])], { "aria-current": "page" }),
        E("span", "eg-ed-ap-survol", [icone("biblio", { taille: "s", doc: d }), E("span", "", ["Bibliothèque"])]),
        E("span", "", [icone("fil", { taille: "s", doc: d }), E("span", "", ["Transferts"])]),
        E("span", "", [icone("reglages", { taille: "s", doc: d }), E("span", "", ["Réglages"])]),
      ]),
      E("div", "eg-ed-ap-trav", [
        E("div", "eg-etabli", [E("span", "eg-etabli-lien", [icone("lien", { taille: "s", doc: d })]), E("span", "eg-mono eg-ed-ap-url", ["exemple.org/demonstration"]), E("span", "eg-pastille", [E("span", "eg-pastille-point"), E("span", "", ["Vidéo"])], { "data-ton": "accent" })]),
        E("div", "eg-ed-ap-media", [E("div", "eg-ed-ap-vignette", [E("span", "eg-duree", ["4:12"])]), E("div", "", [E("b", "eg-titre", ["La nuit des chouettes"]), E("span", "", ["Démonstration"]), E("small", "eg-mono", ["1:02.5 → 1:32.5"])])]),
        E("div", "eg-tuiles", [tuile("video", "MP4", true), tuile("son", "MP3", false), tuile("gif", "GIF", false)]),
        E("div", "eg-ed-ap-ligne", [E("span", "eg-seg", [E("button", "", ["Dossier"], { type: "button", "aria-pressed": "true", tabindex: -1 }), E("button", "", ["Premiere Pro"], { type: "button", "aria-pressed": "false", tabindex: -1 })]), E("span", "eg-btn eg-btn--principal", ["Convertir"])]),
        E("div", "eg-ed-ap-tache", [apNoeud, E("div", "", [E("div", "eg-ed-ap-t1", [E("b", "", ["Marée basse au cap Fréhel"]), apPc]), apFil, E("small", "", ["Réception du passage"])])]),
        apToast,
        E("p", "eg-ed-ap-err", [icone("alerte", { taille: "s", doc: d }), "Vidéo privée : la plateforme refuse l'accès."]),
      ]),
    ]),
  ], { inert: "", "aria-label": "Aperçu du thème", role: "img" });
  const contrastes = E("div", "eg-ed-contraste", [], { "aria-live": "polite" });
  const rejouerB = bouton({ libelle: "Rejouer l'animation", variante: "mini", icone: "lecture", doc: d, surClic: () => rejouer() });
  const droite = E("div", "eg-ed-droite", [E("div", "eg-ed-apercu-tete", [E("h3", "", ["Aperçu"]), rejouerB]), apercu, contrastes]);

  const nom = E("input", "eg-ed-nom-input", [], { maxlength: 40, spellcheck: "false", placeholder: "Nom du thème", "aria-label": "Nom du thème" }) as HTMLInputElement;
  const etat = E("span", "eg-ed-etat", [], { role: "status" });
  const appliquerB = bouton({ libelle: "Appliquer", variante: "principal", doc: d, surClic: () => appliquer() });
  appliquerB.addEventListener("click", () => { if (appliquerB.getAttribute("aria-disabled") === "true") contrastes.scrollIntoView({ block: "nearest" }); });
  const pied = E("div", "eg-ed-pied", [
    E("div", "eg-ed-nom", [nom]),
    bouton({ libelle: "Importer", variante: "discret", icone: "importer", doc: d, surClic: () => importer() }),
    bouton({ libelle: "Exporter", variante: "discret", icone: "exporter", doc: d, surClic: () => exporter() }),
    bouton({ libelle: "Tout réinitialiser", variante: "discret", icone: "retour", doc: d, surClic: () => toutReinitialiser() }),
    etat, appliquerB,
  ]);
  const racine = E("div", "eg-editeur", [reglages, droite, pied]);
  const conteneur = E("div", "eg-editeur-conteneur", [racine]);
  hote.append(conteneur);
  nom.value = modifie ? doc.name : "Mon thème";

  /* ---------- Mise à jour ---------- */
  function valeursFonds(): { neutralHue: number; neutralChroma: number; background: number } {
    const s = doc.seeds ?? {}, [L, C, H] = hexVersOklch(r.c.canvas);
    const fond = r.mode === "sombre" ? ((L - 0.12) / 0.14) * 100 : ((0.995 - L) / 0.08) * 100;
    return { neutralHue: s.neutralHue ?? Math.round(C < 0.002 ? 60 : H), neutralChroma: s.neutralChroma ?? Math.min(0.04, C), background: s.background ?? Math.round(Math.max(0, Math.min(100, fond))) };
  }
  let image = 0, repos: ReturnType<typeof setTimeout> | undefined, minuterieRejeu: ReturnType<typeof setInterval> | undefined;
  const fen = d.defaultView ?? window;
  const majApercu = () => { r = resoudreTheme(doc); appliquerTheme(apercu, r); };
  const majImage = () => {
    if (!image) image = fen.requestAnimationFrame(() => { image = 0; majApercu(); });
    clearTimeout(repos); repos = setTimeout(maj, 150);
  };
  function changer(f: () => void, continu = false) { f(); modifie = true; if (continu) majImage(); else maj(); }

  const radios = (groupe: HTMLElement, attr: string, valeur: string) => {
    const l = Array.from(groupe.querySelectorAll<HTMLElement>(`[${attr}]`));
    let choisi = false;
    for (const b of l) {
      const oui = (b.getAttribute(attr) ?? "").toUpperCase() === valeur.toUpperCase();
      b.setAttribute("aria-checked", String(oui));
      b.tabIndex = oui ? 0 : -1;
      choisi ||= oui;
    }
    if (!choisi && l[0]) l[0].tabIndex = 0;
  };

  function maj() {
    doc.name = nom.value.trim() || "Mon thème";
    majApercu();
    radios(bases, "data-base", doc.base);
    radios(accents, "data-accent", r.c.accent);
    accentLibre.value = r.c.accent.toLowerCase();
    const vf = valeursFonds();
    cTeinte.input.value = String(vf.neutralHue); cTeinte.sortie.textContent = `${vf.neutralHue}°`;
    cSat.input.value = String(Math.round(vf.neutralChroma * 1000)); cSat.sortie.textContent = String(Math.round(vf.neutralChroma * 1000));
    cLum.input.value = String(vf.background); cLum.sortie.textContent = String(vf.background);
    choisirSegment(segContraste, doc.seeds?.contrast ?? "standard");
    for (const p of precises) { p.input.value = r.c[p.k].toLowerCase(); p.sortie.textContent = r.c[p.k]; }
    cRayon.input.value = String(r.panel); cRayon.sortie.textContent = `${r.panel} px`;
    cTexte.input.value = String(Math.round(r.echelle * 100)); cTexte.sortie.textContent = `${Math.round(r.echelle * 100)} %`;
    choisirSegment(segDensite, r.densite);
    choisirSegment(segTypo, r.typo);
    choisirSegment(segMouv, r.mouvement);
    iReflet.b.setAttribute("aria-checked", String(r.effets.sheen));
    iGrain.b.setAttribute("aria-checked", String(r.effets.grain));
    // Contrastes
    const res = verifierContrastes(r), echecs = res.filter((x) => !x.ok), tout = couleursCompletes(r);
    const sw = (k: keyof typeof tout) => { const i = E("i", "eg-ed-sw", [], { "aria-hidden": "true" }); i.style.setProperty("--eg-sw", tout[k]); return i; };
    const ligne = (x: (typeof res)[number], seuil: boolean) => E("li", "", [sw(x.a), sw(x.b), E("span", "", [`${NOMS_ROLES[x.a]} sur ${NOMS_ROLES[x.b]}`]), E("span", "eg-mono", [seuil ? `${virgule(x.v)} : ${virgule(x.seuil)} requis` : virgule(x.v)])]);
    if (echecs.length) {
      contrastes.replaceChildren(
        E("div", "eg-ed-ct-tete eg-ed-ct-tete--err", [icone("alerte", { taille: "s", doc: d }), E("b", "", [`${echecs.length} paire${echecs.length > 1 ? "s" : ""} sous le seuil`]),
          bouton({ libelle: "Corriger automatiquement", variante: "secondaire", doc: d, surClic: () => corriger() })]),
        E("ul", "eg-ed-ct-liste", echecs.map((x) => ligne(x, true))));
    } else {
      contrastes.replaceChildren(
        E("div", "eg-ed-ct-tete", [noeud("ok", d), E("b", "", [`${res.length} paires vérifiées, toutes conformes`]), E("span", "", [`WCAG 2.2 AA${r.seuils.texte > 4.5 ? ", contraste élevé (AAA)" : ""}`])]),
        E("details", "eg-ed-ct-detail", [E("summary", "", [icone("chevron", { taille: "s", doc: d }), "Voir les mesures"]), E("ul", "eg-ed-ct-liste", res.map((x) => ligne(x, false)))]));
    }
    activerBouton(appliquerB, echecs.length === 0);
    etat.textContent = echecs.length ? "Corrige les contrastes pour appliquer." : modifie ? "Brouillon non appliqué." : "";
  }

  function razSection(s: string) {
    changer(() => {
      const b = base();
      if (s === "couleurs") { doc.seeds = {}; for (const k of Object.keys(jetons())) if (k.startsWith("c-")) delete (doc.tokens as Record<string, unknown>)[k]; }
      if (s === "forme") { delete jetons()["r-panel"]; doc.density = b.densite; doc.typography = { preset: b.typo, scale: 1 }; }
      if (s === "mouvement") { doc.motion = { intensity: b.mouvement }; doc.effects = { ...b.effets }; }
    });
  }

  function corriger() {
    const { corrections } = corrigerContrastes(r);
    changer(() => { for (const x of corrections) (jetons() as Record<string, string>)[`c-${x.role}`] = x.apres; });
    const n = corrections.length;
    notifier(n ? "Contrastes corrigés" : "Correction impossible", n ? `${n} couleur${n > 1 ? "s" : ""} ajustée${n > 1 ? "s" : ""}` : "Change le fond ou l'accent.", n ? "ok" : "err");
  }

  function rejouer() {
    clearInterval(minuterieRejeu);
    let p = 0;
    majNoeud(apNoeud, "cours"); apToast.classList.add("eg-ed-ap-toast--cache"); majFil(apFil, 0); apPc.textContent = "0 %";
    minuterieRejeu = setInterval(() => {
      p = Math.min(1, p + 0.08); majFil(apFil, p); apPc.textContent = `${Math.round(p * 100)} %`;
      if (p >= 1) { clearInterval(minuterieRejeu); majNoeud(apNoeud, "ok"); apToast.classList.remove("eg-ed-ap-toast--cache"); }
    }, 220);
  }

  function appliquer() {
    if (appliquerB.getAttribute("aria-disabled") === "true") return;
    if (!modifie) {
      const garde = o.persistance.ecrire({ actif: doc.base });
      const t = appliquerTheme(cible, doc.base, { transition: true });
      notifier("Thème appliqué", OFFICIELS[doc.base].nom + (garde ? ", gardé sur cet appareil" : ""));
      o.surApplique?.(t, null);
      maj();
      return;
    }
    doc.name = (nom.value.trim() || "Mon thème").slice(0, 40);
    doc.id = idDepuisNom(doc.name);
    const v = validerTexte(exporterTheme(doc));
    if (!v.ok) { notifier("Thème refusé", v.erreurs[0] ?? "", "err"); return; }
    const garde = o.persistance.ecrire({ actif: "custom", perso: doc });
    const t = appliquerTheme(cible, doc, { transition: true });
    notifier("Thème appliqué", doc.name + (garde ? ", gardé sur cet appareil" : ", pour cette session seulement"));
    o.surApplique?.(t, cloner(doc));
    maj();
  }

  function toutReinitialiser() {
    const avant = o.persistance.lire(), brouillon = cloner(doc), avantModifie = modifie, avantNom = nom.value;
    o.persistance.effacer();
    const t = appliquerTheme(cible, "obsidian", { transition: true });
    doc = normaliserDoc(docOfficiel("obsidian")); doc.id = "perso.mon-theme"; nom.value = "Mon thème"; modifie = false;
    maj();
    o.surApplique?.(t, null);
    notifier("Apparence réinitialisée", "Obsidian", "ok", {
      libelle: "Annuler",
      faire: () => {
        if (avant.maj) o.persistance.ecrire({ actif: avant.actif, perso: avant.perso });
        const t2 = appliquerTheme(cible, avant.actif === "custom" && avant.perso ? avant.perso : avant.actif === "custom" ? "custom" : avant.actif, { transition: true });
        doc = brouillon; modifie = avantModifie; nom.value = avantNom; maj();
        o.surApplique?.(t2, avant.perso);
      },
    });
  }

  function exporter() {
    const texte = exporterTheme({ ...doc, name: (nom.value.trim() || "Mon thème").slice(0, 40) });
    const zone = E("textarea", "eg-ed-json", [], { readonly: true, spellcheck: "false", "aria-label": "Contenu du thème" }) as HTMLTextAreaElement;
    zone.value = texte;
    const copier = bouton({ libelle: "Copier", variante: "discret", icone: "copier", doc: d, surClic: async () => {
      try { await d.defaultView?.navigator.clipboard.writeText(texte); notifier("Copié", "Le thème est dans le presse-papiers."); }
      catch { zone.focus(); zone.select(); notifier("Sélectionné", "Copie avec Ctrl C."); }
    } });
    const telecharger = bouton({ libelle: "Télécharger le fichier", variante: "secondaire", icone: "exporter", doc: d, surClic: () => {
      try {
        const u = URL.createObjectURL(new Blob([texte], { type: "application/json" }));
        const a = E("a", "", [], { href: u, download: nomFichierTheme(doc) });
        (dlg.element as HTMLElement).append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      } catch { notifier("Téléchargement impossible ici", "Utilise « Copier ».", "err"); }
    } });
    const fermer = bouton({ libelle: "Fermer", variante: "discret", doc: d });
    fermer.setAttribute("data-eg-fermer", "");
    const dlg = dialogue({ titre: "Exporter le thème", doc: d, contenu: [
      E("p", "eg-ed-aide", ["Un fichier ", E("span", "eg-mono", [".aethryon-theme.json"]), " : des couleurs et des réglages, jamais de code. Si le téléchargement est bloqué (page intégrée), copie le texte."]),
      zone,
    ], actions: [copier, telecharger, fermer] });
    dlg.element.addEventListener("close", () => setTimeout(() => dlg.detruire(), 0), { once: true });
    dlg.ouvrir();
    zone.focus();
  }

  function importer() {
    const zone = E("textarea", "eg-ed-json", [], { spellcheck: "false", placeholder: "{ \"format\": \"aethryon-theme\", … }", "aria-label": "Contenu du thème" }) as HTMLTextAreaElement;
    const retour = E("div", "eg-ed-retour", [], { "aria-live": "polite" });
    const erreurs = (l: readonly string[]) => retour.replaceChildren(E("ul", "eg-erreurs", l.map((x) => E("li", "", [x]))));
    const fichier = E("input", "eg-vh", [], { type: "file", accept: ".json,application/json" }) as HTMLInputElement;
    fichier.addEventListener("change", async () => {
      const f = fichier.files?.[0];
      if (!f) return;
      if (f.size > TAILLE_MAX) { erreurs([`Fichier trop lourd : ${Math.ceil(f.size / 1024)} Ko (16 Ko au plus).`]); return; }
      zone.value = await f.text();
    });
    const verifier = bouton({ libelle: "Vérifier et prévisualiser", variante: "secondaire", icone: "ok", doc: d, surClic: () => {
      const res = importerTheme(zone.value);
      if (!res.ok) { erreurs(res.erreurs); return; }
      doc = res.doc; nom.value = doc.name; modifie = true; maj();
      dlg.fermer();
      const n = res.contrastes.filter((x) => !x.ok).length;
      notifier("Thème chargé dans l'aperçu", n ? `${n} contraste${n > 1 ? "s" : ""} à corriger avant d'appliquer` : "Vérifie, puis applique", n ? "err" : "ok");
    } });
    const annuler = bouton({ libelle: "Annuler", variante: "discret", doc: d });
    annuler.setAttribute("data-eg-fermer", "");
    const dlg = dialogue({ titre: "Importer un thème", doc: d, contenu: [
      E("p", "eg-ed-aide", ["Colle le contenu d'un fichier ", E("span", "eg-mono", [".aethryon-theme.json"]), " ou choisis-le. Il est vérifié avant tout aperçu : format, clés connues, couleurs #RRGGBB, bornes, 16 Ko au plus."]),
      E("label", "eg-btn eg-btn--secondaire eg-ed-fichier", [icone("fichier", { taille: "s", doc: d }), E("span", "", ["Choisir un fichier"]), fichier]),
      zone, retour,
    ], actions: [annuler, verifier] });
    dlg.element.addEventListener("close", () => setTimeout(() => dlg.detruire(), 0), { once: true });
    dlg.ouvrir();
    zone.focus();
  }

  /* ---------- Événements ---------- */
  const surClic = (e: Event) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-base], [data-accent], [data-effet]");
    if (!t || !racine.contains(t)) return;
    if (t.dataset.base) { doc = { ...normaliserDoc(docOfficiel(t.dataset.base as BaseId)), id: doc.id }; modifie = false; maj(); }
    else if (t.dataset.accent) {
      const hex = t.dataset.accent;
      changer(() => { graines().accent = hex; for (const k of ["accent", "accent-hover", "on-accent", "accent-text", "thread", "focus"]) delete (jetons() as Record<string, unknown>)[`c-${k}`]; });
    } else if (t.dataset.effet === "sheen" || t.dataset.effet === "grain") {
      const k = t.dataset.effet;
      changer(() => { doc.effects = { ...r.effets, [k]: !r.effets[k] }; });
    }
  };
  const surSegment = (groupe: HTMLElement, f: (v: string) => void) => groupe.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button[data-valeur]");
    if (b) changer(() => f(b.dataset.valeur ?? ""));
  });
  surSegment(segContraste, (v) => { graines().contrast = v === "eleve" ? "eleve" : "standard"; });
  surSegment(segDensite, (v) => { doc.density = v as keyof typeof DENSITES; });
  surSegment(segTypo, (v) => { doc.typography = { ...doc.typography, preset: v as keyof typeof TYPOS }; });
  surSegment(segMouv, (v) => { doc.motion = { intensity: v as keyof typeof MOUVEMENTS }; });
  const surSaisie = (e: Event) => {
    const i = e.target as HTMLInputElement;
    const cle = i.dataset.cle;
    if (cle === "neutralHue" || cle === "neutralChroma" || cle === "background") {
      changer(() => {
        Object.assign(graines(), valeursFonds());
        const v = Number(i.value);
        graines()[cle] = cle === "neutralChroma" ? v / 1000 : v;
        for (const k of NEUTRES_ROLES) delete (jetons() as Record<string, unknown>)[`c-${k}`];
      }, true);
    } else if (cle === "r") changer(() => { jetons()["r-panel"] = Number(i.value); }, true);
    else if (cle === "t") changer(() => { doc.typography = { ...doc.typography, scale: Number(i.value) / 100 }; }, true);
    else if (i.dataset.token) { const k = i.dataset.token; changer(() => { (jetons() as Record<string, string>)[k] = i.value.toUpperCase(); }, true); }
    else if (i === accentLibre) changer(() => { graines().accent = i.value.toUpperCase(); }, true);
    else if (i === nom) { modifie = true; maj(); }
  };
  // Groupes radio : flèches pour se déplacer et choisir (tabindex itinérant).
  const surTouche = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.getAttribute("role") !== "radio" || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const l = Array.from(t.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    const i = l.indexOf(t), n = l.length;
    const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + n) % n;
    e.preventDefault();
    l[j]?.focus();
    l[j]?.click();
  };
  racine.addEventListener("click", surClic);
  racine.addEventListener("input", surSaisie);
  racine.addEventListener("keydown", surTouche);
  // Si le thème appliqué change ailleurs, un brouillon non modifié le suit.
  const surTheme = () => {
    if (modifie) return;
    const p = o.persistance.lire();
    doc = { ...normaliserDoc(p.actif === "custom" ? (p.perso ?? CUSTOM_EXEMPLE) : docOfficiel(p.actif)), id: doc.id };
    maj();
  };
  cible.addEventListener("eg-theme", surTheme);
  nettoyages.push(() => cible.removeEventListener("eg-theme", surTheme));
  maj();
  return {
    element: conteneur,
    detruire() {
      clearInterval(minuterieRejeu); clearTimeout(repos); if (image) fen.cancelAnimationFrame(image);
      for (const n of nettoyages) n();
      conteneur.remove();
    },
  };
}
