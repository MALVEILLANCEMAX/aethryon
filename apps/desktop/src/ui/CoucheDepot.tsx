// Flow : couche de dépôt posée par-dessus la feuille (D-SPEC §B.4). Trois pièces, toutes alimentées par le socle
// (lib/flux.ts via lib/fluxVue.ts) et seulement par des faits réels :
//  1. le dock « Envoyer vers Premiere Pro » (zone `premiere`), pendant un glisser INTERNE, puis son résultat RÉEL
//     (envoyé, importé, échec, non connecté, expiré) ;
//  2. le calque « Ajouter à la bibliothèque » (zone `bibliotheque`) pendant un glisser de fichiers EXTERNES ;
//  3. le plateau des opérations : import avec progression réelle et annulation, « Surveiller ce dossier ».
// Les zones sont `aria-hidden` : elles ne sont qu'un raccourci du pointeur (tout existe au clavier et au menu).
import { useEffect, useRef, useState } from "react";
import { useMagasin } from "../lib/magasin";
import { AFFICHAGE_RESULTAT, estFinal, etatDock, flux, pointLePlusProche, estProche, socleDisponible, useFlux, vueImport, type Rect } from "../lib/fluxVue";
import type { OpImport, OpSurveiller } from "../lib/flux";
import { dossierAmical, pluriel, taille as tailleTxt, typo } from "../lib/format";
import { mouvementReduit } from "../lib/mouvement";
import { Bouton, Icone, IconeEtat } from "./base";
import { Companion, useCompanion } from "./Companion";
import { TuileIntegration } from "./PremiereMark";
import { useToast } from "./superpositions";

const versRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

function Dock() {
  const { inst } = useMagasin();
  const e = useFlux();
  const boite = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const [finales] = useState(() => new Map<string, number>());
  const [, rafraichir] = useState(0);
  const { proposerAstuce } = useCompanion();

  // Instant où chaque envoi devient final ; nouvelle lecture à la fin de l'affichage du résultat.
  useEffect(() => {
    for (const o of e.operations) {
      if (o.type !== "envoi" || !estFinal(o.envoi) || finales.has(o.id)) continue;
      finales.set(o.id, Date.now());
      const d = AFFICHAGE_RESULTAT[o.envoi.etat as keyof typeof AFFICHAGE_RESULTAT] ?? 4000;
      window.setTimeout(() => rafraichir((n) => n + 1), d + 30);
    }
  }, [e.operations, finales]);

  const rect = boite.current ? versRect(boite.current.getBoundingClientRect()) : null;
  const p = e.survol.actif ? e.survol.position : null;
  const dans = !!(rect && p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom);
  const vue = etatDock(e, inst, finales, Date.now(), dans);
  const proche = !!(rect && p && vue && (vue.etat === "revelee") && estProche(p, rect));

  // Halo « proche » : position écrite directement sur le halo (une fois par image, sans rendu React de la feuille).
  useEffect(() => {
    if (!halo.current || !rect || !p) return;
    const { px, py } = pointLePlusProche(p, rect);
    halo.current.style.setProperty("--px", `${px}%`);
    halo.current.style.setProperty("--py", `${py}%`);
  });

  // Astuce « dock invalide » (Expressive) : survol d'une zone invalide pendant plus de 1,5 s.
  const invalideSurvolee = vue?.etat === "invalide" && dans;
  useEffect(() => {
    if (!invalideSurvolee || !vue?.sousTitre) return;
    const t = window.setTimeout(() => proposerAstuce("dock-invalide", vue.sousTitre ?? vue.titre), 1500);
    return () => window.clearTimeout(t);
  }, [invalideSurvolee, vue?.sousTitre, vue?.titre, proposerAstuce]);

  // Le dock reste monté le temps de sa sortie (130 ms).
  const [montee, setMontee] = useState<typeof vue>(null);
  useEffect(() => {
    if (vue) { setMontee(vue); return; }
    const t = window.setTimeout(() => setMontee(null), mouvementReduit() ? 0 : 130);
    return () => window.clearTimeout(t);
  }, [vue?.etat, vue?.titre, vue?.sousTitre, vue?.accepte, vue?.horloge]);
  const v = vue ?? montee;
  if (!v) return null;
  const enCours = v.etat === "en-cours";
  return (
    <div
      ref={boite}
      className="dock"
      data-etat={v.etat}
      data-sortie={vue ? undefined : ""}
      data-proche={proche ? "" : undefined}
      data-envoi={v.envoi ?? undefined}
      data-zone={vue?.accepte ? "premiere" : undefined}
      aria-hidden="true"
    >
      <span className="dock-halo" ref={halo} />
      <span className="dock-eclair" />
      <TuileIntegration taille={40} />
      <span className="dock-texte">
        <span className="dock-titre">{typo(v.titre)}</span>
        {v.sousTitre && <span className="dock-sous">{v.horloge && <Icone nom="clock" taille={13} />}{typo(v.sousTitre)}</span>}
      </span>
      {enCours && <span className="dock-anneau"><IconeEtat etat="running" taille={14} /></span>}
      {v.etat === "reussie" && <span className="dock-ok"><IconeEtat etat="ok" taille={14} /></span>}
      {v.etat === "echec" && <span className="dock-ko"><IconeEtat etat="error" taille={14} /></span>}
    </div>
  );
}

