// Entrée MAQUETTE (essais et captures) : hôte simulé, aucun réseau. Jamais livrée dans l'extension.
import { creerHoteMaquette } from "./hote/maquette";
import { monter } from "./monter";

const q = new URLSearchParams(location.search);
const app = monter(creerHoteMaquette(), { compte: "https://raccourci.malvu.fr", api: "https://api.malvu.fr/media" }, q.get("page"));
(window as unknown as { __app: typeof app }).__app = app;
if (q.get("lien")) setTimeout(() => app.actions.saisir(q.get("lien")!), 50);
