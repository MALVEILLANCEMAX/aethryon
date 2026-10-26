// La chouette suit AETHRYON Index depuis la coque (JS de démarrage, sans charger le module de l'index) : apparence
// « analyse » tant qu'un scan tourne (avis RÉELS « index-progression » du cœur), puis réussite ou erreur à la fin
// (« index-fin »), que l'écran du scanner soit ouvert ou non. Un scan annulé ne fait ni fête ni erreur.
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useCompanion } from "../ui/Companion";
import { pluriel, typo } from "./format";

interface Avis { phase: string; medias: { video: number; audio: number; image: number } }
interface Fin { scan: number; etat: "termine" | "annule" | "erreur"; totalMedias: number }

export function useActiviteScan(): void {
  const c = useCompanion();
  // Abonnement unique ; les fonctions du compagnon sont relues à chaque avis (elles changent avec son état).
  const f = useRef(c);
  f.current = c;
  useEffect(() => {
    const activite: typeof c.activite = (a, k) => f.current.activite(a, k);
    const signaler: typeof c.signaler = (e) => f.current.signaler(e);
    const a = listen<Avis>("index-progression", (e) => {
      const p = e.payload;
      if (p.phase === "termine") return;
      const n = p.medias.video + p.medias.audio + p.medias.image;
      activite({ cle: "scan", texte: typo(`Analyse : ${pluriel(n, "média trouvé", "médias trouvés")}`), cible: { section: "scanner" } }, "scan");
    });
    const b = listen<Fin>("index-fin", (e) => {
      const f = e.payload;
      activite(null, "scan");
      if (f.etat === "termine") signaler({ type: "succes", famille: "ajout", texte: typo(`Scan terminé : ${pluriel(f.totalMedias, "média", "médias")}`), cible: { section: "bibliotheque" }, cle: `scan:${f.scan}` });
      else if (f.etat === "erreur") signaler({ type: "erreur", texte: "Scan interrompu par une erreur", cible: { section: "scanner" }, cle: `scan:${f.scan}` });
    });
    return () => { a.then((u) => u()).catch(() => {}); b.then((u) => u()).catch(() => {}); };
  }, []);
}
