// Persistance de l'apparence (THEME_ENGINE.md § 7) : stockage local avec REPLI en mémoire (navigation privée, données
// de site bloquées, aperçu, quota plein : jamais d'exception), clé versionnée, enregistrement relu et revalidé à
// chaque lecture (un enregistrement abîmé ou trafiqué est ignoré, jamais appliqué). Le cache (variables et
// attributs du thème actif) est ce que lit theme-boot.js avant le premier rendu, sans le moteur.
import { appliquerTheme, resoudreEntree, type EntreeTheme } from "./appliquer.ts";
import type { ThemeResolu } from "./moteur.ts";
import { normaliserDoc, validerObjet } from "./schema.ts";
import { CUSTOM_EXEMPLE, estThemeId, type DocTheme, type ThemeId } from "./themes.ts";
import { variablesTheme } from "./variables.ts";

/** Clé du stockage local (le suffixe est la version de l'enregistrement, pas celle du format de thème). */
export const CLE_APPARENCE = "aethryon.apparence.v1";
export const VERSION_PREFERENCE = 1;

/** Sous-ensemble de l'API Web Storage (localStorage, sessionStorage, ou un adaptateur pour chrome.storage). */
export interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

export interface Preference {
  v: typeof VERSION_PREFERENCE;
  /** Thème choisi parmi les six. */
  actif: ThemeId;
  /** Thème personnel enregistré (appliqué quand actif = « custom » ; sans lui, l'exemple Vert-de-gris), gardé quand on
   *  passe à un thème officiel. */
  perso: DocTheme | null;
  /** Variables et attributs du thème actif, pour le démarrage sans flash (recalculés à chaque écriture). */
  cache: { vars: Record<string, string>; attrs: Record<string, string> } | null;
  /** Horodatage de la dernière écriture (ms) : départage une future synchronisation par le compte. */
  maj: number;
}

export const PREFERENCE_DEFAUT: Readonly<Preference> = Object.freeze({ v: 1, actif: "obsidian", perso: null, cache: null, maj: 0 });

/** Stockage en mémoire : repli quand le stockage du navigateur est absent ou refusé. */
export function stockageMemoire(): Stockage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

/** localStorage s'il est réellement utilisable (écriture d'essai), sinon null. */
export function stockageNavigateur(): Stockage | null {
  try {
    const s = (globalThis as { localStorage?: Stockage }).localStorage;
    if (!s) return null;
    const k = "aethryon.essai";
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** Relit un enregistrement : structure, version, thème connu, thème personnel revalidé par le validateur strict. */
export function lirePreference(brut: string | null): Preference {
  if (!brut || brut.length > 65536) return { ...PREFERENCE_DEFAUT };
  let p: unknown;
  try { p = JSON.parse(brut); } catch { return { ...PREFERENCE_DEFAUT }; }
  if (typeof p !== "object" || p === null || Array.isArray(p)) return { ...PREFERENCE_DEFAUT };
  const o = p as Record<string, unknown>;
  if (o.v !== VERSION_PREFERENCE || !estThemeId(o.actif)) return { ...PREFERENCE_DEFAUT };
  let perso: DocTheme | null = null;
  if (o.perso != null) {
    const v = validerObjet(o.perso);
    if (v.ok) perso = normaliserDoc(v.doc);
  }
  return { v: 1, actif: o.actif, perso, cache: null, maj: typeof o.maj === "number" && Number.isFinite(o.maj) ? o.maj : 0 };
}

/** Ce qu'il faut appliquer pour une préférence. */
export function entreeDePreference(p: Preference): EntreeTheme {
  return p.actif === "custom" ? (p.perso ?? CUSTOM_EXEMPLE) : p.actif;
}

export interface Persistance {
  /** Faux quand on est retombé sur la mémoire : la préférence sera perdue à la fermeture. */
  readonly persistant: boolean;
  lire(): Preference;
  /** Enregistre le choix ; renvoie vrai si c'est gardé durablement sur cet appareil. */
  ecrire(choix: { actif: ThemeId; perso?: DocTheme | null }): boolean;
  /** Réinitialisation : oublie tout (retour à Obsidian). */
  effacer(): void;
}

export function creerPersistance(options: { stockage?: Stockage | null; cle?: string } = {}): Persistance {
  const cle = options.cle ?? CLE_APPARENCE;
  const durable = options.stockage === undefined ? stockageNavigateur() : options.stockage;
  const memoire = stockageMemoire();
  let persistant = durable !== null;
  const lireBrut = (): string | null => {
    // Après un échec d'écriture (quota), la mémoire porte la dernière préférence : elle prime.
    if (durable && persistant) { try { return durable.getItem(cle); } catch { persistant = false; } }
    return memoire.getItem(cle);
  };
  return {
    get persistant() { return persistant; },
    lire: () => lirePreference(lireBrut()),
    ecrire({ actif, perso }) {
      const avant = lirePreference(lireBrut());
      const garde = perso === undefined ? avant.perso : perso ? normaliserDoc(perso) : null;
      if (garde && !validerObjet(garde).ok) return false;
      const pref: Preference = { v: 1, actif, perso: garde, cache: null, maj: Date.now() };
      const { theme, vars, attrs } = variablesTheme(resoudreEntree(entreeDePreference(pref)));
      pref.cache = { vars: theme === "custom" ? vars : {}, attrs };
      const texte = JSON.stringify(pref);
      memoire.setItem(cle, texte);
      if (!durable) return false;
      try { durable.setItem(cle, texte); return persistant; } catch { persistant = false; return false; }
    },
    effacer() {
      memoire.removeItem(cle);
      if (durable) { try { durable.removeItem(cle); } catch { persistant = false; } }
    },
  };
}

/**
 * Démarrage d'une interface : lit la préférence et l'applique à la portée (racine du document par défaut). Ne lève
 * jamais : en cas de problème, Obsidian.
 */
export function demarrerTheme(cible?: HTMLElement, persistance: Persistance = creerPersistance()): { theme: ThemeResolu; preference: Preference } {
  const el = cible ?? document.documentElement;
  const preference = persistance.lire();
  let theme: ThemeResolu;
  try { theme = appliquerTheme(el, entreeDePreference(preference)); } catch { theme = appliquerTheme(el, "obsidian"); }
  return { theme, preference };
}

/** Choix d'un thème par l'utilisateur : application immédiate + enregistrement. */
export function choisirTheme(cible: HTMLElement, choix: { actif: ThemeId; perso?: DocTheme | null }, persistance: Persistance, transition = true): { theme: ThemeResolu; garde: boolean } {
  const garde = persistance.ecrire(choix);
  const theme = appliquerTheme(cible, entreeDePreference(persistance.lire()), { transition });
  return { theme, garde };
}

/** Tout réinitialiser : préférence oubliée, Obsidian appliqué. */
export function reinitialiserTheme(cible: HTMLElement, persistance: Persistance): ThemeResolu {
  persistance.effacer();
  return appliquerTheme(cible, "obsidian", { transition: true });
}
