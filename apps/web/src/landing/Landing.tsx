// Page d'accueil AETHRYON, Égide v2 (direction validée par le propriétaire le 2026-10-26 ; référence : la démonstration
// docs/design/demo-egide). Rythme : le héros (la promesse et LA SCÈNE, démonstration interactive du vrai parcours), le
// film de lancement « Le Passage » (œuvre du propriétaire, sa propre section), les endroits où l'utiliser, le catalogue
// des plateformes (états réels), les six thèmes, les offres (ventes fermées), les nouveautés et les questions.
import { useDocumentTitle } from "../lib/hooks.ts";
import { Faq } from "./Faq.tsx";
import { Hero } from "./Hero.tsx";
import { Roadmap } from "./Roadmap.tsx";
import { Catalogue } from "./egide/Catalogue.tsx";
import { Stations } from "./egide/Stations.tsx";
import { CartesThemes } from "./egide/Themes.tsx";
import { Film } from "./v2/Film.tsx";
import { Tarifs } from "./v2/Tarifs.tsx";

function SectionFilm() {
  return (
    <section id="film" aria-labelledby="t-film" className="s-section s-film">
      <div className="s-section-tete">
        <h2 id="t-film" className="eg-titre s-h2">Le Passage</h2>
        <p>Le film de lancement d'AETHRYON 3.5, en 38 secondes.</p>
      </div>
      <Film />
    </section>
  );
}

export function Landing() {
  useDocumentTitle("");
  return (
    <div className="s-accueil">
      <span id="demo" aria-hidden="true" />
      <Hero />
      <SectionFilm />
      <Stations />
      <Catalogue />
      <CartesThemes />
      <Tarifs />
      <Roadmap />
      <Faq />
    </div>
  );
}
