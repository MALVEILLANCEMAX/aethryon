// Page d'accueil AETHRYON — refonte visuelle V2 (2026-10-11) : moins de texte, le produit montré.
// Rythme : obsidienne (héros : la promesse, le champ « colle un lien », les plateformes, puis le film de lancement
// AETHRYON 3.5 de 38 s, comme sur ton-piston.com) → ivoire (les trois façons de l'utiliser, cartes illustrées) → obsidienne (ce qui sort :
// le parcours animé, MP4 et MP3 portés par leurs reliques 3D) → perle (le tarif réel) → ivoire (feuille de
// route, questions) → obsidienne (appel final). Revue produit du 2026-10-15 : plus d'annonce flottante en bas à droite
// (elle doublait la pastille « Nouveau » du héros et couvrait le contenu) ; Tools rejoint les façons de l'utiliser.
import { useDocumentTitle } from "../lib/hooks.ts";
import { Faq } from "./Faq.tsx";
import { FinalCta } from "./FinalCta.tsx";
import { Hero } from "./Hero.tsx";
import { Roadmap } from "./Roadmap.tsx";
import { Formats } from "./v2/Formats.tsx";
import { Surfaces } from "./v2/Surfaces.tsx";
import { Tarifs } from "./v2/Tarifs.tsx";

export function Landing() {
  useDocumentTitle("");
  return (
    <>
      <Hero />
      <Surfaces />
      <Formats />
      <Tarifs />
      <Roadmap />
      <Faq />
      <FinalCta />
    </>
  );
}
