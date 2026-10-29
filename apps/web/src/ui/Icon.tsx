// Icônes du site : Phosphor (licence MIT, ui/ph/ph.ts), graisse épaisse, couleur héritée ; mêmes noms qu'avant
// pour tous les écrans. Lecture et pause en forme pleine. Aucune marque tierce dessinée (sauf GoogleG, fichier officiel).
import { useId, type SVGProps } from "react";
import { PH, PH_PLEIN, type NomPh, type NomPlein } from "./ph/ph.ts";

type P = SVGProps<SVGSVGElement> & { size?: number; duo?: boolean };

/** Fabrique d'une icône : `duo` ajoute le fond teinté du duotone de Phosphor. */
const ph = (nom: NomPh, plein = false) => function IconePh({ size = 20, duo, className, ...p }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden className={["ph", duo && "ph-duo", className].filter(Boolean).join(" ")} {...p}>
      {plein ? <path d={PH_PLEIN[nom as NomPlein]} /> : <>{duo && <path className="ph-fond" d={PH[nom].f} />}<path d={PH[nom].t} /></>}
    </svg>
  );
};

export const IconShare = ph("partager");
export const IconCheck = ph("ok");
export const IconCopy = ph("copier");
export const IconKey = ph("cle");
export const IconDownload = ph("importer");
export const IconPlay = ph("lecture", true);
export const IconPause = ph("pause", true);
export const IconNext = ph("chevron");
export const IconPrev = ph("precedent");
export const IconReplay = ph("retour");
export const IconMusic = ph("son");
export const IconFilm = ph("film");
export const IconPhone = ph("telephone");
export const IconShield = ph("bouclier");
export const IconBolt = ph("eclair");
export const IconChevron = ph("bas");
export const IconMenu = ph("menu");
export const IconClose = ph("croix");
export const IconAlert = ph("alerte");
export const IconInfo = ph("info");
export const IconFolder = ph("dossier");
export const IconPhoto = ph("image");
export const IconRefresh = ph("actualiser");
export const IconLogout = ph("deconnexion");
export const IconUser = ph("compte");
export const IconActivity = ph("activite");
export const IconHome = ph("maison");
export const IconQr = ph("qr");
export const IconSparkle = ph("etincelle");
export const IconArrowRight = ph("droite");
export const IconCup = ph("tasse");
export const IconArrowUpRight = ph("sortie");
export const IconLink = ph("lien");
export const IconBook = ph("livre");
export const IconHourglass = ph("sablier");
export const IconLock = ph("cadenas");
export const IconGauge = ph("jauge");
export const IconCloud = ph("nuage");
export const IconCloudUp = ph("televerser");
export const IconTrash = ph("corbeille");
export const IconPuzzle = ph("extension");
export const IconChat = ph("bulle");
export const IconWindow = ph("navigateur");
export const IconMail = ph("courriel");
export const IconEye = ph("oeil");
export const IconEyeOff = ph("cache");
export const IconBell = ph("cloche");
export const IconBellOff = ph("silence");

/** « G » Google ACTUEL (dégradé), fichier officiel recadré sans retouche (brand/platforms/google/SOURCES.md) ; à
 *  n'afficher que sur fond blanc, dans un bouton de connexion. Décoratif : le texte du bouton nomme Google. */
export const GoogleG = ({ size = 18 }: { size?: number }) => (
  <img src="/brand/platforms/google/google-g.png" width={size} height={size} alt="" className="shrink-0" data-official-logo="google" decoding="async" />
);

/** Le même « G », hors des boutons blancs (espace, thème sombre) : posé au centre d'une pastille RONDE blanche, comme
 *  sur les boutons sombres de Google — jamais le carré blanc du fichier seul sur un fond foncé. */
export const GooglePastille = ({ size = 28 }: { size?: number }) => (
  <span className="inline-grid shrink-0 place-items-center rounded-full bg-[#fff] ring-1 ring-black/10" style={{ width: size, height: size }} data-google-pastille="">
    <GoogleG size={Math.round(size * 0.6)} />
  </span>
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
