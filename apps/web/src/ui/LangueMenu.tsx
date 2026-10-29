// Choix de la langue (2026-10-29) : une pilule « FR », « EN » ou « ES » qui ouvre la liste des trois langues. Le choix est
// gardé sur cet appareil (lib/langue.ts) ; Échap ou un clic dehors referment la liste, le focus revient au bouton.
import { useEffect, useId, useRef, useState } from "react";
import { choisirLangue, LANGUES, useLangue } from "../lib/langue.ts";
import { useT } from "../i18n/accueil.ts";
import { Icone } from "./egide/Egide.tsx";

export function LangueMenu({ className }: { className?: string }) {
  const langue = useLangue();
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  const id = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const actuelle = LANGUES.find((l) => l.id === langue) ?? LANGUES[0]!;

  useEffect(() => {
    if (!ouvert) return;
    liste.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    const touche = (e: KeyboardEvent) => { if (e.key === "Escape") { setOuvert(false); bouton.current?.focus(); } };
    const dehors = (e: PointerEvent) => { const c = e.target as Node; if (!liste.current?.contains(c) && !bouton.current?.contains(c)) setOuvert(false); };
    window.addEventListener("keydown", touche);
    document.addEventListener("pointerdown", dehors, true);
    return () => { window.removeEventListener("keydown", touche); document.removeEventListener("pointerdown", dehors, true); };
  }, [ouvert]);

  return (
    <div className={`ac-langue ${className ?? ""}`}>
      <button ref={bouton} type="button" className="ac-pilule ac-pilule--langue" aria-haspopup="menu" aria-expanded={ouvert} aria-controls={id}
        onClick={() => setOuvert((v) => !v)} data-langue-bouton="">
        {/* Nom accessible « Langue : FR (Français) » : il contient le texte visible (WCAG 2.5.3). */}
        <Icone nom="monde" taille="s" /><span className="eg-vh">{t.langue}{"\u00a0"}: </span><span>{actuelle.court}</span><span className="eg-vh"> ({actuelle.nom})</span>
      </button>
      {ouvert && (
        <div ref={liste} id={id} role="menu" aria-label={t.langue} className="ac-langue-liste">
          {LANGUES.map((l) => (
            <button key={l.id} type="button" role="menuitemradio" aria-checked={langue === l.id} lang={l.id} data-langue={l.id}
              onClick={() => { choisirLangue(l.id); setOuvert(false); bouton.current?.focus(); }}>
              <span>{l.nom}</span><span className="ac-langue-code" aria-hidden="true">{l.court}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
