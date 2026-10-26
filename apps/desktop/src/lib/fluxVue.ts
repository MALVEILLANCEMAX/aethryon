// Adaptateur entre le socle du glisser-déposer (lib/flux.ts, desktop/FLUX.md) et l'interface de Flow (D-SPEC §B.3).
// - Un SEUL contrôleur pour l'application (`flux`), démarré par le magasin, avec le contexte du dernier instantané.
// - Les capacités du §B.3 (`capacites()`) : absentes hors de Tauri (navigateur, essais) → l'interface de glisser
//   n'est pas affichée et tout le reste fonctionne.
// - Fonctions PURES (fluxVue.test.ts) : conversion des pixels, résolution des zones par rectangles, seuil « proche »
//   de 48 px, regroupement par image, état du dock « Envoyer vers Premiere Pro » à partir des états RÉELS.
import { useSyncExternalStore } from "react";
import {
  creerFlux, importerFichiers as importerSocle, versCss, type BilanImport, type EtatEnvoi, type EtatFlux, type Flux, type OpEnvoi, type OpImport, type Point,
} from "./flux";
import type { Instantane } from "./types";

// ---- Contrôleur unique -----------------------------------------------------------------------------------------------

let dernier: Instantane | null = null;
/** Tenu à jour par le magasin à chaque nouvel instantané (contexte des verdicts du socle). */
export function definirInstantane(i: Instantane | null): void {
  dernier = i;
}

export const flux: Flux = creerFlux({
  contexte: () => ({ premiereConnecte: dernier?.liaison.connecte ?? null, medias: dernier?.index.medias, chutier: dernier?.config.chutierParDefaut ?? null }),
});

/** Le socle n'existe que dans l'application Tauri (WebView2) ; ailleurs, aucune interface de glisser. */
export function socleDisponible(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useFlux(): EtatFlux {
  return useSyncExternalStore(flux.abonner, flux.etat);
}

/** Abonnement partiel : la vue ne se redessine que si la valeur choisie change (Object.is). */
export function useFluxChoix<T>(choix: (e: EtatFlux) => T): T {
  return useSyncExternalStore(flux.abonner, () => choix(flux.etat()));
}

// ---- Capacités du §B.3 (traduction de l'API réelle) ------------------------------------------------------------------

export interface CapacitesFlux {
  glisserHors?(ids: string[], depart: { x: number; y: number }): Promise<"depose" | "annule" | "inconnu">;
  ecouterGlisser?(r: {
    entree(e: { x: number; y: number; nombre: number | null; interne: boolean }): void;
    survol(e: { x: number; y: number }): void;
    sortie(): void;
    depot(e: { x: number; y: number; chemins: string[]; interne: boolean }): void;
  }): () => void;
  importerFichiers?(chemins: string[]): Promise<{ ajoutes: string[]; ignores: { chemin: string; raison: string }[] }>;
}

/** Traduit un bilan d'import du socle vers la forme du §B.3. */
export function versAjouts(b: BilanImport): { ajoutes: string[]; ignores: { chemin: string; raison: string }[] } {
  const ajoutes: string[] = [];
  const ignores: { chemin: string; raison: string }[] = [];
  for (const f of b.fichiers) {
    if (f.etat === "importe") ajoutes.push(f.id);
    else if (f.etat === "annule") ignores.push({ chemin: f.source, raison: "Annulé." });
    else ignores.push({ chemin: f.source, raison: f.raison });
  }
  return { ajoutes, ignores };
}

export function capacites(f: Flux = flux, present = socleDisponible()): CapacitesFlux {
  if (!present) return {};
  return {
    async glisserHors(ids) {
      await f.glisserMedias(ids);
      return new Promise((ok) => {
        const fin = f.abonner((e) => {
          if (e.glisser) return;
          fin();
          const op = e.operations[e.operations.length - 1];
          ok(op && op.type === "glisser" ? (op.fin.resultat === "depose" ? "depose" : "annule") : "inconnu");
        });
      });
    },
    ecouterGlisser(r) {
      let avant = f.etat();
      return f.abonner((e) => {
        const a = avant.survol;
        const s = e.survol;
        if (!a.actif && s.actif && s.position) r.entree({ ...s.position, nombre: s.chemins.length || null, interne: s.provenance === "aethryon" });
        else if (s.actif && s.position && (s.position.x !== a.position?.x || s.position.y !== a.position?.y)) r.survol(s.position);
        else if (a.actif && !s.actif) {
          // Fin du survol : dépôt si le socle vient d'ajouter une opération, sortie sinon.
          if (e.operations.length > avant.operations.length && a.position) r.depot({ ...a.position, chemins: a.chemins, interne: a.provenance === "aethryon" });
          else r.sortie();
        }
        avant = e;
      });
    },
    async importerFichiers(chemins) {
      return versAjouts(await importerSocle(chemins));
    },
  };
}

// ---- Géométrie (pure) ----------------------------------------------------------------------------------------------------

export interface Rect { left: number; top: number; right: number; bottom: number }

/** Pixels physiques (Tauri) → pixels CSS (re-export du socle, pour les essais de l'interface). */
export const versPointCss = versCss;

/** Distance du point au rectangle (0 à l'intérieur). */
export function distanceRect(p: Point, r: Rect): number {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

export const SEUIL_PROCHE = 48;

/** Le pointeur est-il « proche » (≤ 48 px, hors de la zone) ? */
export function estProche(p: Point, r: Rect, seuil = SEUIL_PROCHE): boolean {
  const d = distanceRect(p, r);
  return d > 0 && d <= seuil;
}

/** Point de la zone le plus proche du pointeur, en % de la zone (position du halo `--px`, `--py`). */
export function pointLePlusProche(p: Point, r: Rect): { px: number; py: number } {
  const x = Math.max(r.left, Math.min(p.x, r.right));
  const y = Math.max(r.top, Math.min(p.y, r.bottom));
  const l = Math.max(1, r.right - r.left);
  const h = Math.max(1, r.bottom - r.top);
  return { px: Math.round(((x - r.left) / l) * 1000) / 10, py: Math.round(((y - r.top) / h) * 1000) / 10 };
}

/** Zone sous le point, par rectangles (la DERNIÈRE enregistrée gagne : elle est au-dessus). */
export function zoneParPosition(zones: readonly { nom: string; rect: Rect }[], p: Point): string | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    const r = zones[i].rect;
    if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return zones[i].nom;
  }
  return null;
}

