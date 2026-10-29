// Labo de développement des objets rétro (scripts/retro-labo.html) : aucune incidence sur le site.
import { buildObject, type RetroKind } from "./objects.ts";
import { RetroRenderer } from "./renderer.ts";
import { STILL_T } from "./RetroObject.tsx";

const KINDS: RetroKind[] = ["cube", "disquette", "disque", "sablier", "cookie"];
const LABELS: Record<RetroKind, string> = { cube: "", disquette: "MP4", disque: "MP3", sablier: "", cookie: "" };
const root = document.getElementById("labo")!;
const renderers = new Map<string, RetroRenderer>();

for (const tone of ["sombre", "clair"]) {
  for (const kind of KINDS) {
    const cell = document.createElement("div");
    cell.className = `cell ${tone}`;
    const c = document.createElement("canvas");
    c.width = c.height = 100;
    c.dataset.kind = kind;
    cell.append(c);
    root.append(cell);
    const r = new RetroRenderer(c, buildObject(kind, LABELS[kind]));
    r.still(STILL_T[kind]);
    renderers.set(`${tone}:${kind}`, r);
  }
}

declare global {
  interface Window {
    retroAt: (t: number) => void;
    retroPlay: () => void;
    retroPoster: (kind: RetroKind, size: number) => string;
  }
}

/** Toutes les vues à l'instant t (captures comparées : l'objet tourne-t-il vraiment ?). */
window.retroAt = (t) => { for (const r of renderers.values()) r.still(t); };
window.retroPlay = () => { for (const r of renderers.values()) r.start(); };
/** Affiche fixe (PNG transparent) d'un objet, rendue à la résolution `size` px (agrandie au pixel ensuite). */
window.retroPoster = (kind, size) => {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const r = new RetroRenderer(c, buildObject(kind, LABELS[kind]));
  r.still(STILL_T[kind]);
  const url = c.toDataURL("image/png");
  r.dispose();
  return url;
};
