// Glisser une carte du panneau vers Premiere (panneau Projet, timeline, moniteur source).
// Le Cookbook CEP 12 dit seulement que le glisser « entre une extension HTML et son application hôte » est pris en
// charge, sans donner de format. La communauté (kkronyak et Justin Taylor, forum Adobe 2019 ; MediaRade 2026) pose
// « com.adobe.cep.dnd.file.<N> » avec le chemin absolu de chaque fichier. On pose ce format ET les formats standard,
// chacun dans un try : un format refusé n'annule jamais les autres. Le diagnostic intégré PROUVE (ou non) que Premiere
// reçoit le fichier, en relisant le projet et la séquence par ExtendScript.

export function poserFormatsGlisser(dt: DataTransfer, chemins: string[], urlLocale: (c: string) => string): string[] {
  const poses: string[] = [];
  const poser = (type: string, valeur: string) => {
    try {
      dt.setData(type, valeur);
      poses.push(type);
    } catch {
      /* format refusé par ce moteur : on continue avec les autres */
    }
  };
  chemins.forEach((c, i) => poser(`com.adobe.cep.dnd.file.${i}`, c));
  if (chemins.length) poser("application/x-cef-dnd-file", chemins[0]!);
  poser("text/uri-list", chemins.map((c) => urlLocale(c)).join("\r\n"));
  poser("text/plain", chemins.join("\n"));
  try {
    dt.effectAllowed = "copy";
  } catch {
    /* lecture seule dans certains moteurs */
  }
  return poses;
}
