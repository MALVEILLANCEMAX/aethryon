// Accueil Égide : « Coller un lien » est l'action de la vue (DESIGN_SYSTEM.md § 1), au centre de la coque (la file est
// à droite, dans « Le fil »). L'établi reconnaît la plateforme à la frappe et dit son état RÉEL (catalogue des
// interfaces, lib/plateformes.ts) ; formats en tuiles (Vidéo MP4 H.264, Son MP3) ; un résumé de l'action, puis
// « Convertir » (Entrée). Conversion EXISTANTE par le serveur (même service que le site et l'extension, avec la clé du
// compte relié ; mêmes quotas et refus). Dessous : quatre chiffres RÉELS qui ouvrent la Bibliothèque filtrée et les
// derniers médias. Non relié : rien n'est envoyé, le bouton mène à Paramètres › Compte.
import { useEffect, useRef, useState, type RefObject } from "react";
import { useMagasin } from "../lib/magasin";
import { useCompte } from "../lib/compte";
import { decompter, trier, type Filtre } from "../lib/bibliotheque";
import { dateCarte, dossierAmical, duree, pluriel, taille, typo } from "../lib/format";
import { api, messageErreur } from "../lib/api";
import { useCatalogue } from "../lib/catalogue";
import { detecter, STATUTS, type FormatDesktop, type VuePlateforme } from "../lib/plateformes";
import { scannerDisponible } from "../lib/scanner";
// Les chiffres de l'Accueil comptent les dossiers surveillés : la Bibliothèque s'ouvre sur la même origine.
import { viserOrigine } from "../lib/origineBibliotheque";
import type { Media } from "../lib/types";
import { Bouton, Icone, type NomIcone } from "../ui/base";
import { Miniature } from "../ui/Miniature";
import { Companion, useCompanion } from "../ui/Companion";
import { useToast } from "../ui/superpositions";
import { CataloguePlateformes } from "../ui/CataloguePlateformes";

