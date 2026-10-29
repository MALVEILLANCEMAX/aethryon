// Sommaire des pages longues (pages légales, « Le Passage ») : une seule navigation « Sommaire ». Bureau : colonne
// collante, la section lue est marquée et le fil d'or court jusqu'à elle (sections déjà lues : fil plus pâle). Téléphone :
// repliée sous son titre. Sans JavaScript (HTML pré-rendu) : dépliée, liens simples. Styles : passage.css (.som).
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icone } from "../egide/Egide.tsx";

export interface EntreeSommaire { id: string; titre: ReactNode; n?: number }

export function Sommaire({ items, className }: { items: readonly EntreeSommaire[]; className?: string }) {
  const [actif, setActif] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(true);
  const ids = items.map((i) => i.id).join(" ");

  // Déplié sur grand écran, replié sur téléphone (et suivi si la fenêtre change de taille).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const maj = () => setOuvert(mq.matches);
    maj();
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);

  // Section lue : la dernière dont le titre a passé le tiers haut de l'écran (aucune tant que la première n'y est pas).
  // Mesure au défilement, une fois par image ; rien à l'arrêt.
  useEffect(() => {
    const liste = ids.split(" ");
    let image = 0;
    const mesure = () => {
      image = 0;
      const seuil = window.innerHeight * 0.34;
      let lu: string | null = null;
      for (const id of liste) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= seuil) lu = id;
      }
      setActif(lu);
    };
    const auDefilement = () => { if (!image) image = requestAnimationFrame(mesure); };
    mesure();
    window.addEventListener("scroll", auDefilement, { passive: true });
    window.addEventListener("resize", auDefilement, { passive: true });
    return () => { cancelAnimationFrame(image); window.removeEventListener("scroll", auDefilement); window.removeEventListener("resize", auDefilement); };
  }, [ids]);

  const rang = actif ? items.findIndex((i) => i.id === actif) : -1;
  return (
    <nav aria-label="Sommaire" className={cn("som", className)}>
      <details open={ouvert} onToggle={(e) => setOuvert(e.currentTarget.open)}>
        <summary className="som-titre">Sommaire<Icone nom="bas" className="som-ico" /></summary>
        <ol>
          {items.map((it, i) => (
            <li key={it.id}>
              <a href={`#${it.id}`} aria-current={it.id === actif ? "true" : undefined} data-lu={i < rang ? "" : undefined}>
                {it.n !== undefined && <span className="som-n">{it.n}.</span>}{it.titre}
              </a>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  );
}
