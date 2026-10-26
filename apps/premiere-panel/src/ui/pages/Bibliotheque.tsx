// Bibliothèque : grille ou liste VIRTUALISÉES (au plus une soixantaine d'éléments dans le DOM), recherche sans accent
// (filtrée après 120 ms), filtres par type, état et source, tri, sélection multiple (Ctrl, Maj, Ctrl A), aperçu dans
// le panneau, import, insertion à la tête de lecture et glisser vers Premiere (fichiers complets et présents seulement).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { contexte, mediasFiltres } from "../../etat/app";
import {
  compter, etatAffiche, LIBELLE_ETAT, LIBELLE_TRI, metaCourte, pretPourPremiere,
  type EtatMedia, type FiltreEtat, type FiltrePlateforme, type FiltreType, type Media, type Tri,
} from "../../lib/bibliotheque";
import { duree, pluriel, typo } from "../../lib/format";
import { Bouton, BoutonIcone, Choix, EtatVide, Icone, IconeEtat, Onde } from "../composants/base";
import { classeLargeur, useApp, useEtat } from "../contexte";
import { Apercu } from "./Apercu";

const TYPES: { valeur: FiltreType; libelle: string }[] = [
  { valeur: "tout", libelle: "Tout" },
  { valeur: "video", libelle: "Vidéos" },
  { valeur: "audio", libelle: "Audios" },
  { valeur: "image", libelle: "Images" },
];

const TRIS = (Object.keys(LIBELLE_TRI) as Tri[]).map((t) => ({ valeur: t, libelle: LIBELLE_TRI[t] }));
const ETATS: { valeur: FiltreEtat; libelle: string }[] = [
  { valeur: "tous", libelle: "Tous les états" },
  ...(["disponible", "importe", "en-cours", "introuvable", "erreur"] as EtatMedia[]).map((e) => ({ valeur: e as FiltreEtat, libelle: LIBELLE_ETAT[e] })),
];
const SOURCES: { valeur: FiltrePlateforme; libelle: string }[] = [
  { valeur: "toutes", libelle: "Toutes les sources" },
  { valeur: "youtube", libelle: "YouTube" },
  { valeur: "tiktok", libelle: "TikTok" },
  { valeur: "twitter", libelle: "X" },
  { valeur: "local", libelle: "Fichiers locaux" },
];

export function Bibliotheque() {
  const { actions } = useApp();
  const largeur = useEtat((e) => e.largeur);
  const apercuId = useEtat((e) => e.biblio.apercuId);
  const lateral = largeur >= 760;
  // Aperçu en plein panneau sous 760 px ; à côté de la grille au-delà (maquette 960 × 700).
  if (apercuId && !lateral) {
    return <Apercu id={apercuId} lateral={false} onFermer={() => actions.majBiblio({ apercuId: null })} />;
  }
  return (
    <div class={`biblio${apercuId && lateral ? " biblio--avec-apercu" : ""}`}>
      <div class="biblio__principal">
        <Barre />
        <Contenu />
        <Pied />
      </div>
      {apercuId && lateral && <Apercu id={apercuId} lateral onFermer={() => actions.majBiblio({ apercuId: null })} />}
    </div>
  );
}

