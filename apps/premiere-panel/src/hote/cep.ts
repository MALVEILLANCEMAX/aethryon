// Coque CEP 12 (Premiere 25.x et 26.x) : implémentation de « Hote » avec
//   - CSInterface (sous-ensemble minimal, écrit ici d'après la bibliothèque officielle d'Adobe : window.__adobe_cep__) ;
//   - ExtendScript par appels FIGÉS : AETHRYON.appel("<nom>", "<JSON encodé>") — jamais de code construit librement ;
//   - Node.js 17.7.1 (cep_node.require) pour le réseau, les fichiers et la clé (src/noeud/services.ts).
// NON TESTÉ DANS PREMIERE : ce fichier ne s'exécute que dans Premiere ; sa logique Node est essayée à part.

import { VERSION } from "../version";
import { poserFormatsGlisser } from "../lib/glisser";
import { creerServicesNoeud, type RequireNoeud } from "../noeud/services";
import type {
  BilanImport, Capacites, Environnement, EtatSignature, Hote, InfoProjet, ModeChutier, ResultatAction, ResultatEssaiImport,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AdobeCep {
  evalScript(script: string, rappel?: (resultat: string) => void): void;
  getHostEnvironment(): string;
  getSystemPath(type: string): string;
  getCurrentApiVersion?(): string;
  addEventListener(type: string, f: (e: any) => void, obj?: unknown): void;
  invokeSync(nom: string, arg: string): string;
  registerKeyEventsInterest?(json: string): void;
  getExtensionId?(): string;
}

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep;
    cep?: { util?: { openURLInDefaultBrowser(url: string): void }; fs?: any; process?: any };
    cep_node?: { require: RequireNoeud; process?: any; Buffer?: any };
  }
}

export function cepPresent(): boolean {
  return typeof window !== "undefined" && !!window.__adobe_cep__;
}

type FonctionES = "ping" | "projet" | "importer" | "presentsDansProjet" | "presentsDansSequence" | "insererTeteLecture" | "ouvrirMoniteurSource" | "essaiImport";