/** Regroupe des mises à jour en UNE par image : seule la dernière valeur de l'image est appliquée. */
export function parImage<T>(appliquer: (v: T) => void, planifier: (f: () => void) => void = (f) => requestAnimationFrame(() => f())): (v: T) => void {
  let prevu = false;
  let valeur: T;
  return (v: T) => {
    valeur = v;
    if (prevu) return;
    prevu = true;
    planifier(() => {
      prevu = false;
      appliquer(valeur);
    });
  };
}

// ---- Dock « Envoyer vers Premiere Pro » (D-SPEC §B.4.2) ------------------------------------------------------------------

export type EtatDock = "revelee" | "invalide" | "survolee" | "en-cours" | "reussie" | "echec";
export interface VueDock {
  etat: EtatDock;
  titre: string;
  sousTitre: string | null;
  /** Icône horloge ambre (Premiere non relié). */
  horloge?: boolean;
  /** La zone accepte un dépôt (sinon, pas d'attribut data-zone : un dépôt n'y fait rien). */
  accepte: boolean;
  /** Opération d'envoi affichée (résultat), le cas échéant. */
  op: string | null;
  /** État RÉEL de l'envoi (pour les essais et le texte). */
  envoi: EtatEnvoi["etat"] | null;
}

/** Durées d'affichage d'un résultat : réussite 1,6 s, échec 4 s (D-SPEC §B.4.2). */
export const AFFICHAGE_RESULTAT: Record<"importe" | "echec" | "non-connecte" | "expire", number> = { importe: 1600, echec: 4000, "non-connecte": 4000, expire: 4000 };
const FINAUX = new Set(["importe", "echec", "non-connecte", "expire"]);

export function estFinal(e: EtatEnvoi): boolean {
  return FINAUX.has(e.etat);
}

function projet(i: Instantane | null): string | null {
  return i?.liaison.panneau?.projetOuvert ? i.liaison.panneau.projet ?? null : null;
}

/**
 * État du dock. `finales` : instant où chaque envoi est devenu final (mémorisé par la vue) ; `dansDock` : le
 * pointeur (position du survol) est dans le rectangle du dock.
 */
