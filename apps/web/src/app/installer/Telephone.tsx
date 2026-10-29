// Vitrine du parcours d'installation (bureau) : l'écran de l'iPhone à l'étape en cours, en HTML et CSS (comme les
// maquettes des portes de l'accueil) ; la médaille de la chouette perchée sur le téléphone, frappée du sceau quand le
// serveur a reçu la première conversion. Décoratif (aria-hidden) : l'étape est dite dans la liste. Aucun logo de tiers :
// l'icône du raccourci est celle du raccourci AETHRYON, l'appareil un cadre neutre.
import { AnimatePresence, motion } from "motion/react";
import { DUR, EASE } from "../../lib/motion.ts";
import { MENU, SHORTCUT_NAME } from "../../lib/brand.ts";
import { AethryonMascot, type MascotState } from "../../ui/brand/AethryonMascot.tsx";
import { ShortcutTile } from "../../ui/Icon.tsx";
import { Etiquette, Icone, Marque } from "../../ui/egide/Egide.tsx";

function Ecran({ etape }: { etape: number }) {
  switch (etape) {
    case 1:
      return (
        <div className="tel-ecran tel-compte">
          <Marque taille={26} className="tel-marque" />
          <span className="tel-bouton tel-bouton--clair">Google</span>
          <span className="tel-bouton">Adresse e-mail</span>
        </div>
      );
    case 2:
    case 3:
      return (
        <div className="tel-ecran tel-jeton">
          {etape === 3 && <span className="tel-toast"><Icone nom="copier" taille="s" />Jeton copié</span>}
          <span className="tel-cle"><Icone nom="cle" duo /></span>
          <b>Ton jeton</b>
          <span className="tel-code">ytc_••••••••••••</span>
          <Etiquette ton="accent">affiché une fois</Etiquette>
        </div>
      );
    case 4:
      return (
        <div className="tel-ecran tel-raccourcis">
          <div className="tel-feuille">
            <span className="tel-poignee" />
            <ShortcutTile size={44} className="tel-tuile" />
            <b>{SHORTCUT_NAME}</b>
            <span className="tel-champ">ytc_…</span>
            <span className="tel-bouton tel-bouton--or">Ajouter le raccourci</span>
          </div>
        </div>
      );
    default:
      return (
        <div className="tel-ecran tel-partage">
          <span className="tel-toast"><Icone nom="ok" taille="s" />Vidéo enregistrée dans Photos</span>
          <span className="tel-video"><Icone nom="lecture" plein /></span>
          <div className="tel-feuille">
            <span className="tel-poignee" />
            <span className="tel-apps"><i /><i className="tel-app-or"><ShortcutTile size={26} /></i><i /><i /></span>
            <span className="tel-menu"><span>{MENU.mp4}</span><span>{MENU.mp3}</span></span>
          </div>
        </div>
      );
  }
}

export function TelephoneInstall({ etape, chouette }: { etape: number; chouette: MascotState }) {
  return (
    <figure className="tel" aria-hidden="true">
      <div className="tel-perche"><AethryonMascot state={chouette} size={150} /></div>
      <div className="tel-cadre">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={etape} className="tel-scene" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.component, ease: EASE.soft }}>
            <Ecran etape={etape} />
          </motion.div>
        </AnimatePresence>
      </div>
      <figcaption className="tel-legende"><Etiquette>Exemple</Etiquette></figcaption>
    </figure>
  );
}
