// Enregistrement dans Téléchargements/AETHRYON (destination « Premiere Pro », 3.5.1, docs/EXTENSION.md §11).
// Le nom du fichier vient du serveur (Content-Disposition de ytapi) : il n'est connu qu'au moment où Chrome le
// détermine, d'où chrome.downloads.onDeterminingFilename, qui propose « AETHRYON/<ce nom> ».
// - L'écouteur n'est posé QUE pendant qu'un téléchargement « Premiere » se lance ou attend son nom : le reste du
//   temps, aucun écouteur, et Chrome nomme tous les fichiers (ceux des sites, ceux de l'extension vers
//   Téléchargements) exactement comme avant. Pendant ce court moment, un fichier d'un site ou d'une autre extension
//   reçoit tout de suite la réponse « rien à changer » (suggest() sans argument : le nom de Chrome).
// - Seuls les identifiants rendus par NOS appels downloads.download() « Premiere » vont dans AETHRYON/.
// - Course : l'événement peut arriver avant que downloads.download() ait rendu l'identifiant. Un fichier lancé par
//   l'extension pendant un de ses lancements en cours attend donc (au plus HOLD_MS) de savoir lequel il est.
// - Noms choisis par l'extension (image de la vidéo, miniature : downloads.download({ filename })) : Chrome 153
//   les OUBLIE dès qu'un écouteur répond suggest() sans argument (vérifié dans tests/browser/premiere.test.mjs :
//   « download.png »). Ces téléchargements sont donc notés (withName) et, si l'écouteur est posé à ce moment-là,
//   reçoivent explicitement leur nom ; sans écouteur, Chrome les nomme comme avant.
// - conflictAction « uniquify » : un fichier du même nom déjà présent n'est jamais écrasé (« nom (1).mp4 »).
// Aucun jeton ni aucune adresse ici : seulement des identifiants de téléchargement et des noms de fichier.
import { PREMIERE_FOLDER } from "../shared/premiere.ts";

type Suggestion = chrome.downloads.FilenameSuggestion;
type Suggest = (suggestion?: Suggestion) => void;
type Item = Pick<chrome.downloads.DownloadItem, "id" | "filename"> & { byExtensionId?: string };
type Listener = (item: Item, suggest: Suggest) => boolean | undefined;
type Timer = ReturnType<typeof setTimeout>;

export interface FilenameEvent {
  addListener(fn: Listener): void;
  removeListener(fn: Listener): void;
}

/** Délai maximal d'attente d'un fichier de l'extension arrivé avant la fin d'un lancement (puis : nom de Chrome). */
export const HOLD_MS = 10_000;
/** Délai maximal pendant lequel un identifiant attend que Chrome détermine son nom. */
export const EXPECT_MS = 120_000;

/** « AETHRYON/<nom> » à partir du nom choisi par Chrome (le nom seul, jamais un chemin), ou null. */
export function premiereTarget(filename: unknown): string | null {
  if (typeof filename !== "string") return null;
  const base = (filename.split(/[\\/]/).pop() ?? "").trim();
  if (!base || base === "." || base === ".." || base.length > 255) return null;
  return `${PREMIERE_FOLDER}/${base}`;
}

export interface RouterOptions {
  /** Identifiant de NOTRE extension (DownloadItem.byExtensionId des fichiers lancés par elle). */
  extensionId: () => string;
  /** chrome.downloads.onDeterminingFilename (lu à chaque pose : un nouveau worker a un nouvel objet chrome). */
  event: () => FilenameEvent | undefined;
  holdMs?: number;
  expectMs?: number;
}

export type PremiereRouter = ReturnType<typeof createPremiereRouter>;

