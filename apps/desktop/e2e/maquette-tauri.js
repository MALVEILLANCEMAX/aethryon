// MAQUETTE de l'API Tauri pour les captures Playwright (Chromium) : remplace window.__TAURI_INTERNALS__ par des
// réponses d'essai. Rien ici n'est livré dans l'application (dist/ ne contient pas ce fichier) et rien n'est « réel » :
// les captures montrent l'interface, pas des fonctions démontrées sous Windows.
// Scénario : window.__SCENARIO__ = { mode, assistantTermine, theme, introuvable, pauseInstallation, vide,
//   premiereDeconnecte, envoiExpire, envoiEchec, delaiPanneau, importLent }.
// Flux (glisser-déposer, desktop/FLUX.md) : commandes glisser_medias, glisser_annuler, flux_classer, importer_fichiers,
// importer_annuler, envoyer_vers_premiere ; événements simulés par window.__maquette.flux (entrer, survoler, deposer,
// sortir, deposerAilleurs, relacher) en coordonnées CSS, converties en pixels PHYSIQUES comme le fait Tauri.
// AUCUN glisser natif n'a lieu ici : la maquette rejoue seulement les événements que Tauri enverrait.
// Compte et Cloud (CLOUD-UI.md) : commandes compte_* et cloud_*, événements « compte » et « cloud-transfert », avec la
// forme EXACTE du cœur (noyau/src/compte.rs, cloud.rs). Scénario : compte ("non-relie" | "admin" | "utilisateur" |
// "ferme"), cloudVide, quotaPlein, envoiCoupe, tropGros, lienExpire, appairage ("refuse" | "expire"), envoiLent.
// window.__maquette.compte.autoriser() joue l'accord donné sur la page du site. Aucune requête réseau, aucune clé.
// AETHRYON Index (INDEX.md) : commandes index_* et bibliotheque_requete, événements index-progression / index-fin /
// index-changement / index-migration, volumes C: D: E: (amovible) F: (vide) Z: (réseau injoignable). Scénario : indexVide,
// scanLent, everything, indexErreurs, migrationEchec, debranche. Le scan est SIMULÉ (aucun disque n'est lu).
(() => {
  const S = Object.assign({ mode: "normal", assistantTermine: true, theme: "systeme", introuvable: false, pauseInstallation: false, vide: false,
    premiereDeconnecte: false, envoiExpire: false, envoiEchec: false, delaiPanneau: 900, importLent: false,
    compte: "non-relie", cloudVide: false, quotaPlein: false, envoiCoupe: false, tropGros: false, lienExpire: false, appairage: null, envoiLent: false }, window.__SCENARIO__ || {});
  const R = "C:\\Users\\Élodie\\AppData\\Local\\AETHRYON";
  const DM = "C:\\Users\\Élodie\\Videos\\AETHRYON";
  const auj = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const hier = (h, m) => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const ilya = (j, h, m) => { const d = new Date(); d.setDate(d.getDate() - j); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const hex = (c) => c.repeat(40);
  const M = (p) => Object.assign({
    chemin: `${DM}\\${p.nom}.${p.ext}`, type: "video", ajouteLe: auj(1, 0), modifieLe: auj(1, 0), duree: null, largeur: null, hauteur: null, ips: null,
    codecVideo: null, codecAudio: null, miniature: null, etat: "disponible", premiereCompatible: true, origine: { plateforme: "local", titre: null },
  }, p, { miniature: p.mini ? `miniatures/${p.id}.jpg` : null });
  const medias = S.vide ? [] : [
    M({ id: hex("1"), nom: "AETHRYON — Le Passage (V3.5)", ext: "mp4", taille: 14889779, ajouteLe: auj(1, 18), etat: "en-cours", mini: "film-cartes.jpg", duree: 38, largeur: 1920, hauteur: 1080, ips: 60, premiereCompatible: null, origine: { plateforme: "youtube", titre: "AETHRYON — Le Passage" } }),
    M({ id: hex("2"), nom: "Coucher de soleil sur la côte", ext: "mp4", taille: 845654, ajouteLe: auj(1, 12), duree: 12, largeur: 1280, hauteur: 720, ips: 30, codecVideo: "h264", codecAudio: "aac", mini: "coucher-6s.jpg" }),
    M({ id: hex("3"), nom: "Coucher de soleil — vertical", ext: "mp4", taille: 1048576, ajouteLe: auj(1, 5), duree: 12, largeur: 720, hauteur: 1280, ips: 30, codecVideo: "h264", codecAudio: "aac", mini: "coucher-vertical-169.jpg" }),
    M({ id: hex("4"), nom: "Coucher de soleil — passage", ext: "gif", type: "image", taille: 1191433, ajouteLe: auj(0, 58), largeur: 480, hauteur: 270, mini: "coucher-passage-gif.jpg" }),
    M({ id: hex("5"), nom: "Coucher de soleil sur la côte", ext: "mp3", type: "audio", taille: 289918, ajouteLe: auj(0, 51), duree: 12, codecAudio: "mp3", chemin: `${DM}\\Coucher de soleil sur la côte.mp3` }),
    M({ id: hex("6"), nom: "Coucher de soleil — version longue", ext: "mp4", taille: 0, ajouteLe: auj(0, 40), etat: "erreur", erreur: "Windows refuse la lecture de ce fichier (droits d'accès).", premiereCompatible: null }),
    M({ id: hex("7"), nom: "Nappe sonore — côte", ext: "wav", type: "audio", taille: 2306166, ajouteLe: hier(22, 40), duree: 12, codecAudio: "pcm" }),
    M({ id: hex("8"), nom: "AETHRYON Tools — extrait", ext: "mp4", taille: 6501171, ajouteLe: hier(22, 31), duree: 6, largeur: 1920, hauteur: 1080, ips: 60, codecVideo: "h264", codecAudio: "aac", mini: "film-tools.jpg" }),
    M({ id: hex("9"), nom: "Coucher de soleil — 6 s", ext: "png", type: "image", taille: 172154, ajouteLe: hier(22, 12), largeur: 1280, hauteur: 720, mini: "coucher-1s.jpg" }),
    M({ id: hex("a"), nom: "Coucher de soleil — horizon", ext: "webm", taille: 1338673, ajouteLe: hier(21, 47), duree: 12, largeur: 1280, hauteur: 720, premiereCompatible: false, mini: "coucher-1s.jpg" }),
    M({ id: hex("b"), nom: "Plan large — rushes 02", ext: "mp4", taille: 15414067, ajouteLe: ilya(2, 18, 3), etat: "introuvable", duree: 24, largeur: 1920, hauteur: 1080, ips: 25, codecVideo: "h264", codecAudio: "aac", mini: "coucher-1s.jpg", chemin: "D:\\Rushes\\Voyage\\Plan large — rushes 02.mp4" }),
  ];
  // Nocturne (essais seulement) : `nombreMedias` ajoute N médias SYNTHÉTIQUES nommés « Essai de charge NNNNN » pour
  // mesurer la grille virtualisée ; jamais dans l'application.
  if (S.nombreMedias) {
    const types = ["video", "audio", "image"];
    for (let i = 0; i < S.nombreMedias; i++) {
      const type = types[i % 3];
      const id = ("e55a" + i.toString(16).padStart(36, "0")).slice(0, 40);
      medias.push(M({ id, nom: `Essai de charge ${String(i).padStart(5, "0")}`, ext: type === "video" ? "mp4" : type === "audio" ? "mp3" : "png", type, taille: 100000 + i * 37,
        ajouteLe: ilya(3 + (i % 300), 10, i % 60), duree: type === "image" ? null : 5 + (i % 600), largeur: type === "audio" ? null : 1920, hauteur: type === "audio" ? null : 1080, ips: type === "video" ? 30 : null, mini: i % 7 === 0 ? "coucher-1s.jpg" : undefined }));
    }
  }
  window.__MINIATURES__ = Object.fromEntries(medias.filter((m) => m.mini).map((m) => [m.id, m.mini]));
  const MINIATURES_PAR_PREMIER = Object.fromEntries(medias.filter((m) => m.mini).map((m) => [m.id[0], m.mini]));
  const transferts = S.vide ? [] : [
    { schema: 1, id: "passage", titre: "AETHRYON — Le Passage", plateforme: "youtube", format: "mp4", etat: "telechargement", progression: 0.64, fichierAttendu: "AETHRYON — Le Passage (V3.5).mp4", chemin: null, erreur: null, majLe: auj(1, 18) },
    { schema: 1, id: "horizon", titre: "Coucher de soleil — horizon", plateforme: "youtube", format: "mp4", etat: "conversion", progression: 0.38, fichierAttendu: "Coucher de soleil — horizon.mp4", chemin: null, erreur: null, majLe: auj(1, 17) },
    { schema: 1, id: "serre", titre: "Coucher de soleil — plan serré", plateforme: "youtube", format: "mp4", etat: "attente", progression: null, fichierAttendu: "Coucher de soleil — plan serré.mp4", chemin: null, erreur: null, majLe: auj(1, 16) },
    { schema: 1, id: "coucher", titre: "Coucher de soleil sur la côte", plateforme: "youtube", format: "mp4", etat: "pret", progression: 1, fichierAttendu: "Coucher de soleil sur la côte.mp4", chemin: `${DM}\\Coucher de soleil sur la côte.mp4`, erreur: null, majLe: auj(1, 12) },
    { schema: 1, id: "longue", titre: "Coucher de soleil — version longue", plateforme: "youtube", format: "mp4", etat: "erreur", progression: 0.41, fichierAttendu: "Coucher de soleil — version longue.mp4", chemin: null, erreur: "Connexion interrompue à 41 %", majLe: auj(0, 41) },
  ];
  const premiere = S.introuvable ? null : { exe: "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe", dossier: "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026", version: "26.5.2.13", compatible: true, glisser: false, beta: false, source: "dossier" };
  const etat = {
    version: "1.0.0-beta.2", plateforme: "windows",
    config: { schema: 1, dossierMedias: DM, dossiersSurveilles: [DM, "D:\\Rushes\\Voyage"], surveillance: true, demarrageAuto: true, notifications: { mediaPret: true, importReussi: false, erreurs: true },
      theme: S.theme, reduireAnimations: "systeme", importAuto: false, chutierParDefaut: "aethryon", premiere: { ccxInstalle: S.assistantTermine ? "1.0.0-beta.2" : null, installeLe: auj(0, 30) } },
    assistantTermine: S.assistantTermine, racine: R, dossierConfig: "C:\\Users\\Élodie\\AppData\\Roaming\\AETHRYON",
    index: { schema: 1, misAJour: auj(1, 18), dossiers: [{ chemin: DM, principal: true }, { chemin: "D:\\Rushes\\Voyage", principal: false }], medias },
    transferts,
    liaison: { connecte: !S.introuvable, age: 1.2, panneau: S.introuvable ? null : { schema: 1, version: "1.0.0-beta.2", battement: new Date().toISOString(), premiereVersion: "26.5.2", projetOuvert: true, projet: "Montage-voyage", visible: true } },
    imports: { schema: 1, imports: { [hex("3")]: [{ projet: "Montage-voyage", chutier: "AETHRYON", le: auj(1, 20) }], [hex("7")]: [{ projet: "Montage-voyage", chutier: "AETHRYON", le: hier(22, 50) }] } },
    premiere: { installations: premiere ? [premiere] : [], principale: premiere, cherche: ["C:\\Program Files\\Adobe\\Adobe Premiere Pro*", "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Adobe Premiere Pro.exe"], enCours: false },
    creativeCloud: { upia: "C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe", application: null },
    panneauCep: { dossier: "C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\fr.aethryon.premiere", version: "2.0.1", libelle: "Panneau AETHRYON 2.0.1 installé" },
    nativeMessaging: [{ navigateur: "Chrome", enregistre: true, message: null }, { navigateur: "Edge", enregistre: true, message: null }, { navigateur: "Brave", enregistre: true, message: null }],
    demarrageActif: true, desinstallationPresente: true, erreursDossiers: [], journaux: [3, 421888], resultats: [], enAttente: [],
    transfertsPilotables: [],
  };
  // Nocturne-2 (scénario `pilotables`) : une conversion « Coller un lien » que le Desktop reçoit lui-même (octets, débit
  // mesuré par le cœur, pause, reprise, annulation : commande transfert_piloter). Valeurs d'ESSAI, rien n'est téléchargé.
  if (S.pilotables) {
    etat.transferts.unshift({ schema: 1, id: "desk-maree", titre: "Marée basse au Cap Fréhel", plateforme: "youtube", format: "mp4", etat: "telechargement", progression: 0.353,
      fichierAttendu: "Marée basse au Cap Fréhel [k3x].mp4", chemin: null, erreur: null, majLe: auj(1, 19), origine: "desktop", recus: 18_400_000, total: 52_100_000, vitesse: 3_240_000 });
    etat.transfertsPilotables.push("desk-maree");
  }

  const analyses = new Set();
  const rappels = new Map();
  const ecouteurs = new Map();
  let n = 1;
  const emettre = (evenement, payload) => {
    for (const id of ecouteurs.get(evenement) || []) {
      const f = rappels.get(id);
      if (f) f({ event: evenement, id, payload });
    }
  };
  window.__maquette = { etat, emettre,
    /** Modifie l'état simulé puis prévient l'interface (événement « changement », comme le cœur). */
    modifier: (f) => { f(etat); emettre("changement", "etat"); },
    /** Appels de commandes reçus (essais : « aucun envoi n'est parti »). */
    appels: [] };
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  // Résultat du panneau : gardé dans l'état (comme le cœur, `resultats`) puis annoncé.
  const resultatCommande = (r) => { etat.resultats = [...etat.resultats, r].slice(-20); emettre("resultat-commande", r); };

  // ---- Flux : glisser-déposer simulé (mêmes formes que le cœur : noyau/src/flux.rs, src-tauri/src/glisser.rs) ----
  const ratio = () => window.devicePixelRatio || 1;
  const phys = (x, y) => ({ x: x * ratio(), y: y * ratio() });
  const nomDe = (c) => c.split(/[\\/]/).filter(Boolean).pop() || c;
  const norm = (c) => c.replace(/\//g, "\\").toLowerCase();
  const AUDIO = /\.(mp3|wav|m4a|aac|ogg|opus|flac|aif|aiff|wma)$/i;
  const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;
  const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|mxf|mts|m2ts|3gp|wmv)$/i;
  const lots = new Map();
  let glisserEnCours = null;
  let jetons = 0;
  let envois = 0;
  let nouveaux = 0;
  const classer = (chemins) => {
    const c = { medias: [], fichiers: [], dossiers: [], refuses: [] };
    for (const ch of chemins) {
      const m = medias.find((x) => norm(x.chemin) === norm(ch));
      if (m) c.medias.push(m.id);
      else if (!/\.[a-z0-9]{2,5}$/i.test(nomDe(ch))) {
        const surveille = etat.config.dossiersSurveilles.some((d) => norm(ch) === norm(d) || norm(ch).startsWith(norm(d) + "\\"));
        c.dossiers.push({ chemin: ch, nom: nomDe(ch), surveille, surveillable: !surveille, raison: surveille ? "Déjà surveillé par AETHRYON." : null });
      } else if (VIDEO.test(ch) || AUDIO.test(ch) || IMAGE.test(ch)) {
        c.fichiers.push({ chemin: ch, nom: nomDe(ch), taille: 12 * 1024 * 1024, type: AUDIO.test(ch) ? "audio" : IMAGE.test(ch) ? "image" : "video" });
      } else c.refuses.push({ chemin: ch, nom: nomDe(ch), raison: "Type non pris en charge : vidéo, audio ou image attendus." });
    }
    return c;
  };
  const finGlisser = (g, resultat, cible, application, message) => ({ jeton: g.jeton, resultat, effet: resultat === "depose" ? "copie" : "aucun", cible, application, fichiers: g.ids.length, message });
  const terminerGlisser = (resultat, cible, application, message, quitter) => {
    const g = glisserEnCours;
    if (!g) return false;
    glisserEnCours = null;
    if (quitter) emettre("tauri://drag-leave", null);
    setTimeout(() => emettre("flux-glisser-fin", finGlisser(g, resultat, cible, application, message)), 20);
    return true;
  };
  async function importerFichiers({ lot, chemins }) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(lot)) throw "Identifiant de lot refusé.";
    const l = { annule: false };
    lots.set(lot, l);
    const c = classer(chemins);
    const resultats = chemins.map((ch) => {
      const m = c.medias.find((id) => norm(medias.find((x) => x.id === id).chemin) === norm(ch));
      if (m) return { source: ch, nom: nomDe(ch), etat: "deja-la", id: m, raison: "Déjà dans la bibliothèque." };
      const r = c.refuses.find((x) => x.chemin === ch) || (c.dossiers.find((x) => x.chemin === ch) && { raison: "Dossier : AETHRYON propose de le surveiller plutôt que de le copier." });
      return r ? { source: ch, nom: nomDe(ch), etat: "refuse", raison: r.raison } : null;
    });
    const tailleLot = c.fichiers.reduce((a, f) => a + f.taille, 0);
    let faitLot = 0;
    for (let i = 0; i < c.fichiers.length; i++) {
      const f = c.fichiers[i];
      const rang = chemins.indexOf(f.chemin);
      const avis = (etape, fait) => emettre("flux-import", { lot, index: i, fichiers: c.fichiers.length, nom: f.nom, etape, fait, taille: f.taille, faitLot: faitLot + fait, tailleLot });
      avis("verification", 0);
      if (l.annule) { resultats[rang] = { source: f.chemin, nom: f.nom, etat: "annule" }; continue; }
      nouveaux += 1;
      const id = ("c0ffee" + String(nouveaux).padStart(34, "0")).slice(0, 40);
      const [souche, ext] = [f.nom.replace(/\.[^.]+$/, ""), (f.nom.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase()];
      const m = M({ id, nom: souche, ext, type: f.type, taille: f.taille, chemin: `${DM}\\${f.nom}`, ajouteLe: new Date().toISOString(), etat: "en-cours", premiereCompatible: null });
      medias.unshift(m);
      emettre("changement", "bibliotheque");
      for (let k = 1; k <= 4 && !l.annule; k++) {
        await attendre(S.importLent ? 400 : 60);
        if (!l.annule) avis("copie", (f.taille * k) / 4);
      }
      if (l.annule) {
        medias.splice(medias.indexOf(m), 1);
        emettre("changement", "bibliotheque");
        resultats[rang] = { source: f.chemin, nom: f.nom, etat: "annule" };
        continue;
      }
      faitLot += f.taille;
      m.etat = "disponible";
      emettre("changement", "bibliotheque");
      resultats[rang] = { source: f.chemin, nom: f.nom, etat: "importe", chemin: m.chemin, id, fichier: f.nom };
    }
    if (c.fichiers.length) emettre("flux-import", { lot, index: c.fichiers.length, fichiers: c.fichiers.length, nom: "", etape: "termine", fait: 0, taille: 0, faitLot, tailleLot });
    lots.delete(lot);
    const compte = (e) => resultats.filter((r) => r && r.etat === e).length;
    const bilan = { lot, fichiers: resultats.filter(Boolean), importes: compte("importe"), dejaLa: compte("deja-la"), refuses: compte("refuse"), echecs: 0, annules: compte("annule"), octets: faitLot };
    emettre("flux-import-fin", bilan);
    return bilan;
  }
  window.__maquette.flux = {
    /** Fichiers qui entrent dans la fenêtre (x, y en pixels CSS). */
    entrer: (chemins, x, y) => emettre("tauri://drag-enter", { paths: chemins, position: phys(x, y) }),
    survoler: (x, y) => emettre("tauri://drag-over", { position: phys(x, y) }),
    /** Dépôt sur la fenêtre ; pendant un glisser natif d'AETHRYON, sa fin (cible interne) suit, comme sous Windows. */
    deposer: (chemins, x, y) => {
      emettre("tauri://drag-drop", { paths: chemins, position: phys(x, y) });
      if (glisserEnCours) terminerGlisser("depose", "interne", null, null, false);
    },
    sortir: () => emettre("tauri://drag-leave", null),
    /** Le glisser natif quitte la fenêtre et se dépose dans une autre application. */
    deposerAilleurs: (application = "Adobe Premiere Pro.exe") => terminerGlisser("depose", "externe", application, null, true),
    /** Bouton relâché hors de toute cible, ou Échap. */
    relacher: () => terminerGlisser("annule", "inconnue", null, null, true),
    glisser: () => glisserEnCours,
    ecouteurs: (evenement) => (evenement ? (ecouteurs.get(evenement) || []).length : [...ecouteurs.values()].reduce((a, l) => a + l.length, 0)),
  };

  const ETAPES = [
    ["Vérification", [["Adobe Premiere Pro", "Version 26.5.2.13 · panneau AETHRYON pris en charge.", 380], ["Creative Cloud Desktop", "Présent (installe et met à jour Premiere Pro).", 20], ["Panneau AETHRYON", "Panneau AETHRYON 2.0.1 installé.", 30], ["Dossier des médias", "Écriture vérifiée · 182 Go libres.", 15]]],
    ["Installation", [["AETHRYON Desktop", "Présent dans C:\\Users\\Élodie\\AppData\\Local\\Programs\\AETHRYON · 6,0 Mo.", 5], ["Panneau Premiere Pro (AETHRYON Setup)", "Panneau AETHRYON 2.0.1 installé par AETHRYON Setup.", 12]]],
    ["Enregistrement des composants", [["Liaison navigateur (Native Messaging) : Chrome, Edge, Brave", "Hôte local enregistré (HKCU).", 60], ["Démarrage avec Windows", "Activé.", 900], ["Désinstallation dans Paramètres Windows", "Entrée présente (version 1.0.0-beta.2).", 10]]],
    ["Configuration", [["Préférences", "Enregistrées.", 20], ["Bibliothèque et échanges avec le panneau", "Prêts.", 30]]],
    ["Validation", [["Panneau AETHRYON relu", "Panneau AETHRYON 2.0.1 installé : CSXS/manifest.xml relu.", 4], ["Fichiers", "Présents.", 5], ["Clés du registre", "Relues.", 5]]],
  ];
  const DESC = ["Premiere Pro, Creative Cloud, panneau AETHRYON, dossier des médias.", "AETHRYON Desktop et le panneau Premiere Pro.", "Liaison navigateur, démarrage avec Windows, désinstallation.", "Dossier des médias et préférences.", "Panneau, fichiers et clés relus."];

  async function installer() {
    const et = ETAPES.map(([t], i) => ({ numero: i + 1, titre: t, description: DESC[i], etat: "attente", dureeMs: 0, operations: [] }));
    const pub = () => emettre("assistant-progression", JSON.parse(JSON.stringify(et)));
    for (let i = 0; i < ETAPES.length; i++) {
      et[i].etat = "en-cours"; pub();
      for (const [lib, msg, ms] of ETAPES[i][1]) {
        et[i].operations.push({ libelle: lib, etat: "en-cours", message: null, dureeMs: 0 }); pub();
        if (S.pauseInstallation && i === 2 && lib.startsWith("Démarrage")) { await new Promise(() => {}); }
        await attendre(Math.min(ms, 120));
        Object.assign(et[i].operations[et[i].operations.length - 1], { etat: "ok", message: msg, dureeMs: ms }); pub();
      }
      et[i].etat = "ok"; et[i].dureeMs = ETAPES[i][1].reduce((a, x) => a + x[2], 0) + 40; pub();
    }
    etat.assistantTermine = true;
    return { etapes: et, reussi: true, annule: false, version: "1.0.0-beta.2", panneau: { statut: "installe", version: "2.0.1", message: "Panneau AETHRYON 2.0.1 installé par AETHRYON Setup." }, dossierMedias: DM, premiere, dureeMs: 14200 };
  }

  // ---- Compte relié et AETHRYON Cloud (mêmes formes que le cœur ; aucune clé n'existe ici) -------------------------------
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const JOUR = 86_400_000;
  const relie = (admin, ferme) => ({ relie: true, compte: { email: admin ? "elodie@aethryon.example" : "lina@example.test", nom: admin ? "Élodie" : "Lina" },
    administrateur: admin, cloud: { disponible: admin && !ferme, raison: !admin ? "non_admin" : ferme ? "ferme" : null }, cleExpireLe: iso(29 * JOUR), relieLe: iso(-JOUR),
    appairage: null, erreur: null, horsLigne: false, verifieLe: iso(0) });
  const NON_RELIE = { relie: false, compte: null, administrateur: null, cloud: null, cleExpireLe: null, relieLe: null, appairage: null, erreur: null, horsLigne: false, verifieLe: null };
  let compte = S.compte === "admin" ? relie(true, false) : S.compte === "utilisateur" ? relie(false, false) : S.compte === "ferme" ? relie(true, true) : { ...NON_RELIE };
  const avisCompte = () => emettre("compte", structuredClone(compte));
  const MAX = 9e9;
  const SHA = (c) => c.repeat(64);
  let nObjets = 0;
  const objet = (p) => Object.assign({ id: `obj${String(++nObjets).padStart(19, "0")}`, type: "video/mp4", statut: "sauvegarde", libelle: "Sauvegardé", origine: "desktop", plateforme: null,
    creeLe: iso(-JOUR), envoyeLe: iso(-JOUR), expireLe: iso(29 * JOUR), expireDansJours: 29, sha256: SHA("a"), erreur: null, apercu: true }, p);
  const objets = S.cloudVide ? [] : [
    objet({ nom: "AETHRYON — Le Passage (V3.5).mp4", taille: 14_889_779, origine: "ytapi", plateforme: "youtube", envoyeLe: iso(-3 * 3_600_000), creeLe: iso(-3 * 3_600_000), expireLe: iso(30 * JOUR - 3 * 3_600_000), expireDansJours: 30 }),
    objet({ nom: "Coucher de soleil sur la côte.mp3", type: "audio/mpeg", taille: 289_918, envoyeLe: iso(-2 * JOUR), creeLe: iso(-2 * JOUR), expireLe: iso(28 * JOUR), expireDansJours: 28 }),
    objet({ nom: "Plan large — rushes 02.mp4", taille: 1_415_414_067, envoyeLe: iso(-27 * JOUR), creeLe: iso(-27 * JOUR), expireLe: iso(2 * JOUR + 3_600_000), expireDansJours: 3 }),
    objet({ nom: "Nappe sonore — côte.wav", type: "audio/wav", taille: 2_306_166, statut: "en_attente", libelle: "En attente de sauvegarde cloud", envoyeLe: null, expireLe: null, expireDansJours: null }),
    objet({ nom: "Interview — partie 3.mov", type: "video/quicktime", taille: 812_000_000, statut: "echec", libelle: "Échec de sauvegarde", envoyeLe: null, expireLe: null, expireDansJours: null, erreur: "envoi_abandonne", apercu: false }),
    objet({ nom: "Teaser d'été.mp4", taille: 52_000_000, statut: "expire", libelle: "Expiré", envoyeLe: iso(-31 * JOUR), creeLe: iso(-31 * JOUR), expireLe: iso(-JOUR), expireDansJours: null }),
  ];
  const quota = () => {
    const occ = objets.filter((o) => ["en_attente", "envoi_en_cours", "sauvegarde", "suppression_en_attente"].includes(o.statut));
    const somme = (l) => l.reduce((a, o) => a + o.taille, 0);
    const sauvegarde = somme(occ.filter((o) => o.statut === "sauvegarde"));
    const utilise = S.quotaPlein ? MAX - 40_000_000 : somme(occ);
    return { max: MAX, utilise, reserve: S.quotaPlein ? 0 : somme(occ.filter((o) => o.statut !== "sauvegarde")), sauvegarde: S.quotaPlein ? utilise : sauvegarde, disponible: Math.max(0, MAX - utilise) };
  };
  const refus = (statut, code, message) => { const e = { statut, code, message }; return e; };
  const exigerCloud = () => {
    if (!compte.relie) throw refus(0, "non_relie", "AETHRYON Desktop n'est pas relié au compte (Paramètres › Compte).");
    if (!compte.administrateur) throw refus(403, "forbidden", "AETHRYON Cloud est réservé à l'administrateur.");
    if (!compte.cloud.disponible) throw refus(404, "cloud_closed", "AETHRYON Cloud n'est pas activé sur ce serveur.");
  };
  const transfertsCloud = [];
  const annulations = new Set();
  let nTransferts = 0;
  const avisTransfert = (t) => emettre("cloud-transfert", structuredClone(t));
  const nouveauTransfert = (sens, nom, taille, mediaId, objetId) => {
    const t = { id: `${sens === "envoi" ? "env" : "tel"}-${++nTransferts}`, sens, mediaId, objetId, nom, taille, etape: "attente", fait: 0, total: taille, statut: null, code: null, message: null, chemin: null, creeLe: iso(0), finiLe: null };
    transfertsCloud.push(t);
    avisTransfert(t);
    return t;
  };
  const finir = (t, etape, code, message) => { Object.assign(t, { etape, code, message, finiLe: iso(0) }); avisTransfert(t); };
  /** Avance réelle simulée : par blocs, comme le cœur (avis toutes les ~120 ms) ; s'arrête sur annulation. */
  async function avancer(t, etape, total, pas, ms, coupure = null) {
    Object.assign(t, { etape, fait: 0, total }); avisTransfert(t);
    for (let fait = 0; fait < total;) {
      await attendre(ms);
      if (annulations.has(t.id)) return "annule";
      fait = Math.min(total, fait + pas);
      if (coupure != null && fait >= coupure) return "coupe";
      t.fait = fait; avisTransfert(t);
    }
    return "ok";
  }
  let fileEnvois = Promise.resolve();
  function envoyer(t, m) {
    fileEnvois = fileEnvois.then(async () => {
      if (annulations.has(t.id)) return finir(t, "annule", "annule", "Annulé.");
      const pas = Math.max(1, Math.round(m.taille / (S.envoiLent ? 40 : 8)));
      if (await avancer(t, "verification", m.taille, m.taille / 2, 60) === "annule") return finir(t, "annule", "annule", "Envoi annulé.");
      if (S.tropGros) return finir(t, "echec", "fichier_trop_volumineux", "Fichier trop volumineux pour le cloud : 2,0 Go au plus par fichier.");
      if (S.quotaPlein) return finir(t, "echec", "quota_atteint", "Espace cloud insuffisant : 0,04 Go libres sur 9,0 Go, il en faut 0,01 Go.");
      const o = objet({ nom: t.nom, type: m.type === "audio" ? "audio/mpeg" : "video/mp4", taille: m.taille, statut: "envoi_en_cours", libelle: "Upload cloud en cours", envoyeLe: null, expireLe: null, expireDansJours: null, creeLe: iso(0) });
      objets.unshift(o);
      t.objetId = o.id;
      const r = await avancer(t, "envoi", m.taille, pas, S.envoiLent ? 140 : 110, S.envoiCoupe ? Math.round(m.taille * 0.42) : null);
      if (r !== "ok") {
        objets.splice(objets.indexOf(o), 1);
        return r === "annule" ? finir(t, "annule", "annule", "Envoi annulé.") : finir(t, "echec", "envoi_interrompu", "Envoi interrompu : Connexion interrompue pendant le téléchargement.");
      }
      Object.assign(t, { etape: "confirmation", fait: 0, total: 0 }); avisTransfert(t);
      await attendre(450);
      Object.assign(o, { statut: "sauvegarde", libelle: "Sauvegardé", envoyeLe: iso(0), expireLe: iso(30 * JOUR), expireDansJours: 30 });
      t.statut = "sauvegarde";
      finir(t, "termine", null, "Sauvegardé · expire dans 30 jours");
    });
  }
  async function telecharger(t, o) {
    if (S.lienExpire) { await attendre(200); return finir(t, "echec", "lien_refuse", "Lien temporaire expiré ou refusé par le stockage : relancez le téléchargement."); }
    const r = await avancer(t, "telechargement", o.taille, Math.max(1, Math.round(o.taille / 10)), 120);
    if (r === "annule") return finir(t, "annule", "annule", "Téléchargement annulé.");
    const pris = medias.some((m) => `${m.nom}.${m.ext}`.toLowerCase() === o.nom.toLowerCase());
    const [souche, ext] = [o.nom.replace(/\.[^.]+$/, ""), (o.nom.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase()];
    const final = pris ? `${souche} (2).${ext}` : o.nom;
    t.chemin = `${DM}\\${final}`;
    nouveaux += 1;
    medias.unshift(M({ id: ("c10d" + String(nouveaux).padStart(36, "0")).slice(0, 40), nom: final.replace(/\.[^.]+$/, ""), ext, type: o.type.startsWith("audio/") ? "audio" : "video", taille: o.taille, chemin: t.chemin, ajouteLe: iso(0) }));
    emettre("changement", "bibliotheque");
    finir(t, "termine", null, `Téléchargé dans le dossier des médias : ${final}`);
  }
  window.__maquette.compte = {
    /** L'utilisateur autorise la demande sur la page d'accord du site : le cœur reçoit la clé, puis relit /moi. */
    autoriser: (admin = true) => {
      if (!compte.appairage) return false;
      compte.appairage.etat = "autorise"; avisCompte();
      setTimeout(() => { compte = relie(admin, false); avisCompte(); }, 350);
      return true;
    },
    /** La clé est révoquée dans « Mes jetons » : la liaison disparaît au prochain appel. */
    revoquer: () => { compte = { ...NON_RELIE, erreur: "L'accès d'AETHRYON Desktop à ton compte a été révoqué : relie-le de nouveau pour continuer." }; avisCompte(); },
    etat: () => structuredClone(compte),
    objets: () => structuredClone(objets),
  };
  const commandesCloud = {
    compte_etat: () => structuredClone(compte),
    compte_relier: async () => {
      await attendre(120);
      compte = { ...compte, erreur: null, appairage: { codeUtilisateur: "BCDF-GHJK", url: "https://raccourci.malvu.fr/desktop/connecter?code=BCDF-GHJK", expireLe: iso(10 * 60_000), etat: "en-attente", message: null } };
      if (S.appairage) setTimeout(() => { compte.appairage = { ...compte.appairage, etat: S.appairage, message: S.appairage === "refuse" ? "Liaison refusée sur le site AETHRYON." : "Ce code a expiré : relance la liaison depuis AETHRYON Desktop." }; avisCompte(); }, 700);
      return structuredClone(compte);
    },
    compte_annuler: () => { compte = { ...compte, appairage: null }; return structuredClone(compte); },
    compte_rafraichir: async () => { await attendre(150); compte = { ...compte, verifieLe: iso(0) }; return structuredClone(compte); },
    compte_deconnecter: async () => { await attendre(150); for (const t of transfertsCloud) if (!t.finiLe) annulations.add(t.id); compte = { ...NON_RELIE }; return structuredClone(compte); },
    cloud_etat: async () => { exigerCloud(); await attendre(60); return { actif: true, quota: quota(), retentionJours: 30, tailleMaxFichier: 2e9, sauvegardeAuto: true }; },
    cloud_objets: async ({ filtres }) => {
      exigerCloud();
      await attendre(80);
      const q = (filtres.q || "").toLowerCase();
      let l = objets.filter((o) => o.statut !== "supprime");
      if (!filtres.statut || filtres.statut === "actifs") l = l.filter((o) => o.statut !== "expire");
      else if (filtres.statut === "envois") l = l.filter((o) => ["en_attente", "envoi_en_cours", "echec"].includes(o.statut));
      else l = l.filter((o) => o.statut === filtres.statut);
      if (filtres.type) l = l.filter((o) => o.type.startsWith(`${filtres.type}/`));
      if (q) l = l.filter((o) => o.nom.toLowerCase().includes(q));
      const tri = { recent: (a, b) => b.creeLe.localeCompare(a.creeLe), expiration: (a, b) => (a.expireLe ?? "9").localeCompare(b.expireLe ?? "9"), taille: (a, b) => b.taille - a.taille, nom: (a, b) => a.nom.localeCompare(b.nom, "fr") }[filtres.tri || "recent"];
      l = l.slice().sort(tri);
      return { items: structuredClone(l), total: l.length, page: 1, taillePage: 100, quota: quota() };
    },
    cloud_lien: async ({ id, usage }) => {
      exigerCloud();
      const o = objets.find((x) => x.id === id);
      if (!o) throw refus(404, "not_found", "Fichier introuvable dans ton cloud.");
      if (o.statut === "expire") throw refus(410, "expire", "Ce fichier a expiré : il a été supprimé du cloud.");
      if (o.statut !== "sauvegarde") throw refus(409, "pas_disponible", "Ce fichier n'est pas disponible.");
      await attendre(80);
      return { url: `https://aethryon-cloud.s3.eu-central-003.backblazeb2.com/aethryon-cloud/v1/maquette/${id}?X-Amz-Expires=300&X-Amz-Signature=maquette`, expireLe: iso(5 * 60_000), usage };
    },
    cloud_supprimer: async ({ id }) => {
      exigerCloud();
      const o = objets.find((x) => x.id === id);
      if (!o) throw refus(404, "not_found", "Fichier introuvable dans ton cloud.");
      await attendre(200);
      o.statut = o.statut === "echec" || o.statut === "expire" ? "supprime" : "supprime";
      objets.splice(objets.indexOf(o), 1);
      return { objet: { ...o, libelle: "Supprimé" }, quota: quota() };
    },
    cloud_telecharger: async ({ id }) => {
      exigerCloud();
      const o = objets.find((x) => x.id === id);
      if (!o || o.statut !== "sauvegarde") throw refus(0, "pas_disponible", "Ce fichier n'est pas disponible au téléchargement.");
      const t = nouveauTransfert("telechargement", o.nom, o.taille, null, o.id);
      void telecharger(t, o);
      return structuredClone(t);
    },
    cloud_envoyer: ({ ids }) => {
      exigerCloud();
      const ms = ids.map((i) => medias.find((m) => m.id === i));
      if (ms.some((m) => !m)) throw refus(0, "media", "Média inconnu de la bibliothèque.");
      const indispo = ms.find((m) => m.etat !== "disponible");
      if (indispo) throw refus(0, "media", `« ${indispo.nom} » n'est pas disponible.`);
      return ms.map((m) => {
        const t = nouveauTransfert("envoi", `${m.nom}.${m.ext}`, m.taille, m.id, null);
        if (!/^(mp4|m4v|webm|mov|mkv|mp3|m4a|aac|ogg|opus|wav|flac|gif)$/i.test(m.ext)) { finir(t, "echec", "type_refuse", "Type non accepté par le cloud : vidéo, audio ou GIF seulement."); return structuredClone(t); }
        envoyer(t, m);
        return structuredClone(t);
      });
    },
    cloud_annuler: ({ id }) => { const t = transfertsCloud.find((x) => x.id === id); if (!t || t.finiLe) return false; annulations.add(id); return true; },
    cloud_transferts: () => structuredClone(transfertsCloud),
  };

  // ---- AETHRYON Index (desktop/INDEX.md) : mêmes formes que le cœur (noyau/src/index/), RIEN de réel ici. --------------
  // Scénario : indexVide, scanLent (ms entre deux avis, défaut 180), everything (Everything prêt : progression mesurable),
  // indexErreurs (accès refusés), migrationEchec. window.__maquette.index : etat(), terminer(), debrancher(racine).
  const IX = "D:\\AETHRYON\\Index";
  const go = 1024 ** 3;
  const volIndex = (p) => Object.assign({ lettre: p.racine[0], nom: null, genre: "fixe", systemeFichiers: "NTFS", taille: null, libre: null, disponible: true, message: null,
    serie: "1A2B-3C4D", cle: `serie:${p.racine[0].toLowerCase()}000000`, guid: null, systeme: false, substitue: false, idsFiables: true,
    indexe: { fichiers: 0, video: 0, audio: 0, image: 0, indisponibles: 0, dernierScan: null }, cible: false }, p);
  const volumesIndex = [
    volIndex({ racine: "C:\\", nom: "Windows", systeme: true, taille: 476 * go, libre: 112 * go }),
    volIndex({ racine: "D:\\", nom: "Données", taille: 1863 * go, libre: 1204 * go }),
    volIndex({ racine: "E:\\", nom: "CLÉ USB", genre: "amovible", systemeFichiers: "exFAT", taille: 58 * go, libre: 21 * go, idsFiables: false }),
    volIndex({ racine: "F:\\", genre: "optique", systemeFichiers: null, disponible: false, message: "Aucun média dans le lecteur (lecteur de cartes vide, disque éjecté).", serie: null, cle: "lettre:f", idsFiables: false }),
    volIndex({ racine: "Z:\\", nom: "NAS", genre: "reseau", systemeFichiers: null, disponible: false, message: "Lecteur réseau injoignable.", serie: null, cle: "reseau:z", idsFiables: false }),
  ];
  const reglagesIndex = { schema: 1, cibles: [], types: { video: true, audio: true, image: true },
    extensions: { video: ["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "mpg", "mpeg", "mpe", "m2v", "ts", "mts", "m2ts", "flv", "f4v", "3gp", "3g2", "ogv", "vob", "mxf", "asf", "divx", "rm", "rmvb", "dv"],
      audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "aiff", "aif", "aifc", "wma", "alac", "ape", "wv", "mka", "mpc", "ac3", "caf", "amr"],
      image: ["png", "jpg", "jpeg", "jpe", "jfif", "webp", "gif", "tif", "tiff", "bmp", "dib", "heic", "heif", "avif"] },
    exclusions: ["\\Windows", "\\Program Files", "\\Program Files (x86)", "\\ProgramData", "\\Windows.old", "\\$WinREAgent", "\\$SysReset", "\\$Windows.~BT", "\\$Windows.~WS", "\\Recovery", "\\PerfLogs", "\\Config.Msi", "AppData", "$Recycle.Bin", "System Volume Information", "node_modules", ".git"],
    exclureCaches: true, suivreLiens: false, tailleMin: 0, fils: 2, emplacement: IX, everything: "desactive", surveiller: true, metadonnees: true, miniatures: true };
  const sansAcc = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const bilanVide = () => ({ nouveaux: 0, modifies: 0, renommes: 0, deplaces: 0, supprimes: 0, doublons: 0, inchanges: 0, retrouves: 0, indisponibles: 0, retires: 0 });
  // Médias « scannés » : ids dont le premier chiffre réutilise une miniature d'essai (e2e/fixtures) quand il y en a une.
  const NOMS = [["Rushes — plage au lever", "mp4", "video", "D:\\Vidéos\\Rushes 2024"], ["Interview Élodie (caméra B)", "mov", "video", "D:\\Vidéos\\Rushes 2024"],
    ["Drone — falaises", "mkv", "video", "D:\\Vidéos\\Drone"], ["Ambiance port", "wav", "audio", "D:\\Sons\\Terrain"], ["Mouettes au loin", "flac", "audio", "D:\\Sons\\Terrain"],
    ["Clair de nuit", "mp3", "audio", "C:\\Users\\Élodie\\Music\\Atelier Chouette"], ["IMG_20240712_2104", "jpg", "image", "E:\\DCIM\\100APPLE"],
    ["IMG_20240712_2105", "heic", "image", "E:\\DCIM\\100APPLE"], ["Affiche festival", "png", "image", "D:\\Graphisme"], ["Titre animé", "webm", "video", "D:\\Graphisme\\Exports"]];
  const MINI = { video: ["2", "3", "8", "9", "1"], image: ["4", "9"], audio: [] };
  const elementsIndex = S.vide || S.indexVide ? [] : Array.from({ length: 60 }, (_, i) => {
    const [nom, ext, type, dossier] = NOMS[i % NOMS.length];
    const lot = Math.floor(i / NOMS.length);
    const premier = (MINI[type] || [])[lot % Math.max(1, (MINI[type] || []).length)];
    const id = (premier || "d") + (i + 1).toString(16).padStart(39, "e");
    const vue = type === "video" && ext !== "mkv" && premier;
    return { id, chemin: `${dossier}\\${nom}${lot ? ` (${lot + 1})` : ""}.${ext}`, dossier, nom: `${nom}${lot ? ` (${lot + 1})` : ""}`, ext, type, taille: 1048576 * (3 + (i * 37) % 900),
      modifieLe: ilya(i % 9, 10, i % 60), ajouteLe: ilya(i % 4, 9, i % 60), duree: type === "image" ? null : 8 + (i * 13) % 600, largeur: type === "audio" ? null : 1920, hauteur: type === "audio" ? null : 1080,
      ips: type === "video" ? 25 : null, codecVideo: type === "video" ? (ext === "mkv" ? "hevc" : "h264") : null, codecAudio: type === "image" ? null : (ext === "flac" ? "flac" : "aac"),
      titre: nom === "Clair de nuit" ? "Clair de nuit" : null, artistes: nom === "Clair de nuit" ? ["Atelier Chouette"] : [], album: nom === "Clair de nuit" ? "Nocturnes" : null, annee: nom === "Clair de nuit" ? 2024 : null,
      miniature: vue || (type === "image" && premier) ? `${IX}\\miniatures\\${id}.jpg` : null,
      etatMiniature: vue || (type === "image" && premier) ? "faite" : ext === "heic" ? "impossible" : type === "video" ? "webview" : "impossible",
      etat: dossier.startsWith("E:") && S.debranche ? "indisponible" : "present", etatBibliotheque: null, sources: ["index"], volume: dossier.slice(0, 3),
      doublons: i === 3 ? 1 : 0, doublonDe: null, enLigne: i === 7, premiereCompatible: ["mp4", "mov", "wav", "mp3", "jpg", "png"].includes(ext) };
  });
  for (const m of elementsIndex) if (m.miniature) window.__MINIATURES__[m.id] = MINIATURES_PAR_PREMIER[m.id[0]];
  const depuisBibliotheque = (m) => ({ id: m.id, chemin: m.chemin, dossier: m.chemin.replace(/\\[^\\]+$/, ""), nom: m.nom, ext: m.ext, type: m.type, taille: m.taille, modifieLe: m.modifieLe, ajouteLe: m.ajouteLe,
    duree: m.duree, largeur: m.largeur, hauteur: m.hauteur, ips: m.ips, codecVideo: m.codecVideo, codecAudio: m.codecAudio, titre: null, artistes: [], album: null, annee: null,
    miniature: m.miniature ? `${R}\\bibliotheque\\${m.miniature.replace(/\//g, "\\")}` : null, etatMiniature: m.miniature ? "faite" : "a-faire",
    etat: m.etat === "introuvable" ? "absent" : "present", etatBibliotheque: m.etat, sources: ["bibliotheque"], volume: m.chemin.slice(0, 3), doublons: 0, doublonDe: null, enLigne: false, premiereCompatible: m.premiereCompatible });
  const totauxIndex = () => {
    const l = elementsIndex.filter((e) => e.etat !== "absent" && !e.doublonDe);
    const n = (t) => l.filter((e) => e.type === t).length;
    return { video: n("video"), audio: n("audio"), image: n("image"), total: l.length, indisponibles: l.filter((e) => e.etat === "indisponible").length, absents: 0,
      doublons: 1, metadonneesAFaire: 0, miniaturesAFaire: 0, dossiers: new Set(l.map((e) => e.dossier)).size };
  };
  for (const v of volumesIndex) {
    const l = elementsIndex.filter((e) => e.volume === v.racine);
    v.indexe = { fichiers: l.length, video: l.filter((e) => e.type === "video").length, audio: l.filter((e) => e.type === "audio").length, image: l.filter((e) => e.type === "image").length,
      indisponibles: l.filter((e) => e.etat === "indisponible").length, dernierScan: l.length ? hier(23, 10) : null };
  }
  let scanIndex = null;
  let dernierResume = elementsIndex.length ? { scan: 7, etat: "termine", mode: "natif", debut: hier(23, 2), fin: hier(23, 10), dureeMs: 482000, cibles: ["C:\\", "D:\\"],
    medias: { video: 24, audio: 18, image: 18 }, totalMedias: 60, fichiersVus: 412880, dossiers: 38211, octets: 812 * go, erreurs: 2,
    erreursListe: [{ chemin: "C:\\Users\\Élodie\\AppData\\Local\\Packages", message: "Accès refusé par le système." }, { chemin: "D:\\Ancien\\Système", message: "Accès refusé par le système." }],
    liensIgnores: 14, exclus: 5120, bouclesEvitees: 0, bilan: { ...bilanVide(), nouveaux: 60 }, volumesIndisponibles: [], message: null, debit: 856.6 } : null;
  let numeroScan = 7;
  const etatIndex = () => ({ scan: scanIndex ? structuredClone(scanIndex.p) : null, dernier: structuredClone(dernierResume), interrompu: null, totaux: totauxIndex(), emplacement: reglagesIndex.emplacement,
    tailleIndex: 38 * 1048576, enrichissement: { phase: "repos", fait: 0, total: 0, actif: false },
    everything: S.everything ? { disponible: true, version: "1.4.1.1024", baseChargee: true, raison: null } : { disponible: false, version: null, baseChargee: false, raison: reglagesIndex.everything === "auto" ? "Everything n'est pas lancé." : "Mode Everything désactivé dans les réglages." },
    modeEverything: reglagesIndex.everything, veille: reglagesIndex.cibles.filter((c) => c.genre === "dossier").map((c) => c.chemin), migration: false });
  const finirScan = (etat) => {
    if (!scanIndex) return false;
    clearInterval(scanIndex.t);
    const p = scanIndex.p;
    p.phase = "termine";
    emettre("index-progression", structuredClone(p));
    dernierResume = { scan: p.scan, etat, mode: p.mode, debut: scanIndex.debut, fin: new Date().toISOString(), dureeMs: p.ecouleMs, cibles: p.cibles, medias: { ...p.medias },
      totalMedias: p.medias.video + p.medias.audio + p.medias.image, fichiersVus: p.fichiersVus, dossiers: p.dossiers, octets: p.octets, erreurs: p.erreurs,
      erreursListe: S.indexErreurs ? [{ chemin: "C:\\Users\\Élodie\\AppData\\Local\\Packages", message: "Accès refusé par le système." }] : [], liensIgnores: p.liensIgnores, exclus: p.exclus,
      bouclesEvitees: 0, bilan: { ...p.bilan }, volumesIndisponibles: scanIndex.indispo, message: null, debit: p.debit };
    scanIndex = null;
    emettre("index-fin", structuredClone(dernierResume));
    emettre("index-changement", "index");
    return true;
  };
  window.__maquette.index = { etat: etatIndex, terminer: () => finirScan("termine"), debrancher: (racine) => { const v = volumesIndex.find((x) => x.racine === racine); if (v) { v.disponible = false; v.message = "Aucun média dans le lecteur."; } for (const e of elementsIndex) if (e.volume === racine) e.etat = "indisponible"; emettre("index-changement", "index"); } };
  const filtrerIndex = (r, sourcesDefaut) => {
    const q = sansAcc(r.texte || "").split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m));
    const sources = r.sources && r.sources.length ? r.sources : sourcesDefaut;
    const etats = r.etats && r.etats.length ? r.etats : ["present", "indisponible"];
    let l = elementsIndex.concat(medias.map(depuisBibliotheque)).filter((e) => e.sources.some((s) => sources.includes(s)) && etats.includes(e.etat) && (r.doublons || !e.doublonDe));
    if (r.types && r.types.length) l = l.filter((e) => r.types.includes(e.type));
    if (r.volumes && r.volumes.length) l = l.filter((e) => r.volumes.some((v) => sansAcc(v) === sansAcc(e.volume || "")));
    if (r.dossier) l = l.filter((e) => sansAcc(e.dossier) === sansAcc(r.dossier) || sansAcc(e.dossier).startsWith(sansAcc(r.dossier).replace(/\\$/, "") + "\\"));
    if (r.tailleMin != null) l = l.filter((e) => e.taille >= r.tailleMin);
    if (r.tailleMax != null) l = l.filter((e) => e.taille <= r.tailleMax);
    if (q.length) l = l.filter((e) => { const mots = sansAcc(`${e.nom}.${e.ext} ${e.titre || ""} ${e.artistes.join(" ")} ${e.album || ""}${r.dansChemin ? " " + e.dossier : ""}`).split(/[^\p{L}\p{N}]+/u); return q.every((m) => mots.some((x) => x.startsWith(m))); });
    const tri = r.tri || "ajout";
    const cle = { ajout: (e) => e.ajouteLe, nom: (e) => sansAcc(e.nom), taille: (e) => e.taille, date: (e) => e.modifieLe, duree: (e) => e.duree ?? -1, chemin: (e) => sansAcc(e.chemin), type: (e) => e.type }[tri];
    const desc = r.ordre ? r.ordre === "desc" : ["ajout", "taille", "date", "duree"].includes(tri);
    l.sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0) * (desc ? -1 : 1));
    const taillePage = Math.min(500, Math.max(1, r.taillePage || 100));
    const page = Math.max(1, r.page || 1);
    return { elements: structuredClone(l.slice((page - 1) * taillePage, page * taillePage)), total: l.length, page, taillePage, pages: Math.max(1, Math.ceil(l.length / taillePage)), dureeMs: 0.8 };
  };
  const commandesIndex = {
    index_volumes: async () => { await attendre(120); return structuredClone(volumesIndex.map((v) => ({ ...v, cible: reglagesIndex.cibles.some((c) => c.genre === "volume" && c.chemin === v.racine) }))); },
    index_reglages: () => structuredClone(reglagesIndex),
    index_reglages_modifier: ({ modif }) => {
      for (const [k, v] of Object.entries(modif)) {
        if (!(k in reglagesIndex) || k === "emplacement" || k === "schema") throw `Réglage inconnu : « ${k} »`;
        reglagesIndex[k] = typeof v === "object" && !Array.isArray(v) && v ? Object.assign({}, reglagesIndex[k], v) : v;
      }
      emettre("index-changement", "reglages");
      return structuredClone(reglagesIndex);
    },
    index_scan_lancer: async ({ cibles }) => {
      if (scanIndex) throw "Un scan est déjà en cours.";
      const c = cibles ?? reglagesIndex.cibles;
      if (!c.length) throw "Choisis au moins un dossier ou un disque à scanner.";
      const racines = c.flatMap((x) => (x.genre === "tous" ? volumesIndex.filter((v) => v.disponible && ["fixe", "amovible"].includes(v.genre)).map((v) => v.racine) : [x.chemin]));
      const indispo = racines.filter((r) => volumesIndex.some((v) => v.racine === r && !v.disponible)).map((r) => `${r} (${volumesIndex.find((v) => v.racine === r).message})`);
      numeroScan += 1;
      const mode = S.everything && reglagesIndex.everything === "auto" ? "everything" : "natif";
      const p = { scan: numeroScan, phase: "preparation", mode, cibles: racines, fichiersVus: 0, dossiers: 0, medias: { video: 0, audio: 0, image: 0 }, octets: 0, erreurs: 0, liensIgnores: 0, exclus: 0,
        bouclesEvitees: 0, bilan: bilanVide(), mesurable: mode === "everything", fraction: mode === "everything" ? 0 : null, dossierCourant: null, debit: 0, ecouleMs: 0 };
      const debut = Date.now();
      let tour = 0;
      const t = setInterval(() => {
        tour += 1;
        p.phase = mode === "everything" ? "everything" : tour > 22 ? "rapprochement" : "parcours";
        p.fichiersVus += 1830 + (tour % 5) * 211;
        p.dossiers += 140 + (tour % 3) * 17;
        p.medias.video += 3 + (tour % 4);
        p.medias.audio += 2 + (tour % 3);
        p.medias.image += 9 + (tour % 6);
        p.octets += 380 * 1048576;
        p.erreurs = S.indexErreurs ? Math.floor(tour / 8) : 0;
        p.exclus += 12;
        p.liensIgnores = Math.floor(tour / 6);
        p.bilan.nouveaux = p.medias.video + p.medias.audio + p.medias.image;
        p.dossierCourant = `${racines[0] || "C:\\"}Users\\Élodie\\Vidéos\\Rushes ${2020 + (tour % 5)}\\Jour ${tour}`;
        p.ecouleMs = Date.now() - debut;
        p.debit = Math.round((p.fichiersVus / Math.max(0.001, p.ecouleMs / 1000)) * 10) / 10;
        if (mode === "everything") p.fraction = Math.min(1, tour / 20);
        emettre("index-progression", structuredClone(p));
        if (tour >= 25) finirScan("termine");
      }, S.scanLent || 180);
      scanIndex = { p, t, debut: new Date(debut).toISOString(), indispo };
      return numeroScan;
    },
    index_scan_annuler: () => finirScan("annule"),
    index_etat: async () => { await attendre(40); return etatIndex(); },
    index_resume: ({ scan }) => (scan == null || (dernierResume && dernierResume.scan === scan) ? structuredClone(dernierResume) : null),
    index_rechercher: async ({ requete }) => { await attendre(30); return filtrerIndex(requete, ["index", "everything"]); },
    bibliotheque_requete: async ({ requete }) => { await attendre(30); return filtrerIndex(requete, ["index", "everything", "bibliotheque"]); },
    index_media_action: ({ id }) => { if (!elementsIndex.some((e) => e.id === id) && !medias.some((m) => m.id === id)) throw "Média inconnu de l'index."; return null; },
    index_apercu: ({ id }) => { const e = elementsIndex.find((x) => x.id === id); if (!e) throw "Média inconnu de l'index."; if (e.etat !== "present") throw "Ce média n'est pas disponible (disque débranché ou fichier supprimé)."; return e.chemin; },
    index_miniatures_demander: ({ ids }) => elementsIndex.filter((e) => ids.includes(e.id) && e.etatMiniature === "webview" && e.etat === "present").slice(0, 16).map((e) => ({ id: e.id, chemin: e.chemin, type: e.type, ext: e.ext })),
    index_analyse_enregistrer: ({ id, analyse }) => { const e = elementsIndex.find((x) => x.id === id); if (e) { e.etatMiniature = analyse.echec ? "echec" : e.etatMiniature; e.duree = e.duree ?? analyse.duree ?? null; } emettre("index-changement", "index"); return null; },
    index_emplacement_deplacer: async ({ chemin }) => {
      if (scanIndex) throw "Un scan est en cours : annule-le ou attends sa fin avant de déplacer l'index.";
      for (const [etape, fait, total] of [["base", 0, 1], ["miniatures", 600, 1200], ["miniatures", 1200, 1200], ["verification", 0, 1], ["bascule", 0, 1]]) { emettre("index-migration", { etape, fait, total, message: null }); await attendre(120); }
      if (S.migrationEchec) { const message = `« ${chemin} » n'est pas vide : choisis un dossier vide (ou un nouveau dossier).`; emettre("index-migration", { etape: "erreur", fait: 0, total: 0, message }); throw message; }
      reglagesIndex.emplacement = chemin;
      emettre("index-migration", { etape: "termine", fait: 1, total: 1, message: null });
      emettre("index-changement", "reglages");
      return chemin;
    },
    index_everything: () => etatIndex().everything,
    index_retirer: ({ chemin }) => { const n = elementsIndex.filter((e) => sansAcc(e.chemin).startsWith(sansAcc(chemin))).length; emettre("index-changement", "index"); return n; },
  };

  const commandes = {
    ...commandesCloud,
    ...commandesIndex,
    // 3.8.1 « Coller un lien » : le cœur appelle ytapi avec la clé du compte relié ; ici, un transfert est créé.
    convertir_lien: async ({ url, format }) => {
      await attendre(160);
      if (!compte.relie) throw "Reliez d'abord AETHRYON Desktop à votre compte.";
      if (S.conversionRefusee) throw S.conversionRefusee;
      const t = { schema: 1, id: `conv-${Date.now()}`, titre: url, plateforme: /tiktok/.test(url) ? "tiktok" : /x\.com|twitter/.test(url) ? "x" : "youtube", format, etat: "attente", progression: null,
        fichierAttendu: null, chemin: null, erreur: null, majLe: new Date().toISOString(), origine: "desktop" };
      etat.transferts.unshift(t);
      emettre("changement", "transferts");
      return structuredClone(t);
    },
    // Une COPIE à chaque lecture, comme le cœur (sérialisation) : l'interface voit chaque changement.
    // Scénario etatLent (ms) : la PREMIÈRE lecture de l'état tarde, pour voir l'écran de démarrage (e2e/demarrage-zone.mjs).
    etat: async () => { if (S.etatLent) { const t = S.etatLent; S.etatLent = 0; await attendre(t); } return structuredClone(etat); },
    mode_lancement: () => S.mode,
    fenetre_prete: () => null, fenetre: () => null, mode_fenetre: () => null,
    // Menu de la zone de notification (zone-menu.html) : la maquette garde la taille mesurée par la page.
    zone_menu_pret: ({ largeur, hauteur }) => { window.__maquette.zone = { largeur, hauteur }; return null; },
    zone_menu_fermer: () => null, zone_menu_choisir: () => null,
    config_modifier: ({ modif }) => { for (const [k, v] of Object.entries(modif)) etat.config[k] = typeof v === "object" && !Array.isArray(v) ? Object.assign({}, etat.config[k], v) : v; return etat.config; },
    choisir_dossier: () => null, choisir_fichiers: () => [], choisir_premiere: () => null,
    media_action: () => null,
    importer: ({ ids }) => { envois += 1; const nom = `20261018T030000000Z-maquette-i${envois}.json`; setTimeout(() => resultatCommande({ nom, action: "importer", ids, ok: true, message: `${ids.length} média importé dans le chutier AETHRYON (Montage-voyage).`, le: new Date().toISOString() }), 900); return nom; },
    // Analyse RÉELLE par le code de l'application (Analyseur.tsx) sur les fichiers audio d'essai : formes d'onde.
    // Comme le cœur : `max` éléments par appel ; les médias synthétiques (essais de charge) ne sont jamais à analyser.
    a_analyser: ({ max = 4 } = {}) => { if (S.vide) return []; const a = medias.filter((m) => m.type === "audio" && !m.id.startsWith("e55a") && !analyses.has(m.id)).slice(0, max).map((m) => ({ id: m.id, chemin: m.chemin, type: m.type, ext: m.ext })); a.forEach((x) => analyses.add(x.id)); return a; },
    analyse_enregistrer: async ({ id, analyse, jpeg }) => {
      const m = medias.find((x) => x.id === id);
      if (m && jpeg) { await fetch(`http://asset.localhost/__depot/${id}`, { method: "POST", body: jpeg }); m.miniature = `miniatures/${id}.jpg`; m.modifieLe = new Date().toISOString(); }
      if (m && analyse.duree && !m.duree) m.duree = analyse.duree;
      setTimeout(() => emettre("changement", "bibliotheque"), 10);
      return null;
    }, ajouter_fichiers: () => [],
    dossier_ajouter: ({ chemin }) => { if (!etat.config.dossiersSurveilles.includes(chemin)) etat.config.dossiersSurveilles.push(chemin); emettre("changement", "config"); return null; },
    dossier_retirer: () => null,
    transferts_effacer: () => 2, rescanner: () => null, redetecter: () => null,
    transfert_piloter: async ({ id, action }) => {
      await attendre(60);
      const t = etat.transferts.find((x) => x.id === id);
      if (!t || !etat.transfertsPilotables.includes(id)) throw "Ce transfert ne se pilote pas depuis AETHRYON Desktop (reçu par le navigateur, ou déjà terminé).";
      if (action === "pause") {
        if (t.etat !== "telechargement") throw "La pause n'est possible que pendant la réception du fichier : la conversion a lieu sur le serveur.";
        Object.assign(t, { pause: true, vitesse: undefined });
      } else if (action === "reprendre") {
        // Reprise : la suite du fichier arrive (un pas d'essai, pour voir l'avancée reprendre).
        const recus = Math.min(t.total, t.recus + Math.round(t.total * 0.1));
        Object.assign(t, { pause: undefined, recus, progression: recus / t.total, vitesse: 2_980_000 });
      } else if (action === "annuler") {
        Object.assign(t, { etat: "erreur", code: "annule", erreur: "Annulé à ta demande.", progression: null, vitesse: undefined, pause: undefined });
        etat.transfertsPilotables = etat.transfertsPilotables.filter((x) => x !== id);
      } else throw "Action de transfert inconnue.";
      t.majLe = new Date().toISOString();
      setTimeout(() => emettre("changement", "transferts"), 10);
      return null;
    },
    diagnostic: async () => { await attendre(150); return { premiere: etat.premiere, creativeCloud: etat.creativeCloud, panneau: etat.panneauCep, panneauPresent: !!etat.panneauCep, dossierDefaut: DM, espaceLibre: 182 * 1024 ** 3, dureeMs: 1180, plateforme: "windows" }; },
    assistant_executer: installer, assistant_annuler: () => null, assistant_fin: () => null,
    ouvrir_premiere: () => null, panneau_desinstaller: () => ({ ok: true, code: 0, message: "Panneau retiré par Creative Cloud.", sortie: "" }),
    ouvrir_dossier: () => null, rapport_exporter: () => null, lancer_desinstalleur: () => null, quitter: () => null,
    webview2: () => "141.0.3537.71",
    maj_rechercher: () => ({ actuelle: "1.0.0-beta.4", disponible: false, annonce: { version: "1.0.0-beta.4", fichier: "AETHRYON-Setup-2.0.0-beta.3.exe", sha256: "0".repeat(64), taille: 1, publiee: "2026-10-21", notes: [] } }),
    // Flux (glisser-déposer) : mêmes réponses que le cœur, sans aucun fichier réel.
    glisser_medias: ({ ids }) => {
      if (glisserEnCours) throw "Un glisser est déjà en cours.";
      if (!ids.length || ids.length > 200) throw "Sélection vide ou trop grande (200 médias au plus).";
      const ms = ids.map((id) => medias.find((m) => m.id === id));
      if (ms.some((m) => !m)) throw "Média inconnu de la bibliothèque.";
      const indispo = ms.find((m) => m.etat !== "disponible");
      if (indispo) throw `« ${indispo.nom} » n'est pas disponible.`;
      jetons += 1;
      glisserEnCours = { jeton: `g-maquette-${jetons}`, ids: [...ids], chemins: ms.map((m) => m.chemin) };
      return { jeton: glisserEnCours.jeton, chemins: glisserEnCours.chemins };
    },
    glisser_annuler: () => terminerGlisser("annule", "inconnue", null, "Annulé par AETHRYON.", true),
    flux_classer: ({ chemins }) => classer(chemins),
    importer_fichiers: importerFichiers,
    importer_annuler: ({ lot }) => { const l = lots.get(lot); if (l) l.annule = true; return !!l; },
    envoyer_vers_premiere: ({ ids }) => {
      if (S.premiereDeconnecte) return { etat: "non-connecte", message: "Premiere Pro n'est pas connecté : ouvrez le panneau AETHRYON dans Premiere Pro. Rien n'a été envoyé.", age: null };
      envois += 1;
      const nom = `20261023T200000000Z-maquette-${envois}.json`;
      const le = new Date().toISOString();
      const r = S.envoiExpire ? { ok: false, expire: true, message: "Expirée : le panneau AETHRYON n'a pas répondu en 2 minutes (Premiere fermé, aucun projet ouvert ou panneau caché)." }
        : S.envoiEchec ? { ok: false, expire: false, message: "Aucun projet ouvert : ouvrez ou créez un projet dans Premiere Pro pour importer" }
        : { ok: true, expire: false, message: `${ids.length} importé${ids.length > 1 ? "s" : ""} dans « AETHRYON » (Montage-voyage)` };
      setTimeout(() => resultatCommande(Object.assign({ nom, action: "importer", ids, le }, r)), S.delaiPanneau);
      return { etat: "envoye", nom };
    },
    "plugin:event|listen": ({ event, handler }) => { const l = ecouteurs.get(event) || []; l.push(handler); ecouteurs.set(event, l); return handler; },
    "plugin:event|unlisten": ({ event, eventId }) => { const l = ecouteurs.get(event) || []; const i = l.indexOf(eventId); if (i >= 0) l.splice(i, 1); rappels.delete(eventId); return null; },
    "plugin:event|emit": ({ event, payload }) => { emettre(event, payload); return null; },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    plugins: {},
    transformCallback: (f) => { const id = n++; rappels.set(id, f); return id; },
    unregisterCallback: (id) => rappels.delete(id),
    convertFileSrc: (chemin, protocole = "asset") => `http://${protocole}.localhost/${encodeURIComponent(chemin)}`,
    invoke: async (cmd, args = {}) => {
      if (!cmd.startsWith("plugin:")) window.__maquette.appels.push(cmd);
      const f = commandes[cmd];
      if (!f) throw `Commande inconnue de la maquette : ${cmd}`;
      return f(args);
    },
  };
})();
