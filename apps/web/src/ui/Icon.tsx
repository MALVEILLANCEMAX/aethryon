// Icônes SVG en ligne, trait fin (1,6 px) comme les pictogrammes de la planche AETHRYON ; couleur héritée.
// Aucune bibliothèque, aucun fichier externe.
import { useId, type SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const IconShare = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3v12M8 7l4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" /></svg>);
export const IconCheck = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>);
export const IconCopy = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>);
export const IconKey = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></svg>);
export const IconDownload = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>);
export const IconPlay = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></svg>);
export const IconPause = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.6} /></svg>);
export const IconNext = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 6l6 6-6 6" /></svg>);
export const IconPrev = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M15 6l-6 6 6 6" /></svg>);
export const IconReplay = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>);
export const IconMusic = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>);
export const IconFilm = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" /></svg>);
export const IconPhone = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M10.5 5.5h3" /></svg>);
export const IconShield = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>);
export const IconBolt = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" /></svg>);
export const IconChevron = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>);
export const IconMenu = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
export const IconClose = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconAlert = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>);
export const IconInfo = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></svg>);
export const IconFolder = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /></svg>);
export const IconPhoto = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="9.5" r="1.8" /><path d="M21 16l-5-5-8 9" /></svg>);
export const IconRefresh = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4" /></svg>);
export const IconLogout = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></svg>);
export const IconUser = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>);
export const IconActivity = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 12h4l2.5-6 5 12L17 12h4" /></svg>);
export const IconHome = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 11l8-6.5 8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z" /></svg>);
export const IconQr = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2M20 14v6h-6M17 17h.5" /></svg>);

/** « G » Google ACTUEL (dégradé), fichier officiel recadré sans retouche (brand/platforms/google/SOURCES.md) ; à
 *  n'afficher que sur fond blanc, dans un bouton de connexion. Décoratif : le texte du bouton nomme Google. */
export const GoogleG = ({ size = 18 }: { size?: number }) => (
  <img src="/brand/platforms/google/google-g.png" width={size} height={size} alt="" className="shrink-0" data-official-logo="google" decoding="async" />
);

/** Icône du raccourci telle qu'elle apparaît dans l'app Raccourcis (tuile rouge, flèche de téléchargement). */
export const ShortcutTile = ({ size = 28, className }: { size?: number; className?: string }) => {
  const id = "g" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ff5f4f" />
        <stop offset="1" stopColor="#e0122e" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
    <path d="M32 15v24m-10-10 10 10 10-10M20 47h24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  );
};

// Pictogrammes de la planche AETHRYON et compléments.
/** Étoile à quatre branches (élément graphique de la planche). */
export const IconSparkle = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3c.6 4.6 1.9 7.4 9 9-7.1 1.6-8.4 4.4-9 9-.6-4.6-1.9-7.4-9-9 7.1-1.6 8.4-4.4 9-9z" /></svg>);
export const IconArrowRight = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const IconArrowUpRight = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M7 17 17 7M8 7h9v9" /></svg>);
export const IconLink = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></svg>);
export const IconBook = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" transform="translate(0 -1)" /></svg>);
export const IconHourglass = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M7 3h10M7 21h10M8 3c0 4.5 8 5.5 8 9s-8 4.5-8 9M16 3c0 4.5-8 5.5-8 9s8 4.5 8 9" /></svg>);
export const IconLock = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></svg>);
export const IconGauge = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4.5 16.5a8 8 0 1 1 15 0" /><path d="M12 13.5 15.5 9" /><circle cx="12" cy="14" r="1.2" /></svg>);
// AETHRYON Cloud (2026-10-23) : nuage simple et nuage avec flèche montante (envoi), mêmes tracés que le Desktop.
export const IconCloud = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 10.1 4.25 4.25 0 0 0 7 18.5z" /></svg>);
export const IconCloudUp = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 10.1 4.25 4.25 0 0 0 7 18.5z" /><path d="M12 16v-5.5M9.6 12.6 12 10.2l2.4 2.4" /></svg>);
export const IconTrash = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10.5 11v5.5M13.5 11v5.5" /></svg>);
// Points d'accès d'AETHRYON (espace personnel) : pictogrammes neutres, jamais de logo de marque tierce.
/** Extension de navigateur (pièce de puzzle). */
export const IconPuzzle = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h1.5a2 2 0 1 1 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3z" /></svg>);
/** Messagerie (bot Discord, sans le logo de Discord). */
export const IconChat = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6.5A1.5 1.5 0 0 1 5 5z" /><path d="M8 9.5h8M8 12.5h5" /></svg>);
/** Espace web (fenêtre avec barre latérale). */
export const IconWindow = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 8.5h18M8.5 8.5v11" /></svg>);
export const IconMail = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>);
export const IconEye = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>);
export const IconEyeOff = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3.5 3.5 17 17" /></svg>);
export const IconBell = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>);
export const IconBellOff = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 5.9A5.5 5.5 0 0 1 17.5 11v4.1M6.5 9.6V16.5l-1.5 2h12" /><path d="M10 20.5a2 2 0 0 0 4 0" /><path d="m3.5 3.5 17 17" /></svg>);
