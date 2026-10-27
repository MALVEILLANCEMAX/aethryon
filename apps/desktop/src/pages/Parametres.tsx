// Paramètres : neuf catégories — une navigation collante à gauche (elle suit la lecture), les réglages à droite,
// regroupés en panneaux Égide. Les explications ne sont pas écrites en permanence : un « i » à côté du titre les donne
// au survol ou au focus (bulle), et le lecteur d'écran les lit. Apparence : les six thèmes et l'ÉDITEUR d'Égide
// (creerEditeurThemes : aperçu immédiat, 27 contrastes, import, export Copier + Télécharger, réinitialisation, gardé sur
// cet appareil ; lib/apparence.ts). TOUTES les options d'avant sont là : compte
// (liaison par code, chargé à la demande), mouvement, présence de la chouette, dossier des médias,
// surveillance, autres dossiers surveillés, Premiere Pro (chutier d'import, réparer), notifications, démarrage,
// mises à jour (« Rechercher », « Mettre à jour » : jamais sans clic ; lib/miseAJour.ts), journaux, rapport, licences,
// réparer, désinstaller.
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import "../styles/parametres.css";
import { useMagasin } from "../lib/magasin";
import { dossierAmical, taille, typo } from "../lib/format";
import { api, messageErreur } from "../lib/api";
import type { Animations, Chutier } from "../lib/types";
import { Bouton, BoutonIcone, Icone, Interrupteur, Segmente } from "../ui/base";
import { Dialogue, useToast } from "../ui/superpositions";
import { Chouette } from "../ui/marque";
import { installer, rechercher, resume, useMiseAJour } from "../lib/miseAJour";
import { useCompanion } from "../ui/Companion";
import { LICENCES } from "../lib/licences";
import { prendreCibleReglage } from "../lib/reglageCible";
import { mouvementReduit } from "../lib/mouvement";
import type { Presence } from "../lib/companion";
import type { NomIcone } from "../ui/traces";
import { Aide } from "../ui/Aide";
import { scannerDisponible } from "../lib/scanner";
import { ReglagesIndex } from "../index/ReglagesIndex";
import { creerEditeurThemes, regionToasts } from "../lib/egide";
import { nomThemeApplique, persistance, surTheme } from "../lib/apparence";

const CompteReglages = lazy(() => import("./CompteReglages"));

/** Région des notifications de l'éditeur (une seule pour toute la session). */
let regionEditeur: HTMLDivElement | null = null;

/** L'éditeur de thèmes d'Égide, monté dans la page (fonctions DOM du socle, nettoyées au démontage). */
function EditeurApparence() {
  const hote = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hote.current;
    if (!el) return;
    if (!regionEditeur) {
      regionEditeur = regionToasts();
      regionEditeur.setAttribute("aria-label", "Notifications de l'apparence");
    }
    const e = creerEditeurThemes(el, { persistance, toasts: regionEditeur });
    return () => e.detruire();
  }, []);
  return <div ref={hote} className="reg-editeur" />;
}

/** Nom du thème appliqué, suivi en direct (éditeur, Annuler, réinitialisation). */
function useNomTheme(): string {
  return useSyncExternalStore(surTheme, nomThemeApplique);
}

const PHRASES_PRESENCE: Record<Presence, string> = {
  discrete: "Discrète : autour de sa médaille, la chouette signale les transferts, les réussites et les erreurs.",
  expressive: "Expressive : elle signale plus souvent et propose des astuces.",
  muette: "Muette : médaille fixe, aucune astuce ; l'état reste écrit à côté.",
};

interface Categorie { id: string; titre: string; icone: NomIcone }
const CATEGORIES: Categorie[] = [
  { id: "compte", titre: "Compte", icone: "user" },
  { id: "apparence", titre: "Apparence", icone: "theme" },
  { id: "medias", titre: "Médias et dossiers", icone: "folder" },
  ...(scannerDisponible ? [{ id: "index", titre: "AETHRYON Index", icone: "scan" as NomIcone }] : []),
  { id: "premiere", titre: "Premiere Pro", icone: "import" },
  { id: "notifications", titre: "Notifications", icone: "bell" },
  { id: "demarrage", titre: "Démarrage", icone: "power" },
  { id: "maj", titre: "Mises à jour", icone: "update" },
  { id: "maintenance", titre: "À propos et maintenance", icone: "log" },
];

