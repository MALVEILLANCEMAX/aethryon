// « Six thèmes, et le tien » (Égide v2) : chaque carte est une mini-fenêtre aux jetons de SON thème (portée .eg-scope :
// les thèmes officiels par leur seul attribut, le thème personnel par ses variables, posées par CSSOM quand le moteur
// est chargé). Un clic : toute la page suit, tout de suite (fondu croisé de 200 ms, coupé en mouvement réduit), et le
// choix est gardé sur cet appareil. « Ouvrir l'éditeur » mène à Réglages › Apparence (espace).
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { chargerSocle, choisirThemeSite, THEMES, useThemeActif, type ThemeId } from "../../lib/apparence.ts";
import { Chouette, Icone } from "../../ui/egide/Egide.tsx";

function Mini({ id }: { id: ThemeId }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (id !== "custom" || !ref.current) return;
    let vivant = true;
    // Le thème personnel enregistré (sinon l'exemple Vert-de-gris), appliqué à la seule mini-fenêtre.
    void chargerSocle().then((m) => {
      if (!vivant || !ref.current) return;
      const pref = m.creerPersistance().lire();
      m.appliquerTheme(ref.current, pref.perso ?? m.CUSTOM_EXEMPLE);
    });
    return () => { vivant = false; };
  }, [id]);
  const officiel = THEMES.find((t) => t.id === id)!;
  return (
    <span ref={ref} className="s-mini eg-scope" aria-hidden="true" data-eg-theme={id === "custom" ? "obsidian" : id} data-eg-mode={officiel.mode}>
      <span className="s-mini-barre"><Chouette taille={10} /><i /></span>
      <span className="s-mini-corps"><i className="s-m-nav" /><span className="s-m-trav"><i className="s-m-champ" /><i className="s-m-fil"><i /></i><i className="s-m-btn" /></span></span>
    </span>
  );
}

export function CartesThemes() {
  const actif = useThemeActif();
  return (
    <section id="themes" aria-labelledby="t-themes" className="s-section">
      <div className="s-section-tete">
        <h2 id="t-themes" className="eg-titre s-h2">Six thèmes, et le tien</h2>
        <p>Choisis-en un : toute la page suit, tout de suite.</p>
      </div>
      <div className="s-cartes-themes" role="group" aria-label="Thèmes">
        {THEMES.map((t) => (
          <button key={t.id} className="s-carte-theme" type="button" aria-pressed={actif === t.id} onClick={() => void choisirThemeSite(t.id)}>
            <Mini id={t.id} />
            <b>{t.nom}</b><small>{t.texte}</small>
          </button>
        ))}
      </div>
      <p className="s-themes-lien">
        <Link to="/dashboard/apparence" className="eg-btn eg-btn--discret"><Icone nom="theme" taille="s" />Ouvrir l'éditeur de thèmes</Link>
      </p>
    </section>
  );
}
