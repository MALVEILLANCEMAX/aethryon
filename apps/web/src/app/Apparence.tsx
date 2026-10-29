// Réglages › Apparence (Égide v2, THEME_ENGINE.md § 6) : le VRAI éditeur de thèmes du socle (creerEditeurThemes) :
// cinq bases, accents, fonds, couleurs précises, rayons, densité, texte, typographie, animations ; aperçu immédiat ;
// 27 contrastes vérifiés à chaque geste (« Appliquer » bloqué en cas d'échec, correction automatique) ; import et export
// JSON validés (« Copier » ET « Télécharger ») ; réinitialisation ; sauvegarde sur CET appareil (aethryon.apparence.v1,
// relue avant le premier rendu par theme-boot.js). Aucune route serveur : la synchronisation par le compte n'existe pas.
import { useEffect, useRef, useState } from "react";
import { useDocumentTitle } from "../lib/hooks.ts";
import { chargerSocle, majCouleurNavigateur } from "../lib/apparence.ts";
import { Veille } from "../ui/egide/Egide.tsx";

export default function Apparence() {
  useDocumentTitle("Apparence");
  const hote = useRef<HTMLDivElement>(null);
  const [pret, setPret] = useState(false);
  const [persistant, setPersistant] = useState(true);

  useEffect(() => {
    let vivant = true;
    let detruire: (() => void) | null = null;
    void chargerSocle().then((m) => {
      if (!vivant || !hote.current) return;
      const persistance = m.creerPersistance();
      setPersistant(persistance.persistant);
      const e = m.creerEditeurThemes(hote.current, { persistance, surApplique: () => majCouleurNavigateur() });
      detruire = e.detruire;
      setPret(true);
    });
    return () => { vivant = false; detruire?.(); };
  }, []);

  return (
    <div data-page-apparence="">
      <h1 className="page-title">Apparence</h1>
      <p className="mt-3 max-w-2xl text-lead text-ink-soft">
        Six thèmes, et le tien. L'aperçu suit chaque réglage ; les contrastes sont vérifiés avant d'appliquer. Ton choix reste sur cet appareil.
      </p>
      {!persistant && (
        <p className="mt-4 rounded-control border border-warn bg-warn-bg px-4 py-3 text-ui text-warn" role="status">
          Ce navigateur refuse le stockage local : ton thème sera oublié à la fermeture de l'onglet.
        </p>
      )}
      {!pret && <div className="mt-8 grid min-h-[480px] place-items-center" aria-busy="true"><Veille libelle="Chargement de l'éditeur" /></div>}
      {/* Titre de niveau 2 pour les sections (h3) de l'éditeur : ordre des titres respecté pour les lecteurs d'écran. */}
      <h2 className="sr-only">Éditeur de thèmes</h2>
      {/* Hôte de l'éditeur (DOM du socle, hors de React) : aucun enfant React ici. */}
      <div className="mt-8" ref={hote} />
    </div>
  );
}
