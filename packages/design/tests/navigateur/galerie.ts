// Galerie de référence des composants Égide, construite UNIQUEMENT avec l'API publique du paquet, servie sous la CSP
// stricte du site par tests/navigateur/essais.mjs (aucun script ni style en ligne). Sert aussi d'exemple d'usage
// « extension » (fonctions DOM + classes) et de racine Shadow DOM fermée.
import {
  BASES, OFFICIELS, STATUTS_PLATEFORME, appliquerTheme, attacherInfobulle, bouton, carteMedia, champ, choisirTheme,
  configurerEgide, creerEditeurThemes, creerRacineOmbre, creerPersistance, demarrerTheme, dialogue, etatVide, fil, h, icone, majFil, medaille, meandre, menu,
  CUSTOM_EXEMPLE, noeud, pastille, pastillePlateforme, regionToasts, resoudreTheme, docOfficiel, sceau, segment, toast, variablesTheme, veille,
  type StatutPlateforme, type ThemeId,
} from "../../src/index.ts";

configurerEgide({ chouette: "/assets/aethryon-master.svg" });
const persistance = creerPersistance();
demarrerTheme(document.documentElement, persistance);
const region = regionToasts();
const racine = document.getElementById("galerie") as HTMLElement;

const section = (titre: string, ...enfants: (Node | null)[]) =>
  h("section", { class: "g-section" }, [h("h2", { class: "eg-titre g-titre", text: titre }), h("div", { class: "g-rangee" }, enfants)]);

// Sélecteur des six thèmes (même composant segment)
const actif = persistance.lire().actif;
const selecteur = segment({
  libelle: "Thème", valeur: actif,
  options: [...BASES.map((b) => ({ valeur: b, libelle: OFFICIELS[b].nom })), { valeur: "custom", libelle: "Custom" }],
  surChoix: (v) => { choisirTheme(document.documentElement, { actif: v as ThemeId }, persistance, false); },
});
selecteur.id = "g-themes";

const boutons = [
  bouton({ libelle: "Convertir", variante: "principal", raccourci: "Entrée", icone: "convertir" }),
  bouton({ libelle: "Choisir un dossier", variante: "secondaire", icone: "dossier" }),
  bouton({ libelle: "Annuler", variante: "discret" }),
  bouton({ libelle: "Réglages", variante: "icone", icone: "reglages" }),
  bouton({ libelle: "Copier", variante: "mini", icone: "copier" }),
  bouton({ libelle: "Indisponible", variante: "secondaire", desactive: true }),
];
const iconeSeule = boutons[3] as HTMLButtonElement;
iconeSeule.id = "g-reglages";
attacherInfobulle(iconeSeule, "Réglages");

const lien = champ({ libelle: "Lien de la vidéo", variante: "lien", placeholder: "Colle un lien", libelleCache: true });
const courriel = champ({ libelle: "Adresse e-mail", type: "email", aide: "Pour te connecter, jamais affichée." });
courriel.erreur("Adresse incomplète.");

const filEl = fil({ libelle: "Progression de l'essai", valeur: 0.42 });
const filEpais = fil({ libelle: "Quota", valeur: 0.8, epais: true });
let p = 0.42;
const avancer = bouton({ libelle: "Avancer le fil", variante: "mini", icone: "plus", surClic: () => { p = p >= 1 ? 0 : Math.min(1, p + 0.2); majFil(filEl, p); } });

const declencheurMenu = bouton({ libelle: "Actions", variante: "secondaire", icone: "menu" });
declencheurMenu.id = "g-menu";
menu(declencheurMenu, { libelle: "Actions sur le fichier", elements: [
  { libelle: "Ouvrir le dossier", icone: "dossier", action: () => toast(region, { titre: "Dossier ouvert" }) },
  { libelle: "Copier le lien", icone: "copier", raccourci: "Ctrl C", action: () => toast(region, { titre: "Lien copié" }) },
  { libelle: "Retirer", icone: "croix", danger: true, action: () => toast(region, { titre: "Retiré", etat: "err" }) },
] });

const ouvrirDlg = bouton({ libelle: "Ouvrir un dialogue", variante: "secondaire" });
ouvrirDlg.id = "g-dialogue";
const fermer = bouton({ libelle: "Fermer", variante: "discret" });
fermer.setAttribute("data-eg-fermer", "");
const dlg = dialogue({ titre: "Exemple de dialogue", contenu: [h("p", { text: "Le focus revient au bouton qui l'a ouvert." })], actions: [fermer, bouton({ libelle: "Valider", variante: "principal" })] });
ouvrirDlg.addEventListener("click", () => dlg.ouvrir());

