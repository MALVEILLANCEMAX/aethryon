// Écran de démarrage (balisage : index.html #demarrage ; styles : styles/demarrage.css). Direction « Nocturne ».
// - Fond obsidienne peint dès la première image (couleur en ligne dans index.html, comme le fond de la fenêtre :
//   tauri.conf.json backgroundColor #0F0F10) : jamais de flash blanc.
// - Interface prête moins de SEUIL_MS après le début de ce script : l'écran est retiré sans avoir été vu, la fenêtre
//   s'ouvre directement sur l'interface (comme avant).
// - Sinon la fenêtre s'ouvre sur l'écran de démarrage (fenetre_prete : rien n'est montré au démarrage de Windows en
//   arrière-plan) et il s'efface DÈS que l'interface est montée et l'état initial lu : aucun délai ajouté.
// - Progression HONNÊTE : trois étapes réelles (interface chargée, état initial lu, interface montée), aucun pourcentage.
import { api } from "./api";

const SEUIL_MS = 150;
const ETAPES = ["interface", "etat", "affichage"] as const;
type Etape = (typeof ETAPES)[number];

let montre = false;
let fini = false;
let minuterie = 0;

const ecran = () => document.getElementById("demarrage");

function libelle(texte: string): void {
  const l = ecran()?.querySelector<HTMLElement>(".dm-libelle");
  if (l && l.textContent !== texte) l.textContent = texte;
}

/** Étape terminée : son trait passe à l'or, le suivant s'anime (en cours). */
function marquer(etape: Etape): void {
  const n = ETAPES.indexOf(etape);
  ecran()?.querySelectorAll<HTMLElement>(".dm-points > i").forEach((t, i) => {
    t.toggleAttribute("data-fait", i <= n);
    t.toggleAttribute("data-encours", i === n + 1);
  });
}

function afficher(): void {
  const d = ecran();
  if (fini || !d) return;
  montre = true;
  d.dataset.etat = "visible";
  api.fenetrePrete().catch(() => {});
}

/** Début du script : l'interface est chargée. L'écran ne se montre que si rien n'est prêt SEUIL_MS plus tard. */
export function demarrerEcran(): void {
  if (!ecran()) return;
  marquer("interface");
  libelle("Lecture de la bibliothèque…");
  minuterie = window.setTimeout(afficher, SEUIL_MS);
}

/** Le service répond encore « pas démarré » (App.tsx réessaie) : l'écran le dit. */
export function serviceEnAttente(): void {
  if (!fini) libelle("Démarrage du service AETHRYON…");
}

/** État initial lu. */
export function etatLu(): void {
  if (fini) return;
  marquer("etat");
  libelle("Ouverture de l'interface…");
}

/** Interface montée (ou erreur fatale à afficher) : la fenêtre s'ouvre si l'écran ne l'a pas fait, et il s'efface. */
export function terminerEcran(): void {
  if (fini) return;
  fini = true;
  window.clearTimeout(minuterie);
  const d = ecran();
  if (!montre || !d) {
    d?.remove();
    api.fenetrePrete().catch(() => {});
    return;
  }
  marquer("affichage");
  libelle("Prêt");
  d.setAttribute("aria-hidden", "true");
  d.dataset.etat = "sortie";
  let retire = false;
  const retirer = () => {
    if (retire) return;
    retire = true;
    d.remove();
  };
  d.addEventListener("transitionend", (e) => { if (e.target === d && e.propertyName === "opacity") retirer(); });
  // Fenêtre cachée (arrière-plan) : aucune image peinte, donc aucune fin de transition.
  window.setTimeout(retirer, 600);
}
