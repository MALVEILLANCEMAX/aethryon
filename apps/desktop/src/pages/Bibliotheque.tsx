// Bibliothèque « Nocturne » : vraie médiathèque. Grandes vignettes (grille) ou liste, VIRTUALISÉES (seules les cartes
// visibles sont dans le DOM : des dizaines de milliers de médias restent fluides), lues par un ADAPTATEUR DE SOURCE
// (lib/sourceMedias.ts : l'instantané aujourd'hui, l'API paginée d'AETHRYON Index demain). Recherche (l'en-tête,
// Ctrl K ou Ctrl F), filtres par type, tri, sélection multiple (Ctrl / Maj + clic, Ctrl A, case), panneau de détails
// (Alt + Entrée), aperçu vidéo au survol, menu contextuel, glisser natif, import dans Premiere (Ctrl I).
// Clavier : flèches (tabindex itinérant), Page préc./suiv., Début/Fin, Entrée ou Espace = aperçu, Ctrl Maj C = copier
// le chemin, Maj F10 ou touche Menu = menu contextuel, Échap = vider la sélection.
import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useMagasin } from "../lib/magasin";
import { etatAffiche, progressionMedia, selectionner, TRIS, type Filtre, type Tri } from "../lib/bibliotheque";
import { cadence, codec, definition, dossierAmical, duree, pluriel, quand, taille, typo } from "../lib/format";
import { api, messageErreur, urlMiniature } from "../lib/api";
import type { Media } from "../lib/types";
import { Bouton, BoutonIcone, Icone, Pastille, Segmente } from "../ui/base";
import { Menu, useToast, type ElementMenu } from "../ui/superpositions";
import { CarteMedia, Emplacement } from "../ui/CarteMedia";
import { Miniature } from "../ui/Miniature";
import { Companion } from "../ui/Companion";
import { mouvementReduit } from "../lib/mouvement";
import { RESSORT } from "../lib/motion";
import { flux, socleDisponible, useFluxChoix, vueImport } from "../lib/fluxVue";
import type { OpImport } from "../lib/flux";
import { cloudOuvert, envoiPossible, useCompte } from "../lib/compte";
import { empreinteMedias, vueInstantane } from "../lib/sourceMedias";
import { defilementPour, disposer, disposerListe, hauteurTotale, plage, position, type Disposition } from "../lib/grilleVirtuelle";
import { scannerDisponible } from "../lib/scanner";
import { useScannes, useSourceIndex, registreIndex } from "../lib/sourceIndex";
import { prendreOrigine, type Origine } from "../lib/origineBibliotheque";
import { analyserVisibles } from "../lib/index-medias";
import { analyser } from "../analyse/Analyseur";

const VUES_DEJA_ANIMEES = new Set<string>();
/** Grandes vignettes : 236 px au moins (davantage sur les grands écrans), écarts de 20 × 26 px, miniature 16:9, texte de 50 px. */
const REGLES = { min: 236, ecartX: 20, ecartY: 26, ratio: 0.5625, texte: 50, minCol: 2, maxCol: 10 } as const;
const HAUTEUR_LIGNE = 60;
/** Au-delà de ce nombre de cartes rendues, pas d'animation de mise en page (60 images par seconde d'abord). */
const MAX_FLIP = 60;

function metaLigne(m: Media): string {
  if (m.etat === "erreur") return m.erreur ?? "Fichier illisible";
  const parts = m.type === "audio" ? [duree(m.duree), taille(m.taille)] : m.type === "image" ? [definition(m.largeur, m.hauteur), taille(m.taille)] : [definition(m.largeur, m.hauteur), cadence(m.ips), taille(m.taille)];
  return parts.filter((p) => p && p !== "—").join(" · ");
}

const PAS_PRET = "Le média n'est pas encore prêt.";
/** Média trouvé par AETHRYON Index HORS des dossiers surveillés (le panneau Premiere n'importe que ceux d'index.json). */
export const scanne = (m: Media) => !!m.indexe && !m.indexe.sources.includes("bibliotheque");

/** Menu d'un média (ou d'une sélection) : actions EXISTANTES seulement, groupées (D-SPEC §B.5.4). `cloud` : la section
 *  CLOUD existe (administrateur, cloud ouvert) ; `nuage` : verdict d'envoi de la cible (type accepté, disponible). */
export function elementsMenu(m: Media, n: number, cloud = false, nuage: { ok: boolean; raison: string | null } = { ok: false, raison: null }): ElementMenu[] {
  const dispo = m.etat === "disponible";
  if (n > 1) {
    return [
      { id: "importer", libelle: `Importer ${n} médias dans Premiere`, icone: "import", kbd: "Ctrl I", raccourci: "Control+I" },
      ...(cloud ? [{ id: "cloud", libelle: `Sauvegarder ${n} médias dans le Cloud`, icone: "cloud-up" as const, desactive: !nuage.ok, raison: nuage.raison ?? undefined }] : []),
      { id: "copier", libelle: `Copier ${n} chemins`, icone: "copy", kbd: "Ctrl Maj C", raccourci: "Control+Shift+C" },
      { id: "deselectionner", libelle: "Tout désélectionner", icone: "close", kbd: "Échap", raccourci: "Escape", separateurAvant: true },
    ];
  }
  return [
    { id: "apercu", libelle: "Prévisualiser", icone: "play", kbd: "Entrée", raccourci: "Enter", desactive: !dispo, raison: PAS_PRET },
    { id: "ouvrir", libelle: "Ouvrir", icone: "external", desactive: !dispo, raison: PAS_PRET },
    scanne(m)
      ? { id: "surveiller", libelle: "Surveiller ce dossier (import Premiere)", icone: "folder", separateurAvant: true, desactive: !m.indexe!.dossier }
      : { id: "importer", libelle: "Importer dans Premiere", icone: "import", kbd: "Ctrl I", raccourci: "Control+I", separateurAvant: true, desactive: !dispo, raison: PAS_PRET },
    ...(cloud ? [{ id: "cloud", libelle: "Sauvegarder dans le Cloud", icone: "cloud-up" as const, desactive: !nuage.ok, raison: nuage.raison ?? undefined }] : []),
    { id: "explorateur", libelle: "Afficher dans l'Explorateur", icone: "reveal", separateurAvant: true, desactive: m.etat === "introuvable", raison: "Le fichier a été déplacé ou renommé." },
    { id: "copier", libelle: "Copier le chemin", icone: "copy", kbd: "Ctrl Maj C", raccourci: "Control+Shift+C" },
    { id: "details", libelle: "Détails", icone: "panel", kbd: "Alt Entrée", raccourci: "Alt+Enter", separateurAvant: true },
  ];
}

