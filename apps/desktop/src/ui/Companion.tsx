// Companion (D-SPEC §B.6) : UN hôte pour toute l'application, UNE seule chouette animée à la fois. Lieux : la niche
// de la barre latérale (par défaut), la présentation de l'Accueil (`accueil`), un état vide (`vide`) ou le calque de
// dépôt (`depot`), qui PRENNENT la présence. Vide et dépôt masquent la niche en fondu ; l'Accueil la laisse visible,
// fixe (sa phrase d'état reste la seule région annoncée). Nocturne : dès 72 px, la chouette est en profondeur
// (ui/chouette.tsx : mêmes tracés, éclairés, sur quatre plans) avec ses apparences repos, attention, chargement,
// analyse, téléchargement (progression réelle), réussite et erreur. Aucun son.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMagasin } from "../lib/magasin";
import { flux, useFluxChoix } from "../lib/fluxVue";
import { useSignalMusique } from "../lib/musiqueSignal";
import { envoisActifs, useTransfertsCloud } from "../lib/compte";
import { mouvementReduit } from "../lib/mouvement";
import {
  apparenceDe, astuceUnParUn, detecter, ecrirePresence, etatCompanion, intervalleClignement, lirePresence, memoriser, progressionTransferts,
  type Cible, type EtatChouette, type EvtLocal, type Presence, type SortieCompanion,
} from "../lib/companion";
import { pluriel, typo } from "../lib/format";
import type { Instantane } from "../lib/types";
import { Chouette, cligner, regarder } from "./marque";
import { BoutonIcone, Icone } from "./base";
import { Chouette3D } from "./chouette";

export type Lieu = "niche" | "accueil" | "vide" | "depot";
/** Activité en cours signalée par un module (AETHRYON Index : « scan »). */
export interface ActiviteExterne { cle: string; texte: string; cible: Cible }

interface ContexteCompanion {
  sortie: SortieCompanion;
  hote: Lieu;
  presence: Presence;
  definirPresence: (p: Presence) => void;
  prendre: (l: Lieu) => () => void;
  enregistrer: (el: Element | null) => void;
  proposerAstuce: (cle: string, texte: string) => void;
  fermerAstuce: (toujours: boolean) => void;
  aller: (c: Cible) => void;
  /** Fait RÉEL constaté par une page (conversion acceptée ou refusée par le serveur…) : réussite ou erreur. */
  signaler: (e: Omit<EvtLocal, "le">) => void;
  /** Activité en cours d'un module (null : terminée). */
  activite: (a: ActiviteExterne | null, cle: string) => void;
}

const Ctx = createContext<ContexteCompanion | null>(null);

export function useCompanion(): ContexteCompanion {
  const c = useContext(Ctx);
  if (!c) throw new Error("Companion absent");
  return c;
}

function astucesCoupees(): boolean {
  try { return localStorage.getItem("aethryon.astuces.off") === "1"; } catch { return false; }
}

const ASTUCE_UN_PAR_UN = "Astuce : Ctrl + clic pour en choisir plusieurs, puis « Importer dans Premiere ».";