interface VueCalque { titre: string; sous: string; nombre: number | null; refus: boolean }

function Calque() {
  const { inst } = useMagasin();
  const e = useFlux();
  const s = e.survol;
  let vue: VueCalque | null = null;
  if (inst && s.actif && s.provenance === "externe") {
    const c = s.classement;
    const nombre = c ? c.fichiers.length : s.chemins.length || null;
    const surveiller = !!c && c.fichiers.length === 0 && c.dossiers.some((d) => d.surveillable);
    const refus = s.zone === "bibliotheque" && s.verdict && !s.verdict.acceptable && !s.verdict.enAttente ? s.verdict.raison : null;
    vue = {
      titre: surveiller ? "Déposez pour surveiller ce dossier" : "Déposez pour ajouter à la bibliothèque",
      sous: typo(refus ?? (surveiller ? "Le dossier n'est pas copié : AETHRYON le surveille" : `Copiés dans ${dossierAmical(inst.config.dossierMedias)}`)),
      nombre: !refus && !surveiller && nombre ? nombre : null,
      refus: !!refus,
    };
  }
  // Sortie : fondu de 100 ms après la fin du survol (le calque n'est plus une zone pendant ce temps).
  const [derniere, setDerniere] = useState<VueCalque | null>(null);
  const cle = vue ? `${vue.titre}|${vue.sous}|${vue.nombre}|${vue.refus}` : "";
  useEffect(() => {
    if (vue) { setDerniere(vue); return; }
    const t = window.setTimeout(() => setDerniere(null), mouvementReduit() ? 0 : 100);
    return () => window.clearTimeout(t);
  }, [cle]);
  const v = vue ?? derniere;
  if (!v) return null;
  return (
    <div className="calque-depot" data-zone={vue ? "bibliotheque" : undefined} data-sortie={vue ? undefined : ""} data-refus={v.refus ? "" : undefined} aria-hidden="true">
      <div className="calque-centre">
        <Companion lieu="depot" taille={56} etat="curious" />
        <div className="calque-titre">{v.titre}</div>
        <div className="calque-sous">{v.sous}</div>
        {v.nombre != null && <div className="calque-nombre">{pluriel(v.nombre, "fichier", "fichiers")}</div>}
      </div>
    </div>
  );
}

function CarteImport({ o }: { o: OpImport }) {
  const v = vueImport(o);
  const pct = v.progression;
  const [annulation, setAnnulation] = useState(false);
  return (
    <div className="op" data-op="import" data-fini={v.fini ? "" : undefined}>
      <span className="op-ico"><IconeEtat etat={v.erreur ? "error" : v.fini ? "ok" : "running"} pct={pct != null ? pct * 100 : 0} taille={14} /></span>
      <div className="op-corps">
        <div className="op-titre">{v.erreur || (o.bilan && o.bilan.echecs) ? "Ajout non effectué" : v.fini ? "Ajout terminé" : `Copie de ${pluriel(v.fichiers.length, "fichier", "fichiers")}`}</div>
        <div className="op-detail ellipsis">{typo(v.erreur ?? (o.bilan ? `${pluriel(o.bilan.importes, "fichier copié", "fichiers copiés")} · ${pluriel(o.bilan.echecs, "échec", "échecs")}` : v.courant ? `${v.courant.nom}${v.courant.etape === "verification" ? " · vérification" : v.courant.progression != null ? ` · ${Math.round(v.courant.progression * 100)} %` : ""}` : "Vérification…"))}</div>
        {!v.fini && (
          <div className={`progress${pct == null ? " progress--indet" : ""}`} role="progressbar" aria-label="Copie des fichiers" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={pct != null ? Math.round(pct * 100) : undefined} aria-valuetext={pct != null ? `${Math.round(pct * 100)} %` : "en cours"}>
            <i style={{ ["--p" as string]: pct ?? 0 }} />
          </div>
        )}
        {pct == null && !v.fini && <span className="indet-txt">en cours</span>}
      </div>
      {!v.fini && <Bouton taille="sm" variante="ghost" disabled={annulation} onClick={() => { setAnnulation(true); void flux.annulerImport(o.lot); }}>{annulation ? "Annulation…" : "Annuler"}</Bouton>}
    </div>
  );
}

