// Coque « Nocturne » de la fenêtre Windows 11 sans cadre : barre latérale pleine hauteur (marque éclairée, navigation
// à surbrillance glissante, niche de la chouette, avis de mise à jour, version) et colonne de contenu (en-tête :
// fil d'Ariane, recherche Ctrl K, état discret de Premiere Pro et du dossier surveillé, compte, boutons de légende de
// 46 px ; puis la page, sa transition et le mini-lecteur). Sous 1 000 px : rail d'icônes.
// Raccourcis : Ctrl 1 à 7 (sections, dans l'ordre affiché : Musique = Ctrl 3), Ctrl K (recherche), Échap (aperçu).
// Mouvement : la page entre en 220 ms (fondu + 8 px) au CLIC seulement ; au clavier, rien n'anime (action répétée).
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, messageErreur } from "../lib/api";
import { useMagasin } from "../lib/magasin";
import { liaison } from "../lib/liaison";
import { dossierAmical } from "../lib/format";
import { rechercher, useMiseAJour } from "../lib/miseAJour";
import type { Section } from "../lib/types";
import { Icone } from "../ui/base";
import { Chouette, Logotype } from "../ui/marque";
import { Niche } from "../ui/Companion";
import { CoucheDepot } from "../ui/CoucheDepot";
import { flux, socleDisponible } from "../lib/fluxVue";
import type { RegleZone } from "../lib/flux";
import type { NomIcone } from "../ui/traces";
import { cloudOuvert, envoiPossible, envoisActifs, useCompte, useTransfertsCloud } from "../lib/compte";
import { pluriel } from "../lib/format";
import { useToast } from "../ui/superpositions";
import { useSignalMusique } from "../lib/musiqueSignal";
import { useAvisTransferts } from "../lib/avisTransferts";
import { useActiviteScan } from "../lib/activiteScan";

// Mini-lecteur de la section MUSIQUE : chargé seulement après une première lecture, puis présent dans toute la fenêtre.
const MiniLecteur = lazy(() => import("../musique/MiniLecteur"));

// Navigation. MUSIQUE (après la Bibliothèque) : section chargée à la demande, mini-lecteur persistant ensuite. CLOUD
// (après les Transferts) n'apparaît que si le compte relié est administrateur ET le cloud ouvert sur le serveur
// (lib/compte.ts) : sinon rien n'est montré (une explication sobre est dans Paramètres › Compte).
interface EntreeNav { id: Section; icone: NomIcone; libelle: string; disponible: boolean | "cloud" }
const NAV_COMPLETE: EntreeNav[] = [
  { id: "accueil", icone: "home", libelle: "Accueil", disponible: true },
  { id: "bibliotheque", icone: "library", libelle: "Bibliothèque", disponible: true },
  { id: "musique", icone: "note", libelle: "Musique", disponible: true },
  { id: "transferts", icone: "transfers", libelle: "Transferts", disponible: true },
  { id: "cloud", icone: "cloud", libelle: "Cloud", disponible: "cloud" },
  { id: "integrations", icone: "link", libelle: "Intégrations", disponible: true },
  { id: "parametres", icone: "settings", libelle: "Paramètres", disponible: true },
];
function navPour(cloud: boolean): [Section, NomIcone, string][] {
  return NAV_COMPLETE.filter((e) => e.disponible === true || (e.disponible === "cloud" && cloud)).map((e) => [e.id as Section, e.icone, e.libelle]);
}
const TITRES: Record<Section, string> = {
  accueil: "Accueil", bibliotheque: "Bibliothèque", musique: "Musique", transferts: "Transferts", cloud: "Cloud",
  integrations: "Intégrations", parametres: "Paramètres", scanner: "Scanner",
};