/** Méta de l'en-tête du menu : « MP4 · 0:12 · 826 Ko ». */
export function metaMenu(m: Media): string {
  return [m.ext.toUpperCase(), m.type !== "image" && m.duree != null ? duree(m.duree) : null, taille(m.taille)].filter(Boolean).join(" · ");
}

const nomFichier = (m: Media) => `${m.nom}.${m.ext}`.toLowerCase();

function lireStockage(cle: string): string | null {
  try { return localStorage.getItem(cle); } catch { return null; }
}
function ecrireStockage(cle: string, v: string): void {
  try { localStorage.setItem(cle, v); } catch { /* stockage indisponible : réglage de session seulement */ }
}

type Place = { cle: string; nom: string; etat: "attente" | "copie" | "echec"; pct: number | null; message?: string | null; op: string };

/** Panneau de détails : le média ciblé (focus ou sélection unique), ou la sélection multiple. */
function Details({ cible, multi, racine, instant, onFermer, onAction }: {
  cible: Media | null;
  multi: Media[] | null;
  racine: string;
  instant?: boolean;
  onFermer: () => void;
  onAction: (id: string, m: Media) => void;
}) {
  const { inst, importer, copierChemins } = useMagasin();
  if (multi) {
    const total = multi.reduce((n, m) => n + m.taille, 0);
    const parType = (["video", "audio", "image"] as const).map((t) => [t, multi.filter((m) => m.type === t).length] as const).filter(([, n]) => n > 0);
    return (
      <aside className="bib-details" data-instant={instant ? "" : undefined} aria-label="Détails de la sélection">
        <BoutonIcone className="bib-details-fermer" nom="close" libelle="Fermer le panneau de détails" taille="sm" onClick={onFermer} />
        <h2>{pluriel(multi.length, "média sélectionné", "médias sélectionnés")}</h2>
        <dl className="meta">
          <dt>Taille</dt><dd>{taille(total)}</dd>
          {parType.map(([t, n]) => <Fragment key={t}><dt>{t === "video" ? "Vidéos" : t === "audio" ? "Audio" : "Images"}</dt><dd>{n}</dd></Fragment>)}
        </dl>
        <div className="bib-details-actions">
          <Bouton variante="primary" icone="import" bloc onClick={() => importer(multi.filter((m) => m.etat === "disponible").map((m) => m.id))}>Importer dans Premiere</Bouton>
          <Bouton icone="copy" bloc onClick={() => copierChemins(multi)}>Copier les chemins</Bouton>
        </div>
      </aside>
    );
  }
  if (!cible || !inst) {
    return (
      <aside className="bib-details" data-instant={instant ? "" : undefined} aria-label="Détails">
        <BoutonIcone className="bib-details-fermer" nom="close" libelle="Fermer le panneau de détails" taille="sm" onClick={onFermer} />
        <div className="bib-details-vide"><Icone nom="panel" taille={26} /><p>{typo("Choisis un média : ses détails s'affichent ici.")}</p></div>
      </aside>
    );
  }
  const m = cible;
  const dispo = m.etat === "disponible";
  const imports = inst.imports.imports[m.id] ?? [];
  const codecs = [codec(m.codecVideo), codec(m.codecAudio)].filter(Boolean).join(" · ");
  return (
    <aside className="bib-details" data-instant={instant ? "" : undefined} aria-label={typo(`Détails de « ${m.nom} »`)}>
      <BoutonIcone className="bib-details-fermer" nom="close" libelle="Fermer le panneau de détails" taille="sm" onClick={onFermer} />
      <Miniature m={m} racine={racine} />
      <div>
        <h2>{m.nom}<span className="c3" style={{ fontFamily: "var(--eg-f-ui)", fontSize: 13 }}>.{m.ext}</span></h2>
        <div style={{ marginTop: 8 }}><Pastille etat={etatAffiche(m, inst.imports.imports)} /></div>
      </div>
      <div className="bib-details-actions">
        {scanne(m)
          ? <Bouton variante="primary" icone="folder" bloc onClick={() => onAction("surveiller", m)} title={typo("Le panneau Premiere importe les médias des dossiers surveillés : surveiller ce dossier rend ce média importable.")}>Surveiller ce dossier</Bouton>
          : <Bouton variante="primary" icone="import" bloc disabled={!dispo} title={dispo ? undefined : PAS_PRET} onClick={() => importer([m.id])}>Importer dans Premiere</Bouton>}
        <div className="row">
          <Bouton icone="play" disabled={!dispo} onClick={() => onAction("apercu", m)} style={{ flex: 1 }}>Prévisualiser</Bouton>
          <BoutonIcone nom="external" libelle="Ouvrir" disabled={!dispo} onClick={() => onAction("ouvrir", m)} />
          <BoutonIcone nom="reveal" libelle="Afficher dans l'Explorateur" disabled={m.etat === "introuvable"} onClick={() => onAction("explorateur", m)} />
          <BoutonIcone nom="copy" libelle="Copier le chemin (Ctrl Maj C)" onClick={() => onAction("copier", m)} />
        </div>
      </div>
      <dl className="meta">
        <dt>Format</dt><dd>{m.ext.toUpperCase()}</dd>
        {m.type !== "image" && <><dt>Durée</dt><dd>{duree(m.duree)}</dd></>}
        {m.type !== "audio" && definition(m.largeur, m.hauteur) && <><dt>Définition</dt><dd>{definition(m.largeur, m.hauteur)}</dd></>}
        {m.type === "video" && cadence(m.ips) && <><dt>Cadence</dt><dd>{cadence(m.ips)}</dd></>}
        {codecs && <><dt>Codecs</dt><dd>{codecs}</dd></>}
        <dt>Taille</dt><dd>{taille(m.taille)}</dd>
        <dt>Ajouté</dt><dd>{typo(quand(m.ajouteLe))}</dd>
        {m.origine.plateforme !== "local" && <><dt>Origine</dt><dd className="ellipsis" title={m.origine.titre ?? undefined}>{[m.origine.plateforme === "youtube" ? "YouTube" : m.origine.plateforme === "tiktok" ? "TikTok" : m.origine.plateforme, m.origine.titre].filter(Boolean).join(" · ")}</dd></>}
        {m.premiereCompatible === false && <><dt>Premiere</dt><dd>À convertir pour Premiere</dd></>}
        {imports.length > 0 && <><dt>Importé</dt><dd>{typo(imports.map((x) => [x.projet, x.chutier].filter(Boolean).join(" › ")).filter(Boolean).join(", ") || "Oui")}</dd></>}
        {m.indexe && <><dt>Source</dt><dd>{typo([m.indexe.sources.includes("bibliotheque") ? "Dossier surveillé" : "Scanné par AETHRYON Index", m.indexe.volume,
          m.indexe.etatFichier === "indisponible" ? "disque débranché" : null, m.indexe.enLigne ? "en ligne seulement (jamais ouvert)" : null, m.indexe.doublons ? `${m.indexe.doublons} doublon(s)` : null].filter(Boolean).join(" · "))}</dd></>}
        <span className="sep" />
        <dt>Chemin</dt><dd className="bib-chemin">{m.chemin}</dd>
      </dl>
    </aside>
  );
}

