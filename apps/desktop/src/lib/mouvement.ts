// Mouvement réduit, vu du code du Desktop : `data-d-reduit` sur <html>, posé par lib/apparence.ts d'après le thème Égide
// (intensité « réduite » ou « aucune »), le réglage de Windows (« Effets d'animation », relayé par WebView2) et le réglage
// « Réduire les animations » d'AETHRYON (Système / Oui / Non). Avant la pose (premier script) : le système décide.
export function mouvementReduit(): boolean {
  if (typeof document === "undefined") return true;
  const d = document.documentElement.getAttribute("data-d-reduit");
  if (d === "1") return true;
  if (d === "0") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
