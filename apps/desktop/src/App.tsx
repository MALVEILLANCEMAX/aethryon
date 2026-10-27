// Racine : premier lancement (ou --assistant, --reparer, « Réparer ») → parcours d'installation en 960 × 640 ;
// sinon l'application. Thème : Égide (lib/apparence.ts, préférence de l'appareil, posée avant le premier rendu) ;
// « Réduire les animations » suit la configuration (Système = Windows).
import { lazy, Suspense, useEffect, useState } from "react";
import { api, evenements } from "./lib/api";
import { appliquerAnimations, reprendreAncienTheme } from "./lib/apparence";
import type { Instantane } from "./lib/types";
import { FournisseurMagasin, useMagasin } from "./lib/magasin";
import { FournisseurToasts } from "./ui/superpositions";
import { Fenetre } from "./shell/Fenetre";
import { Accueil } from "./pages/Accueil";
import { Bibliotheque } from "./pages/Bibliotheque";
import { Apercu } from "./pages/Apercu";
import { Assistant } from "./assistant/Assistant";
import { Analyseur } from "./analyse/Analyseur";
import { Bulles } from "./ui/Bulles";
import { FournisseurCompanion } from "./ui/Companion";
import { cloudOuvert, demarrerCompte, useCompte } from "./lib/compte";
import { etatLu, serviceEnAttente, terminerEcran } from "./lib/demarrage";
import { EcranScanner } from "./lib/scanner";
import { chargeurs, prechargerPages } from "./lib/pages";

// Section CLOUD (administrateur) : code chargé seulement quand on l'ouvre.
const Cloud = lazy(() => import("./pages/Cloud"));
// Section MUSIQUE : chargée à la demande (le JS de démarrage n'en porte que l'entrée de navigation).
const Musique = lazy(chargeurs.musique);
// Nocturne-2 : Transferts, Intégrations et Paramètres aussi (préchargés au premier temps calme, lib/pages.ts).
const Transferts = lazy(chargeurs.transferts);
const Integrations = lazy(chargeurs.integrations);
const Parametres = lazy(chargeurs.parametres);

type Mode = "assistant" | "reparer" | "app";

function Contenu({ onReparer }: { onReparer: () => void }) {
  const { section, apercu, aller } = useMagasin();
  const compte = useCompte();
  if (apercu) return <Apercu id={apercu} />;
  switch (section) {
    case "bibliotheque": return <Bibliotheque />;
    case "musique": return <Suspense fallback={null}><Musique /></Suspense>;
    case "transferts": return <Suspense fallback={null}><Transferts /></Suspense>;
    // Jamais affichée sans l'accord du serveur (administrateur ET cloud ouvert) ; sinon retour à l'accueil.
    case "cloud": return cloudOuvert(compte) ? <Suspense fallback={null}><Cloud /></Suspense> : <Accueil />;
    case "integrations": return <Suspense fallback={null}><Integrations onReparer={onReparer} /></Suspense>;
    case "parametres": return <Suspense fallback={null}><Parametres onReparer={onReparer} /></Suspense>;
    // AETHRYON Index : écran chargé à la demande, seulement s'il fait partie de la construction (lib/scanner.ts).
    case "scanner": return EcranScanner ? <Suspense fallback={null}><EcranScanner onFermer={() => aller("accueil")} /></Suspense> : <Accueil />;
    default: return <Accueil />;
  }
}

/** Précharge les pages à la demande une fois l'application affichée. */
function Precharge() {
  useEffect(() => { prechargerPages(); }, []);
  return null;
}

function Apparence({ inst }: { inst: Instantane | null }) {
  const ancien = inst?.config.theme;
  const anim = inst?.config.reduireAnimations ?? "systeme";
  useEffect(() => { appliquerAnimations(anim); }, [anim]);
  // Une seule fois par appareil : l'ancien réglage « Thème » (Clair / Sombre / Système) devient le thème Égide de départ.
  useEffect(() => { if (ancien) reprendreAncienTheme(ancien); }, [ancien]);
  return null;
}

function Application({ initial }: { initial: Instantane }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const { inst, rafraichir } = useMagasin();

  useEffect(() => {
    api.modeLancement().then((m) => {
      const choisi: Mode = m === "reparer" ? "reparer" : m === "assistant" || !initial.assistantTermine ? "assistant" : "app";
      setMode(choisi);
      // Interface montée et état initial lu : l'écran de démarrage s'efface (et la fenêtre s'ouvre s'il ne l'a pas fait).
      api.modeFenetre(choisi === "app" ? "app" : "assistant").catch(() => {}).finally(() => {
        requestAnimationFrame(() => terminerEcran());
      });
    });
    const fin = evenements.mode((m) => {
      if (m === "reparer" || m === "assistant") {
        setMode(m === "reparer" ? "reparer" : "assistant");
        api.modeFenetre("assistant").catch(() => {});
      }
    });
    return () => { fin.then((u) => u()).catch(() => {}); };
  }, [initial.assistantTermine]);

  const reparer = () => {
    setMode("reparer");
    api.modeFenetre("assistant").catch(() => {});
  };

  return (
    <>
      <Apparence inst={inst} />
      {mode && mode !== "app" && inst && (
        <main className="inst-hote"><Assistant key={mode} inst={inst} reparation={mode === "reparer"} onTerminer={() => { rafraichir(); setMode("app"); }} /></main>
      )}
      {mode === "app" && (
        <>
          <Precharge />
          <Fenetre><Contenu onReparer={reparer} /></Fenetre>
          <Analyseur />
        </>
      )}
    </>
  );
}

export function App() {
  const [initial, setInitial] = useState<Instantane | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let essais = 0;
    const charger = () => api.etat().then((i) => { etatLu(); setInitial(i); }).catch((e) => {
      // Le service démarre en même temps que la fenêtre : on réessaie quelques fois.
      if (++essais < 20) { serviceEnAttente(); window.setTimeout(charger, 150); }
      else { setErreur(String(e)); terminerEcran(); }
    });
    charger();
    demarrerCompte();
  }, []);
  if (erreur) return <div className="erreur-fatale"><h1 className="t-display-m">AETHRYON Desktop n'a pas pu démarrer</h1><p>{erreur}</p></div>;
  if (!initial) return null;
  return (
    <FournisseurToasts>
      <FournisseurMagasin initial={initial}>
        <FournisseurCompanion>
          <Application initial={initial} />
          <Bulles />
        </FournisseurCompanion>
      </FournisseurMagasin>
    </FournisseurToasts>
  );
}