export function etatDock(e: EtatFlux, inst: Instantane | null, finales: ReadonlyMap<string, number>, maintenant: number, dansDock: boolean): VueDock | null {
  const envois = e.operations.filter((o): o is OpEnvoi => o.type === "envoi");
  const op = envois[envois.length - 1];
  const glisserEnCours = e.glisser !== null || (e.survol.actif && e.survol.provenance === "aethryon");
  if (op && !glisserEnCours) {
    const s = op.envoi;
    const p = projet(inst);
    if (!estFinal(s)) {
      return { etat: "en-cours", titre: "Envoyé au panneau…", sousTitre: "Premiere Pro confirme l'import", accepte: false, op: op.id, envoi: s.etat };
    }
    const fin = finales.get(op.id);
    const duree = AFFICHAGE_RESULTAT[s.etat as keyof typeof AFFICHAGE_RESULTAT];
    if (fin === undefined || maintenant - fin < duree) {
      if (s.etat === "importe") {
        const m = s.message.match(/\(([^()]+)\)\s*$/);
        const nom = p ?? (m ? m[1] : null);
        return { etat: "reussie", titre: nom ? `Importé dans ${nom}` : "Importé dans Premiere Pro", sousTitre: s.message, accepte: false, op: op.id, envoi: s.etat };
      }
      if (s.etat === "non-connecte") return { etat: "echec", titre: "Rien n'a été envoyé", sousTitre: s.message.replace(/\s*Rien n'a été envoyé\.?\s*$/, ""), accepte: false, op: op.id, envoi: s.etat, horloge: true };
      if (s.etat === "expire") return { etat: "echec", titre: "Demande expirée", sousTitre: s.message, accepte: false, op: op.id, envoi: s.etat };
      if (s.etat === "echec") return { etat: "echec", titre: "Import non effectué", sousTitre: s.message, accepte: false, op: op.id, envoi: s.etat };
    }
  }
  if (!glisserEnCours) return null;
  const ids = e.glisser?.ids ?? e.survol.classement?.medias ?? [];
  if (inst && !inst.liaison.connecte) {
    return { etat: "invalide", titre: "Premiere Pro n'est pas connecté", sousTitre: "Ouvrez le panneau AETHRYON dans Premiere Pro", horloge: true, accepte: false, op: null, envoi: null };
  }
  if (inst?.liaison.panneau && inst.liaison.panneau.projetOuvert === false) {
    return { etat: "invalide", titre: "Aucun projet ouvert", sousTitre: "Ouvrez un projet dans Premiere Pro", accepte: false, op: null, envoi: null };
  }
  if (inst && ids.some((id) => inst.index.medias.find((m) => m.id === id)?.etat !== "disponible")) {
    return { etat: "invalide", titre: "Ce média n'est pas encore prêt", sousTitre: null, accepte: false, op: null, envoi: null };
  }
  const p = projet(inst);
  if (dansDock || e.survol.zone === "premiere") {
    return { etat: "survolee", titre: "Relâchez pour importer", sousTitre: p ? `dans ${p}` : "dans le projet ouvert", accepte: true, op: null, envoi: null };
  }
  return { etat: "revelee", titre: "Envoyer vers Premiere Pro", sousTitre: p ? `Projet : ${p}` : "Projet ouvert dans Premiere Pro", accepte: true, op: null, envoi: null };
}

// ---- Imports de fichiers externes (progression RÉELLE du socle) ------------------------------------------------------------

export interface VueImport {
  op: string;
  lot: string;
  fichiers: { nom: string; chemin: string }[];
  /** 0 à 1, d'après les octets copiés (faitLot / tailleLot) ; null tant qu'aucun avis n'est arrivé. */
  progression: number | null;
  /** Fichier en cours et sa progression propre. */
  courant: { nom: string; progression: number | null; etape: "verification" | "copie" | "termine" } | null;
  fini: boolean;
  erreur: string | null;
}

export function vueImport(o: OpImport): VueImport {
  const p = o.progression;
  return {
    op: o.id,
    lot: o.lot,
    fichiers: o.fichiers.map((f) => ({ nom: f.nom, chemin: f.chemin })),
    progression: p && p.tailleLot > 0 ? Math.min(1, p.faitLot / p.tailleLot) : null,
    courant: p && p.nom ? { nom: p.nom, progression: p.taille > 0 ? Math.min(1, p.fait / p.taille) : null, etape: p.etape } : null,
    fini: o.bilan !== null || o.erreur !== null,
    erreur: o.erreur,
  };
}