function Barre() {
  const { actions } = useApp();
  const biblio = useEtat((e) => e.biblio);
  const tri = useEtat((e) => e.reglages.tri);
  const medias = useEtat((e) => e.medias);
  const largeur = useEtat((e) => e.largeur);
  const [texte, setTexte] = useState(biblio.recherche);
  const [filtresOuverts, setFiltresOuverts] = useState(biblio.etat !== "tous" || biblio.plateforme !== "toutes");
  const champ = useRef<HTMLInputElement>(null);
  const n = useMemo(() => compter(medias), [medias]);
  const compact = classeLargeur(largeur) === "compact";
  const filtresActifs = biblio.etat !== "tous" || biblio.plateforme !== "toutes";

  // Recherche filtrée après 120 ms (DESIGN-SYSTEM §6) ; la saisie reste immédiate dans le champ.
  useEffect(() => {
    if (texte === biblio.recherche) return;
    const t = setTimeout(() => actions.majBiblio({ recherche: texte }), 120);
    return () => clearTimeout(t);
  }, [texte]);
  useEffect(() => {
    if (biblio.recherche !== texte && biblio.recherche === "") setTexte("");
  }, [biblio.recherche]);
  useEffect(() => {
    const raccourci = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        champ.current?.focus();
        champ.current?.select();
      }
    };
    window.addEventListener("keydown", raccourci);
    return () => window.removeEventListener("keydown", raccourci);
  }, []);

  return (
    <div class="barre">
      <div class="barre__recherche">
        <label class="champ champ--recherche">
          <Icone nom="search" taille={16} classe="c3" />
          <input
            ref={champ}
            type="search"
            placeholder="Rechercher"
            aria-label="Rechercher dans la bibliothèque"
            value={texte}
            onInput={(e) => setTexte((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && texte) {
                e.stopPropagation();
                setTexte("");
                actions.majBiblio({ recherche: "" });
              }
            }}
          />
          {texte && <BoutonIcone icone="close" libelle="Effacer la recherche" classe="bi--petit" onClick={() => { setTexte(""); actions.majBiblio({ recherche: "" }); champ.current?.focus(); }} />}
        </label>
        <BoutonIcone icone="filter" libelle={filtresOuverts ? "Masquer les filtres" : "Filtres : état et source"} actif={filtresOuverts} classe={filtresActifs ? "a-point" : ""} onClick={() => setFiltresOuverts(!filtresOuverts)} />
        {compact && <Choix compact icone="sort" libelle={`Trier : ${LIBELLE_TRI[tri]}`} valeur={tri} options={TRIS} onChange={(v) => actions.changerReglage("tri", v)} />}
      </div>
      {filtresOuverts && (
        <div class="barre__filtres">
          <Choix libelle="Filtrer par état" prefixe={biblio.etat !== "tous" ? "État · " : undefined} valeur={biblio.etat} options={ETATS} onChange={(v) => actions.majBiblio({ etat: v })} />
          <Choix libelle="Filtrer par source" prefixe={biblio.plateforme !== "toutes" ? "Source · " : undefined} valeur={biblio.plateforme} options={SOURCES} onChange={(v) => actions.majBiblio({ plateforme: v })} />
          {filtresActifs && <button type="button" class="lien-texte" onClick={() => actions.majBiblio({ etat: "tous", plateforme: "toutes" })}>Réinitialiser</button>}
        </div>
      )}
      <div class="types" role="tablist" aria-label="Type de média">
        {TYPES.map((t) => (
          <button type="button" role="tab" aria-selected={biblio.type === t.valeur ? "true" : "false"} class={`type${biblio.type === t.valeur ? " est-actif" : ""}`} onClick={() => actions.majBiblio({ type: t.valeur })}>
            {t.libelle}
            {!compact && <span class="type__n tab">{n[t.valeur]}</span>}
          </button>
        ))}
        <span class="grow" />
        {!compact && <Choix libelle="Trier" valeur={tri} options={TRIS} onChange={(v) => actions.changerReglage("tri", v)} />}
      </div>
    </div>
  );
}

