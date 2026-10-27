// @aethryon/egide : point d'entrée unique du socle Égide (sans framework). Tout est exporté par nom : les
// constructeurs (Vite, esbuild) ne gardent que ce qui est importé. Les feuilles CSS s'importent à part
// (genere/egide.css pour un document, EGIDE_CSS_SHADOW pour une racine Shadow DOM) : voir README.md.

// Couleur et contraste
export { apca, contraste, estHex, hexVersOklch, hexVersRgb, luminance, melange, oklch, resoudre, rgbVersHex, rgbVersOklch } from "./couleur.ts";
// Jetons statiques
export {
  BORDURES, COURBES, DENSITES, DIMENSIONS, DUREES, EFFETS_MODE, ESPACEMENTS, FAMILLES, MOUVEMENTS, PLANS, PREFIXE, RAPPORTS_RAYONS,
  RAYON_PASTILLE, TAILLES_TEXTE, TITRE_HEROS, TYPOS,
} from "./jetons.ts";
// Thèmes et format
export {
  ACCENTS, BASES, CUSTOM_EXEMPLE, DERIVES, FORMAT, JETONS_PERSO, OFFICIELS, ORDRE_THEMES, ROLES, SCHEMA_URL, TAILLE_MAX, cloner,
  docOfficiel, estBase, estThemeId,
} from "./themes.ts";
export type {
  BaseId, Contraste, Couleurs, Densite, Derive, DocTheme, Effets, Graines, JetonPerso, JetonsTheme, Mode, Mouvement, Role, ThemeId,
  ThemeOfficiel, Typo,
} from "./themes.ts";
// Moteur
export {
  NOMS_ROLES, PAIRES, contrastesConformes, corrigerContrastes, couleursCompletes, derives, estDocOfficielPur, resoudreTheme,
  verifierContrastes,
} from "./moteur.ts";
export type { Correction, MesureContraste, Seuils, ThemeResolu, ToutesCouleurs } from "./moteur.ts";
// Validation, migrations, import / export
export { exporterTheme, idDepuisNom, importerTheme, nomFichierTheme, normaliserDoc, validerObjet, validerTexte } from "./schema.ts";
export type { ResultatImport, ResultatValidation } from "./schema.ts";
export { MIGRATIONS, VERSION_SCHEMA, migrer, renommerJetons } from "./migrations.ts";
export type { DocBrut, Migration, ResultatMigration, TableMigrations } from "./migrations.ts";
// Variables CSS et application
export { ATTRIBUTS, VARIABLES_VALEUR, rayons, valeursCategorielles, variablesTheme } from "./variables.ts";
export type { VariablesTheme } from "./variables.ts";
export { EVENEMENT_THEME, appliquerTheme, resoudreEntree, retirerTheme } from "./appliquer.ts";
export type { EntreeTheme, OptionsApplication } from "./appliquer.ts";
// Persistance
export {
  CLE_APPARENCE, PREFERENCE_DEFAUT, VERSION_PREFERENCE, choisirTheme, creerPersistance, demarrerTheme, entreeDePreference, lirePreference,
  reinitialiserTheme, stockageMemoire, stockageNavigateur,
} from "./persistance.ts";
export type { Persistance, Preference, Stockage } from "./persistance.ts";
// Icônes
export { ICONES, NOMS_ICONES, balisageIcone, estIcone, spriteIcones } from "./icones.ts";
export type { FormeIcone, NomIcone } from "./icones.ts";
// DOM : outils, chouette, composants, éditeur
export { adresseChouette, configurerEgide, h, icone, idUnique } from "./dom/base.ts";
export type { Attributs, Enfant, OptionsElement, OptionsIcone } from "./dom/base.ts";
export { chouette, etatVide, frapperSceau, medaille, meandre, sceau, veille } from "./dom/chouette.ts";
export {
  STATUTS_PLATEFORME, activerBouton, attacherDialogue, attacherInfobulle, attacherMenu, attacherSegment, bouton, carteMedia, champ,
  choisirSegment, dialogue, fil, majFil, majNoeud, menu, noeud, pastille, pastillePlateforme, regionToasts, segment, toast,
} from "./dom/composants.ts";
export type {
  Champ, Dialogue, ElementMenu, EtatNoeud, OptionSegment, OptionsBouton, OptionsCarteMedia, OptionsChamp, OptionsToast, StatutPlateforme,
  Ton, VarianteBouton,
} from "./dom/composants.ts";
export { creerEditeurThemes } from "./dom/editeur.ts";
export { creerRacineOmbre, poserFeuilleOmbre } from "./dom/ombre.ts";
export type { RacineOmbre } from "./dom/ombre.ts";
export type { OptionsEditeur } from "./dom/editeur.ts";
// Feuille pour une racine Shadow DOM (texte, généré par scripts/build.mjs depuis css/ ; vérifié par --check)
export { EGIDE_CSS_SHADOW } from "./genere/css-shadow.ts";
