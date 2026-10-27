// Égide dans l'extension (3.9.0) : préférence d'apparence partagée (adaptateur Stockage de creerPersistance au-dessus de
// chrome.storage.sync, miroir local lu par theme-boot.js), catalogue des plateformes (une seule source, états réels).
//   node --test tests/unit/apparence.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLE_APPARENCE, CUSTOM_EXEMPLE, creerPersistance, lirePreference, stockageMemoire } from "../../src/shared/egide.ts";
import { CLE_SYNC_APPARENCE, stockageChrome } from "../../src/shared/apparence.ts";
import { PLATEFORMES, etatAffiche, lireDisponibilites, plateformeDuLien, raisonPlateforme } from "../../src/shared/catalogue.ts";
import { readFileSync } from "node:fs";
import { CIBLE, rendre } from "../../scripts/catalogue.mjs";

function fauxSync() {
  const data: Record<string, unknown> = {};
  const ecrits: Record<string, unknown>[] = [];
  return {
    data, ecrits,
    get: async (k: string) => ({ [k]: data[k] }),
    set: async (o: Record<string, unknown>) => { ecrits.push(o); Object.assign(data, o); },
    remove: async (k: string) => { delete data[k]; },
  };
}

test("adaptateur : écrire un thème le garde dans le miroir local ET dans storage.sync (clé « apparence »)", async () => {
  const sync = fauxSync();
  const miroir = stockageMemoire();
  const p = creerPersistance({ stockage: stockageChrome({ sync: sync as never, miroir }) });
  assert.equal(p.ecrire({ actif: "ivory" }), true);
  await Promise.resolve();
  const local = miroir.getItem(CLE_APPARENCE);
  assert.ok(local);
  assert.equal(sync.data[CLE_SYNC_APPARENCE], local, "même texte dans sync et dans le miroir");
  assert.equal(lirePreference(local).actif, "ivory");
  // le cache de theme-boot.js : attributs fermés seulement pour un thème officiel
  assert.deepEqual(JSON.parse(local!).cache.vars, {});
  assert.equal(JSON.parse(local!).cache.attrs["data-eg-theme"], "ivory");
  // thème personnel : ses couleurs dans le cache, le document revalidé à la relecture
  p.ecrire({ actif: "custom", perso: CUSTOM_EXEMPLE });
  const pref = lirePreference(miroir.getItem(CLE_APPARENCE));
  assert.equal(pref.actif, "custom");
  assert.equal(pref.perso?.name, CUSTOM_EXEMPLE.name);
  assert.ok(Object.keys(JSON.parse(miroir.getItem(CLE_APPARENCE)!).cache.vars).length > 20);
  assert.ok(new TextEncoder().encode(miroir.getItem(CLE_APPARENCE)!).length < 8000, "tient dans un élément de storage.sync");
});

test("adaptateur : une valeur reçue d'ailleurs n'est pas renvoyée ; trafiquée, elle redevient Obsidian à la lecture", () => {
  const sync = fauxSync();
  const miroir = stockageMemoire();
  const s = stockageChrome({ sync: sync as never, miroir });
  const venue = JSON.stringify({ v: 1, actif: "midnight", perso: null, cache: null, maj: 1 });
  assert.equal(s.recevoir(venue), true);
  assert.equal(s.recevoir(venue), false, "déjà connue");
  assert.equal(sync.ecrits.length, 0, "rien n'est renvoyé vers storage.sync");
  assert.equal(creerPersistance({ stockage: s }).lire().actif, "midnight");
  s.recevoir(JSON.stringify({ v: 1, actif: "custom", perso: { format: "aethryon-theme", schemaVersion: 1, id: "x.y", name: "Piège", base: "obsidian", tokens: { "c-text": "url(https://evil.example)" } }, maj: 2 }));
  const p = creerPersistance({ stockage: s }).lire();
  assert.equal(p.perso, null, "thème personnel invalide ignoré");
  s.recevoir("{abîmé");
  assert.equal(creerPersistance({ stockage: s }).lire().actif, "obsidian");
});

test("adaptateur : sans storage.sync ni miroir, la préférence reste en mémoire et rien ne lève", () => {
  const s = stockageChrome({ sync: null, miroir: null });
  const p = creerPersistance({ stockage: s });
  p.ecrire({ actif: "oled" });
  assert.equal(p.lire().actif, "oled");
  const casse = { getItem: () => { throw new Error("refusé"); }, setItem: () => { throw new Error("refusé"); }, removeItem: () => { throw new Error("refusé"); } };
  const s2 = stockageChrome({ sync: null, miroir: casse });
  const p2 = creerPersistance({ stockage: s2 });
  p2.ecrire({ actif: "minimal" });
  assert.equal(p2.lire().actif, "minimal");
});

