// Pictogrammes d'AETHRYON Tools : même grille (24) et même trait (1,6) que ui/Icon.tsx ; couleur héritée.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

/** Couper : deux crochets de montage autour d'un passage. */
export const IconCut = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8 4H5v16h3M16 4h3v16h-3" /><path d="M9.5 9.5h5M9.5 14.5h5" opacity=".55" /></svg>);
export const IconCrop = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6.5 2.5v14.5a.5.5 0 0 0 .5.5h14.5M2.5 6.5h14.5a.5.5 0 0 1 .5.5v14.5" /></svg>);
export const IconWave = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 12h1.5M6 9v6M9 6v12M12 9.5v5M15 4.5v15M18 8v8M20.5 11v2" /></svg>);
export const IconGif = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M9.5 10.2a2 2 0 0 0-1.8-1.2C6.6 9 6 9.9 6 12s.6 3 1.8 3c1.1 0 1.7-.8 1.7-2.2H8M12.5 9v6M15.5 15V9h3M15.5 12h2.4" /></svg>);
export const IconCompress = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 3v4.5L6.5 5M9 7.5 11.5 5M15 21v-4.5L17.5 19M15 16.5 12.5 19" /><rect x="4" y="9.5" width="16" height="5" rx="1.5" /></svg>);
/** Annuler / Rétablir : flèche courbe vers l'arrière, vers l'avant. */
export const IconUndo = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>);
export const IconRedo = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>);
export const IconRotate = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4.5v4h-4" /></svg>);
export const IconFlipH = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3v18" strokeDasharray="2 2.4" /><path d="M9 6 3.5 18H9zM15 6l5.5 12H15z" /></svg>);
export const IconFlipV = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 12h18" strokeDasharray="2 2.4" /><path d="M6 9 18 3.5V9zM6 15l12 5.5V15z" /></svg>);
export const IconSpeed = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4.5 16.5a8 8 0 1 1 15 0" /><path d="M12 13.5 16 8.5" /><circle cx="12" cy="14" r="1.2" /></svg>);
export const IconVolume = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>);
export const IconMute = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></svg>);
export const IconExpand = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>);
export const IconZoomIn = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6" /></svg>);
export const IconZoomOut = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8M7.5 10.5h6" /></svg>);
export const IconUpload = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 15.5V4M7 9l5-5 5 5M5 20h14" /></svg>);
export const IconLoop = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M17 3.5 20 6.5l-3 3" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" /></svg>);
export const IconFrame = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M8 3.5v2.5M16 3.5v2.5M8 18v2.5M16 18v2.5" /></svg>);
export const IconBack = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>);
export const IconSkipStart = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 5v14M18 6l-8.5 6L18 18z" /></svg>);
export const IconSkipEnd = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M18 5v14M6 6l8.5 6L6 18z" /></svg>);
/** Image précédente / suivante : une barre et un demi-pas. */
export const IconStepBack = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6.5 5.5v13" /><path d="M17.5 6.5 10 12l7.5 5.5z" /></svg>);
export const IconStepFwd = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M17.5 5.5v13" /><path d="M6.5 6.5 14 12l-7.5 5.5z" /></svg>);
/** Aimantation de la frise. */
export const IconMagnet = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 4.5h4.5V12a2.5 2.5 0 0 0 5 0V4.5H19V12a7 7 0 0 1-14 0z" /><path d="M5 8.5h4.5M14.5 8.5H19" /></svg>);
/** Zoom sur la sélection : deux crochets autour d'un passage. */
export const IconFitSel = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M7 6H4.5v12H7M17 6h2.5v12H17" /><path d="M9.5 12h5M12 9.5 14.5 12 12 14.5" /></svg>);
/** Poignée de saisie (six points). */
/** Flèche « vers » (temps de début → fin) : dessinée, la police du site n'a pas le caractère « → ». */
export const IconArrowRight = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5" /></svg>);
/** Envoyer vers l'export : une carte qui part vers le haut, à droite. */
export const IconSend = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3.5" y="9" width="11" height="11" rx="2.5" /><path d="M10 4.5h9.5V14M19.5 4.5l-8 8" /></svg>);
export const IconGrip = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><g fill="currentColor" stroke="none"><circle cx="9" cy="6.5" r="1.4" /><circle cx="15" cy="6.5" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="17.5" r="1.4" /><circle cx="15" cy="17.5" r="1.4" /></g></svg>);
export const IconMore = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><g fill="currentColor" stroke="none"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></g></svg>);
export const IconKeyboard = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7.5 14h9" /></svg>);
/** Panneau latéral (droite). */
export const IconPanel = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M14.5 4.5v15" /></svg>);
/** Agrandir l'aperçu (sans quitter l'éditeur). */
export const IconTheater = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M8 9.5 6 12l2 2.5M16 9.5l2 2.5-2 2.5" /></svg>);
/** Début et fin de la sélection. */
export const IconMarkIn = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M10 4.5H6.5v15H10" /><path d="M13 12h5M15.5 9.5 18 12l-2.5 2.5" /></svg>);
export const IconMarkOut = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M14 4.5h3.5v15H14" /><path d="M11 12H6M8.5 9.5 6 12l2.5 2.5" /></svg>);
/** Tout le média. */
export const IconSelectAll = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3.5" y="6.5" width="17" height="11" rx="2" strokeDasharray="2.6 2.2" /><path d="M7.5 12h9" /></svg>);
