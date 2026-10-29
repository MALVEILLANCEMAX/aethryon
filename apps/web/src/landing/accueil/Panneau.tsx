// Panneau latéral de l'accueil (2026-10-29 ; à la manière du panneau de Datenshi) : tout ce qui n'est pas le champ,
// rangé pour être retrouvé d'un coup d'œil — nouvelle conversion, applications, plateformes, tarifs, aide, réglages
// (thème, langue), compte. Peu de mots : des noms, des pastilles, une ligne au plus ; le détail reste dans les sections de
// l'accueil et dans les pages. Fenêtre modale native (<dialog>) : le focus reste dedans, Échap et le voile la ferment.
import { lazy, Suspense, useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { EN_LIGNE, etatAffiche } from "../../lib/catalogue.ts";
import { choisirThemeSite, THEMES, useThemeActif } from "../../lib/apparence.ts";
import { ouvrirPreferences } from "../../lib/confidentialite.ts";
import { DISCORD_PUBLIC, DISCORD_STATUS } from "../../lib/discord.ts";
import { EXTENSION_AVAILABLE, EXTENSION_STATUS } from "../../lib/extension.ts";
import { useConfig, useMe, useStatus } from "../../lib/hooks.ts";
import { choisirLangue, LANGUES, useLangue } from "../../lib/langue.ts";
import { ouvrirNouveautes, VERSION_SITE } from "../../lib/nouveautes.ts";
import { OFFRES_MODE, planById, PREMIUM_PAGE } from "../../lib/offres.ts";
import { useT } from "../../i18n/accueil.ts";
import { GITHUB_PUBLIC, GITHUB_URL } from "../../lib/github.ts";
import { GithubMark } from "../../ui/brand/GithubMark.tsx";
import { TuileProduit } from "../../ui/brand/TuileProduit.tsx";
import { Icone } from "../../ui/egide/Egide.tsx";
import { ChouettePixel } from "./ChouettePixel.tsx";

const FragmentAile = lazy(() => import("./Ailes.tsx").then((m) => ({ default: m.FragmentAile })));

const TON = { ok: "ok", degraded: "warn", paused: "warn", down: "err" } as const;

function Groupe({ titre, children }: { titre: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ac-groupe" aria-labelledby={id}>
      <h2 id={id} className="ac-groupe-titre">{titre}</h2>
      {children}
    </section>
  );
}

export function Panneau({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titre = useId();
  const t = useT();
  const langue = useLangue();
  const cfg = useConfig();
  const me = useMe();
  const st = useStatus();
  const theme = useThemeActif();
  const connecte = !!me.data && !me.error;
  const ouvertes = EN_LIGNE.filter((p) => etatAffiche(p, cfg.data?.platforms) === "en-ligne");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ouvert && !d.open) d.showModal();
    if (!ouvert && d.open) d.close();
  }, [ouvert]);

  const statut = (s: string | null) => (s ? t.statuts[s] ?? s : null);
  const apps = [
    { produit: "extension", nom: t.portes.extension.court, to: "/extension", statut: EXTENSION_AVAILABLE ? null : statut(EXTENSION_STATUS.label) },
    { produit: "premiere", nom: t.portes.premiere.court, to: "/#porte-premiere", statut: null },
    { produit: "iphone", nom: t.portes.iphone.court, to: "/installer", statut: null },
    { produit: "discord", nom: t.portes.discord.court, to: "/#porte-discord", statut: DISCORD_PUBLIC ? null : statut(DISCORD_STATUS.label) },
    { produit: "tools", nom: t.portes.tools.court, to: "/outils", statut: statut("Bêta") },
  ] as const;
  const fermer = () => onFermer();

  return (
    <dialog ref={ref} className="ac-panneau" aria-labelledby={titre} onClose={onFermer}
      onClick={(e) => { if (e.target === ref.current) onFermer(); }} data-panneau="">
      {ouvert && <Suspense fallback={null}><FragmentAile /></Suspense>}
      <div className="ac-panneau-corps">
        <div className="ac-panneau-tete">
          <p id={titre} className="ac-panneau-marque"><ChouettePixel taille={30} className="ac-chouette--panneau" />AETHRYON</p>
          <button type="button" className="ac-icone" onClick={fermer} aria-label={t.fermerMenu} autoFocus><Icone nom="croix" /></button>
        </div>
        <button type="button" className="ac-panneau-nouveau" onClick={() => { fermer(); window.dispatchEvent(new Event("aethryon:nouvelle-conversion")); }}>
          <Icone nom="plus" taille="s" />{t.nouvelleConversion}
        </button>

        <div className="ac-panneau-groupes">
          <Groupe titre={t.applications}>
            <ul className="ac-apps">
              {apps.map((a) => (
                <li key={a.produit}>
                  <Link to={a.to} onClick={fermer} className="ac-app" data-panneau-app={a.produit}>
                    <TuileProduit produit={a.produit} size={28} />
                    <span>{a.nom}</span>
                    {a.statut && <span className="ac-app-statut">{a.statut}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Groupe>

          <Groupe titre={t.plateformes}>
            <ul className="ac-puces" aria-label={t.plateformes}>
              {ouvertes.map((p) => <li key={p.id}>{p.nom}</li>)}
            </ul>
            <Link to="/#plateformes" onClick={fermer} className="ac-panneau-lien">{t.toutesPlateformes}<Icone nom="chevron" taille="s" /></Link>
          </Groupe>

          <Groupe titre={t.tarifs}>
            <p className="ac-panneau-texte">{t.tarifLigne(cfg.data?.quotas?.daily ?? planById("free").limits.daily)}</p>
            {PREMIUM_PAGE && <p className="ac-panneau-texte ac-panneau-texte--doux" data-panneau-premium="">{OFFRES_MODE === "vente" ? t.premiumOuvert : t.premiumBientot}</p>}
            {PREMIUM_PAGE && <Link to="/premium" onClick={fermer} className="ac-panneau-lien">{t.voirOffres}<Icone nom="chevron" taille="s" /></Link>}
          </Groupe>

          <Groupe titre={t.aide}>
            <ul className="ac-liens">
              <li><Link to="/#faq" onClick={fermer}>{t.questionsFrequentes}</Link></li>
              <li><Link to="/aide" onClick={fermer}>{t.centreAide}</Link></li>
              {GITHUB_PUBLIC && (
                <li><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="ac-lien-github" data-panneau-github=""><GithubMark size={17} />{t.github}<span className="eg-vh">{t.githubSr}</span></a></li>
              )}
              <li>
                <Link to="/aide#etat" onClick={fermer} className="ac-etat-service">
                  <span className="eg-pastille-point" data-ton={st.data ? TON[st.data.state] : undefined} aria-hidden="true" />
                  {st.data ? t.etats[st.data.state] : t.etatService}
                </Link>
              </li>
            </ul>
          </Groupe>

          <Groupe titre={t.reglages}>
            <div className="ac-themes" role="radiogroup" aria-label={t.theme}>
              {THEMES.map((th) => (
                <button key={th.id} type="button" role="radio" aria-checked={theme === th.id} onClick={() => void choisirThemeSite(th.id)} className="ac-theme">
                  <span className="egw-pastille-theme eg-scope" data-eg-theme={th.id === "custom" ? undefined : th.id} data-custom={th.id === "custom" ? "" : undefined} aria-hidden="true" />{th.nom}
                </button>
              ))}
            </div>
            <div className="ac-langues" role="radiogroup" aria-label={t.langue}>
              {LANGUES.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={langue === l.id} lang={l.id} onClick={() => choisirLangue(l.id)} className="ac-theme ac-theme--langue" data-panneau-langue={l.id}>{l.nom}</button>
              ))}
            </div>
            <ul className="ac-liens">
              <li><button type="button" onClick={() => { fermer(); ouvrirPreferences(); }}>{t.confidentialite}</button></li>
              <li><button type="button" onClick={() => { fermer(); ouvrirNouveautes(); }}>{t.nouveautes(VERSION_SITE)}</button></li>
              {connecte && <li><Link to="/dashboard/apparence" onClick={fermer}>{t.apparenceAvancee}</Link></li>}
            </ul>
            {langue !== "fr" && <p className="ac-panneau-texte ac-panneau-texte--doux">{t.autresPagesFr}</p>}
          </Groupe>
        </div>

        <div className="ac-panneau-compte">
          {connecte ? (
            <Link to="/dashboard" onClick={fermer} className="ac-compte" data-panneau-compte="">
              <span className="ac-compte-avatar" aria-hidden="true"><ChouettePixel taille={26} humeur="contente" vivante={false} className="ac-chouette--avatar" /></span>
              <span><b>{t.monEspace}</b><span>{me.data?.user.email ?? t.compteConnecte}</span></span>
            </Link>
          ) : (
            <>
              <Link to="/connexion" onClick={fermer} className="ac-compte" data-panneau-compte="">
                <span className="ac-compte-avatar" aria-hidden="true"><Icone nom="compte" taille="s" /></span>
                <span><b>{t.seConnecter}</b><span>{t.compteAnonyme}</span></span>
              </Link>
              <Link to="/commencer" onClick={fermer} className="ac-bouton ac-bouton--second ac-panneau-creer" data-nav-commencer="">{t.creerCompte}</Link>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