function Contenu() {
  const { actions } = useApp();
  const etat = useEtat((e) => ({ medias: e.medias, biblio: e.biblio, reglages: e.reglages, importes: e.importes, erreurs: e.erreurs, operations: e.operations, dossierMedias: e.dossierMedias }));
  const b = etat.biblio;
  const visibles = useMemo(
    () => mediasFiltres(etat),
    [etat.medias, b.recherche, b.type, b.etat, b.plateforme, etat.reglages.tri, etat.importes, etat.erreurs, etat.operations],
  );
  if (!b.chargee) {
    return <div class="biblio__vide"><EtatVide titre="Lecture du dossier…" texte={etat.dossierMedias} /></div>;
  }
  if (b.dossierAbsent && !etat.medias.length) {
    return (
      <div class="biblio__vide">
        <EtatVide
          titre="Dossier des médias introuvable"
          texte={<span class="mono">{etat.dossierMedias}</span>}
          actions={<>
            <Bouton variante="principal" icone="folder" onClick={() => void actions.creerDossierMedias()}>Créer ce dossier</Bouton>
            <Bouton onClick={() => void actions.choisirDossierMedias()}>Choisir un autre dossier…</Bouton>
          </>}
        />
      </div>
    );
  }
  if (!etat.medias.length) {
    return (
      <div class="biblio__vide">
        <EtatVide
          titre="Ta bibliothèque est vide"
          texte="Importe un clip depuis l’Accueil, ou envoie une vidéo vers Premiere depuis l’extension navigateur AETHRYON."
          actions={<Bouton variante="principal" icone="home" onClick={() => actions.naviguer("accueil")}>Importer un clip</Bouton>}
          note={<span class="mono">{etat.dossierMedias}</span>}
        />
      </div>
    );
  }
  if (!visibles.length) {
    return (
      <div class="biblio__vide">
        <EtatVide
          figure={<Icone nom="search" taille={28} classe="c3" />}
          titre="Aucun résultat"
          texte={b.recherche ? `Rien ne correspond à « ${b.recherche} » avec ces filtres.` : "Aucun média ne correspond à ces filtres."}
          actions={<Bouton onClick={() => actions.majBiblio({ recherche: "", type: "tout", etat: "tous", plateforme: "toutes" })}>Tout afficher</Bouton>}
        />
      </div>
    );
  }
  return etat.reglages.vue === "liste" ? <Liste visibles={visibles} /> : <Grille visibles={visibles} />;
}

// ---- Virtualisation ----------------------------------------------------------------------------------------------------
function useTaille(ref: { current: HTMLElement | null }) {
  const [t, setT] = useState({ l: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const maj = () => setT({ l: el.clientWidth, h: el.clientHeight });
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return t;
}

function useDefilement(ref: { current: HTMLElement | null }) {
  const [y, setY] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let prevu = 0;
    const f = () => {
      if (prevu) return;
      prevu = requestAnimationFrame(() => {
        prevu = 0;
        setY(el.scrollTop);
      });
    };
    el.addEventListener("scroll", f, { passive: true });
    return () => el.removeEventListener("scroll", f);
  }, []);
  return y;
}

