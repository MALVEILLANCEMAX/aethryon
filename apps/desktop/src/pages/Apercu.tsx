// Aperçu d'un média : lecteur intégré (WebView2 : <video>, <audio>, <img> servis par le protocole asset, limité aux
// dossiers surveillés) et inspecteur. Clavier : Espace (lecture), J K L (navette), ← → (image par image), Ctrl I
// (importer), Ctrl Maj C (copier le chemin), Échap (retour). Les formats que WebView2 ne lit pas sont dits tels quels.
import { useCallback, useEffect, useRef, useState, type PointerEvent as PE } from "react";
import { useMagasin } from "../lib/magasin";
import { etatAffiche, filtrer, trier } from "../lib/bibliotheque";
import { codeTemporel, codec, cadence, definition, dossierAmical, nombre, quandPhrase, taille, typo } from "../lib/format";
import { api, messageErreur, urlFichier, urlMiniature } from "../lib/api";
import { registreIndex } from "../lib/sourceIndex";
import { indexApi } from "../lib/index-medias";
import { useToast } from "../ui/superpositions";
import type { Media } from "../lib/types";
import { Bouton, BoutonIcone, Icone, Kbd, Pastille } from "../ui/base";

const CHUTIERS: Record<string, string> = { aethryon: "AETHRYON", selection: "sélectionné", racine: "racine du projet" };

