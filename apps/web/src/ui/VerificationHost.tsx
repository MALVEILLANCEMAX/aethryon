// Point d'accueil de la vérification de sécurité (lib/verification.ts) : rien n'est chargé tant qu'aucune action
// sensible n'a reçu de défi du serveur (visiteur de niveau 1 : zéro octet de plus).
import { lazy, Suspense, useSyncExternalStore } from "react";
import { verifyStore } from "../lib/verification.ts";

const Overlay = lazy(() => import("./VerificationOverlay.tsx"));

export function VerificationHost() {
  const state = useSyncExternalStore(verifyStore.subscribe, verifyStore.get, () => null);
  if (!state) return null;
  return <Suspense fallback={null}><Overlay key={state.id} state={state} /></Suspense>;
}