/** Zone « cloud » de Flow (D-SPEC §B.3, par position) : nos médias disponibles, d'un type accepté, partent vers le Cloud. */
function regleCloud(envoyer: (ids: string[]) => Promise<string | void>): RegleZone {
  return {
    verdict(c, ctx) {
      if (c.medias.length === 0) return { acceptable: false, actions: [], raison: c.fichiers.length ? "Ajoutez d'abord ces fichiers à la bibliothèque." : "Rien à envoyer vers le Cloud." };
      for (const id of c.medias) {
        const m = ctx.medias?.find((x) => x.id === id);
        if (!m) return { acceptable: false, actions: [], raison: "Média inconnu de la bibliothèque." };
        const p = envoiPossible(m);
        if (!p.ok) return { acceptable: false, actions: [], raison: `« ${m.nom} » : ${p.raison?.toLowerCase()}.` };
      }
      return { acceptable: true, actions: ["zone"], raison: null };
    },
    deposer: (c) => envoyer(c.medias),
  };
}

export function BoutonsLegende({ hauteur = 48, sansAgrandir }: { hauteur?: number; sansAgrandir?: boolean }) {
  return (
    <div className="captions" style={{ ["--cap-h" as string]: `${hauteur}px` }}>
      <button type="button" aria-label="Réduire" title="Réduire" onClick={() => api.fenetre("reduire")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      {!sansAgrandir && (
        <button type="button" aria-label="Agrandir" title="Agrandir" onClick={() => api.fenetre("agrandir")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
      )}
      <button type="button" className="fermer" aria-label="Fermer" title="Fermer (AETHRYON reste dans la zone de notification)" onClick={() => api.fenetre("fermer")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}

/** État de Premiere Pro et du dossier surveillé : deux puces discrètes de l'en-tête (texte complet en bulle). */
function Etats({ etroit }: { etroit: boolean }) {
  const { inst, aller } = useMagasin();
  if (!inst) return null;
  const l = liaison(inst);
  const ton = l.statut === "connecte" ? "ok" : l.statut === "incompatible" || l.statut === "introuvable" ? "alerte" : "repos";
  const projet = inst.liaison.panneau?.projetOuvert && inst.liaison.panneau.projet ? inst.liaison.panneau.projet : null;
  const premiere = l.statut === "connecte" ? `Premiere Pro connecté${projet ? ` · ${projet}` : ""}` : `Premiere Pro : ${l.titre.toLowerCase()}`;
  const dossierOk = inst.erreursDossiers.length === 0;
  const tonDossier = !dossierOk ? "alerte" : inst.config.surveillance ? "ok" : "repos";
  const dossier = `${dossierAmical(inst.config.dossierMedias)} · ${!dossierOk ? "introuvable" : inst.config.surveillance ? "surveillé" : "surveillance coupée"}`;
  return (
    <div className="etats">
      <button type="button" className="puce-etat" data-ton={ton} aria-label={`${premiere}. Ouvrir Intégrations`} data-bulle={`${premiere} · ${l.detail}`} onClick={() => aller("integrations")}>
        <span className="puce-point" aria-hidden="true" />
        <Icone nom="picto-montage" taille={15} />
        {!etroit && <span className="puce-texte">Premiere Pro</span>}
      </button>
      <button type="button" className="puce-etat" data-ton={tonDossier} aria-label={`Dossier ${dossier}. Ouvrir Paramètres`} data-bulle={`Dossier ${dossier}`} onClick={() => aller("parametres")}>
        <span className="puce-point" aria-hidden="true" />
        <Icone nom="folder" taille={15} />
        {!etroit && <span className="puce-texte">{dossierAmical(inst.config.dossierMedias)}</span>}
      </button>
    </div>
  );
}

/** Compte : initiale du compte relié, sinon pictogramme ; mène à Paramètres (section Compte). */
function Avatar() {
  const { aller } = useMagasin();
  const compte = useCompte();
  const relie = compte?.relie === true && compte.compte;
  const nom = relie ? (compte!.compte!.nom || compte!.compte!.email) : null;
  const libelle = relie ? `Compte AETHRYON : ${nom}` : "Compte AETHRYON non relié";
  return (
    <button type="button" className={`avatar${relie ? " avatar--relie" : ""}`} aria-label={`${libelle}. Ouvrir Paramètres`} data-bulle={libelle} onClick={() => aller("parametres")}>
      {relie ? <span aria-hidden="true">{nom!.trim().charAt(0).toLocaleUpperCase("fr")}</span> : <Icone nom="user" taille={16} />}
    </button>
  );
}

export function Fenetre({ children }: { children: ReactNode }) {
  const { inst, section, aller, arrivee, recherche, setRecherche, ouvrirApercu, apercu } = useMagasin();
  const maj = useMiseAJour();
  useAvisTransferts();
  useActiviteScan();
  const toast = useToast();
  const compte = useCompte();
  const cloud = cloudOuvert(compte);
  const nuage = envoisActifs(useTransfertsCloud());
  const NAV = navPour(cloud);
  const musique = useSignalMusique();
  // Glisser une carte sur l'entrée « Cloud » de la navigation l'envoie (même mécanique que le dock de Flow).
  useEffect(() => {
    if (!cloud || !socleDisponible()) return;
    return flux.definirZone("cloud", regleCloud(async (ids) => {
      try {
        const l = await api.cloudEnvoyer(ids);
        toast({ etat: "info", titre: `Envoi vers le Cloud : ${pluriel(l.length, "média", "médias")}`, texte: "Préparation, envoi direct, puis vérification par le serveur avant « Sauvegardé ».", action: { libelle: "Voir", faire: () => aller("cloud") } });
        return `${l.length}`;
      } catch (e) {
        toast({ etat: "erreur", titre: "Envoi vers le Cloud impossible", texte: messageErreur(e) });
        throw e;
      }
    }));
  }, [cloud, toast, aller]);
  // Le Cloud disparaît (déconnexion, révocation, rôle) : on quitte sa section.
  useEffect(() => { if (!cloud && section === "cloud") aller("accueil"); }, [cloud, section, aller]);
  // Avis discret : l'annonce est lue 15 s après l'ouverture, puis une fois par jour (rien n'est téléchargé).
  useEffect(() => {
    const t = window.setTimeout(() => void rechercher(true), 15_000);
    const j = window.setInterval(() => void rechercher(true), 24 * 3_600_000);
    return () => { window.clearTimeout(t); window.clearInterval(j); };
  }, []);
  const [etroit, setEtroit] = useState(() => window.innerWidth < 1000);
  const champ = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ y: number; h: number } | null>(null);

  useEffect(() => {
    const r = () => setEtroit(window.innerWidth < 1000);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  // Surbrillance glissante : mesurée sur l'entrée active (aucune pour une section hors navigation, ex. scanner).
  useLayoutEffect(() => {
    const a = nav.current?.querySelector<HTMLElement>(`a[data-section="${section}"]`);
    setInd(a ? { y: a.offsetTop, h: a.offsetHeight } : null);
  }, [section, etroit, NAV.length]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= NAV.length) {
        e.preventDefault();
        aller(NAV[Number(e.key) - 1][0], { clavier: true });
      } else if (e.ctrlKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        champ.current?.focus();
        champ.current?.select();
      } else if (e.key === "Escape" && apercu && !document.querySelector(".voile, .menu--flottant")) {
        ouvrirApercu(null);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [aller, apercu, ouvrirApercu, NAV]);

  if (!inst) return null;
  const enCours = inst.transferts.filter((t) => t.etat === "telechargement" || t.etat === "conversion").length
    + inst.index.medias.filter((m) => m.etat === "en-cours" && !inst.transferts.some((t) => t.fichierAttendu?.toLowerCase() === `${m.nom}.${m.ext}`.toLowerCase())).length;
  const titre = apercu ? "Aperçu" : TITRES[section];

  return (
    <div className={`win${etroit ? " is-narrow" : ""}`}>
      <aside className="side">
        <div className="side-marque" data-tauri-drag-region>
          <span className="marque-barre" data-tauri-drag-region><Chouette taille={30} />{!etroit && <Logotype capitales={11} />}</span>
        </div>
        <nav className="nav nav--anime" ref={nav} aria-label="Sections" data-instant={arrivee === "clavier" ? "" : undefined}>
          {ind != null && <i className="nav-ind" style={{ transform: `translateY(${ind.y}px)`, height: ind.h }} aria-hidden="true" />}
          {NAV.map(([id, ic, libelle], i) => (
            <a
              key={id}
              href={`#${id}`}
              data-section={id}
              data-zone={!socleDisponible() ? undefined : id === "transferts" ? "bibliotheque" : id === "cloud" ? "cloud" : undefined}
              aria-current={id === section && !apercu ? "page" : undefined}
              title={`${libelle} (Ctrl ${i + 1})`}
              onClick={(e) => {
                e.preventDefault();
                aller(id);
              }}
            >
              <Icone nom={ic} taille={18} />
              <span className="lbl">{libelle}</span>
              {id === "transferts" && enCours > 0 && (
                <>
                  <span className="count">{enCours}</span>
                  <span className="badge-dot" />
                </>
              )}
              {id === "cloud" && nuage > 0 && <span className="count" aria-label={pluriel(nuage, "envoi en cours", "envois en cours")}>{nuage}</span>}
              {id === "musique" && musique.imports > 0 && <span className="count" aria-label={pluriel(musique.imports, "import en cours", "imports en cours")}>{musique.imports}</span>}
            </a>
          ))}
        </nav>
        <span className="grow" />
        <Niche etroit={etroit} />
        {maj.phase === "disponible" && maj.recherche && (
          <button type="button" className="side-maj" onClick={() => aller("parametres")} title="Paramètres › Mises à jour" aria-label={`Mise à jour ${maj.recherche.annonce.version} disponible : Paramètres › Mises à jour`}>
            <Icone nom="update" taille={14} /><span>Mise à jour {maj.recherche.annonce.version} disponible</span>
          </button>
        )}
        <div className="side-ver">AETHRYON Desktop {inst.version}</div>
      </aside>
      <div className="colonne">
        <header className="tete" data-tauri-drag-region>
          <div className="fil" data-tauri-drag-region>
            <span data-tauri-drag-region>AETHRYON</span>
            <span className="fil-sep" aria-hidden="true">/</span>
            <b data-tauri-drag-region>{titre}</b>
          </div>
          <label className="tb-search">
            <Icone nom="search" taille={15} />
            <input
              ref={champ}
              id="recherche-globale"
              className="grow"
              type="search"
              value={recherche}
              placeholder={etroit ? "Rechercher" : "Rechercher dans vos médias"}
              aria-label="Rechercher un média dans la bibliothèque"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setRecherche(e.target.value);
                if (section !== "bibliotheque" || apercu) aller("bibliotheque", { clavier: true });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setRecherche("");
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "ArrowDown" || e.key === "Enter") {
                  // Vers les résultats : la première carte de la bibliothèque prend le focus.
                  const c = document.querySelector<HTMLElement>(".bib-grille [data-media][tabindex='0']");
                  if (c) { e.preventDefault(); c.focus(); }
                }
              }}
            />
            <span className="kbd">Ctrl K</span>
          </label>
          <Etats etroit={etroit} />
          <Avatar />
          <BoutonsLegende hauteur={52} />
        </header>
        <main className="sheet">
          <div className="page" key={apercu ? "apercu" : section} data-instant={arrivee === "clavier" ? "" : undefined}>
            <div className="entree-section">{children}</div>
          </div>
          <CoucheDepot />
          {musique.lecteur && <Suspense fallback={null}><MiniLecteur /></Suspense>}
        </main>
      </div>
    </div>
  );
}
