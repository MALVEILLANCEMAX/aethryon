import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/desktop.css";
import "./styles/installer.css";
import "./styles/app.css";
import "./styles/flow.css";
import "./styles/demarrage.css";
import "./styles/chouette.css";
import "./styles/nocturne.css";
import { App } from "./App";
import { demarrerEcran } from "./lib/demarrage";

demarrerEcran();
createRoot(document.getElementById("racine")!).render(<App />);