/** Un réglage : pictogramme, titre (et aide), contenu sous le titre, commande à droite. */
function Reglage({ icone, titre, aide, children, commande, pile, reglage }: {
  icone?: NomIcone | ReactNode; titre: string; aide?: string; children?: ReactNode; commande?: ReactNode; pile?: boolean; reglage?: string;
}) {
  return (
    <div className={`row reg${pile ? " row--pile" : ""}`} data-reglage={reglage}>
      {icone && <span className="tile">{typeof icone === "string" ? <Icone nom={icone as NomIcone} taille={16} /> : icone}</span>}
      <div className="grow">
        <div className="rt reg-titre">{titre}{aide && <Aide texte={aide} />}</div>
        {children}
      </div>
      {commande}
    </div>
  );
}

function Categorie({ c, children }: { c: Categorie; children: ReactNode }) {
  return (
    <section className="reg-cat" id={`reg-${c.id}`} aria-labelledby={`reg-${c.id}-titre`} data-categorie={c.id}>
      <h2 className="reg-cat-titre" id={`reg-${c.id}-titre`}><Icone nom={c.icone} taille={16} />{c.titre}</h2>
      {children}
    </section>
  );
}

function MisesAJour({ version, panneau }: { version: string; panneau: string }) {
  const maj = useMiseAJour();
  const { titre, detail } = resume(maj, version);
  const occupe = maj.phase === "recherche" || maj.phase === "telechargement" || maj.phase === "verification" || maj.phase === "lancement";
  const notes = maj.phase === "disponible" ? maj.recherche?.annonce.notes ?? [] : [];
  const pct = maj.total ? Math.min(100, ((maj.fait ?? 0) / maj.total) * 100) : 0;
  return (
    <div className="row" data-maj={maj.phase}><span className={`tile${maj.phase === "disponible" ? " tile--gold" : ""}`}><Icone nom="update" taille={16} /></span>
      <div className="grow">
        <div className="rt" aria-live="polite">{typo(titre)}</div>
        <div className="rd">{typo(detail)}</div>
        {notes.length > 0 && <ul className="maj-notes">{notes.map((n) => <li key={n}>{typo(n)}</li>)}</ul>}
        {(maj.phase === "telechargement" || maj.phase === "verification") && (
          <div className="maj-barre" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(maj.phase === "verification" ? 100 : pct)} aria-label="Avancement de la mise à jour"><i style={{ width: `${maj.phase === "verification" ? 100 : pct}%` }} /></div>
        )}
        <div className="rd reg-versions">{typo(`Desktop ${version} · panneau ${panneau}`)}</div>
        <div className="reg-boutons">
          <Bouton taille="sm" onClick={() => void rechercher()} disabled={occupe} occupe={maj.phase === "recherche"}>Rechercher les mises à jour</Bouton>
          {(maj.phase === "disponible" || (maj.phase === "erreur" && maj.recherche?.disponible)) && <Bouton taille="sm" variante="primary" icone="update" onClick={() => void installer()}>Mettre à jour</Bouton>}
        </div>
      </div>
    </div>
  );
}

