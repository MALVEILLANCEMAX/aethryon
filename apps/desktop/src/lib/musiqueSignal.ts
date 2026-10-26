// Signal minuscule entre la coque (JS de démarrage) et la section MUSIQUE (chargée à la demande) : le mini-lecteur
// n'est chargé et monté qu'après une première lecture ; la chouette apprend les imports musicaux en cours ou finis.
import { useSyncExternalStore } from "react";

// Nocturne-2 : `ecoute` = la grande carte « En écoute » de Musique est à l'écran ; le mini-lecteur s'efface alors (mêmes
// commandes, une seule fois à l'écran) et revient dès qu'elle sort de la vue.
export interface SignalMusique { lecteur: boolean; imports: number; evenement: { cle: string; type: "succes" | "erreur"; texte: string } | null; ecoute: boolean }
let v: SignalMusique = { lecteur: false, imports: 0, evenement: null, ecoute: false };
const ec = new Set<() => void>();
export function signalerMusique(p: Partial<SignalMusique>) { v = { ...v, ...p }; for (const e of ec) e(); }
const abonner = (e: () => void) => { ec.add(e); return () => { ec.delete(e); }; };
export const useSignalMusique = () => useSyncExternalStore(abonner, () => v);
