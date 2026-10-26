// Section MUSIQUE (chargée à la demande) : Accueil musical (carte « En écoute » : pochette, barre interactive, commandes,
// visualisation réelle, à suivre ; puis pochettes, albums, artistes, suggestions, playlists, historique), Bibliothèque
// (titres, albums, artistes ; grille ou liste ; tri, recherche, filtres ; Cloud de l'administrateur), Playlists
// (réorganisables par glisser-déposer ou au clavier, synchronisation vers les fichiers possédés) et Importer (lien
// universel, recherche, fiche, import autorisé). Nocturne-2 : les pochettes dominent, l'état lecture/pause se lit
// partout (égaliseur RÉEL, bouton qui change de forme et de nom), le mini-lecteur s'efface devant « En écoute ».
// Règles : chaque action affichée fonctionne (capacites.ts) ; rien n'est simulé ; aucune progression inventée ;
// les catalogues commerciaux ne proposent que « Ouvrir dans … », le lecteur officiel ou l'aperçu étiqueté.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KE, type MouseEvent as ME, type PointerEvent as PE, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import "../styles/musique.css";
import "../styles/musique-nocturne.css";
import { api, messageErreur } from "../lib/api";
import { useMagasin } from "../lib/magasin";
import { cloudOuvert, useCompte } from "../lib/compte";
import { dateCourte, duree, pluriel, quand, quandPhrase, taille as tailleLisible, typo } from "../lib/format";
import { animerMiseEnPage, delaiCascade, mesurer } from "../lib/motion";
import { signalerMusique } from "../lib/musiqueSignal";
import type { ObjetCloud } from "../lib/types";
import { Bouton, BoutonIcone, Icone, Segmente } from "../ui/base";
import { Dialogue, Menu, useToast, type ElementMenu } from "../ui/superpositions";
import { Companion } from "../ui/Companion";
import { musiqueApi } from "./api";
import { corpsPour, detecter, dureeTotale, plan, PLATEFORMES, type Choix, type Plan } from "./capacites";
import * as L from "./lecteur";
import { CLASSES, artistesDe, libelleQualite, nomCodec } from "./qualite";
import { infoCloud, registre, synchroniserMedias, urlPochette } from "./registre";
import { albums as grouperAlbums, artistes as grouperArtistes, filtrer, importsRecents, suggestions, trier, type Album, type Filtres, type Tri } from "./tri";
import type { Fiche, FicheEnregistree, ImportSuivi, Piste, Playlist, VueMusique } from "./types";
import { IconeM, LIBELLE_ETAPE, Pochette } from "./ui";
import * as F from "./file";
import { BarreLecture } from "./BarreLecture";
import { Commandes, Volume } from "./Commandes";
import { Egaliseur } from "./Egaliseur";
import { Visualiseur } from "./Visualiseur";

type Onglet = "accueil" | "bibliotheque" | "playlists" | "importer";
const ref = (id: string) => `loc:${id}`;
const erreurCode = (e: unknown) => (e as { code?: string })?.code ?? "";

/** Message clair pour les refus du relais et de la liaison. */
function erreurMusique(e: unknown): string {
  const c = erreurCode(e);
  if (c === "non_relie") return "Relie AETHRYON Desktop à ton compte (Paramètres › Compte) pour analyser un lien et importer.";
  if (c === "music_closed") return "AETHRYON Music n'est pas encore ouvert sur le serveur : la bibliothèque locale et le lecteur restent disponibles.";
  if (c === "reseau") return "Le site AETHRYON est injoignable : vérifie la connexion à Internet.";
  return messageErreur(e);
}

// ---- Données de la section ------------------------------------------------------------------------------------------

function useDonnees() {
  const { inst } = useMagasin();
  const [vue, setVue] = useState<VueMusique | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const n = useRef(0);
  const charger = useCallback(async () => {
    const k = ++n.current;
    try {
      const v = await musiqueApi.vue();
      if (k !== n.current) return;
      registre.dossierPochettes = v.dossierPochettes;
      registre.pistes = new Map(v.pistes.map((p) => [p.id, p]));
      setVue(v);
      setErreur(null);
    } catch (e) {
      if (k === n.current) setErreur(messageErreur(e));
    }
  }, []);
  // L'index change (nouveau fichier, import terminé) : relecture, groupée.
  const mis = inst?.index.misAJour;
  useEffect(() => { if (inst) synchroniserMedias(inst.index.medias); const t = window.setTimeout(() => void charger(), 150); return () => window.clearTimeout(t); }, [mis, charger]);
  return { vue, setVue, erreur, charger };
}

function useImports(onTermine: (t: ImportSuivi) => void) {
  const [liste, setListe] = useState<ImportSuivi[]>([]);
  const fin = useRef(onTermine);
  fin.current = onTermine;
  useEffect(() => {
    let vivant = true;
    musiqueApi.imports().then((l) => { if (vivant) setListe(l); }).catch(() => {});
    const u = listen<ImportSuivi>("musique-import", (e) => {
      const t = e.payload;
      setListe((l) => { const i = l.findIndex((x) => x.id === t.id); const n = i < 0 ? [...l, t] : l.map((x, j) => (j === i ? t : x)); return n.slice(-40); });
      if (["termine", "echec", "annule"].includes(t.etape)) fin.current(t);
    });
    return () => { vivant = false; void u.then((f) => f()); };
  }, []);
  const actifs = liste.filter((t) => !["termine", "echec", "annule"].includes(t.etape)).length;
  useEffect(() => { signalerMusique({ imports: actifs }); }, [actifs]);
  return liste;
}

// ---- Éléments communs -----------------------------------------------------------------------------------------------

function EtatPastille({ etat, libelle }: { etat: string; libelle: string }) {
  return <span className="mu-etat" data-etat={etat}><i aria-hidden="true" />{libelle}</span>;
}

function Section({ titre, action, children }: { titre: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mu-section" aria-label={titre}>
      <div className="mu-section-tete"><h2 className="mu-h2">{titre}</h2>{action}</div>
      {children}
    </section>
  );
}

/** Couverture d'une collection (playlist) : jusqu'à quatre pochettes RÉELLES distinctes en 2 × 2, sinon la première,
 *  sinon un monogramme ; jamais une image inventée. */
function Mosaique({ pochettes, titre, taille, className }: { pochettes: (string | null)[]; titre: string; taille?: number; className?: string }) {
  const v = [...new Set(pochettes.filter((x): x is string => !!x))].slice(0, 4);
  if (v.length < 4) return <Pochette url={v[0] ?? null} titre={titre} taille={taille} className={className} />;
  return (
    <span className={`mu-poch mu-mosaique${className ? " " + className : ""}`} style={taille ? { width: taille, height: taille } : undefined}>
      {v.map((u) => <img key={u} src={u} alt="" loading="lazy" decoding="async" draggable={false} />)}
    </span>
  );
}

const pochettesDe = (ids: string[]) => ids.map((id) => urlPochette(registre.pistes.get(id)?.pochette));

/** Tuile d'un morceau, d'un album, d'un artiste (rond) ou d'une playlist (mosaïque) : la pochette domine, se soulève
 *  au survol ; le bouton rond lit (ou met en pause ce qui joue) ; double-clic = lecture. L'élément en cours porte
 *  l'égaliseur réel et garde son bouton visible. */
function Tuile({ titre, sous, pochette, mosaique, onLire, onOuvrir, onMenu, i = 0, actif, lecture, rond }: {
  titre: string; sous: string; pochette: string | null; mosaique?: (string | null)[]; onLire: () => void; onOuvrir?: () => void;
  onMenu?: (e: ME<HTMLElement>, clavier?: boolean) => void; i?: number; actif?: boolean; lecture?: boolean; rond?: boolean;
}) {
  const joue = !!actif && !!lecture;
  return (
    <div className="mu-tuile entree-carte" style={{ animationDelay: `${delaiCascade(i)}ms` }} data-actif={actif ? "" : undefined} data-lecture={joue ? "" : undefined} data-rond={rond ? "" : undefined}
      onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e); } : undefined}>
      <div className="mu-tuile-cadre">
        <button type="button" className="mu-tuile-poch" onClick={onOuvrir ?? onLire} onDoubleClick={onLire} aria-label={typo(`${titre}, ${sous}${actif ? joue ? ", en lecture" : ", en pause" : ""}`)}
          onKeyDown={(e) => { if (onMenu && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); onMenu(e as unknown as ME<HTMLElement>, true); } }}>
          {mosaique ? <Mosaique pochettes={mosaique} titre={titre} /> : <Pochette url={pochette} titre={titre} rond={rond} />}
        </button>
        {actif && <span className="mu-tuile-ecoute" aria-hidden="true"><Egaliseur actif={joue} /></span>}
        <button type="button" className="mu-tuile-lire" aria-label={typo(joue ? `Mettre « ${titre} » en pause` : actif ? `Reprendre « ${titre} »` : `Lire « ${titre} »`)}
          onClick={actif ? () => L.basculer() : onLire} tabIndex={-1}><IconeM nom={joue ? "pause" : "play"} taille={18} /></button>
      </div>
      <div className="mu-tuile-titre ellipsis" title={titre}>{titre}</div>
      <div className="mu-tuile-sous ellipsis">{sous}</div>
    </div>
  );
}

/** « En écoute » : la grande carte du lecteur — pochette, titre, barre de lecture interactive, commandes, volume,
 *  visualisation RÉELLE, à suivre. Sans lecture : « Reprendre la lecture » (file enregistrée), sinon le dernier album
 *  ajouté. Tant qu'elle est à l'écran, le mini-lecteur s'efface (les mêmes commandes une seule fois). */
