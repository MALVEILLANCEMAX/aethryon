// État de l'application : instantané du cœur Rust, rafraîchi sur ses avis de changement (aucun sondage rapide),
// navigation, aperçu, recherche, et actions communes (importer, copier le chemin, afficher dans l'Explorateur).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, evenements, messageErreur } from "./api";
import { indexApi } from "./index-medias";
import type { EtatTransfert, Instantane, Media, Section } from "./types";
import { useToast } from "../ui/superpositions";
import { pluriel } from "./format";
import { definirInstantane, flux, socleDisponible } from "./fluxVue";
import type { DemandeImport } from "./pipeline";
import type { Filtre } from "./bibliotheque";

/** Comment on est arrivé dans la section : au clic (transition de page) ou au clavier (aucune animation). */
export type Arrivee = "clic" | "clavier";

interface Magasin {
  inst: Instantane | null;
  rafraichir: () => void;
  section: Section;
  /** Changer de section. `clavier` : aucune transition (action répétée, déclenchée au clavier) ; `filtre` : filtre de
   *  la Bibliothèque à appliquer en arrivant (tuiles de l'Accueil). */
  aller: (s: Section, o?: { clavier?: boolean; filtre?: Filtre }) => void;
  arrivee: Arrivee;
  filtre: Filtre;
  setFiltre: (f: Filtre) => void;
  apercu: string | null;
  ouvrirApercu: (id: string | null) => void;
  recherche: string;
  setRecherche: (q: string) => void;
  importer: (ids: string[]) => Promise<void>;
  copierChemins: (medias: Media[]) => Promise<void>;
  actionMedia: (m: Media, action: "ouvrir" | "explorateur") => Promise<void>;
  modifierConfig: (modif: Record<string, unknown>) => Promise<boolean>;
  /** Demandes d'import faites dans la session (par média) : commande déposée, résultat lu dans `resultats`. */
  demandes: Record<string, DemandeImport>;
  /** Instants des imports d'UN seul média (astuce « un par un »). */
  importsSimples: number[];
  /** Dernier état ACTIF vu pendant la session pour chaque transfert (place l'erreur sur le bon nœud). */
  etatsVus: Map<string, EtatTransfert>;
}

const Contexte = createContext<Magasin | null>(null);

export function useMagasin(): Magasin {
  const m = useContext(Contexte);
  if (!m) throw new Error("Magasin absent");
  return m;
}

/** Copie dans le presse-papiers (API asynchrone, puis repli execCommand). */
export async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = texte;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