/** Clavier commun à la grille et à la liste : flèches, Entrée (aperçu), Ctrl A, Ctrl Entrée (importer), Échap. */
function useClavier(visibles: Media[], colonnes: number, defiler: (index: number) => void) {
  const { actions, magasin } = useApp();
  return (e: KeyboardEvent) => {
    const b = magasin.lire().biblio;
    const courant = b.ancre ? visibles.findIndex((m) => m.id === b.ancre) : -1;
    const aller = (i: number) => {
      const j = Math.max(0, Math.min(visibles.length - 1, i));
      const id = visibles[j]!.id;
      actions.selectionner(id, e.shiftKey ? "plage" : "seul", visibles);
      actions.majBiblio({ ancre: e.shiftKey ? b.ancre : id });
      defiler(j);
      requestAnimationFrame(() => (document.querySelector(`[data-id="${id}"]`) as HTMLElement | null)?.focus());
    };
    if (e.key === "ArrowRight") { e.preventDefault(); aller(courant + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); aller(courant - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); aller(courant < 0 ? 0 : courant + colonnes); }
    else if (e.key === "ArrowUp") { e.preventDefault(); aller(courant - colonnes); }
    else if (e.key === "Home") { e.preventDefault(); aller(0); }
    else if (e.key === "End") { e.preventDefault(); aller(visibles.length - 1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      actions.majBiblio({ selection: new Set(visibles.map((m) => m.id)) });
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const ids = b.selection.size ? [...b.selection] : b.ancre ? [b.ancre] : [];
      if (ids.length) void actions.importerMedias(ids);
    } else if (e.key === "Enter" && courant >= 0) {
      e.preventDefault();
      actions.majBiblio({ apercuId: visibles[courant]!.id });
    } else if (e.key === "Escape") {
      if (b.selection.size) actions.majBiblio({ selection: new Set() });
    }
  };
}

const ECART = 10;

function Grille({ visibles }: { visibles: Media[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { l, h } = useTaille(ref);
  const y = useDefilement(ref);
  const vignette = useEtat((e) => e.reglages.vignette);
  const largeurUtile = Math.max(0, l - 20);
  const minimum = 128 + vignette * 180; // 128 à 308 px par tuile selon le curseur du pied
  const colonnes = Math.max(1, Math.floor((largeurUtile + ECART) / (minimum + ECART)));
  const lt = colonnes ? (largeurUtile - ECART * (colonnes - 1)) / colonnes : largeurUtile;
  const hauteurImage = Math.round((lt * 9) / 16);
  const hauteurRangee = hauteurImage + 46 + 14;
  const rangees = Math.ceil(visibles.length / colonnes);
  const premiere = Math.max(0, Math.floor(y / hauteurRangee) - 2);
  const derniere = Math.min(rangees - 1, Math.ceil((y + h) / hauteurRangee) + 2);
  const clavier = useClavier(visibles, colonnes, (i) => {
    const el = ref.current;
    if (!el) return;
    const haut = Math.floor(i / colonnes) * hauteurRangee + 10;
    if (haut < el.scrollTop) el.scrollTop = haut - 6;
    else if (haut + hauteurRangee > el.scrollTop + el.clientHeight) el.scrollTop = haut + hauteurRangee - el.clientHeight + 6;
  });
  const elements = [];
  if (l > 0) {
    for (let r = premiere; r <= derniere; r++) {
      for (let c = 0; c < colonnes; c++) {
        const i = r * colonnes + c;
        const m = visibles[i];
        if (!m) break;
        elements.push(<Tuile key={m.id} m={m} visibles={visibles} style={{ transform: `translate(${10 + c * (lt + ECART)}px, ${10 + r * hauteurRangee}px)`, width: `${lt}px` }} hauteurImage={hauteurImage} />);
      }
    }
  }
  return (
    <div class="defile grille" ref={ref} onKeyDown={clavier} role="grid" aria-label="Médias" aria-rowcount={rangees}>
      <div class="grille__plan" style={{ height: `${rangees * hauteurRangee + 10}px` }}>
        {elements}
      </div>
    </div>
  );
}

function Liste({ visibles }: { visibles: Media[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { h } = useTaille(ref);
  const y = useDefilement(ref);
  const H = 52;
  const premiere = Math.max(0, Math.floor(y / H) - 4);
  const derniere = Math.min(visibles.length - 1, Math.ceil((y + h) / H) + 4);
  const clavier = useClavier(visibles, 1, (i) => {
    const el = ref.current;
    if (!el) return;
    const haut = i * H;
    if (haut < el.scrollTop) el.scrollTop = haut;
    else if (haut + H > el.scrollTop + el.clientHeight) el.scrollTop = haut + H - el.clientHeight;
  });
  const lignes = [];
  for (let i = premiere; i <= derniere; i++) {
    const m = visibles[i];
    if (m) lignes.push(<Ligne key={m.id} m={m} visibles={visibles} style={{ transform: `translateY(${i * H}px)` }} />);
  }
  return (
    <div class="defile liste" ref={ref} onKeyDown={clavier} role="grid" aria-label="Médias" aria-rowcount={visibles.length}>
      <div class="liste__plan" style={{ height: `${visibles.length * H}px` }}>
        {lignes}
      </div>
    </div>
  );
}

// ---- Éléments ----------------------------------------------------------------------------------------------------------------
function useElement(m: Media, visibles: Media[]) {
  const { actions, magasin } = useApp();
  const etat = useEtat((e) => etatAffiche(m, contexte(e)));
  const pret = useEtat((e) => pretPourPremiere(m, contexte(e)));
  const selectionne = useEtat((e) => e.biblio.selection.has(m.id));
  const ancre = useEtat((e) => e.biblio.ancre === m.id);
  const enApercu = useEtat((e) => e.biblio.apercuId === m.id);
  const nbSelection = useEtat((e) => e.biblio.selection.size);
  const mini = useEtat((e) => e.miniatures[m.id]);
  const erreur = useEtat((e) => e.erreurs.get(m.id) || m.erreur);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mini && m.type !== "audio" && m.etatSource !== "introuvable") actions.demanderMiniature(m.id);
  }, [m.id, mini]);
  const clic = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) actions.selectionner(m.id, "basculer", visibles);
    else if (e.shiftKey) actions.selectionner(m.id, "plage", visibles);
    else {
      actions.selectionner(m.id, "seul", visibles);
      actions.majBiblio({ apercuId: m.id });
    }
  };
  const glisser = {
    draggable: pret,
    onDragStart: (e: DragEvent) => {
      const ids = selectionne && nbSelection > 1 ? [...magasin.lire().biblio.selection] : [m.id];
      if (!e.dataTransfer || !actions.glisser(e.dataTransfer, ids)) e.preventDefault();
      else ref.current?.classList.add("est-glisse");
    },
    onDragEnd: () => {
      ref.current?.classList.remove("est-glisse");
      actions.finGlisser();
    },
  };
  return { etat, pret, selectionne, ancre, enApercu, nbSelection, mini, erreur, ref, clic, glisser, actions };
}

