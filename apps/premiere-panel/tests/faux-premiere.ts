// FAUX Premiere pour les essais : modèle de projet en mémoire (chutiers, clips, séquence, moniteur source) et
// exécution du VRAI script hôte cep/jsx/aethryon.jsx dans node:vm. Les règles imitées sont celles de la
// documentation ExtendScript de Premiere ; le comportement réel reste NON TESTÉ DANS PREMIERE.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

export const SOURCE = readFileSync(join(__dirname, "..", "cep", "jsx", "aethryon.jsx"), "utf8");
export const T = { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 };

export type Item = { name: string; type: number; chemin?: string; parent?: Item; children?: Item[] & { numItems?: number }; [k: string]: unknown };

function collection<X>(arr: X[]): X[] & { numItems: number } {
  Object.defineProperty(arr, "numItems", { get() { return arr.length; } });
  return arr as X[] & { numItems: number };
}

export function monde(o: { existants?: string[]; refuse?: RegExp; sansProjet?: boolean } = {}) {
  // Windows : l'existence d'un fichier ne dépend ni de la casse ni du séparateur.
  const norm = (c: string) => c.replace(/\//g, "\\").toLowerCase();
  const existants = new Set((o.existants || []).map(norm));
  const bin = (name: string, parent?: Item): Item => {
    const b: Item = { name, type: T.BIN, parent, children: collection<Item>([]) };
    b.createBin = (n: string) => { const nb = bin(n, b); b.children!.push(nb); return nb; };
    b.deleteBin = () => { const i = b.parent!.children!.indexOf(b); if (i >= 0) b.parent!.children!.splice(i, 1); };
    b.getMediaPath = () => "";
    return b;
  };
  const root = bin("racine");
  root.type = T.ROOT;
  let selection: Item = root;
  const piste = () => ({ clips: collection<{ projectItem: Item }>([]), isLocked: () => false, insertClip(item: Item) { this.clips.push({ projectItem: item }); } });
  const seq = { name: "Séquence 01", videoTracks: collection([piste()]) as unknown as { numTracks: number }, audioTracks: collection([piste()]) as unknown as { numTracks: number }, getPlayerPosition: () => ({ seconds: 4.2 }) };
  Object.defineProperty(seq.videoTracks, "numTracks", { get() { return 1; } });
  Object.defineProperty(seq.audioTracks, "numTracks", { get() { return 1; } });
  const importes: string[][] = [];
  const project = {
    name: "Montage-voyage.prproj", path: "C:\\Projets\\Montage-voyage.prproj", rootItem: root, activeSequence: seq,
    getInsertionBin: () => selection,
    importFiles(chemins: string[], _s: boolean, cible: Item) {
      importes.push(chemins);
      for (const c of chemins) {
        if (o.refuse && o.refuse.test(c)) continue;
        cible.children!.push({ name: c.split("\\").pop()!, type: T.CLIP, parent: cible, getMediaPath: () => c, isOffline: () => /hors-ligne/.test(c) });
      }
      return true;
    },
  };
  const contexte: Record<string, unknown> = {
    app: { project: o.sansProjet ? null : project, version: "26.5.2", sourceMonitor: { openFilePath: (c: string) => existants.has(norm(c)) } },
    ProjectItemType: T,
    File: function (this: { exists: boolean }, c: string) { this.exists = existants.has(norm(c)); },
    $: { version: "4.5.6" },
  };
  vm.createContext(contexte);
  vm.runInContext(SOURCE, contexte, { filename: "aethryon.jsx" });
  const appel = (nom: string, args: unknown = {}) => JSON.parse(vm.runInContext(`AETHRYON.appel(${JSON.stringify(nom)}, ${JSON.stringify(encodeURIComponent(JSON.stringify(args)))})`, contexte));
  /** Ce que fait CSInterface.evalScript : exécute la chaîne reçue dans le moteur ExtendScript. */
  const evalScript = (script: string): string => {
    try {
      return String(vm.runInContext(script, contexte));
    } catch {
      return "EvalScript error.";
    }
  };
  const ajouterExistant = (c: string) => existants.add(norm(c));
  return { appel, evalScript, ajouterExistant, root, project, seq, importes, selectionner: (b: Item) => (selection = b), contexte };
}