export function FournisseurMagasin({ children, initial }: { children: ReactNode; initial: Instantane }) {
  const toast = useToast();
  const [inst, setInst] = useState<Instantane | null>(initial);
  const [section, setSection] = useState<Section>("accueil");
  const [arrivee, setArrivee] = useState<Arrivee>("clic");
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const [apercu, setApercu] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const minuterie = useRef<number | undefined>(undefined);
  const [demandes, setDemandes] = useState<Record<string, DemandeImport>>({});
  const [importsSimples, setImportsSimples] = useState<number[]>([]);
  definirInstantane(inst);
  const etatsVus = useRef(new Map<string, EtatTransfert>()).current;
  if (inst) for (const t of inst.transferts) if (t.etat === "attente" || t.etat === "conversion" || t.etat === "telechargement") etatsVus.set(t.id, t.etat);

  const noterDemande = useCallback((ids: string[], nom: string) => {
    const le = Date.now();
    setDemandes((d) => {
      const n = { ...d };
      for (const id of ids) n[id] = { nom, le };
      return n;
    });
    if (ids.length === 1) setImportsSimples((l) => [...l.filter((t) => le - t < 60_000), le]);
  }, []);

  // Flux (glisser-déposer) : un seul contrôleur, démarré ici ; les envois du dock comptent comme des demandes.
  useEffect(() => {
    if (!socleDisponible()) return;
    void flux.demarrer();
    const notes = new Set<string>();
    const fin = flux.abonner((e) => {
      for (const o of e.operations) {
        if (o.type !== "envoi" || notes.has(o.id)) continue;
        const nom = "nom" in o.envoi ? o.envoi.nom : null;
        if (nom) { notes.add(o.id); noterDemande(o.ids, nom); }
      }
    });
    return () => { fin(); void flux.arreter(); };
  }, [noterDemande]);

  const rafraichir = useCallback(() => {
    window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => {
      api.etat().then(setInst).catch(() => {});
    }, 120);
  }, []);

  useEffect(() => {
    const fins = [
      evenements.changement(() => rafraichir()),
      evenements.naviguer((s) => {
        setApercu(null);
        setSection(s);
      }),
      evenements.resultatCommande((r) => {
        rafraichir();
        if (r.action !== "importer") return;
        if (r.ok) toast({ etat: "ok", titre: "Importé dans Premiere Pro", texte: r.message });
        else toast({ etat: "erreur", titre: "Import non effectué", texte: r.message });
      }),
    ];
    // La fraîcheur du battement du panneau change avec le temps : relecture légère toutes les 5 s.
    const t = window.setInterval(rafraichir, 5000);
    return () => {
      window.clearInterval(t);
      fins.forEach((f) => f.then((u) => u()).catch(() => {}));
    };
  }, [rafraichir, toast]);

  const aller = useCallback((s: Section, o?: { clavier?: boolean; filtre?: Filtre }) => {
    setApercu(null);
    setArrivee(o?.clavier ? "clavier" : "clic");
    if (o?.filtre) setFiltre(o.filtre);
    setSection(s);
  }, []);

  const importer = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const connecte = inst?.liaison.connecte ?? false;
    try {
      const nom = await api.importer(ids);
      if (typeof nom === "string" && nom) noterDemande(ids, nom);
      toast(
        connecte
          ? { etat: "attente", titre: "Demande envoyée au panneau", texte: `${pluriel(ids.length, "média", "médias")} : le panneau AETHRYON confirme l'import dans Premiere Pro.` }
          : { etat: "info", titre: "Panneau Premiere Pro non ouvert", texte: "La demande attend 2 minutes que le panneau AETHRYON soit ouvert dans un projet, puis expire." },
      );
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: "Import impossible", texte: messageErreur(e) });
    }
  }, [inst?.liaison.connecte, toast, rafraichir, noterDemande]);

  const copierChemins = useCallback(async (medias: Media[]) => {
    const ok = await copier(medias.map((m) => m.chemin).join("\r\n"));
    toast(ok ? { etat: "ok", titre: medias.length > 1 ? `${medias.length} chemins copiés` : "Chemin copié", texte: medias.length === 1 ? medias[0].chemin : undefined }
      : { etat: "erreur", titre: "Copie impossible", texte: "Le presse-papiers est indisponible." });
  }, [toast]);

  const actionMedia = useCallback(async (m: Media, action: "ouvrir" | "explorateur") => {
    try {
      // Média scanné hors des dossiers surveillés : l'index l'ouvre (le cœur relit son chemin, jamais l'interface).
      if (m.indexe && !m.indexe.sources.includes("bibliotheque")) await indexApi.action(m.id, action);
      else await api.mediaAction(m.id, action);
    } catch (e) {
      toast({ etat: "erreur", titre: action === "ouvrir" ? "Ouverture impossible" : "Explorateur indisponible", texte: messageErreur(e) });
    }
  }, [toast]);

  const modifierConfig = useCallback(async (modif: Record<string, unknown>) => {
    try {
      const c = await api.configModifier(modif);
      setInst((i) => (i ? { ...i, config: c } : i));
      rafraichir();
      return true;
    } catch (e) {
      toast({ etat: "erreur", titre: "Réglage non enregistré", texte: messageErreur(e) });
      return false;
    }
  }, [toast, rafraichir]);

  const valeur = useMemo<Magasin>(() => ({
    inst, rafraichir, section, aller, arrivee, filtre, setFiltre, apercu, ouvrirApercu: setApercu, recherche, setRecherche, importer, copierChemins, actionMedia, modifierConfig, demandes, importsSimples, etatsVus,
  }), [inst, rafraichir, section, aller, arrivee, filtre, apercu, recherche, importer, copierChemins, actionMedia, modifierConfig, demandes, importsSimples]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
