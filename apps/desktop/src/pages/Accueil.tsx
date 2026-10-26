// Accueil « Nocturne » : tableau de bord multimédia. Une présentation forte (titre-signature, la chouette en
// profondeur qui suit le pointeur et regarde le champ), « Coller un lien » comme action principale (conversion
// EXISTANTE par le serveur, avec la clé du compte relié), l'accès à la Bibliothèque et au scanner (seulement s'il est
// présent dans la construction), les transferts en cours, quatre chiffres RÉELS qui ouvrent la Bibliothèque filtrée et
// les derniers médias en grandes cartes. Peu de texte secondaire : l'état de Premiere est dans l'en-tête.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMagasin } from "../lib/magasin";
import { useCompte } from "../lib/compte";
import { decompter, trier, type Filtre } from "../lib/bibliotheque";
import { dateCarte, dossierAmical, duree, pluriel, taille, typo } from "../lib/format";
import { api, messageErreur } from "../lib/api";
import { plateformeDe } from "../lib/lien";
import { progressionTransferts } from "../lib/companion";
import { scannerDisponible } from "../lib/scanner";
// Les chiffres de l'Accueil comptent les dossiers surveillés : la Bibliothèque s'ouvre sur la même origine.
import { viserOrigine } from "../lib/origineBibliotheque";
import type { Media } from "../lib/types";
import { Bouton, Icone, Progression, Segmente } from "../ui/base";
import type { NomIcone } from "../ui/traces";
import { Miniature } from "../ui/Miniature";
import { Companion, useCompanion } from "../ui/Companion";
import { useToast } from "../ui/superpositions";

/** Taille de la chouette d'après la largeur de la présentation (une seule mesure, au redimensionnement). */
function useTailleChouette(ref: RefObject<HTMLElement>): number {
  const [t, setT] = useState(200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const l = e.contentRect.width;
      setT(l >= 1240 ? 248 : l >= 960 ? 210 : l >= 880 ? 184 : l >= 760 ? 124 : 104);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return t;
}

/** Colonnes des derniers médias (une rangée de grandes cartes). */
function useColonnes(ref: RefObject<HTMLElement>, min = 210, gap = 20): number {
  const [c, setC] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setC(Math.max(2, Math.min(6, Math.floor((e.contentRect.width + gap) / (min + gap))))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min, gap]);
  return c;
}

/**
 * « Coller un lien » : même serveur que le site et l'extension, avec la clé du compte relié (mêmes quotas et refus) ;
 * vidéo MP4 (H.264 pour Premiere) ou audio MP3. L'avancement réel est dans Transferts, le fichier arrive ensuite dans la
 * bibliothèque. Non relié : rien n'est envoyé ; le bouton mène à Paramètres › Compte.
 */
