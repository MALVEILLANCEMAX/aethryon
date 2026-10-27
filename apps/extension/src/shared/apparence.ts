// Apparence (thème Égide) de l'extension : UNE préférence partagée par le popup, les réglages, la page d'accueil et le
// menu injecté dans les pages des plateformes.
// - Source : chrome.storage.sync, clé « apparence » (comme les réglages : lisible par les content scripts, copiée sur
//   les autres appareils si la synchronisation de Chrome est active). Jamais storage.local : il est réservé au service
//   worker et aux pages (setAccessLevel TRUSTED_CONTEXTS, jeton du compte).
// - Miroir SYNCHRONE dans le localStorage de l'origine de l'extension (clé CLE_APPARENCE du socle) : theme-boot.js, chargé
//   en tête de chaque page, l'applique AVANT le premier rendu (aucun flash à l'ouverture du popup). Le content script ne
//   lit jamais ce miroir (autre origine) : il lit storage.sync (src/content/common/apparence.ts).
// - L'adaptateur `stockageChrome` est le `Stockage` de creerPersistance({ stockage }) : lecture dans le miroir (ou en
//   mémoire), écriture dans le miroir ET dans storage.sync. Une préférence venue d'ailleurs (autre page, autre appareil)
//   arrive par storage.sync.onChanged : elle est relue, REVALIDÉE par le socle (lirePreference) et appliquée.
// Le thème reste une donnée : couleurs #RRGGBB, nombres et choix fermés, jamais de CSS libre (validateur du socle).
import {
  CLE_APPARENCE, appliquerTheme, configurerEgide, creerPersistance, demarrerTheme, entreeDePreference, lirePreference, stockageMemoire,
  stockageNavigateur, type DocTheme, type Persistance, type Stockage, type ThemeId, type ThemeResolu,
} from "./egide.ts";

import { CLE_SYNC_APPARENCE } from "./apparence-cle.ts";

export { CLE_SYNC_APPARENCE };
/** storage.sync refuse un élément de plus de 8 192 octets (clé comprise) : au-delà, la préférence reste locale. */
const MAX_SYNC = 8000;

type ZoneSync = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;

export interface StockageChrome extends Stockage {
  /** Valeur reçue de storage.sync (lecture au démarrage, changement venu d'ailleurs) : gardée sans être renvoyée. */
  recevoir(brut: string | null): boolean;
  /** Vrai si la dernière écriture n'a pas pu partir vers storage.sync (trop lourde, quota) : gardée sur cet appareil. */
  readonly localSeulement: boolean;
}

/** Adaptateur `Stockage` (API Web Storage, synchrone) au-dessus de chrome.storage.sync, avec miroir local. */
export function stockageChrome(o: { sync?: ZoneSync | null; miroir?: Stockage | null } = {}): StockageChrome {
  const sync = o.sync === undefined ? (typeof chrome !== "undefined" ? (chrome.storage?.sync ?? null) : null) : o.sync;
  const miroir = o.miroir === undefined ? stockageNavigateur() : o.miroir;
  const memoire = stockageMemoire();
  let localSeulement = false;
  const lire = (k: string): string | null => {
    if (miroir) { try { return miroir.getItem(k); } catch { /* miroir refusé : mémoire */ } }
    return memoire.getItem(k);
  };
  const garder = (k: string, v: string | null) => {
    if (v === null) memoire.removeItem(k); else memoire.setItem(k, v);
    if (!miroir) return;
    try { if (v === null) miroir.removeItem(k); else miroir.setItem(k, v); } catch { /* mémoire seule */ }
  };
  return {
    get localSeulement() { return localSeulement; },
    getItem: (k) => lire(k),
    setItem(k, v) {
      garder(k, v);
      if (k !== CLE_APPARENCE || !sync) return;
      if (new TextEncoder().encode(v).length > MAX_SYNC) { localSeulement = true; return; }
      localSeulement = false;
      sync.set({ [CLE_SYNC_APPARENCE]: v }).catch(() => { localSeulement = true; });
    },
    removeItem(k) {
      garder(k, null);
      if (k === CLE_APPARENCE && sync) sync.remove(CLE_SYNC_APPARENCE).catch(() => undefined);
    },
    recevoir(brut) {
      const avant = lire(CLE_APPARENCE);
      if (brut === avant) return false;
      garder(CLE_APPARENCE, brut);
      return true;
    },
  };
}

