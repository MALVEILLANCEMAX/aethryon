import { describe, expect, it } from "vitest";
import * as F from "./file";
import { corpsPour, detecter, dureeTotale, plan } from "./capacites";
import { classeQualite, libelleQualite } from "./qualite";
import { albums, filtrer, suggestions, trier } from "./tri";
import type { Fiche, Piste, Qualite } from "./types";

const fixe = () => 0.3;

describe("file d'attente", () => {
  const refs = ["loc:a", "loc:b", "loc:c", "loc:d"];
  it("lecture dans l'ordre, fin de file sans répétition = arrêt", () => {
    let f = F.creer(refs, 1);
    expect(F.courant(f)).toBe("loc:b");
    f = F.suivant(f)!; f = F.suivant(f)!;
    expect(F.courant(f)).toBe("loc:d");
    expect(F.suivant(f, true)).toBeNull();
  });
  it("répétition « tout » repart au début ; « un » rejoue en fin naturelle mais « Suivant » avance", () => {
    let f: F.File = { ...F.creer(refs, 3), repetition: "tout" };
    expect(F.courant(F.suivant(f)!)).toBe("loc:a");
    f = { ...F.creer(refs, 1), repetition: "un" as const };
    expect(F.courant(F.suivant(f, true)!)).toBe("loc:b");
    expect(F.courant(F.suivant(f, false)!)).toBe("loc:c");
  });
  it("aléatoire : le morceau en cours reste en tête, chaque morceau passe une fois, retour à l'ordre naturel", () => {
    const f = F.creer(refs, 2, true, "non", fixe);
    expect(F.courant(f)).toBe("loc:c");
    expect([...f.ordre].sort()).toEqual([0, 1, 2, 3]);
    let g: F.File | null = f; const vus: string[] = [];
    while (g) { vus.push(F.courant(g)!); g = F.suivant(g, true); }
    expect(vus.sort()).toEqual(refs);
    const n = F.basculerAleatoire(F.suivant(f)!);
    expect(n.aleatoire).toBe(false);
    expect(F.courant(n)).toBe(F.courant(F.suivant(f)!));
    expect(n.ordre).toEqual([0, 1, 2, 3]);
    const r = F.basculerAleatoire(n, fixe);
    expect(F.courant(r)).toBe(F.courant(n));
    expect(r.pos).toBe(0);
  });
  it("aléatoire + « tout » : nouveau mélange, le dernier joué ne revient pas en premier", () => {
    let f: F.File = { ...F.creer(refs, 0, true, "tout", fixe) };
    f = { ...f, pos: 3 };
    const dernier = F.courant(f);
    const n = F.suivant(f, true, () => 0)!;
    expect(n.pos).toBe(0);
    expect(F.courant(n)).not.toBe(dernier);
  });
  it("précédent : redémarre après 3 s, sinon morceau d'avant ; au début, redémarre (ou va à la fin en « tout »)", () => {
    const f = F.creer(refs, 2);
    expect(F.precedent(f, 12).redemarrer).toBe(true);
    expect(F.courant(F.precedent(f, 1).file)).toBe("loc:b");
    const d = F.creer(refs, 0);
    expect(F.precedent(d, 1).redemarrer).toBe(true);
    expect(F.courant(F.precedent({ ...d, repetition: "tout" }, 1).file)).toBe("loc:d");
  });
  it("lire ensuite, ajouter à la fin, retirer, déplacer, sauter ; cycle de répétition ; aller-retour avec le cœur", () => {
    let f = F.creer(refs, 0);
    f = F.ajouter(f, ["loc:x"], "ensuite");
    expect(F.aVenir(f)).toEqual(["loc:x", "loc:b", "loc:c", "loc:d"]);
    f = F.ajouter(f, ["loc:y"], "fin");
    expect(F.aVenir(f).at(-1)).toBe("loc:y");
    f = F.retirerAVenir(f, 1);
    expect(F.aVenir(f)).toEqual(["loc:x", "loc:c", "loc:d", "loc:y"]);
    f = F.deplacerAVenir(f, 3, 0);
    expect(F.aVenir(f)).toEqual(["loc:y", "loc:x", "loc:c", "loc:d"]);
    expect(F.deplacerAVenir(f, 0, 9)).toBe(f);
    expect(F.courant(F.allerA(f, 2))).toBe("loc:c");
    expect(F.cycleRepetition("non")).toBe("tout");
    expect(F.cycleRepetition("tout")).toBe("un");
    expect(F.cycleRepetition("un")).toBe("non");
    const e = F.versEtat(f);
    expect(F.courant(F.depuisEtat(e))).toBe(F.courant(f));
    expect(F.aVenir(F.depuisEtat(e))).toEqual(F.aVenir(f));
    expect(F.ajouter(F.VIDE, ["loc:z"], "fin").ordre).toEqual([0]);
  });
});

