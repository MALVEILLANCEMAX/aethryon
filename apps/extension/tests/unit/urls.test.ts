import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaKey, parseMediaUrl, platformOfHost, safeThumbnail } from "../../src/shared/urls.ts";

const ok: [string, string, string, string?][] = [
  // [entrée, plateforme, URL canonique, type]
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s&si=abc", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["http://youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://youtu.be/dQw4w9WgXcQ?si=xyz", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://www.youtube.com/shorts/v-HVEZ_WRBY", "youtube", "https://www.youtube.com/shorts/v-HVEZ_WRBY", "short"],
  ["https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc", "tiktok", "https://www.tiktok.com/@scout2015/video/6718335390845095173", "video"],
  ["https://vm.tiktok.com/ZMabc123/", "tiktok", "https://vm.tiktok.com/ZMabc123/", "shortlink"],
  ["https://vt.tiktok.com/ZSe4FqkKd", "tiktok", "https://vt.tiktok.com/ZSe4FqkKd/", "shortlink"],
  ["https://www.tiktok.com/t/ZTRC5xgJp/", "tiktok", "https://www.tiktok.com/t/ZTRC5xgJp/", "shortlink"],
  ["https://x.com/historyinmemes/status/1790637656616943991", "twitter", "https://x.com/historyinmemes/status/1790637656616943991", "post"],
  ["https://twitter.com/historyinmemes/status/1790637656616943991?s=20", "twitter", "https://x.com/historyinmemes/status/1790637656616943991", "post"],
  ["https://mobile.twitter.com/a_b/status/1790637656616943991", "twitter", "https://x.com/a_b/status/1790637656616943991", "post"],
];

test("liens pris en charge : plateforme, URL canonique sans suivi, type", () => {
  for (const [input, platform, url, kind] of ok) {
    const r = parseMediaUrl(input);
    assert.ok(r, input);
    assert.equal(r.platform, platform, input);
    assert.equal(r.url, url, input);
    if (kind) assert.equal(r.kind, kind, input);
  }
});

test("X : /video/<n> donne l'index de la vidéo dans la publication", () => {
  const r = parseMediaUrl("https://x.com/a/status/1790637656616943991/video/2");
  assert.equal(r?.index, 2);
  assert.equal(r?.url, "https://x.com/a/status/1790637656616943991");
  assert.equal(mediaKey(r!), "twitter:1790637656616943991#2");
});

test("YouTube Music (fermé le 2026-10-23) : aucun lien reconnu, aucun hôte avec content script ; les liens classiques voisins restent reconnus", () => {
  for (const link of [
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ", "http://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://MUSIC.YOUTUBE.COM/watch?v=dQw4w9WgXcQ", "https://music.youtube.com./watch?v=dQw4w9WgXcQ", "https://music.youtube.com:443/watch?v=dQw4w9WgXcQ",
    "https://www.music.youtube.com/watch?v=dQw4w9WgXcQ", "https://m.music.youtube.com/watch?v=dQw4w9WgXcQ", "https://music.youtube.com/playlist?list=PLx",
    "https://music.youtube.com/", "https://music.youtu.be/dQw4w9WgXcQ", "https://youtubemusic.com/", "music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
  ]) assert.equal(parseMediaUrl(link), null, link);
  for (const host of ["music.youtube.com", "MUSIC.YOUTUBE.COM", "m.music.youtube.com", "www.music.youtube.com", "music.youtu.be", "youtubemusic.com", "notmusic.youtube.com"]) {
    assert.equal(platformOfHost(host), null, host);
  }
  assert.equal(platformOfHost("www.youtube.com"), "youtube");
  assert.equal(platformOfHost("m.youtube.com"), "youtube");
  assert.equal(parseMediaUrl("https://youtu.be/dQw4w9WgXcQ")?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(parseMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ&feature=music")?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("liens refusés (hors périmètre, malformés, dangereux)", () => {
  for (const bad of [
    "https://www.instagram.com/reel/Cxyz/",                       // Instagram : non pris en charge
    "https://www.youtube.com/watch?v=short",                      // identifiant invalide
    "https://www.youtube.com/channel/UC123",                      // chaîne
    "https://www.youtube.com/playlist?list=PL123",                // playlist
    "https://www.youtube.com/live/dQw4w9WgXcQ",                   // direct
    "https://www.youtube.com/shorts/dQw4w9WgXcQ/extra",
    "https://www.tiktok.com/@scout2015/photo/6718335390845095173", // diaporama
    "https://www.tiktok.com/@scout2015",                           // profil
    "https://www.tiktok.com/",                                     // accueil
    "https://x.com/home",
    "https://x.com/a/status/123/photo/1",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "chrome-extension://abc/popup.html",
    "",
    "x".repeat(3000),
  ]) assert.equal(parseMediaUrl(bad), null, bad);
});

test("hôtes des content scripts", () => {
  assert.equal(platformOfHost("www.youtube.com"), "youtube");
  assert.equal(platformOfHost("WWW.TIKTOK.COM"), "tiktok");
  assert.equal(platformOfHost("twitter.com"), "twitter");
  assert.equal(platformOfHost("www.instagram.com"), null);
});

test("miniatures : seulement les CDN des plateformes, en https", () => {
  assert.ok(safeThumbnail("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
  assert.ok(safeThumbnail("https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg"));
  assert.ok(safeThumbnail("https://p16-sign-va.tiktokcdn.com/obj/x.jpeg"));
  assert.ok(safeThumbnail("https://p16-sign.tiktokcdn-us.com/obj/x.jpeg"));
  for (const bad of ["http://i.ytimg.com/x.jpg", "https://evil.example/x.jpg", "https://i.ytimg.com.evil.example/x.jpg", "data:image/png;base64,AAAA", 42]) {
    assert.equal(safeThumbnail(bad), null, String(bad));
  }
});

test("YouTube fait partie du périmètre de la version distribuée (aucune variante « sans YouTube »)", async () => {
  const on = await import("../../src/shared/youtube-urls.ts");
  const u = new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(on.parseYouTube("www.youtube.com", ["watch"], u)?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(on.parseYouTube("www.tiktok.com", ["@a", "video", "1"], new URL("https://www.tiktok.com/@a/video/1")), undefined);
  const p = await import("../../src/shared/platforms.ts");
  assert.deepEqual([p.BUILD_PLATFORMS, p.PLATFORMS_OR, p.PLATFORMS_AND], [["youtube", "tiktok", "twitter"], "YouTube, TikTok ou X", "YouTube, TikTok et X"]);
});
