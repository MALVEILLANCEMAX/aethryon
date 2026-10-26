// YouTube Music (music.youtube.com) fermé le 2026-10-23 : reconnaissance de l'hôte, sans réseau, sans faux positif.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isYouTubeMusicHost, isYouTubeMusicUrl, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT } from "../src/youtube-music.ts";

test("code et texte stables (ceux de docs/ERREURS.md)", () => {
  assert.equal(YOUTUBE_MUSIC_CODE, "youtube_music_not_accepted");
  assert.equal(YOUTUBE_MUSIC_TEXT, "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.");
});

test("hôtes : music.youtube.com, ses sous-domaines et les autres noms de YouTube Music ; frontière d'étiquette", () => {
  for (const h of ["music.youtube.com", "MUSIC.YouTube.com", "music.youtube.com.", "www.music.youtube.com", "m.music.youtube.com", "a.b.music.youtube.com",
                   "music.youtu.be", "music.youtube-nocookie.com", "youtubemusic.com", "www.youtubemusic.com"]) assert.equal(isYouTubeMusicHost(h), true, h);
  for (const h of ["", "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "notmusic.youtube.com", "mymusic.youtube.com", "music.example.com",
                   "music.youtube.com.evil.example", "evilmusic.youtube.com", "youtube.com.music"]) assert.equal(isYouTubeMusicHost(h), false, h);
});

test("liens : toutes les écritures de YouTube Music, aucun faux positif sur les liens classiques", () => {
  for (const u of ["https://music.youtube.com/watch?v=jNQXAC9IVRw", "http://music.youtube.com/", "https://MUSIC.YOUTUBE.COM/watch?v=x", "https://music.youtube.com./x",
                   "https://music.youtube.com:443/x", "https://music.youtube.com:8443/x", "https://u:p@music.youtube.com/x", "https://e.example@music.youtube.com/x",
                   "music.youtube.com/watch?v=x", "//music.youtube.com/watch?v=x", "  https://music.youtube.com/x  ", "ftp://music.youtube.com/x",
                   "https://music%2Eyoutube.com/x", "https://ｍusic.youtube.com/x", "https://music。youtube。com/x"]) assert.equal(isYouTubeMusicUrl(u), true, u);
  for (const u of ["https://www.youtube.com/watch?v=jNQXAC9IVRw", "https://youtu.be/jNQXAC9IVRw", "https://m.youtube.com/shorts/18NGQq7p3LY", "https://youtube.com/watch?v=x",
                   "https://notmusic.youtube.com/watch?v=x", "https://www.youtube.com/watch?v=x&feature=music", "https://example.com/?u=https://music.youtube.com/",
                   "https://music.youtube.com@evil.example/", "https://www.tiktok.com/@a/video/123", "https://x.com/a/status/1", "", "pas un lien", "https://"]) {
    assert.equal(isYouTubeMusicUrl(u), false, u);
  }
  for (const junk of [undefined, null, 42, {}, [], "x".repeat(5000)]) assert.equal(isYouTubeMusicUrl(junk), false);
});