const fiche = (p: Partial<Fiche>): Fiche => ({ connecteur: "archive", type: "element", url: "https://archive.org/details/x", etat: "telechargeable", titre: "T", artistes: [], capacites: [], actions: [], ...p });

describe("capacités → actions", () => {
  it("catalogue commercial : jamais d'import, même si le serveur se trompait", () => {
    const p = plan(fiche({ connecteur: "spotify", etat: "identifie", capacites: ["Metadata", "Playback", "AuthorizedDownload"],
      actions: [{ id: "ouvrir", libelle: "Ouvrir dans Spotify", url: "https://open.spotify.com/track/x" }, { id: "lecteur_officiel", embed: "https://open.spotify.com/embed/track/x", hauteur: 152 },
        { id: "importer", requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "x" } } }] }));
    expect(p.importer).toBeNull();
    expect(p.catalogue).toBe(true);
    expect(p.ouvrir?.libelle).toBe("Ouvrir dans Spotify");
    expect(p.lecteurOfficiel?.hauteur).toBe(152);
    expect(p.etat.libelle).toBe("Titre identifié");
  });
  it("aperçu Apple : montré seulement avec « Ouvrir dans Apple Music »", () => {
    const base = { connecteur: "apple", etat: "identifie" as const, capacites: ["Metadata", "Preview"] as Fiche["capacites"] };
    const avec = plan(fiche({ ...base, actions: [{ id: "apercu", url: "https://audio-ssl.itunes.apple.com/a.m4a", dureeS: 30, libelle: "Aperçu de 30 s", lien: { libelle: "Ouvrir dans Apple Music", url: "https://music.apple.com/fr/album/x?i=1" } }] }));
    expect(avec.apercu?.lien.libelle).toBe("Ouvrir dans Apple Music");
    const sans = plan(fiche({ ...base, actions: [{ id: "apercu", url: "https://audio-ssl.itunes.apple.com/a.m4a" }] }));
    expect(sans.apercu).toBeNull();
  });
  it("source libre : import avec choix des fichiers ; fichier direct : déclaration de droits obligatoire", () => {
    const p = plan(fiche({ capacites: ["Metadata", "AuthorizedDownload", "Import"], pistes: [
      { titre: "Gymnopédie 1", artistes: ["Satie"], dureeS: 200, fichiers: [{ nom: "g1.mp3", format: "VBR MP3", taille: 3_500_000, original: false }, { nom: "g1.flac", format: "Flac", original: true }] },
      { titre: "Gymnopédie 2", artistes: ["Satie"], dureeS: 150, fichiers: [{ nom: "g2.mp3" }] }],
      actions: [{ id: "importer", requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "https://archive.org/details/x", fichier: "g1.mp3" } } }] }));
    expect(p.importer?.choix.map((c) => c.valeur)).toEqual(["g1.flac", "g2.mp3"]);
    expect(corpsPour(p, p.importer!.choix[1], false)).toEqual({ url: "https://archive.org/details/x", fichier: "g2.mp3" });
    expect(dureeTotale(fiche({ pistes: [{ titre: "a", artistes: [], dureeS: 1 }, { titre: "b", artistes: [], dureeS: 2 }] }).pistes)).toBe(3);
    expect(dureeTotale([{ titre: "a", artistes: [] }])).toBeNull();
    const d = plan(fiche({ connecteur: "fichier", capacites: ["AuthorizedDownload"], actions: [{ id: "importer", attestationRequise: true, attestation: "Je déclare…", requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "https://x.y/a.mp3", type: "fichier" } } }] }));
    expect(corpsPour(d, null, false)).toBeNull();
    expect(corpsPour(d, null, true)).toEqual({ url: "https://x.y/a.mp3", type: "fichier", attestation: true });
  });
  it("sans capacité AuthorizedDownload : pas d'import ; liens non https ignorés", () => {
    const p = plan(fiche({ capacites: ["Metadata"], actions: [{ id: "importer", requete: { methode: "POST", chemin: "/x", corps: {} } }, { id: "ouvrir", url: "javascript:alert(1)" }] }));
    expect(p.importer).toBeNull();
    expect(p.ouvrir).toBeNull();
  });
  it("détection de plateforme pendant la frappe", () => {
    expect(detecter("https://open.spotify.com/intl-fr/track/abc")?.id).toBe("spotify");
    expect(detecter("spotify:album:abc")?.id).toBe("spotify");
    expect(detecter("https://music.apple.com/fr/album/x/1")?.id).toBe("apple");
    expect(detecter("https://www.deezer.com/fr/track/1")?.id).toBe("deezer");
    expect(detecter("https://soundcloud.com/a/b")?.id).toBe("soundcloud");
    expect(detecter("https://archive.org/details/x")?.id).toBe("archive");
    expect(detecter("https://music.youtube.com/watch?v=x")?.refuse).toMatch(/YouTube Music/);
    expect(detecter("http://archive.org/x")?.refuse).toMatch(/https/);
    expect(detecter("https://exemple.fr/son.flac")?.id).toBe("fichier");
    expect(detecter("https://feeds.exemple.fr/podcast")?.id).toBe("podcast");
    expect(detecter("pas un lien")).toBeNull();
  });
});

