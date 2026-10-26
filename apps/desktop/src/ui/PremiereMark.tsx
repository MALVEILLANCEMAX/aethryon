// Emplacement de marque de l'intégration Premiere Pro, INTERCHANGEABLE (D-SPEC §0.3-2) : rempli par la marque
// neutre d'AETHRYON `PremiereMark` (copie de web/src/ui/brand/PremiereMark.tsx, choix du propriétaire du 2026-10-18) :
// la tête maître sur une tuile obsidienne, au-dessus d'une piste de montage. L'icône officielle d'Adobe fournie
// (logo-premiere-fourni.png) n'est PAS utilisée : aucune licence d'Adobe. Le nom « Premiere Pro » reste en texte.
import { useId } from "react";
import { MARQUE } from "./marque-donnees";

/** Dessin maître sans identifiants (plusieurs marques peuvent coexister dans la page). */
const TETE = MARQUE.master.body.replace(/ id="[^"]*"/g, "");

export function PremiereMark({ taille = 40, libelle }: { taille?: number; libelle?: string }) {
  const halo = `premiere-halo-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" width={taille} height={taille} fill="none" className="premiere-mark" role={libelle ? "img" : undefined}
      aria-label={libelle} aria-hidden={libelle ? undefined : true} focusable="false" data-premiere-mark="">
      <defs>
        <radialGradient id={halo} cx="50%" cy="40%" r="58%">
          <stop offset="0" stopColor="#D4AF7C" stopOpacity="0.2" />
          <stop offset="1" stopColor="#D4AF7C" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0F0F10" />
      <rect width="64" height="64" rx="14" fill={`url(#${halo})`} />
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" stroke="#D4AF7C" strokeOpacity="0.28" />
      <g transform="translate(12.8 6.2) scale(0.6)" dangerouslySetInnerHTML={{ __html: TETE }} />
      <path d="M9 52h46" stroke="#3A3631" strokeWidth="1" strokeLinecap="round" />
      <rect x="10" y="49" width="14" height="6" rx="1.6" fill="#D7C2A5" />
      <rect x="26" y="49" width="10" height="6" rx="1.6" fill="#E8D5B7" fillOpacity="0.85" />
      <rect x="38" y="49" width="16" height="6" rx="1.6" fill="#AC8150" fillOpacity="0.9" />
      <path d="M34 46.2v11.6" stroke="#D4AF7C" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M31.4 44.4h5.2L34 47.2Z" fill="#D4AF7C" />
    </svg>
  );
}

/** Emplacement interchangeable : aujourd'hui la marque neutre ; un logo sous licence pourrait le remplir plus tard. */
export function TuileIntegration({ taille = 40 }: { taille?: number }) {
  return <span className="tuile-integration" aria-hidden="true"><PremiereMark taille={taille} /></span>;
}
