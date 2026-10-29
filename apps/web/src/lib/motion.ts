// Constantes d'animation AETHRYON (une seule source pour toute l'interface).
// Micro-interactions 120–220 ms, transitions de composants 220–450 ms, révélations 450–800 ms.
// Courbes calmes, ressorts sans rebond excessif ; transform et opacity uniquement.
import type { Transition, Variants } from "motion/react";
import { isBelowFold, isStaticBoot } from "./prerender.ts";

export const EASE = {
  soft: [0.22, 0.8, 0.26, 1] as const,   // sortie douce (entrées, survols)
  calm: [0.65, 0, 0.35, 1] as const,     // aller-retour (changements d'état)
  exit: [0.32, 0, 0.67, 0] as const,     // sorties : toujours plus courtes que l'entrée
};

/** micro : survol, couleur, échange de libellé · exit : toute sortie · component : panneaux, coche dessinée ·
 *  reveal : UNE entrée orchestrée par page · calm : fondu de remplacement en mouvement réduit. */
export const DUR = { micro: 0.18, exit: 0.16, component: 0.34, reveal: 0.62, calm: 0.1 } as const;

/**
 * Ressorts de « Le Passage » (2026-10-28) : mêmes valeurs que les jetons Égide RESSORTS (en CSS : --eg-e-pastille,
 * --eg-e-feuille et leurs durées). pastille : petits objets qui changent de forme (pastille de passage, puces,
 * indicateurs), dépassement d'environ 3 % ; feuille : panneaux, tiroirs et feuilles, qui se posent sans rebond.
 */
export const RESSORT = {
  pastille: { type: "spring", duration: 0.45, bounce: 0.25 } satisfies Transition,
  feuille: { type: "spring", duration: 0.5, bounce: 0 } satisfies Transition,
};

/** Anciens noms, alignés sur les deux ressorts (une seule grammaire de mouvement pour tout le site). */
export const SPRING = {
  /** Panneaux, menus, pastilles qui glissent */
  soft: RESSORT.feuille,
  /** Petits éléments (boutons, puces, icônes qui se transforment) */
  snappy: RESSORT.pastille,
  /** Indicateurs partagés (layoutId) : pastille d'un contrôle segmenté, onglet actif */
  glide: RESSORT.pastille,
};

/** Entrée au défilement : légère, une seule fois, jamais sur tout à la fois. */
export const reveal: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: { duration: DUR.reveal, ease: EASE.soft } },
};

export const revealGroup: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
};

/** Propriétés communes d'un bloc révélé au défilement (une seule fois). `key` : identifiant stable du bloc
 *  (attribut data-reveal, écrit aussi dans le HTML pré-rendu).
 *  - Navigation dans l'application : le bloc entre quand il arrive à l'écran.
 *  - Page pré-rendue, premier rendu : son contenu est déjà affiché ; seuls les blocs qui étaient SOUS la ligne de
 *    flottaison au démarrage (lib/prerender.ts, captureFold) entreront à leur arrivée ; les autres restent tels
 *    quels. (`initial` est lu au montage seulement.) */
export function inView(key: string) {
  return {
    initial: (isStaticBoot() && !isBelowFold(key) ? false : "hidden") as false | "hidden",
    whileInView: "shown",
    viewport: { once: true, margin: "0px 0px -12% 0px" },
    "data-reveal": key,
  } as const;
}
