import { describe, expect, it } from "vitest";
import { plateformeDe } from "./lien";
import { dateCarte } from "./format";

describe("Coller un lien : plateforme reconnue", () => {
  it("YouTube, TikTok, X (avec ou sans https, sous-domaines mobiles)", () => {
    expect(plateformeDe("https://www.youtube.com/watch?v=abc")).toBe("YouTube");
    expect(plateformeDe("youtu.be/abc")).toBe("YouTube");
    expect(plateformeDe("https://m.youtube.com/shorts/abc")).toBe("YouTube");
    expect(plateformeDe("https://www.tiktok.com/@a/video/1")).toBe("TikTok");
    expect(plateformeDe("https://vm.tiktok.com/xyz")).toBe("TikTok");
    expect(plateformeDe("https://x.com/a/status/1")).toBe("X");
    expect(plateformeDe("twitter.com/a/status/1")).toBe("X");
  });
  it("rien pour un texte quelconque ou un autre site", () => {
    expect(plateformeDe("")).toBeNull();
    expect(plateformeDe("bonjour")).toBeNull();
    expect(plateformeDe("https://exemple.fr/youtube.com")).toBeNull();
    expect(plateformeDe("https://notyoutube.com/x")).toBeNull();
  });
  it("date de carte : « 23 oct. » cette année, l'année sinon", () => {
    const n = new Date("2026-10-25T12:00:00");
    expect(dateCarte("2026-10-23T10:00:00", n)).toBe("23 oct.");
    expect(dateCarte("2025-10-23T10:00:00", n)).toBe("23 oct. 2025");
  });
});
