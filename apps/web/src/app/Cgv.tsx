// Conditions générales de vente des offres payantes (/cgv) : texte src/legal/cgv.md ; sa version texte est jointe à la
// confirmation de chaque commande (dist/legal/cgv.txt).
import source from "../legal/cgv.md?raw";
import { parse } from "../legal/doc.tsx";
import { LegalPage } from "./LegalPage.tsx";

export const CGV_BLOCKS = parse(source);

export default function Cgv() {
  return <LegalPage title="Conditions générales de vente" blocks={CGV_BLOCKS} attr="cgv"
    waiting="Les conditions générales de vente des offres payantes seront publiées ici, complètes, avant l'ouverture des ventes." />;
}
