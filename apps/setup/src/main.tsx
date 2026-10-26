import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/installer.css";
import "./styles/app.css";
import "./styles/setup.css";
import { appliquerMouvement } from "./lib/mouvement";
import { FournisseurToasts } from "./ui/superpositions";
import { Setup } from "./Setup";

// « --animations-reduites » (ou ?animations=reduites) force le mode réduit ; sinon le réglage « Effets d'animation »
// de Windows, relayé par prefers-reduced-motion, s'applique.
const q = new URLSearchParams(location.search);
if (q.get("animations") === "reduites") appliquerMouvement("oui");
document.documentElement.dataset.theme = "dark";

createRoot(document.getElementById("racine")!).render(
  <FournisseurToasts>
    <Setup />
  </FournisseurToasts>,
);
