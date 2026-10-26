// Services Node.js de la coque CEP : réseau (https), téléchargement en flux (.part puis renommage), fichiers, coffre de
// la clé (DPAPI par PowerShell, sinon fichier protégé par l'ACL du profil), Explorateur, signature.
//
// Ce module ne dépend que de la fonction « require » qu'on lui passe :
//   - dans Premiere : cep_node.require (Node.js 17.7.1 intégré à CEP 12, --enable-nodejs sans --mixed-context) ;
//   - dans les essais : le require de Node (vitest, banc Playwright). C'est donc LE MÊME code qui est essayé ici et qui
//     tourne dans Premiere. Compatible Node 17 : ni fetch, ni fs.statfs obligatoire, ni AbortSignal.any.
// Règles : aucune commande passée par un shell (execFile, arguments en tableau) ; la clé ne figure jamais dans un
// argument de processus, un message d'erreur ni un journal ; on n'écrase jamais un fichier existant.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  CleStockee, EtatSignature, ProtectionCle, RequeteHttp, ReponseHttp, RequeteTelechargement, ResultatAction,
  ResultatTelechargement, SuiviOctets,
} from "../hote/types";
import type { EntreeDossier } from "../lib/bibliotheque";

export type RequireNoeud = (module: string) => any;

export class ErreurHttp extends Error {
  constructor(public statut: number, public code: string, message: string, public reessayerDans: number | null = null, public corps: unknown = null) {
    super(message);
    this.name = "ErreurHttp";
  }
}

export interface OptionsServices {
  /** %APPDATA%\AETHRYON\premiere (réglages, récents, clé protégée). */
  dossierDonnees: string;
  /** Dossiers où le panneau peut supprimer SES fichiers (cache de miniatures, essais du diagnostic). */
  dossiersInternes: () => string[];
  /** Dossiers d'échange où le panneau peut DÉPLACER un fichier .json : R\commandes (prise des commandes, contrat §9). */
  dossiersEchange?: () => string[];
  /** Hôtes http (non chiffrés) admis : seulement 127.0.0.1/localhost pour les essais ; vide en production. */
  httpLocalAdmis?: boolean;
  userAgent?: string;
  journal?: (niveau: "info" | "attention" | "erreur", message: string) => void;
}

const LIMITE_JSON = 4 * 1024 * 1024;
const LIMITE_BINAIRE = 8 * 1024 * 1024;
const RESERVES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Nom de fichier sûr pour Windows : caractères interdits retirés, longueur bornée, noms réservés évités. */
export function nettoyerNomFichier(nom: string, repli = "AETHRYON"): string {
  let n = String(nom || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩​-‏]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const i = n.lastIndexOf(".");
  let base = i > 0 ? n.slice(0, i) : n;
  let ext = i > 0 ? n.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  base = base.replace(/[. ]+$/g, "").replace(/^[. ]+/g, "");
  if (!base || RESERVES.test(base)) base = repli + (base ? " " + base : "");
  if (base.length > 140) base = base.slice(0, 140).trim();
  n = ext ? `${base}.${ext}` : base;
  return n;
}

/** « Titre.mp4 » → « Titre (2).mp4 », « Titre (3).mp4 »… jusqu'à trouver un nom libre (et sans .part en cours). */
export async function nomLibre(dossier: string, nom: string, existe: (c: string) => Promise<boolean>, joindre: (a: string, b: string) => string): Promise<string> {
  const i = nom.lastIndexOf(".");
  const base = i > 0 ? nom.slice(0, i) : nom;
  const ext = i > 0 ? nom.slice(i) : "";
  for (let n = 1; n < 1000; n++) {
    const candidat = n === 1 ? nom : `${base} (${n})${ext}`;
    const chemin = joindre(dossier, candidat);
    if (!(await existe(chemin)) && !(await existe(chemin + ".aethryon.part"))) return chemin;
  }
  throw new Error("Aucun nom libre dans le dossier des médias");
}

function texteErreurReseau(e: any): string {
  const code = e && e.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Serveur introuvable : vérifie la connexion à Internet.";
  if (code === "ECONNREFUSED") return "Le serveur AETHRYON refuse la connexion.";
  if (code === "ECONNRESET" || code === "EPIPE") return "Connexion interrompue pendant l’échange avec le serveur.";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "DELAI") return "Le serveur ne répond pas (délai dépassé).";
  if (code && String(code).startsWith("CERT") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return "Certificat du serveur refusé : la connexion n’est pas sûre.";
  }
  if (code === "ABORT") return "Opération annulée.";
  return "Erreur réseau" + (code ? ` (${code})` : "") + ".";
}

