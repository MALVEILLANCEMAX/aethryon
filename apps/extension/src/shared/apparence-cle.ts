// Clé de la préférence d'apparence (thème Égide) dans chrome.storage.sync : partagée par les pages de l'extension
// (src/shared/apparence.ts) et le menu injecté (src/content/common/apparence.ts). Module sans dépendance, pour que le
// content script n'emporte rien d'autre.
export const CLE_SYNC_APPARENCE = "apparence";