test("catalogue : une seule source (docs/api/CATALOGUE-PLATEFORMES.json), copie à jour, pictogrammes neutres, aucune marque", () => {
  // La copie de l'extension (scripts/catalogue.mjs) est exactement la projection du catalogue des interfaces.
  assert.equal(readFileSync(CIBLE, "utf8"), rendre(), "src/shared/catalogue-donnees.ts à jour");
  assert.ok(PLATEFORMES.length >= 30);
  for (const p of PLATEFORMES) assert.ok(["video", "vertical", "post", "image", "direct", "archive", "onde"].includes(p.icone), p.id);
  const ids = PLATEFORMES.map((p) => p.id);
  for (const id of ["youtube", "tiktok", "twitter", "bluesky", "wikimedia", "spotify", "netflix"]) assert.ok(ids.includes(id), id);
});

test("catalogue : reconnaissance d'un lien par domaine (le plus précis d'abord), refus des faux domaines", () => {
  assert.equal(plateformeDuLien("https://www.instagram.com/reel/abc/")?.id, "instagram");
  assert.equal(plateformeDuLien("https://bsky.app/profile/a.bsky.social/post/3k")?.id, "bluesky");
  assert.equal(plateformeDuLien("https://commons.wikimedia.org/wiki/File:A.webm")?.id, "wikimedia");
  assert.equal(plateformeDuLien("https://music.youtube.com/watch?v=x")?.id, "youtube_music");
  assert.equal(plateformeDuLien("https://open.spotify.com/track/1")?.id, "spotify");
  assert.equal(plateformeDuLien("https://notinstagram.com/x"), null);
  assert.equal(plateformeDuLien("javascript:alert(1)"), null);
  assert.equal(plateformeDuLien("pas un lien"), null);
});

test("catalogue : états réels — Wikimedia Commons et Bluesky ouvertes sur le serveur mais « Pas encore ici » (l'extension ne les convertit pas), extraits fermés", () => {
  const bsky = PLATEFORMES.find((p) => p.id === "bluesky")!;
  const wiki = PLATEFORMES.find((p) => p.id === "wikimedia")!;
  // sans réponse du serveur : l'état du catalogue (prête à ouvrir → « Bientôt »)
  assert.equal(etatAffiche(bsky, null), "bientot");
  // réponse de GET /media/platforms (production du 2026-10-26) : disponibles
  const dispo = lireDisponibilites({ youtube: true, bluesky: true, wikimedia: true, instagram: false, inconnue: true, vimeo: "oui" });
  assert.deepEqual(dispo && Object.keys(dispo).sort(), ["bluesky", "instagram", "wikimedia", "youtube"]);
  // Jamais « En ligne » dans l'extension tant qu'aucun bouton de l'extension ne les convertit.
  assert.equal(etatAffiche(bsky, dispo), "serveur");
  assert.equal(etatAffiche(wiki, dispo), "serveur");
  assert.equal(raisonPlateforme(wiki, "serveur"), "Wikimedia Commons est ouverte sur le serveur AETHRYON (MP4, MP3, GIF)\u00a0; bientôt dans l'extension.");
  assert.equal(etatAffiche(PLATEFORMES.find((p) => p.id === "youtube")!, dispo), "en_ligne");
  assert.deepEqual([...wiki.formats], ["mp4", "mp3", "gif"]);
  assert.match(wiki.indisponibles.extrait ?? "", /429/);
  assert.equal(wiki.attribution, true);
  assert.equal(bsky.attribution, false);
  // les autres gardent l'état du registre ; une plateforme officielle en panne est « indisponible »
  const insta = PLATEFORMES.find((p) => p.id === "instagram")!;
  assert.equal(etatAffiche(insta, dispo), "preparation");
  const yt = PLATEFORMES.find((p) => p.id === "youtube")!;
  assert.equal(etatAffiche(yt, { youtube: false }), "indisponible");
  assert.match(raisonPlateforme(yt, "indisponible"), /temporairement indisponible/);
  const spotify = PLATEFORMES.find((p) => p.id === "spotify")!;
  assert.equal(etatAffiche(spotify, { spotify: true }), "refusee", "une plateforme refusée ne s'ouvre jamais côté interface");
});
