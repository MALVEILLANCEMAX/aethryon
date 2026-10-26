// Politique de remboursement (/remboursement) : texte src/legal/remboursement.md, partie des CGV.
import source from "../legal/remboursement.md?raw";
import { parse } from "../legal/doc.tsx";
import { LegalPage } from "./LegalPage.tsx";

const BLOCKS = parse(source);

export default function Remboursement() {
  return <LegalPage title="Politique de remboursement" blocks={BLOCKS} attr="remboursement"
    waiting="La politique de remboursement des offres payantes sera publiée ici, complète, avant l'ouverture des ventes." />;
}
