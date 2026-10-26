// « Réparer avec AETHRYON Setup » : depuis la v2, le panneau AETHRYON est une extension CEP qu'AETHRYON Setup installe
// (%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere) ; le Desktop ne l'installe plus. Le bouton prend le chemin de
// « Mettre à jour » (setup PUBLIÉ téléchargé et vérifié dans le cœur, lancé sur son écran « Réparer ») ; si ce chemin
// échoue (hors ligne, annonce illisible…), il ouvre la page de téléchargement.
import { useState } from "react";
import { api, messageErreur } from "../lib/api";
import { Bouton } from "./base";
import { useToast } from "./superpositions";

export function BoutonReparerSetup({ taille = "sm", variante = "primary" }: { taille?: "sm" | "lg"; variante?: "primary" | "secondary" | "ghost" }) {
  const toast = useToast();
  const [occupe, setOccupe] = useState(false);
  const lancer = async () => {
    setOccupe(true);
    try {
      await api.reparerAvecSetup();
      toast({ etat: "info", titre: "AETHRYON Setup s'ouvre", texte: "Choisissez « Réparer » : le panneau AETHRYON est réinstallé. AETHRYON Desktop se ferme." });
    } catch (e) {
      setOccupe(false);
      try {
        await api.ouvrirPageSetup();
        toast({ etat: "info", titre: "Page de téléchargement ouverte", texte: `${messageErreur(e)} Téléchargez AETHRYON Setup, puis choisissez « Réparer ».` });
      } catch {
        toast({ etat: "erreur", titre: "Réparation impossible", texte: messageErreur(e) });
      }
    }
  };
  return (
    <Bouton taille={taille} variante={variante} icone="repair" occupe={occupe} disabled={occupe} onClick={() => void lancer()}>
      {occupe ? "Téléchargement d'AETHRYON Setup…" : "Réparer avec AETHRYON Setup"}
    </Bouton>
  );
}