function Tuile({ m, visibles, style, hauteurImage }: { m: Media; visibles: Media[]; style: Record<string, string>; hauteurImage: number }) {
  const x = useElement(m, visibles);
  const ext = (m.ext || "").toUpperCase();
  return (
    <div
      ref={x.ref}
      data-id={m.id}
      class={`tuile etat-${x.etat}${x.selectionne ? " est-selectionne" : ""}${x.enApercu ? " est-apercu" : ""}${x.pret ? " est-glissable" : ""}`}
      style={style}
      role="gridcell"
      tabIndex={x.ancre ? 0 : -1}
      aria-selected={x.selectionne ? "true" : "false"}
      aria-label={`${m.nom}, ${LIBELLE_ETAT[x.etat]}`}
      onClick={x.clic}
      onDblClick={() => x.pret && void x.actions.importerMedias([m.id])}
      {...x.glisser}
    >
      <div class="tuile__image" style={{ height: `${hauteurImage}px` }}>
        {x.mini ? <img src={x.mini} alt="" draggable={false} loading="lazy" /> : m.type === "audio" ? <Onde graine={m.id} /> : <span class="tuile__glyphe"><Icone nom={m.type === "image" ? "image" : x.etat === "introuvable" ? "missing" : "film"} taille={22} /></span>}
        <span class="badge badge--format">{ext}</span>
        {m.duree != null && m.type !== "image" && <span class="badge badge--duree tab">{duree(m.duree)}</span>}
        {x.nbSelection > 1 ? (
          <span class={`case${x.selectionne ? " est-cochee" : ""}`} aria-hidden="true">{x.selectionne && <Icone nom="check" taille={12} />}</span>
        ) : x.etat !== "disponible" ? (
          <span class={`badge badge--etat st-${x.etat}`} title={LIBELLE_ETAT[x.etat]}><IconeEtat etat={x.etat} /></span>
        ) : null}
        {x.etat === "en-cours" && <span class="tuile__fil"><i /></span>}
        {x.pret && (
          <span class="tuile__actions">
            <button type="button" class="bi bi--media" aria-label="Aperçu" title="Aperçu" onClick={(e) => { e.stopPropagation(); x.actions.majBiblio({ apercuId: m.id, ancre: m.id }); }}>
              <Icone nom="play" taille={14} />
            </button>
            <span class="grow" />
            <button type="button" class="bi bi--or" aria-label="Importer dans le projet" title="Importer dans le projet" onClick={(e) => { e.stopPropagation(); void x.actions.importerMedias([m.id]); }}>
              <Icone nom="import" taille={14} />
            </button>
          </span>
        )}
      </div>
      <div class="tuile__nom ell" title={m.nom + "." + m.ext}>
        {m.nom}
        <span class="c3">.{m.ext}</span>
      </div>
      <div class="tuile__meta tab">
        <span class="ell grow">{x.etat === "erreur" && x.erreur ? typo(x.erreur) : metaCourte(m).replace(/^[A-Z0-9]+ · /, "")}</span>
        {x.etat !== "disponible" && <span class={`tuile__mot st-${x.etat}`}>{LIBELLE_ETAT[x.etat]}</span>}
      </div>
    </div>
  );
}

