// AETHRYON Music dans l'espace (src/lib/musique.ts) : détection, actions réelles selon les capacités, aperçu toujours
// accompagné de « Ouvrir dans Apple Music », déclaration de droits, aucune progression inventée.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { corpsImport, detecter, fraction, plan, type Fiche } from "../src/lib/musique.ts";

const fiche = (p: Partial<Fiche>): Fiche => ({ connecteur: "archive", type: "element", url: "https://archive.org/details/x", etat: "telechargeable", titre: "T", artistes: [], capacites: [], actions: [], ...p });

test("détection : plateformes, YouTube Music et http refusés", () => {
  assert.equal(detecter("https://open.spotify.com/track/x")?.id, "spotify");
  assert.equal(detecter("https://www.deezer.com/fr/album/1")?.id, "deezer");
  assert.match(detecter("https://music.youtube.com/watch?v=1")!.refuse!, /YouTube Music/);
  assert.match(detecter("http://archive.org/x")!.refuse!, /https/);
  assert.equal(detecter("bonjour"), null);
});

test("catalogue commercial : jamais d'import ; aperçu seulement avec son lien", () => {
  const s = plan(fiche({ connecteur: "spotify", capacites: ["AuthorizedDownload"], actions: [{ id: "importer", requete: { methode: "POST", chemin: "/x", corps: {} } }, { id: "ouvrir", libelle: "Ouvrir dans Spotify", url: "https://open.spotify.com/track/x" }] }));
  assert.equal(s.importer, null);
  assert.equal(s.ouvrir?.libelle, "Ouvrir dans Spotify");
  assert.equal(plan(fiche({ connecteur: "apple", actions: [{ id: "apercu", url: "https://audio-ssl.itunes.apple.com/a" }] })).apercu, null);
  assert.equal(plan(fiche({ connecteur: "apple", actions: [{ id: "apercu", url: "https://audio-ssl.itunes.apple.com/a", lien: { libelle: "Ouvrir dans Apple Music", url: "https://music.apple.com/x" } }] })).apercu?.lien.libelle, "Ouvrir dans Apple Music");
});

test("source libre : choix des fichiers ; fichier direct : déclaration de droits obligatoire", () => {
  const p = plan(fiche({ capacites: ["AuthorizedDownload"], pistes: [{ titre: "A", artistes: [], fichiers: [{ nom: "a.mp3" }, { nom: "a.flac", original: true }] }], actions: [{ id: "importer", requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "https://archive.org/details/x", fichier: "a.mp3" } } }] }));
  assert.deepEqual(corpsImport(p, p.importer!.choix[0]!, false), { url: "https://archive.org/details/x", fichier: "a.flac" });
  const d = plan(fiche({ connecteur: "fichier", capacites: ["AuthorizedDownload"], actions: [{ id: "importer", attestationRequise: true, requete: { methode: "POST", chemin: "/api/music/imports", corps: { url: "https://x.y/a.mp3", type: "fichier" } } }] }));
  assert.equal(corpsImport(d, null, false), null);
  assert.deepEqual(corpsImport(d, null, true), { url: "https://x.y/a.mp3", type: "fichier", attestation: true });
});

test("progression : réelle seulement si le total est connu", () => {
  assert.equal(fraction({ etat: "telechargement", progression: { octets: 50, total: 200, pourcentage: 25 } }), 0.25);
  assert.equal(fraction({ etat: "telechargement", progression: { octets: 50, total: null, pourcentage: null } }), null);
  assert.equal(fraction({ etat: "termine", progression: null }), 1);
});
