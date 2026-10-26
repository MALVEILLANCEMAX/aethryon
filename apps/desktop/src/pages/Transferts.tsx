// Transferts (Nocturne) : une interface de SUIVI, états RÉELS seulement. Trois sources :
//  - les conversions que CE Desktop reçoit lui-même (« Coller un lien », relais « Envoyer vers › Premiere Pro ») :
//    progression, octets reçus et débit MESURÉS par le cœur ; « Annuler » à toute étape, « Pause » et « Reprendre »
//    pendant la réception du fichier (reprise par plage d'octets, noyau/src/conversion.rs) ;
//  - les transferts écrits par l'hôte Native Messaging pour l'extension (`R\transferts\<id>.json`, contrat §6) :
//    suivis, jamais pilotés d'ici ;
//  - les téléchargements du navigateur repérés dans le dossier surveillé (`.crdownload`, `.part`) : seule la taille
//    reçue est connue, la progression est donc indéterminée (et dite comme telle).
// Aucun bouton pour une fonction qui n'existe pas : pas de pause pour le navigateur ni pendant la conversion serveur.
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import "../styles/transferts.css";
import { useMagasin } from "../lib/magasin";
import { noeuds, type Pipeline } from "../lib/pipeline";
import { Companion } from "../ui/Companion";
import { Menu, useToast, type ElementMenu } from "../ui/superpositions";
import { estAujourdhui, heureCourte, pluriel, taille, typo } from "../lib/format";
import { api, messageErreur } from "../lib/api";
import type { Instantane, Media, Transfert } from "../lib/types";
import { Bouton, BoutonIcone, Icone, IconeEtat } from "../ui/base";
import { Miniature } from "../ui/Miniature";
import { Couverture } from "../ui/Couverture";

interface Ligne {
  cle: string;
  nom: string;
  media: Media | null;
  transfert: Transfert | null;
}

const PLATEFORMES: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", x: "X" };

function nomMedia(m: Media) {
  return `${m.nom}.${m.ext}`;
}

/** Débit lisible (« 3,2 Mo/s ») : seulement une mesure du cœur, jamais une estimation. */
export function debit(octetsParSeconde: number | null | undefined): string | null {
  return octetsParSeconde && octetsParSeconde > 0 ? `${taille(octetsParSeconde)}/s` : null;
}

/** Cinq nœuds reliés par des connecteurs ; l'état est aussi écrit en texte (aria-label et libellés). */
function VuePipeline({ p }: { p: Pipeline }) {
  return (
    <ol className="pipeline" aria-label={typo(p.aria)}>
      {p.noeuds.map((n, i) => (
        <li key={n.cle} className="pn" data-etat={n.etat}>
          {i > 0 && (
            <span className="pc" data-etat={n.etat} aria-hidden="true">
              <i style={n.progression != null && n.etat === "en-cours" ? { transform: `scaleX(${Math.max(0, Math.min(1, n.progression))})` } : undefined}
                className={n.etat === "en-cours" && n.progression == null ? "comete" : undefined} />
            </span>
          )}
          <span className="pn-point" aria-hidden="true">{n.etat === "fait" ? <IconeEtat etat="ok" taille={8} /> : n.etat === "erreur" ? "!" : null}</span>
          <span className="pn-lbl">{n.libelle}</span>
          {n.detail && <span className="pn-detail">{typo(n.detail)}</span>}
          {n.etat === "en-cours" && n.progression == null && <span className="indet-txt">en cours</span>}
        </li>
      ))}
    </ol>
  );
}

/** Ce qui est mesuré pour une ligne active : fraction (ou null), octets, débit, étape lisible. */
function mesures(l: Ligne) {
  const t = l.transfert;
  const m = l.media;
  if (!t) {
    return { frac: null, etape: "Téléchargement du navigateur", octets: m ? `${taille(m.taille)} reçus · taille finale inconnue` : null, vitesse: null, pause: false };
  }
  const pause = !!t.pause && t.etat === "telechargement";
  const frac = t.etat === "telechargement" || t.etat === "conversion" ? t.progression ?? null : null;
  const etape = t.etat === "attente" ? "En attente" : t.etat === "conversion" ? "Conversion sur le serveur" : pause ? "En pause" : "Réception du fichier";
  const octets = t.recus != null && t.etat === "telechargement"
    ? (t.total ? `${taille(t.recus)} sur ${taille(t.total)}` : `${taille(t.recus)} reçus`)
    : t.etat === "telechargement" && m ? `${taille(m.taille)} reçus` : null;
  return { frac, etape, octets, vitesse: pause || t.etat !== "telechargement" ? null : debit(t.vitesse), pause };
}