function Ligne({ m, visibles, style }: { m: Media; visibles: Media[]; style: Record<string, string> }) {
  const x = useElement(m, visibles);
  return (
    <div
      ref={x.ref}
      data-id={m.id}
      class={`ligne etat-${x.etat}${x.selectionne ? " est-selectionne" : ""}${x.pret ? " est-glissable" : ""}`}
      style={style}
      role="row"
      tabIndex={x.ancre ? 0 : -1}
      aria-selected={x.selectionne ? "true" : "false"}
      aria-label={`${m.nom}, ${LIBELLE_ETAT[x.etat]}`}
      onClick={x.clic}
      onDblClick={() => x.pret && void x.actions.importerMedias([m.id])}
      {...x.glisser}
    >
      <span class="ligne__mini">
        {x.mini ? <img src={x.mini} alt="" draggable={false} /> : m.type === "audio" ? <Onde graine={m.id} barres={16} /> : <Icone nom={m.type === "image" ? "image" : "film"} taille={16} />}
      </span>
      <span class="ligne__texte">
        <span class="ell ligne__nom">{m.nom}<span class="c3">.{m.ext}</span></span>
        <span class={`ell micro tab ${x.etat === "erreur" ? "st-erreur" : "c3"}`}>{x.etat === "erreur" && x.erreur ? typo(x.erreur) : metaCourte(m)}</span>
      </span>
      {x.pret && (
        <button type="button" class="bi bi--or bi--petit ligne__import" aria-label="Importer dans le projet" title="Importer dans le projet" onClick={(e) => { e.stopPropagation(); void x.actions.importerMedias([m.id]); }}>
          <Icone nom="import" taille={14} />
        </button>
      )}
      <span class={`ligne__etat st-${x.etat}`} title={LIBELLE_ETAT[x.etat]}>
        {x.nbSelection > 1 ? <span class={`case${x.selectionne ? " est-cochee" : ""}`} aria-hidden="true">{x.selectionne && <Icone nom="check" taille={12} />}</span> : x.etat !== "disponible" ? <IconeEtat etat={x.etat} /> : null}
      </span>
    </div>
  );
}

function Pied() {
  const { actions, magasin } = useApp();
  const total = useEtat((e) => e.medias.length);
  const importes = useEtat((e) => e.medias.filter((m) => e.importes.has(m.id)).length);
  const selection = useEtat((e) => e.biblio.selection);
  const vue = useEtat((e) => e.reglages.vue);
  const vignette = useEtat((e) => e.reglages.vignette);
  const largeur = useEtat((e) => e.largeur);
  if (selection.size > 1) {
    const prets = magasin.lire().medias.filter((m) => selection.has(m.id) && pretPourPremiere(m, contexte(magasin.lire()))).length;
    return (
      <div class="multibarre" role="toolbar" aria-label="Sélection multiple">
        <span class="multibarre__n">
          {pluriel(selection.size, "sélectionné", "sélectionnés")}
          {prets < selection.size && largeur >= 380 && <span class="c3"> · {prets} prêt{prets > 1 ? "s" : ""}</span>}
        </span>
        <span class="grow" />
        <Bouton petit variante="discret" onClick={() => actions.majBiblio({ selection: new Set() })}>Annuler</Bouton>
        <Bouton petit variante="principal" icone="import" desactive={!prets} raison="Aucun fichier prêt dans la sélection" onClick={() => void actions.importerMedias([...selection])}>
          Importer{largeur >= 380 ? ` (${prets})` : ""}
        </Bouton>
      </div>
    );
  }
  return (
    <div class="pied">
      <span class="ell tab">
        {pluriel(total, "élément")}
        {importes > 0 && largeur >= 330 && ` · ${pluriel(importes, "importé")}`}
      </span>
      <span class="grow" />
      {vue === "grille" && largeur >= 400 && (
        <input class="curseur" type="range" min="0" max="1" step="0.05" value={vignette} aria-label="Taille des vignettes" onInput={(e) => actions.changerReglage("vignette", Number((e.currentTarget as HTMLInputElement).value))} />
      )}
      <div class="vues" role="radiogroup" aria-label="Disposition">
        <BoutonIcone icone="list" libelle="Liste" actif={vue === "liste"} onClick={() => actions.changerReglage("vue", "liste")} />
        <BoutonIcone icone="grid" libelle="Grille" actif={vue === "grille"} onClick={() => actions.changerReglage("vue", "grille")} />
      </div>
    </div>
  );
}
