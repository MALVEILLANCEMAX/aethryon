// Pages juridiques publiques pré-rendues : conditions générales de vente (/cgv), mentions légales (/mentions-legales),
// politique de remboursement (/remboursement). Texte : src/legal/*.md, lu par src/legal/doc.tsx ; informations de
// l'entreprise : lib/legal.tsx. Tant qu'elles ne sont pas toutes fournies (production), aucune page incomplète : une
// annonce honnête, comme /conditions. Aucune animation.
import { Link } from "react-router";
import { useDocumentTitle } from "../lib/hooks.ts";
import { LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { inline, LegalBody, outline, type Block } from "../legal/doc.tsx";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

export function LegalPage({ title, blocks, waiting, attr }: { title: string; blocks: Block[]; waiting: string; attr: string }) {
  useDocumentTitle(title);
  if (!LEGAL_PUBLISHED) {
    return (
      <div className="container-site max-w-3xl pb-24 pt-28 sm:pt-36" data-legal-attente={attr}>
        <h1 className="page-title">{title}</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">
          {waiting} Ce que le service conserve et comment tout effacer est déjà décrit sur la page{" "}
          <Link to="/confidentialite" className={link}>Confidentialité</Link>.
        </p>
      </div>
    );
  }
  const h1 = blocks.find((b) => b.t === "h1");
  const toc = outline(blocks);
  return (
    <div className="container-site pb-24 pt-28 sm:pt-36" data-legal-page={attr}>
      <header className="max-w-3xl">
        <h1 className="page-title">{h1 && "text" in h1 ? inline(h1.text, "titre") : title}</h1>
      </header>
      <div className={toc.length > 3 ? "mt-10 grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-16" : "mt-8"}>
        {toc.length > 3 && (
          <nav aria-label="Sommaire" className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:self-start lg:overflow-y-auto">
            <p className="text-[13px] font-semibold text-ink">Sommaire</p>
            <ol className="mt-3 grid gap-0.5 border-l border-line text-[14px] sm:grid-cols-2 lg:grid-cols-1">
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="-ml-px flex min-h-11 items-center border-l border-transparent py-1 pl-4 text-ink-soft transition-colors hover:border-gold hover:text-ink">
                    {inline(h.text, `toc-${h.id}`)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="min-w-0 max-w-3xl">
          <LegalBody blocks={blocks.filter((b) => b.t !== "h1")} />
        </div>
      </div>
    </div>
  );
}
