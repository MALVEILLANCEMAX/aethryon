// Égide dans les pages des plateformes (menu injecté, panneau flottant) : racine Shadow DOM FERMÉE créée par le socle
// (creerRacineOmbre : feuille Égide ADOPTÉE, permise par une CSP stricte, jetons portés par l'enveloppe .eg-racine que la
// page ne peut pas cibler), feuille de la commande adoptée à côté (une seule feuille construite par document), thème de
// l'utilisateur et police d'interface.
// - Thème : la préférence de chrome.storage.sync (clé « apparence », écrite par le popup et les réglages), REVALIDÉE par
//   le socle (lirePreference : un thème personnel abîmé ou trafiqué redevient Obsidian), résolue une fois puis appliquée à
//   chaque enveloppe ; suivie en direct (storage.sync.onChanged, le seul événement de stockage que lit un content script).
// - Police : une racine Shadow DOM ne charge pas de @font-face. Hanken Grotesk (OFL, 35 Kio) est demandée au service
//   worker à la PREMIÈRE ouverture d'un menu (aucun fichier exposé à la page : pas de web_accessible_resources), puis
//   déclarée par l'API FontFace à partir de ses octets, sous un nom de famille propre à l'extension : aucune règle CSS
//   n'est ajoutée à la page, aucune police de la page n'est touchée, et une CSP « font-src 'none' » ne la bloque pas
//   (pas de requête). En attendant, ou si rien n'arrive : la police de la plateforme (le bouton garde toujours celle-ci,
//   pour ne jamais décaler la page).
import { appliquerTheme, creerRacineOmbre, entreeDePreference, lirePreference, resoudreEntree, type ThemeResolu } from "../../shared/egide.ts";
import { CLE_SYNC_APPARENCE } from "../../shared/apparence-cle.ts";

/** Nom de famille de la police chargée par l'extension (jamais celui d'une police de la page). */
export const FAMILLE_UI = "AETHRYON Hanken Grotesk";

let theme: ThemeResolu | null = null;
const portees = new Set<HTMLElement>();
let ecoute = false;
const feuilles = new WeakMap<Document, Map<string, CSSStyleSheet>>();

function courant(): ThemeResolu {
  return (theme ??= resoudreEntree("obsidian"));
}

function recevoir(brut: unknown): void {
  try {
    theme = resoudreEntree(entreeDePreference(lirePreference(typeof brut === "string" ? brut : null)));
  } catch {
    theme = resoudreEntree("obsidian");
  }
  for (const el of portees) appliquerTheme(el, theme);
}

/** Lit la préférence (avant la première commande) et suit ses changements. Ne lève jamais. */
export async function chargerApparence(): Promise<void> {
  try {
    if (!ecoute) {
      ecoute = true;
      chrome.storage.sync.onChanged.addListener((changes) => {
        if (changes[CLE_SYNC_APPARENCE]) recevoir(changes[CLE_SYNC_APPARENCE].newValue);
      });
    }
    const r = await chrome.storage.sync.get(CLE_SYNC_APPARENCE);
    recevoir(r[CLE_SYNC_APPARENCE]);
  } catch {
    // contexte invalidé ou stockage refusé : Obsidian
  }
}

/** Feuilles propres de la commande, construites une fois par document puis partagées par toutes ses racines. */
function adopter(racine: ShadowRoot, css: readonly string[]): void {
  const doc = racine.ownerDocument;
  try {
    let parDoc = feuilles.get(doc);
    if (!parDoc) feuilles.set(doc, (parDoc = new Map()));
    const liste = css.map((texte) => {
      let f = parDoc!.get(texte);
      if (!f) {
        f = new CSSStyleSheet();
        f.replaceSync(texte);
        parDoc!.set(texte, f);
      }
      return f;
    });
    racine.adoptedStyleSheets = [...racine.adoptedStyleSheets, ...liste];
    return;
  } catch {
    // feuilles construites indisponibles : <style> (refusé seulement par une CSP stricte)
  }
  for (const texte of css) {
    const s = doc.createElement("style");
    s.textContent = texte;
    racine.append(s);
  }
}

/**
 * Racine Égide d'un hôte injecté : ombre FERMÉE du socle, feuille de la commande, thème courant. `liberer` retire
 * l'enveloppe du suivi du thème (démontage de la commande).
 */
export function racineEgide(hote: HTMLElement, ...css: string[]): { racine: ShadowRoot; enveloppe: HTMLDivElement; liberer: () => void } {
  const { racine, enveloppe } = creerRacineOmbre(hote, { mode: "closed", theme: courant() });
  adopter(racine, css);
  if (police === "chargee") enveloppe.style.setProperty("--eg-f-ui", pileUi());
  portees.add(enveloppe);
  return { racine, enveloppe, liberer: () => void portees.delete(enveloppe) };
}

// ---- police d'interface ---------------------------------------------------------------------------
let police: "aucune" | "demandee" | "chargee" | "echec" = "aucune";
let pilePage = "system-ui, sans-serif";

const pileUi = () => `"${FAMILLE_UI}", ${pilePage}`;

/** Police de la plateforme (repli) : celle du bouton, déjà utilisée par la page. */
export function definirPolicePage(pile: string): void {
  pilePage = pile;
}

/**
 * Demande Hanken Grotesk au service worker (une fois par document, à la première ouverture d'un menu) et la déclare
 * par FontFace ; toutes les enveloppes passent alors dessus. `demander` renvoie les octets en base 64, ou null.
 */
export function chargerPolice(doc: Document, demander: () => Promise<string | null>): void {
  if (police !== "aucune") return;
  police = "demandee";
  void (async () => {
    try {
      const b64 = await demander();
      if (!b64 || typeof FontFace !== "function") throw new Error("police indisponible");
      const bin = atob(b64);
      const octets = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
      const face = new FontFace(FAMILLE_UI, octets.buffer, { weight: "100 900", style: "normal", display: "swap" });
      await face.load();
      doc.fonts.add(face);
      police = "chargee";
      for (const el of portees) el.style.setProperty("--eg-f-ui", pileUi());
    } catch {
      police = "echec"; // la police de la plateforme reste : rien de visible
    }
  })();
}
