// Journal des versions du raccourci AETHRYON : accueil (« Nouveautés ») et aide (« Version du raccourci »).
// Source unique côté site, publiée avec lui (deploy-web.sh) sans redémarrer le service de comptes. Le champ
// `changelog` de /api/config (resté à la version 1.1) n'est plus lu par le site. Règle : la première entrée
// est la version publiée par le serveur (/api/config `shortcutVersion`) ; e2e/ui.test.mjs le vérifie.
// Notes fidèles à ce qui a réellement changé (raccourci-site/shortcut/RAPPORT.md), validé sur iPhone.
export interface Release {
  version: string;
  /** Jour de publication, AAAA-MM-JJ. */
  date: string;
  notes: string[];
}

export const CHANGELOG: readonly Release[] = [
  {
    version: "3.0",
    date: "2026-10-10",
    notes: [
      "Nouveau nom : AETHRYON.",
      "Le fichier est réellement téléchargé puis enregistré : l'ancienne version pouvait s'arrêter juste après la conversion.",
      "Liens courts TikTok acceptés.",
      "Fichier vérifié avant l'enregistrement : la vidéo MP4 dans Photos, le MP3 dans Fichiers.",
      "Installation par le lien iCloud officiel.",
    ],
  },
  {
    version: "1.1",
    date: "2026-10-10",
    notes: ["Fichier signé distribué depuis le site.", "Messages d'erreur plus clairs (jeton, limites, service)."],
  },
];
