// Reconnaissance locale d'un lien collé (src/lib/probe.ts) : YouTube Music (music.youtube.com) est fermé depuis le
// 2026-10-23 — refus clair, même texte que le service (docs/ERREURS.md) ; les liens classiques sont inchangés.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isYouTubeMusicHost, probeLink, YOUTUBE_MUSIC_TEXT } from "../src/lib/probe.ts";
import { linkFromHash } from "../src/outils/link.ts";

const TEXTE = "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.";
const nbsp = (s: string) => s.replace(/ /g, " ");

test("YouTube Music : refusé sous toutes ses écritures, avec le texte du service (espace insécable près)", () => {
  assert.equal(nbsp(YOUTUBE_MUSIC_TEXT), TEXTE);
  const refused = [
    "https://music.youtube.com/watch?v=jNQXAC9IVRw", "http://music.youtube.com/watch?v=jNQXAC9IVRw", "https://MUSIC.YOUTUBE.COM/watch?v=jNQXAC9IVRw",
    "https://music.youtube.com./watch?v=jNQXAC9IVRw", "https://music.youtube.com:443/watch?v=jNQXAC9IVRw", "https://m.music.youtube.com/watch?v=jNQXAC9IVRw",
    "https://www.music.youtube.com/playlist?list=PL1", "https://music.youtube.com/", "https://music.youtube.com", "music.youtube.com/watch?v=jNQXAC9IVRw",
    "  https://music.youtube.com/watch?v=jNQXAC9IVRw  ", "https://music.youtu.be/jNQXAC9IVRw", "https://youtubemusic.com/",
    // redirections de YouTube qui désignent YouTube Music (jamais suivies : seul le message change)
    "https://www.youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw&event=video_description",
    "https://www.youtube.com/redirect?q=https%253A%252F%252Fmusic.youtube.com%252Fwatch%253Fv%253DjNQXAC9IVRw",
    "https://m.youtube.com/attribution_link?a=x&u=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw",
  ];
  for (const link of refused) {
    const p = probeLink(link);
    assert.equal(p.state, "refus", link);
    assert.equal(p.state === "refus" ? nbsp(p.message) : "", TEXTE, link);
    assert.equal(p.state === "refus" ? p.platform : "x", undefined, `${link} : aucune plateforme (donc aucun repère de marque) pour un lien refusé`);
  }
});

test("liens classiques : inchangés (YouTube, Shorts, youtu.be, voisins de « music »), TikTok et X", () => {
  const ok: [string, string][] = [
    ["https://www.youtube.com/watch?v=jNQXAC9IVRw", "youtube"], ["https://m.youtube.com/watch?v=jNQXAC9IVRw", "youtube"], ["https://youtube.com/watch?v=jNQXAC9IVRw&t=10s", "youtube"],
    ["https://youtu.be/jNQXAC9IVRw?si=abc", "youtube"], ["https://www.youtube.com/shorts/18NGQq7p3LY", "youtube"], ["youtube.com/watch?v=jNQXAC9IVRw", "youtube"],
    ["https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDAMVMjNQXAC9IVRw", "youtube"], ["https://www.youtube.com/watch?v=jNQXAC9IVRw&feature=music", "youtube"],
    ["https://notmusic.youtube.com/watch?v=jNQXAC9IVRw", "youtube"],
    ["https://www.tiktok.com/@scout2015/video/6718335390845095173", "tiktok"], ["https://x.com/a/status/1790637656616943991", "x"],
  ];
  for (const [link, platform] of ok) {
    const p = probeLink(link);
    assert.equal(p.state, "ok", link);
    assert.equal(p.state === "ok" ? p.platform : "", platform, link);
  }
  // Un lien YouTube qui n'est pas une vidéo garde son message d'avant (pas de faux « YouTube Music »).
  for (const link of ["https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/@chaine", "https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com%2F"]) {
    const p = probeLink(link);
    assert.deepEqual([p.state, p.state === "refus" ? p.message.startsWith("Une vidéo à la fois") : null], ["refus", true], link);
  }
});

test("hôtes : frontière d'étiquette, casse et point final", () => {
  for (const h of ["music.youtube.com", "MUSIC.YouTube.com", "music.youtube.com.", "m.music.youtube.com", "music.youtu.be", "youtubemusic.com"]) assert.equal(isYouTubeMusicHost(h), true, h);
  for (const h of ["", "youtube.com", "www.youtube.com", "youtu.be", "notmusic.youtube.com", "music.example.com", "music.youtube.com.evil.example"]) assert.equal(isYouTubeMusicHost(h), false, h);
});

test("lien transmis à AETHRYON Tools (#lien=…) : un lien YouTube Music est ignoré, un lien classique est repris", () => {
  const hash = (u: string) => `#lien=${encodeURIComponent(u)}`;
  assert.equal(linkFromHash(hash("https://music.youtube.com/watch?v=jNQXAC9IVRw")), null);
  assert.equal(linkFromHash(hash("https://m.music.youtube.com/watch?v=jNQXAC9IVRw")), null);
  assert.equal(linkFromHash(hash("https://www.youtube.com/watch?v=jNQXAC9IVRw")), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  assert.equal(linkFromHash(hash("https://youtu.be/jNQXAC9IVRw")), "https://youtu.be/jNQXAC9IVRw");
});
