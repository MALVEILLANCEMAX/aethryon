// Catalogue des plateformes au collage d'un lien (remplace lib/lien.ts : mêmes cas YouTube / TikTok / X, plus l'état
// RÉEL de chaque plateforme du registre). Source : docs/api/CATALOGUE-PLATEFORMES.json (même registre que l'API).
import { describe, expect, it } from "vitest";
import brut from "../../../../docs/api/CATALOGUE-PLATEFORMES.json";
import conversion from "../../noyau/src/conversion.rs?raw";
import { detecter, hoteDe, parCategorie, statutDe, type Catalogue, type EntreeCatalogue } from "./plateformes";
import { dateCarte } from "./format";

const c: Catalogue = { version: brut.version, categories: brut.categories, plateformes: brut.plateformes as EntreeCatalogue[] };
const d = (lien: string) => detecter(lien, c);

describe("Coller un lien : plateforme reconnue (catalogue des interfaces)", () => {
  it("YouTube, TikTok, X (avec ou sans https, sous-domaines mobiles) : en ligne, MP4 / MP3 / GIF / extrait", () => {
    for (const [lien, nom] of [["https://www.youtube.com/watch?v=abc", "YouTube"], ["youtu.be/abc", "YouTube"], ["https://m.youtube.com/shorts/abc", "YouTube"],
      ["https://www.tiktok.com/@a/video/1", "TikTok"], ["https://vm.tiktok.com/xyz", "TikTok"], ["https://x.com/a/status/1", "X"], ["twitter.com/a/status/1", "X"]]) {
      const p = d(lien)!;
      expect(p.nom, lien).toBe(nom);
      expect(p.statut).toBe("en-ligne");
      expect(p.convertible).toBe(true);
      expect(p.formats.every((f) => f.ok)).toBe(true);
    }
  });
  it("Bluesky et Wikimedia Commons : ouvertes en production, MP4 / MP3 / GIF, extraits fermés AVEC leur raison ; Wikimedia : attribution", () => {
    const b = d("https://bsky.app/profile/a.bsky.social/post/3l2x")!;
    const w = d("commons.wikimedia.org/wiki/File:Chouette.webm")!;
    for (const p of [b, w]) {
      expect(p.statut).toBe("en-ligne");
      expect(p.convertible).toBe(true);
      expect(p.formats.filter((f) => f.ok).map((f) => f.id)).toEqual(["mp4", "mp3", "gif"]);
      expect(p.formats.find((f) => f.id === "extrait")!.raison).toMatch(/extraits désactivés/);
    }
    expect(b.attribution).toBe(false);
    expect(w.attribution).toBe(true);
  });
  it("les autres gardent l'état du registre : en préparation, indisponible, refusée (raison du registre)", () => {
    expect(d("https://www.instagram.com/reel/x")!.statut).toBe("preparation");
    expect(d("https://archive.org/details/x")!.statut).toBe("preparation");
    expect(d("https://www.facebook.com/watch?v=1")!.statut).toBe("indisponible");
    const s = d("https://open.spotify.com/track/x")!;
    expect(s.statut).toBe("refusee");
    expect(s.convertible).toBe(false);
    expect(s.raison).toMatch(/DRM/);
    // Le domaine le plus précis l'emporte : YouTube Music est refusé, YouTube est en ligne.
    expect(d("https://music.youtube.com/watch?v=x")!.id).toBe("youtube_music");
    expect(d("https://music.youtube.com/watch?v=x")!.statut).toBe("refusee");
    for (const p of c.plateformes) if (p.statut === "prete_a_ouvrir") expect(statutDe(p), p.id).toBe("en-ligne");
  });
  it("rien pour un texte quelconque ou un autre site ; hôte sans « www. »", () => {
    for (const x of ["", "bonjour", "https://exemple.fr/youtube.com", "https://notyoutube.com/x", "javascript:alert(1)", "ftp://youtube.com/x"]) expect(d(x), x).toBeNull();
    expect(hoteDe("https://WWW.YouTube.com/x")).toBe("youtube.com");
  });
  it("AETHRYON Desktop convertit EXACTEMENT les plateformes en ligne : mêmes domaines que le cœur Rust (conversion.rs)", () => {
    const rust = new Set([...conversion.matchAll(/\("([a-z0-9.-]+)", "([a-z]+)"\)/g)].map((m) => m[1]));
    const enLigne = new Set(c.plateformes.filter((p) => statutDe(p) === "en-ligne").flatMap((p) => p.domaines));
    expect([...rust].sort()).toEqual([...enLigne].sort());
  });
  it("le dialogue range toutes les plateformes dans les quatre catégories, aucun logo (pictogrammes neutres)", () => {
    const g = parCategorie(c);
    expect(g.map((x) => x.nom)).toEqual(["Populaires", "Musique", "Streaming", "Autres"]);
    expect(g.reduce((n, x) => n + x.plateformes.length, 0)).toBe(c.plateformes.length);
    expect(new Set(g.flatMap((x) => x.plateformes.map((p) => p.icone)))).toEqual(new Set(["video", "vertical", "post", "image", "direct", "archive", "onde"]));
  });
  it("date de carte : « 23 oct. » cette année, l'année sinon", () => {
    const n = new Date("2026-10-25T12:00:00");
    expect(dateCarte("2026-10-23T10:00:00", n)).toBe("23 oct.");
    expect(dateCarte("2025-10-23T10:00:00", n)).toBe("23 oct. 2025");
  });
});
