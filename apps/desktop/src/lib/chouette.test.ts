// La chouette « Nocturne » doit garder la GÉOMÉTRIE du dessin maître du propriétaire, au caractère près : seuls
// l'éclairage (dégradés, reflet, ombre) et la profondeur (plans décalés) sont ajoutés.
import { describe, expect, it } from "vitest";
import officiel from "../assets/brand/aethryon-master.svg?raw";
import { REFLETS_CHOUETTE, TRACES_CHOUETTE } from "../ui/chouette";
import { MARQUE } from "../ui/marque-donnees";

const traces = (svg: string) => new Map([...svg.matchAll(/<path id="([a-z-]+)" d="([^"]+)"/g)].map((m) => [m[1], m[2]]));
const ids: Record<keyof typeof TRACES_CHOUETTE, string> = {
  shell: "shell", faceLeft: "face-left", faceRight: "face-right", eyeLeft: "eye-left", eyeRight: "eye-right",
  browLeft: "brow-left", browRight: "brow-right", browLine: "brow-line", beakLeft: "beak-left", beakRight: "beak-right",
};

describe("chouette Nocturne : même géométrie que le dessin maître", () => {
  it("chaque tracé est identique au fichier officiel aethryon-master.svg et à la marque embarquée", () => {
    const fichier = traces(officiel);
    const marque = traces(MARQUE.master.body.replace(/\\"/g, '"'));
    expect(fichier.size).toBe(10);
    for (const [cle, id] of Object.entries(ids)) {
      expect(TRACES_CHOUETTE[cle as keyof typeof TRACES_CHOUETTE], id).toBe(fichier.get(id));
      expect(TRACES_CHOUETTE[cle as keyof typeof TRACES_CHOUETTE], id).toBe(marque.get(id));
    }
  });
  it("les reflets des yeux sont les cercles du dessin maître", () => {
    for (const r of REFLETS_CHOUETTE) expect(officiel).toContain(`<circle id="${r.id}" cx="${r.cx}" cy="${r.cy}" r="${r.r}"`);
  });
});
