// Couverture d'un média sans miniature (audio, fichier pas encore analysé) : deux orbes chaudes dont les teintes et la
// place viennent du NOM (toujours les mêmes pour un même fichier) et le pictogramme du type (le format est sur le
// badge). Ce n'est jamais une fausse pochette : aucun titre, artiste ni image inventés.
import type { CSSProperties } from "react";
import type { Media } from "../lib/types";
import { Icone } from "./base";

// Teintes harmonieuses (or, cuivre, ambre, rose poudré, prune, acier) ; la seconde orbe est ANALOGUE (+ 24 à 54°).
const TEINTES = [34, 22, 42, 350, 284, 212];

export function empreinte(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function styleCouverture(nom: string): CSSProperties {
  const h = empreinte(nom);
  const a = TEINTES[h % TEINTES.length];
  const b = (a + 24 + ((h >>> 4) % 31)) % 360;
  return {
    ["--h" as string]: a, ["--h2" as string]: b,
    ["--cx" as string]: `${20 + ((h >>> 8) % 30)}%`, ["--cy" as string]: `${18 + ((h >>> 12) % 30)}%`,
    ["--dx" as string]: `${62 + ((h >>> 16) % 30)}%`, ["--dy" as string]: `${60 + ((h >>> 20) % 32)}%`,
  };
}

export function Couverture({ m, taille = 28 }: { m: Pick<Media, "nom" | "type">; taille?: number }) {
  return (
    <div className="couv" style={styleCouverture(m.nom)} aria-hidden="true">
      <Icone nom={m.type === "audio" ? "note" : m.type === "image" ? "image" : "film"} taille={taille} />
    </div>
  );
}
