// Petites préférences d'interface de TimeLens (3.8.0) : nombre d'usages de la lentille (indication des trois premiers)
// et astuces déjà vues ou coupées. Aucune donnée sensible.
// Zone : chrome.storage.SYNC, la seule que les content scripts peuvent lire — storage.local est réservé aux contextes
// de confiance depuis 3.5 (setAccessLevel TRUSTED_CONTEXTS, jeton du compte), voir content/common/settings.ts. Le
// popup utilise la même zone, pour que le menu des pages et le popup partagent ces souvenirs. Sans API (essais
// unitaires), une mémoire de la page sert de repli.
export const PREF_LENS_VIEWS = "aethryon.lentille.vue";
export const PREF_HINTS = "aethryon.astuces";
export const PREF_HINTS_OFF = "aethryon.astuces.off";

const memory: Record<string, unknown> = {};

function area(): chrome.storage.StorageArea | null {
  try {
    return typeof chrome !== "undefined" && chrome.storage?.sync ? chrome.storage.sync : null;
  } catch {
    return null;
  }
}

export async function readPrefs(keys: string[]): Promise<Record<string, unknown>> {
  const a = area();
  if (!a) return Object.fromEntries(keys.map((k) => [k, memory[k]]));
  try {
    return await a.get(keys);
  } catch {
    return Object.fromEntries(keys.map((k) => [k, memory[k]]));
  }
}

export function writePref(key: string, value: unknown): void {
  memory[key] = value;
  const a = area();
  if (!a) return;
  try {
    void a.set({ [key]: value }).catch(() => undefined);
  } catch {
    /* zone indisponible : la mémoire de la page suffit pour cette ouverture */
  }
}
