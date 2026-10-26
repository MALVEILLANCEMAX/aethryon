// Préférences d'affichage locales (localStorage), pour le confort uniquement : guide masqué, moment de
// la première conversion déjà montré. Jamais une donnée que le serveur connaît (jetons, quota, activité),
// jamais un secret. Stockage indisponible (navigation privée, données effacées, accès refusé) : chaque
// lecture renvoie null et chaque écriture est ignorée, l'interface fonctionne normalement.
// Clés propres au compte (identifiant opaque) : deux comptes sur le même navigateur ne se mélangent pas.
const PREFIX = "aethryon.espace";

export type PrefName = "guide-masque" | "premiere-conversion";

const key = (userId: string, name: PrefName) => `${PREFIX}.${userId}.${name}`;

export function readPref(userId: string, name: PrefName): string | null {
  try {
    return window.localStorage.getItem(key(userId, name));
  } catch {
    return null;
  }
}

export function writePref(userId: string, name: PrefName, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key(userId, name));
    else window.localStorage.setItem(key(userId, name), value);
  } catch {
    /* stockage indisponible : préférence non retenue */
  }
}