const toastB = bouton({ libelle: "Afficher un toast", variante: "secondaire", surClic: () => toast(region, { titre: "Converti", texte: "La nuit des chouettes", action: { libelle: "Ouvrir", faire: () => undefined } }) });
toastB.id = "g-toast";

racine.append(
  h("header", { class: "g-tete" }, [h("h1", { class: "eg-marque g-h1" }, [medaille({ taille: 26 }), "AETHRYON Égide"]), selecteur]),
  section("Boutons", ...boutons),
  section("Champs", lien.racine, courriel.racine),
  section("Segments", segment({ libelle: "Qualité", options: [{ valeur: "720", libelle: "720p" }, { valeur: "1080", libelle: "1080p" }, { valeur: "max", libelle: "Maximum" }], valeur: "1080" })),
  section("Pastilles d'état", pastille({ libelle: "Prêt", ton: "ok" }), pastille({ libelle: "Lent", ton: "warn" }), pastille({ libelle: "Erreur", ton: "err" }), pastille({ libelle: "Vidéo", ton: "accent", icone: "video" }),
    ...(Object.keys(STATUTS_PLATEFORME) as StatutPlateforme[]).map((s) => pastillePlateforme(s))),
  section("Nœuds et fil", noeud("attente"), noeud("cours"), noeud("pause"), noeud("ok"), noeud("err"), h("div", { class: "g-fil" }, [filEl, filEpais]), avancer, meandre()),
  section("Cartes média",
    carteMedia({ titre: "La nuit des chouettes (démonstration)", meta: ["MP4", "1080p", "61 Mo"], duree: "4:12", badge: pastille({ libelle: "Extrait", ton: "accent", icone: "ciseaux" }), actions: [bouton({ libelle: "Ouvrir", variante: "icone", icone: "ouvrir" })] }),
    carteMedia({ titre: "Marée basse au cap Fréhel", meta: ["MP3", "3:05"], duree: "3:05" })),
  section("Menu, dialogue, infobulle, toast", declencheurMenu, ouvrirDlg, toastB),
  section("La chouette", medaille({ taille: "l" }), veille({ libelle: "Lecture du lien" }), sceau({ taille: 56 }), etatVide({ titre: "Rien à convertir", texte: "Colle un lien pour commencer.", action: bouton({ libelle: "Coller un lien", variante: "secondaire", icone: "coller" }) })),
  section("Icônes", ...(["lien", "video", "vertical", "post", "image", "direct", "archive", "onde", "son", "gif", "ciseaux", "chutier", "bulle", "telephone", "navigateur"] as const).map((n) => icone(n, { titre: n }))),
);

// Racine Shadow DOM FERMÉE (comme le menu injecté de l'extension) : la page hôte essaie d'imposer ses styles.
const hote = h("div", { class: "hote-hostile", attrs: { id: "g-hote" } });
racine.append(section("Shadow DOM (extension)", hote));
const { racine: ombre, enveloppe } = creerRacineOmbre(hote);
const menuOmbre = bouton({ libelle: "Menu dans l'ombre", variante: "secondaire", icone: "menu" });
menuOmbre.id = "g-menu-ombre";
enveloppe.append(
  h("p", { class: "g-ombre-texte", text: "Racine Shadow DOM fermée" }),
  bouton({ libelle: "Télécharger 30 s", variante: "principal", icone: "convertir" }),
  menuOmbre,
  fil({ libelle: "Progression dans l'ombre", valeur: 0.6 }),
);
const menuDansOmbre = menu(menuOmbre, { libelle: "Actions", elements: [{ libelle: "Choix A", action: () => { (window as unknown as { __choixOmbre: number }).__choixOmbre = ((window as unknown as { __choixOmbre?: number }).__choixOmbre ?? 0) + 1; } }] });

// Éditeur de thèmes
const hoteEditeur = h("div", { class: "g-editeur", attrs: { id: "g-editeur" } });
racine.append(h("section", { class: "g-section" }, [h("h2", { class: "eg-titre g-titre", text: "Éditeur de thèmes" }), hoteEditeur]));
creerEditeurThemes(hoteEditeur, { persistance, toasts: region });

// Points d'accroche des essais (page d'essai seulement).
Object.assign(window, {
  __egide: { resoudreTheme, docOfficiel, variablesTheme, appliquerTheme, ombre, enveloppe, menuDansOmbre, CUSTOM_EXEMPLE },
});
