// La chouette en matière (« Le Passage », étape 2 ; décision du propriétaire du 2026-10-28 : « adapter ses matières et
// son rendu aux thèmes, tout en conservant son identité visuelle »). Les TRACÉS sont ceux du maître, dans son ordre de
// peinture (ui/brand/head.ts, généré depuis brand/master/aethryon-master.svg) : jamais redessinés. Seules les couleurs de
// l'écusson, des aigrettes et du bec changent avec le thème actif (egide-site.css, « Vitrine ») : feuille d'or, encre,
// laque noire cerclée d'or, argent de lune, pierre, ou l'accent du thème personnel. Les faces ivoire et les yeux restent
// ceux du maître : c'est la chouette d'AETHRYON dans chaque thème. Décor (le nom de la matière est écrit à côté).
import { HEAD } from "../../ui/brand/head.ts";
import type { ThemeId } from "../../lib/apparence.ts";

/** Nom de la matière de chaque thème (légende de la vitrine). */
export const MATIERE: Record<ThemeId, string> = {
  obsidian: "Feuille d'or sur obsidienne",
  ivory: "Encre sépia sur ivoire",
  oled: "Laque noire, filet d'or",
  midnight: "Argent de lune",
  minimal: "Pierre et graphite",
  custom: "Ta matière",
};

/** `defs` : la vitrine porte les dégradés de matière (une seule fois par page) ; les petites chouettes des maquettes
 *  (defs={false}) s'y réfèrent, ce qui leur donne la même matière sans identifiant en double. */
export function ChouetteMatiere({ className, defs = true }: { className?: string; defs?: boolean }) {
  const h = HEAD;
  return (
    <svg className={className ? `ow ${className}` : "ow"} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {defs && <defs>
        <linearGradient id="ow-or" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F4E2B8" /><stop offset=".38" stopColor="#C9A469" /><stop offset=".62" stopColor="#8F6B35" /><stop offset="1" stopColor="#E7CC92" />
        </linearGradient>
        <linearGradient id="ow-argent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E8EDF6" /><stop offset=".45" stopColor="#A5B0C6" /><stop offset=".7" stopColor="#6E7A93" /><stop offset="1" stopColor="#CBD3E3" />
        </linearGradient>
      </defs>}
      <path className="ow-ecusson" d={h.shell.d} />
      <path className="ow-face-g" d={h.faceLeft.d} />
      <path className="ow-face-d" d={h.faceRight.d} />
      <path className="ow-oeil" d={h.eyeLeft.d} />
      <path className="ow-oeil" d={h.eyeRight.d} />
      <circle className="ow-reflet" cx={h.glintLeft.cx} cy={h.glintLeft.cy} r={h.glintLeft.r} />
      <circle className="ow-reflet" cx={h.glintRight.cx} cy={h.glintRight.cy} r={h.glintRight.r} />
      <path className="ow-aigrette" d={h.browLeft.d} />
      <path className="ow-aigrette" d={h.browRight.d} />
      <path className="ow-front" d={h.browLine.d} />
      <path className="ow-bec-g" d={h.beakLeft.d} />
      <path className="ow-bec-d" d={h.beakRight.d} />
      <path className="ow-filet" d={h.shell.d} />
    </svg>
  );
}
