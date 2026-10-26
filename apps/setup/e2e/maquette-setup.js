// Maquette de l'API Tauri d'AETHRYON Setup pour les captures Playwright. Elle REJOUE des données produites par le
// vrai moteur Rust sur un système factice (moteur/examples/instantanes.rs) : textes, étapes, durées et octets sont
// ceux du moteur. window.__SCENARIO__ = { etat, avancements, desinstallation, medias, pause, pauseDes }.
(function () {
  const S = window.__SCENARIO__;
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  async function rejouer(liste, ecouteur, pause) {
    for (let i = 0; i < liste.length; i++) {
      ecouteur(liste[i]);
      if (pause != null && i >= pause) return new Promise(() => {}); // figé pour la capture
      await attendre(12);
    }
    return liste[liste.length - 1];
  }
  window.__MAQUETTE_SETUP__ = {
    etatInitial: async () => S.etat,
    detecter: async () => { await attendre(300); return S.etat.detection; },
    choisirDossier: async () => null,
    choisirPremiere: async () => null,
    espaceLibre: async () => S.etat.detection.espaceLibre,
    lancer: async (_op, _opts, ecouteur) => rejouer(S.avancements, ecouteur, S.pause),
    annuler: async () => {},
    inventaireMedias: async () => S.medias || [0, 0],
    desinstaller: async (_garder, _navigateur, ecouteur) => rejouer(S.desinstallation, ecouteur, S.pauseDes),
    ouvrir: async () => {},
    fenetre: async () => {},
    pret: async () => { window.__PRET__ = true; },
  };
})();
