// Montage commun à toutes les coques : polices et styles, magasin, contrôleur, rendu.
import { render } from "preact";
import "./styles/tokens.css";
import "./styles/app.css";
import type { ConfigServeur } from "./api/client";
import { creerApp } from "./etat/app";
import type { Hote } from "./hote/types";
import { ContexteApp } from "./ui/contexte";
import { Panneau } from "./ui/Panneau";

export function monter(hote: Hote, config: ConfigServeur, pageInitiale?: string | null) {
  document.documentElement.setAttribute("data-hote", hote.nom);
  const app = creerApp(hote, config);
  const racine = document.getElementById("app")!;
  render(
    <ContexteApp.Provider value={app}>
      <Panneau />
    </ContexteApp.Provider>,
    racine,
  );
  void app.actions.demarrer().then(() => {
    if (pageInitiale === "accueil" || pageInitiale === "bibliotheque" || pageInitiale === "compte" || pageInitiale === "reglages" || pageInitiale === "diagnostic") {
      app.actions.naviguer(pageInitiale);
    }
  });
  return app;
}

/** Écran honnête quand le paquet est ouvert hors de Premiere (aucune maquette de secours). */
export function horsPremiere(message: string) {
  const racine = document.getElementById("app")!;
  racine.innerHTML = "";
  const p = document.createElement("p");
  p.style.cssText = "font:13px/1.5 system-ui,sans-serif;color:#b3a999;padding:24px;max-width:420px";
  p.textContent = message;
  racine.appendChild(p);
}
