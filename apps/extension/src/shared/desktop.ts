// Lien local avec AETHRYON Desktop (3.5.2, docs/EXTENSION.md §12) : règles partagées par le service worker, le
// popup et les réglages.
// - Hôte Native Messaging déclaré par l'installateur d'AETHRYON Desktop (desktop/noyau, NOM_HOTE_NM) : Chrome lance
//   aethryon-desktop.exe, qui n'écrit que `transferts\<id>.json` (contrat d'échange §6). Aucun port réseau, aucun
//   serveur local, aucun secret : le canal ne transporte que titre, plateforme, format, état, progression et nom
//   du fichier attendu.
// - Permission « nativeMessaging » FACULTATIVE (acceptée comme telle par Chrome 153, vérifié) : demandée seulement
//   quand l'utilisateur choisit « Envoyer vers » › « Premiere Pro » dans le popup ou les réglages, DANS son geste
//   (sinon Chrome refuse la demande). Un content script ne peut pas la demander : choisi depuis le menu d'une page,
//   « Premiere Pro » range le fichier dans Téléchargements › AETHRYON, et le popup propose « Autoriser ».
// - Refus, ou Desktop absent : le fichier va quand même dans Téléchargements › AETHRYON, que le Desktop surveille.

/** Nom de l'hôte enregistré par AETHRYON Desktop (HKCU\Software\Google\Chrome\NativeMessagingHosts\…). */
export const DESKTOP_HOST = "fr.aethryon.desktop";
export const NATIVE_PERMISSION: chrome.permissions.Permissions = { permissions: ["nativeMessaging"] };

type PermissionsApi = Pick<typeof chrome.permissions, "contains" | "request">;
const api = (): PermissionsApi | undefined => (globalThis as { chrome?: typeof chrome }).chrome?.permissions;

/** Lien autorisé ? (faux si l'API manque ou échoue) */
export async function hasDesktopLink(p: PermissionsApi | undefined = api()): Promise<boolean> {
  try {
    return p ? await p.contains(NATIVE_PERMISSION) : false;
  } catch {
    return false;
  }
}

/**
 * Demande la permission. À appeler TOUT DE SUITE dans le gestionnaire du clic ou du changement (geste de
 * l'utilisateur), avant tout await. Refus, fenêtre fermée ou erreur : faux, sans message d'erreur.
 */
export function askDesktopLink(p: PermissionsApi | undefined = api()): Promise<boolean> {
  try {
    if (!p) return Promise.resolve(false);
    return p.request(NATIVE_PERMISSION).then((g) => g === true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}
