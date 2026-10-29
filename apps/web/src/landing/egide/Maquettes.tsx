// Maquettes des portes (« Le Passage », étape 2) : chaque façon d'utiliser AETHRYON montrée telle qu'on la voit, en
// formes simples (HTML + CSS, aucune image, aucun logo de plateforme ni imitation d'une interface tierce). Décor :
// cachées aux lecteurs d'écran (le texte du panneau dit tout). Chaque maquette joue UNE courte scène quand sa porte
// s'ouvre (data-joue posé par Stations.tsx), puis reste dans son état final ; le HTML pré-rendu et le mouvement réduit
// montrent directement cet état final (egide-site.css, « Portes »).
import { Etiquette, Icone } from "../../ui/egide/Egide.tsx";
import { ChouetteMatiere } from "./Vitrine.tsx";

/** La chouette maître en SVG (matière du thème), à la taille d'une icône de maquette : aucune image. */
const Ch = ({ t }: { t: number }) => <ChouetteMatiere className={`mq-chouette mq-chouette-${t}`} defs={false} />;

/** Extension : la vidéo, le bouton AETHRYON dessous, le passage choisi sur la frise. */
export function MqExtension() {
  return (
    <div className="mq mq-ext">
      <div className="mq-barre"><i /><i /><i /><span className="mq-adresse">video.exemple/regarder</span></div>
      <div className="mq-video"><span className="mq-lecture" /><span className="mq-tete" /></div>
      <div className="mq-ext-bouton">
        <span className="mq-marque"><Ch t={14} />AETHRYON</span>
        <span className="mq-fmts"><Etiquette ton="accent">MP4</Etiquette><Etiquette>MP3</Etiquette><Etiquette>GIF</Etiquette></span>
      </div>
      <div className="mq-frise"><span className="mq-sel" /><span className="mq-tc">1:02 → 1:32</span></div>
    </div>
  );
}

/** Premiere Pro : un lien collé dans le panneau, le passage qui arrive dans le chutier. */
export function MqPremiere() {
  return (
    <div className="mq mq-pr">
      <div className="mq-pr-chutier">
        <span className="mq-pr-titre"><Icone nom="chutier" taille="s" />Chutier</span>
        <span className="mq-clip"><i />plan_large.mp4</span>
        <span className="mq-clip"><i />interview.mov</span>
        <span className="mq-clip mq-clip-nouveau"><i />passage_0102.mp4</span>
        <span className="mq-sequence"><i /><i /><i className="mq-seq-nouveau" /></span>
      </div>
      <div className="mq-pr-panneau">
        <span className="mq-pr-titre"><Ch t={14} />AETHRYON</span>
        <span className="mq-champ"><Icone nom="lien" taille="s" />lien collé</span>
        <span className="mq-pr-ligne"><Etiquette ton="accent">MP4</Etiquette><span className="mq-tc">1:02 → 1:32</span></span>
        <span className="mq-bouton">Importer</span>
      </div>
    </div>
  );
}

/** iPhone : la feuille de partage, AETHRYON, et le fichier dans Photos. */
export function MqIphone() {
  return (
    <div className="mq mq-ios">
      <div className="mq-tel">
        <span className="mq-encoche" />
        <span className="mq-toast"><Icone nom="ok" taille="s" />Enregistré</span>
        <span className="mq-tel-video" />
        <div className="mq-feuille">
          <span className="mq-poignee" />
          <span className="mq-apps"><i /><i className="mq-app-or"><Ch t={18} /></i><i /><i /></span>
          <span className="mq-feuille-ligne"><b>AETHRYON</b><Etiquette ton="accent">MP4</Etiquette></span>
        </div>
      </div>
    </div>
  );
}

/** Discord : le lien dans un salon, le fichier en réponse. */
export function MqDiscord() {
  return (
    <div className="mq mq-dc">
      <div className="mq-dc-salons"><i /><i /><i className="on" /><i /></div>
      <div className="mq-dc-fil">
        <span className="mq-dc-salon"># montage</span>
        <span className="mq-msg mq-msg-ancien"><i className="mq-avatar" /><span><b>léa</b><i className="mq-barre-texte" /></span></span>
        <span className="mq-msg"><i className="mq-avatar" /><span><b>toi</b><code>/convert lien MP4</code></span></span>
        <span className="mq-msg mq-msg-bot"><i className="mq-avatar mq-avatar-or"><Ch t={16} /></i><span><b>AETHRYON</b>
          <span className="mq-fichier"><Icone nom="fichier" taille="s" />passage.mp4<Etiquette>12 Mo</Etiquette></span></span></span>
      </div>
    </div>
  );
}

/** Forme d'onde de la maquette Tools : 61 traits calculés une fois (déterministe, identique au pré-rendu). */
const ONDE = Array.from({ length: 61 }, (_, i) => {
  const x = (i / 60) * 200, h = 3 + Math.abs(Math.sin(i * 0.45) * 8 + Math.sin(i * 1.7) * 4);
  return `M${x.toFixed(1)} ${(15 - h).toFixed(1)}V${(15 + h).toFixed(1)}`;
}).join("");

/** Tools : l'aperçu, la forme d'onde, les deux poignées du passage, l'export. */
export function MqTools() {
  return (
    <div className="mq mq-tl">
      <div className="mq-tl-apercu"><span className="mq-lecture" /></div>
      <div className="mq-tl-piste">
        <svg className="mq-onde" viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={ONDE} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
        <span className="mq-tl-region"><i className="mq-poignee-g" /><i className="mq-poignee-d" /></span>
      </div>
      <div className="mq-tl-pied"><span className="mq-tc">0:42 → 1:12</span><span className="mq-bouton">Exporter en MP4</span></div>
    </div>
  );
}

/** Espace web : le quota du jour et l'historique partagé par toutes les portes. */
export function MqWeb() {
  return (
    <div className="mq mq-web">
      <div className="mq-anneau">
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="26" className="mq-anneau-fond" /><circle cx="32" cy="32" r="26" className="mq-anneau-run" pathLength="100" /></svg>
        <span><b>3</b>sur 10</span>
      </div>
      <div className="mq-histo">
        <span className="mq-ligne"><Etiquette ton="accent">MP4</Etiquette><i />il y a 2 min</span>
        <span className="mq-ligne"><Etiquette>MP3</Etiquette><i />ce matin</span>
        <span className="mq-ligne"><Etiquette>GIF</Etiquette><i />hier</span>
      </div>
    </div>
  );
}