/** Bilan réel des transferts actifs, pour l'en-tête : moyenne des progressions connues, débit et octets cumulés. */
function bilan(actives: Ligne[]) {
  const connues = actives.map((l) => mesures(l).frac).filter((f): f is number => f != null);
  const vitesse = actives.reduce((s, l) => s + (l.transfert && !l.transfert.pause && l.transfert.etat === "telechargement" ? l.transfert.vitesse ?? 0 : 0), 0);
  const recus = actives.reduce((s, l) => s + (l.transfert?.etat === "telechargement" ? l.transfert.recus ?? 0 : 0), 0);
  return { moyenne: connues.length ? connues.reduce((a, b) => a + b, 0) / connues.length : null, vitesse: debit(vitesse), recus: recus > 0 ? taille(recus) : null };
}

function lignesDe(inst: Instantane): Ligne[] {
  const parNom = new Map(inst.index.medias.map((m) => [nomMedia(m).toLowerCase(), m]));
  const lignes: Ligne[] = inst.transferts.map((t) => ({
    cle: `t-${t.id}`,
    nom: t.fichierAttendu ?? t.titre ?? "Transfert",
    transfert: t,
    media: (t.chemin ? inst.index.medias.find((m) => m.chemin === t.chemin) : null) ?? (t.fichierAttendu ? parNom.get(t.fichierAttendu.toLowerCase()) ?? null : null),
  }));
  const relies = new Set(lignes.map((l) => l.media?.id).filter(Boolean));
  for (const m of inst.index.medias) {
    if (m.etat === "en-cours" && !relies.has(m.id)) lignes.push({ cle: `m-${m.id}`, nom: nomMedia(m), media: m, transfert: null });
  }
  return lignes;
}

function Vignette({ l, racine, pct }: { l: Ligne; racine: string; pct?: number | null }) {
  const t = l.transfert;
  return (
    <div className="xfp-vignette">
      {l.media ? <Miniature m={l.media} racine={racine} badges={false} pct={pct ?? null} />
        : <div className="thumb"><Couverture m={{ nom: l.nom, type: t?.format === "mp3" ? "audio" : "video" }} taille={20} /></div>}
      {t?.plateforme && PLATEFORMES[t.plateforme] && <span className="xfp-plateforme">{PLATEFORMES[t.plateforme]}</span>}
    </div>
  );
}

