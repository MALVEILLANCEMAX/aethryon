// Aide d'un réglage (Nocturne-2) : un « i » qui ouvre la bulle au survol ou au focus clavier (ui/Bulles.tsx) ; le texte
// est aussi son nom accessible. Remplace les descriptions écrites en permanence.
import { typo } from "../lib/format";
import { Icone } from "./base";

export function Aide({ texte }: { texte: string }) {
  const t = typo(texte);
  return <button type="button" className="reg-aide" aria-label={`Aide : ${t}`} data-bulle={t}><Icone nom="info" taille={13} /></button>;
}
