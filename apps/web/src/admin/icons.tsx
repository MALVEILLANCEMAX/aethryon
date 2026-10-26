// Pictogrammes propres au Control Center (même trait fin que ui/Icon.tsx), dans le code de
// l'administration : jamais téléchargés par les autres pages.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const IconUsers = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2a5.5 5.5 0 0 1 3 5.3" /></svg>);
export const IconSliders = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>);
export const IconChart = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 4v15.5a.5.5 0 0 0 .5.5H20" /><path d="M8 16v-4M12 16V8M16 16v-6" /></svg>);
export const IconServer = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4" /></svg>);
export const IconScroll = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></svg>);
export const IconSettings = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>);
export const IconSearch = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>);
export const IconArrowLeft = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>);
export const IconStop = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>);
export const IconBan = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>);
export const IconPlus = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const IconSortAsc = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></svg>);
export const IconSortDesc = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" /></svg>);
export const IconCrown = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13z" /><path d="M5.5 20h13" /></svg>);
export const IconReset = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>);
export const IconGift = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M3 9h18M12 9v11M12 9c-1.5-4-6-4-6-1.5S10 9 12 9zM12 9c1.5-4 6-4 6-1.5S14 9 12 9z" /></svg>);