export function Bibliotheque() {
  const { inst, recherche, setRecherche, ouvrirApercu, importer, copierChemins, actionMedia, rafraichir, aller, filtre, setFiltre } = useMagasin();
  const toast = useToast();
  const cloud = cloudOuvert(useCompte());
  const [tri, setTri] = useState<Tri>("ajout");
  const [vue, setVue] = useState<"grille" | "liste">(() => (lireStockage("aethryon.vue") as "grille" | "liste") || "grille");
  const [details, setDetails] = useState(() => lireStockage("aethryon.details") === "1");
  /** Panneau ouvert au clavier (Alt Entrée) : apparition instantanée. */
  const [detailsClavier, setDetailsClavier] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [ancre, setAncre] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; m: Media; point?: { x: number; y: number }; clavier?: boolean } | null>(null);
  const [nouveaux, setNouveaux] = useState<Record<string, number>>({});
  const [menuTri, setMenuTri] = useState<HTMLElement | null>(null);
  const [largeur, setLargeur] = useState(0);
  /** Plage rendue : ne change qu'en franchissant une ligne (pas à chaque pixel de défilement : un rendu par ligne). */
  const [fenetre, setFenetre] = useState({ debut: 0, fin: 0 });
  /** Fenêtre visible en coordonnées de la grille (lue au défilement, sans rendu). */
  const vueGrille = useRef({ haut: 0, hauteur: 800 });
  const etatsAvant = useRef<Map<string, string> | null>(null);
  const racineBib = useRef<HTMLDivElement>(null);
  const grille = useRef<HTMLDivElement>(null);
  const outils = useRef<HTMLDivElement>(null);
  const cellules = useRef(new Map<string, HTMLDivElement>());
  const positionsAvant = useRef(new Map<string, { x: number; y: number }>());
  const dispositionAvant = useRef("");
  /** Mise en page animée seulement après un geste à la souris (filtre, tri) ou une arrivée de médias ; jamais pendant
   *  la frappe d'une recherche ni pour un changement au clavier (réponse immédiate). */
  const flipDemande = useRef(0);
  const requeteAvant = useRef("");
  const totalAvant = useRef(0);
  const aFocaliser = useRef<string | null>(null);
  const glisser = useFluxChoix((e) => e.glisser);
  const operations = useFluxChoix((e) => e.operations);
  const socle = socleDisponible();
  const animer = useRef(!VUES_DEJA_ANIMEES.has("bibliotheque") && !mouvementReduit());
  const rechercheDifferee = useDeferredValue(recherche);

  useEffect(() => { VUES_DEJA_ANIMEES.add("bibliotheque"); ecrireStockage("aethryon.vue", vue); }, [vue]);
  useEffect(() => { ecrireStockage("aethryon.details", details ? "1" : "0"); }, [details]);

  // Même contenu qu'au rafraîchissement précédent (toutes les 5 s) : même liste, aucun nouveau filtre ni tri.
  const brut = inst?.index.medias ?? [];
  const empreinte = useMemo(() => empreinteMedias(brut), [brut]);
  const stables = useRef<{ e: string; l: typeof brut }>({ e: empreinte, l: brut });
  if (stables.current.e !== empreinte) stables.current = { e: empreinte, l: brut };
  const medias = stables.current.l;
  const sourceInstantane = useMemo(() => vueInstantane(medias, { filtre, recherche: rechercheDifferee, tri }), [medias, filtre, rechercheDifferee, tri]);
  // AETHRYON Index : dès qu'un scan a trouvé des médias, la Bibliothèque lit la bibliothèque UNIFIÉE paginée (dossiers
  // surveillés + médias scannés) ; « Mes dossiers » garde l'instantané (en mémoire, états en direct).
  const scannes = useScannes(scannerDisponible);
  const unifiee = scannerDisponible && scannes > 0;
  const [origine, setOrigine] = useState<Origine>(() => prendreOrigine() ?? "tout");
  const parId = useMemo(() => new Map(medias.map((m) => [m.id, m])), [medias]);
  const sourceIndex = useSourceIndex(unifiee && origine !== "dossiers", { filtre, recherche: rechercheDifferee, tri, origine }, parId);
  const source = unifiee && origine !== "dossiers" && sourceIndex ? sourceIndex : sourceInstantane;
  const choisiSet = useMemo(() => new Set(selection), [selection]);
  const choisis = useMemo(() => selection.map((id) => source.media(id)).filter((m): m is Media => !!m), [selection, source]);

  useEffect(() => {
    const ids = new Set(medias.map((m) => m.id));
    // Les médias scannés (index) ne sont pas dans l'instantané : ils restent choisis tant que l'index les connaît.
    const connu = (id: string) => ids.has(id) || registreIndex.has(id);
    setSelection((s) => (s.every(connu) ? s : s.filter(connu)));
    // « Nouveau » : média devenu disponible pendant que la vue est ouverte (absent ou en cours avant), 6 s.
    const avant = etatsAvant.current;
    etatsAvant.current = new Map(medias.map((m) => [m.id, m.etat]));
    if (!avant) return;
    const t = Date.now();
    const arrives = medias.filter((m) => m.etat === "disponible" && avant.get(m.id) !== "disponible").map((m) => m.id);
    if (arrives.length) setNouveaux((n) => ({ ...n, ...Object.fromEntries(arrives.map((id) => [id, t])) }));
  }, [medias]);
  useEffect(() => {
    const ids = Object.keys(nouveaux);
    if (!ids.length) return;
    const t = window.setTimeout(() => setNouveaux((n) => Object.fromEntries(Object.entries(n).filter(([, le]) => Date.now() - le < 6000))), 6050);
    return () => window.clearTimeout(t);
  }, [nouveaux]);

  // Imports de fichiers déposés : emplacements réservés (fichiers pas encore dans l'index) et progression réelle.
  const imports = operations.filter((o): o is OpImport => o.type === "import");
  const parNom = useMemo(() => new Set(medias.map(nomFichier)), [medias]);
  const emplacements: Place[] = [];
  const pctImport = new Map<string, number | null>();
  for (const o of imports) {
    const v = vueImport(o);
    if (v.courant && v.courant.etape === "copie") pctImport.set(v.courant.nom.toLowerCase(), v.courant.progression);
    for (const f of o.fichiers) {
      const r = o.bilan?.fichiers.find((x) => x.source === f.chemin);
      if (r && r.etat === "echec") emplacements.push({ cle: `${o.lot}:${f.chemin}`, nom: f.nom, etat: "echec", pct: null, message: r.raison, op: o.id });
      else if (o.erreur) emplacements.push({ cle: `${o.lot}:${f.chemin}`, nom: f.nom, etat: "echec", pct: null, message: o.erreur, op: o.id });
      else if (!o.bilan && !parNom.has(f.nom.toLowerCase())) emplacements.push({ cle: `${o.lot}:${f.chemin}`, nom: f.nom, etat: v.courant?.nom === f.nom ? "copie" : "attente", pct: v.courant?.nom === f.nom ? v.courant.progression : null, op: o.id });
    }
  }

  // ---- Virtualisation : largeur de la grille, fenêtre visible (défilement de la page), plage rendue -------------------
  const places = vue === "grille" ? emplacements.length : 0;
  const total = places + source.total;
  // Grandes vignettes : la largeur minimale grandit avec l'écran (3 colonnes à 1 280 px, 5 à 1 920, 6 à 2 560).
  const disp: Disposition = vue === "grille" ? disposer(largeur, { ...REGLES, min: Math.round(REGLES.min + Math.max(0, (largeur - 1000) * 0.06)) }) : disposerListe(largeur, HAUTEUR_LIGNE);
  const colonnes = disp.colonnes;
  const virtuel = useRef({ disp, total, vue });
  virtuel.current = { disp, total, vue };

  useLayoutEffect(() => {
    const el = grille.current;
    if (!el) return;
    setLargeur(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setLargeur(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [details]);

  const mesurerVue = useCallback(() => {
    const g = grille.current;
    const page = g?.closest<HTMLElement>(".page");
    if (!g || !page) return;
    const rp = page.getBoundingClientRect();
    const rg = g.getBoundingClientRect();
    const haut = Math.max(0, rp.top - rg.top);
    const hauteur = Math.max(0, rp.bottom - Math.max(rg.top, rp.top));
    vueGrille.current = { haut, hauteur };
    const v = virtuel.current;
    const p = plage(v.disp, v.total, haut, hauteur, v.vue === "grille" ? 2 : 6);
    setFenetre((f) => (f.debut === p.debut && f.fin === p.fin ? f : p));
    if (racineBib.current) {
      if (page.scrollTop > 8) racineBib.current.dataset.defile = "";
      else delete racineBib.current.dataset.defile;
    }
  }, []);

  useLayoutEffect(() => {
    const g = grille.current;
    const page = g?.closest<HTMLElement>(".page");
    if (!page) return;
    let image: number | null = null;
    const planifier = () => { if (image == null) image = requestAnimationFrame(() => { image = null; mesurerVue(); }); };
    mesurerVue();
    page.addEventListener("scroll", planifier, { passive: true });
    window.addEventListener("resize", planifier);
    return () => { page.removeEventListener("scroll", planifier); window.removeEventListener("resize", planifier); if (image != null) cancelAnimationFrame(image); };
  }, [mesurerVue]);
  // La disposition ou ce qui est au-dessus de la grille change (colonnes, bandeau, requête) : nouvelle mesure.
  useLayoutEffect(() => { mesurerVue(); }, [mesurerVue, total, vue, details, colonnes, disp.pas, inst?.erreursDossiers.length, rechercheDifferee]);

  const debut = Math.min(fenetre.debut, total);
  const fin = Math.min(fenetre.fin, total);
  useEffect(() => { source.charger(Math.max(0, debut - places), Math.max(0, fin - places)); }, [source, debut, fin, places]);
  const visiblesPlage = source.lire(Math.max(0, debut - places), Math.max(0, fin - places));
  // Miniatures PROGRESSIVES des médias scannés visibles : images et pochettes passent devant dans le cœur, les vidéos
  // sont analysées par le WebView2 (une à la fois) ; chaque média n'est demandé qu'une fois par visite.
  const demandees = useRef(new Set<string>());
  const sansMiniature = visiblesPlage.filter((m): m is Media => !!m && scanne(m) && !m.indexe!.miniatureUrl && m.indexe!.etatFichier === "present" && !demandees.current.has(m.id)).map((m) => m.id);
  const cleSansMiniature = sansMiniature.join("|");
  useEffect(() => {
    if (!sansMiniature.length) return;
    const t = window.setTimeout(() => { for (const id of sansMiniature) demandees.current.add(id); void analyserVisibles(sansMiniature.slice(0, 200), analyser).catch(() => {}); }, 250);
    return () => window.clearTimeout(t);
  }, [cleSansMiniature]);
  const rangFocus = focus ? source.rang(focus) : -1;

  // Indices rendus : la plage visible, plus la carte qui a le focus (jamais démontée : le focus clavier reste).
  const rendus: { i: number; m?: Media; place?: Place }[] = [];
  for (let i = debut; i < fin; i++) rendus.push(i < places ? { i, place: emplacements[i] } : { i, m: visiblesPlage[i - debut - Math.max(0, places - debut)] });
  if (rangFocus >= 0 && (rangFocus + places < debut || rangFocus + places >= fin)) {
    const m = source.media(focus!);
    if (m) rendus.push({ i: rangFocus + places, m });
  }
  const premier = source.total > 0 ? source.lire(0, 1)[0] : undefined;
  const focusId = focus && rangFocus >= 0 ? focus : premier?.id ?? null;

  // Animation de mise en page (ressort doux) quand l'ordre change : transform des cellules seulement, 60 au plus.
  const cleRendus = rendus.map((r) => r.m?.id ?? r.place?.cle ?? "").join("|");
  const cleDisposition = `${vue}:${colonnes}:${Math.round(disp.largeurCarte)}`;
  const cleRequete = `${filtre}|${tri}|${rechercheDifferee}`;
  useLayoutEffect(() => {
    const nouvelles = new Map<string, { x: number; y: number }>();
    for (const r of rendus) { const id = r.m?.id ?? r.place?.cle; if (id) nouvelles.set(id, position(disp, r.i)); }
    const arrivee = requeteAvant.current === cleRequete && total > totalAvant.current;
    const voulu = performance.now() - flipDemande.current < 1500 || arrivee;
    flipDemande.current = 0;
    requeteAvant.current = cleRequete;
    totalAvant.current = total;
    if (voulu && dispositionAvant.current === cleDisposition && !mouvementReduit() && nouvelles.size <= MAX_FLIP) {
      for (const [id, p] of nouvelles) {
        const a = positionsAvant.current.get(id);
        const el = cellules.current.get(id);
        if (!a || !el || typeof el.animate !== "function" || (Math.abs(a.x - p.x) < 1 && Math.abs(a.y - p.y) < 1)) continue;
        el.animate([{ transform: `translate(${a.x}px, ${a.y}px)` }, { transform: `translate(${p.x}px, ${p.y}px)` }], { duration: RESSORT.doux.duree, easing: RESSORT.doux.courbe });
      }
    }
    dispositionAvant.current = cleDisposition;
    positionsAvant.current = nouvelles;
  }, [cleRendus, cleDisposition, cleRequete]);

  // Focus clavier demandé vers une carte qui vient d'être rendue.
  useLayoutEffect(() => {
    const id = aFocaliser.current;
    if (!id) return;
    const el = grille.current?.querySelector<HTMLElement>(`[data-media="${id}"]`);
    if (el) { el.focus({ preventScroll: true }); aFocaliser.current = null; }
  });

  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        const c = document.getElementById("recherche-globale") as HTMLInputElement | null;
        c?.focus();
        c?.select();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  if (!inst) return null;
  const d = source.decompte;
  const ciblesAction = (m: Media) => (choisiSet.has(m.id) && choisis.length > 1 ? choisis : [m]);

  const faire = async (id: string, m: Media) => {
    const c = ciblesAction(m);
    if (id === "apercu") ouvrirApercu(m.id);
    else if (id === "ouvrir") await actionMedia(m, "ouvrir");
    else if (id === "importer") {
      const ok = c.filter((x) => x.etat === "disponible" && !scanne(x));
      if (ok.length) await importer(ok.map((x) => x.id));
      if (ok.length < c.length && c.some(scanne)) toast({ etat: "info", titre: "Médias scannés non importés", texte: "Le panneau Premiere importe les médias des dossiers surveillés : « Surveiller ce dossier » les rend importables, ou glisse-les dans Premiere." });
    }
    else if (id === "surveiller" && m.indexe) {
      try {
        await api.dossierAjouter(m.indexe.dossier);
        toast({ etat: "ok", titre: "Dossier surveillé", texte: typo(`${m.indexe.dossier} : ses médias entrent dans la bibliothèque et deviennent importables dans Premiere.`) });
        rafraichir();
      } catch (e) { toast({ etat: "erreur", titre: "Dossier non surveillé", texte: messageErreur(e) }); }
    }
    else if (id === "explorateur") await actionMedia(m, "explorateur");
    else if (id === "copier") await copierChemins(c);
    else if (id === "deselectionner") setSelection([]);
    else if (id === "details") { setDetailsClavier(false); setDetails(true); setFocus(m.id); }
    else if (id === "cloud") {
      try {
        const l = await api.cloudEnvoyer(c.map((x) => x.id));
        toast({ etat: "info", titre: `Envoi vers le Cloud : ${pluriel(l.length, "média", "médias")}`, texte: "Préparation, envoi direct, puis vérification par le serveur avant « Sauvegardé ».", action: { libelle: "Voir", faire: () => aller("cloud") } });
      } catch (e) {
        toast({ etat: "erreur", titre: "Envoi vers le Cloud impossible", texte: messageErreur(e) });
      }
    }
  };
  /** Verdict d'envoi d'une cible du menu (toute la sélection doit être acceptée). */
  const verdictCloud = (m: Media) => {
    for (const x of ciblesAction(m)) {
      const v = envoiPossible(x);
      if (!v.ok) return ciblesAction(m).length > 1 ? { ok: false, raison: `« ${x.nom} » : ${v.raison?.toLowerCase()}` } : v;
    }
    return { ok: true, raison: null };
  };

  const glisserDepuis = (m: Media) => {
    const ids = choisiSet.has(m.id) && choisis.length > 1 ? choisis.filter((x) => x.etat === "disponible").map((x) => x.id) : [m.id];
    flux.glisserMedias(ids).catch((e) => toast({ etat: "erreur", titre: "Glisser impossible", texte: messageErreur(e) }));
  };
  const sources = new Set(glisser?.ids ?? []);
  const ordre = source.ordre ?? [];

  const cliquer = (e: MouseEvent, m: Media) => {
    const mode = e.shiftKey ? "plage" : e.ctrlKey || e.metaKey ? "bascule" : "simple";
    setSelection(selectionner(selection, ordre, m.id, mode, ancre));
    if (mode !== "plage") setAncre(m.id);
    setFocus(m.id);
  };

  /** Déplace le focus vers le rang j : défile d'abord si la carte est hors de la vue (instantané : clavier). */
  const allerA = (j: number, plageDepuis: string | null) => {
    if (source.total === 0) return;
    const k = Math.max(0, Math.min(source.total - 1, j));
    const cible = source.lire(k, k + 1)[0];
    if (!cible) return;
    const page = grille.current?.closest<HTMLElement>(".page");
    if (page && grille.current) {
      // Repère de la grille dans le contenu défilant : G ; fenêtre visible en coordonnées de la grille.
      const rp = page.getBoundingClientRect();
      const rg = grille.current.getBoundingClientRect();
      const G = rg.top - rp.top + page.scrollTop;
      const entete = (outils.current?.offsetHeight ?? 0) + 8;
      const t = defilementPour(disp, k + places, page.scrollTop - G, page.clientHeight, entete);
      if (t != null) page.scrollTop = t + G;
    }
    setFocus(cible.id);
    aFocaliser.current = cible.id;
    if (plageDepuis) setSelection(selectionner(selection, ordre, cible.id, "plage", ancre ?? plageDepuis));
  };

  const clavier = (e: KeyboardEvent, m: Media) => {
    const i = source.rang(m.id);
    const pas = vue === "grille" ? colonnes : 1;
    const parPage = Math.max(1, Math.floor(vueGrille.current.hauteur / disp.pas)) * pas;
    const plageDe = e.shiftKey ? m.id : null;
    if (e.key === "ArrowRight") { e.preventDefault(); allerA(i + 1, plageDe); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); allerA(i - 1, plageDe); }
    else if (e.key === "ArrowDown") { e.preventDefault(); allerA(i + pas, plageDe); }
    else if (e.key === "ArrowUp") { e.preventDefault(); allerA(i - pas, plageDe); }
    else if (e.key === "PageDown") { e.preventDefault(); allerA(i + parPage, plageDe); }
    else if (e.key === "PageUp") { e.preventDefault(); allerA(i - parPage, plageDe); }
    else if (e.key === "Home") { e.preventDefault(); allerA(0, plageDe); }
    else if (e.key === "End") { e.preventDefault(); allerA(source.total - 1, plageDe); }
    else if (e.key === "Enter" && e.altKey) { e.preventDefault(); setDetailsClavier(true); setDetails((x) => !x); }
    else if (e.key === "Enter" || (e.key === " " && !e.ctrlKey)) { e.preventDefault(); if (m.etat === "disponible") ouvrirApercu(m.id); }
    else if (e.ctrlKey && (e.key === "i" || e.key === "I")) { e.preventDefault(); void faire("importer", m); }
    else if (e.ctrlKey && e.shiftKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); void faire("copier", m); }
    else if (e.ctrlKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); setSelection(ordre); }
    else if (e.key === "Escape" && selection.length) { e.preventDefault(); e.stopPropagation(); setSelection([]); }
    else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      setMenu({ el, m, point: { x: r.left + 12, y: r.top + 12 }, clavier: true });
    }
    else if (e.key === " " && e.ctrlKey) { e.preventDefault(); setSelection(selectionner(selection, ordre, m.id, "bascule", ancre)); }
  };

  const ajouterFichiers = async () => {
    try {
      const f = await api.choisirFichiers();
      if (f.length === 0) return;
      const copies = await api.ajouterFichiers(f);
      toast({ etat: "ok", titre: `${pluriel(copies.length, "fichier copié", "fichiers copiés")}`, texte: `Dans ${dossierAmical(inst.config.dossierMedias)}. Ils apparaissent dès qu'ils sont prêts.` });
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: "Ajout impossible", texte: messageErreur(e) });
    }
  };

  // Bibliothèque unifiée : le total est celui de l'index (dossiers surveillés + médias scannés), sans filtre de type.
  const tout = source === sourceInstantane ? medias.length : d.tout;
  const enCours = medias.filter((m) => m.etat === "en-cours").length;
  const aVerifier = medias.filter((m) => m.etat === "erreur" || m.etat === "introuvable").length;
  const cibleDetails = selection.length === 1 ? source.media(selection[0]) ?? null : selection.length === 0 && focus ? source.media(focus) ?? null : null;
  const etroite = largeur > 0 && largeur < 560;

  const carte = (r: { i: number; m?: Media; place?: Place }) => {
    const pos = position(disp, r.i);
    const style = { transform: `translate(${pos.x}px, ${pos.y}px)`, width: vue === "grille" ? disp.largeurCarte : undefined, height: disp.hauteurCarte };
    if (r.place) {
      const e = r.place;
      return (
        <div key={e.cle} className="bib-cellule" style={style} ref={(el) => { if (el) cellules.current.set(e.cle, el); else cellules.current.delete(e.cle); }}>
          <Emplacement nom={e.nom} etat={e.etat} pct={e.pct} message={e.message} onFermer={() => flux.oublier(e.op)} />
        </div>
      );
    }
    const m = r.m;
    if (!m) return <div key={`vide-${r.i}`} className={`bib-cellule${vue === "liste" ? " bib-cellule--liste" : ""}`} style={style} aria-hidden="true"><span className="squelette" /></div>;
    const etat = etatAffiche(m, inst.imports.imports);
    const pi = pctImport.get(nomFichier(m));
    const pct = m.etat === "en-cours" ? (pi !== undefined ? pi : progressionMedia(m, inst.transferts)) : null;
    const choisi = choisiSet.has(m.id);
    // En grille, l'avancement est déjà au centre de la miniature : pas de seconde pastille « En cours ».
    const pastille = scanne(m) ? <Pastille etat={m.indexe!.etatFichier === "present" ? "quiet" : "missing"} libelle={m.indexe!.etatFichier === "indisponible" ? `${(m.indexe!.volume ?? "Disque").replace(/\\$/, "")} débranché` : `Scanné · ${(m.indexe!.volume ?? "index").replace(/\\$/, "")}`} />
      : etat === "available" ? (m.premiereCompatible === false ? <Pastille etat="quiet" libelle="À convertir pour Premiere" /> : null)
      : etat === "running" && vue === "grille" ? null : <Pastille etat={etat} pct={pct != null ? pct * 100 : undefined} />;
    const quandTxt = scanne(m) && m.indexe!.etatFichier === "indisponible" ? "Disque débranché" : m.etat === "en-cours" ? `${taille(m.taille)} reçus` : m.etat === "introuvable" ? "Déplacé ou renommé" : quand(m.ajouteLe);
    return (
      <div key={m.id} className={`bib-cellule${vue === "liste" ? " bib-cellule--liste" : ""}`} style={style} ref={(el) => { if (el) cellules.current.set(m.id, el); else cellules.current.delete(m.id); }}>
        <CarteMedia
          m={m}
          racine={inst.racine}
          vue={vue}
          index={r.i - debut}
          choisi={choisi}
          focusable={m.id === focusId}
          pct={pct}
          pastille={pastille}
          quand={typo(quandTxt)}
          meta={typo(metaLigne(m))}
          colonnes={{ duree: m.type !== "image" ? duree(m.duree) : "—", taille: taille(m.taille) }}
          glissable={socle && m.etat === "disponible"}
          source={sources.has(m.id)}
          nouveau={m.id in nouveaux}
          selectionActive={selection.length > 0}
          animerEntree={animer.current && r.i - debut < 16}
          aria={{ setsize: total, posinset: r.i + 1 }}
          onClick={(e) => cliquer(e, m)}
          onDoubleClick={() => ouvrirApercu(m.id)}
          onKeyDown={(e) => clavier(e, m)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!choisi) setSelection([m.id]);
            setMenu({ el: e.currentTarget as HTMLElement, m, point: { x: e.clientX, y: e.clientY } });
          }}
          onFocus={() => setFocus(m.id)}
          onBascule={() => { setSelection(selectionner(selection, ordre, m.id, "bascule", ancre)); setAncre(m.id); }}
          onVu={() => setNouveaux((n) => { const c = { ...n }; delete c[m.id]; return c; })}
          onGlisser={() => glisserDepuis(m)}
          onApercu={() => ouvrirApercu(m.id)}
          onAction={(a) => (a === "explorateur" ? actionMedia(m, "explorateur") : faire(a, m))}
          onPlus={(el) => setMenu({ el, m })}
        />
      </div>
    );
  };

  return (
    <div className="bib" ref={racineBib} data-details={details ? "" : undefined}>
      <div className="bib-titre">
        <div className="grow">
          <h1 className="t-display-l">Bibliothèque</h1>
          <p className="sub"><b>{pluriel(tout, "média", "médias")}</b>{enCours ? ` · ${enCours} en cours` : ""}{aVerifier ? ` · ${aVerifier} à vérifier` : ""}</p>
        </div>
        {scannerDisponible && <Bouton taille="sm" icone="scan" onClick={() => aller("scanner")}>Scanner mes disques</Bouton>}
        <Bouton taille="sm" icone="plus" onClick={ajouterFichiers}>{etroite ? "Ajouter…" : "Ajouter des fichiers…"}</Bouton>
      </div>

      <div className="bib-outils" ref={outils} onPointerDown={() => { flipDemande.current = performance.now(); }}>
        {unifiee && (
          <Segmente<Origine> libelle="Origine des médias" valeur={origine} onChange={(o) => { setOrigine(o); setSelection([]); }}
            options={[{ id: "tout", libelle: "Tout" }, { id: "dossiers", libelle: "Mes dossiers", n: medias.length }, { id: "scannes", libelle: "Scannés", n: scannes }]} />
        )}
        {etroite ? (
          <label className="select select--etiquette">
            <span className="lbl">Type</span>
            <select className="select--natif" aria-label="Type de média" value={filtre} onChange={(e) => setFiltre(e.target.value as Filtre)}>
              <option value="tout">Tout</option>
              <option value="video">Vidéos</option>
              <option value="audio">Audio</option>
              <option value="image">Images</option>
            </select>
            <Icone nom="chevron-down" taille={14} />
          </label>
        ) : (
          <Segmente<Filtre>
            libelle="Type de média"
            valeur={filtre}
            onChange={setFiltre}
            options={[
              { id: "tout", libelle: "Tout", n: d.tout },
              { id: "video", libelle: "Vidéos", n: d.video },
              { id: "audio", libelle: "Audio", n: d.audio },
              { id: "image", libelle: "Images", n: d.image },
            ]}
          />
        )}
        {recherche.trim() && (
          <span className="bib-requete" role="status">
            <span className="ellipsis">« <b>{recherche.trim()}</b> » · {pluriel(source.total, "résultat", "résultats")}</span>
            <BoutonIcone nom="close" libelle="Effacer la recherche" taille="xs" onClick={() => setRecherche("")} />
          </span>
        )}
        <span className="grow" />
        <button type="button" className="select" aria-haspopup="menu" onClick={(e) => setMenuTri(e.currentTarget)}>
          <span className="lbl">Trier</span> {TRIS.find((t) => t.id === tri)?.libelle}
          <Icone nom="chevron-down" taille={14} />
        </button>
        <BoutonIcone nom="panel" libelle="Panneau de détails (Alt Entrée)" taille="sm" actif={details} aria-pressed={details} onClick={() => { setDetailsClavier(false); setDetails((x) => !x); }} />
        <div className="viewtoggle" role="group" aria-label="Disposition">
          <button type="button" aria-pressed={vue === "grille"} title="Grille" aria-label="Grille" onClick={() => setVue("grille")}><Icone nom="grid" taille={16} /></button>
          <button type="button" aria-pressed={vue === "liste"} title="Liste" aria-label="Liste" onClick={() => setVue("liste")}><Icone nom="list" taille={16} /></button>
        </div>
      </div>

      {inst.erreursDossiers.length > 0 && (
        <div className="bandeau bandeau--erreur" role="alert">
          <Icone nom="alert" taille={16} />
          <span>{typo(`Dossier introuvable : « ${dossierAmical(inst.erreursDossiers[0][0])} ». Il a peut-être été renommé, déplacé ou se trouve sur un disque débranché.`)}</span>
          <Bouton taille="sm" variante="ghost" onClick={() => api.rescanner().then(rafraichir)}>Rechercher à nouveau</Bouton>
        </div>
      )}

      <div className="bib-corps">
        <div style={{ minWidth: 0 }}>
          {vue === "liste" && total > 0 && (
            <div className="bib-liste-tete" aria-hidden="true">
              <span /><span>Nom</span><span>Durée</span><span className="col-fmt">Format</span><span className="col-taille">Taille</span><span>Ajouté</span><span className="col-etat">État</span><span />
            </div>
          )}
          <div ref={grille} className={`bib-grille ${vue === "grille" ? "lib-grid" : "lib-liste"}${selection.length ? " has-selection" : ""}`}
            style={{ height: hauteurTotale(disp, total) }} role="listbox" aria-multiselectable="true" aria-label="Médias" aria-busy={rechercheDifferee !== recherche || undefined}>
            {rendus.map(carte)}
          </div>

          {source.total === 0 && places === 0 && (
            tout === 0 ? (
              <div className="vide bib-vide">
                <Companion lieu="vide" taille={132} />
                <h2 className="t-display-m">La bibliothèque est vide</h2>
                <p>{typo(`Dépose des fichiers sur la fenêtre ou dans « ${dossierAmical(inst.config.dossierMedias)} », envoie-les depuis l'extension AETHRYON, ou ajoute-les ici.`)}</p>
                <div className="vide-actions">
                  <Bouton variante="primary" icone="plus" onClick={ajouterFichiers}>Ajouter des fichiers…</Bouton>
                  <Bouton icone="folder" onClick={() => api.ouvrirDossier("medias")}>Ouvrir le dossier</Bouton>
                  {scannerDisponible && <Bouton icone="scan" onClick={() => aller("scanner")}>Scanner mes disques</Bouton>}
                </div>
              </div>
            ) : (
              <div className="vide">
                <Icone nom="search" taille={28} />
                <h2 className="t-display-m">Aucun résultat</h2>
                <p>{typo(recherche ? `Aucun média ne correspond à « ${recherche} ».` : "Aucun média de ce type.")}</p>
                <div className="vide-actions"><Bouton onClick={() => { setRecherche(""); setFiltre("tout"); }}>Tout afficher</Bouton></div>
              </div>
            )
          )}
        </div>
        {details && <Details cible={cibleDetails} multi={choisis.length > 1 ? choisis : null} racine={inst.racine} instant={detailsClavier} onFermer={() => setDetails(false)} onAction={(id, m) => void faire(id, m)} />}
      </div>

      {choisis.length > 1 && !glisser && (
        <div className="barre-selection" role="region" aria-label="Sélection">
          <span className="tab"><b>{choisis.length}</b> sélectionnés</span>
          <Bouton taille="sm" variante="primary" icone="import" onClick={() => importer(choisis.filter((m) => m.etat === "disponible").map((m) => m.id))}>Importer dans Premiere</Bouton>
          <Bouton taille="sm" icone="copy" onClick={() => copierChemins(choisis)}>Copier les chemins</Bouton>
          <Bouton taille="sm" variante="ghost" onClick={() => setSelection([])}>Tout désélectionner</Bouton>
        </div>
      )}

      {menu && (() => {
        const n = ciblesAction(menu.m).length;
        return (
          <Menu ancre={menu.el} point={menu.point} parClavier={menu.clavier} elements={elementsMenu(menu.m, n, cloud, cloud ? verdictCloud(menu.m) : undefined)} onChoisir={(id) => void faire(id, menu.m)} onFermer={() => setMenu(null)}
            libelle={n > 1 ? `Actions pour ${n} médias` : typo(`Actions pour « ${menu.m.nom} »`)}
            entete={n > 1 ? undefined : { miniature: urlMiniature(inst.racine, menu.m), nom: `${menu.m.nom}.${menu.m.ext}`, meta: metaMenu(menu.m) }} />
        );
      })()}
      {menuTri && (
        <Menu ancre={menuTri} aligne="droite" elements={TRIS.map((t) => ({ id: t.id, libelle: t.libelle, icone: t.id === tri ? "check" : undefined }))}
          onChoisir={(id) => { flipDemande.current = performance.now(); setTri(id as Tri); }} onFermer={() => setMenuTri(null)} />
      )}
    </div>
  );
}