/** Même préférence ? (thème actif et thème personnel ; la date et le cache ne comptent pas) */
function memeChoix(a: string | null, b: string | null): boolean {
  const pa = lirePreference(a), pb = lirePreference(b);
  return pa.actif === pb.actif && JSON.stringify(pa.perso) === JSON.stringify(pb.perso);
}

export interface Apparence {
  persistance: Persistance;
  stockage: StockageChrome;
  /** Thème appliqué en ce moment à la portée. */
  theme(): ThemeResolu;
  /** Choix de l'utilisateur (six thèmes, ou « custom » avec un thème personnel déjà validé) : appliqué et enregistré. */
  choisir(actif: ThemeId, perso?: DocTheme | null): ThemeResolu;
  /** Abonnement aux changements (choix ici ou ailleurs). */
  surChangement(f: (t: ThemeResolu) => void): () => void;
}

/**
 * Démarrage d'une page de l'extension (popup, réglages, accueil) : chouette maître servie par l'extension, thème du
 * miroir local appliqué tout de suite (theme-boot.js l'a déjà posé), puis relecture de storage.sync (un choix fait sur
 * un autre appareil, ou avant que le miroir existe) et écoute des changements venus d'ailleurs.
 */
export function demarrerApparence(cible: HTMLElement = document.documentElement): Apparence {
  configurerEgide({ chouette: chrome.runtime.getURL("egide/aethryon-master.svg") });
  const stockage = stockageChrome();
  const persistance = creerPersistance({ stockage });
  let theme = demarrerTheme(cible, persistance).theme;
  const abonnes = new Set<(t: ThemeResolu) => void>();
  const appliquer = (transition: boolean) => {
    try { theme = appliquerTheme(cible, entreeDePreference(persistance.lire()), { transition }); } catch { theme = appliquerTheme(cible, "obsidian"); }
    for (const f of abonnes) f(theme);
  };
  // Miroir seul (rien ne repart vers storage.sync) : pour recalculer le cache de theme-boot.js d'une préférence reçue.
  const local = creerPersistance({ stockage: { getItem: (k) => stockage.getItem(k), setItem: (_k, v) => void stockage.recevoir(v), removeItem: () => undefined } });
  const recevoir = (brut: unknown) => {
    const texte = typeof brut === "string" ? brut : null;
    const avant = stockage.getItem(CLE_APPARENCE);
    if (!stockage.recevoir(texte) || memeChoix(avant, texte)) return;
    // Revalidée par le socle (lirePreference : un enregistrement abîmé ou trafiqué redevient Obsidian).
    if (texte !== null) {
      const p = lirePreference(texte);
      local.ecrire({ actif: p.actif, perso: p.perso });
    }
    appliquer(false);
  };
  try {
    chrome.storage.sync.get(CLE_SYNC_APPARENCE).then((r) => {
      const v = r[CLE_SYNC_APPARENCE];
      // Rien dans sync mais un choix local (installé avant la synchronisation) : il y est recopié.
      if (v === undefined) {
        const local = stockage.getItem(CLE_APPARENCE);
        if (local) chrome.storage.sync.set({ [CLE_SYNC_APPARENCE]: local }).catch(() => undefined);
        return;
      }
      recevoir(v);
    }, () => undefined);
    chrome.storage.sync.onChanged.addListener((changes) => {
      const c = changes[CLE_SYNC_APPARENCE];
      if (c) recevoir(c.newValue ?? null);
    });
  } catch { /* hors extension (essais) : miroir local seulement */ }
  return {
    persistance,
    stockage,
    theme: () => theme,
    choisir(actif, perso) {
      persistance.ecrire(perso === undefined ? { actif } : { actif, perso });
      appliquer(true);
      return theme;
    },
    surChangement(f) {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
  };
}

/** Les six thèmes, dans l'ordre et avec les noms du socle (choix du popup et des réglages). */
export const NOMS_THEMES: Readonly<Record<ThemeId, string>> = {
  obsidian: "Obsidian", ivory: "Ivory", oled: "OLED", midnight: "Midnight", minimal: "Minimal", custom: "Custom",
};
