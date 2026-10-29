// Page introuvable (« Le Passage », pages, 2026-10-28) : le fil d'or s'interrompt, effiloché ; au bout, la relique
// (le cube grec au sceau, objet 3D PS1 qui se tourne vers le pointeur, image fixe sans WebGL ni mouvement) ; puis les
// portes principales en tuiles. Aucune trace technique.
import { useDocumentTitle } from "../lib/hooks.ts";
import { TuileGlyphe, TuileProduit } from "../ui/brand/TuileProduit.tsx";
import { Etiquette } from "../ui/egide/Egide.tsx";
import { Portes } from "../ui/passage/Passage.tsx";
import { RetroObject } from "../ui/retro/RetroObject.tsx";

export default function NotFound() {
  useDocumentTitle("Page introuvable");
  return (
    <section className="container-site nf pb-24 pt-28 sm:pt-36">
      <div className="nf-scene" aria-hidden="true">
        <svg className="nf-fil" viewBox="0 0 530 120" preserveAspectRatio="xMinYMid meet" focusable="false">
          <path className="nf-trace" pathLength={1} d="M0 72 C 90 72 120 40 210 46 S 330 92 420 70 S 470 52 492 58" />
          <path className="nf-brin" pathLength={1} d="M492 58 c 8 2 15 -4 22 -10" />
          <path className="nf-brin" pathLength={1} d="M492 58 c 9 4 16 8 24 6" />
          <path className="nf-brin" pathLength={1} d="M492 58 c 6 -6 9 -14 9 -22" />
          <circle className="nf-noeud" cx="3" cy="72" r="4" />
        </svg>
        <RetroObject kind="cube" size="sm" follow className="nf-relique" />
      </div>
      <Etiquette ton="accent">Erreur 404</Etiquette>
      <h1 className="page-title mt-4">Cette page n’existe pas.</h1>
      <p className="mt-3 max-w-md text-corps leading-relaxed text-ink-soft">Le lien est peut-être incomplet. Reprends par l'une de ces portes.</p>
      <Portes label="Pages principales" className="mt-8 max-w-4xl" items={[
        { to: "/", titre: "Accueil", note: "Un lien entre, un fichier sort", tuile: <TuileProduit produit="web" size={44} /> },
        { to: "/installer", titre: "Raccourci iPhone", note: "Installer en cinq étapes", tuile: <TuileProduit produit="iphone" size={44} /> },
        { to: "/extension", titre: "Extension navigateur", note: "Chrome, Edge, Brave", tuile: <TuileProduit produit="extension" size={44} /> },
        { to: "/outils", titre: "AETHRYON Tools", note: "Couper, recadrer, GIF", tuile: <TuileProduit produit="tools" size={44} /> },
        { to: "/aide", titre: "Aide", note: "Problèmes courants", tuile: <TuileGlyphe glyphe="bouee" size={44} /> },
      ]} />
    </section>
  );
}
