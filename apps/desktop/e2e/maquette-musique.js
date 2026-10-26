// MAQUETTE des commandes musique_* du cœur (commandes_musique.rs) pour le banc Playwright : chargée APRÈS
// maquette-tauri.js, elle intercepte invoke() pour ces commandes seulement. Formes EXACTES du cœur et d'AETHRYON Music
// (cloud-music/MUSIC-API.md). Rien n'est réel ici : pas de réseau, pas d'étiquettes lues (les fiches sont écrites ici),
// pas de serveur ; les sons et pochettes sont des fichiers d'essai produits par ffmpeg (sinusoïdes, dégradés).
// La logique réelle est essayée par `cargo test` (noyau/src/musique) et par les essais d'account (relais, 015).
// Scénario (window.__SCENARIO__) : musique (bibliothèque remplie), musiqueVide, musiqueFerme (relais coupé : 404),
// importLentMusique, importEchec, cloudMusique (objets musicaux du cloud, dont un expiré).
(() => {
  const S = window.__SCENARIO__ || {};
  const M = window.__maquette;
  const DM = "C:\\Users\\Élodie\\Videos\\AETHRYON";
  const R = "C:\\Users\\Élodie\\AppData\\Local\\AETHRYON";
  const hexm = (n) => (n.toString(16).padStart(2, "0") + "c").repeat(14).slice(0, 40);
  const jour = 86_400_000;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const q = (p) => Object.assign({ codec: "mp3", conteneur: "mp3", debitKbps: 320, frequenceHz: 44100, bits: null, canaux: 2, sansPerte: false }, p);
  const POCH = (i) => `${"abcdef0123456789".repeat(2).slice(i, i + 31)}${i}.jpg`.replace(/^(.{32}).*\.jpg$/, "$1.jpg");
  const pochettes = {};
  // Bibliothèque d'essai : albums et morceaux fictifs (artistes d'essai), qualités variées, un fichier sans étiquette.
  const def = S.musiqueVide ? [] : [
    ["Clair de nuit", ["Atelier Chouette"], "Nocturnes", 1, 2024, 214, q({ codec: "flac", conteneur: "flac", debitKbps: 2200, frequenceHz: 96000, bits: 24, sansPerte: true }), 1, "accord"],
    ["Ivoire", ["Atelier Chouette", "Invité"], "Nocturnes", 2, 2024, 187, q({ codec: "flac", conteneur: "flac", debitKbps: 1100, frequenceHz: 44100, bits: 16, sansPerte: true }), 1, "nappe"],
    ["Obsidienne", ["Atelier Chouette"], "Nocturnes", 3, 2024, 242, q({ codec: "flac", conteneur: "flac", debitKbps: 2100, frequenceHz: 96000, bits: 24, sansPerte: true }), 1, "accord"],
    ["Lumière champagne", ["Atelier Chouette"], "Nocturnes", 4, 2024, 199, q({ codec: "flac", conteneur: "flac", debitKbps: 1000, frequenceHz: 44100, bits: 16, sansPerte: true }), 1, "nappe"],
    ["Marée basse", ["Or Clair"], "Littoral", 1, 2023, 176, q({ debitKbps: 256 }), 2, "nappe"],
    ["Les falaises", ["Or Clair"], "Littoral", 2, 2023, 203, q({ debitKbps: 256 }), 2, "accord"],
    ["Phare", ["Or Clair"], "Littoral", 3, 2023, 158, q({ debitKbps: 256 }), 2, "nappe"],
    ["Gymnopédie n° 1 (essai)", ["Archive libre"], "Pièces libres", 1, 1888, 191, q({ codec: "vorbis", conteneur: "ogg", debitKbps: 160 }), 3, "accord"],
    ["Pavane d'essai", ["Archive libre"], "Pièces libres", 2, 1899, 222, q({ codec: "opus", conteneur: "ogg", debitKbps: 128, frequenceHz: 48000 }), 3, "nappe"],
    ["Brume", ["Sable"], "Saisons", 1, 2022, 241, q({ codec: "aac", conteneur: "mp4", debitKbps: 256 }), 4, "accord"],
    ["Givre", ["Sable"], "Saisons", 2, 2022, 213, q({ codec: "alac", conteneur: "mp4", debitKbps: 900, bits: 16, sansPerte: true }), 4, "nappe"],
    ["Nuit d'été", ["Velours"], "Velours", 1, 2021, 264, q({ debitKbps: 192 }), 5, "accord"],
    ["Ressac", ["Velours"], "Velours", 2, 2021, 230, q({ debitKbps: 192 }), 5, "nappe"],
    ["Terre cuite", ["Ocre"], null, null, 2020, 182, q({ codec: "pcm", conteneur: "wav", debitKbps: 1411, bits: 16, sansPerte: true }), 6, "accord"],
    ["memo-studio-03", [], null, null, null, 61, q({ codec: "pcm", conteneur: "wav", debitKbps: 705, frequenceHz: 44100, bits: 16, canaux: 1, sansPerte: true }), null, "nappe"],
  ];
  const pistes = def.map(([titre, artistes, album, numero, annee, dureeS, qualite, poch, son], i) => {
    const id = hexm(i + 1);
    const pn = poch ? `${String(poch).repeat(32)}.jpg` : null;
    if (pn) pochettes[pn] = `poch${poch}.jpg`;
    const ext = { flac: "flac", vorbis: "ogg", opus: "opus", aac: "m4a", alac: "m4a", pcm: "wav" }[qualite.codec] || "mp3";
    const nom = artistes.length ? `${artistes[0]} - ${titre}` : titre;
    M.etat.index.medias.push({ id, chemin: `${DM}\\Musique\\${nom}.${ext}`, nom, ext, type: "audio", taille: Math.round(dureeS * (qualite.debitKbps || 256) * 125), ajouteLe: iso(-(i + 1) * 3_600_000 * 7), modifieLe: iso(-jour * 3),
      duree: dureeS, largeur: null, hauteur: null, ips: null, codecVideo: null, codecAudio: qualite.codec, miniature: null, etat: "disponible", premiereCompatible: true, origine: { plateforme: "local", titre: null } });
    return { id, titre, artistes, album, artisteAlbum: album ? artistes[0] : null, numero, disque: album ? 1 : null, annee, genre: null, isrc: i === 0 ? "FRZZZ2400002" : null, dureeS, qualite, pochette: pn,
      etiquetage: artistes.length ? "ok" : "absentes", empreinte: "x", son,
      provenance: i === 7 ? { connecteur: "archive", sourceUrl: "https://archive.org/details/essai-gymnopedie", licence: { code: "cc0", nom: "CC0 1.0 (domaine public)", libre: true }, attribution: "« Gymnopédie n° 1 (essai) », CC0, via Internet Archive", attestation: false, importId: "mus_essai", importeLe: iso(-2 * jour), cloud: { etat: "sauvegarde", libelle: "Sauvegardé" } } : undefined };
  });
  window.__POCHETTES__ = pochettes;
  window.__SONS__ = Object.fromEntries(pistes.map((p) => [M.etat.index.medias.find((m) => m.id === p.id).chemin, p.son]));
  let playlists = S.musiqueVide ? [] : [
    { id: "pl_" + "a".repeat(32), nom: "Montage — ambiances", pistes: [pistes[1].id, pistes[4].id, pistes[8].id, pistes[12].id, pistes[9].id], creeLe: iso(-5 * jour), modifieLe: iso(-jour) },
    { id: "pl_" + "b".repeat(32), nom: "Soirée Nocturnes", pistes: [pistes[0].id, pistes[2].id, pistes[3].id], creeLe: iso(-3 * jour), modifieLe: iso(-2 * jour),
      source: { connecteur: "spotify", url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", titre: "Playlist Spotify (essai)", snapshot: "s1", synchroniseeLe: iso(-2 * jour),
        sansFichier: [{ position: 2, titre: "Titre commercial A", artistes: ["Artiste A"], dureeS: 201 }, { position: 5, titre: "Titre commercial B", artistes: ["Artiste B"], dureeS: 189 }] } },
  ];
  let historique = S.musiqueVide ? [] : [
    { id: "h_1", quand: iso(-2 * jour), action: "import", url: "https://archive.org/details/essai-gymnopedie", connecteur: "archive", titre: "Gymnopédie n° 1 (essai)", artistes: ["Archive libre"], pochette: null, etat: "termine", importId: "mus_essai", mediaId: pistes[7]?.id ?? null, erreur: null },
    { id: "h_2", quand: iso(-3 * jour), action: "import", url: "https://exemple.fr/podcast/episode-12.mp3", connecteur: "fichier", titre: "Épisode 12 (essai)", artistes: [], pochette: null, etat: "echec", importId: "mus_e2", mediaId: null, erreur: "Le fichier n'est pas un fichier audio." },
  ];
  let fiches = [];
  let lecture = S.musiqueVide ? { file: [], index: 0, positionS: 0, aleatoire: false, repetition: "non", volume: 0.8, majLe: "" }
    : { file: [pistes[4].id, pistes[5].id, pistes[6].id].map((x) => `loc:${x}`), index: 1, positionS: 14.5, aleatoire: false, repetition: "non", volume: 0.7, majLe: iso(-jour) };
  const imports = [];
  const refus = (statut, code, message) => ({ statut, code, message });
  let interne = null;
  const compteEtat = async () => (interne ? interne("compte_etat") : null);
  const relayer = async () => {
    const c = await compteEtat();
    if (c && !c.relie) throw refus(0, "non_relie", "Reliez AETHRYON Desktop à votre compte (Paramètres › Compte) pour analyser et importer.");
    if (S.musiqueFerme) throw refus(404, "music_closed", "AETHRYON Music n'est pas ouvert sur ce serveur.");
  };
  const FICHES = {
    spotify: { connecteur: "spotify", type: "titre", id: "4uLU6hMCjMI75M1A2tKUQC", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", etat: "identifie", titre: "Titre commercial (essai)", artistes: [],
      pochette: "https://i.scdn.co/image/essai-maquette", capacites: ["Metadata", "Playback"], sourceMetadonnees: "oembed",
      actions: [{ id: "ouvrir", libelle: "Ouvrir dans Spotify", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }, { id: "lecteur_officiel", embed: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", hauteur: 152, note: "Lecteur officiel de Spotify : extrait ou titre complet selon le compte Spotify de l'auditeur." }, { id: "enregistrer_lien", executePar: "client" }],
      restrictions: ["Spotify n'autorise aucun téléchargement : lecture par le lecteur officiel ou dans Spotify."], manque: ["Artiste, durée et ISRC : il faut l'application Spotify du propriétaire (identifiants non saisis)."], avertissements: [] },
    apple: { connecteur: "apple", type: "titre", url: "https://music.apple.com/fr/album/essai/1?i=2", etat: "identifie", titre: "Morceau Apple Music (essai)", artistes: ["Artiste d'essai"], album: "Album d'essai", dureeS: 212, pochette: "https://is1-ssl.mzstatic.com/image/essai-maquette.jpg",
      capacites: ["Metadata", "Search", "Preview", "Playback"], sourceMetadonnees: "itunes",
      actions: [{ id: "ouvrir", libelle: "Ouvrir dans Apple Music", url: "https://music.apple.com/fr/album/essai/1?i=2" }, { id: "apercu", url: "https://audio-ssl.itunes.apple.com/essai-maquette.m4a", dureeS: 30, libelle: "Aperçu de 30 s", mention: "Aperçu fourni par Apple, lu depuis ses serveurs, jamais enregistré.", lectureSeulement: true, lien: { libelle: "Ouvrir dans Apple Music", url: "https://music.apple.com/fr/album/essai/1?i=2" } }, { id: "lecteur_officiel", embed: "https://embed.music.apple.com/fr/album/essai/1?i=2", hauteur: 175 }, { id: "enregistrer_lien", executePar: "client" }],
      restrictions: ["Apple Music n'autorise aucun téléchargement."], manque: [], avertissements: [] },
    archive: { connecteur: "archive", type: "element", url: "https://archive.org/details/essai-satie", etat: "telechargeable", titre: "Pièces pour piano (essai)", artistes: ["Archive libre"], date: "1888", pochette: null,
      licence: { code: "cc0", nom: "CC0 1.0 (domaine public)", url: "https://creativecommons.org/publicdomain/zero/1.0/", libre: true }, attribution: "« Pièces pour piano (essai) », CC0, via Internet Archive (https://archive.org/details/essai-satie)",
      capacites: ["Metadata", "Search", "Playback", "AuthorizedDownload", "Import"], pistesTotal: 3,
      pistes: [
        { titre: "Gymnopédie n° 1", artistes: ["Archive libre"], dureeS: 191, fichiers: [{ nom: "gymnopedie-1.flac", format: "Flac", taille: 21_400_000, original: true }, { nom: "gymnopedie-1.mp3", format: "VBR MP3", taille: 3_400_000 }] },
        { titre: "Gymnopédie n° 2", artistes: ["Archive libre"], dureeS: 158, fichiers: [{ nom: "gymnopedie-2.mp3", format: "VBR MP3", taille: 2_900_000, original: true }] },
        { titre: "Gnossienne n° 1", artistes: ["Archive libre"], dureeS: 236, fichiers: [{ nom: "gnossienne-1.mp3", format: "VBR MP3", taille: 4_100_000, original: true }] }],
      actions: [{ id: "ouvrir", libelle: "Ouvrir sur Internet Archive", url: "https://archive.org/details/essai-satie" }, { id: "importer", requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "https://archive.org/details/essai-satie", fichier: "gymnopedie-1.flac" } }, attestationRequise: false }, { id: "enregistrer_lien", executePar: "client" }],
      restrictions: ["Licence revérifiée par le serveur à chaque import."], manque: [], avertissements: [] },
    fichier: { connecteur: "fichier", type: "fichier", url: "https://exemple.fr/sons/ambiance-libre.mp3", etat: "telechargeable", titre: "ambiance-libre.mp3", artistes: [], pochette: null,
      capacites: ["AuthorizedDownload", "Import"], licence: { code: "declaree", nom: "Droits déclarés par l'utilisateur", libre: false },
      actions: [{ id: "importer", requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "https://exemple.fr/sons/ambiance-libre.mp3", type: "fichier" } }, attestationRequise: true, attestation: "Je déclare avoir le droit de télécharger ce fichier (j'en suis l'auteur, il est sous licence libre ou son ayant droit l'autorise)." }, { id: "enregistrer_lien", executePar: "client" }],
      restrictions: ["Fichier direct : la déclaration de droits est enregistrée avec l'import."], manque: [], avertissements: [] },
    soundcloud: { connecteur: "soundcloud", type: "titre", url: "https://soundcloud.com/essai/morceau", etat: "identifie", titre: "Morceau SoundCloud (essai)", artistes: ["essai"], pochette: null, capacites: ["Metadata", "Playback"],
      actions: [{ id: "ouvrir", libelle: "Ouvrir dans SoundCloud", url: "https://soundcloud.com/essai/morceau" }, { id: "lecteur_officiel", embed: "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fessai%2Fmorceau&visual=false", hauteur: 166 }, { id: "enregistrer_lien", executePar: "client" }],
      restrictions: ["SoundCloud : lien et lecteur officiel seulement."], manque: [], avertissements: [] },
  };
  const choisirFiche = (url) => {
    if (/spotify/.test(url)) return FICHES.spotify;
    if (/apple\.com/.test(url)) return FICHES.apple;
    if (/archive\.org/.test(url)) return FICHES.archive;
    if (/soundcloud/.test(url)) return FICHES.soundcloud;
    if (/\.(mp3|flac|ogg|wav|m4a|opus)$/i.test(url)) return { ...FICHES.fichier, url, titre: url.split("/").pop() };
    throw refus(400, "plateforme_inconnue", "Ce lien ne vient d'aucune plateforme reconnue par AETHRYON Music.");
  };
  const vue = () => ({ pistes: pistes.map(({ son, ...p }) => p), playlists: structuredClone(playlists), historique: structuredClone(historique), fiches: structuredClone(fiches), lecture: structuredClone(lecture), dossierPochettes: `${R}\\musique\\pochettes` });
  const ops = (op) => {
    const t = iso(0);
    const trouver = (id) => { const p = playlists.find((x) => x.id === id); if (!p) throw refus(0, "refuse", "Playlist inconnue."); return p; };
    let id = null;
    switch (op.op) {
      case "creer": if (!op.nom?.trim()) throw refus(0, "refuse", "Donnez un nom à la playlist."); id = "pl_" + Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32); playlists.push({ id, nom: op.nom.trim(), pistes: op.pistes || [], creeLe: t, modifieLe: t }); break;
      case "renommer": trouver(op.id).nom = op.nom.trim(); break;
      case "supprimer": playlists = playlists.filter((p) => p.id !== op.id); break;
      case "ajouter": trouver(op.id).pistes.push(...op.pistes); break;
      case "retirer": trouver(op.id).pistes.splice(op.position, 1); break;
      case "deplacer": { const p = trouver(op.id); const [x] = p.pistes.splice(op.de, 1); p.pistes.splice(op.vers, 0, x); break; }
      case "reordonner": { const p = trouver(op.id); if ([...p.pistes].sort().join() !== [...op.pistes].sort().join()) throw refus(0, "refuse", "Nouvel ordre refusé."); p.pistes = op.pistes; break; }
    }
    return { playlists: structuredClone(playlists), id };
  };
  const emettreImport = (t) => { const { annule, admin, ...x } = t; M.emettre("musique-import", structuredClone(x)); };
  async function deroulerImport(t, corps) {
    const pas = S.importLentMusique ? 700 : 260;
    const total = corps.fichier === "gymnopedie-1.flac" ? 21_400_000 : 3_400_000;
    const att = (ms) => new Promise((r) => setTimeout(r, ms));
    await att(pas); if (t.annule) return;
    Object.assign(t, { distant: "mus_" + t.id.slice(4, 14), etape: "en_file", serveur: { octets: 0, total: null } }); emettreImport(t);
    await att(pas);
    if (S.importEchec) { Object.assign(t, { etape: "echec", code: "integrite", message: "Le fichier reçu ne correspond pas à l'empreinte publiée par Internet Archive : rien n'est gardé." }); emettreImport(t); return; }
    for (let k = 1; k <= 5; k++) { if (t.annule) return; Object.assign(t, { etape: "telechargement", serveur: { octets: Math.round((total * k) / 5), total } }); emettreImport(t); await att(pas); }
    for (const e of ["verification", "etiquetage"]) { if (t.annule) return; t.etape = e; emettreImport(t); await att(pas); }
    for (let k = 1; k <= 4; k++) { if (t.annule) return; Object.assign(t, { etape: "rapatriement", local: { octets: Math.round((total * k) / 4), total } }); emettreImport(t); await att(pas / 2); }
    const id = hexm(40 + imports.length);
    const titre = { "gymnopedie-1.flac": "Gymnopédie n° 1", "gymnopedie-2.mp3": "Gymnopédie n° 2", "gnossienne-1.mp3": "Gnossienne n° 1" }[corps.fichier] || t.titre || "Import";
    const chemin = `${DM}\\Musique\\Archive libre - ${titre}.${corps.fichier?.split(".").pop() || "mp3"}`;
    M.etat.index.medias.push({ id, chemin, nom: `Archive libre - ${titre}`, ext: "mp3", type: "audio", taille: total, ajouteLe: iso(0), modifieLe: iso(0), duree: 191, largeur: null, hauteur: null, ips: null, codecVideo: null, codecAudio: "mp3", miniature: null, etat: "disponible", premiereCompatible: true, origine: { plateforme: "local", titre: null } });
    window.__SONS__[chemin] = "accord";
    pistes.unshift({ id, titre, artistes: ["Archive libre"], album: "Pièces pour piano (essai)", artisteAlbum: "Archive libre", numero: null, disque: null, annee: 1888, genre: null, isrc: null, dureeS: 191, qualite: q({ codec: corps.fichier?.endsWith("flac") ? "flac" : "mp3", sansPerte: !!corps.fichier?.endsWith("flac"), bits: corps.fichier?.endsWith("flac") ? 16 : null, debitKbps: corps.fichier?.endsWith("flac") ? 900 : 192 }), pochette: null, etiquetage: "ok", empreinte: "x",
      provenance: { connecteur: "archive", sourceUrl: corps.url, licence: FICHES.archive.licence, attribution: FICHES.archive.attribution, attestation: false, importId: t.distant, importeLe: iso(0), cloud: { etat: "sauvegarde", libelle: "Sauvegardé" } } });
    Object.assign(t, { etape: "termine", licence: FICHES.archive.licence, attribution: FICHES.archive.attribution, cloud: t.admin ? { etat: "sauvegarde", libelle: "Sauvegardé, expire dans 30 jours" } : null, chemin, mediaId: id, message: "Enregistré dans Musique", local: { octets: total, total } });
    emettreImport(t);
    historique.unshift({ id: "h_" + t.id, quand: iso(0), action: "import", url: corps.url, connecteur: t.connecteur, titre, artistes: ["Archive libre"], pochette: null, etat: "termine", importId: t.distant, mediaId: id, erreur: null });
    M.emettre("changement", "bibliotheque");
  }
  const cmd = {
    musique_vue: () => vue(),
    musique_playlists: ({ op }) => ops(op),
    musique_historique_noter: ({ entree }) => { if (!/^https:\/\//.test(entree.url)) throw refus(0, "refuse", "Lien refusé (https seulement)."); historique.unshift({ id: "h_" + historique.length, quand: iso(0), artistes: [], pochette: null, titre: null, etat: "", importId: null, mediaId: null, erreur: null, connecteur: "", ...entree }); historique = historique.slice(0, 300); return structuredClone(historique); },
    musique_historique_effacer: () => { historique = []; return null; },
    musique_fiche_enregistrer: ({ fiche }) => { fiches = [{ ...fiche, enregistreeLe: iso(0) }, ...fiches.filter((f) => f.url !== fiche.url)]; return structuredClone(fiches); },
    musique_fiche_retirer: ({ url }) => { fiches = fiches.filter((f) => f.url !== url); return structuredClone(fiches); },
    musique_lecture: ({ etat }) => { lecture = { ...etat, majLe: iso(0) }; window.__maquette.lectures = (window.__maquette.lectures || 0) + 1; return structuredClone(lecture); },
    musique_ouvrir_lien: ({ url }) => { if (!/^https:\/\/(open\.spotify\.com|music\.apple\.com|podcasts\.apple\.com|soundcloud\.com|(www\.)?deezer\.com|archive\.org|commons\.wikimedia\.org|creativecommons\.org)\//.test(url)) throw refus(0, "lien_refuse", "Ce lien ne peut pas être ouvert depuis AETHRYON."); (window.__maquette.liensOuverts ||= []).push(url); return null; },
    musique_connecteurs: async () => { await relayer(); return { connecteurs: [] }; },
    musique_analyser: async ({ url }) => { await relayer(); await new Promise((r) => setTimeout(r, S.analyseLente ? 1500 : 420)); return { fiche: structuredClone(choisirFiche(url)) }; },
    musique_rechercher: async ({ q: texte, source }) => { await relayer(); await new Promise((r) => setTimeout(r, 300)); return { source, resultats: source === "archive" ? [structuredClone(FICHES.archive)] : source === "apple" ? [structuredClone(FICHES.apple)] : [] }; },
    musique_synchroniser: async ({ url }) => { await relayer(); await new Promise((r) => setTimeout(r, 500)); const r = ops({ op: "creer", nom: "Playlist synchronisée (essai)", pistes: [pistes[0].id, pistes[1].id] }); const p = playlists.find((x) => x.id === r.id); p.source = { connecteur: "spotify", url, titre: "Playlist synchronisée (essai)", snapshot: "s", synchroniseeLe: iso(0), sansFichier: [{ position: 3, titre: "Titre sans fichier", artistes: ["X"], dureeS: 180 }] };
      return { resultat: { playlist: { titre: "Playlist synchronisée (essai)", total: 3 }, stats: { titres: 3, correspondancesSures: 1, correspondancesProbables: 1, sansFichier: 1 } }, playlists: structuredClone(playlists) }; },
    musique_importer: async ({ corps, presentation }) => {
      await relayer();
      const admin = (await compteEtat())?.administrateur;
      if ("attestation" in corps && corps.attestation !== true) throw refus(0, "refuse", "Champ d'import refusé : « attestation ».");
      if (imports.filter((x) => !["termine", "echec", "annule"].includes(x.etape)).length >= 2) throw refus(0, "refuse", "Deux imports sont déjà en cours : attendez la fin de l'un d'eux.");
      const t = { id: "imp_" + Math.random().toString(16).slice(2, 34).padEnd(32, "0"), distant: null, url: corps.url, connecteur: presentation.connecteur, titre: presentation.titre, artistes: presentation.artistes, pochette: presentation.pochette,
        etape: "demande", serveur: null, local: null, licence: null, attribution: null, cloud: null, audio: null, code: null, message: null, chemin: null, mediaId: null, majLe: iso(0) };
      t.admin = !!admin;
      imports.push(t);
      (window.__maquette.imports ||= []).push(structuredClone(corps));
      emettreImport(t);
      void deroulerImport(t, corps);
      return structuredClone(t);
    },
    musique_imports: () => imports.map(({ annule, admin, ...x }) => structuredClone(x)),
    musique_import_annuler: ({ id }) => { const t = imports.find((x) => x.id === id); if (!t || ["termine", "echec", "annule"].includes(t.etape)) return false; t.annule = true; Object.assign(t, { etape: "annule", code: "annule", message: "Import annulé." }); emettreImport(t); return true; },
  };
  // Objets musicaux du Cloud (administrateur) : un sauvegardé, un EXPIRÉ (fiche gardée, audio indisponible, réimport).
  const cloudMusique = [
    { id: "objm" + "1".repeat(18), nom: "Archive libre - Gymnopédie n° 1 (essai).mp3", type: "audio/mpeg", taille: 3_400_000, statut: "sauvegarde", libelle: "Sauvegardé", origine: "ytapi", plateforme: "archive", creeLe: iso(-2 * jour), envoyeLe: iso(-2 * jour), expireLe: iso(28 * jour), expireDansJours: 28, sha256: "a".repeat(64), erreur: null, apercu: true,
      musique: { connecteur: "archive", titre: "Gymnopédie n° 1 (essai)", artistes: ["Archive libre"], album: null, date: "1888", licence: { code: "cc0", nom: "CC0 1.0" }, attribution: "CC0, via Internet Archive", sourceUrl: "https://archive.org/details/essai-gymnopedie", pochetteUrl: null, audio: { dureeS: 191 } }, audioDisponible: true, reimport: null },
    { id: "objm" + "2".repeat(18), nom: "Archive libre - Pavane d'essai.mp3", type: "audio/mpeg", taille: 2_100_000, statut: "expire", libelle: "Expiré", origine: "ytapi", plateforme: "archive", creeLe: iso(-31 * jour), envoyeLe: iso(-31 * jour), expireLe: iso(-jour), expireDansJours: null, sha256: "b".repeat(64), erreur: null, apercu: false,
      musique: { connecteur: "archive", titre: "Pavane d'essai", artistes: ["Archive libre"], album: null, date: "1899", licence: { code: "cc0", nom: "CC0 1.0" }, attribution: "CC0, via Internet Archive", sourceUrl: "https://archive.org/details/essai-satie", pochetteUrl: null, audio: { dureeS: 222 } }, audioDisponible: false,
      reimport: { possible: true, url: "https://archive.org/details/essai-satie", connecteur: "archive", attestationRequise: false } },
  ];
  interne = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (c, args = {}) => {
    if (c === "cloud_objets" && args.filtres?.musique) { window.__maquette.appels.push(c); return { items: structuredClone(cloudMusique), total: 2, page: 1, taillePage: 100, quota: null }; }
    if (c === "cloud_lien" && String(args.id).startsWith("objm")) { window.__maquette.appels.push(c); const o = cloudMusique.find((x) => x.id === args.id); if (!o || o.statut !== "sauvegarde") throw refus(410, "expire", "Expiré."); return { url: "https://f000.backblazeb2.com/essai/musique.mp3", expireLe: iso(300_000), usage: args.usage }; }
    if (!cmd[c]) return interne(c, args);
    window.__maquette.appels.push(c);
    return cmd[c](args);
  };
  M.musique = { pistes, imports, playlists: () => playlists, lecture: () => lecture };
})();
