// Aperçu d'un média dans le panneau : <video> sur le fichier LOCAL (CEP 12 lit le MP4 H.264/AAC), lecture/pause,
// barre de lecture glissable, code temporel, J K L (navette), ← → (image par image), espace ; puis les actions :
// importer, insérer à la tête de lecture (clic explicite), moniteur source, Explorateur, copier le chemin, glisser.

import { useEffect, useRef, useState } from "preact/hooks";
import { contexte, mediasFiltres } from "../../etat/app";
import { etatAffiche, LIBELLE_ETAT, pretPourPremiere, type Media } from "../../lib/bibliotheque";
import { codeTemporel, dateRelative, definition, duree, taille, typo } from "../../lib/format";
import { NOM_PLATEFORME, type Plateforme } from "../../lib/urls";
import { Bouton, BoutonIcone, Icone, Onde, Pastille } from "../composants/base";
import { useApp, useEtat } from "../contexte";

const CODECS: Record<string, string> = { h264: "H.264", hevc: "HEVC", h265: "HEVC", vp9: "VP9", vp8: "VP8", av1: "AV1", prores: "ProRes", aac: "AAC", mp3: "MP3", opus: "Opus", pcm: "PCM" };

export function Apercu({ id, lateral, onFermer }: { id: string; lateral: boolean; onFermer: () => void }) {
  const { actions, hote } = useApp();
  const m = useEtat((e) => e.medias.find((x) => x.id === id));
  const liste = useEtat((e) => e.medias);
  const biblio = useEtat((e) => e.biblio);
  const reglages = useEtat((e) => e.reglages);
  const ctxEtat = useEtat((e) => ({ importes: e.importes, erreurs: e.erreurs, operations: e.operations }));
  const projet = useEtat((e) => e.projet);
  const mini = useEtat((e) => e.miniatures[id]);
  const erreurImport = useEtat((e) => e.erreurs.get(id));
  const racine = useRef<HTMLDivElement>(null);

  // Les touches J K L, espace et flèches ne sont demandées à Premiere que pendant l'aperçu (et rendues ensuite).
  useEffect(() => {
    hote.touchesVoulues([74, 75, 76, 32, 37, 39]);
    racine.current?.focus();
    return () => hote.touchesVoulues([]);
  }, []);

  if (!m) {
    return (
      <aside class={`apercu${lateral ? " apercu--lateral" : ""}`}>
        <div class="apercu__barre">
          <BoutonIcone icone="chevron-left" libelle="Retour à la bibliothèque" onClick={onFermer} />
          <span class="c3">Média disparu de la bibliothèque.</span>
        </div>
      </aside>
    );
  }
  const visibles = mediasFiltres({ medias: liste, biblio, reglages, ...ctxEtat });
  const rang = visibles.findIndex((x) => x.id === id);
  const etat = etatAffiche(m, ctxEtat);
  const pret = pretPourPremiere(m, ctxEtat);
  const aller = (d: number) => {
    const x = visibles[rang + d];
    if (x) actions.majBiblio({ apercuId: x.id, ancre: x.id, selection: new Set([x.id]) });
  };
  const nomChutier = reglages.chutier === "racine" ? "la racine du projet" : reglages.chutier === "selection" ? "le chutier sélectionné" : "le chutier AETHRYON";
  const preuve = reglages.preuves.glisserProjet;

  return (
    <aside
      class={`apercu${lateral ? " apercu--lateral" : ""}`}
      ref={racine}
      tabIndex={-1}
      aria-label={`Aperçu : ${m.nom}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onFermer();
        }
        if (e.altKey && e.key === "ArrowRight") aller(1);
        if (e.altKey && e.key === "ArrowLeft") aller(-1);
      }}
    >
      <div class="apercu__barre">
        {lateral ? <b class="apercu__lib">Aperçu</b> : (
          <button type="button" class="retour" onClick={onFermer}>
            <Icone nom="chevron-left" taille={16} />
            Bibliothèque
          </button>
        )}
        <span class="grow" />
        {rang >= 0 && <span class="c3 micro tab">{rang + 1} sur {visibles.length}</span>}
        <BoutonIcone icone="chevron-left" libelle="Média précédent" desactive={rang <= 0} onClick={() => aller(-1)} />
        <BoutonIcone icone="chevron-right" libelle="Média suivant" desactive={rang < 0 || rang >= visibles.length - 1} onClick={() => aller(1)} />
        {lateral && <BoutonIcone icone="close" libelle="Fermer l’aperçu" onClick={onFermer} />}
      </div>
      <div class="apercu__defile defile">
        <Lecteur m={m} mini={mini} url={actions.urlLocale(m.chemin)} glissable={pret} />
        <div class="apercu__corps">
          <h2 class="apercu__titre">{typo(m.origine?.titre || m.nom)}</h2>
          <div class="apercu__pastilles">
            <Pastille etat={etat} />
            <span class="c3 micro tab">{[(m.ext || "").toUpperCase(), m.duree != null && m.type !== "image" ? duree(m.duree) : null, taille(m.taille)].filter(Boolean).join(" · ")}</span>
          </div>
          {etat === "erreur" && (erreurImport || m.erreur) && (
            <p class="note note--erreur" role="alert">
              <Icone nom="error" taille={16} />
              <span>{typo(erreurImport || m.erreur || "")}</span>
            </p>
          )}
          {m.premiereCompatible === false && (
            <p class="note note--alerte">
              <Icone nom="alert" taille={16} />
              <span>Format absent de la liste d’import de Premiere. Reconvertis-le en MP4 (H.264 + AAC) depuis l’Accueil : il arrivera prêt à importer.</span>
            </p>
          )}
          <Bouton variante="principal" bloc icone="import" desactive={!pret || !projet} raison={!projet ? "Aucun projet ouvert dans Premiere" : "Fichier introuvable ou en cours d’écriture"} onClick={() => void actions.importerMedias([m.id])}>
            {etat === "importe" ? "Importer à nouveau" : "Importer dans le projet"}
          </Bouton>
          <p class="cible petit c3">{projet ? <>dans {nomChutier} · <b>{projet.nom}</b></> : "Aucun projet ouvert dans Premiere."}</p>
          <div class="apercu__actions">
            <Bouton petit icone="frame-fwd" desactive={!pret || !projet?.sequenceActive} raison={!projet?.sequenceActive ? "Aucune séquence active" : "Fichier indisponible"} onClick={() => void actions.insererTeteLecture(m.id)}>
              Insérer à la tête de lecture
            </Bouton>
            <Bouton petit variante="discret" icone="monitor" desactive={!pret} onClick={() => actions.ouvrirMoniteurSource(m.id)}>Moniteur source</Bouton>
            <Bouton petit variante="discret" icone="reveal" desactive={m.etatSource === "introuvable"} onClick={() => actions.afficherDansExplorateur(m.chemin)}>Explorateur</Bouton>
            <Bouton petit variante="discret" icone="copy" onClick={() => actions.copierChemin(m.chemin)}>Copier le chemin</Bouton>
          </div>
          <dl class="kv">
            {m.type === "video" && <Kv k="Vidéo" v={[m.codecVideo ? CODECS[m.codecVideo.toLowerCase()] || m.codecVideo.toUpperCase() : null, definition(m.largeur, m.hauteur), m.ips ? `${Math.round(m.ips)} i/s` : null].filter(Boolean).join(" · ") || "non mesuré"} />}
            {m.type !== "image" && <Kv k="Audio" v={m.codecAudio ? CODECS[m.codecAudio.toLowerCase()] || m.codecAudio.toUpperCase() : "non mesuré"} />}
            {m.type === "image" && <Kv k="Image" v={definition(m.largeur, m.hauteur) || "non mesurée"} />}
            <Kv k="Premiere" v={m.premiereCompatible === false ? "Format non pris en charge" : m.premiereCompatible === true ? "Prêt : importé tel quel" : "Dépend du codec (non mesuré)"} classe={m.premiereCompatible === false ? "st-erreur" : m.premiereCompatible ? "st-importe" : ""} />
            {m.origine?.plateforme && <Kv k="Origine" v={NOM_PLATEFORME[(m.origine.plateforme === "x" ? "twitter" : m.origine.plateforme) as Plateforme] || m.origine.plateforme} />}
            {m.ajouteLe && <Kv k="Ajouté" v={dateRelative(m.ajouteLe)} />}
            <Kv k="Fichier" v={m.chemin} mono />
          </dl>
          <p class="note">
            <Icone nom="drag" taille={16} />
            <span>
              {pret ? "Glisse l’image ci-dessus vers le panneau Projet ou la timeline." : "Glisser possible quand le fichier est complet et présent."}{" "}
              {preuve ? (preuve.ok ? `Glisser prouvé par le diagnostic le ${dateRelative(preuve.le).toLowerCase()}.` : "Le diagnostic n’a pas pu prouver le glisser : utilise « Importer »." ) : "À prouver une fois par le diagnostic (Réglages)."}
            </span>
          </p>
          <span class="sr-only">{LIBELLE_ETAT[etat]}</span>
        </div>
      </div>
    </aside>
  );
}

function Kv({ k, v, mono = false, classe = "" }: { k: string; v: string; mono?: boolean; classe?: string }) {
  return (
    <div class="kv__r">
      <dt>{k}</dt>
      <dd class={`${mono ? "mono" : ""} ${classe}`}>{v}</dd>
    </div>
  );
}

function Lecteur({ m, mini, url, glissable }: { m: Media; mini?: string; url: string; glissable: boolean }) {
  const { actions } = useApp();
  const video = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const [lecture, setLecture] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(m.duree || 0);
  const [muet, setMuet] = useState(false);
  const [boucle, setBoucle] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const navette = useRef({ vitesse: 0, raf: 0, dernier: 0 });
  const ips = m.ips || 30;
  const lisible = (m.type === "video" || m.type === "audio") && m.etatSource !== "introuvable";

  useEffect(() => {
    setErreur(null);
    setT(0);
    setLecture(false);
    return () => cancelAnimationFrame(navette.current.raf);
  }, [m.id]);

  const arreterNavette = () => {
    cancelAnimationFrame(navette.current.raf);
    navette.current.vitesse = 0;
  };

  const basculer = () => {
    const v = video.current;
    if (!v) return;
    arreterNavette();
    v.playbackRate = 1;
    if (v.paused) void v.play().catch((e) => setErreur(String(e?.message || e)));
    else v.pause();
  };

  // Navette arrière (J) : <video> ne lit pas à l'envers, on recule l'image par pas réguliers.
  const reculer = (vitesse: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    navette.current.vitesse = vitesse;
    navette.current.dernier = performance.now();
    const pas = (maintenant: number) => {
      const dt = (maintenant - navette.current.dernier) / 1000;
      navette.current.dernier = maintenant;
      v.currentTime = Math.max(0, v.currentTime - dt * navette.current.vitesse);
      if (v.currentTime > 0 && navette.current.vitesse) navette.current.raf = requestAnimationFrame(pas);
    };
    cancelAnimationFrame(navette.current.raf);
    navette.current.raf = requestAnimationFrame(pas);
  };

  const touche = (e: KeyboardEvent) => {
    const v = video.current;
    if (!v || !lisible || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") {
      e.preventDefault();
      if (k === "k") {
        arreterNavette();
        v.pause();
      } else basculer();
    } else if (k === "l") {
      e.preventDefault();
      arreterNavette();
      v.playbackRate = v.paused ? 1 : Math.min(4, v.playbackRate * 2);
      void v.play();
    } else if (k === "j") {
      e.preventDefault();
      reculer(navette.current.vitesse ? Math.min(4, navette.current.vitesse * 2) : 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      arreterNavette();
      v.pause();
      const pas = (e.shiftKey ? 10 : 1) / ips;
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + (e.key === "ArrowRight" ? pas : -pas)));
    }
  };

  const chercher = (clientX: number) => {
    const v = video.current;
    const barre = scene.current?.querySelector(".lect__barre") as HTMLElement | null;
    if (!v || !barre || !d) return;
    const r = barre.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    v.currentTime = x * d;
    setT(x * d);
  };

  const pointeur = (e: PointerEvent) => {
    if (!d) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    chercher(e.clientX);
    const bouger = (ev: PointerEvent) => chercher(ev.clientX);
    const fin = () => {
      el.removeEventListener("pointermove", bouger);
      el.removeEventListener("pointerup", fin);
    };
    el.addEventListener("pointermove", bouger);
    el.addEventListener("pointerup", fin);
  };

  const ratio = m.largeur && m.hauteur ? m.largeur / m.hauteur : 16 / 9;
  return (
    <div class="lect" ref={scene} onKeyDown={touche}>
      <div
        class={`lect__scene${glissable ? " est-glissable" : ""}`}
        draggable={glissable}
        onDragStart={(e) => {
          if (!e.dataTransfer || !actions.glisser(e.dataTransfer, [m.id])) e.preventDefault();
        }}
        onDragEnd={actions.finGlisser}
        onClick={lisible ? basculer : undefined}
        title={glissable ? "Glisse vers le panneau Projet ou la timeline" : undefined}
      >
        {m.type === "video" && lisible ? (
          <video
            ref={video}
            src={url}
            poster={mini}
            preload="metadata"
            muted={muet}
            loop={boucle}
            playsInline
            style={{ aspectRatio: String(ratio) }}
            onLoadedMetadata={(e) => setD((e.currentTarget as HTMLVideoElement).duration || m.duree || 0)}
            onTimeUpdate={(e) => setT((e.currentTarget as HTMLVideoElement).currentTime)}
            onSeeked={(e) => setT((e.currentTarget as HTMLVideoElement).currentTime)}
            onPlay={() => setLecture(true)}
            onPause={() => setLecture(false)}
            onEnded={() => setLecture(false)}
            onError={() => setErreur("Ce fichier ne se lit pas dans le panneau (codec non pris en charge par le lecteur intégré).")}
          />
        ) : m.type === "audio" ? (
          <div class="lect__audio">
            <Onde graine={m.id} barres={48} />
            {lisible && (
              <audio
                ref={video}
                src={url}
                preload="metadata"
                muted={muet}
                loop={boucle}
                onLoadedMetadata={(e) => setD((e.currentTarget as HTMLAudioElement).duration || m.duree || 0)}
                onTimeUpdate={(e) => setT((e.currentTarget as HTMLAudioElement).currentTime)}
                onPlay={() => setLecture(true)}
                onPause={() => setLecture(false)}
                onError={() => setErreur("Ce son ne se lit pas dans le panneau.")}
              />
            )}
          </div>
        ) : mini ? (
          <img src={m.type === "image" ? url : mini} alt="" draggable={false} />
        ) : (
          <span class="lect__glyphe"><Icone nom={m.etatSource === "introuvable" ? "missing" : "image"} taille={28} /></span>
        )}
        {erreur && <p class="lect__erreur">{erreur}</p>}
        {m.etatSource === "introuvable" && <p class="lect__erreur">Fichier introuvable : il a été déplacé, renommé ou supprimé.</p>}
      </div>
      {lisible && (
        <div class="lect__commandes">
          <div class="lect__barre" onPointerDown={pointeur} role="slider" aria-label="Position de lecture" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)} tabIndex={0}>
            <i class="lect__piste" />
            <i class="lect__lu" style={{ transform: `scaleX(${d ? t / d : 0})` }} />
            <i class="lect__bouton" style={{ left: `${d ? (t / d) * 100 : 0}%` }} />
          </div>
          <div class="lect__ligne">
            <button type="button" class="lect__play" aria-label={lecture ? "Pause" : "Lecture"} title={lecture ? "Pause (K)" : "Lecture (L)"} onClick={basculer}>
              <Icone nom={lecture ? "pause" : "play"} taille={14} />
            </button>
            <span class="lect__tc tab">
              {codeTemporel(t, ips)}
              <span class="c3"> / {codeTemporel(d, ips)}</span>
            </span>
            <span class="grow" />
            <BoutonIcone icone="loop" libelle={boucle ? "Lecture en boucle activée" : "Lire en boucle"} actif={boucle} classe="bi--petit" onClick={() => setBoucle(!boucle)} />
            <BoutonIcone icone={muet ? "volumeoff" : "volume"} libelle={muet ? "Rétablir le son" : "Couper le son"} classe="bi--petit" onClick={() => setMuet(!muet)} />
          </div>
          <p class="lect__aide micro c3">J K L navette · ← → image par image · Espace lecture</p>
        </div>
      )}
    </div>
  );
}
