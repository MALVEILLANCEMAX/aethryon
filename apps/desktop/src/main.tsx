import { createRoot } from "react-dom/client";
// Égide (paquet partagé design/) d'abord : jetons --eg-* des six thèmes, polices OFL, composants .eg-* ; puis les
// feuilles du Desktop (socle en couche « base », pages hors couche).
import "../../../packages/design/genere/egide.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/coque.css";
import "./styles/desktop.css";
import "./styles/installer.css";
import "./styles/app.css";
import "./styles/flow.css";
import "./styles/bibliotheque.css";
import "./styles/convertir.css";
import "./styles/demarrage.css";
import urlChouette from "../../../packages/design/assets/aethryon-master.svg?url";
import { App } from "./App";
import { demarrerApparence } from "./lib/apparence";
import { demarrerEcran } from "./lib/demarrage";
import { configurerEgide } from "./lib/egide";

configurerEgide({ chouette: urlChouette });
demarrerApparence();
demarrerEcran();
createRoot(document.getElementById("racine")!).render(<App />);