function Ecoute({ vue, albums, onLirePistes, onOuvrirAlbum }: { vue: VueMusique; albums: Album[]; onLirePistes: (ids: string[], depart?: number) => void; onOuvrirAlbum: (a: Album) => void }) {
  const l = L.useLecteur();
  const boite = useRef<HTMLElement>(null);
  const i = l.info;
  const reprise = !i && !l.file.ordre.length && vue.lecture.file.length > 0 ? vue.lecture : null;
  const premier = reprise ? registre.pistes.get(reprise.file[reprise.index]?.slice(4) ?? "") ?? null : null;
  const album = !i && !premier ? albums[0] ?? null : null;
  const mode: "lecture" | "reprise" | "album" | null = i ? "lecture" : premier ? "reprise" : album ? "album" : null;
  useEffect(() => {
    const el = boite.current;
    if (!el || mode !== "lecture" || typeof IntersectionObserver === "undefined") { signalerMusique({ ecoute: false }); return; }
    const io = new IntersectionObserver(([e]) => signalerMusique({ ecoute: e.isIntersecting && e.intersectionRatio >= 0.35 }), { threshold: [0, 0.35, 0.7] });
    io.observe(el);
    return () => { io.disconnect(); signalerMusique({ ecoute: false }); };
  }, [mode]);
  if (!mode) return null;
  const pochette = i ? i.pochette : premier ? urlPochette(premier.pochette) : urlPochette(album!.pochette);
  const titre = i ? i.titre : premier ? premier.titre : album!.titre;
  const artistes = i ? i.artistes : premier ? artistesDe(premier) : album!.artiste;
  const meta = i ? [i.album, i.qualite, i.source === "cloud" ? "Écoute depuis le Cloud" : null].filter(Boolean).join(" · ")
    : premier ? [premier.album, libelleQualite(premier.qualite)].filter(Boolean).join(" · ")
    : [album!.annee, pluriel(album!.pistes.length, "titre", "titres"), album!.dureeS ? duree(album!.dureeS) : null].filter(Boolean).join(" · ");
  const venir = mode === "lecture" ? F.aVenir(l.file).slice(0, 4) : [];
  const infoRef = (r: string) => {
    const p = r.startsWith("loc:") ? registre.pistes.get(r.slice(4)) : null;
    if (p) return { titre: p.titre, artistes: artistesDe(p), pochette: urlPochette(p.pochette), dureeS: p.dureeS };
    const o = r.startsWith("cloud:") ? registre.cloud.get(r.slice(6)) : null;
    if (o) { const x = infoCloud(o); return { titre: x.titre, artistes: x.artistes, pochette: x.pochette, dureeS: x.dureeS }; }
    return { titre: "Morceau indisponible", artistes: "", pochette: null, dureeS: null };
  };
  return (
    <section ref={boite} className="mu-ecoute" data-mode={mode} data-lecture={mode === "lecture" && l.enLecture ? "" : undefined} aria-label="En écoute">
      {pochette && <span className="mu-ecoute-fond" style={{ backgroundImage: `url("${pochette}")` }} aria-hidden="true" />}
      <div className="mu-ecoute-poch"><Pochette url={pochette} titre={titre} /></div>
      <div className="mu-ecoute-infos">
        <span className="mu-sur mu-ecoute-sur" aria-live="polite">
          {mode === "lecture" ? <><Egaliseur actif={l.enLecture} />{l.chargement ? "Chargement" : l.enLecture ? "En lecture" : "En pause"}</> : mode === "reprise" ? "Reprendre la lecture" : "Dernier album ajouté"}
        </span>
        <h2 className={`mu-ecoute-titre${mode === "reprise" ? " mu-reprise-titre" : ""}`}>{titre}</h2>
        <p className="mu-ecoute-artiste ellipsis">{artistes}</p>
        {meta && <p className="mu-ecoute-meta ellipsis">{typo(meta)}</p>}
        {mode === "lecture" && (
          <>
            <BarreLecture l={l} className="mu-ecoute-barre" />
            <div className="mu-ecoute-cmd"><Commandes l={l} grand /><Volume l={l} /></div>
            {l.erreur && <p className="mu-erreur" role="alert">{typo(l.erreur)}</p>}
          </>
        )}
        {mode === "reprise" && (
          <div className="mu-ecoute-actions">
            <Bouton variante="primary" taille="lg" icone="play" className="mu-reprise" onClick={() => { signalerMusique({ lecteur: true }); L.reprendre(reprise!); }}>Reprendre</Bouton>
            <span className="mu-ecoute-note">{typo(`arrêté à ${duree(reprise!.positionS)}${reprise!.file.length > 1 ? ` · ${pluriel(reprise!.file.length, "morceau", "morceaux")} dans la file` : ""}`)}</span>
          </div>
        )}
        {mode === "album" && (
          <div className="mu-ecoute-actions">
            <Bouton variante="primary" taille="lg" icone="play" onClick={() => onLirePistes(album!.pistes.map((p) => p.id))}>{"Lire l'album"}</Bouton>
            <Bouton onClick={() => { if (!L.lireEtat().file.aleatoire) L.aleatoire(); onLirePistes(album!.pistes.map((p) => p.id), Math.floor(Math.random() * album!.pistes.length)); }}><IconeM nom="aleatoire" taille={16} />Aléatoire</Bouton>
            <Bouton variante="ghost" onClick={() => onOuvrirAlbum(album!)}>{"Voir l'album"}</Bouton>
          </div>
        )}
      </div>
      {mode === "lecture" && (
        <div className="mu-ecoute-cote">
          <Visualiseur hauteur={56} barres={40} className="mu-ecoute-visu" />
          {!l.visualisable && <p className="mu-visu-note">{typo(i?.source === "cloud" ? "Visualisation coupée pour l'écoute Cloud." : "Visualisation indisponible pour ce fichier.")}</p>}
          <div className="mu-ecoute-avenir">
          <h3 className="sec-label">À suivre</h3>
          {venir.length ? (
            <ol className="mu-ecoute-suite">
              {venir.map((r, k) => { const x = infoRef(r); return (
                <li key={`${r}#${k}`}><button type="button" className="mu-ecoute-suivant" onClick={() => L.allerA(k)} aria-label={typo(`Lire maintenant « ${x.titre} »`)}>
                  <Pochette url={x.pochette} titre={x.titre} taille={36} />
                  <span className="mu-piste-texte"><span className="ellipsis">{x.titre}</span><span className="c3 ellipsis">{x.artistes}</span></span>
                  <span className="mu-chiffre c3">{duree(x.dureeS)}</span>
                </button></li>
              ); })}
            </ol>
          ) : <p className="mu-note">{typo(l.file.repetition === "tout" ? "La file recommencera au début." : "Rien ensuite : la lecture s'arrêtera après ce morceau.")}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Accueil musical ------------------------------------------------------------------------------------------------

function AccueilMusical({ vue, ordreAjout, onAller, onLirePistes, onMenuPiste, onOuvrirAlbum, onOuvrirArtiste, onOuvrirPlaylist, imports }: {
  vue: VueMusique; ordreAjout: Map<string, number>; onAller: (o: Onglet) => void; onLirePistes: (ids: string[], depart?: number) => void;
  onMenuPiste: (p: Piste, e: ME<HTMLElement>, clavier?: boolean) => void; onOuvrirAlbum: (a: Album) => void; onOuvrirArtiste: (nom: string) => void;
  onOuvrirPlaylist: (id: string) => void; imports: ImportSuivi[];
}) {
  const l = L.useLecteur();
  const recents = useMemo(() => trier(vue.pistes, "ajout", ordreAjout).slice(0, 12), [vue.pistes, ordreAjout]);
  const tous = useMemo(() => grouperAlbums(vue.pistes, ordreAjout), [vue.pistes, ordreAjout]);
  const albums = tous.slice(0, 10);
  const arts = useMemo(() => grouperArtistes(vue.pistes).slice(0, 12), [vue.pistes]);
  const sugg = useMemo(() => suggestions(vue.pistes, l.ecoutes, ordreAjout), [vue.pistes, l.ecoutes, ordreAjout]);
  const hist = importsRecents(vue.historique);
  const enCours = imports.filter((t) => !["termine", "echec", "annule"].includes(t.etape));
  const courant = l.info?.ref ?? null;
  const albumCourant = courant?.startsWith("loc:") ? registre.pistes.get(courant.slice(4)) : null;
  if (!vue.pistes.length && !vue.historique.length) {
    return (
      <div className="vide mu-vide">
        <Companion lieu="vide" taille={120} />
        <h2 className="t-display-m">Ta musique t'attend</h2>
        <p>{typo("Les fichiers audio de tes dossiers surveillés apparaissent ici, avec leurs pochettes et leur qualité réelle. Tu peux aussi coller un lien : AETHRYON dit clairement ce qui est permis.")}</p>
        <div className="vide-actions"><Bouton variante="primary" icone="link" onClick={() => onAller("importer")}>Coller un lien</Bouton></div>
      </div>
    );
  }
  return (
    <div className="mu-accueil">
      <Ecoute vue={vue} albums={tous} onLirePistes={onLirePistes} onOuvrirAlbum={onOuvrirAlbum} />
      {enCours.length > 0 && (
        <Section titre="Imports en cours" action={<Bouton variante="ghost" taille="sm" onClick={() => onAller("importer")}>Voir</Bouton>}>
          <ListeImports liste={enCours} />
        </Section>
      )}
      {recents.length > 0 && (
        <Section titre="Ajoutés récemment" action={<Bouton variante="ghost" taille="sm" onClick={() => onAller("bibliotheque")}>Tout voir</Bouton>}>
          <div className="mu-rangee">
            {recents.map((p, i) => <Tuile key={p.id} i={i} titre={p.titre} sous={artistesDe(p)} pochette={urlPochette(p.pochette)} actif={courant === ref(p.id)} lecture={l.enLecture}
              onLire={() => onLirePistes(recents.map((x) => x.id), i)} onMenu={(e, c) => onMenuPiste(p, e, c)} />)}
          </div>
        </Section>
      )}
      {albums.length > 0 && (
        <Section titre="Albums récents">
          <div className="mu-rangee mu-rangee--grande">
            {albums.map((a, i) => <Tuile key={a.cle} i={i} titre={a.titre} sous={`${a.artiste}${a.annee ? ` · ${a.annee}` : ""}`} pochette={urlPochette(a.pochette)}
              actif={!!albumCourant && a.pistes.some((p) => p.id === albumCourant.id)} lecture={l.enLecture}
              onOuvrir={() => onOuvrirAlbum(a)} onLire={() => onLirePistes(a.pistes.map((p) => p.id))} />)}
          </div>
        </Section>
      )}
      {arts.length > 1 && (
        <Section titre="Artistes">
          <div className="mu-rangee mu-rangee--artistes">
            {arts.map((a, i) => <Tuile key={a.nom} i={i} rond titre={a.nom} sous={pluriel(a.n, "titre", "titres")} pochette={urlPochette(a.pochette)}
              onOuvrir={() => onOuvrirArtiste(a.nom)} onLire={() => onLirePistes(vue.pistes.filter((p) => p.artistes.includes(a.nom)).map((p) => p.id))} />)}
          </div>
        </Section>
      )}
      {sugg.pistes.length > 0 && (
        <Section titre="Suggestions de ta bibliothèque">
          <p className="mu-note">{typo(`${sugg.raison}. Calculées sur cet ordinateur, à partir de tes seuls fichiers.`)}</p>
          <div className="mu-rangee">
            {sugg.pistes.map((p, i) => <Tuile key={p.id} i={i} titre={p.titre} sous={artistesDe(p)} pochette={urlPochette(p.pochette)} actif={courant === ref(p.id)} lecture={l.enLecture}
              onLire={() => onLirePistes(sugg.pistes.map((x) => x.id), i)} onMenu={(e, c) => onMenuPiste(p, e, c)} />)}
          </div>
        </Section>
      )}
      <div className="mu-deux">
        <Section titre="Playlists" action={<Bouton variante="ghost" taille="sm" onClick={() => onAller("playlists")}>{vue.playlists.length ? "Gérer" : "Créer"}</Bouton>}>
          {vue.playlists.length ? (
            <div className="mu-pl-cartes">
              {vue.playlists.slice(0, 6).map((p, i) => <Tuile key={p.id} i={i} titre={p.nom} sous={pluriel(p.pistes.length, "morceau", "morceaux")} pochette={null} mosaique={pochettesDe(p.pistes)}
                onOuvrir={() => onOuvrirPlaylist(p.id)} onLire={() => onLirePistes(p.pistes)} />)}
            </div>
          ) : <p className="mu-note">Aucune playlist pour l'instant.</p>}
        </Section>
        <Section titre="Historique des imports" action={hist.length ? <Bouton variante="ghost" taille="sm" onClick={() => onAller("importer")}>Importer</Bouton> : undefined}>
          {hist.length ? (
            <ul className="mu-hist">
              {hist.map((h) => (
                <li key={h.id}>
                  <Pochette url={h.pochette} titre={h.titre ?? h.url} taille={40} />
                  <div className="mu-hist-texte"><span className="ellipsis">{h.titre ?? h.url}</span><span className="c3">{typo(`${LIBELLE_ETAPE[h.etat] ?? h.etat} · ${quand(h.quand)}`)}</span></div>
                </li>
              ))}
            </ul>
          ) : <p className="mu-note">Aucun import pour l'instant.</p>}
        </Section>
      </div>
    </div>
  );
}

// ---- Imports ----------------------------------------------------------------------------------------------------

function ListeImports({ liste }: { liste: ImportSuivi[] }) {
  return (
    <ul className="mu-imports">
      {liste.slice().reverse().map((t) => {
        const actif = !["termine", "echec", "annule"].includes(t.etape);
        const av = t.etape === "rapatriement" ? t.local : t.serveur;
        const frac = av && av.total ? Math.min(1, av.octets / av.total) : null;
        const attente = actif && frac == null;
        return (
          <li key={t.id} className="mu-import" data-etape={t.etape}>
            <Pochette url={t.pochette} titre={t.titre ?? t.url} taille={40} />
            <div className="mu-import-corps">
              <div className="mu-import-ligne"><span className="ellipsis">{t.titre ?? t.url}</span><span className="mu-import-etat" aria-live="polite">{LIBELLE_ETAPE[t.etape] ?? t.etape}{frac != null && actif ? ` · ${Math.floor(frac * 100)} %` : ""}</span></div>
              {actif && (
                <div className={`mu-barre${attente ? " mu-barre--attente" : ""}`} role="progressbar" aria-label={typo(`${t.titre ?? "Import"} : ${LIBELLE_ETAPE[t.etape]}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={frac != null ? Math.floor(frac * 100) : undefined}>
                  <i style={frac != null ? { transform: `scaleX(${frac})` } : undefined} />
                </div>
              )}
              {av && actif && av.total == null && av.octets > 0 && <div className="c3 mu-petit">{typo(`${tailleLisible(av.octets)} reçus · taille totale non annoncée par la source`)}</div>}
              {t.etape === "termine" && <div className="c3 mu-petit">{typo([t.licence?.nom, t.cloud ? `Cloud : ${t.cloud.libelle}` : null].filter(Boolean).join(" · ") || "Enregistré dans Musique")}</div>}
              {t.etape === "echec" && <div className="mu-petit bad">{typo(t.message ?? "Import non effectué.")}</div>}
            </div>
            {actif && <Bouton taille="sm" variante="ghost" onClick={() => void musiqueApi.annulerImport(t.id)}>Annuler</Bouton>}
          </li>
        );
      })}
    </ul>
  );
}

function FicheMusicale({ fiche, onImporter, onEnregistrer, enregistree, correspondance }: {
  fiche: Fiche; onImporter: (p: Plan, choix: Choix[], attestation: boolean) => Promise<boolean>; onEnregistrer: () => void; enregistree: boolean; correspondance: Piste | null;
}) {
  const p = useMemo(() => plan(fiche), [fiche]);
  const [choix, setChoix] = useState<Set<string>>(() => new Set(p.importer?.choix.slice(0, 1).map((c) => c.cle) ?? []));
  const [attest, setAttest] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [lance, setLance] = useState(false);
  const [lecteurOfficiel, setLecteurOfficiel] = useState(false);
  const pistes = fiche.pistes ?? [];
  const total = dureeTotale(pistes);
  const tout = p.importer?.choix ?? [];
  const selection = tout.filter((c) => choix.has(c.cle));
  const peut = !!p.importer && (!tout.length || selection.length > 0) && (!p.importer.attestationRequise || attest) && !envoi && !lance;
  const basculer = (cle: string) => { setLance(false); setChoix((s) => { const n = new Set(s); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; }); };
  return (
    <article className="mu-fiche" aria-label={typo(`Fiche : ${fiche.titre ?? fiche.url}`)}>
      <div className="mu-fiche-tete">
        <div className="mu-fiche-poch"><Pochette url={fiche.pochette ?? null} titre={fiche.titre ?? p.plateforme} taille={176} /></div>
        <div className="mu-fiche-infos">
          <div className="mu-fiche-source"><span>{p.plateforme}</span><EtatPastille etat={correspondance ? "correspondance" : fiche.etat} libelle={correspondance ? "Déjà dans ta bibliothèque" : p.etat.libelle} /></div>
          <h2 className="mu-fiche-titre">{fiche.titre ?? "Titre non communiqué"}</h2>
          <p className="mu-fiche-artiste">{fiche.artistes.length ? fiche.artistes.join(", ") : typo(p.catalogue ? "Artiste non communiqué par le service" : "Auteur non communiqué")}</p>
          <p className="mu-fiche-meta">{[fiche.album, fiche.dureeS ? duree(fiche.dureeS) : total ? duree(total) : null, pistes.length ? pluriel(fiche.pistesTotal ?? pistes.length, "titre", "titres") : null, fiche.date?.slice(0, 4)].filter(Boolean).join(" · ") || " "}</p>
          <p className="mu-fiche-expl">{typo(correspondance ? `Correspond à « ${correspondance.titre} » dans ta bibliothèque.` : p.etat.explication)}</p>
          <div className="mu-fiche-actions">
            {correspondance && <Bouton variante="primary" icone="play" onClick={() => L.lire([ref(correspondance.id)])}>Lire mon fichier</Bouton>}
            {p.importer && !correspondance && (
              <Bouton variante="primary" icone="download" disabled={!peut} onClick={async () => { setEnvoi(true); try { if (await onImporter(p, selection, attest)) setLance(true); } finally { setEnvoi(false); } }}>
                {lance ? "Import lancé" : selection.length > 1 ? `Importer ${selection.length} fichiers` : "Importer"}
              </Bouton>
            )}
            {p.lecteurOfficiel && <Bouton icone="play" aria-expanded={lecteurOfficiel} onClick={() => setLecteurOfficiel((v) => !v)}>{lecteurOfficiel ? "Masquer le lecteur officiel" : "Lecteur officiel"}</Bouton>}
            {p.ouvrir && <Bouton icone="external" onClick={() => void musiqueApi.ouvrirLien(p.ouvrir!.url)}>{p.ouvrir.libelle}</Bouton>}
            {p.enregistrer && <Bouton variante="ghost" icone={enregistree ? "check" : "plus"} disabled={enregistree} onClick={onEnregistrer}>{enregistree ? "Fiche enregistrée" : "Enregistrer la fiche"}</Bouton>}
          </div>
          {p.importer?.attestationRequise && (
            <label className="mu-attest">
              <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
              <span>{typo(p.importer.attestation ?? "Je déclare avoir le droit de télécharger ce fichier.")}</span>
            </label>
          )}
        </div>
      </div>
      {p.apercu && (
        <div className="mu-apercu">
          <span className="mu-sur">{p.apercu.libelle}</span>
          <audio controls preload="none" src={p.apercu.url} aria-label={typo(`${p.apercu.libelle} de « ${fiche.titre ?? ""} »`)} />
          <Bouton taille="sm" icone="external" onClick={() => void musiqueApi.ouvrirLien(p.apercu!.lien.url)}>{p.apercu.lien.libelle}</Bouton>
          {p.apercu.mention && <p className="mu-note">{typo(p.apercu.mention)}</p>}
        </div>
      )}
      {p.ecouter && (
        <div className="mu-apercu"><span className="mu-sur">Écouter depuis la source</span><audio controls preload="none" src={p.ecouter.url} aria-label={typo(`Écouter « ${fiche.titre ?? ""} »`)} /></div>
      )}
      {lecteurOfficiel && p.lecteurOfficiel && (
        <div className="mu-officiel">
          <iframe title={p.lecteurOfficiel.libelle} src={p.lecteurOfficiel.url} height={p.lecteurOfficiel.hauteur} loading="lazy" allow="encrypted-media; clipboard-write" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
          {p.lecteurOfficiel.note && <p className="mu-note">{typo(p.lecteurOfficiel.note)}</p>}
        </div>
      )}
      {(p.restrictions.length > 0 || p.manque.length > 0 || p.avertissements.length > 0 || fiche.licence || fiche.attribution) && (
        <div className="mu-restrictions" role="note">
          {fiche.licence && <p><b>Licence{"\u00a0"}:</b> {fiche.licence.nom}{fiche.licence.url ? <> — <button type="button" className="mu-lien" onClick={() => void musiqueApi.ouvrirLien(fiche.licence!.url!)}>texte de la licence</button></> : null}</p>}
          {fiche.attribution && <p><b>Attribution{"\u00a0"}:</b> {typo(fiche.attribution)}</p>}
          {p.restrictions.map((r, i) => <p key={`r${i}`}><Icone nom="info" taille={14} /><span>{typo(r)}</span></p>)}
          {p.manque.map((r, i) => <p key={`m${i}`} className="c3"><Icone nom="alert" taille={14} /><span>{typo(r)}</span></p>)}
          {p.avertissements.map((r, i) => <p key={`a${i}`} className="c3"><Icone nom="alert" taille={14} /><span>{typo(r)}</span></p>)}
        </div>
      )}
      {pistes.length > 0 && (
        <div className="mu-fiche-pistes">
          <div className="mu-section-tete">
            <h3 className="sec-label">{tout.length ? "Choisis les fichiers à importer" : "Titres"}</h3>
            {tout.length > 1 && <Bouton variante="ghost" taille="sm" onClick={() => setChoix(selection.length === tout.length ? new Set() : new Set(tout.map((c) => c.cle)))}>{selection.length === tout.length ? "Tout désélectionner" : "Tout sélectionner"}</Bouton>}
          </div>
          <ol className="mu-pistes">
            {pistes.map((x, i) => {
              const c = tout.find((y) => y.libelle === (x.titre || y.libelle) && (tout.indexOf(y) === i || tout.length === pistes.length)) ?? tout[i];
              return (
                <li key={i} className="mu-piste-fiche entree-carte" style={{ animationDelay: `${delaiCascade(i)}ms` }}>
                  {c ? <input type="checkbox" checked={choix.has(c.cle)} onChange={() => basculer(c.cle)} aria-label={typo(`Importer « ${x.titre} »`)} /> : <span className="mu-num">{x.numero ?? i + 1}</span>}
                  <div className="mu-piste-texte"><span className="ellipsis">{x.titre}</span><span className="c3 ellipsis">{[x.artistes.join(", "), c?.detail].filter(Boolean).join(" · ")}</span></div>
                  <span className="mu-chiffre c3">{duree(x.dureeS ?? null)}</span>
                </li>
              );
            })}
          </ol>
          {fiche.pistesTotal && fiche.pistesTotal > pistes.length && <p className="mu-note">{typo(`${pistes.length} titres affichés sur ${fiche.pistesTotal}.`)}</p>}
        </div>
      )}
    </article>
  );
}

function Importer({ vue, setVue, imports, initial, onInitialLu }: { vue: VueMusique; setVue: (f: (v: VueMusique | null) => VueMusique | null) => void; imports: ImportSuivi[]; initial: string | null; onInitialLu: () => void }) {
  const toast = useToast();
  const compte = useCompte();
  const [mode, setMode] = useState<"lien" | "recherche">("lien");
  const [url, setUrl] = useState("");
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [etat, setEtat] = useState<"repos" | "analyse" | "erreur">("repos");
  const [erreur, setErreur] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("archive");
  const [resultats, setResultats] = useState<Fiche[] | null>(null);
  const [cherche, setCherche] = useState(false);
  const [typeLien, setTypeLien] = useState<"" | "podcast" | "fichier">("");
  const det = detecter(url);
  const champ = useRef<HTMLInputElement>(null);
  const n = useRef(0);

  const analyser = useCallback(async (lien: string, t?: "podcast" | "fichier") => {
    const d = detecter(lien);
    if (d?.refuse) { setErreur(d.refuse); setEtat("erreur"); setFiche(null); return; }
    const k = ++n.current;
    setEtat("analyse"); setErreur(null);
    try {
      const r = await musiqueApi.analyser(lien.trim(), t);
      if (k !== n.current) return;
      setFiche(r.fiche);
      setEtat("repos");
      const h = await musiqueApi.noter({ action: "analyse", url: r.fiche.url, connecteur: r.fiche.connecteur, titre: r.fiche.titre, artistes: r.fiche.artistes, pochette: r.fiche.pochette ?? null, etat: r.fiche.etat }).catch(() => null);
      if (h) setVue((v) => (v ? { ...v, historique: h } : v));
    } catch (e) {
      if (k !== n.current) return;
      setFiche(null); setEtat("erreur"); setErreur(erreurMusique(e));
    }
  }, [setVue]);

  useEffect(() => { if (initial) { setUrl(initial); setMode("lien"); void analyser(initial); onInitialLu(); } }, [initial]);

  // Correspondance locale (sans réseau) : même ISRC, ou même titre et même artiste dans la bibliothèque.
  const correspondance = useMemo(() => {
    if (!fiche || fiche.type !== "titre") return null;
    const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\..*$/g, "").trim();
    return vue.pistes.find((p) => (fiche.isrc && p.isrc === fiche.isrc) || (fiche.titre && norm(p.titre) === norm(fiche.titre) && fiche.artistes.some((a) => p.artistes.some((b) => norm(a) === norm(b))))) ?? null;
  }, [fiche, vue.pistes]);

  const importer = async (p: Plan, choix: Choix[], attestation: boolean) => {
    if (!fiche) return false;
    const lots = choix.length ? choix : [null];
    let ok = 0;
    for (const c of lots) {
      const corps = corpsPour(p, c, attestation);
      if (!corps) continue;
      try {
        await musiqueApi.importer(corps, { url: fiche.url, connecteur: fiche.connecteur, titre: c?.libelle ?? fiche.titre, artistes: fiche.artistes, pochette: fiche.pochette ?? null });
        ok++;
      } catch (e) {
        toast({ etat: "erreur", titre: "Import non lancé", texte: erreurMusique(e) });
        break;
      }
    }
    if (ok) toast({ etat: "info", titre: ok > 1 ? `${ok} imports lancés` : "Import lancé", texte: "Le serveur relit la source et vérifie le fichier, puis il arrive dans ta musique." });
    return ok > 0;
  };

  const enregistrer = async () => {
    if (!fiche) return;
    try {
      const l = await musiqueApi.enregistrerFiche({ url: fiche.url, connecteur: fiche.connecteur, type: fiche.type, titre: fiche.titre, artistes: fiche.artistes, album: fiche.album ?? null, pochette: fiche.pochette ?? null, dureeS: fiche.dureeS ?? null, etat: fiche.etat });
      setVue((v) => (v ? { ...v, fiches: l } : v));
      toast({ etat: "ok", titre: "Fiche enregistrée", texte: "Le lien et ses informations restent sur cet ordinateur, sans aucun fichier." });
    } catch (e) { toast({ etat: "erreur", titre: "Fiche non enregistrée", texte: messageErreur(e) }); }
  };

  const rechercher = async () => {
    if (!q.trim()) return;
    setCherche(true); setErreur(null);
    try { setResultats((await musiqueApi.rechercher(q, source)).resultats); }
    catch (e) { setResultats(null); setErreur(erreurMusique(e)); }
    finally { setCherche(false); }
  };

  const relie = !!compte?.relie;
  return (
    <div className="mu-import-vue">
      {!relie && (
        <div className="mu-liaison" role="note">
          <Icone nom="link" taille={18} />
          <div className="grow"><b>Relie AETHRYON Desktop à ton compte</b><p className="c3">{typo("L'analyse des liens et les imports passent par ton compte AETHRYON. La bibliothèque locale et le lecteur fonctionnent sans.")}</p></div>
        </div>
      )}
      <div className="mu-import-mode"><Segmente libelle="Mode" valeur={mode} onChange={setMode} options={[{ id: "lien", libelle: "Coller un lien" }, { id: "recherche", libelle: "Rechercher" }]} /></div>
      {mode === "lien" ? (
        <form className="mu-lien-champ" data-etat={etat} onSubmit={(e) => { e.preventDefault(); if (url.trim()) void analyser(url, typeLien || undefined); }}>
          <label className="mu-universel">
            <IconeM nom="lien" taille={18} />
            <input ref={champ} type="url" inputMode="url" spellCheck={false} autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="Colle le lien d'un morceau, d'un album, d'une playlist ou d'un fichier audio" aria-label="Lien d'un morceau, d'un album, d'une playlist ou d'un fichier audio" disabled={!relie} />
            {det && <span className="mu-detecte" data-refuse={det.refuse ? "" : undefined}>{det.nom}</span>}
          </label>
          <label className="select select--etiquette mu-type">
            <span className="lbl">Type</span>
            <select className="select--natif" value={typeLien} onChange={(e) => setTypeLien(e.target.value as typeof typeLien)} aria-label="Type de lien" disabled={!relie}>
              <option value="">Détecter</option><option value="podcast">Flux de podcast</option><option value="fichier">Fichier audio</option>
            </select>
          </label>
          <Bouton variante="primary" type="submit" disabled={!relie || !url.trim() || etat === "analyse"}>{etat === "analyse" ? "Analyse…" : "Analyser"}</Bouton>
          {etat === "analyse" && <div className="mu-comete" role="progressbar" aria-label="Analyse du lien en cours" />}
        </form>
      ) : (
        <form className="mu-lien-champ" onSubmit={(e) => { e.preventDefault(); void rechercher(); }}>
          <label className="mu-universel">
            <Icone nom="search" taille={18} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, artiste ou album" aria-label="Rechercher un titre" disabled={!relie} />
          </label>
          <label className="select select--etiquette">
            <span className="lbl">Dans</span>
            <select className="select--natif" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source de la recherche" disabled={!relie}>
              <option value="archive">Internet Archive (libre)</option><option value="commons">Wikimedia Commons (libre)</option><option value="apple">Apple Music (fiches)</option><option value="spotify">Spotify (fiches)</option>
            </select>
          </label>
          <Bouton variante="primary" type="submit" disabled={!relie || !q.trim() || cherche}>{cherche ? "Recherche…" : "Rechercher"}</Bouton>
          {cherche && <div className="mu-comete" role="progressbar" aria-label="Recherche en cours" />}
        </form>
      )}
      {erreur && <div className="bandeau bandeau--erreur" role="alert"><Icone nom="alert" taille={16} /><span className="grow">{typo(erreur)}</span></div>}
      {mode === "lien" && !fiche && (
        <div className="mu-sources" aria-label="Sources prises en charge">
          <div className="mu-sources-groupe"><span className="mu-sur">Import autorisé</span>
            <span className="mu-puces">{["archive", "commons", "podcast", "fichier"].map((id) => <span key={id} className="mu-puce mu-puce--or">{PLATEFORMES[id]}</span>)}</span></div>
          <div className="mu-sources-groupe"><span className="mu-sur mu-sur--neutre">Fiche et écoute officielle</span>
            <span className="mu-puces">{["spotify", "apple", "soundcloud", "deezer"].map((id) => <span key={id} className="mu-puce">{PLATEFORMES[id]}</span>)}</span></div>
        </div>
      )}
      {mode === "recherche" && resultats && (
        resultats.length ? (
          <ul className="mu-resultats">
            {resultats.map((r, i) => (
              <li key={`${r.url}${i}`} className="entree-carte" style={{ animationDelay: `${delaiCascade(i)}ms` }}>
                <button type="button" className="mu-resultat" onClick={() => { setMode("lien"); setUrl(r.url); setFiche(r); setEtat("repos"); }}>
                  <Pochette url={r.pochette ?? null} titre={r.titre ?? r.url} taille={44} />
                  <div className="mu-piste-texte"><span className="ellipsis">{r.titre ?? r.url}</span><span className="c3 ellipsis">{[r.artistes.join(", "), r.album].filter(Boolean).join(" · ")}</span></div>
                  <EtatPastille etat={r.etat} libelle={plan(r).etat.libelle} />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mu-note">Aucun résultat.</p>
      )}
      {imports.length > 0 && <div className="mu-import-suivi"><Section titre="Imports"><ListeImports liste={imports} /></Section></div>}
      {mode === "lien" && fiche && <FicheMusicale key={fiche.url} fiche={fiche} onImporter={importer} onEnregistrer={() => void enregistrer()} enregistree={vue.fiches.some((f) => f.url === fiche.url)} correspondance={correspondance} />}
      {vue.fiches.length > 0 && (
        <Section titre="Fiches enregistrées">
          <ul className="mu-resultats">
            {vue.fiches.slice(0, 20).map((f: FicheEnregistree) => (
              <li key={f.url}>
                <div className="mu-resultat mu-resultat--fiche">
                  <button type="button" className="mu-resultat-corps" onClick={() => { setMode("lien"); setUrl(f.url); void analyser(f.url); }}>
                    <Pochette url={f.pochette} titre={f.titre ?? f.url} taille={40} />
                    <div className="mu-piste-texte"><span className="ellipsis">{f.titre ?? f.url}</span><span className="c3 ellipsis">{typo(`${f.artistes.join(", ")}${f.artistes.length ? " · " : ""}enregistrée ${quand(f.enregistreeLe)}`)}</span></div>
                  </button>
                  <BoutonIcone nom="trash" libelle={typo(`Retirer la fiche « ${f.titre ?? f.url} »`)} taille="sm" onClick={async () => { const l = await musiqueApi.retirerFiche(f.url); setVue((v) => (v ? { ...v, fiches: l } : v)); }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ---- Bibliothèque ---------------------------------------------------------------------------------------------------

function LignePiste({ p, i, actif, lecture, choisi, onLire, onChoisir, onMenu, numero }: { p: Piste; i: number; actif: boolean; lecture?: boolean; choisi: boolean; onLire: () => void; onChoisir: (e: ME | KE, coche?: boolean) => void; onMenu: (e: ME<HTMLElement>, clavier?: boolean) => void; numero?: number | null }) {
  const joue = actif && !!lecture;
  return (
    <div className="mu-ligne" role="row" tabIndex={0} aria-selected={choisi} data-actif={actif ? "" : undefined} data-lecture={joue ? "" : undefined} data-id={p.id}
      onDoubleClick={onLire} onClick={(e) => { if (e.ctrlKey || e.shiftKey || e.metaKey) onChoisir(e); }}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onLire(); }
        else if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); onChoisir(e, true); }
        else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); onMenu(e as unknown as ME<HTMLElement>, true); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const s = (e.currentTarget as HTMLElement)[e.key === "ArrowDown" ? "nextElementSibling" : "previousElementSibling"] as HTMLElement | null; s?.focus(); }
      }}>
      <span role="gridcell" className="mu-ligne-num">
        <input type="checkbox" checked={choisi} tabIndex={-1} aria-label={typo(`Choisir « ${p.titre} »`)} onChange={(e) => onChoisir(e as unknown as ME, true)} onClick={(e) => e.stopPropagation()} />
        <span className="mu-ligne-n">{actif ? <Egaliseur actif={joue} /> : numero ?? i + 1}</span>
        <button type="button" className="mu-ligne-lire" aria-label={typo(joue ? `Mettre « ${p.titre} » en pause` : actif ? `Reprendre « ${p.titre} »` : `Lire « ${p.titre} »`)} tabIndex={-1}
          onClick={actif ? () => L.basculer() : onLire}><IconeM nom={joue ? "pause" : "play"} taille={14} /></button>
      </span>
      <span role="gridcell" className="mu-ligne-titre">
        <Pochette url={urlPochette(p.pochette)} titre={p.titre} taille={36} />
        <span className="mu-piste-texte"><span className="ellipsis">{p.titre}</span><span className="c3 ellipsis">{artistesDe(p)}</span></span>
      </span>
      <span role="gridcell" className="mu-ligne-album ellipsis c2">{p.album ?? "—"}</span>
      <span role="gridcell" className="mu-ligne-qualite c3" title={libelleQualite(p.qualite)}>{libelleQualite(p.qualite)}</span>
      <span role="gridcell" className="mu-chiffre c3">{duree(p.dureeS)}</span>
      <span role="gridcell"><BoutonIcone nom="more" libelle={typo(`Actions pour « ${p.titre} »`)} taille="sm" tabIndex={-1} onClick={(e) => onMenu(e)} /></span>
    </div>
  );
}

function DetailAlbum({ a, onRetour, onLire, onMenu, actifRef, lecture, choisis, onChoisir }: { a: Album; onRetour: () => void; onLire: (ids: string[], depart?: number) => void; onMenu: (p: Piste, e: ME<HTMLElement>, c?: boolean) => void; actifRef: string | null; lecture: boolean; choisis: Set<string>; onChoisir: (id: string, e: ME | KE, coche?: boolean) => void }) {
  const ids = a.pistes.map((p) => p.id);
  const sansPerte = a.pistes.every((p) => p.qualite.sansPerte);
  const poch = urlPochette(a.pochette);
  const enCours = !!actifRef && ids.some((id) => ref(id) === actifRef);
  return (
    <div className="mu-album">
      <button type="button" className="mu-retour" onClick={onRetour}><Icone nom="chevron-left" taille={16} />Albums</button>
      <div className="mu-album-tete">
        {poch && <span className="mu-ecoute-fond" style={{ backgroundImage: `url("${poch}")` }} aria-hidden="true" />}
        <div className="mu-album-poch"><Pochette url={poch} titre={a.titre} taille={208} /></div>
        <div className="mu-album-infos">
          <span className="mu-sur">Album</span>
          <h2 className="mu-album-titre">{a.titre}</h2>
          <p className="mu-fiche-artiste">{a.artiste}</p>
          <p className="mu-fiche-meta">{typo([a.annee, pluriel(a.pistes.length, "titre", "titres"), a.dureeS ? duree(a.dureeS) : null, sansPerte ? "Sans perte" : null].filter(Boolean).join(" · "))}</p>
          <div className="mu-fiche-actions">
            {enCours ? <Bouton variante="primary" icone={lecture ? "pause" : "play"} onClick={() => L.basculer()}>{lecture ? "Pause" : "Reprendre"}</Bouton>
              : <Bouton variante="primary" icone="play" onClick={() => onLire(ids)}>Lire</Bouton>}
            <Bouton onClick={() => { if (!L.lireEtat().file.aleatoire) L.aleatoire(); onLire(ids, Math.floor(Math.random() * ids.length)); }}><IconeM nom="aleatoire" taille={16} />Aléatoire</Bouton>
            <Bouton variante="ghost" icone="plus" onClick={() => L.ajouterFile(ids.map(ref), "fin")}>Ajouter à la file</Bouton>
          </div>
        </div>
      </div>
      <div className="mu-liste" role="grid" aria-label={typo(`Titres de l'album « ${a.titre} »`)}>
        {a.pistes.map((p, i) => <LignePiste key={p.id} p={p} i={i} numero={p.numero} actif={actifRef === ref(p.id)} lecture={lecture} choisi={choisis.has(p.id)} onLire={() => onLire(ids, i)} onChoisir={(e, c) => onChoisir(p.id, e, c)} onMenu={(e, c) => onMenu(p, e, c)} />)}
      </div>
    </div>
  );
}

function CloudMusical({ onLireCloud, onReimporter }: { onLireCloud: (o: ObjetCloud, tous: ObjetCloud[]) => void; onReimporter: (url: string) => void }) {
  const toast = useToast();
  const [liste, setListe] = useState<ObjetCloud[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    api.cloudObjets({ q: "", statut: "", type: "audio", tri: "recent", page: 1, musique: true })
      .then((l) => { setListe(l.items); for (const o of l.items) registre.cloud.set(o.id, o); })
      .catch((e) => setErreur(messageErreur(e)));
  }, []);
  if (erreur) return <div className="bandeau bandeau--erreur" role="alert"><Icone nom="alert" taille={16} /><span className="grow">{typo(erreur)}</span></div>;
  if (!liste) return <div className="mu-comete" role="progressbar" aria-label="Lecture du Cloud" />;
  if (!liste.length) return <p className="mu-note">{typo("Aucun morceau dans ton Cloud. Les imports autorisés y sont sauvegardés 30 jours, dans le même espace que les vidéos.")}</p>;
  const lisibles = liste.filter((o) => o.audioDisponible !== false && o.statut === "sauvegarde");
  return (
    <>
    <p className="mu-note mu-cloud-note">{typo("Conservés 30 jours dans ton Cloud, dans le même espace que tes vidéos. À l'expiration, la fiche reste et l'audio devient indisponible ; une copie téléchargée sur cet ordinateur n'est jamais supprimée.")}</p>
    <ul className="mu-cloud">
      {liste.map((o) => {
        const x = infoCloud(o);
        const dispo = o.audioDisponible !== false && o.statut === "sauvegarde";
        return (
          <li key={o.id} className="mu-cloud-ligne" data-dispo={dispo ? "" : undefined}>
            <Pochette url={x.pochette} titre={x.titre} taille={44} />
            <div className="mu-piste-texte"><span className="ellipsis">{x.titre}</span><span className="c3 ellipsis">{typo([x.artistes, o.musique?.licence?.nom].filter(Boolean).join(" · "))}</span></div>
            <span className="mu-cloud-exp">{dispo ? typo(o.expireDansJours != null ? `Expire dans ${pluriel(o.expireDansJours, "jour", "jours")}${o.expireLe ? ` · ${dateCourte(o.expireLe)}` : ""}` : "Sauvegardé") : typo("Audio expiré · fiche gardée")}</span>
            {dispo && <BoutonIcone nom="download" libelle={typo(`Télécharger « ${x.titre} » sur cet ordinateur`)} taille="sm" onClick={async () => { try { await api.cloudTelecharger(o.id); toast({ etat: "attente", titre: "Téléchargement lancé", texte: "Le fichier arrive dans le dossier des médias, puis dans ta musique." }); } catch (e) { toast({ etat: "erreur", titre: "Téléchargement impossible", texte: messageErreur(e) }); } }} />}
            {dispo ? <Bouton taille="sm" icone="play" onClick={() => onLireCloud(o, lisibles)}>Écouter</Bouton>
              : o.reimport?.possible ? <Bouton taille="sm" icone="retry" onClick={() => onReimporter(o.reimport!.url)}>Réimporter</Bouton>
              : <span className="c3 mu-petit">Réimport impossible</span>}
          </li>
        );
      })}
    </ul>
    </>
  );
}

function Bibliotheque({ vue, ordreAjout, ouvrirAlbum, setOuvrirAlbum, onLirePistes, onMenuPiste, choisis, setChoisis, onReimporter, cloud, artisteDemande, onArtisteLu }: {
  vue: VueMusique; ordreAjout: Map<string, number>; ouvrirAlbum: Album | null; setOuvrirAlbum: (a: Album | null) => void; onLirePistes: (ids: string[], d?: number) => void;
  onMenuPiste: (p: Piste, e: ME<HTMLElement>, c?: boolean) => void; choisis: Set<string>; setChoisis: (s: Set<string>) => void; onReimporter: (url: string) => void; cloud: boolean;
  artisteDemande: string | null; onArtisteLu: () => void;
}) {
  const l = L.useLecteur();
  const [mode, setMode] = useState<"titres" | "albums" | "artistes" | "cloud">("titres");
  const [affichage, setAffichage] = useState<"liste" | "grille">(() => { try { return (localStorage.getItem("aethryon.musique.affichage") as "liste" | "grille") || "liste"; } catch { return "liste"; } });
  const [filtres, setFiltres] = useState<Filtres>({ q: "", qualite: "", format: "", provenance: "" });
  const [tri, setTri] = useState<Tri>("ajout");
  const [artiste, setArtiste] = useState<string | null>(null);
  const dernier = useRef<string | null>(null);
  useEffect(() => { try { localStorage.setItem("aethryon.musique.affichage", affichage); } catch { /* préférence locale */ } }, [affichage]);
  // Artiste ouvert depuis l'Accueil musical : ses titres, comme un clic sur sa tuile.
  useEffect(() => { if (artisteDemande) { setOuvrirAlbum(null); setMode("artistes"); setArtiste(artisteDemande); onArtisteLu(); } }, [artisteDemande]);
  const formats = useMemo(() => [...new Set(vue.pistes.map((p) => p.qualite.codec))].filter((c) => c && c !== "inconnu").sort(), [vue.pistes]);
  const visibles = useMemo(() => {
    let v = filtrer(vue.pistes, filtres);
    if (artiste) v = v.filter((p) => p.artistes.includes(artiste) || p.artisteAlbum === artiste);
    return trier(v, tri, ordreAjout);
  }, [vue.pistes, filtres, tri, ordreAjout, artiste]);
  const albums = useMemo(() => grouperAlbums(filtrer(vue.pistes, filtres), ordreAjout), [vue.pistes, filtres, ordreAjout]);
  const arts = useMemo(() => grouperArtistes(filtrer(vue.pistes, filtres)), [vue.pistes, filtres]);
  const ids = visibles.map((p) => p.id);
  const choisir = (id: string, e: ME | KE, coche?: boolean) => {
    const s = new Set(choisis);
    if ((e as ME).shiftKey && dernier.current) {
      const a = ids.indexOf(dernier.current), b = ids.indexOf(id);
      for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) s.add(x);
    } else if (s.has(id) && (coche || (e as ME).ctrlKey || (e as ME).metaKey)) s.delete(id); else s.add(id);
    dernier.current = id;
    setChoisis(s);
  };
  if (ouvrirAlbum) return <DetailAlbum a={ouvrirAlbum} onRetour={() => setOuvrirAlbum(null)} onLire={onLirePistes} onMenu={onMenuPiste} actifRef={l.info?.ref ?? null} lecture={l.enLecture} choisis={choisis} onChoisir={choisir} />;
  if (!vue.pistes.length && mode !== "cloud") {
    return (
      <div className="vide mu-vide">
        <Companion lieu="vide" taille={64} />
        <h2 className="t-display-m">Aucun fichier audio pour l'instant</h2>
        <p>{typo("Ajoute des MP3, FLAC, WAV, M4A ou OGG dans tes dossiers surveillés : ils apparaissent ici avec leurs étiquettes, lues sans jamais modifier les fichiers.")}</p>
        {cloud && <div className="vide-actions"><Bouton onClick={() => setMode("cloud")} icone="cloud">Voir ma musique dans le Cloud</Bouton></div>}
      </div>
    );
  }
  return (
    <div className="mu-biblio">
      <div className="toolbar mu-outils">
        <Segmente libelle="Afficher" valeur={mode} onChange={(m) => { setMode(m); setArtiste(null); }} options={[
          { id: "titres", libelle: "Titres", n: vue.pistes.length }, { id: "albums", libelle: "Albums", n: albums.length }, { id: "artistes", libelle: "Artistes", n: arts.length },
          ...(cloud ? [{ id: "cloud" as const, libelle: "Cloud" }] : [])]} />
        {mode !== "cloud" && <>
          <label className="field field--saisie mu-recherche">
            <Icone nom="search" taille={16} />
            <input type="search" value={filtres.q} onChange={(e) => setFiltres({ ...filtres, q: e.target.value })} placeholder="Titre, artiste, album, genre" aria-label="Rechercher dans ma musique" />
          </label>
          <span className="grow" />
          <label className="select select--etiquette"><span className="lbl">Qualité</span>
            <select className="select--natif" aria-label="Filtrer par qualité" value={filtres.qualite} onChange={(e) => setFiltres({ ...filtres, qualite: e.target.value as Filtres["qualite"] })}>
              <option value="">Toutes</option>{(Object.keys(CLASSES) as (keyof typeof CLASSES)[]).map((k) => <option key={k} value={k}>{CLASSES[k]}</option>)}
            </select></label>
          <label className="select select--etiquette"><span className="lbl">Format</span>
            <select className="select--natif" aria-label="Filtrer par format" value={filtres.format} onChange={(e) => setFiltres({ ...filtres, format: e.target.value })}>
              <option value="">Tous</option>{formats.map((f) => <option key={f} value={f}>{nomCodec({ codec: f, conteneur: "", debitKbps: null, frequenceHz: null, bits: null, canaux: null, sansPerte: false })}</option>)}
            </select></label>
          <label className="select select--etiquette"><span className="lbl">Origine</span>
            <select className="select--natif" aria-label="Filtrer par origine" value={filtres.provenance} onChange={(e) => setFiltres({ ...filtres, provenance: e.target.value as Filtres["provenance"] })}>
              <option value="">Toutes</option><option value="local">Mes fichiers</option><option value="importe">Importés</option>
            </select></label>
          {mode === "titres" && <label className="select select--etiquette"><span className="lbl">Trier</span>
            <select className="select--natif" aria-label="Trier les titres" value={tri} onChange={(e) => setTri(e.target.value as Tri)}>
              <option value="ajout">Ajout récent</option><option value="titre">Titre</option><option value="artiste">Artiste</option><option value="album">Album</option><option value="duree">Durée</option><option value="qualite">Qualité</option>
            </select></label>}
          {mode !== "artistes" && <Segmente libelle="Disposition" valeur={affichage} onChange={setAffichage} options={[{ id: "liste", libelle: "Liste" }, { id: "grille", libelle: "Grille" }]} />}
        </>}
      </div>
      {artiste && <button type="button" className="mu-retour" onClick={() => setArtiste(null)}><Icone nom="chevron-left" taille={16} />{typo(`Tous les artistes · ${artiste}`)}</button>}
      {mode === "cloud" ? <CloudMusical onLireCloud={(o, tous) => { L.lire(tous.map((x) => `cloud:${x.id}`), tous.indexOf(o)); }} onReimporter={onReimporter} />
        : mode === "artistes" && !artiste ? (
          <div className="mu-grille">
            {arts.map((a, i) => <Tuile key={a.nom} i={i} rond titre={a.nom} sous={pluriel(a.n, "titre", "titres")} pochette={urlPochette(a.pochette)} onOuvrir={() => { setArtiste(a.nom); }} onLire={() => onLirePistes(vue.pistes.filter((p) => p.artistes.includes(a.nom)).map((p) => p.id))} />)}
          </div>
        ) : mode === "albums" ? (
          affichage === "grille" ? (
            <div className="mu-grille">
              {albums.map((a, i) => <Tuile key={a.cle} i={i} titre={a.titre} sous={`${a.artiste}${a.annee ? ` · ${a.annee}` : ""}`} pochette={urlPochette(a.pochette)} onOuvrir={() => setOuvrirAlbum(a)} onLire={() => onLirePistes(a.pistes.map((p) => p.id))}
                actif={!!l.info && a.pistes.some((p) => ref(p.id) === l.info!.ref)} lecture={l.enLecture} />)}
            </div>
          ) : (
            <ul className="mu-albums-liste">
              {albums.map((a) => (
                <li key={a.cle}><button type="button" className="mu-resultat" onClick={() => setOuvrirAlbum(a)}>
                  <Pochette url={urlPochette(a.pochette)} titre={a.titre} taille={44} />
                  <div className="mu-piste-texte"><span className="ellipsis">{a.titre}</span><span className="c3 ellipsis">{typo([a.artiste, a.annee, pluriel(a.pistes.length, "titre", "titres")].filter(Boolean).join(" · "))}</span></div>
                  <span className="mu-chiffre c3">{duree(a.dureeS)}</span>
                </button></li>
              ))}
            </ul>
          )
        ) : affichage === "grille" ? (
          <div className="mu-grille">
            {visibles.map((p, i) => <Tuile key={p.id} i={i} titre={p.titre} sous={artistesDe(p)} pochette={urlPochette(p.pochette)} actif={l.info?.ref === ref(p.id)} lecture={l.enLecture} onLire={() => onLirePistes(ids, i)} onMenu={(e, c) => onMenuPiste(p, e, c)} />)}
          </div>
        ) : (
          <div className="mu-liste" role="grid" aria-label="Titres" aria-multiselectable="true">
            <div className="mu-ligne mu-ligne--tete" role="row"><span role="columnheader">#</span><span role="columnheader">Titre</span><span role="columnheader">Album</span><span role="columnheader">Qualité réelle</span><span role="columnheader">Durée</span><span role="columnheader"><span className="cache">Actions</span></span></div>
            {visibles.map((p, i) => <LignePiste key={p.id} p={p} i={i} actif={l.info?.ref === ref(p.id)} lecture={l.enLecture} choisi={choisis.has(p.id)} onLire={() => onLirePistes(ids, i)} onChoisir={(e, c) => choisir(p.id, e, c)} onMenu={(e, c) => onMenuPiste(p, e, c)} />)}
            {!visibles.length && <p className="mu-note mu-aucun">Aucun titre ne correspond.</p>}
          </div>
        )}
    </div>
  );
}

// ---- Playlists ------------------------------------------------------------------------------------------------------

function ListeReordonnable({ pl, onOrdre, onRetirer, onLire }: { pl: Playlist; onOrdre: (pistes: string[]) => void; onRetirer: (i: number) => void; onLire: (i: number) => void }) {
  const boite = useRef<HTMLOListElement>(null);
  const avant = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [glisse, setGlisse] = useState<{ de: number; vers: number; dy: number } | null>(null);
  const [annonce, setAnnonce] = useState("");
  const H = 56;
  const cle = (e: HTMLElement) => e.dataset.cle ?? null;
  useLayoutEffect(() => {
    if (boite.current) animerMiseEnPage(avant.current, boite.current.querySelectorAll<HTMLElement>("[data-cle]"), cle);
    avant.current = new Map();
  }, [pl.pistes]);
  const noter = () => { if (boite.current) avant.current = mesurer(boite.current.querySelectorAll<HTMLElement>("[data-cle]"), cle); };
  const deplacer = (de: number, vers: number) => {
    if (vers < 0 || vers >= pl.pistes.length || de === vers) return;
    const n = pl.pistes.slice();
    const [x] = n.splice(de, 1);
    n.splice(vers, 0, x);
    onOrdre(n);
    const p = registre.pistes.get(x);
    setAnnonce(typo(`« ${p?.titre ?? "Morceau"} » déplacé en position ${vers + 1} sur ${n.length}.`));
  };
  const debut = (i: number) => (e: PE<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGlisse({ de: i, vers: i, dy: 0 });
    const borne = (dy: number) => Math.max(0, Math.min(pl.pistes.length - 1, i + Math.round(dy / H)));
    const bouge = (ev: PointerEvent) => setGlisse({ de: i, vers: borne(ev.clientY - y0), dy: ev.clientY - y0 });
    const fin = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", bouge);
      window.removeEventListener("pointerup", fin);
      const vers = borne(ev.clientY - y0);
      setGlisse(null);
      if (vers !== i) { deplacer(i, vers); }
    };
    window.addEventListener("pointermove", bouge);
    window.addEventListener("pointerup", fin);
  };
  if (!pl.pistes.length) return <p className="mu-note">{typo("Playlist vide : ajoute des morceaux depuis la bibliothèque (clic droit › Ajouter à la playlist).")}</p>;
  return (
    <>
      <ol className="mu-pl-liste" ref={boite} aria-label={typo(`Morceaux de « ${pl.nom} » (Alt + flèches pour réorganiser, Suppr pour retirer)`)}>
        {pl.pistes.map((id, i) => {
          const p = registre.pistes.get(id);
          const deplace = glisse?.de === i;
          const decale = glisse && !deplace ? (glisse.de < glisse.vers && i > glisse.de && i <= glisse.vers ? -H : glisse.de > glisse.vers && i < glisse.de && i >= glisse.vers ? H : 0) : 0;
          const occ = pl.pistes.slice(0, i).filter((x) => x === id).length;
          return (
            <li key={`${id}#${occ}`} data-cle={`${id}#${occ}`} data-index={i} tabIndex={0} className="mu-pl-ligne" data-glisse={deplace ? "" : undefined} data-absent={p ? undefined : ""}
              style={deplace ? { transform: `translateY(${glisse!.dy}px) scale(1.01)` } : decale ? { transform: `translateY(${decale}px)` } : undefined}
              aria-label={typo(p ? `${i + 1}. ${p.titre}, ${artistesDe(p)}` : `${i + 1}. Fichier absent de la bibliothèque`)}
              onDoubleClick={() => p && onLire(i)}
              onKeyDown={(e) => {
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  // Au clavier : aucune animation (action répétée, réponse immédiate).
                  const v = i + (e.key === "ArrowUp" ? -1 : 1);
                  deplacer(i, v);
                  requestAnimationFrame(() => boite.current?.querySelector<HTMLElement>(`[data-index="${v}"]`)?.focus());
                } else if (e.key === "Delete") { e.preventDefault(); onRetirer(i); }
                else if (e.key === "Enter" && p) onLire(i);
              }}>
              <span className="mu-poignee" aria-hidden="true" onPointerDown={(e) => { noter(); debut(i)(e); }}><IconeM nom="poignee" taille={16} /></span>
              <span className="mu-num">{i + 1}</span>
              <Pochette url={p ? urlPochette(p.pochette) : null} titre={p?.titre ?? "?"} taille={40} />
              <span className="mu-piste-texte"><span className="ellipsis">{p?.titre ?? "Fichier absent"}</span><span className="c3 ellipsis">{p ? artistesDe(p) : "Déplacé ou supprimé : il revient s'il réapparaît dans un dossier surveillé."}</span></span>
              <span className="mu-chiffre c3">{duree(p?.dureeS)}</span>
              <BoutonIcone nom="close" libelle={typo(`Retirer « ${p?.titre ?? "ce morceau"} » de la playlist`)} taille="sm" onClick={() => { noter(); onRetirer(i); }} />
            </li>
          );
        })}
      </ol>
      <p className="cache" aria-live="polite">{annonce}</p>
    </>
  );
}

function Playlists({ vue, setVue, onLirePistes, choisie, setChoisie }: { vue: VueMusique; setVue: (f: (v: VueMusique | null) => VueMusique | null) => void; onLirePistes: (ids: string[], d?: number) => void; choisie: string | null; setChoisie: (id: string | null) => void }) {
  const toast = useToast();
  const compte = useCompte();
  const [nom, setNom] = useState<{ id: string | null; valeur: string } | null>(null);
  const [aSupprimer, setASupprimer] = useState<Playlist | null>(null);
  const [synchro, setSynchro] = useState("");
  const [enSynchro, setEnSynchro] = useState(false);
  const pl = vue.playlists.find((p) => p.id === choisie) ?? vue.playlists[0] ?? null;
  const op = async (o: Parameters<typeof musiqueApi.playlists>[0]) => {
    try {
      const r = await musiqueApi.playlists(o);
      setVue((v) => (v ? { ...v, playlists: r.playlists } : v));
      return r.id;
    } catch (e) { toast({ etat: "erreur", titre: "Playlist non modifiée", texte: messageErreur(e) }); return null; }
  };
  const synchroniser = async () => {
    setEnSynchro(true);
    try {
      const r = await musiqueApi.synchroniser(synchro.trim());
      setVue((v) => (v ? { ...v, playlists: r.playlists } : v));
      const s = r.resultat.stats;
      toast({ etat: "ok", titre: "Playlist synchronisée", texte: typo(`${s.correspondancesSures + s.correspondancesProbables} titres trouvés dans tes fichiers, ${s.sansFichier} identifiés sans fichier. Rien n'a été téléchargé.`) });
      const n = r.playlists.find((p) => p.source?.url === synchro.trim());
      if (n) setChoisie(n.id);
      setSynchro("");
    } catch (e) { toast({ etat: "erreur", titre: "Synchronisation impossible", texte: erreurMusique(e) }); }
    finally { setEnSynchro(false); }
  };
  const duree_ = pl ? pl.pistes.reduce((s, id) => s + (registre.pistes.get(id)?.dureeS ?? 0), 0) : 0;
  return (
    <div className="mu-pl">
      <aside className="mu-pl-cote" aria-label="Mes playlists">
        <Bouton icone="plus" bloc onClick={() => setNom({ id: null, valeur: "" })}>Nouvelle playlist</Bouton>
        <ul className="mu-pl-noms">
          {vue.playlists.map((p) => (
            <li key={p.id}><button type="button" className="mu-pl-nom" aria-current={pl?.id === p.id ? "true" : undefined} onClick={() => setChoisie(p.id)}>
              <Mosaique pochettes={pochettesDe(p.pistes)} titre={p.nom} taille={32} className="mu-pl-vignette" /><span className="ellipsis">{p.nom}</span>
              {p.source && <IconeM nom="lien" taille={14} />}<span className="c3">{p.pistes.length}</span>
            </button></li>
          ))}
        </ul>
        <form className="mu-pl-synchro" onSubmit={(e) => { e.preventDefault(); if (synchro.trim()) void synchroniser(); }}>
          <span className="sec-label mu-pl-synchro-titre">Synchroniser depuis un service
            <button type="button" className="mu-aide" aria-label={typo("Aide : colle une playlist ou un album ; AETHRYON y range les fichiers que tu possèdes déjà. Rien n'est téléchargé.")}
              data-bulle={typo("Colle une playlist ou un album : AETHRYON y range les fichiers que tu possèdes déjà. Rien n'est téléchargé.")}><Icone nom="info" taille={13} /></button>
          </span>
          <label className="field field--saisie"><input type="url" value={synchro} onChange={(e) => setSynchro(e.target.value)} placeholder="Lien de playlist ou d'album" aria-label="Lien de la playlist à synchroniser" disabled={!compte?.relie} /></label>
          <Bouton type="submit" taille="sm" disabled={!compte?.relie || !synchro.trim() || enSynchro}>{enSynchro ? "Synchronisation…" : "Synchroniser"}</Bouton>
        </form>
      </aside>
      <section className="mu-pl-detail" aria-label={pl ? typo(`Playlist « ${pl.nom} »`) : "Playlist"}>
        {pl ? (
          <>
            <div className="mu-pl-tete">
              <Mosaique pochettes={pochettesDe(pl.pistes)} titre={pl.nom} taille={148} className="mu-pl-couverture" />
              <div className="grow">
                <span className="mu-sur">{pl.source ? `Synchronisée · ${pl.source.titre ?? pl.source.connecteur}` : "Playlist"}</span>
                <h2 className="mu-album-titre">{pl.nom}</h2>
                <p className="mu-fiche-meta">{typo([pluriel(pl.pistes.length, "morceau", "morceaux"), duree_ ? duree(duree_) : null, `modifiée ${quandPhrase(pl.modifieLe)}`].filter(Boolean).join(" · "))}</p>
                <div className="mu-fiche-actions">
                  <Bouton variante="primary" icone="play" disabled={!pl.pistes.length} onClick={() => onLirePistes(pl.pistes)}>Lire</Bouton>
                  <Bouton disabled={pl.pistes.length < 2} onClick={() => { if (!L.lireEtat().file.aleatoire) L.aleatoire(); onLirePistes(pl.pistes, Math.floor(Math.random() * pl.pistes.length)); }}><IconeM nom="aleatoire" taille={16} />Aléatoire</Bouton>
                  <Bouton variante="ghost" onClick={() => setNom({ id: pl.id, valeur: pl.nom })}>Renommer</Bouton>
                  <BoutonIcone nom="trash" libelle="Supprimer la playlist" onClick={() => setASupprimer(pl)} />
                </div>
              </div>
            </div>
            <ListeReordonnable pl={pl} onOrdre={(pistes) => void op({ op: "reordonner", id: pl.id, pistes })} onRetirer={(i) => void op({ op: "retirer", id: pl.id, position: i })} onLire={(i) => onLirePistes(pl.pistes, i)} />
            {pl.source && pl.source.sansFichier.length > 0 && (
              <div className="mu-sans">
                <h3 className="sec-label">{typo(`Identifiés sans fichier (${pl.source.sansFichier.length})`)}</h3>
                <p className="mu-note">{typo("Ces titres ne sont pas dans ta bibliothèque. AETHRYON ne télécharge pas le catalogue commercial : ajoute tes propres fichiers, puis synchronise de nouveau.")}</p>
                <ul className="mu-sans-liste">{pl.source.sansFichier.slice(0, 100).map((t) => <li key={t.position}><span className="mu-num">{t.position}</span><span className="ellipsis">{t.titre}</span><span className="c3 ellipsis">{t.artistes.join(", ")}</span><span className="mu-chiffre c3">{duree(t.dureeS)}</span></li>)}</ul>
              </div>
            )}
          </>
        ) : (
          <div className="vide mu-vide"><Companion lieu="vide" taille={56} /><h2 className="t-display-m">Aucune playlist</h2><p>{typo("Crée une playlist, puis ajoute des morceaux depuis la bibliothèque. L'ordre se règle en glissant les lignes.")}</p></div>
        )}
      </section>
      {nom && (
        <Dialogue titre={nom.id ? "Renommer la playlist" : "Nouvelle playlist"} onFermer={() => setNom(null)} actions={<>
          <Bouton variante="ghost" onClick={() => setNom(null)}>Annuler</Bouton>
          <Bouton variante="primary" disabled={!nom.valeur.trim()} onClick={async () => { const id = await op(nom.id ? { op: "renommer", id: nom.id, nom: nom.valeur } : { op: "creer", nom: nom.valeur, pistes: [] }); if (!nom.id && id) setChoisie(id); setNom(null); }}>{nom.id ? "Renommer" : "Créer"}</Bouton>
        </>}>
          <label className="field field--saisie"><input autoFocus value={nom.valeur} maxLength={80} onChange={(e) => setNom({ ...nom, valeur: e.target.value })} aria-label="Nom de la playlist" placeholder="Nom de la playlist"
            onKeyDown={(e) => { if (e.key === "Enter" && nom.valeur.trim()) (e.currentTarget.closest(".dialog")?.querySelector(".btn--primary") as HTMLButtonElement | null)?.click(); }} /></label>
        </Dialogue>
      )}
      {aSupprimer && (
        <Dialogue titre={typo(`Supprimer « ${aSupprimer.nom} » ?`)} onFermer={() => setASupprimer(null)} actions={<>
          <Bouton variante="ghost" onClick={() => setASupprimer(null)}>Annuler</Bouton>
          <Bouton variante="danger" onClick={async () => { await op({ op: "supprimer", id: aSupprimer.id }); setChoisie(null); setASupprimer(null); }}>Supprimer</Bouton>
        </>}>
          <p>{typo("La playlist est supprimée ; les fichiers audio ne sont jamais touchés.")}</p>
        </Dialogue>
      )}
    </div>
  );
}

// ---- Section ------------------------------------------------------------------------------------------------------

export default function Musique() {
  const { inst, actionMedia } = useMagasin();
  const toast = useToast();
  const compte = useCompte();
  const cloud = cloudOuvert(compte);
  const { vue, setVue, erreur, charger } = useDonnees();
  const [onglet, setOnglet] = useState<Onglet>("accueil");
  const [album, setAlbum] = useState<Album | null>(null);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ el: HTMLElement; p: Piste; point?: { x: number; y: number }; clavier?: boolean } | null>(null);
  const [ajoutPl, setAjoutPl] = useState<string[] | null>(null);
  const [infos, setInfos] = useState<Piste | null>(null);
  const [plChoisie, setPlChoisie] = useState<string | null>(null);
  const [aAnalyser, setAAnalyser] = useState<string | null>(null);
  const [artisteDemande, setArtisteDemande] = useState<string | null>(null);
  const repris = useRef(false);
  const imports = useImports((t) => {
    if (t.etape === "termine") {
      signalerMusique({ evenement: { cle: `mus:${t.id}`, type: "succes", texte: "Ajouté à ta musique" } });
      toast({ etat: "ok", titre: "Ajouté à ta musique", texte: typo([t.titre, t.cloud ? `Cloud : ${t.cloud.libelle}` : null].filter(Boolean).join(" · ")) });
      void charger();
    } else if (t.etape === "echec") {
      signalerMusique({ evenement: { cle: `mus:${t.id}`, type: "erreur", texte: "Import musical non effectué" } });
      toast({ etat: "erreur", titre: "Import non effectué", texte: t.message ?? undefined });
      void charger();
    }
  });
  const ordreAjout = useMemo(() => new Map((inst?.index.medias ?? []).map((m) => [m.id, Date.parse(m.ajouteLe) || 0])), [inst?.index.medias]);

  // Reprise : seul le volume est repris d'emblée ; la file revient quand on touche « Reprendre la lecture ».
  useEffect(() => { if (vue && !repris.current) { repris.current = true; L.volumeEnregistre(vue.lecture); } }, [vue]);

  const lirePistes = useCallback((ids: string[], depart = 0) => {
    if (!ids.length) return;
    signalerMusique({ lecteur: true });
    L.lire(ids.map(ref), depart);
  }, []);
  useEffect(() => { const f = () => { if (L.actif()) signalerMusique({ lecteur: true }); }; f(); return L.abonner(f); }, []);

  const menuPiste = (p: Piste, e: ME<HTMLElement>, clavier?: boolean) => {
    const el = (e.currentTarget ?? e.target) as HTMLElement;
    const r = el.getBoundingClientRect();
    setMenu({ el, p, point: clavier ? { x: r.left + 12, y: r.bottom } : e.clientX ? { x: e.clientX, y: e.clientY } : undefined, clavier });
  };
  const cibles = (p: Piste) => (choisis.has(p.id) && choisis.size > 1 ? [...choisis] : [p.id]);
  const elementsMenu = (p: Piste): ElementMenu[] => {
    const n = cibles(p).length;
    const m = registre.medias.get(p.id);
    return [
      { id: "lire", libelle: n > 1 ? `Lire les ${n} morceaux` : "Lire", icone: "play" },
      { id: "ensuite", libelle: "Lire ensuite", icone: "arrow-right" },
      { id: "file", libelle: "Ajouter à la file", icone: "plus" },
      { id: "playlist", libelle: "Ajouter à une playlist…", icone: "library" },
      ...(cloud ? [{ id: "cloud", libelle: "Sauvegarder dans le Cloud", icone: "cloud-up" as const, separateurAvant: true, desactive: m?.etat !== "disponible", raison: "Fichier indisponible" }] : []),
      { id: "infos", libelle: "Informations", icone: "info", separateurAvant: !cloud },
      { id: "explorateur", libelle: "Afficher dans l'Explorateur", icone: "reveal", desactive: !m },
    ];
  };
  const choisirMenu = async (id: string) => {
    if (!menu) return;
    const p = menu.p;
    const ids = cibles(p);
    setMenu(null);
    if (id === "lire") lirePistes(ids);
    else if (id === "ensuite" || id === "file") { signalerMusique({ lecteur: true }); L.ajouterFile(ids.map(ref), id === "ensuite" ? "ensuite" : "fin"); toast({ etat: "ok", titre: id === "ensuite" ? "Sera lu ensuite" : "Ajouté à la file", texte: ids.length > 1 ? pluriel(ids.length, "morceau", "morceaux") : p.titre }); }
    else if (id === "playlist") setAjoutPl(ids);
    else if (id === "infos") setInfos(p);
    else if (id === "explorateur") { const m = registre.medias.get(p.id); if (m) void actionMedia(m, "explorateur"); }
    else if (id === "cloud") {
      try { const l = await api.cloudEnvoyer(ids); toast({ etat: "info", titre: `Envoi vers le Cloud : ${pluriel(l.length, "morceau", "morceaux")}`, texte: "Même espace que les vidéos, conservé 30 jours. Ta copie locale n'est jamais supprimée." }); }
      catch (e) { toast({ etat: "erreur", titre: "Envoi vers le Cloud impossible", texte: messageErreur(e) }); }
    }
  };

  if (!vue) {
    return (
      <div className="mu">
        <div className="ph"><div className="grow"><h1 className="t-display-l">Musique</h1><p className="sub">{erreur ? typo(erreur) : "Lecture de la bibliothèque…"}</p></div></div>
        {!erreur && <div className="mu-comete" role="progressbar" aria-label="Lecture des étiquettes" />}
      </div>
    );
  }
  const onglets: { id: Onglet; libelle: string; n?: number }[] = [
    { id: "accueil", libelle: "Accueil" }, { id: "bibliotheque", libelle: "Bibliothèque", n: vue.pistes.length }, { id: "playlists", libelle: "Playlists", n: vue.playlists.length }, { id: "importer", libelle: "Importer" },
  ];
  const lisibles = vue.pistes.length;
  const nAlbums = grouperAlbums(vue.pistes).length;
  const nArtistes = grouperArtistes(vue.pistes).length;
  return (
    <div className="mu" data-onglet={onglet}>
      <div className="ph mu-ph">
        <div className="grow">
          <h1 className="t-display-l">Musique</h1>
          <p className="sub"><b>{pluriel(lisibles, "morceau", "morceaux")}</b>{typo(` · ${pluriel(nAlbums, "album", "albums")} · ${pluriel(nArtistes, "artiste", "artistes")}`)}</p>
        </div>
        <Segmente libelle="Musique" valeur={onglet} onChange={(o) => { setOnglet(o); setAlbum(null); }} options={onglets} />
      </div>
      <div className="mu-corps" key={onglet}>
        {onglet === "accueil" && <AccueilMusical vue={vue} ordreAjout={ordreAjout} onAller={setOnglet} onLirePistes={lirePistes} onMenuPiste={menuPiste} onOuvrirAlbum={(a) => { setAlbum(a); setOnglet("bibliotheque"); }}
          onOuvrirArtiste={(nom) => { setArtisteDemande(nom); setOnglet("bibliotheque"); }} onOuvrirPlaylist={(id) => { setPlChoisie(id); setOnglet("playlists"); }} imports={imports} />}
        {onglet === "importer" && <Importer vue={vue} setVue={setVue} imports={imports} initial={aAnalyser} onInitialLu={() => setAAnalyser(null)} />}
        {onglet === "bibliotheque" && <Bibliotheque vue={vue} ordreAjout={ordreAjout} ouvrirAlbum={album} setOuvrirAlbum={setAlbum} onLirePistes={lirePistes} onMenuPiste={menuPiste} choisis={choisis} setChoisis={setChoisis} cloud={cloud} onReimporter={(u) => { setAAnalyser(u); setOnglet("importer"); }}
          artisteDemande={artisteDemande} onArtisteLu={() => setArtisteDemande(null)} />}
        {onglet === "playlists" && <Playlists vue={vue} setVue={setVue} onLirePistes={lirePistes} choisie={plChoisie} setChoisie={setPlChoisie} />}
      </div>
      {choisis.size > 0 && onglet === "bibliotheque" && (
        <div className="barre-selection mu-selection" role="toolbar" aria-label="Sélection">
          <span className="mu-selection-n">{pluriel(choisis.size, "morceau choisi", "morceaux choisis")}</span>
          <Bouton taille="sm" variante="primary" icone="play" onClick={() => lirePistes([...choisis])}>Lire</Bouton>
          <Bouton taille="sm" icone="plus" onClick={() => { signalerMusique({ lecteur: true }); L.ajouterFile([...choisis].map(ref), "fin"); }}>Ajouter à la file</Bouton>
          <Bouton taille="sm" icone="library" onClick={() => setAjoutPl([...choisis])}>Ajouter à une playlist</Bouton>
          {cloud && <Bouton taille="sm" icone="cloud-up" onClick={async () => { try { await api.cloudEnvoyer([...choisis]); toast({ etat: "info", titre: "Envoi vers le Cloud lancé" }); } catch (e) { toast({ etat: "erreur", titre: "Envoi impossible", texte: messageErreur(e) }); } }}>Cloud</Bouton>}
          <BoutonIcone nom="close" libelle="Tout désélectionner" taille="sm" onClick={() => setChoisis(new Set())} />
        </div>
      )}
      {menu && <Menu ancre={menu.el} point={menu.point} parClavier={menu.clavier} elements={elementsMenu(menu.p)} onChoisir={(id) => void choisirMenu(id)} onFermer={() => setMenu(null)} libelle={typo(`Actions pour « ${menu.p.titre} »`)}
        entete={{ miniature: urlPochette(menu.p.pochette), nom: menu.p.titre, meta: artistesDe(menu.p) }} />}
      {ajoutPl && (
        <Dialogue titre={typo(`Ajouter ${pluriel(ajoutPl.length, "morceau", "morceaux")} à une playlist`)} onFermer={() => setAjoutPl(null)} actions={<Bouton variante="ghost" onClick={() => setAjoutPl(null)}>Fermer</Bouton>}>
          <ul className="mu-pl-choix">
            {vue.playlists.map((p) => <li key={p.id}><button type="button" className="mu-pl-nom" onClick={async () => { const r = await musiqueApi.playlists({ op: "ajouter", id: p.id, pistes: ajoutPl }).catch((e) => { toast({ etat: "erreur", titre: "Non ajouté", texte: messageErreur(e) }); return null; }); if (r) { setVue((v) => (v ? { ...v, playlists: r.playlists } : v)); toast({ etat: "ok", titre: typo(`Ajouté à « ${p.nom} »`) }); } setAjoutPl(null); setChoisis(new Set()); }}>
              <IconeM nom="playlist" taille={16} /><span className="ellipsis">{p.nom}</span><span className="c3">{p.pistes.length}</span></button></li>)}
            <li><button type="button" className="mu-pl-nom" onClick={async () => { const r = await musiqueApi.playlists({ op: "creer", nom: `Playlist du ${new Date().toLocaleDateString("fr-FR")}`, pistes: ajoutPl }).catch(() => null); if (r) { setVue((v) => (v ? { ...v, playlists: r.playlists } : v)); setPlChoisie(r.id); toast({ etat: "ok", titre: "Playlist créée" }); } setAjoutPl(null); setChoisis(new Set()); }}>
              <Icone nom="plus" taille={16} /><span>Nouvelle playlist avec ces morceaux</span></button></li>
          </ul>
        </Dialogue>
      )}
      {infos && (
        <Dialogue titre={infos.titre} onFermer={() => setInfos(null)} actions={<Bouton variante="primary" onClick={() => setInfos(null)}>Fermer</Bouton>}>
          <dl className="mu-infos">
            <dt>Artistes</dt><dd>{artistesDe(infos)}</dd>
            {infos.album && <><dt>Album</dt><dd>{infos.album}{infos.numero ? ` · piste ${infos.numero}` : ""}{infos.disque && infos.disque > 1 ? ` · disque ${infos.disque}` : ""}</dd></>}
            {infos.annee && <><dt>Année</dt><dd>{infos.annee}</dd></>}
            {infos.genre && <><dt>Genre</dt><dd>{infos.genre}</dd></>}
            <dt>Qualité réelle</dt><dd>{libelleQualite(infos.qualite)}{infos.qualite.canaux === 2 ? " · stéréo" : ""}</dd>
            <dt>Durée</dt><dd>{duree(infos.dureeS)}</dd>
            {infos.isrc && <><dt>ISRC</dt><dd>{infos.isrc}</dd></>}
            <dt>Étiquettes</dt><dd>{infos.etiquetage === "ok" ? "Lues dans le fichier" : infos.etiquetage === "absentes" ? "Absentes : titre tiré du nom du fichier" : typo(`Illisibles (${infos.erreur ?? "format"})`)}</dd>
            {infos.provenance && <>
              <dt>Origine</dt><dd>{typo(`Importé ${quand(infos.provenance.importeLe)} depuis ${infos.provenance.connecteur}`)}</dd>
              {infos.provenance.licence && <><dt>Licence</dt><dd>{infos.provenance.licence.nom}</dd></>}
              {infos.provenance.attribution && <><dt>Attribution</dt><dd>{typo(infos.provenance.attribution)}</dd></>}
              {infos.provenance.attestation && <><dt>Droits</dt><dd>Déclaration de droits enregistrée à l'import</dd></>}
            </>}
          </dl>
        </Dialogue>
      )}
    </div>
  );
}