function Lecteur({ m }: { m: Media }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const survolVideo = useRef<HTMLVideoElement>(null);
  const canevas = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0);
  const [total, setTotal] = useState(m.duree ?? 0);
  const [lecture, setLecture] = useState(false);
  const [boucle, setBoucle] = useState(false);
  const [muet, setMuet] = useState(false);
  const [erreur, setErreur] = useState(false);
  const [survol, setSurvol] = useState<number | null>(null);
  const recul = useRef<number | undefined>(undefined);
  const media = (): HTMLMediaElement | null => video.current ?? audio.current;
  const ips = m.ips ?? null;
  const pas = 1 / (ips && ips > 0 ? ips : 30);

  const basculer = useCallback(() => {
    const e = media();
    if (!e) return;
    window.clearInterval(recul.current);
    if (e.paused) e.play().catch(() => setErreur(true));
    else e.pause();
  }, []);

  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      const cible = ev.target as HTMLElement;
      if (cible.closest("input, select, textarea, .menu, .voile")) return;
      const e = media();
      if (!e) return;
      if (ev.key === " " || ev.key === "k" || ev.key === "K") {
        ev.preventDefault();
        if (ev.key === " ") basculer();
        else { window.clearInterval(recul.current); e.pause(); }
      } else if (ev.key === "l" || ev.key === "L") {
        window.clearInterval(recul.current);
        e.playbackRate = e.paused ? 1 : Math.min(4, e.playbackRate * 2);
        e.play().catch(() => setErreur(true));
      } else if (ev.key === "j" || ev.key === "J") {
        // Lecture arrière : Chromium ne lit pas à vitesse négative ; on recule par pas de 1/10 s.
        e.pause();
        window.clearInterval(recul.current);
        recul.current = window.setInterval(() => {
          if (e.currentTime <= 0) window.clearInterval(recul.current);
          e.currentTime = Math.max(0, e.currentTime - 0.1);
        }, 100);
      } else if (ev.key === "ArrowRight" && !ev.ctrlKey) {
        ev.preventDefault();
        e.pause();
        e.currentTime = Math.min(e.duration || 0, e.currentTime + pas);
      } else if (ev.key === "ArrowLeft" && !ev.ctrlKey) {
        ev.preventDefault();
        e.pause();
        e.currentTime = Math.max(0, e.currentTime - pas);
      }
    };
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      window.clearInterval(recul.current);
    };
  }, [basculer, pas]);

  const positionner = (ev: PE<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (total || 0);
  };

  useEffect(() => {
    const v = survolVideo.current;
    if (survol == null || !v || !canevas.current) return;
    const dessiner = () => canevas.current?.getContext("2d")?.drawImage(v, 0, 0, 128, 72);
    v.addEventListener("seeked", dessiner, { once: true });
    if (!v.seeking) v.currentTime = survol;
    return () => v.removeEventListener("seeked", dessiner);
  }, [survol]);

  const src = urlFichier(m.chemin);
  const p = total > 0 ? t / total : 0;
  const bande = useRef<HTMLCanvasElement>(null);
  const [bandePrete, setBandePrete] = useState(false);
  useEffect(() => {
    if (m.type !== "video") return;
    let fini = false;
    const v = document.createElement("video");
    v.muted = true;
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.onloadedmetadata = async () => {
      const c = bande.current;
      const d = v.duration;
      if (!c || !Number.isFinite(d) || !v.videoWidth) return;
      const echelle = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * echelle);
      c.height = Math.round(c.clientHeight * echelle);
      const x = c.getContext("2d");
      if (!x) return;
      const n = 8;
      const l = c.width / n;
      for (let i = 0; i < n && !fini; i++) {
        await new Promise<void>((r) => { v.onseeked = () => r(); v.currentTime = (d * (i + 0.5)) / n; });
        const e = Math.max(l / v.videoWidth, c.height / v.videoHeight);
        const sl = l / e;
        const sh = c.height / e;
        x.drawImage(v, (v.videoWidth - sl) / 2, (v.videoHeight - sh) / 2, sl, sh, i * l, 0, l, c.height);
      }
      if (!fini) setBandePrete(true);
    };
    v.src = src;
    return () => {
      fini = true;
      v.removeAttribute("src");
      v.load();
    };
  }, [m.id, m.type, src]);
  const ev = {
    onTimeUpdate: (e: { currentTarget: HTMLMediaElement }) => setT(e.currentTarget.currentTime),
    onSeeked: (e: { currentTarget: HTMLMediaElement }) => setT(e.currentTarget.currentTime),
    onLoadedMetadata: (e: { currentTarget: HTMLMediaElement }) => Number.isFinite(e.currentTarget.duration) && setTotal(e.currentTarget.duration),
    onPlay: () => setLecture(true),
    onPause: () => setLecture(false),
    onError: () => setErreur(true),
  };

  return (
    <>
    <div className="player">
      <div className="stage" ref={scene} onClick={m.type !== "image" ? basculer : undefined}>
        {m.type === "video" && !erreur && <video ref={video} src={src} loop={boucle} muted={muet} playsInline preload="metadata" {...ev} />}
        {m.type === "audio" && !erreur && (
          <div className="scene-audio"><Icone nom="audio" taille={40} /><audio ref={audio} src={src} loop={boucle} muted={muet} preload="metadata" {...ev} /></div>
        )}
        {m.type === "image" && !erreur && <img src={src} alt={m.nom} onError={() => setErreur(true)} />}
        {erreur && (
          <div className="scene-erreur">
            <Icone nom="alert" taille={22} />
            <p>{typo("Le lecteur intégré (WebView2) ne lit pas ce fichier : codec ou conteneur non pris en charge. « Ouvrir » le confie à l'application de Windows ; Premiere Pro peut l'importer s'il le prend en charge.")}</p>
          </div>
        )}
      </div>
      {m.type !== "image" && (
        <div className="ctl">
          <div
            className="scrub"
            style={{ ["--p" as string]: `${p * 100}%`, ["--h" as string]: survol != null && total ? `${(survol / total) * 100}%` : "0%" }}
            role="slider"
            tabIndex={0}
            aria-label="Position de lecture"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(t)}
            aria-valuetext={codeTemporel(t, ips)}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const el = media();
              if (el) el.currentTime = positionner(e);
            }}
            onPointerMove={(e) => {
              setSurvol(positionner(e));
              if (e.buttons === 1) {
                const el = media();
                if (el) el.currentTime = positionner(e);
              }
            }}
            onPointerLeave={() => setSurvol(null)}
          >
            <span className="tr" />
            <span className="pl" />
            {survol != null && <span className="hl" />}
            <span className="kn" />
            {survol != null && (
              <span className="hv">
                {m.type === "video" && <canvas ref={canevas} width={128} height={72} />}
                <span>{codeTemporel(survol, ips)}</span>
              </span>
            )}
          </div>
          {m.type === "video" && <video ref={survolVideo} src={src} crossOrigin="anonymous" muted preload="auto" className="cache" aria-hidden="true" />}
          <div className="ctl-row">
            <button type="button" className="playbtn" aria-label={lecture ? "Pause (Espace)" : "Lecture (Espace)"} onClick={basculer}><Icone nom={lecture ? "pause" : "play"} taille={16} /></button>
            <BoutonIcone nom="frame-back" libelle="Image précédente (←)" taille="sm" onClick={() => { const e = media(); if (e) { e.pause(); e.currentTime = Math.max(0, e.currentTime - pas); } }} />
            <BoutonIcone nom="frame-fwd" libelle="Image suivante (→)" taille="sm" onClick={() => { const e = media(); if (e) { e.pause(); e.currentTime = Math.min(total, e.currentTime + pas); } }} />
            <span className="tc">{codeTemporel(t, ips)} <span>/ {codeTemporel(total, ips)}</span></span>
            <span className="grow" />
            <BoutonIcone nom="loop" libelle="Lecture en boucle" taille="sm" actif={boucle} aria-pressed={boucle} onClick={() => setBoucle(!boucle)} />
            <BoutonIcone nom="volume" libelle={muet ? "Rétablir le son" : "Couper le son"} taille="sm" actif={!muet} aria-pressed={!muet} onClick={() => setMuet(!muet)} />
            {m.type === "video" && <BoutonIcone nom="expand" libelle="Plein écran" taille="sm" onClick={() => scene.current?.requestFullscreen?.().catch(() => {})} />}
          </div>
        </div>
      )}
    </div>
    {m.type === "video" && !erreur && (
      <div
        className={`strip${bandePrete ? "" : " strip--attente"}`}
        style={{ ["--p" as string]: `${p * 100}%` }}
        aria-hidden="true"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const el = media();
          if (el && total) el.currentTime = ((e.clientX - r.left) / r.width) * total;
        }}
      >
        <canvas ref={bande} />
        <span className="ph" />
      </div>
    )}
    </>
  );
}

