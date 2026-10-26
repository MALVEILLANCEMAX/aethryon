// Point d'entrée du service worker (module ESM). Écouteurs installés au premier tour de boucle, puis
// reprise des jobs de storage.session (redémarrage du worker, alarme, démarrage du navigateur).
import { createWorker } from "./worker.ts";

const worker = createWorker();
worker.install();
void worker.resume();