export default function Transferts() {
  const { inst, importer, actionMedia, rafraichir, ouvrirApercu, demandes, etatsVus, aller } = useMagasin();
  const toast = useToast();
  const [menu, setMenu] = useState<{ el: HTMLElement; l: Ligne; point?: { x: number; y: number }; clavier?: boolean } | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const lignes = useMemo(() => (inst ? lignesDe(inst) : []), [inst]);
  // Cartes présentes à l'ouverture : elles arrivent avec la page ; seules les NOUVELLES entrent en fondu.
  const connues = useRef<Set<string> | null>(null);
  if (connues.current == null && inst) connues.current = new Set(lignes.map((l) => l.cle));
  if (!inst) return null;
  const pilotables = new Set(inst.transfertsPilotables ?? []);
  const enCours = lignes.filter((l) => (l.transfert ? !l.transfert.etat.match(/^(pret|erreur)$/) : true));
  const termines = lignes.filter((l) => l.transfert && /^(pret|erreur)$/.test(l.transfert.etat));
  const aujourdhui = termines.filter((l) => estAujourdhui(l.transfert!.majLe));
  const anciens = termines.filter((l) => !estAujourdhui(l.transfert!.majLe));
  const actifs = enCours.filter((l) => !l.transfert || l.transfert.etat !== "attente").length;
  const attente = enCours.length - actifs;
  const erreurs = termines.filter((l) => l.transfert!.etat === "erreur" && l.transfert!.code !== "annule").length;
  const b = bilan(enCours);

  const effacer = async () => {
    try {
      const n = await api.transfertsEffacer();
      toast({ etat: "ok", titre: n > 1 ? `${n} transferts effacés` : n === 1 ? "1 transfert effacé" : "Aucun transfert terminé" });
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: "Effacement impossible", texte: messageErreur(e) });
    }
  };

  const piloter = async (l: Ligne, action: "pause" | "reprendre" | "annuler") => {
    if (!l.transfert) return;
    setOccupe(`${l.transfert.id}:${action}`);
    try {
      await api.transfertPiloter(l.transfert.id, action);
      if (action === "annuler") toast({ etat: "info", titre: "Transfert annulé", texte: typo(`« ${l.nom} » : le fichier partiel est supprimé.`) });
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: action === "annuler" ? "Annulation impossible" : action === "pause" ? "Pause impossible" : "Reprise impossible", texte: messageErreur(e) });
    } finally {
      setOccupe(null);
    }
  };

  const elementsMenu = (l: Ligne): ElementMenu[] => {
    const m = l.media;
    const t = l.transfert;
    const e: ElementMenu[] = [];
    if (m && m.etat === "disponible") {
      e.push({ id: "ouvrir", libelle: "Ouvrir le média", icone: "play", kbd: "Entrée", raccourci: "Enter" });
      e.push({ id: "importer", libelle: "Importer dans Premiere", icone: "import" });
    }
    if (m && m.etat !== "introuvable") e.push({ id: "explorateur", libelle: "Afficher dans l'Explorateur", icone: "reveal" });
    if (t && pilotables.has(t.id)) {
      if (t.etat === "telechargement") e.push(t.pause ? { id: "reprendre", libelle: "Reprendre", icone: "play", separateurAvant: e.length > 0 } : { id: "pause", libelle: "Mettre en pause", icone: "pause", separateurAvant: e.length > 0 });
      e.push({ id: "annuler", libelle: "Annuler le transfert", icone: "close", separateurAvant: t.etat !== "telechargement" && e.length > 0 });
    }
    e.push({ id: "journal", libelle: "Ouvrir le journal", icone: "log", separateurAvant: e.length > 0 });
    return e;
  };
  const faire = (id: string, l: Ligne) => {
    const m = l.media;
    if (id === "ouvrir" && m) ouvrirApercu(m.id);
    else if (id === "importer" && m) void importer([m.id]);
    else if (id === "explorateur" && m) void actionMedia(m, "explorateur");
    else if (id === "pause" || id === "reprendre" || id === "annuler") void piloter(l, id);
    else if (id === "journal") void api.ouvrirDossier("journaux");
  };
  const ouvrirMenu = (l: Ligne) => (e: MouseEvent) => { e.preventDefault(); setMenu({ el: e.currentTarget as HTMLElement, l, point: { x: e.clientX, y: e.clientY } }); };
  const clavier = (l: Ligne) => (e: KeyboardEvent) => {
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      setMenu({ el, l, point: { x: r.left + 12, y: r.top + 12 }, clavier: true });
    } else if (e.key === "Enter" && l.media?.etat === "disponible" && e.target === e.currentTarget) ouvrirApercu(l.media.id);
  };
  const pipeline = (l: Ligne) => noeuds(l.transfert, l.media, inst.imports.imports, demandes, inst.resultats, l.transfert ? etatsVus.get(l.transfert.id) ?? null : null);

  /** Carte d'un transfert actif : vignette, étape, progression réelle, octets et débit mesurés, étapes, commandes. */
  const carte = (l: Ligne) => {
    const t = l.transfert;
    const p = pipeline(l);
    const x = mesures(l);
    const pilotable = !!t && pilotables.has(t.id);
    const source = !t ? "Repéré dans le dossier surveillé" : t.origine === "desktop" ? "Collé dans AETHRYON" : "Envoyé par l'extension";
    const pct = x.frac != null ? Math.round(x.frac * 100) : null;
    const libelleBarre = typo(`${l.nom} : ${x.etape}${pct != null ? `, ${pct} %` : ""}`);
    return (
      <article className="xf xfp-carte" key={l.cle} tabIndex={0} aria-label={typo(`${l.nom} · ${p.aria}`)} onContextMenu={ouvrirMenu(l)} onKeyDown={clavier(l)}
        data-transfert={t?.id ?? undefined} data-etape={t?.etat ?? "navigateur"} data-pause={x.pause ? "" : undefined} data-arrivee={connues.current?.has(l.cle) ? undefined : ""}>
        <Vignette l={l} racine={inst.racine} pct={t?.etat === "telechargement" ? t.progression : null} />
        <div className="xfp-corps">
          <div className="xfp-tete">
            <span className="xn ellipsis" title={l.nom}>{l.nom}</span>
            <span className="xfp-etape" data-ton={x.pause ? "pause" : t?.etat === "attente" ? "attente" : "actif"}>
              {x.pause ? <Icone nom="pause" taille={12} /> : <IconeEtat etat="running" pct={pct ?? 0} taille={12} />}{x.etape}
            </span>
            <div className="xa xfp-actions">
              {pilotable && t!.etat === "telechargement" && (t!.pause
                ? <Bouton taille="sm" variante="primary" icone="play" occupe={occupe === `${t!.id}:reprendre`} onClick={() => void piloter(l, "reprendre")}>Reprendre</Bouton>
                : <BoutonIcone nom="pause" libelle="Mettre en pause" taille="sm" disabled={!!occupe} onClick={() => void piloter(l, "pause")} />)}
              {pilotable && <BoutonIcone nom="close" libelle="Annuler le transfert" taille="sm" disabled={occupe === `${t!.id}:annuler`} onClick={() => void piloter(l, "annuler")} />}
              <BoutonIcone nom="more" libelle={typo(`Actions pour « ${l.nom} »`)} taille="sm" onClick={(e) => { const el = e.currentTarget; const r = el.getBoundingClientRect(); setMenu({ el, l, point: { x: r.left, y: r.bottom + 4 } }); }} />
            </div>
          </div>
          <div className="xsrc">{typo(source)}{t?.titre && t.titre !== l.nom ? ` · ${t.titre}` : ""}</div>
          <div className={`progress xfp-barre${x.frac == null && !x.pause ? " progress--indet" : ""}`} role="progressbar" aria-label={libelleBarre}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={libelleBarre} data-pause={x.pause ? "" : undefined}>
            <i style={{ ["--p" as string]: x.frac ?? 0 }} />
          </div>
          <div className="xfp-mesures">
            {pct != null ? <b>{pct}{" "}%</b> : <b>{x.pause ? "En pause" : t?.etat === "attente" ? "En file" : "En cours"}</b>}
            {x.octets && <span>{typo(x.octets)}</span>}
            {x.vitesse && <span className="xfp-vitesse">{typo(x.vitesse)}</span>}
          </div>
          {p.bandeau ? <div className="xf-bandeau" role="note"><IconeEtat etat="error" />{typo(p.bandeau)}</div> : <VuePipeline p={p} />}
        </div>
      </article>
    );
  };

  /** Ligne compacte de l'historique : vignette, nom, issue réelle, taille, heure, actions utiles. */
  const ligne = (l: Ligne) => {
    const t = l.transfert!;
    const m = l.media;
    const p = pipeline(l);
    const annule = t.etat === "erreur" && t.code === "annule";
    const ton = t.etat === "pret" ? "ok" : annule ? "neutre" : "bad";
    const issue = t.etat === "pret" ? (t.premiere === "importe" ? "Importé dans Premiere" : "Dans la bibliothèque") : annule ? "Annulé" : "Interrompu";
    return (
      <div className="xf xfp-ligne" key={l.cle} tabIndex={0} aria-label={typo(`${l.nom} · ${issue}${t.etat === "erreur" && !annule ? ` · ${t.erreur ?? ""}` : ""}`)} onContextMenu={ouvrirMenu(l)} onKeyDown={clavier(l)}
        data-transfert={t.id} data-ton={ton}>
        <Vignette l={l} racine={inst.racine} />
        <div className="xfp-ligne-corps">
          <span className="xn ellipsis" title={l.nom}>{l.nom}</span>
          <span className="xfp-issue" data-ton={ton}>
            {ton === "ok" ? <IconeEtat etat="ok" taille={12} /> : ton === "bad" ? <IconeEtat etat="error" taille={12} /> : <Icone nom="close" taille={12} />}
            {issue}
          </span>
          {t.etat === "erreur" && !annule && (p.bandeau ? <div className="xf-bandeau" role="note"><IconeEtat etat="error" />{typo(p.bandeau)}</div> : <VuePipeline p={p} />)}
        </div>
        <span className="xfp-taille">{m && t.etat === "pret" ? taille(m.taille) : t.total ? taille(t.total) : ""}</span>
        <span className="xfp-heure">{heureCourte(t.majLe)}</span>
        <div className="xa xfp-actions">
          {t.etat === "pret" && m && p.importable && <BoutonIcone nom="import" libelle="Importer dans Premiere" taille="sm" onClick={() => void importer([m.id])} />}
          {t.etat === "pret" && m && <BoutonIcone nom="reveal" libelle="Afficher dans l'Explorateur" taille="sm" onClick={() => void actionMedia(m, "explorateur")} />}
          {t.etat === "erreur" && !annule && <Bouton taille="sm" variante="ghost" onClick={() => (t.origine === "desktop" ? aller("accueil") : void api.ouvrirDossier("journaux"))}>{t.origine === "desktop" ? "Relancer" : "Journal"}</Bouton>}
        </div>
      </div>
    );
  };

  const titreEtat = actifs ? pluriel(actifs, "transfert en cours", "transferts en cours") : attente ? pluriel(attente, "transfert en attente", "transferts en attente") : termines.length ? "Tout est arrivé" : "Aucun transfert";
  const sur = enCours.length ? (actifs ? "Réception" : "En attente") : erreurs ? "À vérifier" : "Au calme";
  return (
    <div className="xfp">
      <div className="ph xfp-ph">
        <div className="grow">
          <h1 className="t-display-l">Transferts</h1>
          <p className="sub"><b>{actifs} en cours</b> · {attente} en attente · {typo("le suivi continue fenêtre fermée")}</p>
        </div>
        {termines.length > 0 && <Bouton variante="ghost" taille="sm" onClick={effacer}>Effacer les terminés</Bouton>}
      </div>

      {lignes.length === 0 ? (
        <div className="vide xfp-vide">
          <Companion lieu="vide" taille={120} />
          <h2 className="t-display-m">Aucun transfert en cours</h2>
          <p>{typo("Collez un lien dans l'Accueil, ou choisissez « Envoyer vers : Premiere Pro » dans l'extension : le fichier arrive ici, puis dans la bibliothèque.")}</p>
          <div className="vide-actions"><Bouton variante="primary" icone="paste" onClick={() => aller("accueil")}>Coller un lien</Bouton></div>
        </div>
      ) : (
        <>
          <section className="xfp-pont carte-n" aria-label="Activité des transferts">
            <span className="xfp-chouette"><Companion lieu="vide" taille={84} /></span>
            <div className="xfp-pont-texte">
              <span className="surtitre">{sur}</span>
              <strong className="xfp-pont-titre">{titreEtat}</strong>
              <span className="xfp-pont-meta" aria-live="polite">
                {[b.moyenne != null ? `${Math.round(b.moyenne * 100)} % en moyenne` : enCours.length ? "progression inconnue tant que la source ne l'annonce pas" : null, b.vitesse, b.recus ? `${b.recus} reçus` : null]
                  .filter(Boolean).map((x) => typo(x!)).join(" · ") || typo(erreurs ? `${pluriel(erreurs, "transfert interrompu", "transferts interrompus")} dans l'historique` : "Les fichiers terminés sont dans la bibliothèque.")}
              </span>
            </div>
            <dl className="xfp-chiffres">
              <div><dt>En cours</dt><dd>{actifs}</dd></div>
              <div><dt>En attente</dt><dd>{attente}</dd></div>
              <div><dt>{"Aujourd'hui"}</dt><dd>{aujourdhui.filter((l) => l.transfert!.etat === "pret").length}</dd></div>
              <div data-ton={erreurs ? "bad" : undefined}><dt>Interrompus</dt><dd>{erreurs}</dd></div>
            </dl>
          </section>
          {enCours.length > 0 && (
            <section className="xf-sec xfp-sec" aria-label="En cours" aria-live="polite">
              <h2 className="xfp-h2">En cours</h2>
              <div className="xfp-cartes">{enCours.map(carte)}</div>
            </section>
          )}
          {termines.length > 0 && (
            <section className="xf-sec xfp-sec" aria-label="Historique">
              <h2 className="xfp-h2">Historique</h2>
              {aujourdhui.length > 0 && <><h3 className="sec-label">{"Aujourd'hui"}</h3><div className="group xfp-histo">{aujourdhui.map(ligne)}</div></>}
              {anciens.length > 0 && <><h3 className="sec-label">Plus anciens</h3><div className="group xfp-histo">{anciens.map(ligne)}</div></>}
            </section>
          )}
        </>
      )}
      {menu && <Menu ancre={menu.el} point={menu.point} parClavier={menu.clavier} elements={elementsMenu(menu.l)} libelle={typo(`Actions pour « ${menu.l.nom} »`)} onChoisir={(id) => faire(id, menu.l)} onFermer={() => setMenu(null)} />}
    </div>
  );
}
