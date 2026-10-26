import { describe, expect, it } from "vitest";
import { analyserLien, estHoteYouTubeMusic, estLienYouTubeMusic, plateformeProbable, raisonRefus, miniatureSure } from "../../src/lib/urls";
import { duree, lireDuree, taille, typo, codeTemporel, pluriel, NB, FINE } from "../../src/lib/format";

describe("reconnaissance des liens", () => {
  it("reconnaît YouTube (watch, youtu.be, Shorts), TikTok et X, et normalise l'adresse", () => {
    expect(analyserLien("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc")).toMatchObject({ plateforme: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(analyserLien("youtu.be/dQw4w9WgXcQ")).toMatchObject({ plateforme: "youtube", id: "dQw4w9WgXcQ" });
    expect(analyserLien("https://youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ genre: "short" });
    expect(analyserLien("https://www.tiktok.com/@nom.utilisateur/video/7234567890123456789?lang=fr")).toMatchObject({ plateforme: "tiktok", url: "https://www.tiktok.com/@nom.utilisateur/video/7234567890123456789" });
    expect(analyserLien("https://vm.tiktok.com/ZMabcdef/")).toMatchObject({ plateforme: "tiktok", genre: "shortlink" });
    expect(analyserLien("https://twitter.com/compte/status/1712345678901234567")).toMatchObject({ plateforme: "twitter", url: "https://x.com/compte/status/1712345678901234567" });
    expect(analyserLien("https://x.com/compte/status/1712345678901234567/video/2")).toMatchObject({ rang: 2 });
  });
  it("refuse chaînes, playlists, diaporamas, autres sites et ports exotiques", () => {
    for (const l of ["https://www.youtube.com/@chaine", "https://www.youtube.com/playlist?list=PL123", "https://www.tiktok.com/@a/photo/7234567890123456789", "https://vimeo.com/123", "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://user:pass@x.com/a/status/1712345678901234567"]) {
      expect(analyserLien(l)).toBeNull();
    }
    expect(plateformeProbable("youtube.com/@chaine")).toBe("youtube");
    expect(raisonRefus("https://www.youtube.com/@chaine")).toMatch(/pas une vidéo/);
  });
  it("YouTube Music (fermé le 2026-10-23) : jamais un média, refusé avec le texte du service ; les liens classiques voisins restent reconnus", () => {
    const musique = ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "http://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://MUSIC.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com./watch?v=dQw4w9WgXcQ", "https://music.youtube.com:443/watch?v=dQw4w9WgXcQ", "https://m.music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.music.youtube.com/playlist?list=PLx", "https://music.youtube.com/", "music.youtube.com/watch?v=dQw4w9WgXcQ", "  https://music.youtube.com/watch?v=dQw4w9WgXcQ  ",
      "https://music.youtu.be/dQw4w9WgXcQ", "https://youtubemusic.com/"];
    for (const l of musique) {
      expect(analyserLien(l), l).toBeNull();
      expect(estLienYouTubeMusic(l), l).toBe(true);
      expect(raisonRefus(l).replace(/\u00a0/g, " "), l).toBe("Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.");
    }
    for (const l of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ"]) {
      expect(analyserLien(l), l).not.toBeNull();
      expect(estLienYouTubeMusic(l), l).toBe(false);
    }
    expect(estLienYouTubeMusic("https://notmusic.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(estHoteYouTubeMusic("music.youtube.com.evil.example")).toBe(false);
    expect(raisonRefus("https://www.youtube.com/@chaine")).toMatch(/pas une vidéo/);
  });
  it("n'accepte que les miniatures https des CDN des plateformes", () => {
    expect(miniatureSure("https://i.ytimg.com/vi/x/mqdefault.jpg")).toBeTruthy();
    expect(miniatureSure("http://i.ytimg.com/vi/x.jpg")).toBeNull();
    expect(miniatureSure("https://exemple.com/x.jpg")).toBeNull();
  });
});

describe("mise en forme française", () => {
  it("durées, tailles, codes temporels", () => {
    expect(duree(75)).toBe("1:15");
    expect(duree(3725)).toBe("1:02:05");
    expect(lireDuree("1:05")).toBe(65);
    expect(lireDuree("75,5")).toBe(75.5);
    expect(lireDuree("1:75")).toBeNull();
    expect(taille(845312)).toBe(`826${NB}Ko`);
    expect(taille(1610612736)).toBe(`1,5${NB}Go`);
    expect(codeTemporel(4.2, 30)).toBe("00:00:04:06");
    expect(pluriel(1, "élément")).toBe(`1${NB}élément`);
    expect(pluriel(3, "élément")).toBe(`3${NB}éléments`);
  });
  it("typographie : espaces insécables avant : ; ! ? et dans les guillemets", () => {
    expect(typo("Erreur : réessaie ! Vraiment ? « AETHRYON » 12 Mo")).toBe(`Erreur${NB}: réessaie${FINE}! Vraiment${FINE}? «${NB}AETHRYON${NB}» 12${NB}Mo`);
  });
});