export function creerHoteCep(): Hote {
  const cep = window.__adobe_cep__!;
  const req: RequireNoeud | undefined = window.cep_node?.require ?? (window as any).require;
  if (!req) throw new Error("Node.js n’est pas activé pour ce panneau (--enable-nodejs absent du manifeste).");
  const os = req("os");
  // Chemins natifs : Windows chez le propriétaire (path = path.win32) ; macOS possible ; POSIX dans les essais.
  const pathW = req("path");
  const proc = req("process");
  const windows = proc.platform === "win32";

  const env = (() => {
    try {
      return JSON.parse(cep.getHostEnvironment());
    } catch {
      return {};
    }
  })();

  function cheminSysteme(type: string): string | null {
    try {
      let p = decodeURI(cep.getSystemPath(type) || "");
      p = windows ? p.replace(/^file:\/\/\//, "").replace(/\//g, "\\") : p.replace(/^file:\/\//, "");
      return p || null;
    } catch {
      return null;
    }
  }

  const accueil = os.homedir();
  const appdata = proc.env.APPDATA || pathW.join(accueil, "AppData", "Roaming");
  const localappdata = proc.env.LOCALAPPDATA || pathW.join(accueil, "AppData", "Local");
  const dossierDonnees = pathW.join(appdata, "AETHRYON", "premiere");
  const racineEchanges = pathW.join(localappdata, "AETHRYON");
  const dossierExtension = cheminSysteme("extension");
  const journalFichier = (niveau: string, message: string) => {
    const j = new Date().toISOString().slice(0, 10);
    const ligne = `${new Date().toISOString()} [${niveau}] ${message}\n`;
    try {
      const fs = req("fs");
      fs.mkdirSync(pathW.join(racineEchanges, "journaux"), { recursive: true });
      fs.appendFileSync(pathW.join(racineEchanges, "journaux", `panneau-${j}.log`), ligne);
    } catch {
      /* journal facultatif */
    }
  };

  const services = creerServicesNoeud(req, {
    dossierDonnees,
    dossiersInternes: () => [pathW.join(racineEchanges, "premiere"), dossierDonnees],
    dossiersEchange: () => [pathW.join(racineEchanges, "commandes")],
    userAgent: `AETHRYON-Premiere/${VERSION} (CEP; Premiere ${env.appVersion || "?"})`,
    journal: journalFichier,
  });

  function appel<T>(nom: FonctionES, args: unknown, delai = 120000): Promise<T> {
    // Charge encodée : seuls [A-Za-z0-9-_.!~*'()%] passent ; le script hôte la relit sans eval.
    const charge = encodeURIComponent(JSON.stringify(args ?? {}));
    const script = `AETHRYON.appel("${nom}", "${charge}")`;
    return new Promise((resoudre, rejeter) => {
      const minuteur = setTimeout(() => rejeter(new Error("Premiere ne répond pas (ExtendScript)")), delai);
      cep.evalScript(script, (r) => {
        clearTimeout(minuteur);
        if (!r || r === "EvalScript error.") {
          rejeter(new Error("Script hôte AETHRYON indisponible (aethryon.jsx non chargé)"));
          return;
        }
        try {
          resoudre(JSON.parse(r) as T);
        } catch {
          rejeter(new Error("Réponse illisible du script hôte"));
        }
      });
    });
  }

  const abonnesVisibilite = new Set<(v: boolean) => void>();
  const annoncerVisibilite = (v: boolean) => abonnesVisibilite.forEach((f) => f(v));
  document.addEventListener("visibilitychange", () => annoncerVisibilite(document.visibilityState === "visible"));
  try {
    cep.addEventListener("com.adobe.csxs.events.WindowVisibilityChanged", (e: any) => annoncerVisibilite(String(e && e.data) !== "false"));
  } catch {
    /* événement absent : visibilitychange suffit */
  }

  let rappelMenu: ((id: string) => void) | null = null;
  try {
    cep.addEventListener("com.adobe.csxs.events.flyoutMenuClicked", (e: any) => {
      const d = typeof e?.data === "string" ? safeParse(e.data) : e?.data;
      if (d && typeof d.menuId === "string" && rappelMenu) rappelMenu(d.menuId);
    });
  } catch {
    /* menu facultatif */
  }

  const hote: Hote = {
    nom: "cep",

    async environnement(): Promise<Environnement> {
      let cepVersion: string | null = null;
      try {
        const v = JSON.parse(cep.getCurrentApiVersion?.() || "null");
        if (v) cepVersion = `${v.major}.${v.minor}.${v.micro}`;
      } catch {
        /* facultatif */
      }
      let premiereVersion: string | null = env.appVersion || null;
      try {
        const r = await appel<{ premiere?: string }>("ping", {}, 10000);
        if (r.premiere) premiereVersion = r.premiere;
      } catch {
        /* le diagnostic le signalera */
      }
      return {
        hote: "cep", premiereVersion, cepVersion,
        nodeVersion: proc.versions?.node || null,
        chromiumVersion: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || null,
        os: services.systeme.os(), nomMachine: services.systeme.nomMachine(),
        dossierMediasParDefaut: pathW.join(accueil, "Downloads", "AETHRYON"),
        dossierDonnees, racineEchanges, extensionVersion: VERSION, dossierExtension, posix: !windows,
      };
    },

    async capacites(): Promise<Capacites> {
      return {
        glisserVersPremiere: "a-prouver", lectureVideoLocale: true, premiere: true, reseau: true,
        coffre: (await services.coffre.protection()) || "dpapi", choisirDossier: !!window.cep?.fs?.showOpenDialogEx,
        afficherDansExplorateur: services.systeme.windows,
      };
    },

    signature: (): Promise<EtatSignature> => services.systeme.signature(dossierExtension),
    http: services.http,
    telecharger: services.telecharger,
    fichiers: services.fichiers,
    coffre: services.coffre,

    premiere: {
      async projet(): Promise<InfoProjet | null> {
        const r = await appel<{ projet: InfoProjet | null }>("projet", {}, 15000);
        return r.projet || null;
      },
      async importer(chemins: string[], mode: ModeChutier): Promise<BilanImport> {
        const r = await appel<any>("importer", { chemins, mode });
        return { ok: !!r.ok, chutier: r.chutier ?? null, projet: r.projet ?? null, resultats: Array.isArray(r.resultats) ? r.resultats : [], message: r.code === "aucunProjet" ? "aucunProjet" : r.note || undefined };
      },
      async presentsDansProjet(chemins: string[]) {
        if (!chemins.length) return [];
        const r = await appel<{ presents?: string[] }>("presentsDansProjet", { chemins }, 30000);
        return r.presents || [];
      },
      async presentsDansSequence(chemins: string[]) {
        const r = await appel<{ presents?: string[] }>("presentsDansSequence", { chemins }, 30000);
        return r.presents || [];
      },
      insererTeteLecture: (chemin: string, mode: ModeChutier) => appel<ResultatAction>("insererTeteLecture", { chemin, mode }),
      ouvrirMoniteurSource: (chemin: string) => appel<ResultatAction>("ouvrirMoniteurSource", { chemin }, 20000),
      essaiImport: (chemin: string) => appel<ResultatEssaiImport>("essaiImport", { chemin }),
    },

    async ouvrirUrl(url: string) {
      if (!/^https:\/\//.test(url)) throw new Error("Adresse refusée");
      if (window.cep?.util?.openURLInDefaultBrowser) window.cep.util.openURLInDefaultBrowser(url);
      else throw new Error("Ouverture du navigateur indisponible");
    },

    afficherDansExplorateur: services.systeme.afficherDansExplorateur,

    async choisirDossier(initial: string, titre: string) {
      const f = window.cep?.fs;
      if (!f?.showOpenDialogEx) return null;
      const r = f.showOpenDialogEx(false, true, titre, initial, [], "", "Choisir");
      return r && r.err === 0 && Array.isArray(r.data) && r.data[0] ? String(r.data[0]) : null;
    },

    async copierTexte(texte: string) {
      try {
        await navigator.clipboard.writeText(texte);
        return true;
      } catch {
        const zone = document.createElement("textarea");
        zone.value = texte;
        zone.setAttribute("readonly", "");
        zone.style.position = "fixed";
        zone.style.opacity = "0";
        document.body.appendChild(zone);
        zone.select();
        const ok = document.execCommand("copy");
        zone.remove();
        return ok;
      }
    },

    preparerGlisser: (dt, chemins) => poserFormatsGlisser(dt, chemins, services.fichiers.urlLocale),

    surVisibilite(f) {
      abonnesVisibilite.add(f);
      return () => abonnesVisibilite.delete(f);
    },

    definirMenu(entrees, f) {
      rappelMenu = f;
      const xml = "<Menu>" + entrees.map((e) => (e.separateur ? '<MenuItem Label="---" />' : `<MenuItem Id="${xmlEchap(e.id)}" Label="${xmlEchap(e.libelle)}" Enabled="true" Checked="false"/>`)).join("") + "</Menu>";
      try {
        cep.invokeSync("setPanelFlyoutMenu", xml);
      } catch {
        /* menu facultatif */
      }
    },

    touchesVoulues(codes) {
      try {
        cep.registerKeyEventsInterest?.(JSON.stringify(codes.map((keyCode) => ({ keyCode }))));
      } catch {
        /* facultatif : sans cela Premiere garde ses raccourcis */
      }
    },

    journaliser: journalFichier,
  };
  return hote;
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function xmlEchap(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
