// Mise à jour en un clic (3.6.1, docs/EXTENSION.md §8 et §12 ; contrat d'échange §6) : une extension chargée « non
// empaquetée » ne peut pas remplacer ses propres fichiers. Elle le demande à AETHRYON Desktop par Native Messaging
// (`fr.aethryon.desktop`) :
// - message en liste fermée `{type:"mettre-a-jour-extension", version}` : la version vue annoncée, RIEN d'autre (ni
//   adresse, ni chemin, ni jeton). Desktop lit lui-même latest.json à l'adresse figée du site, télécharge, vérifie
//   (taille, SHA-256, contenu de l'archive, identifiant de production) et installe dans son DOSSIER GÉRÉ
//   (%LOCALAPPDATA%\AETHRYON\extension), en gardant la version précédente ;
// - un port dédié (jamais celui des transferts) : Desktop y envoie ses étapes réelles `{type:"avancement",
//   etape, fait, total}` (téléchargement, vérification, installation), puis la réponse finale ;
// - réussite : le service worker note la version attendue et le dossier, puis chrome.runtime.reload(). Au
//   redémarrage, si la version chargée n'a pas changé, l'extension n'est pas chargée depuis le dossier géré : le popup
//   et les réglages l'expliquent une fois, avec le chemin EXACT que Desktop a donné (reloadOutcome) ;
// - Desktop absent, trop ancien, refus ou permission non accordée : repli sur la page de téléchargement.
import { cleanText } from "../shared/messages.ts";
import type { DesktopUpdateResult, LoadHint, UpdateStep } from "../shared/types.ts";
import { compareVersions } from "./update.ts";
import type { NativePort } from "./desktop.ts";

export const RELOAD_KEY = "updateReload";
export const HINT_KEY = "updateLoadHint";
/** Une demande de rechargement plus ancienne est ignorée (le navigateur a été fermé entre-temps, par exemple). */
export const RELOAD_MAX_AGE_MS = 15 * 60_000;
export const UPDATE_TIMEOUT_MS = 6 * 60_000;
/** Réponse d'un Desktop 1.0.0-beta.3 ou plus ancien (desktop/noyau/src/nm.rs) : il ne connaît pas ce message. */
const UNKNOWN_TYPE = "Type de message inconnu.";

const STEPS: readonly UpdateStep[] = ["telechargement", "verification", "installation"];

const MSG = {
  permission: "Sans l'autorisation de communiquer avec AETHRYON Desktop, la mise à jour passe par la page de téléchargement.",
  absent: "AETHRYON Desktop n'est pas installé sur ce PC, ou ne répond pas : la mise à jour passe par la page de téléchargement.",
  ancien: "Ton AETHRYON Desktop ne sait pas encore mettre à jour l'extension : mets-le d'abord à jour (Paramètres › Mises à jour), ou passe par la page de téléchargement.",
  delai: "AETHRYON Desktop n'a pas terminé la mise à jour à temps. Réessaie, ou passe par la page de téléchargement.",
  refus: "AETHRYON Desktop n'a pas pu mettre à jour l'extension.",
};

/** Dossier donné par Desktop : un chemin à AFFICHER (jamais ouvert ni transmis), sans caractère de contrôle. */
export function cleanFolder(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 3 || v.length > 500) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

export interface DesktopUpdateOptions {
  /** chrome.runtime.connectNative(DESKTOP_HOST), ou null sans la permission (API absente). */
  connect: () => NativePort | null;
  version: string;
  onStep?: (step: UpdateStep, done: number, total: number) => void;
  /** chrome.runtime.lastError?.message, lu dans onDisconnect (jamais affiché). */
  lastError?: () => string | undefined;
  timeoutMs?: number;
}

