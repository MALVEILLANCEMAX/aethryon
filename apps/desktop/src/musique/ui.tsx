// Petits éléments de la section MUSIQUE : pochette (image réelle ou monogramme sobre, jamais une image inventée),
// pictogrammes propres au lecteur (même grille 24 et même trait que ui/traces.ts), libellés d'état.
import type { CSSProperties } from "react";
import { Icone } from "../ui/base";
import type { NomIcone } from "../ui/traces";

const TRACES_M = {
  "precedent": "<path d=\"M6 5v14\"/><path d=\"M18 6.2v11.6a.6.6 0 0 1-.92.5L9 12.5a.6.6 0 0 1 0-1l8.08-5.8a.6.6 0 0 1 .92.5z\"/>",
  "suivant": "<path d=\"M18 5v14\"/><path d=\"M6 6.2v11.6a.6.6 0 0 0 .92.5L15 12.5a.6.6 0 0 0 0-1L6.92 5.7a.6.6 0 0 0-.92.5z\"/>",
  "aleatoire": "<path d=\"M4 7h3.2c1.6 0 3 .8 3.9 2.1l2.8 4.3c.9 1.3 2.3 2.1 3.9 2.1H20\"/><path d=\"M4 17h3.2c1.3 0 2.5-.6 3.4-1.5M13.4 8.5c.9-.9 2.1-1.5 3.4-1.5H20\"/><path d=\"M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5\"/>",
  "repeter": "<path d=\"M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19l-2.5-2.5M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5l2.5 2.5\"/>",
  "file": "<path d=\"M4 6h12M4 11h12M4 16h7\"/><path d=\"M15 15.5v4.2l3.6-2.1z\"/>",
  "note": "<path d=\"M9 18.5V6.2l10-2v12.3\"/><circle cx=\"6.5\" cy=\"18.5\" r=\"2.5\"/><circle cx=\"16.5\" cy=\"16.5\" r=\"2.5\"/>",
  "playlist": "<path d=\"M4 6h11M4 11h11M4 16h6\"/><path d=\"M17 18.5V9.5l3.5-1\"/><circle cx=\"15.5\" cy=\"18.5\" r=\"1.8\"/>",
  "album": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><circle cx=\"12\" cy=\"12\" r=\"2.2\"/>",
  "artiste": "<circle cx=\"12\" cy=\"8.5\" r=\"3.8\"/><path d=\"M4.8 20c.9-3.6 3.8-5.6 7.2-5.6s6.3 2 7.2 5.6\"/>",
  "lien": "<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1\"/><path d=\"M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>",
  "poignee": "<path d=\"M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01\" stroke-width=\"3\"/>",
  "muet": "<path d=\"M4 9.5h3l4.5-4v13l-4.5-4H4z\"/><path d=\"M16 9.5l5 5M21 9.5l-5 5\"/>",
} as const;
export type NomIconeM = keyof typeof TRACES_M;

export function IconeM({ nom, taille = 18, style }: { nom: NomIconeM | NomIcone; taille?: number; style?: CSSProperties }) {
  if (!(nom in TRACES_M)) return <Icone nom={nom as NomIcone} taille={taille} style={style} />;
  return (
    <svg className="ico" width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={(32 / taille).toFixed(2)}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style} dangerouslySetInnerHTML={{ __html: TRACES_M[nom as NomIconeM] }} />
  );
}

/** Monogramme d'une pochette absente : initiale sur une teinte dérivée du titre (obsidienne et or, rien d'inventé). */
function teinte(t: string): number {
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Pochette({ url, titre, taille, rond, className }: { url: string | null; titre: string; taille?: number; rond?: boolean; className?: string }) {
  const style: CSSProperties = taille ? { width: taille, height: taille } : {};
  const cls = `mu-poch${rond ? " mu-poch--rond" : ""}${className ? " " + className : ""}`;
  if (url) return <span className={cls} style={style}><img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /></span>;
  const lettre = (titre.trim()[0] ?? "♪").toUpperCase();
  return (
    <span className={`${cls} mu-poch--vide`} style={{ ...style, ["--h" as string]: teinte(titre) }} aria-hidden="true">
      <span className="mu-poch-lettre" style={taille ? { fontSize: Math.max(12, taille * 0.36) } : undefined}>{lettre}</span>
    </span>
  );
}

export const LIBELLE_ETAPE: Record<string, string> = {
  demande: "Demande envoyée", en_file: "En file d'attente", telechargement: "Téléchargement par le serveur", verification: "Vérification du fichier",
  etiquetage: "Étiquetage", rapatriement: "Copie sur cet ordinateur", termine: "Ajouté à ta musique", echec: "Échec", annule: "Annulé",
};
