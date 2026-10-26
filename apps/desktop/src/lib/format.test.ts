import { describe, expect, it } from "vitest";
import { cadence, codeTemporel, dateLongue, definition, dossierAmical, duree, FINE, NBSP, nombre, quand, quandPhrase, taille, typo } from "./format";

describe("typographie française", () => {
  it("espaces insécables et fines", () => {
    expect(typo("Prêt ? Oui !")).toBe(`Prêt${FINE}? Oui${FINE}!`);
    expect(typo("Version : 1.0")).toBe(`Version${NBSP}: 1.0`);
    expect(typo("« Paris »")).toBe(`«${NBSP}Paris${NBSP}»`);
    expect(typo("826 Ko · 30 i/s · 64 %")).toBe(`826${NBSP}Ko · 30${NBSP}i/s · 64${NBSP}%`);
    expect(typo("2 sur 3")).toBe(`2${NBSP}sur 3`);
  });
});

describe("tailles et nombres", () => {
  it("unités binaires comme l'Explorateur", () => {
    expect(taille(845654)).toBe(`826${NBSP}Ko`);
    expect(taille(23173529)).toBe(`22,1${NBSP}Mo`);
    expect(taille(512)).toBe(`512${NBSP}octets`);
    expect(taille(182 * 1024 ** 3)).toBe(`182${NBSP}Go`);
    expect(taille(-1)).toBe("—");
    expect(nombre(845654)).toBe(`845${FINE}654`);
  });
});

describe("durées et codes temporels", () => {
  it("durée de carte", () => {
    expect(duree(12)).toBe("0:12");
    expect(duree(38.4)).toBe("0:38");
    expect(duree(3725)).toBe("1:02:05");
    expect(duree(null)).toBe("—");
  });
  it("code temporel de montage", () => {
    expect(codeTemporel(4.2, 30)).toBe("00:00:04:06");
    expect(codeTemporel(12, 30)).toBe("00:00:12:00");
    expect(codeTemporel(7.45, 30)).toBe("00:00:07:13");
    expect(codeTemporel(4.2, null)).toBe("00:00:04");
    expect(codeTemporel(59.999, 25)).toBe("00:00:59:24");
  });
  it("cadence et définition", () => {
    expect(cadence(30)).toBe(`30${NBSP}i/s`);
    expect(cadence(29.97)).toBe(`29,97${NBSP}i/s`);
    expect(cadence(null)).toBeNull();
    expect(definition(1280, 720)).toBe(`1280${NBSP}×${NBSP}720`);
    expect(definition(null, 720)).toBeNull();
  });
});

describe("dates", () => {
  const maintenant = new Date(2026, 9, 18, 3, 0, 0);
  it("relatives", () => {
    expect(quand(new Date(2026, 9, 18, 1, 12).toISOString(), maintenant)).toBe("Aujourd'hui, 01:12");
    expect(quand(new Date(2026, 9, 17, 22, 40).toISOString(), maintenant)).toBe("Hier, 22:40");
    expect(quand(new Date(2026, 9, 12, 9, 5).toISOString(), maintenant)).toBe(`12${NBSP}oct., 09:05`);
    expect(quandPhrase(new Date(2026, 9, 18, 1, 12).toISOString(), maintenant)).toBe("aujourd'hui à 01:12");
    expect(quand("pas une date")).toBe("—");
  });
  it("date longue", () => {
    expect(dateLongue(maintenant)).toBe(`Dimanche 18${NBSP}octobre`); // le 18 octobre 2026 est un dimanche
  });
});

describe("dossiers amicaux", () => {
  it("noms français des dossiers connus", () => {
    expect(dossierAmical("C:\\Users\\Élodie\\Videos\\AETHRYON")).toBe("Vidéos › AETHRYON");
    expect(dossierAmical("C:\\Users\\Élodie\\Downloads\\AETHRYON")).toBe("Téléchargements › AETHRYON");
    expect(dossierAmical("D:\\Rushes\\Voyage")).toBe("Rushes › Voyage");
  });
});