/** Colonnes des derniers médias (une rangée de cartes), d'après la largeur de la zone de travail. */
function useColonnes(ref: RefObject<HTMLElement>, min = 180, gap = 16): number {
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

const FORMATS: { id: FormatDesktop; nom: string; precision: string; icone: NomIcone }[] = [
  { id: "mp4", nom: "Vidéo MP4", precision: "H.264, prête pour Premiere Pro", icone: "video" },
  { id: "mp3", nom: "Son MP3", precision: "192 kbit/s", icone: "son" },
];

/** Puce de la plateforme reconnue dans l'établi : pictogramme neutre, nom, état (le mot, pas seulement la couleur). */
function PucePlateforme({ pf }: { pf: VuePlateforme }) {
  const s = STATUTS[pf.statut];
  return (
    <span className="eg-pastille acc-plateforme" data-ton={pf.statut === "en-ligne" ? "neutre" : s.ton} aria-label={`Lien ${pf.nom} reconnu : ${s.libelle.toLowerCase()}`}>
      <Icone nom={pf.icone} taille={13} />{pf.nom}{pf.statut !== "en-ligne" && <span className="acc-plateforme-etat">{s.libelle}</span>}
    </span>
  );
}

/** Formats de la plateforme (catalogue) : tous visibles, les indisponibles barrés, leur raison dans le nom accessible. */
function FormatsPlateforme({ pf }: { pf: VuePlateforme }) {
  return (
    <ul className="pf-formats" aria-label={`Formats ${pf.nom}`}>
      {pf.formats.map((f) => (
        <li key={f.id} className="pf-format" data-ok={f.ok ? "" : undefined} title={f.raison ?? undefined} aria-label={f.ok ? `${f.nom} : disponible` : `${f.nom} : indisponible. ${f.raison ?? ""}`}>{f.nom}</li>
      ))}
    </ul>
  );
}

function CollerLien({ onCatalogue }: { onCatalogue: () => void }) {
  const { aller } = useMagasin();
  const compte = useCompte();
  const toast = useToast();
  const companion = useCompanion();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<FormatDesktop>("mp4");
  const [envoi, setEnvoi] = useState(false);
  const [lire, setLire] = useState(false);
  /** Refus du serveur, dit SOUS le champ (validation au plus près) jusqu'à la prochaine saisie. */
  const [refus, setRefus] = useState<string | null>(null);
  const relie = compte?.relie === true;
  const catalogue = useCatalogue(lire || url.length > 0);
  const pf = catalogue ? detecter(url, catalogue) : null;
  const bloque = !!pf && !pf.convertible;
  const formatOk = (f: FormatDesktop) => !pf || pf.formats.find((x) => x.id === f)?.ok !== false;
  // Le format choisi n'existe pas pour cette plateforme : on passe à celui qui existe.
  useEffect(() => {
    if (pf?.convertible && !formatOk(format)) setFormat(format === "mp4" ? "mp3" : "mp4");
  }, [pf?.id, pf?.convertible]);
  const pret = relie && !envoi && url.trim().length > 0 && !bloque && formatOk(format);
  const convertir = async () => {
    if (!pret) return;
    setEnvoi(true);
    setRefus(null);
    try {
      await api.convertirLien(url.trim(), format);
      setUrl("");
      companion.signaler({ type: "succes", famille: "ajout", texte: "Conversion lancée", cible: { section: "transferts" }, cle: `conversion:${Date.now()}` });
      toast({ etat: "ok", titre: "Conversion lancée", texte: typo("Elle avance dans le fil ; le fichier arrive ensuite dans la bibliothèque."), action: { libelle: "Transferts", faire: () => aller("transferts") } });
    } catch (e) {
      companion.signaler({ type: "erreur", texte: "Conversion refusée", cible: { section: "transferts" }, cle: `conversion:${Date.now()}` });
      setRefus(messageErreur(e));
      toast({ etat: "erreur", titre: "Conversion impossible", texte: messageErreur(e) });
    } finally {
      setEnvoi(false);
    }
  };
  const resume = refus ? typo(refus)
    : !relie ? typo("Relie AETHRYON Desktop à ton compte pour convertir un lien (mêmes quotas que l'extension).")
    : bloque ? typo(pf!.raison ?? `${pf!.nom} : ${STATUTS[pf!.statut].libelle.toLowerCase()}.`)
    : typo(`${format === "mp4" ? "MP4, H.264 1080p" : "MP3, 192 kbit/s"}, vidéo entière, vers le dossier des médias`);
  return (
    <form className="conv" aria-label="Coller un lien" onSubmit={(e) => { e.preventDefault(); if (relie) void convertir(); else aller("parametres"); }}>
      <div className="eg-etabli acc-lien" data-etat={refus ? "erreur" : undefined}>
        <span className="eg-etabli-lien" aria-hidden="true"><Icone nom="lien" taille={20} /></span>
        <input className="eg-champ-input" type="url" inputMode="url" value={url} maxLength={2048} autoComplete="off" spellCheck={false}
          placeholder="Colle le lien d'une vidéo" aria-label="Lien de la vidéo à convertir" aria-describedby="acc-note"
          aria-invalid={refus ? true : undefined} onFocus={() => setLire(true)}
          onChange={(e) => { setUrl(e.target.value); setRefus(null); }} onKeyDown={(e) => { if (e.key === "Escape") { setUrl(""); setRefus(null); } }} />
        {pf && <PucePlateforme pf={pf} />}
        {url && <button type="button" className="eg-btn eg-btn--discret eg-btn--petit" onClick={() => { setUrl(""); setRefus(null); }}>Effacer</button>}
      </div>

      {pf && (
        <div className="pf-encart" role="status" data-statut={pf.statut}>
          <Icone nom={pf.icone} taille={18} />
          <div className="pf-encart-texte">
            <b>{pf.nom}<span className="pf-etat" data-ton={STATUTS[pf.statut].ton}><Icone nom={STATUTS[pf.statut].icone} taille={13} />{STATUTS[pf.statut].libelle}</span></b>
            {pf.raison && <span>{typo(pf.raison)}</span>}
            {pf.convertible && pf.formats.some((f) => !f.ok && f.raison) && <span>{typo(pf.formats.find((f) => !f.ok && f.raison)!.raison!)}</span>}
            {pf.attribution && pf.convertible && <span>{typo("Auteur, licence et source sont écrits dans le fichier : cite-les en réutilisant le média.")}</span>}
          </div>
          <FormatsPlateforme pf={pf} />
          {!pf.convertible && <button type="button" className="lien-or" onClick={onCatalogue}>Plateformes compatibles<Icone nom="chevron" taille={14} /></button>}
        </div>
      )}

      <div className="conv-panneau">
        <div className="eg-tuiles conv-tuiles" role="group" aria-label="Format">
          {FORMATS.map((f) => {
            const ok = formatOk(f.id);
            return (
              <button key={f.id} type="button" className="eg-tuile" aria-pressed={format === f.id} disabled={!ok} data-format={f.id}
                title={ok ? undefined : pf?.formats.find((x) => x.id === f.id)?.raison ?? undefined} onClick={() => setFormat(f.id)}>
                <Icone nom={f.icone} taille={20} />
                <b>{f.nom}</b>
                <small>{f.precision}</small>
                <span className="eg-tuile-coche" aria-hidden="true"><Icone nom="ok" taille={11} /></span>
              </button>
            );
          })}
        </div>
        <div className="conv-action">
          <p className={`acc-note${refus || bloque ? " acc-note--erreur" : ""}`} id="acc-note" aria-live="polite">{resume}</p>
          {relie
            ? <Bouton variante="primary" taille="lg" icone="convert" type="submit" kbd={pret ? "Entrée" : undefined} occupe={envoi} disabled={!pret}>{envoi ? "Envoi…" : "Convertir"}</Bouton>
            : <Bouton variante="primary" taille="lg" icone="user" type="submit">Relier mon compte</Bouton>}
        </div>
      </div>
    </form>
  );
}

function Stat({ n, libelle, icone, filtre }: { n: number; libelle: string; icone: NomIcone; filtre: Filtre }) {
  const { aller } = useMagasin();
  return (
    <button type="button" className="acc-stat" onClick={() => { viserOrigine("dossiers"); aller("bibliotheque", { filtre }); }}>
      <span className="acc-stat-ico" aria-hidden="true"><Icone nom={icone} taille={18} /></span>
      <span className="acc-stat-texte">
        <span className="acc-stat-n">{n}</span>{" "}
        <span className="acc-stat-l">{libelle}</span>
        <span className="eg-vh"> : ouvrir la bibliothèque</span>
      </span>
    </button>
  );
}

function CarteRecente({ m, racine, onOuvrir }: { m: Media; racine: string; onOuvrir: () => void }) {
  const meta = [m.type !== "image" && m.duree != null ? duree(m.duree) : null, taille(m.taille), dateCarte(m.ajouteLe)].filter(Boolean) as string[];
  return (
    <button type="button" className="acc-carte" onClick={onOuvrir}>
      <span className="acc-carte-media">
        <Miniature m={m} racine={racine} />
        <span className="acc-jouer" aria-hidden="true"><Icone nom="play" taille={18} /></span>
      </span>
      <span className="acc-carte-titre ellipsis"><span className="eg-vh">Prévisualiser </span>{m.nom}</span>
      <span className="acc-carte-meta">{meta.map((x) => <span key={x}>{typo(x)}</span>)}</span>
    </button>
  );
}

export function Accueil() {
  const { inst, aller, ouvrirApercu, rafraichir } = useMagasin();
  const toast = useToast();
  const recents = useRef<HTMLDivElement>(null);
  const colonnes = useColonnes(recents);
  const [catalogue, setCatalogue] = useState(false);
  if (!inst) return null;
  const medias = inst.index.medias;
  const d = decompter(medias);
  const rangees = typeof window !== "undefined" && window.innerHeight >= 1080 ? 2 : 1;
  const derniers = trier(medias.filter((m) => m.etat === "disponible"), "ajout").slice(0, colonnes * rangees);

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
      <section className="acc-hero" aria-labelledby="acc-titre">
        <div className="acc-tete">
          <h1 className="acc-titre" id="acc-titre">Coller un lien</h1>
          <button type="button" className="lien-or" onClick={() => setCatalogue(true)}>Plateformes compatibles<Icone nom="chevron" taille={14} /></button>
        </div>
        <CollerLien onCatalogue={() => setCatalogue(true)} />
      </section>

      <div className="acc-section-tete">
        <h2 id="acc-biblio">Ta bibliothèque</h2>
        {scannerDisponible && <Bouton variante="ghost" taille="sm" icone="scan" onClick={() => aller("scanner")}>Scanner mes disques</Bouton>}
        <Bouton variante="ghost" taille="sm" icone="library" onClick={() => aller("bibliotheque")}>Explorer la bibliothèque</Bouton>
      </div>
      <div className="acc-stats" role="group" aria-labelledby="acc-biblio">
        <Stat n={d.tout} libelle="Dans la bibliothèque" icone="biblio" filtre="tout" />
        <Stat n={d.video} libelle={d.video > 1 ? "Vidéos" : "Vidéo"} icone="video" filtre="video" />
        <Stat n={d.audio} libelle={d.audio > 1 ? "Pistes audio" : "Piste audio"} icone="son" filtre="audio" />
        <Stat n={d.image} libelle={d.image > 1 ? "Images" : "Image"} icone="image" filtre="image" />
      </div>

      <section aria-labelledby="acc-recents">
        <div className="acc-section-tete">
          <h2 id="acc-recents">Récemment ajoutés</h2>
          {derniers.length > 0 && <button type="button" className="lien-or" onClick={() => aller("bibliotheque", { filtre: "tout" })}>Voir tout<Icone nom="chevron" taille={14} /></button>}
        </div>
        <div ref={recents}>
          {derniers.length > 0 ? (
            <div className="acc-recents" style={{ ["--cols" as string]: colonnes }}>
              {derniers.map((m) => <CarteRecente key={m.id} m={m} racine={inst.racine} onOuvrir={() => ouvrirApercu(m.id)} />)}
            </div>
          ) : (
            <div className="acc-vide">
              <Companion lieu="vide" taille={64} />
              <h2>Ta bibliothèque attend ses premiers médias</h2>
              <p>{typo(`Colle un lien ci-dessus, dépose des fichiers sur la fenêtre ou dans « ${dossierAmical(inst.config.dossierMedias)} ».`)}</p>
              <div className="acc-actions">
                <Bouton icone="plus" onClick={ajouterFichiers}>Ajouter des fichiers…</Bouton>
                <Bouton variante="ghost" icone="folder" onClick={() => api.ouvrirDossier("medias")}>Ouvrir le dossier</Bouton>
              </div>
            </div>
          )}
        </div>
      </section>
      {catalogue && <CataloguePlateformes onFermer={() => setCatalogue(false)} />}
    </div>
  );
}