/** Média scanné (AETHRYON Index) : le cœur ouvre CE fichier au protocole asset: (un à la fois), puis le lecteur commun. */
function LecteurIndex({ m }: { m: Media }) {
  const [chemin, setChemin] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    indexApi.apercu(m.id).then((c) => { if (vivant) setChemin(c); }).catch((e) => { if (vivant) setErreur(messageErreur(e)); });
    return () => { vivant = false; };
  }, [m.id]);
  if (erreur) return <div className="player"><div className="stage"><p className="t-small c2" style={{ padding: 24 }}>{typo(erreur)}</p></div></div>;
  if (!chemin) return <div className="player"><div className="stage" aria-busy="true" /></div>;
  return <Lecteur m={{ ...m, chemin }} />;
}

export function Apercu({ id }: { id: string }) {
  const { inst, ouvrirApercu, importer, copierChemins, actionMedia, recherche, rafraichir } = useMagasin();
  const toast = useToast();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, .voile, .menu")) return;
      const m = inst?.index.medias.find((x) => x.id === id) ?? registreIndex.get(id);
      if (!m) return;
      if (e.ctrlKey && !e.shiftKey && (e.key === "i" || e.key === "I")) { e.preventDefault(); if (m.etat === "disponible" && !m.indexe?.sources.every((s) => s !== "bibliotheque")) importer([m.id]); }
      else if (e.ctrlKey && e.shiftKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); copierChemins([m]); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [id, inst, importer, copierChemins]);
  if (!inst) return null;
  const liste = trier(filtrer(inst.index.medias, "tout", recherche), "ajout");
  const i = liste.findIndex((x) => x.id === id);
  const m = liste[i] ?? inst.index.medias.find((x) => x.id === id) ?? registreIndex.get(id);
  const scanne = !!m?.indexe && !m.indexe.sources.includes("bibliotheque");
  if (!m) {
    return (
      <div className="vide">
        <h1 className="t-display-m">Ce média n'est plus dans la bibliothèque</h1>
        <div className="vide-actions"><Bouton onClick={() => ouvrirApercu(null)}>Retour à la bibliothèque</Bouton></div>
      </div>
    );
  }
  const etat = etatAffiche(m, inst.imports.imports);
  const imp = inst.imports.imports[m.id]?.[0];
  const b = inst.liaison.panneau;
  const projet = b?.projetOuvert && b.projet ? `${b.projet}.prproj` : null;
  const dispo = m.etat === "disponible";
  const video = [codec(m.codecVideo), definition(m.largeur, m.hauteur)].filter(Boolean).join(" · ");
  const origine = scanne ? `scanné par AETHRYON Index${m.indexe?.volume ? ` (${m.indexe.volume})` : ""}` : m.origine.plateforme === "local" ? "dossier surveillé" : `extension navigateur (${m.origine.plateforme})`;
  const dossier = m.chemin.replace(/[\\/][^\\/]*$/, "");

  return (
    <>
      <div className="crumbs">
        <BoutonIcone nom="chevron-left" libelle="Retour à la bibliothèque (Échap)" taille="sm" onClick={() => ouvrirApercu(null)} />
        <button type="button" className="crumbs-lien" onClick={() => ouvrirApercu(null)}>Bibliothèque</button>
        <Icone nom="chevron-right" taille={14} />
        <b className="ellipsis">{m.nom}</b>
        <span className="grow" />
        {i >= 0 && <span className="t-small c3 tab">{i + 1} sur {liste.length}</span>}
        <BoutonIcone nom="chevron-left" libelle="Média précédent" taille="sm" disabled={i <= 0} onClick={() => ouvrirApercu(liste[i - 1].id)} />
        <BoutonIcone nom="chevron-right" libelle="Média suivant" taille="sm" disabled={i < 0 || i >= liste.length - 1} onClick={() => ouvrirApercu(liste[i + 1].id)} />
      </div>
      <div className="pv">
        <div>
          {dispo ? (scanne ? <LecteurIndex key={m.id} m={m} /> : <Lecteur key={m.id} m={m} />) : (
            <div className="player"><div className="stage">{urlMiniature(inst.racine, m) && <img src={urlMiniature(inst.racine, m)!} alt="" style={{ opacity: 0.4 }} />}</div></div>
          )}
          <div className="keys">
            <span><Kbd>Espace</Kbd> lecture</span>
            <span><Kbd>J</Kbd><Kbd>K</Kbd><Kbd>L</Kbd> navette</span>
            <span><Kbd><Icone nom="arrow-left" taille={12} /></Kbd><Kbd><Icone nom="arrow-right" taille={12} /></Kbd> image par image</span>
            <span><Kbd>Ctrl I</Kbd> importer dans Premiere</span>
          </div>
        </div>
        <aside className="insp">
          <div className="it"><h1 className="t-display-m" title={`${m.nom}.${m.ext}`}>{m.nom}</h1></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <Pastille etat={etat} grande />
            <span className="t-small c3">{etat === "imported" ? typo(`Importé${imp?.projet ? ` dans ${imp.projet}` : ""}${imp?.chutier ? ` · chutier ${imp.chutier}` : ""}`) : dispo ? "Pas encore importé" : m.etat === "en-cours" ? "Fichier encore en réception" : m.etat === "introuvable" ? "Déplacé, renommé ou supprimé" : m.erreur}</span>
          </div>
          <div className="ia">
            {scanne ? (
              <Bouton variante="primary" icone="folder" bloc onClick={async () => {
                try { await api.dossierAjouter(m.indexe!.dossier); toast({ etat: "ok", titre: "Dossier surveillé", texte: typo(`${m.indexe!.dossier} : ses médias deviennent importables dans Premiere.`) }); rafraichir(); }
                catch (e) { toast({ etat: "erreur", titre: "Dossier non surveillé", texte: messageErreur(e) }); }
              }}>Surveiller ce dossier</Bouton>
            ) : <Bouton variante="primary" icone="import" bloc disabled={!dispo} onClick={() => importer([m.id])}>Importer dans Premiere</Bouton>}
{!scanne &&             <div className="target"><Icone nom="folder" taille={14} />dans le chutier <b>{CHUTIERS[inst.config.chutierParDefaut]}</b>{projet ? ` · ${projet}` : inst.liaison.connecte ? " · aucun projet ouvert" : " · panneau non ouvert"}</div>}
            <div className="row">
              <Bouton icone="external" taille="sm" style={{ flex: 1 }} disabled={!dispo} onClick={() => actionMedia(m, "ouvrir")}>Ouvrir</Bouton>
              <Bouton icone="reveal" taille="sm" style={{ flex: 2 }} disabled={m.etat === "introuvable"} onClick={() => actionMedia(m, "explorateur")}>Afficher dans l'Explorateur</Bouton>
              <BoutonIcone nom="copy" libelle="Copier le chemin (Ctrl Maj C)" taille="sm" onClick={() => copierChemins([m])} />
            </div>
          </div>
          {m.premiereCompatible === true && (
            <div className="ready"><Icone nom="check" taille={16} /><div><div className="rt">Prêt pour Premiere</div><div className="rd">{typo(m.codecVideo || m.codecAudio ? `${[codec(m.codecVideo), codec(m.codecAudio)].filter(Boolean).join(" et ")} : importé tel quel, sans conversion.` : "Format de la liste d'import de Premiere : importé tel quel.")}</div></div></div>
          )}
          {m.premiereCompatible === false && (
            <div className="ready ready--non"><Icone nom="alert" taille={16} /><div><div className="rt">Non importable tel quel</div><div className="rd">{typo(`${[m.ext.toUpperCase(), codec(m.codecVideo), codec(m.codecAudio)].filter(Boolean).join(", ")} : hors de la liste d'import de Premiere. AETHRYON ne propose pas encore de conversion.`)}</div></div></div>
          )}
          {m.premiereCompatible == null && (
            <div className="ready ready--inconnu"><Icone nom="info" taille={16} /><div><div className="rt">Compatibilité non mesurée</div><div className="rd">Les codecs de ce fichier n'ont pas pu être lus sans le décoder.</div></div></div>
          )}
          <dl className="meta">
            {m.type !== "image" && <><dt>Durée</dt><dd>{m.duree != null ? codeTemporel(m.duree, m.ips) : "Non mesurée"}</dd></>}
            {m.type === "video" && <><dt>Vidéo</dt><dd>{video || "Non mesurée"}{cadence(m.ips) ? <><br />{cadence(m.ips)}</> : null}</dd></>}
            {m.type === "image" && <><dt>Définition</dt><dd>{definition(m.largeur, m.hauteur) ?? "Non mesurée"}</dd></>}
            {m.type !== "image" && <><dt>Audio</dt><dd>{codec(m.codecAudio) ?? (m.type === "video" ? "Aucune piste ou non mesuré" : "Non mesuré")}</dd></>}
            {m.duree && m.type !== "image" ? <><dt>Débit</dt><dd>{typo(`${nombre(Math.round((m.taille * 8) / m.duree / 1000))} kbit/s en moyenne`)}</dd></> : null}
            <dt className="sep-avant">Taille</dt><dd className="sep-avant">{taille(m.taille)} <span className="c3">({nombre(m.taille)} octets)</span></dd>
            <dt>Ajouté</dt><dd>{typo(`${quandPhrase(m.ajouteLe).replace(/^./, (c) => c.toUpperCase())} · ${origine}`)}</dd>
            {m.origine.titre && <><dt>Titre</dt><dd>{m.origine.titre}</dd></>}
            <dt>Dossier</dt><dd className="mono ellipsis" style={{ fontSize: 11.5 }} title={dossier}>{dossier}</dd>
            <dt>{scanne ? "Dossier" : "Surveillé"}</dt><dd>{scanne ? "Non surveillé" : dossierAmical(dossier)}</dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