export function creerServicesNoeud(req: RequireNoeud, o: OptionsServices) {
  const fs = req("fs");
  const fsp = fs.promises;
  const pathMod = req("path");
  const os = req("os");
  const urlMod = req("url");
  const crypto = req("crypto");
  const childProcess = req("child_process");
  // Dans CEP (contexte séparé), Buffer et process ne sont pas des globales de la page : on les prend par require.
  const Tampon = req("buffer").Buffer;
  const proc = req("process");
  const windows = os.platform() === "win32";
  const chemins = windows ? pathMod.win32 : pathMod;
  const journal = o.journal || (() => {});
  const ua = o.userAgent || "AETHRYON-Premiere/2.0.0 (CEP)";

  // ---- Réseau ------------------------------------------------------------------------------------------------------------
  function verifierUrl(brute: string): URL {
    let u: URL;
    try {
      u = new URL(brute);
    } catch {
      throw new ErreurHttp(0, "url", "Adresse invalide.");
    }
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (u.protocol === "https:") return u;
    if (u.protocol === "http:" && local && o.httpLocalAdmis) return u;
    throw new ErreurHttp(0, "url", "Adresse refusée : seules les connexions chiffrées (https) sont admises.");
  }

  function module(u: URL) {
    return req(u.protocol === "https:" ? "https" : "http");
  }

  /** Options explicites : un objet URL de la page (CEP, contexte séparé) n'est pas une URL de Node. */
  function options(u: URL, extra: Record<string, unknown>) {
    return { protocol: u.protocol, hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || undefined, path: u.pathname + u.search, ...extra };
  }

  async function http(r: RequeteHttp): Promise<ReponseHttp> {
    const u = verifierUrl(r.url);
    const corps = r.json === undefined ? null : Tampon.from(JSON.stringify(r.json), "utf8");
    const entetes: Record<string, string> = { "user-agent": ua, accept: r.reponse === "binaire" ? "image/*" : "application/json", ...(r.entetes || {}) };
    if (corps) {
      entetes["content-type"] = "application/json";
      entetes["content-length"] = String(corps.length);
    }
    return new Promise((resoudre, rejeter) => {
      const requete = module(u).request(options(u, { method: r.methode, headers: entetes, timeout: r.delaiMs ?? 30000 }), (res: any) => {
        const morceaux: any[] = [];
        let total = 0;
        const limite = r.reponse === "binaire" ? LIMITE_BINAIRE : LIMITE_JSON;
        res.on("data", (d: any) => {
          total += d.length;
          if (total > limite) {
            requete.destroy(Object.assign(new Error("trop gros"), { code: "TROP_GROS" }));
            return;
          }
          morceaux.push(d);
        });
        res.on("end", () => {
          const tampon = Tampon.concat(morceaux);
          const h: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers || {})) h[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
          const type = h["content-type"] || "";
          let json: unknown = null;
          if (r.reponse !== "binaire" || !/^image\//.test(type)) {
            try {
              json = tampon.length ? JSON.parse(tampon.toString("utf8")) : null;
            } catch {
              json = null;
            }
          }
          resoudre({
            statut: res.statusCode || 0, entetes: h, json, typeContenu: type,
            base64: r.reponse === "binaire" && /^image\//.test(type) ? tampon.toString("base64") : undefined,
          });
        });
        res.on("error", (e: any) => rejeter(new ErreurHttp(0, "reseau", texteErreurReseau(e))));
      });
      requete.on("timeout", () => requete.destroy(Object.assign(new Error("délai"), { code: "DELAI" })));
      requete.on("error", (e: any) => rejeter(new ErreurHttp(0, e && e.code === "TROP_GROS" ? "trop-gros" : "reseau", e && e.code === "TROP_GROS" ? "Réponse du serveur trop volumineuse." : texteErreurReseau(e))));
      if (corps) requete.write(corps);
      requete.end();
    });
  }

  // ---- Téléchargement en flux -----------------------------------------------------------------------------------------------
  async function telecharger(r: RequeteTelechargement, suivi: SuiviOctets, signal?: AbortSignal): Promise<ResultatTelechargement> {
    const u = verifierUrl(r.url);
    await fsp.mkdir(r.dossier, { recursive: true });
    const nom = nettoyerNomFichier(r.nomSouhaite);
    const final = await nomLibre(r.dossier, nom, existe, chemins.join);
    const partiel = final + ".aethryon.part";
    // « wx » : échoue si le fichier existe déjà (jamais d'écrasement, même en cas de course).
    const sortie = fs.createWriteStream(partiel, { flags: "wx" });
    let fini = false;
    const nettoyer = async () => {
      try {
        sortie.destroy();
      } catch {
        /* déjà fermé */
      }
      try {
        await fsp.unlink(partiel);
      } catch {
        /* rien à supprimer */
      }
    };
    try {
      const recus = await new Promise<number>((resoudre, rejeter) => {
        const echouer = (e: Error) => {
          if (!fini) {
            fini = true;
            rejeter(e);
          }
        };
        sortie.on("error", (e: any) => echouer(new ErreurHttp(0, "disque", e && (e.code === "ENOSPC") ? "Disque plein : libère de la place dans le dossier des médias." : "Écriture impossible dans le dossier des médias" + (e && e.code ? ` (${e.code})` : "") + ".")));
        const requete = module(u).get(options(u, { headers: { "user-agent": ua, accept: "*/*", ...(r.entetes || {}) }, timeout: 60000 }), (res: any) => {
          const statut = res.statusCode || 0;
          if (statut !== 200) {
            // Une redirection n'est jamais suivie : la clé ne doit partir vers aucun autre serveur.
            const morceaux: any[] = [];
            res.on("data", (d: any) => morceaux.length < 64 && morceaux.push(d));
            res.on("end", () => {
              let message = `Le serveur a répondu ${statut}.`;
              let code = "http";
              try {
                const j = JSON.parse(Tampon.concat(morceaux).toString("utf8"));
                if (j && typeof j.message === "string") message = j.message;
                else if (j && j.detail && typeof j.detail === "string") message = j.detail;
                if (j && typeof j.error === "string") code = j.error;
              } catch {
                /* corps non JSON */
              }
              echouer(new ErreurHttp(statut, code, message));
            });
            return;
          }
          const longueur = Number(res.headers["content-length"]);
          const total = isFinite(longueur) && longueur > 0 ? longueur : r.tailleAttendue ?? null;
          let n = 0;
          let dernier = 0;
          res.on("data", (d: any) => {
            n += d.length;
            const t = Date.now();
            if (t - dernier >= 250) {
              dernier = t;
              suivi(n, total);
            }
          });
          res.on("error", (e: any) => echouer(new ErreurHttp(0, "reseau", texteErreurReseau(e))));
          res.on("aborted", () => echouer(new ErreurHttp(0, "reseau", "Téléchargement interrompu par le réseau.")));
          sortie.on("finish", () => {
            if (fini) return;
            if (isFinite(longueur) && longueur > 0 && n !== longueur) {
              echouer(new ErreurHttp(0, "incomplet", `Fichier incomplet (${n} octets reçus sur ${longueur}).`));
              return;
            }
            fini = true;
            suivi(n, total);
            resoudre(n);
          });
          res.pipe(sortie);
        });
        requete.on("timeout", () => requete.destroy(Object.assign(new Error("délai"), { code: "DELAI" })));
        requete.on("error", (e: any) => echouer(new ErreurHttp(0, "reseau", texteErreurReseau(e))));
        if (signal) {
          if (signal.aborted) requete.destroy(Object.assign(new Error("annulé"), { code: "ABORT" }));
          signal.addEventListener("abort", () => requete.destroy(Object.assign(new Error("annulé"), { code: "ABORT" })), { once: true });
        }
      });
      if (recus === 0) throw new ErreurHttp(0, "vide", "Le serveur a envoyé un fichier vide.");
      if (r.tailleAttendue && recus !== r.tailleAttendue) {
        throw new ErreurHttp(0, "incomplet", `Taille inattendue (${recus} octets au lieu de ${r.tailleAttendue}).`);
      }
      // Renommage final ; si un fichier du même nom est apparu entre-temps, on prend un autre nom libre.
      let cible = final;
      if (await existe(cible)) cible = await nomLibre(r.dossier, chemins.basename(final), existe, chemins.join);
      await fsp.rename(partiel, cible);
      return { chemin: cible, taille: recus };
    } catch (e) {
      await nettoyer();
      throw e;
    }
  }

  // ---- Fichiers ------------------------------------------------------------------------------------------------------------
  async function existe(chemin: string): Promise<boolean> {
    try {
      await fsp.stat(chemin);
      return true;
    } catch {
      return false;
    }
  }

  async function lister(dossier: string): Promise<EntreeDossier[] | null> {
    let noms: any[];
    try {
      noms = await fsp.readdir(dossier, { withFileTypes: true });
    } catch {
      return null;
    }
    const sortie: EntreeDossier[] = [];
    for (const d of noms.slice(0, 5000)) {
      if (!d.isFile()) continue;
      try {
        const st = await fsp.stat(chemins.join(dossier, d.name));
        sortie.push({ nom: d.name, taille: st.size, modifie: st.mtimeMs, cree: st.birthtimeMs || st.ctimeMs, fichier: true });
      } catch {
        /* fichier disparu entre la liste et la mesure */
      }
    }
    return sortie;
  }

  async function lireTexte(chemin: string): Promise<string | null> {
    try {
      const st = await fsp.stat(chemin);
      if (st.size > LIMITE_JSON) return null;
      return await fsp.readFile(chemin, "utf8");
    } catch {
      return null;
    }
  }

  let compteurTmp = 0;
  const marque = crypto.randomBytes(4).toString("hex");
  async function ecrireAtomique(chemin: string, donnees: any, mode?: number) {
    await fsp.mkdir(chemins.dirname(chemin), { recursive: true });
    const tmp = `${chemin}.p${marque}-${++compteurTmp}.tmp`;
    await fsp.writeFile(tmp, donnees, mode ? { mode } : undefined);
    await fsp.rename(tmp, chemin);
  }

  function normal(c: string) {
    return String(c).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  }

  async function supprimerFichierInterne(chemin: string) {
    const c = normal(chemin);
    const interne = o.dossiersInternes().some((d) => c.startsWith(normal(d) + "\\"));
    if (!interne && !/\.aethryon\.part$/i.test(chemin)) throw new Error("Suppression refusée : ce fichier n’appartient pas au panneau.");
    try {
      await fsp.unlink(chemin);
    } catch (e: any) {
      if (e && e.code !== "ENOENT") throw e;
    }
  }

  /** Prise d'une commande par renommage (contrat §9) : seulement des .json sous les dossiers d'échange, jamais « .. ». */
  async function renommer(source: string, destination: string) {
    const echange = o.dossiersEchange ? o.dossiersEchange() : [];
    const admis = (c: string) => /\.json$/i.test(c) && !/(^|[\\/])\.\.([\\/]|$)/.test(c) && echange.some((d) => normal(c).startsWith(normal(d) + "\\"));
    if (!admis(source) || !admis(destination)) throw new Error("Déplacement refusé : seuls les fichiers des commandes d’AETHRYON Desktop peuvent être déplacés.");
    await fsp.mkdir(chemins.dirname(destination), { recursive: true });
    await fsp.rename(source, destination);
  }

  async function testerEcriture(dossier: string): Promise<ResultatAction> {
    try {
      await fsp.mkdir(dossier, { recursive: true });
      const temoin = chemins.join(dossier, `.aethryon-ecriture-${crypto.randomBytes(4).toString("hex")}.tmp`);
      await fsp.writeFile(temoin, "AETHRYON");
      await fsp.unlink(temoin);
      return { ok: true };
    } catch (e: any) {
      const code = e && e.code;
      const message = code === "EACCES" || code === "EPERM" || code === "EROFS"
        ? "Dossier en lecture seule : choisis un dossier où tu peux écrire."
        : code === "ENOSPC" ? "Disque plein." : "Dossier inaccessible" + (code ? ` (${code})` : "") + ".";
      return { ok: false, message };
    }
  }

  async function espaceLibre(dossier: string): Promise<number | null> {
    try {
      if (typeof fs.statfs === "function") {
        const st: any = await new Promise((ok, ko) => fs.statfs(dossier, (e: any, s: any) => (e ? ko(e) : ok(s))));
        return Number(st.bavail) * Number(st.bsize);
      }
      if (!windows) return null;
      const lecteur = /^[A-Za-z]:/.test(dossier) ? dossier.slice(0, 2) + "\\" : null;
      if (!lecteur) return null;
      const sortie = await executer("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[System.IO.DriveInfo]::new($args[0]).AvailableFreeSpace", lecteur], null, 6000);
      const n = Number(String(sortie).trim());
      return isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  function urlLocale(chemin: string): string {
    return urlMod.pathToFileURL(chemin).href;
  }

  // ---- Processus (jamais de shell) --------------------------------------------------------------------------------------------
  function executer(exe: string, args: string[], entree: string | null, delai = 15000): Promise<string> {
    return new Promise((ok, ko) => {
      const p = childProcess.execFile(exe, args, { timeout: delai, windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" }, (e: any, stdout: string) => {
        // stderr n'est jamais repris : il pourrait contenir l'entrée.
        if (e) ko(Object.assign(new Error(`${exe} a échoué`), { code: e.code ?? "ECHEC" }));
        else ok(stdout);
      });
      if (entree !== null && p.stdin) {
        p.stdin.on("error", () => {});
        p.stdin.end(entree);
      }
    });
  }

  // ---- Coffre de la clé ----------------------------------------------------------------------------------------------------
  const fichierDpapi = chemins.join(o.dossierDonnees, "cle.dpapi");
  const fichierAcl = chemins.join(o.dossierDonnees, "cle.json");
  let enMemoire: CleStockee | null = null;
  let protectionActuelle: ProtectionCle | null = null;

  const ENTROPIE = "AETHRYON-premiere-v2";
  // L'entrée arrive en base64 (ASCII) sur l'entrée standard : la clé n'apparaît jamais dans la ligne de commande.
  const PS_PROTEGER = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    `$e=[Text.Encoding]::UTF8.GetBytes('${ENTROPIE}')`,
    "$p=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($p))",
  ].join(";");
  const PS_LIRE = PS_PROTEGER.replace("::Protect(", "::Unprotect(");

  function encoderPs(script: string): string {
    return Tampon.from(script, "utf16le").toString("base64");
  }

  async function dpapi(script: string, entreeBase64: string): Promise<string> {
    return executer("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoderPs(script)], entreeBase64, 20000);
  }

  async function restreindreAcl(fichier: string): Promise<boolean> {
    if (!windows) return true; // POSIX : mode 0600 déjà posé à l'écriture
    try {
      const utilisateur = proc.env.USERNAME ? (proc.env.USERDOMAIN ? proc.env.USERDOMAIN + "\\" : "") + proc.env.USERNAME : null;
      if (!utilisateur) return false;
      await executer("icacls.exe", [fichier, "/inheritance:r", "/grant:r", `${utilisateur}:F`], null, 10000);
      return true;
    } catch {
      return false;
    }
  }

  async function supprimerSiPresent(f: string) {
    try {
      await fsp.unlink(f);
    } catch {
      /* absent */
    }
  }

  const coffre = {
    async ecrire(c: CleStockee): Promise<ProtectionCle> {
      const charge = Tampon.from(JSON.stringify(c), "utf8").toString("base64");
      if (windows) {
        try {
          const blob = (await dpapi(PS_PROTEGER, charge)).trim();
          if (!/^[A-Za-z0-9+/=]{40,}$/.test(blob)) throw new Error("réponse DPAPI illisible");
          await ecrireAtomique(fichierDpapi, blob);
          await supprimerSiPresent(fichierAcl);
          enMemoire = c;
          protectionActuelle = "dpapi";
          journal("info", "clé enregistrée (protégée par DPAPI, profil Windows)");
          return "dpapi";
        } catch (e: any) {
          journal("attention", "DPAPI indisponible (" + (e && e.code ? e.code : "échec") + ") : repli sur un fichier protégé par l’ACL du profil");
        }
      }
      try {
        await ecrireAtomique(fichierAcl, JSON.stringify(c), 0o600);
        const acl = await restreindreAcl(fichierAcl);
        await supprimerSiPresent(fichierDpapi);
        enMemoire = c;
        protectionActuelle = "acl";
        journal("info", "clé enregistrée (fichier du profil" + (acl ? ", accès réservé à l’utilisateur" : "") + ")");
        return "acl";
      } catch {
        enMemoire = c;
        protectionActuelle = "memoire";
        journal("attention", "clé gardée en mémoire seulement (écriture impossible dans le profil)");
        return "memoire";
      }
    },
    async lire(): Promise<CleStockee | null> {
      if (enMemoire) return enMemoire;
      const blob = await lireTexte(fichierDpapi);
      if (blob && windows) {
        try {
          const sortie = (await dpapi(PS_LIRE, blob.trim())).trim();
          const c = JSON.parse(Tampon.from(sortie, "base64").toString("utf8")) as CleStockee;
          if (c && typeof c.cle === "string") {
            enMemoire = c;
            protectionActuelle = "dpapi";
            return c;
          }
        } catch {
          journal("attention", "clé protégée illisible (autre utilisateur ou profil changé) : reconnexion nécessaire");
          return null;
        }
      }
      const brut = await lireTexte(fichierAcl);
      if (brut) {
        try {
          const c = JSON.parse(brut) as CleStockee;
          if (c && typeof c.cle === "string") {
            enMemoire = c;
            protectionActuelle = "acl";
            return c;
          }
        } catch {
          journal("attention", "fichier de clé illisible : reconnexion nécessaire");
        }
      }
      return null;
    },
    async effacer(): Promise<void> {
      enMemoire = null;
      protectionActuelle = null;
      await supprimerSiPresent(fichierDpapi);
      await supprimerSiPresent(fichierAcl);
    },
    async protection(): Promise<ProtectionCle | null> {
      return protectionActuelle;
    },
  };

  // ---- Système -------------------------------------------------------------------------------------------------------------
  async function afficherDansExplorateur(chemin: string): Promise<ResultatAction> {
    if (!windows) return { ok: false, message: "« Afficher dans l’Explorateur » n’existe que sous Windows." };
    if (!/^([A-Za-z]:\\|\\\\)/.test(chemin) || !(await existe(chemin))) return { ok: false, message: "Fichier introuvable." };
    try {
      // explorer.exe rend un code 1 même quand il réussit : l'issue n'est pas mesurable, on ne prétend rien de plus.
      childProcess.execFile("explorer.exe", ["/select,", chemin], { windowsHide: false }, () => {});
      return { ok: true };
    } catch {
      return { ok: false, message: "L’Explorateur n’a pas pu être ouvert." };
    }
  }

  async function signature(dossierExtension: string | null): Promise<EtatSignature> {
    let etat: EtatSignature["etat"] = "inconnu";
    let detail = "Dossier de l’extension inconnu.";
    if (dossierExtension) {
      const sig = chemins.join(dossierExtension, "META-INF", "signatures.xml");
      if (await existe(sig)) {
        etat = "signee";
        detail = "META-INF/signatures.xml présent ; Premiere vérifie la signature à chaque chargement.";
      } else {
        etat = "non-signee";
        detail = "Aucune signature (META-INF/signatures.xml absent).";
      }
    }
    let modeDebogage: boolean | null = null;
    if (windows) {
      try {
        const sortie = await executer("reg.exe", ["query", "HKCU\\Software\\Adobe\\CSXS.12", "/v", "PlayerDebugMode"], null, 5000);
        modeDebogage = /PlayerDebugMode\s+REG_\w+\s+(0x)?1\b/i.test(sortie);
      } catch {
        modeDebogage = false; // valeur absente : mode normal (signature exigée)
      }
    }
    return { etat, modeDebogage, detail };
  }

  return {
    http,
    telecharger,
    fichiers: {
      existe, lister, lireTexte,
      ecrireTexte: (c: string, t: string) => ecrireAtomique(c, t),
      ecrireBase64: (c: string, b: string) => ecrireAtomique(c, Tampon.from(b, "base64")),
      creerDossier: async (c: string) => void (await fsp.mkdir(c, { recursive: true })),
      supprimerFichierInterne, renommer, testerEcriture, espaceLibre, urlLocale,
      joindre: (...p: string[]) => chemins.join(...p),
    },
    coffre,
    systeme: {
      afficherDansExplorateur,
      signature,
      nomMachine: () => String(os.hostname() || "").slice(0, 60),
      os: () => `${os.type()} ${os.release()}`,
      windows,
    },
  };
}

export type ServicesNoeud = ReturnType<typeof creerServicesNoeud>;