function CarteSurveiller({ o }: { o: OpSurveiller }) {
  const d = o.dossiers[0];
  if (!d) return null;
  const nom = o.dossiers.length > 1 ? `${o.dossiers.length} dossiers` : `« ${d.nom} »`;
  return (
    <div className="op" data-op="surveiller" data-etat={o.etat}>
      <span className="op-ico"><Icone nom="folder" taille={16} /></span>
      <div className="op-corps">
        <div className="op-titre">{typo(o.etat === "acceptee" ? (o.message ?? "Dossier surveillé") : o.etat === "erreur" ? "Dossier non ajouté" : `Surveiller ${nom} ?`)}</div>
        <div className="op-detail">{typo(o.etat === "erreur" ? (o.message ?? "") : o.etat === "acceptee" ? "Ses médias apparaissent dans la bibliothèque." : "Le dossier n'est pas copié : AETHRYON montre ses médias et suit leurs changements.")}</div>
      </div>
      {(o.etat === "proposee" || o.etat === "en-cours") && (
        <span className="op-actions">
          <Bouton taille="sm" variante="ghost" disabled={o.etat === "en-cours"} onClick={() => flux.refuserProposition(o.id)}>Non merci</Bouton>
          <Bouton taille="sm" variante="primary" disabled={o.etat === "en-cours"} onClick={() => void flux.accepterProposition(o.id)}>{o.etat === "en-cours" ? "Ajout…" : "Surveiller ce dossier"}</Bouton>
        </span>
      )}
    </div>
  );
}

/** Plateau des opérations, et toasts des faits terminés (une seule fois par opération). */
function Plateau() {
  const { rafraichir } = useMagasin();
  const e = useFlux();
  const toast = useToast();
  const signales = useRef(new Set<string>());
  useEffect(() => {
    for (const o of e.operations) {
      if (signales.current.has(o.id)) continue;
      if (o.type === "import" && (o.bilan || o.erreur)) {
        signales.current.add(o.id);
        rafraichir();
        if (o.erreur) toast({ etat: "erreur", titre: "Ajout non effectué", texte: o.erreur });
        else if (o.bilan) {
          const b = o.bilan;
          if (b.importes) toast({ etat: "ok", titre: pluriel(b.importes, "fichier copié", "fichiers copiés"), texte: `${tailleTxt(b.octets)} · ils apparaissent dans la bibliothèque.` });
          const ignores = b.fichiers.filter((f) => f.etat === "deja-la" || f.etat === "refuse" || f.etat === "echec");
          if (ignores.length) {
            const f = ignores[0];
            toast({ etat: "info", titre: `${pluriel(ignores.length, "fichier ignoré", "fichiers ignorés")} : ${"raison" in f ? f.raison : ""}`, texte: f.nom });
          }
          if (b.annules && !b.importes) toast({ etat: "info", titre: "Ajout annulé", texte: "Aucun fichier partiel n'a été laissé." });
          if (!b.echecs) window.setTimeout(() => flux.oublier(o.id), 2500);
        }
      } else if (o.type === "envoi" && (o.envoi.etat === "non-connecte" || (o.envoi.etat === "echec" && !o.envoi.nom))) {
        // Pas de résultat du panneau (rien n'a été déposé) : le toast dit pourquoi, comme pour les autres échecs.
        signales.current.add(o.id);
        toast({ etat: "erreur", titre: o.envoi.etat === "non-connecte" ? "Rien n'a été envoyé" : "Import impossible", texte: o.envoi.message });
      } else if (o.type === "refus") {
        signales.current.add(o.id);
        toast({ etat: "info", titre: "Dépôt refusé", texte: o.raison });
        flux.oublier(o.id);
      } else if (o.type === "glisser") {
        signales.current.add(o.id);
        if (o.fin.resultat === "erreur") toast({ etat: "erreur", titre: "Glisser impossible", texte: o.fin.message ?? "Windows n'a pas pu démarrer le glisser." });
        flux.oublier(o.id);
      } else if (o.type === "surveiller" && (o.etat === "acceptee" || o.etat === "refusee")) {
        signales.current.add(o.id);
        if (o.etat === "acceptee") rafraichir();
        window.setTimeout(() => flux.oublier(o.id), o.etat === "acceptee" ? 3000 : 0);
      }
    }
  }, [e.operations, toast, rafraichir]);
  const visibles = e.operations.filter((o) => (o.type === "import" && (!o.bilan || o.bilan.echecs > 0) ) || (o.type === "surveiller" && o.etat !== "refusee"));
  if (visibles.length === 0) return null;
  return (
    <div className="plateau" role="region" aria-label="Opérations en cours" aria-live="polite">
      {visibles.map((o) => (o.type === "import" ? <CarteImport key={o.id} o={o} /> : o.type === "surveiller" ? <CarteSurveiller key={o.id} o={o} /> : null))}
    </div>
  );
}

/** La couche entière : rien hors de Tauri (socle absent → aucune interface de glisser, le reste fonctionne). */
export function CoucheDepot() {
  if (!socleDisponible()) return null;
  return (
    <>
      <Calque />
      <Dock />
      <Plateau />
    </>
  );
}