export function createPremiereRouter(opts: RouterOptions) {
  const holdMs = opts.holdMs ?? HOLD_MS;
  const expectMs = opts.expectMs ?? EXPECT_MS;
  /** Identifiants « Premiere » rendus par downloads.download(), dont Chrome n'a pas encore déterminé le nom. */
  const expected = new Map<number, Timer>();
  /** Téléchargements de l'extension avec un nom choisi par elle (image, miniature), en attente de leur nom. */
  const named = new Map<number, { filename: string; timer: Timer }>();
  /** Fichiers de l'extension arrivés pendant un lancement en cours : en attente de savoir lesquels ils sont. */
  const held = new Map<number, { item: Item; suggest: Suggest; timer: Timer }>();
  let launching = 0; // lancements « Premiere » en cours
  let naming = 0; // lancements avec un nom choisi par l'extension, en cours
  let on: FilenameEvent | null = null;

  const answer = (suggest: Suggest, suggestion?: Suggestion): void => {
    try {
      if (suggestion) suggest(suggestion);
      else suggest();
    } catch { /* téléchargement disparu entre-temps */ }
  };
  const keepName = (filename: string): Suggestion => ({ filename, conflictAction: "uniquify" });

  /** Nom proposé pour NOTRE fichier « Premiere » (sinon le nom de Chrome, inchangé). */
  function route(item: Item, suggest: Suggest): void {
    const filename = premiereTarget(item.filename);
    answer(suggest, filename ? keepName(filename) : undefined);
  }

  const listener: Listener = (item, suggest) => {
    const id = item?.id;
    if (typeof id === "number" && expected.has(id)) {
      clearTimeout(expected.get(id));
      expected.delete(id);
      route(item, suggest);
      settle();
      return undefined;
    }
    const n = typeof id === "number" ? named.get(id) : undefined;
    if (n) {
      clearTimeout(n.timer);
      named.delete(id);
      answer(suggest, keepName(n.filename)); // le nom que l'extension avait choisi, que Chrome oublierait
      return undefined;
    }
    // Lancé par l'extension pendant qu'un de ses downloads.download() n'a pas encore rendu son identifiant :
    // peut-être lui. Réponse asynchrone (return true), au plus tard après holdMs.
    if (typeof id === "number" && launching + naming > 0 && item.byExtensionId === opts.extensionId() && !held.has(id)) {
      const timer = setTimeout(() => release(id), holdMs);
      held.set(id, { item, suggest, timer });
      return true;
    }
    answer(suggest); // pas le nôtre : nom de Chrome, sans attente
    return undefined;
  };

  function release(id: number, suggestion?: Suggestion): void {
    const h = held.get(id);
    if (!h) return;
    clearTimeout(h.timer);
    held.delete(id);
    answer(h.suggest, suggestion);
    settle();
  }

  /** Plus aucun lancement en cours : les fichiers encore retenus ne sont pas à nous, Chrome les nomme. */
  function releaseIfIdle(): void {
    if (launching + naming > 0) return;
    for (const id of [...held.keys()]) release(id);
  }

  function register(): void {
    if (on) return;
    const ev = opts.event();
    if (!ev) return;
    try {
      ev.addListener(listener);
      on = ev;
    } catch { /* API absente : le fichier va dans Téléchargements */ }
  }

  /** Plus rien en attente : l'écouteur est retiré (les autres téléchargements ne passent plus par nous). */
  function settle(): void {
    if (!on || launching > 0 || expected.size > 0 || held.size > 0) return;
    try {
      on.removeListener(listener);
    } catch { /* déjà retiré */ }
    on = null;
  }

  function forget(id: number): void {
    if (expected.has(id)) {
      clearTimeout(expected.get(id));
      expected.delete(id);
    }
    const n = named.get(id);
    if (n) {
      clearTimeout(n.timer);
      named.delete(id);
    }
    release(id);
    settle();
  }

  /** Identifiant rendu par downloads.download() pour un fichier « Premiere ». */
  function claim(id: number): void {
    const h = held.get(id);
    if (h) {
      const filename = premiereTarget(h.item.filename);
      release(id, filename ? keepName(filename) : undefined);
      return;
    }
    clearTimeout(expected.get(id));
    expected.set(id, setTimeout(() => forget(id), expectMs));
  }

  /** Identifiant rendu par downloads.download({ filename }) : ce nom lui sera rendu si l'écouteur est posé. */
  function claimNamed(id: number, filename: string): void {
    if (held.has(id)) {
      release(id, keepName(filename));
      return;
    }
    const old = named.get(id);
    if (old) clearTimeout(old.timer);
    named.set(id, { filename, timer: setTimeout(() => forget(id), expectMs) });
  }

  return {
    /**
     * Lance un téléchargement « Premiere » (`start` appelle downloads.download et rend son identifiant) :
     * écouteur posé AVANT l'appel, identifiant retenu dès qu'il est connu.
     */
    async launch(start: () => Promise<number>): Promise<number> {
      register();
      launching++;
      let id: number | undefined;
      try {
        id = await start();
        return id;
      } finally {
        launching--;
        if (typeof id === "number") claim(id);
        releaseIfIdle();
        settle();
      }
    },
    /**
     * Lance un téléchargement de l'extension au nom choisi par elle (`filename`, déjà passé à downloads.download) :
     * aucun écouteur posé ; si un envoi vers Premiere en a posé un, ce nom est redonné à Chrome.
     */
    async withName(start: () => Promise<number>, filename: string | undefined): Promise<number> {
      if (!filename) return start();
      naming++;
      let id: number | undefined;
      try {
        id = await start();
        return id;
      } finally {
        naming--;
        if (typeof id === "number") claimNamed(id, filename);
        releaseIfIdle();
        settle();
      }
    },
    /** Téléchargement terminé, interrompu ou annulé : plus rien à attendre pour lui. */
    forget,
    /** Arrêt du worker (tests) : réponses en attente rendues, écouteur retiré. */
    stop(): void {
      for (const t of expected.values()) clearTimeout(t);
      expected.clear();
      for (const n of named.values()) clearTimeout(n.timer);
      named.clear();
      launching = 0;
      naming = 0;
      releaseIfIdle();
      settle();
    },
    /** Tests : état courant. */
    get listening(): boolean { return on !== null; },
    get pending(): number { return expected.size + held.size; },
    listener,
  };
}