function CollerLien({ onFocus, onReconnu }: { onFocus: (f: boolean) => void; onReconnu: () => void }) {
  const { aller } = useMagasin();
  const compte = useCompte();
  const toast = useToast();
  const companion = useCompanion();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [envoi, setEnvoi] = useState(false);
  /** Refus du serveur, dit SOUS le champ (validation au plus près) jusqu'à la prochaine saisie. */
  const [refus, setRefus] = useState<string | null>(null);
  const relie = compte?.relie === true;
  const plateforme = plateformeDe(url);
  // La chouette hoche la tête quand un lien devient reconnaissable (une fois par lien).
  const reconnu = useRef<string | null>(null);
  useEffect(() => {
    if (plateforme && reconnu.current !== url.trim()) { reconnu.current = url.trim(); onReconnu(); }
    if (!plateforme) reconnu.current = null;
  }, [plateforme, url, onReconnu]);
  const convertir = async () => {
    if (!relie || envoi || !url.trim()) return;
    setEnvoi(true);
    setRefus(null);
    try {
      await api.convertirLien(url.trim(), format);
      setUrl("");
      companion.signaler({ type: "succes", famille: "ajout", texte: "Conversion lancée", cible: { section: "transferts" }, cle: `conversion:${Date.now()}` });
      toast({ etat: "ok", titre: "Conversion lancée", texte: typo("Suivez-la dans Transferts : le fichier arrivera ensuite dans la bibliothèque."), action: { libelle: "Voir", faire: () => aller("transferts") } });
    } catch (e) {
      companion.signaler({ type: "erreur", texte: "Conversion refusée", cible: { section: "transferts" }, cle: `conversion:${Date.now()}` });
      setRefus(messageErreur(e));
      toast({ etat: "erreur", titre: "Conversion impossible", texte: messageErreur(e) });
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <form className="acc-formulaire" aria-label="Coller un lien" onSubmit={(e) => { e.preventDefault(); if (relie) void convertir(); else aller("parametres"); }}>
      <div className="acc-lien" data-etat={refus ? "erreur" : undefined}>
        <Icone nom="link" taille={18} />
        <input type="url" inputMode="url" value={url} maxLength={2048} autoComplete="off" spellCheck={false}
          placeholder="Lien YouTube, TikTok ou X" aria-label="Lien de la vidéo à convertir" aria-describedby="acc-note"
          onFocus={() => onFocus(true)} onBlur={() => onFocus(false)}
          aria-invalid={refus ? true : undefined}
          onChange={(e) => { setUrl(e.target.value); setRefus(null); }} onKeyDown={(e) => { if (e.key === "Escape") { setUrl(""); setRefus(null); } }} />
        {plateforme && <span className="acc-plateforme" aria-label={`Lien ${plateforme} reconnu`}>{plateforme}</span>}
        <Segmente<"mp4" | "mp3"> libelle="Format" valeur={format} onChange={setFormat} options={[{ id: "mp4", libelle: "Vidéo" }, { id: "mp3", libelle: "Audio" }]} />
        {relie
          ? <Bouton variante="primary" taille="lg" icone="convert" type="submit" occupe={envoi} disabled={envoi || !url.trim()}>{envoi ? "Envoi…" : "Convertir"}</Bouton>
          : <Bouton variante="primary" taille="lg" icone="user" type="submit">Relier mon compte</Bouton>}
      </div>
      <p className={`acc-note${refus ? " acc-note--erreur" : ""}`} id="acc-note" aria-live="polite">
        {refus ? typo(refus) : relie
          ? typo(format === "mp4" ? "MP4 H.264, prêt pour Premiere Pro · suivi dans Transferts." : "MP3 · suivi dans Transferts.")
          : typo("Reliez AETHRYON Desktop à votre compte pour convertir un lien (mêmes quotas que l'extension).")}
      </p>
    </form>
  );
}

function Stat({ n, libelle, icone, filtre }: { n: number; libelle: string; icone: NomIcone; filtre: Filtre }) {
  const { aller } = useMagasin();
  return (
    <button type="button" className="acc-stat" onClick={() => { viserOrigine("dossiers"); aller("bibliotheque", { filtre }); }} aria-label={`${n} ${libelle} : ouvrir la bibliothèque`}>
      <span className="acc-stat-texte">
        <span className="acc-stat-n">{n}</span>
        <span className="acc-stat-l">{libelle}</span>
      </span>
      <span className="acc-stat-ico" aria-hidden="true"><Icone nom={icone} taille={18} /></span>
    </button>
  );
}

function CarteRecente({ m, racine, onOuvrir }: { m: Media; racine: string; onOuvrir: () => void }) {
  const meta = [m.type !== "image" && m.duree != null ? duree(m.duree) : null, taille(m.taille), dateCarte(m.ajouteLe)].filter(Boolean).join(" · ");
  return (
    <button type="button" className="acc-carte" onClick={onOuvrir} aria-label={typo(`Prévisualiser « ${m.nom} »`)}>
      <span style={{ position: "relative", display: "block" }}>
        <Miniature m={m} racine={racine} />
        <span className="acc-jouer" aria-hidden="true"><Icone nom="play" taille={18} /></span>
      </span>
      <span style={{ display: "block", minWidth: 0 }}>
        <span className="acc-carte-titre ellipsis" style={{ display: "block" }}>{m.nom}</span>
        <span className="acc-carte-meta ellipsis" style={{ display: "block" }}>{typo(meta)}</span>
      </span>
    </button>
  );
}

export function Accueil() {
  const { inst, aller, ouvrirApercu, rafraichir } = useMagasin();
  const toast = useToast();
  const hero = useRef<HTMLElement>(null);
  const recents = useRef<HTMLDivElement>(null);
  const tailleChouette = useTailleChouette(hero);
  const colonnes = useColonnes(recents);
  const [champActif, setChampActif] = useState(false);
  const [hochement, setHochement] = useState(0);
  const hocher = useCallback(() => setHochement((n) => n + 1), []);
  if (!inst) return null;
  const medias = inst.index.medias;
  const d = decompter(medias);
  const rangees = typeof window !== "undefined" && window.innerHeight >= 1080 ? 2 : 1;
  const derniers = trier(medias.filter((m) => m.etat === "disponible"), "ajout").slice(0, colonnes * rangees);
  const actifs = inst.transferts.filter((t) => t.etat === "telechargement" || t.etat === "conversion");
  const enAttente = inst.transferts.filter((t) => t.etat === "attente").length;
  const pct = progressionTransferts(inst);

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

  return (
    <div className="acc">
      <section className="acc-hero" ref={hero} aria-labelledby="acc-titre">
        <h1 className="acc-titre" id="acc-titre"><span>Vos médias.</span><span>Votre univers.</span></h1>
        <div className="acc-chouette">
          <Companion lieu="accueil" taille={tailleChouette} zoneSuivi={hero} regard={champActif ? { x: -1.3, y: 0.7 } : null} hochement={hochement} />
        </div>
        <CollerLien onFocus={setChampActif} onReconnu={hocher} />
        <div className="acc-actions">
          <Bouton icone="library" onClick={() => aller("bibliotheque")}>Explorer la bibliothèque</Bouton>
          {scannerDisponible && <Bouton icone="scan" onClick={() => aller("scanner")}>Scanner mes disques</Bouton>}
        </div>
      </section>

      {actifs.length + enAttente > 0 && (
        <button type="button" className="carte-n acc-encours" onClick={() => aller("transferts")}>
          <Icone nom="download" taille={18} style={{ color: "var(--ae-gold)" }} />
          <span className="acc-encours-texte">
            {actifs.length > 0 ? <><b>{pluriel(actifs.length, "transfert", "transferts")}</b>{typo(` en cours${pct != null ? ` · ${Math.round(pct * 100)} %` : ""}`)}</> : null}
            {enAttente > 0 ? typo(`${actifs.length > 0 ? " · " : ""}${pluriel(enAttente, "en attente", "en attente")}`) : null}
          </span>
          <Progression valeur={pct} libelle={pct != null ? `Transferts : ${Math.round(pct * 100)} %` : "Transferts en cours"} />
          <span className="lien-or">Transferts<Icone nom="arrow-right" taille={14} /></span>
        </button>
      )}

      <div className="acc-stats" role="group" aria-label="Votre bibliothèque">
        <Stat n={d.tout} libelle="Dans la bibliothèque" icone="library" filtre="tout" />
        <Stat n={d.video} libelle={d.video > 1 ? "Vidéos" : "Vidéo"} icone="film" filtre="video" />
        <Stat n={d.audio} libelle={d.audio > 1 ? "Pistes audio" : "Piste audio"} icone="note" filtre="audio" />
        <Stat n={d.image} libelle={d.image > 1 ? "Images" : "Image"} icone="image" filtre="image" />
      </div>

      <section aria-labelledby="acc-recents">
        <div className="acc-section-tete">
          <h2 id="acc-recents">Récemment ajoutés</h2>
          {derniers.length > 0 && <button type="button" className="lien-or" onClick={() => aller("bibliotheque", { filtre: "tout" })}>Voir tout<Icone nom="arrow-right" taille={14} /></button>}
        </div>
        <div ref={recents}>
          {derniers.length > 0 ? (
            <div className="acc-recents" style={{ ["--cols" as string]: colonnes }}>
              {derniers.map((m) => <CarteRecente key={m.id} m={m} racine={inst.racine} onOuvrir={() => ouvrirApercu(m.id)} />)}
            </div>
          ) : (
            <div className="acc-vide">
              <span className="acc-vide-ico" aria-hidden="true"><Icone nom="sparkle" taille={22} /></span>
              <div className="acc-vide-texte">
                <h2>Votre bibliothèque attend ses premiers médias</h2>
                <p>{typo(`Collez un lien ci-dessus, déposez des fichiers sur la fenêtre ou dans « ${dossierAmical(inst.config.dossierMedias)} ».`)}</p>
              </div>
              <div className="acc-actions">
                <Bouton icone="plus" onClick={ajouterFichiers}>Ajouter des fichiers…</Bouton>
                <Bouton variante="ghost" icone="folder" onClick={() => api.ouvrirDossier("medias")}>Ouvrir le dossier</Bouton>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
