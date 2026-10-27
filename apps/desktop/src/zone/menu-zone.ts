// Menu de la zone de notification (fenêtre Tauri « zone-menu », src-tauri/src/zone.rs) : le menu natif de Windows ne
// se stylise pas. Mêmes actions que lui : Ouvrir AETHRYON, Ouvrir le dossier des médias, Quitter AETHRYON.
// Clavier : flèches en boucle, Début/Fin, première lettre (lib/menu.ts, comme les menus de l'application),
// Entrée/Espace ; Échap ou perte du focus ferme. Surbrillance au clavier instantanée, à la souris en fondu de 120 ms.
// Le cœur place la fenêtre près de l'icône, envoie « zone-menu-ouvrir » ({ cote, verre, animations }) puis la montre.
// Égide : le menu suit le thème de l'application (même profil WebView2, donc même préférence) : theme-boot.js le pose
// avant la première image, et il est relu à CHAQUE ouverture (un thème changé entre-temps est déjà là).
// Toute fermeture passe par ici : retour à l'état fermé, deux images peintes, PUIS le cœur cache la fenêtre (la
// prochaine ouverture ne montre jamais l'image d'avant).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { naviguer } from "../lib/menu";
import { balisageIcone, demarrerTheme, type NomIcone } from "../lib/egide";
import "../../../../packages/design/genere/egide.css";
import "../styles/base.css";
import "./menu-zone.css";

type Action = "ouvrir" | "dossier" | "quitter";
interface Element { id: Action; libelle: string; icone: NomIcone; separateurAvant?: boolean }
interface Ouverture { cote: "bas" | "haut" | "gauche" | "droite"; verre: boolean; animations: string }

const ELEMENTS: Element[] = [
  { id: "ouvrir", libelle: "Ouvrir AETHRYON", icone: "fenetre" },
  { id: "dossier", libelle: "Ouvrir le dossier des médias", icone: "dossier" },
  { id: "quitter", libelle: "Quitter AETHRYON", icone: "croix", separateurAvant: true },
];

const racine = document.documentElement;
const menu = document.getElementById("zm") as HTMLDivElement;
const contenu = menu.querySelector<HTMLDivElement>(".zm-c")!;
// Icônes du jeu Égide (design/src/icones.ts), 16 px, trait 1,6 : données internes du paquet, aucune saisie.
const icone = (nom: NomIcone) =>
  `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${balisageIcone(nom)}</svg>`;
contenu.innerHTML = ELEMENTS.map((e) =>
  `${e.separateurAvant ? '<div class="zm-sep" role="separator"></div>' : ""}<div class="zm-i" role="menuitem" id="zm-${e.id}">${icone(e.icone)}<span>${e.libelle}</span></div>`,
).join("");
const lignes = ELEMENTS.map((e) => document.getElementById(`zm-${e.id}`)!);

let hl = -1;
let ouvert = false;
let generation = 0;

function surligner(i: number, clavier: boolean): void {
  hl = i;
  menu.classList.toggle("zm--clavier", clavier);
  lignes.forEach((l, k) => l.classList.toggle("is-hl", k === i));
  if (i >= 0) menu.setAttribute("aria-activedescendant", lignes[i].id);
  else menu.removeAttribute("aria-activedescendant");
}

function ouvrir(o: Ouverture): void {
  generation += 1;
  try { demarrerTheme(racine); } catch { /* thème par défaut (Obsidian) */ }
  racine.dataset.verre = o.verre ? "1" : "0";
  racine.dataset.cote = o.cote;
  if (o.animations === "oui") racine.dataset.motion = "reduced";
  else if (o.animations === "non") racine.dataset.motion = "full";
  else delete racine.dataset.motion;
  surligner(-1, false);
  // Relance l'entrée : état fermé, calcul du style, puis ouvert (transition CSS, interruptible).
  racine.dataset.ouvert = "0";
  void contenu.offsetWidth;
  racine.dataset.ouvert = "1";
  ouvert = true;
  menu.focus({ preventScroll: true });
}

/** Retour à l'état fermé, deux images peintes, puis le cœur cache la fenêtre (et lance l'action choisie). */
function fermer(action?: Action): void {
  if (!ouvert) return;
  ouvert = false;
  racine.dataset.ouvert = "0";
  surligner(-1, false);
  const g = generation;
  let fait = false;
  const suite = () => {
    // Rouvert entre-temps (nouveau clic droit) : ne rien cacher.
    if (fait || g !== generation) return;
    fait = true;
    (action ? invoke("zone_menu_choisir", { action }) : invoke("zone_menu_fermer")).catch(() => {});
  };
  requestAnimationFrame(() => requestAnimationFrame(suite));
  window.setTimeout(suite, 80);
}

lignes.forEach((l, i) => {
  l.addEventListener("pointermove", () => { if (hl !== i || menu.classList.contains("zm--clavier")) surligner(i, false); });
  l.addEventListener("click", () => fermer(ELEMENTS[i].id));
});
menu.addEventListener("pointerleave", () => surligner(-1, false));
menu.addEventListener("keydown", (e) => {
  e.preventDefault(); // aucun raccourci du navigateur (F5, Ctrl+R…) dans un menu
  const n = naviguer(ELEMENTS, hl, e.key);
  if (n !== null && !e.ctrlKey && !e.altKey) surligner(n, true);
  else if ((e.key === "Enter" || e.key === " ") && hl >= 0) fermer(ELEMENTS[hl].id);
  else if (e.key === "Escape") fermer();
});
window.addEventListener("blur", () => fermer());
document.addEventListener("contextmenu", (e) => e.preventDefault());

async function signaler(): Promise<void> {
  await listen<Ouverture>("zone-menu-ouvrir", (e) => ouvrir(e.payload));
  await document.fonts.ready;
  const r = contenu.getBoundingClientRect();
  // Taille du menu en px CSS (contenu + marge intérieure de 4 px) : le cœur dimensionne la fenêtre à l'identique.
  await invoke("zone_menu_pret", { largeur: Math.ceil(r.width + 8), hauteur: Math.ceil(r.height + 8) });
}
signaler().catch(() => {});
