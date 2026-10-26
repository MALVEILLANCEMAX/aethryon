// Pages chargées à la demande (budget du JS de démarrage) et PRÉCHARGÉES au premier temps calme après l'ouverture :
// la première visite de Transferts, Intégrations ou Paramètres ne rencontre pas un module à télécharger.
// Les fichiers sont locaux (protocole de Tauri) : le préchargement coûte une lecture et une analyse, rien sur le réseau.
export const chargeurs = {
  transferts: () => import("../pages/Transferts"),
  integrations: () => import("../pages/Integrations"),
  parametres: () => import("../pages/Parametres"),
  musique: () => import("../musique/Musique"),
};
// Musique (≈ 65 Ko) reste chargée à la seule demande : jamais préchargée pour qui ne l'ouvre pas.
const PRECHARGEES = [chargeurs.transferts, chargeurs.integrations, chargeurs.parametres];

let fait = false;
/** Une fois, quand le fil principal est libre (ou au bout de 2 s) ; jamais pendant le premier affichage. */
export function prechargerPages(): void {
  if (fait) return;
  fait = true;
  const lancer = () => { for (const f of PRECHARGEES) void f().catch(() => {}); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(lancer, { timeout: 2000 });
  else window.setTimeout(lancer, 1200);
}