const q = (p: Partial<Qualite>): Qualite => ({ codec: "mp3", conteneur: "mp3", debitKbps: null, frequenceHz: null, bits: null, canaux: 2, sansPerte: false, ...p });
const piste = (id: string, p: Partial<Piste>): Piste => ({ id, titre: id, artistes: [], album: null, artisteAlbum: null, numero: null, disque: null, annee: null, genre: null, isrc: null, dureeS: 100, qualite: q({}), pochette: null, etiquetage: "ok", empreinte: "", ...p });

describe("qualité et bibliothèque", () => {
  it("libellés de qualité réelle, rien d'inventé", () => {
    expect(libelleQualite(q({ codec: "flac", sansPerte: true, bits: 24, frequenceHz: 96000 }))).toBe("FLAC · 24 bits · 96 kHz");
    expect(libelleQualite(q({ debitKbps: 192, frequenceHz: 44100 }))).toBe("MP3 · 192 kb/s · 44,1 kHz");
    expect(libelleQualite(q({ codec: "pcm", sansPerte: true, canaux: 1 }))).toBe("WAV · mono");
    expect(classeQualite(q({ codec: "flac", sansPerte: true, bits: 16, frequenceHz: 44100 }))).toBe("sansperte");
    expect(classeQualite(q({ codec: "flac", sansPerte: true, bits: 24 }))).toBe("hires");
    expect(classeQualite(q({ codec: "inconnu" }))).toBe("inconnu");
  });
  it("recherche sans accents, filtres, tris, albums rangés", () => {
    const ps = [
      piste("1", { titre: "Clair de nuit", artistes: ["Atelier Chouette"], album: "Nocturnes", numero: 2, qualite: q({ debitKbps: 192 }) }),
      piste("2", { titre: "Ivoire", artistes: ["Atelier Chouette", "Invité"], album: "Nocturnes", numero: 1, qualite: q({ codec: "flac", sansPerte: true, bits: 24 }) }),
      piste("3", { titre: "Été", artistes: ["Or Clair"], dureeS: 300, provenance: { connecteur: "archive", sourceUrl: null, licence: null, attribution: null, attestation: false, importId: null, importeLe: "", cloud: null } }),
    ];
    const vide = { q: "", qualite: "" as const, format: "", provenance: "" as const };
    expect(filtrer(ps, { ...vide, q: "ete" }).map((p) => p.id)).toEqual(["3"]);
    expect(filtrer(ps, { ...vide, q: "invite" }).map((p) => p.id)).toEqual(["2"]);
    expect(filtrer(ps, { ...vide, qualite: "hires" }).map((p) => p.id)).toEqual(["2"]);
    expect(filtrer(ps, { ...vide, provenance: "importe" }).map((p) => p.id)).toEqual(["3"]);
    expect(trier(ps, "duree")[0].id).toBe("3");
    expect(trier(ps, "qualite")[0].id).toBe("2");
    const a = albums(ps);
    expect(a).toHaveLength(1);
    expect(a[0].pistes.map((p) => p.id)).toEqual(["2", "1"]);
    expect(a[0].dureeS).toBe(200);
  });
  it("suggestions tirées de la bibliothèque seulement", () => {
    const ps = [piste("1", { artistes: ["A"] }), piste("2", { artistes: ["A"] }), piste("3", { artistes: ["B"] })];
    const s = suggestions(ps, ["1"], new Map());
    expect(s.pistes.map((p) => p.id)).toEqual(["2"]);
    expect(suggestions(ps, [], new Map([["3", 9]])).pistes[0].id).toBe("3");
  });
});
