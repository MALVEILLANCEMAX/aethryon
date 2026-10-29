// Pages juridiques publiques pré-rendues : conditions générales de vente (/cgv), mentions légales (/mentions-legales),
// politique de remboursement (/remboursement). Texte : src/legal/*.md, lu par src/legal/doc.tsx ; informations de
// l'entreprise : lib/legal.tsx. Tant qu'elles ne sont pas toutes fournies (production), aucune page incomplète : une
// annonce honnête, comme /conditions, et le lien vers les autres pages juridiques (« Le Passage »). Aucune animation
// en dehors du fil de l'en-tête.
import { Link } from "react-router";
import { useDocumentTitle } from "../lib/hooks.ts";
import { LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { inline, LegalBody, outline, type Block } from "../legal/doc.tsx";
import { TuileGlyphe } from "../ui/brand/TuileProduit.tsx";
import type { NomPlein } from "../ui/ph/ph.ts";
import { Pastille } from "../ui/egide/Egide.tsx";
import { Frontispice, Portes } from "../ui/passage/Passage.tsx";
import { Sommaire } from "../ui/passage/Sommaire.tsx";

/** Emblème de chaque page juridique (glyphe Phosphor plein, tuile obsidienne). */
const EMBLEME: Record<string, NomPlein> = { conditions: "balance", cgv: "recu", "mentions-legales": "identite", remboursement: "document", confidentialite: "bouclier" };

/** Les pages juridiques entre elles (« Le Passage ») : la confidentialité est publiée ; les autres le seront ensemble,
 *  avec les informations de l'entreprise (lib/legal.tsx). La page courante est marquée, sans lien. */
export function PagesLegales({ actuelle }: { actuelle: string }) {
  const pages: [string, string, string][] = [
    ["confidentialite", "/confidentialite", "Confidentialité"], ["conditions", "/conditions", "Conditions d'utilisation"],
    ["cgv", "/cgv", "Conditions générales de vente"], ["mentions-legales", "/mentions-legales", "Mentions légales"], ["remboursement", "/remboursement", "Remboursement"],
  ];
  return (
    <Portes label="Pages juridiques" className="mt-10" items={pages.map(([id, to, titre]) => ({
      to, titre, actuelle: id === actuelle, tuile: <TuileGlyphe glyphe={EMBLEME[id]!} size={44} />,
      note: id === "confidentialite" || LEGAL_PUBLISHED ? "Publiée" : "En préparation",
    }))} />
  );
}

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

export function LegalPage({ title, blocks, waiting, attr }: { title: string; blocks: Block[]; waiting: string; attr: string }) {
  useDocumentTitle(title);
  if (!LEGAL_PUBLISHED) {
    return (
      <div className="container-site pb-24 pt-28 sm:pt-36" data-legal-attente={attr}>
        <Frontispice embleme={<TuileGlyphe glyphe={EMBLEME[attr] ?? "document"} size={72} />} titre={title}
          aside={<Pastille ton="accent" icone="horloge">En préparation</Pastille>} />
        <p className="lg-attente">
          {waiting} Ce que le service conserve et comment tout effacer est déjà décrit sur la page{" "}
          <Link to="/confidentialite" className={link}>Confidentialité</Link>.
        </p>
        <PagesLegales actuelle={attr} />
      </div>
    );
  }
  const h1 = blocks.find((b) => b.t === "h1");
  const toc = outline(blocks);
  return (
    <div className="container-site pb-24 pt-28 sm:pt-36" data-legal-page={attr}>
      <Frontispice embleme={<TuileGlyphe glyphe={EMBLEME[attr] ?? "document"} size={72} />} titre={h1 && "text" in h1 ? inline(h1.text, "titre") : title} />
      <div className={toc.length > 3 ? "lg-grille" : "mt-8"}>
        {toc.length > 3 && <Sommaire items={toc.map((h) => ({ id: h.id, titre: inline(h.text, `toc-${h.id}`) }))} />}
        <div className="min-w-0 max-w-3xl">
          <LegalBody blocks={blocks.filter((b) => b.t !== "h1")} />
        </div>
      </div>
    </div>
  );
}
