// Mentions légales (/mentions-legales) : texte src/legal/mentions-legales.md.
import source from "../legal/mentions-legales.md?raw";
import { parse } from "../legal/doc.tsx";
import { LegalPage } from "./LegalPage.tsx";

const BLOCKS = parse(source);

export default function MentionsLegales() {
  return <LegalPage title="Mentions légales" blocks={BLOCKS} attr="mentions"
    waiting="Les mentions légales d'AETHRYON sont en cours de finalisation : elles seront publiées ici, complètes, très prochainement." />;
}