/** Demande la mise à jour à AETHRYON Desktop sur un port dédié. Ne lève jamais. */
export function runDesktopUpdate(o: DesktopUpdateOptions): Promise<DesktopUpdateResult> {
  return new Promise((resolve) => {
    let port: NativePort | null = null;
    let done = false;
    let step: UpdateStep | undefined;
    const finish = (r: DesktopUpdateResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        port?.disconnect(); // l'hôte lit la fin de son entrée et s'arrête
      } catch { /* déjà fermé */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "delai", message: MSG.delai, ...(step ? { step } : {}) }), o.timeoutMs ?? UPDATE_TIMEOUT_MS);
    try {
      port = o.connect();
    } catch {
      port = null;
    }
    if (!port) {
      finish({ ok: false, reason: "permission", message: MSG.permission });
      return;
    }
    port.onMessage.addListener((m: unknown) => {
      if (done || typeof m !== "object" || m === null) return;
      const r = m as Record<string, unknown>;
      if (r.type === "avancement") {
        const s = STEPS.find((x) => x === r.etape);
        if (!s) return;
        step = s;
        const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
        o.onStep?.(s, n(r.fait), n(r.total));
        return;
      }
      if (r.ok === true) {
        const folder = cleanFolder(r.dossier);
        if (typeof r.version !== "string" || compareVersions(r.version, r.version) !== 0 || !folder) {
          finish({ ok: false, reason: "refus", message: MSG.refus });
          return;
        }
        finish({ ok: true, version: r.version, folder, already: r.deja === true });
        return;
      }
      if (r.ok === false) {
        if (r.erreur === UNKNOWN_TYPE) {
          finish({ ok: false, reason: "ancien", message: MSG.ancien });
          return;
        }
        const s = STEPS.find((x) => x === r.etape) ?? step;
        // Texte de l'hôte : nettoyé, puis espaces insécables de la typographie française (« : », guillemets).
        const why = typeof r.erreur === "string" ? cleanText(r.erreur, 300).replace(/ ([:;!?»])/g, "\u00a0$1").replace(/« /g, "«\u00a0") : "";
        finish({ ok: false, reason: "refus", message: why ? `${MSG.refus} ${why}` : MSG.refus, ...(s ? { step: s } : {}) });
      }
    });
    port.onDisconnect.addListener(() => {
      try {
        void o.lastError?.(); // lu pour que Chrome ne le signale pas ; jamais affiché
      } catch { /* rien */ }
      finish({ ok: false, reason: "absent", message: MSG.absent, ...(step ? { step } : {}) });
    });
    try {
      port.postMessage({ type: "mettre-a-jour-extension", version: o.version });
    } catch {
      finish({ ok: false, reason: "absent", message: MSG.absent });
    }
  });
}

export interface PendingReload {
  from: string;
  to: string;
  folder: string;
  at: number;
}

export function parsePending(v: unknown): PendingReload | null {
  if (typeof v !== "object" || v === null) return null;
  const p = v as Record<string, unknown>;
  const folder = cleanFolder(p.folder);
  if (typeof p.from !== "string" || typeof p.to !== "string" || compareVersions(p.from, p.to) === null || !folder || typeof p.at !== "number") return null;
  return { from: p.from, to: p.to, folder, at: p.at };
}

export function parseHint(v: unknown): LoadHint | null {
  if (typeof v !== "object" || v === null) return null;
  const h = v as Record<string, unknown>;
  const folder = cleanFolder(h.folder);
  if (typeof h.version !== "string" || typeof h.loaded !== "string" || compareVersions(h.version, h.loaded) === null || !folder) return null;
  return { version: h.version, folder, loaded: h.loaded };
}

/**
 * Au démarrage du service worker : que dire après un rechargement demandé par une mise à jour ?
 * - version chargée = version attendue (ou plus récente) : réussite, plus d'explication ;
 * - version inchangée : l'extension ne vient pas du dossier géré → explication du chargement unique ;
 * - explication déjà en place et version désormais à jour (l'utilisateur a chargé le dossier) : retirée.
 */
export function reloadOutcome(pending: PendingReload | null, hint: LoadHint | null, current: string, now = Date.now()): { hint: LoadHint | null; updated: string | null } {
  if (pending && now - pending.at >= 0 && now - pending.at < RELOAD_MAX_AGE_MS) {
    const c = compareVersions(current, pending.to);
    if (c !== null && c >= 0) return { hint: null, updated: current };
    if (current === pending.from) return { hint: { version: pending.to, folder: pending.folder, loaded: current }, updated: null };
  }
  if (hint) {
    const c = compareVersions(current, hint.version);
    if (c !== null && c >= 0) return { hint: null, updated: null };
    return { hint: { ...hint, loaded: current }, updated: null };
  }
  return { hint: null, updated: null };
}
