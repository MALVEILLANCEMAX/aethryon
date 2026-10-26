// Réglages pour les content scripts : storage.sync UNIQUEMENT, jamais storage.local (jeton d'extension).
// On écoute chrome.storage.sync.onChanged et non l'événement général chrome.storage.onChanged : celui-ci
// transporterait aussi les changements de storage.local — dont la valeur du jeton à chaque connexion —
// jusque dans le processus de la page. Avec l'événement propre à la zone « sync », le navigateur ne
// transmet au content script que les changements des réglages.
import { mergeSettings } from "../../shared/storage.ts";
import type { Settings } from "../../shared/types.ts";

const SETTINGS_KEY = "settings";

export function watchSyncSettings(cb: (s: Settings) => void): () => void {
  const area = chrome.storage.sync;
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    const c = changes[SETTINGS_KEY];
    if (c) cb(mergeSettings(c.newValue as Partial<Settings> | undefined));
  };
  area.onChanged.addListener(listener);
  return () => area.onChanged.removeListener(listener);
}