export default function Parametres({ onReparer }: { onReparer: () => void }) {
  const { inst, modifierConfig, rafraichir, aller } = useMagasin();
  const { presence, definirPresence } = useCompanion();
  const theme = useNomTheme();
  const toast = useToast();
  const [licences, setLicences] = useState(false);
  const [textesPolices, setTextesPolices] = useState<readonly (readonly [string, string])[] | null>(null);
  useEffect(() => { if (licences && !textesPolices) void import("../lib/licencesPolices").then((m) => setTextesPolices(m.TEXTES_POLICES)).catch(() => {}); }, [licences, textesPolices]);
  const [desinstaller, setDesinstaller] = useState(false);
  const [webview, setWebview] = useState<string | null>(null);
  const [active, setActive] = useState("compte");
  const corps = useRef<HTMLDivElement>(null);
  const bloque = useRef(0);
  useEffect(() => {
    api.webview2().then(setWebview).catch(() => {});
  }, []);
  // Navigation qui suit la lecture : la dernière catégorie dont le titre a passé le tiers haut de la page. Après un
  // clic, la catégorie choisie reste marquée pendant le défilement (même si le bas de page l'empêche d'arriver en haut).
  useEffect(() => {
    const page = corps.current?.closest<HTMLElement>(".page");
    if (!page) return;
    let raf = 0;
    const suivre = () => {
      raf = 0;
      if (performance.now() < bloque.current) return;
      const haut = page.getBoundingClientRect();
      let id = CATEGORIES[0].id;
      for (const el of page.querySelectorAll<HTMLElement>(".reg-cat")) if (el.getBoundingClientRect().top - haut.top <= haut.height * 0.3) id = el.dataset.categorie!;
      setActive(id);
    };
    const surDefilement = () => { if (!raf) raf = requestAnimationFrame(suivre); };
    page.addEventListener("scroll", surDefilement, { passive: true });
    // Arrivée ciblée (« Gérer le compte » depuis Intégrations…) : la catégorie est montrée tout de suite.
    const cible = prendreCibleReglage();
    if (cible) montrer(cible, true);
    return () => { page.removeEventListener("scroll", surDefilement); cancelAnimationFrame(raf); };
  }, [!!inst]);
  if (!inst) return null;
  const c = inst.config;
  const autres = c.dossiersSurveilles.filter((d) => d.toLowerCase() !== c.dossierMedias.toLowerCase());

  const choisir = async (titre: string) => {
    try {
      return await api.choisirDossier(titre);
    } catch (e) {
      toast({ etat: "erreur", titre: "Sélection impossible", texte: messageErreur(e) });
      return null;
    }
  };
  const ajouterDossier = async () => {
    const d = await choisir("Ajouter un dossier surveillé");
    if (!d) return;
    try {
      await api.dossierAjouter(d);
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: "Dossier non ajouté", texte: messageErreur(e) });
    }
  };
  const retirerDossier = async (d: string) => {
    try {
      await api.dossierRetirer(d);
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: "Dossier non retiré", texte: messageErreur(e) });
    }
  };
  const exporter = async () => {
    try {
      const f = await api.rapportExporter();
      if (f) toast({ etat: "ok", titre: "Rapport exporté", texte: f });
    } catch (e) {
      toast({ etat: "erreur", titre: "Rapport non exporté", texte: messageErreur(e) });
    }
  };
  /** Clic : défilement doux (sauf mouvement réduit) ; clavier (detail 0) : instantané. Seule la page défile. */
  function montrer(id: string, clavier: boolean) {
    const page = corps.current?.closest<HTMLElement>(".page");
    const el = document.getElementById(`reg-${id}`);
    setActive(id);
    if (!page || !el) return;
    bloque.current = performance.now() + 900;
    const top = el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - 10;
    page.scrollTo({ top: Math.max(0, top), behavior: clavier || mouvementReduit() ? "auto" : "smooth" });
  }
  const [nbJ, octets] = inst.journaux;
  const cat = (id: string) => CATEGORIES.find((x) => x.id === id)!;

  return (
    <div className="reg-page">
      <div className="ph"><div className="grow"><h1 className="t-display-l">Paramètres</h1></div></div>
      <div className="reg-cols">
        <nav className="reg-nav" aria-label="Catégories des paramètres">
          {CATEGORIES.map((x) => (
            <a key={x.id} href={`#reg-${x.id}`} aria-current={active === x.id ? "true" : undefined} onClick={(e) => { e.preventDefault(); montrer(x.id, e.detail === 0); }}>
              <Icone nom={x.icone} taille={16} /><span>{x.titre}</span>
            </a>
          ))}
        </nav>
        <div className="reg-corps" ref={corps}>
          <Categorie c={cat("compte")}>
            <Suspense fallback={<div className="group reg-attente" aria-busy="true" />}><CompteReglages /></Suspense>
          </Categorie>

          <Categorie c={cat("apparence")}>
            <div className="group">
              <Reglage icone="theme" titre="Thème" aide="Six thèmes, ou le tien : l'aperçu change tout de suite, « Appliquer » le garde sur cet appareil (fenêtre, écran de démarrage et menu de la zone de notification)."
                commande={<span className="eg-pastille" data-ton="accent">{theme}</span>} />
            </div>
            <EditeurApparence />
            <div className="group">
              <Reglage icone="motion" titre="Réduire les animations" aide="Système : suit le thème et « Effets d'animation » de Windows. Oui : aucun déplacement ni boucle, fondus courts seulement. Non : le thème décide, même si Windows réduit les animations."
                commande={<Segmente<Animations> libelle="Réduire les animations" valeur={c.reduireAnimations} onChange={(v) => modifierConfig({ reduireAnimations: v })} options={[{ id: "systeme", libelle: "Système" }, { id: "oui", libelle: "Oui" }, { id: "non", libelle: "Non" }]} />} />
              <Reglage icone={<Chouette taille={16} />} titre="Présence de la chouette" aide="Comment la chouette d'AETHRYON accompagne ton travail." pile reglage="presence">
                <Segmente<Presence> libelle="Présence de la chouette" valeur={presence} onChange={definirPresence} options={[{ id: "discrete", libelle: "Discrète" }, { id: "expressive", libelle: "Expressive" }, { id: "muette", libelle: "Muette" }]} />
                <div className="rd rd--choix" aria-live="polite">{typo(PHRASES_PRESENCE[presence])}</div>
              </Reglage>
            </div>
          </Categorie>

          <Categorie c={cat("medias")}>
            <div className="group">
              <Reglage icone={<Icone nom="folder" taille={16} />} titre="Dossier des médias" aide="Les fichiers convertis et importés y arrivent ; tes fichiers ne sont jamais déplacés."
                commande={<Bouton taille="sm" onClick={async () => { const d = await choisir("Dossier des médias AETHRYON"); if (d) await modifierConfig({ dossierMedias: d }); }}>Modifier…</Bouton>}>
                <div className="rd reg-chemin"><b>{dossierAmical(c.dossierMedias)}</b><span className="mono ellipsis" title={c.dossierMedias}>{c.dossierMedias}</span></div>
              </Reglage>
              <Reglage icone="retry" titre="Surveiller ce dossier" aide="Les nouveaux fichiers du dossier sont ajoutés à la bibliothèque."
                commande={<Interrupteur libelle="Surveiller ce dossier" actif={c.surveillance} onChange={(v) => modifierConfig({ surveillance: v })} />} />
              <Reglage icone="library" titre="Autres dossiers surveillés" aide="Leurs fichiers apparaissent aussi dans la bibliothèque ; ils restent à leur place."
                commande={<Bouton taille="sm" variante="ghost" icone="plus" onClick={ajouterDossier}>Ajouter…</Bouton>}>
                {autres.length === 0 ? <div className="rd">Aucun.</div> : (
                  <div className="paths reg-dossiers">
                    {autres.map((d) => (
                      <div key={d} className="chemin-surveille"><span className="rd mono ellipsis" title={d}>{d}</span><BoutonIcone nom="close" libelle={`Ne plus surveiller ${d}`} taille="xs" onClick={() => retirerDossier(d)} /></div>
                    ))}
                  </div>
                )}
              </Reglage>
            </div>
          </Categorie>

          {scannerDisponible && (
            <Categorie c={cat("index")}>
              <ReglagesIndex onScanner={() => aller("scanner")} />
            </Categorie>
          )}

          <Categorie c={cat("premiere")}>
            <div className="group">
              <Reglage icone="import" titre="Chutier d'import" aide="Chutier où le panneau range les médias importés depuis AETHRYON. L'import n'est jamais automatique : il part toujours d'une demande de ta part." pile>
                <Segmente<Chutier> libelle="Chutier d'import" valeur={c.chutierParDefaut} onChange={(v) => modifierConfig({ chutierParDefaut: v })}
                  options={[{ id: "aethryon", libelle: "AETHRYON" }, { id: "selection", libelle: "Chutier sélectionné" }, { id: "racine", libelle: "Racine" }]} />
              </Reglage>
              <Reglage icone="link" titre="Liaison avec Premiere Pro" aide="État du panneau, vérification de compatibilité et désinstallation : Intégrations."
                commande={<Bouton taille="sm" variante="ghost" onClick={() => aller("integrations")}>Ouvrir Intégrations</Bouton>} />
            </div>
          </Categorie>

          <Categorie c={cat("notifications")}>
            <div className="group">
              <Reglage icone="bell" titre="Média prêt" commande={<Interrupteur libelle="Média prêt" actif={c.notifications.mediaPret} onChange={(v) => modifierConfig({ notifications: { mediaPret: v } })} />} />
              <Reglage icone="import" titre="Import réussi dans Premiere" commande={<Interrupteur libelle="Import réussi dans Premiere" actif={c.notifications.importReussi} onChange={(v) => modifierConfig({ notifications: { importReussi: v } })} />} />
              <Reglage icone="error" titre="Erreurs" commande={<Interrupteur libelle="Erreurs" actif={c.notifications.erreurs} onChange={(v) => modifierConfig({ notifications: { erreurs: v } })} />} />
            </div>
          </Categorie>

          <Categorie c={cat("demarrage")}>
            <div className="group">
              <Reglage icone="power" titre="Lancer au démarrage de Windows" aide="AETHRYON démarre réduit dans la zone de notification et suit tes transferts."
                commande={<Interrupteur libelle="Lancer au démarrage de Windows" actif={c.demarrageAuto} onChange={(v) => modifierConfig({ demarrageAuto: v })} />} />
            </div>
          </Categorie>

          <Categorie c={cat("maj")}>
            <div className="group">
              <MisesAJour version={inst.version} panneau={inst.panneauCep ? inst.panneauCep.version ?? "installé" : "absent"} />
            </div>
          </Categorie>

          <Categorie c={cat("maintenance")}>
            <div className="group">
              <Reglage icone={<Chouette taille={18} />} titre={`AETHRYON Desktop ${inst.version}`} aide="Marcellus, Hanken Grotesk, Geist Mono : SIL OFL 1.1"
                commande={<Bouton taille="sm" variante="ghost" onClick={() => setLicences(true)}>Licences</Bouton>} />
              <Reglage icone="log" titre="Journaux locaux" aide="Gardés 14 jours sur cet ordinateur. Rien n'est envoyé.">
                <div className="rd">{typo(`${nbJ} fichier${nbJ > 1 ? "s" : ""} · ${taille(octets)}`)}</div>
                <div className="reg-boutons"><Bouton taille="sm" onClick={() => api.ouvrirDossier("journaux")}>Ouvrir le dossier</Bouton><Bouton taille="sm" variante="ghost" onClick={exporter}>Exporter un rapport…</Bouton></div>
              </Reglage>
              <Reglage icone="repair" titre="Réparer l'installation" aide="Réinstalle le panneau et les composants, garde tes médias."
                commande={<Bouton taille="sm" icone="repair" onClick={onReparer}>Réparer</Bouton>} />
              <Reglage icone="trash" titre="Désinstaller AETHRYON" aide={`Tes médias restent dans ${dossierAmical(c.dossierMedias)}.`}
                commande={<Bouton taille="sm" variante="danger" onClick={() => setDesinstaller(true)}>Désinstaller…</Bouton>} />
            </div>
          </Categorie>
        </div>
      </div>

      {licences && (
        <Dialogue titre="Licences" large onFermer={() => setLicences(false)} actions={<Bouton variante="primary" onClick={() => setLicences(false)}>Fermer</Bouton>}>
          <dl className="licences">{LICENCES.map(([n, l]) => <div key={n}><dt>{n}</dt><dd>{typo(l)}</dd></div>)}</dl>
          {textesPolices && (
            <details className="licences-ofl">
              <summary>Textes complets des licences des polices (SIL OFL 1.1)</summary>
              {textesPolices.map(([n, t]) => <section key={n} aria-label={`Licence ${n}`}><h3>{n}</h3><pre className="mono">{t}</pre></section>)}
            </details>
          )}
          <p className="t-small c3" style={{ marginTop: 12 }}>{typo(`WebView2 ${webview ?? "non lu"}. Aucune bibliothèque FFmpeg n'est livrée : miniatures et durées viennent du WebView2 et de la lecture des en-têtes MP4.`)}</p>
        </Dialogue>
      )}
      {desinstaller && (
        <Dialogue titre="Désinstaller AETHRYON ?" onFermer={() => setDesinstaller(false)}
          actions={<><Bouton variante="ghost" onClick={() => setDesinstaller(false)}>Annuler</Bouton><Bouton variante="danger" onClick={async () => { try { await api.lancerDesinstalleur(); } catch (e) { toast({ etat: "erreur", titre: "Désinstalleur introuvable", texte: messageErreur(e) }); } setDesinstaller(false); }}>Ouvrir le désinstalleur</Bouton></>}>
          <p>{typo("Le désinstalleur retire le panneau de Premiere Pro, les clés de la liaison navigateur et le démarrage automatique. Il te demandera si tu gardes tes médias.")}</p>
        </Dialogue>
      )}
    </div>
  );
}