export function FournisseurCompanion({ children }: { children: ReactNode }) {
  const { inst, section, aller: allerSection, ouvrirApercu, importsSimples } = useMagasin();
  const [presence, setPresence] = useState<Presence>(lirePresence);
  const [evts, setEvts] = useState<EvtLocal[]>([]);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [lieux, setLieux] = useState<Lieu[]>([]);
  const [astuce, setAstuce] = useState<{ cle: string; texte: string } | null>(null);
  const [externes, setExternes] = useState<ActiviteExterne[]>([]);
  const vues = useRef(new Set<string>());
  const avant = useRef<Instantane | null>(null);
  const svg = useRef<Element | null>(null);
  const operations = useFluxChoix((e) => e.operations);
  const survol = useFluxChoix((e) => e.survol.actif);
  const reduit = mouvementReduit();

  // Faits de l'instantané (médias prêts, transferts en erreur, résultats du panneau).
  useEffect(() => {
    if (!inst) return;
    const t = Date.now();
    const n = detecter(avant.current, inst, t);
    avant.current = inst;
    if (n.length) { setEvts((h) => memoriser(h, n)); setMaintenant(t); }
  }, [inst]);

  // Faits du flux : envois finis sans résultat du panneau (non connecté, refus du cœur), imports de fichiers.
  useEffect(() => {
    const t = Date.now();
    const n: EvtLocal[] = [];
    for (const o of operations) {
      if (o.type === "envoi") {
        const e = o.envoi;
        if (e.etat === "non-connecte") n.push({ type: "erreur", le: t, texte: "Premiere Pro n'est pas connecté", cible: { section: "integrations" }, cle: `envoi:${o.id}` });
        else if (e.etat === "echec" && !e.nom) n.push({ type: "erreur", le: t, texte: "Import non effectué", cible: { section: "integrations" }, cle: `envoi:${o.id}` });
        else if (e.etat === "importe") n.push({ type: "succes", famille: "importe", le: t, texte: inst?.liaison.panneau?.projet ? `Importé dans ${inst.liaison.panneau.projet}` : "Importé dans Premiere Pro", cible: o.ids.length === 1 ? { media: o.ids[0] } : { section: "bibliotheque" }, cle: `envoi:${e.nom}` });
        else if ((e.etat === "echec" || e.etat === "expire") && e.nom) n.push({ type: "erreur", le: t, texte: "Import non effectué", cible: { section: "integrations" }, cle: `envoi:${e.nom}` });
      } else if (o.type === "import") {
        if (o.bilan && o.bilan.importes > 0) n.push({ type: "succes", famille: "ajout", le: t, texte: `${pluriel(o.bilan.importes, "fichier ajouté", "fichiers ajoutés")}`, cible: { section: "bibliotheque" }, cle: `import:${o.lot}` });
        else if (o.erreur || (o.bilan && o.bilan.echecs > 0)) n.push({ type: "erreur", le: t, texte: "Ajout non effectué", cible: { section: "bibliotheque" }, cle: `import:${o.lot}` });
      }
    }
    if (n.length) {
      setEvts((h) => memoriser(h, n));
      setMaintenant(t);
    }
  }, [operations, inst?.liaison.panneau?.projet]);

  // Une visite de Transferts acquitte l'erreur.
  useEffect(() => {
    if (section === "transferts") setEvts((h) => [...h, { type: "visite-transferts" as const, le: Date.now(), texte: "" }].slice(-40));
  }, [section]);

  // Astuce « un par un » (Expressive) : trois imports d'un seul média en moins de 60 s.
  useEffect(() => {
    if (astuceUnParUn(importsSimples, Date.now())) proposer("un-par-un", ASTUCE_UN_PAR_UN);
  }, [importsSimples]);

  const proposer = useCallback((cle: string, texte: string) => {
    if (vues.current.has(cle) || astucesCoupees()) return;
    vues.current.add(cle);
    setAstuce({ cle, texte });
  }, []);

  // AETHRYON Cloud : envois en cours (Processing), puis « Sauvegardé dans le Cloud » ou une erreur, une fois par envoi.
  const cloud = useTransfertsCloud();
  const nuage = envoisActifs(cloud);
  useEffect(() => {
    const t = Date.now();
    const n: EvtLocal[] = [];
    for (const x of cloud) {
      if (x.sens !== "envoi" || !x.finiLe || t - Date.parse(x.finiLe) > 10_000) continue;
      if (x.etape === "termine" && x.statut === "sauvegarde") n.push({ type: "succes", famille: "ajout", le: t, texte: "Sauvegardé dans le Cloud", cible: { section: "cloud" }, cle: `cloud:${x.id}` });
      else if (x.etape === "echec") n.push({ type: "erreur", le: t, texte: "Sauvegarde cloud non effectuée", cible: { section: "cloud" }, cle: `cloud:${x.id}` });
    }
    if (n.length) {
      setEvts((h) => memoriser(h, n));
      setMaintenant(t);
    }
  }, [cloud]);
  // Section MUSIQUE : imports en cours (Processing), puis « Ajouté à ta musique » ou une erreur, une fois par import.
  const sm = useSignalMusique();
  useEffect(() => {
    const e = sm.evenement;
    if (!e) return;
    const t = Date.now();
    setEvts((h) => memoriser(h, [e.type === "succes" ? { type: "succes", famille: "ajout", le: t, texte: e.texte, cible: { section: "musique" }, cle: e.cle } : { type: "erreur", le: t, texte: e.texte, cible: { section: "musique" }, cle: e.cle }]));
    setMaintenant(t);
  }, [sm.evenement]);
  const envois = operations.filter((o) => o.type === "envoi" && ["envoi", "envoye"].includes(o.envoi.etat)).length + (inst?.enAttente.length ?? 0);
  const copies = operations.reduce((n, o) => (o.type === "import" && !o.bilan && !o.erreur ? n + o.fichiers.length : n), 0);
  const sortie = useMemo(
    () => (inst ? etatCompanion(inst, evts, { envois, copies, nuage, musique: sm.imports, survol, astuce: presence === "expressive" ? astuce : null, externes }, maintenant, presence, reduit) : etatCompanion(VIDE, [], { envois: 0, copies: 0, survol: false }, maintenant, presence, reduit)),
    [inst, evts, envois, copies, nuage, sm.imports, survol, astuce, externes, maintenant, presence, reduit],
  );

  // Rappel à l'échéance (fin d'un Success ou d'une Error soft) ; astuce : 8 s.
  useEffect(() => {
    if (sortie.jusqua == null) return;
    const t = window.setTimeout(() => setMaintenant(Date.now()), Math.max(0, sortie.jusqua - Date.now()) + 20);
    return () => window.clearTimeout(t);
  }, [sortie.jusqua]);
  useEffect(() => {
    if (!astuce) return;
    const t = window.setTimeout(() => setAstuce(null), 8000);
    return () => window.clearTimeout(t);
  }, [astuce]);

  // Réussite : clin d'œil puis reflets, une fois par déclencheur.
  useEffect(() => {
    if (!sortie.animee || sortie.etat !== "success") return;
    const s = svg.current;
    cligner(s);
    s?.classList.remove("reflets");
    const t = window.setTimeout(() => s?.classList.add("reflets"), 120);
    const u = window.setTimeout(() => s?.classList.remove("reflets"), 560);
    return () => { window.clearTimeout(t); window.clearTimeout(u); };
  }, [sortie.cle, sortie.animee]);

  // Clignement au repos : UNE minuterie, seulement fenêtre visible et au premier plan.
  useEffect(() => {
    if (!sortie.animee || !["idle", "curious", "hint"].includes(sortie.etat)) return;
    let t: number | undefined;
    const boucle = () => {
      const d = intervalleClignement(presence, Math.random());
      if (d == null) return;
      t = window.setTimeout(() => {
        if (document.visibilityState === "visible" && document.hasFocus()) cligner(svg.current);
        boucle();
      }, d);
    };
    boucle();
    return () => window.clearTimeout(t);
  }, [sortie.animee, sortie.etat, presence]);

  const prendre = useCallback((l: Lieu) => {
    setLieux((x) => [...x, l]);
    return () => setLieux((x) => { const i = x.lastIndexOf(l); return i < 0 ? x : [...x.slice(0, i), ...x.slice(i + 1)]; });
  }, []);
  const hote: Lieu = lieux.length ? lieux[lieux.length - 1] : "niche";

  const valeur = useMemo<ContexteCompanion>(() => ({
    sortie, hote, presence,
    definirPresence: (p) => { ecrirePresence(p); setPresence(p); },
    prendre,
    enregistrer: (el) => { svg.current = el; },
    proposerAstuce: proposer,
    fermerAstuce: (toujours) => {
      if (toujours) { try { localStorage.setItem("aethryon.astuces.off", "1"); } catch { /* session seulement */ } }
      setAstuce(null);
    },
    aller: (c) => ("media" in c ? ouvrirApercu(c.media) : allerSection(c.section)),
    signaler: (e) => { const t = Date.now(); setEvts((h) => memoriser(h, [{ ...e, le: t }])); setMaintenant(t); },
    activite: (a, cle) => setExternes((l) => (a ? [...l.filter((x) => x.cle !== cle), a] : l.filter((x) => x.cle !== cle))),
  }), [sortie, hote, presence, prendre, proposer, ouvrirApercu, allerSection]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}

const VIDE = {
  transferts: [], index: { medias: [] }, liaison: { connecte: false, age: null, panneau: null }, resultats: [], enAttente: [],
} as unknown as Instantane;

/** La chouette dans un lieu. Un lieu autre que la niche prend la présence tant qu'il est affiché. Dès 72 px : en
 *  profondeur. La niche, quand l'Accueil a la présence, montre la chouette FIXE (une seule animée à la fois). */
export function Companion({ lieu, taille, etat: force, zoneSuivi, regard, hochement }: {
  lieu: Lieu;
  taille: number;
  /** État imposé par le lieu (calque de dépôt : Curious). */
  etat?: EtatChouette;
  /** Zone où la chouette suit le pointeur (présentation de l'Accueil). */
  zoneSuivi?: React.RefObject<HTMLElement>;
  /** Regard imposé (vers le champ « Coller un lien » quand il a le focus). */
  regard?: { x: number; y: number } | null;
  /** Hochement de tête (lien reconnu). */
  hochement?: number;
}) {
  const c = useCompanion();
  const { inst } = useMagasin();
  const { prendre } = c;
  const local = useRef<Element | null>(null);
  useLayoutEffect(() => (lieu === "niche" ? undefined : prendre(lieu)), [lieu, prendre]);
  const actif = c.hote === lieu;
  const etat = force ?? c.sortie.etat;
  // Curious : le regard suit le pointeur du glisser, écrit directement dans le DOM (une fois par image, sans React).
  useEffect(() => {
    if (!actif || etat !== "curious" || !c.sortie.animee) return;
    const fin = flux.abonner((e) => {
      const s = local.current;
      const p = e.survol.position;
      if (!s || !p) return regarder(s, 0, 0);
      const r = s.getBoundingClientRect();
      const dx = (p.x - (r.left + r.width / 2)) / 120;
      const dy = (p.y - (r.top + r.height / 2)) / 120;
      regarder(s, dx * 1.4, dy * 0.98);
    });
    return () => { fin(); regarder(local.current, 0, 0); };
  }, [actif, etat, c.sortie.animee]);
  const fixe = !actif && lieu === "niche" && c.hote === "accueil";
  if (!actif && !fixe) return null;
  if (taille >= 72) {
    const apparence = force === "curious" ? "attention" : apparenceDe({ etat, cle: c.sortie.cle });
    return (
      <span className="companion companion--3d" data-etat={etat} data-anime={c.sortie.animee ? "" : undefined} style={{ width: taille, height: taille }} aria-hidden="true">
        <Chouette3D taille={taille} apparence={apparence} anime={c.sortie.animee} cle={c.sortie.cle} zoneSuivi={zoneSuivi} regard={regard} hochement={hochement}
          progression={apparence === "telechargement" && inst ? progressionTransferts(inst) : null}
          refRacine={(el) => { local.current = el; c.enregistrer(el); }} />
      </span>
    );
  }
  return (
    <span className="companion" data-etat={fixe ? "idle" : etat} data-anime={!fixe && c.sortie.animee ? "" : undefined} style={{ width: taille, height: taille }} aria-hidden="true">
      <span className="companion-halo" />
      <Chouette taille={taille} refSvg={fixe ? undefined : (el) => { local.current = el; c.enregistrer(el); }} />
    </span>
  );
}

/** Niche de la barre latérale : la chouette de 28 px, une ligne d'état annoncée (role="status"), un bouton. */
export function Niche({ etroit }: { etroit: boolean }) {
  const c = useCompanion();
  const masquee = c.hote !== "niche" && c.hote !== "accueil";
  return (
    <div className="niche-boite" data-masquee={masquee ? "" : undefined}>
      {c.sortie.etat === "hint" && c.hote === "niche" && (
        <div className="astuce" role="note">
          <p>{typo(c.sortie.texte)}</p>
          <div className="astuce-actions">
            <button type="button" className="link" onClick={() => c.fermerAstuce(true)}>Ne plus afficher d'astuces</button>
          </div>
          <BoutonIcone nom="close" libelle="Fermer l'astuce" taille="xs" onClick={() => c.fermerAstuce(false)} />
        </div>
      )}
      <button type="button" className="niche" data-etat={c.sortie.etat} onClick={() => c.aller(c.sortie.cible)} title={etroit ? c.sortie.texte : undefined} tabIndex={masquee ? -1 : undefined}>
        <span className="niche-figure"><Companion lieu="niche" taille={28} /></span>
        <span className={`niche-texte${etroit ? " cache" : ""}`} role="status" aria-live="polite">
          {c.sortie.etat === "hint" && c.hote === "niche"
            ? <span key={c.sortie.cle} className="niche-ligne">Astuce<span className="cache">{typo(` : ${c.sortie.texte}`)}</span></span>
            : <span key={c.sortie.cle} className="niche-ligne">{typo(c.sortie.texte)}{c.sortie.etat === "idle" && <Icone nom="sparkle" taille={11} className="niche-eclat" />}</span>}
        </span>
      </button>
    </div>
  );
}
