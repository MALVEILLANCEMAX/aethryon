// Notifications discrètes des transferts (Nocturne-2) : un toast quand un transfert vu ACTIF pendant la session se
// termine — prêt (« Voir » ouvre la Bibliothèque) ou interrompu (message réel du cœur) —, sauf une annulation demandée
// (le bouton a déjà répondu) et sauf si Transferts est à l'écran (la carte le montre). Rien au premier passage : seuls
// les CHANGEMENTS observés comptent.
import { useEffect, useRef } from "react";
import { useMagasin } from "./magasin";
import { useToast } from "../ui/superpositions";
import { typo } from "./format";
import type { EtatTransfert } from "./types";

const ACTIFS: EtatTransfert[] = ["attente", "conversion", "telechargement"];

export function useAvisTransferts(): void {
  const { inst, section, aller } = useMagasin();
  const toast = useToast();
  const vus = useRef<Map<string, EtatTransfert> | null>(null);
  const transferts = inst?.transferts;
  useEffect(() => {
    if (!transferts) return;
    const premier = vus.current == null;
    const avant = vus.current ?? new Map<string, EtatTransfert>();
    const apres = new Map<string, EtatTransfert>();
    for (const t of transferts) {
      apres.set(t.id, t.etat);
      const e = avant.get(t.id);
      if (premier || !e || e === t.etat || !ACTIFS.includes(e) || section === "transferts") continue;
      const nom = t.fichierAttendu ?? t.titre ?? undefined;
      if (t.etat === "pret") toast({ etat: "ok", titre: "Transfert terminé", texte: nom && typo(nom), action: { libelle: "Voir", faire: () => aller("bibliotheque") } });
      else if (t.etat === "erreur" && t.code !== "annule") toast({ etat: "erreur", titre: "Transfert interrompu", texte: typo(t.erreur ?? nom ?? ""), action: { libelle: "Transferts", faire: () => aller("transferts") } });
    }
    vus.current = apres;
  }, [transferts]);
}
