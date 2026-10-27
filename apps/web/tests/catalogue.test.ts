// Catalogue des plateformes affiché par le site (Égide, lot 1) : UNE source (copie du catalogue des interfaces, elle-même
// générée depuis ytapi/app/plateformes.json) ; états VRAIS : YouTube, TikTok, X en ligne ; Wikimedia Commons et Bluesky
// ouverts en production depuis le 2026-10-26 (MP4, MP3, GIF ; extraits fermés avec la raison du catalogue ; attribution
// pour Wikimedia) ; les autres gardent l'état du registre.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CATALOGUE_PLATEFORMES } from "../src/lib/catalogue-plateformes.ts";
import { EN_LIGNE, etatAffiche, formatsOuverts, OUVERTES_EN_PRODUCTION, PLATEFORMES, plateformeDuLienCatalogue, raisonFormat } from "../src/lib/catalogue.ts";

const p = (id: string) => PLATEFORMES.find((x) => x.id === id)!;

test("copie identique au catalogue des interfaces (docs/api/CATALOGUE-PLATEFORMES.json)", async () => {
  const source = new URL("../../../docs/api/CATALOGUE-PLATEFORMES.json", import.meta.url);
  if (!existsSync(source)) return; // contexte Docker web/ seul : la copie est vérifiée dans le dépôt complet
  const { rendre } = await import("../scripts/catalogue-plateformes.mjs");
  const attendu = rendre(readFileSync(source, "utf8"));
  assert.equal(readFileSync(new URL("../src/lib/catalogue-plateformes.ts", import.meta.url), "utf8"), attendu);
});

test("en ligne : YouTube, TikTok, X, puis Bluesky et Wikimedia Commons (PLATEFORMES_BETA)", () => {
  assert.deepEqual([...OUVERTES_EN_PRODUCTION].sort(), ["bluesky", "wikimedia"]);
  assert.deepEqual(EN_LIGNE.map((x) => x.id).sort(), ["bluesky", "tiktok", "twitter", "wikimedia", "youtube"]);
  for (const id of ["youtube", "tiktok", "twitter"]) assert.deepEqual(formatsOuverts(p(id), etatAffiche(p(id))), ["mp4", "mp3", "gif", "extrait"]);
});

test("Wikimedia et Bluesky : MP4, MP3, GIF ; extraits fermés avec la raison du catalogue ; attribution pour Wikimedia", () => {
  for (const id of ["wikimedia", "bluesky"]) {
    assert.equal(etatAffiche(p(id)), "en-ligne");
    assert.deepEqual(formatsOuverts(p(id), "en-ligne"), ["mp4", "mp3", "gif"]);
    const raison = raisonFormat(p(id), "extrait", "en-ligne");
    const nbsp = (t?: string) => (t ?? "").replace(/[\u00a0\u202f]/g, " ");
    assert.equal(nbsp(raison), nbsp(p(id).fonctions_indisponibles.find((f) => f.fonction === "extrait")?.raison));
    assert.match(raison, /extraits désactivés/);
  }
  assert.equal(p("wikimedia").attribution_obligatoire, true);
  assert.equal(p("bluesky").attribution_obligatoire, false);
});

test("les autres plateformes gardent l'état du registre (aucune promesse)", () => {
  assert.equal(etatAffiche(p("instagram")), "preprod");
  assert.equal(etatAffiche(p("archive")), "preprod");
  assert.equal(etatAffiche(p("vimeo")), "indisponible");
  assert.equal(etatAffiche(p("spotify")), "refusee");
  assert.equal(etatAffiche(p("youtube_music")), "refusee");
  for (const x of PLATEFORMES) {
    const e = etatAffiche(x);
    if (e !== "en-ligne") assert.deepEqual(formatsOuverts(x, e), [], x.id);
    if (!["disponible", "prete_a_ouvrir"].includes(x.statut)) assert.notEqual(e, "en-ligne", x.id);
  }
});

test("plateforme coupée par l'administrateur (/api/config) : temporairement indisponible", () => {
  assert.equal(etatAffiche(p("tiktok"), { tiktok: false }), "temp");
  assert.equal(etatAffiche(p("tiktok"), { tiktok: true }), "en-ligne");
  assert.deepEqual(formatsOuverts(p("tiktok"), "temp"), []);
});

test("détection d'un lien sans réseau (domaine le plus long, frontière d'étiquette)", () => {
  assert.equal(plateformeDuLienCatalogue("https://commons.wikimedia.org/wiki/File:X.webm")?.id, "wikimedia");
  assert.equal(plateformeDuLienCatalogue("bsky.app/profile/a/post/b")?.id, "bluesky");
  assert.equal(plateformeDuLienCatalogue("https://music.youtube.com/watch?v=x")?.id, "youtube_music");
  assert.equal(plateformeDuLienCatalogue("https://notbsky.app/x"), null);
  assert.equal(plateformeDuLienCatalogue(""), null);
});

test("pictogrammes neutres seulement (identifiants du catalogue, aucun nom de marque)", () => {
  const icones = new Set(CATALOGUE_PLATEFORMES.plateformes.map((x) => x.icone));
  for (const i of icones) assert.ok(["video", "vertical", "post", "image", "direct", "archive", "onde"].includes(i), i);
});
