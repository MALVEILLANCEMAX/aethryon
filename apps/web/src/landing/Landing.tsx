// Page d'accueil AETHRYON (2026-10-29 ; composition de référence : Datenshi, docs/DESIGN.md §0) : un petit ensemble au
// centre — l'identité, une phrase, le champ du lien, l'action, trois formats — et autour, beaucoup d'espace et deux grandes
// ailes de chouette en trame de points, dans des coins opposés. Le champ mène au vrai parcours (AETHRYON Tools) et
// s'agrandit pour ses états. Sous le premier écran, une courte partie informative : les applications, les plateformes,
// l'offre et les questions ; le panneau du menu y mène. Ont quitté l'accueil : la démonstration à données fictives, le
// film (lien du pied de page), la vitrine des six thèmes (menu du thème).
import { lazy, Suspense, useEffect, useState } from "react";
import { useDocumentTitle } from "../lib/hooks.ts";
import { useT } from "../i18n/accueil.ts";
import { Icone } from "../ui/egide/Egide.tsx";
import { Convertisseur } from "./accueil/Convertisseur.tsx";
import { Faq } from "./Faq.tsx";
import { Catalogue } from "./egide/Catalogue.tsx";
import { Stations } from "./egide/Stations.tsx";
import { Tarifs } from "./v2/Tarifs.tsx";

const Ailes = lazy(() => import("./accueil/Ailes.tsx"));

export function Landing() {
  useDocumentTitle("");
  const t = useT();
  // Le décor arrive après le premier rendu (son propre fichier) : le champ est là d'abord.
  const [monte, setMonte] = useState(false);
  useEffect(() => { setMonte(true); }, []);
  return (
    <div className="ac">
      <section className="ac-scene" data-hero="" aria-labelledby="hero-title">
        {/* Anciennes ancres de l'accueil (/#demo, /#film, /#comment) : elles mènent au champ. */}
        <span id="demo" aria-hidden="true" /><span id="film" aria-hidden="true" /><span id="comment" aria-hidden="true" />
        {monte && <Suspense fallback={null}><Ailes /></Suspense>}
        <Convertisseur entree={
          <>
            <p className="ac-marque">AETHRYON</p>
            <h1 id="hero-title" className="ac-titre">{t.titre}</h1>
            <p className="ac-phrase">{t.phrase}</p>
          </>
        } />
        <a href="#applications" className="ac-descendre">{t.descendre}<Icone nom="bas" taille="s" /></a>
      </section>
      <div className="at-accueil ac-infos">
        <Stations />
        <Catalogue />
        <Tarifs />
        <Faq />
      </div>
    </div>
  );
}
