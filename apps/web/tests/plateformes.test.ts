// Détection locale par le registre UNIQUE des plateformes (copie générée de apps/media-api/app/plateformes.json) : les trois
// plateformes du site inchangées ; les autres refusées clairement (bêta, indisponible, refusée), sans réseau.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_NOT_ACCEPTED_TEXT, plateformeDuLien, probeLink } from "../src/lib/probe.ts";
import { REGISTRE_PLATEFORMES } from "../src/lib/plateformes-registre.ts";

const nbsp = (s: string) => s.replace(/ /g, " ");
const refus = (link: string) => { const p = probeLink(link); assert.equal(p.state, "refus", link); return p.state === "refus" ? nbsp(p.message) : ""; };

test("registre : quatre catégories, aucune clé d'extracteur côté site", () => {
  assert.deepEqual(REGISTRE_PLATEFORMES.categories.map((c) => c.nom), ["Populaires", "Musique", "Streaming", "Autres"]);
  assert.ok(REGISTRE_PLATEFORMES.plateformes.every((p) => !("extracteurs" in p)));
  assert.deepEqual(REGISTRE_PLATEFORMES.plateformes.filter((p) => p.etat === "officielle").map((p) => p.id), ["youtube", "tiktok", "twitter"]);
});

test("détection : hôte, sous-domaine, frontière d'étiquette, domaine le plus long", () => {
  assert.equal(plateformeDuLien("https://www.dailymotion.com/video/x5kesuj")?.id, "dailymotion");
  assert.equal(plateformeDuLien("clips.twitch.tv/Abc")?.categorie, "streaming");
  assert.equal(plateformeDuLien("https://music.youtube.com/watch?v=x")?.id, "youtube_music");
  assert.equal(plateformeDuLien("https://www.youtube.com/watch?v=x")?.id, "youtube");
  assert.equal(plateformeDuLien("https://notvimeo.com/1"), null);
  assert.equal(plateformeDuLien("https://www.apple.com/"), null);
  assert.equal(plateformeDuLien(""), null);
});

test("refus clairs : refusée, indisponible, bêta ; les trois plateformes inchangées", () => {
  assert.equal(refus("https://soundcloud.com/a/b"), nbsp(PLATFORM_NOT_ACCEPTED_TEXT));
  assert.equal(refus("https://open.spotify.com/track/1"), nbsp(PLATFORM_NOT_ACCEPTED_TEXT));
  assert.equal(refus("https://vimeo.com/56015672"), "Vimeo est temporairement indisponible.");
  assert.equal(refus("https://streamable.com/dnd1"), "Streamable n'est pas encore prise en charge : plateforme en essai.");
  assert.match(refus("https://example.org/v.mp4"), /YouTube, TikTok et X seulement/);
  assert.equal(probeLink("https://youtu.be/BaW_jenozKc").state, "ok");
  assert.equal(probeLink("https://x.com/a/status/1790637656616943991").state, "ok");
});

test("texte du refus identique à docs/api/ERREURS.md (platform_not_accepted)", () => {
  assert.equal(nbsp(PLATFORM_NOT_ACCEPTED_TEXT), "Cette plateforme n'est pas acceptée : AETHRYON ne télécharge ni le streaming payant, ni les catalogues musicaux, ni les contenus protégés.");
});
