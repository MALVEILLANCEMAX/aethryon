// Hôte MAQUETTE : un Premiere, un disque et un serveur AETHRYON simulés, en mémoire, pour les essais de l'interface
// et les captures. Il n'envoie AUCUNE requête réseau réelle et n'est JAMAIS livré dans l'extension (entrée séparée).
// Paramètres d'adresse (captures) : ?etat=connecte|deconnecte|attente, ?projet=0, ?vide=1, ?n=<nombre de médias>,
// ?lien=<url>, ?accord=refuse, ?page=<page>.

import { VERSION } from "../version";
import { poserFormatsGlisser } from "../lib/glisser";
import type { EntreeDossier } from "../lib/bibliotheque";
import type {
  BilanImport, Capacites, CleStockee, Environnement, Hote, InfoProjet, ModeChutier, ProtectionCle, RequeteHttp, ReponseHttp,
  RequeteTelechargement, ResultatTelechargement, SuiviOctets,
} from "./types";

const DOSSIER = "C:\\Users\\Élodie\\Downloads\\AETHRYON";
const DONNEES = "C:\\Users\\Élodie\\AppData\\Roaming\\AETHRYON\\premiere";
const ECHANGES = "C:\\Users\\Élodie\\AppData\\Local\\AETHRYON";
const MEDIAS = "maquette/medias/";

interface FichierSimule {
  /** Nom d'origine (avec sa casse). */
  nom?: string;
  taille: number;
  modifie: number;
  /** Ressource servie au lecteur (<video>, <img>) à la place du vrai fichier. */
  ressource: string | null;
  texte?: string;
  base64?: string;
}

interface Echantillon {
  nom: string;
  taille: number;
  ilYa: number;
  mini?: string;
  video?: boolean;
  duree?: number;
  l?: number;
  h?: number;
  importe?: boolean;
  etat?: "en-cours" | "erreur" | "introuvable";
  plateforme?: string;
  titre?: string;
}

const H = 3600_000;
const ECHANTILLONS: Echantillon[] = [
  { nom: "Coucher de soleil sur la côte.mp4", taille: 845_312, ilYa: 0.2 * H, mini: "coucher-4s-1280.jpg", video: true, duree: 12, l: 1280, h: 720, plateforme: "youtube", titre: "Coucher de soleil sur la côte — plan fixe" },
  { nom: "Coucher de soleil — vertical.mp4", taille: 1_048_576, ilYa: 0.6 * H, mini: "coucher-vertical-169.jpg", video: true, duree: 12, l: 720, h: 1280, importe: true, plateforme: "tiktok" },
  { nom: "Coucher de soleil — passage.gif", taille: 1_153_434, ilYa: 1.5 * H, mini: "coucher-passage-gif.jpg", l: 480, h: 270 },
  { nom: "Coucher de soleil sur la côte.mp3", taille: 289_792, ilYa: 2 * H, duree: 12, plateforme: "youtube" },
  { nom: "Coucher de soleil — version longue.mp4", taille: 9_437_184, ilYa: 3 * H, video: true, duree: 94, l: 1920, h: 1080, etat: "erreur", plateforme: "x" },
  { nom: "Nappe sonore — côte.wav", taille: 2_306_867, ilYa: 5 * H, duree: 12, importe: true },
  { nom: "AETHRYON Tools — extrait.mp4", taille: 6_501_171, ilYa: 20 * H, mini: "film-tools.jpg", video: true, duree: 6, l: 1920, h: 1080, plateforme: "youtube" },
  { nom: "Coucher de soleil — 6 s.png", taille: 172_032, ilYa: 26 * H, mini: "coucher-6s.jpg", l: 1280, h: 720 },
  { nom: "Le film des cartes.mp4", taille: 4_404_019, ilYa: 30 * H, mini: "film-cartes.jpg", video: true, duree: 15, l: 1920, h: 1080, plateforme: "tiktok" },
  { nom: "Coucher de soleil — horizon.webm", taille: 3_355_443, ilYa: 50 * H, mini: "coucher-1s.jpg", video: true, duree: 12, l: 1280, h: 720 },
  { nom: "Plan large — rushes 02.mp4", taille: 52_428_800, ilYa: 72 * H, video: true, duree: 41, l: 3840, h: 2160, etat: "introuvable" },
];

function params(): URLSearchParams {
  return typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
}

function attendre(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function joindre(...p: string[]) {
  return p.join("\\").replace(/\\{2,}/g, "\\");
}

function normal(c: string) {
  return c.replace(/\//g, "\\").toLowerCase();
}

export function creerHoteMaquette(): Hote & { simulerDepotProjet(chemin: string): void } {
  const q = params();
  const vide = q.get("vide") === "1";
  const multiplier = Math.max(1, Math.min(40, Number(q.get("n") || 0) / ECHANTILLONS.length || 1));
  const fs = new Map<string, FichierSimule>();
  const maintenant = Date.now();
  const projet: InfoProjet | null = q.get("projet") === "0" ? null : { nom: "Montage-voyage", chemin: "C:\\Users\\Élodie\\Documents\\Montage-voyage.prproj", chutierSelectionne: "Rushes", sequenceActive: "Séquence 01" };
  const dansProjet = new Set<string>();
  const dansSequence = new Set<string>();
  let cle: CleStockee | null = q.get("etat") === "connecte" || q.get("etat") === null
    ? { cle: "ytc_maquette0000000000", expireLe: new Date(maintenant + 29 * 24 * H).toISOString(), compte: { email: "elodie@exemple.fr", nom: "Élodie" }, enregistreeLe: new Date().toISOString() }
    : null;
  let protection: ProtectionCle | null = cle ? "dpapi" : null;

  if (!vide) {
    for (let k = 0; k < multiplier; k++) {
      for (const e of ECHANTILLONS) {
        const nom = k ? e.nom.replace(/(\.[a-z0-9]+)$/, ` (${k + 1})$1`) : e.nom;
        const chemin = joindre(DOSSIER, nom);
        if (e.etat !== "introuvable") {
          const ext = (nom.split(".").pop() || "").toLowerCase();
          fs.set(normal(chemin), { nom, taille: e.taille, modifie: maintenant - e.ilYa - k * H, ressource: e.video ? MEDIAS + "coucher.webm" : ext === "png" || ext === "gif" ? MEDIAS + (e.mini || "coucher-6s.jpg") : null });
        }
        if (e.importe) dansProjet.add(normal(chemin));
      }
    }
  }

  // Index d'AETHRYON Desktop simulé : métadonnées, miniatures, états « en cours », « erreur », « introuvable ».
  const index = {
    schema: 1, misAJour: new Date().toISOString(), dossiers: [{ chemin: DOSSIER, principal: true }],
    medias: vide ? [] : ECHANTILLONS.map((e) => {
      const chemin = joindre(DOSSIER, e.nom);
      const ext = (e.nom.split(".").pop() || "").toLowerCase();
      return {
        id: "0".repeat(40), chemin, nom: e.nom.replace(/\.[^.]+$/, ""), ext,
        type: ["mp4", "webm", "mov"].includes(ext) ? "video" : ["mp3", "wav"].includes(ext) ? "audio" : "image",
        taille: e.taille, ajouteLe: new Date(maintenant - e.ilYa).toISOString(), duree: e.duree ?? null, largeur: e.l ?? null, hauteur: e.h ?? null,
        ips: e.video ? 30 : null, codecVideo: ext === "webm" ? "vp9" : e.video ? "h264" : null, codecAudio: e.video ? "aac" : null,
        miniature: e.mini ? `miniatures/${e.mini.replace(/\W/g, "").padEnd(40, "a").slice(0, 40).replace(/[^0-9a-f]/g, "a")}.jpg` : null,
        etat: e.etat ?? "disponible", erreur: e.etat === "erreur" ? "Interrompu à 41 %" : undefined,
        premiereCompatible: ext === "webm" ? false : true, origine: e.plateforme ? { plateforme: e.plateforme === "x" ? "twitter" : e.plateforme, titre: e.titre ?? null } : null,
      };
    }),
  };
  const miniaturesIndex = new Map<string, string>();
  for (const m of index.medias) if (m.miniature) miniaturesIndex.set(normal(joindre(ECHANGES, "bibliotheque", m.miniature)), MEDIAS + ECHANTILLONS.find((e) => joindre(DOSSIER, e.nom) === m.chemin)!.mini!);
  fs.set(normal(joindre(ECHANGES, "bibliotheque", "index.json")), { taille: 0, modifie: maintenant, ressource: null, texte: JSON.stringify(index) });
  fs.set(normal(joindre(ECHANGES, "etat", "desktop.json")), { taille: 0, modifie: maintenant, ressource: null, texte: "" });
  const battementDesktop = () => JSON.stringify({ schema: 1, pid: 4242, version: "1.0.0-beta.2", battement: new Date().toISOString(), dossierMedias: DOSSIER, premiere: { detecte: true, version: "26.5.2", compatible: true } });

  // Serveur AETHRYON simulé.
  let pollsJeton = 0;
  const jobs = new Map<string, { n: number; fmt: string; titre: string }>();

  function repondre(statut: number, json: unknown, entetes: Record<string, string> = {}): ReponseHttp {
    return { statut, json, entetes };
  }

  async function serveur(r: RequeteHttp): Promise<ReponseHttp> {
    const u = new URL(r.url);
    const p = u.pathname.replace(/^\/media/, "");
    await attendre(120);
    if (p === "/health") return repondre(200, { status: "ok" });
    if (p === "/") return repondre(200, null);
    if (p === "/api/premiere/appairage") {
      // ?serveur=ferme : connexion pas encore ouverte (comme la production tant que le compte n'est pas déployé).
      if (q.get("serveur") === "ferme") return repondre(404, { error: "premiere_closed", message: "La connexion de Premiere Pro n'est pas encore ouverte sur ce serveur." });
      pollsJeton = 0;
      return repondre(200, { codeAppareil: "maquette-appareil-0000000000000000000000000", codeUtilisateur: "KXRT-7Q2M", urlVerification: "https://raccourci.malvu.fr/premiere/connecter", expireDans: 600, intervalle: 1 });
    }
    if (p === "/api/premiere/jeton") {
      pollsJeton++;
      if (pollsJeton < 3) return repondre(428, { etat: "en-attente" });
      if (q.get("accord") === "refuse") return repondre(403, { etat: "refuse" });
      return repondre(200, { cle: "ytc_maquette0000000000", expireLe: new Date(Date.now() + 30 * 24 * H).toISOString(), compte: { email: "elodie@exemple.fr", nom: "Élodie" } });
    }
    const auth = (r.entetes?.authorization || "").startsWith("Bearer ytc_");
    if (!auth) return repondre(401, { error: "unauthorized", message: "Clé absente." });
    if (p === "/api/premiere/moi") {
      const jour = (h: number) => new Date(Date.now() - h * H).toISOString();
      return repondre(200, {
        compte: { email: "elodie@exemple.fr", nom: "Élodie" },
        quota: { utilise: 3, limite: 10, restant: 7, illimite: false, reinitialiseLe: new Date(Date.now() + 9 * H).toISOString() },
        conversionsEnCours: 0,
        recentes: [
          { creeLe: jour(0.2), plateforme: "youtube", format: "mp4", etat: "done", erreur: null },
          { creeLe: jour(0.6), plateforme: "tiktok", format: "mp4", etat: "done", erreur: null },
          { creeLe: jour(2), plateforme: "youtube", format: "mp3", etat: "done", erreur: null },
          { creeLe: jour(3), plateforme: "twitter", format: "mp4", etat: "error", erreur: "Ce post ne contient pas de vidéo." },
          { creeLe: jour(27), plateforme: "youtube", format: "mp4", etat: "done", erreur: null },
        ],
        cle: { expireLe: new Date(Date.now() + 29 * 24 * H).toISOString() },
      });
    }
    if (p === "/api/premiere/deconnexion") return repondre(204, null);
    if (p === "/preview") {
      await attendre(500);
      return repondre(200, {
        platform: "youtube", title: "Coucher de soleil sur la côte — plan fixe en 4K", uploader: "Studio Lumière", duration: 754, thumbnail: null, thumbnail_id: "maquette-miniature",
        audio: "yes", media_count: 1, qualities: [{ quality: 2160, est_size_bytes: 812_000_000, h264: false }, { quality: 1080, est_size_bytes: 210_000_000, h264: true }, { quality: 720, est_size_bytes: 98_000_000, h264: true }, { quality: 480, est_size_bytes: 41_000_000, h264: true }],
        est_size_bytes: { mp3_192: 18_100_000 }, limits: { too_long: false, transcode_allowed: true },
      });
    }
    if (p.startsWith("/preview/thumbnail/")) {
      const rep = await fetch(MEDIAS + "coucher-4s-1280.jpg");
      const tampon = new Uint8Array(await rep.arrayBuffer());
      let bin = "";
      for (let i = 0; i < tampon.length; i++) bin += String.fromCharCode(tampon[i]!);
      return { statut: 200, entetes: {}, json: null, base64: btoa(bin), typeContenu: "image/jpeg" };
    }
    if (p === "/jobs" && r.methode === "POST") {
      const id = "maquette" + Math.random().toString(36).slice(2, 10);
      const corps = r.json as { fmt: string };
      jobs.set(id, { n: 0, fmt: corps.fmt, titre: "Coucher de soleil sur la côte — plan fixe en 4K" });
      return repondre(202, { job_id: id, status: "queued", stage: "queued", progress: 0 });
    }
    const mJob = /^\/jobs\/([A-Za-z0-9]+)$/.exec(p);
    if (mJob && r.methode === "GET") {
      const j = jobs.get(mJob[1]!);
      if (!j) return repondre(404, { error: "not_found", detail: "Job inconnu." });
      j.n++;
      await attendre(700);
      const etapes = [["running", "downloading", 22], ["running", "downloading", 58], ["running", "transcoding", 81], ["done", "done", 100]] as const;
      const [status, stage, progress] = etapes[Math.min(j.n - 1, 3)]!;
      return repondre(200, { job_id: mJob[1], status, stage, progress, title: j.titre, filename: `${j.titre}.${j.fmt}`, size_bytes: 4_812_345 });
    }
    if (mJob && r.methode === "DELETE") return repondre(200, { deleted: true });
    return repondre(404, { error: "not_found", detail: "Route inconnue (maquette)." });
  }

  const hote: Hote & { simulerDepotProjet(chemin: string): void } = {
    nom: "maquette",
    async environnement(): Promise<Environnement> {
      return {
        hote: "maquette", premiereVersion: "26.5.2", cepVersion: "12.0.0", nodeVersion: "17.7.1 (simulé)", chromiumVersion: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || null,
        os: "Windows 11 (simulé)", nomMachine: "PC-ELODIE", dossierMediasParDefaut: DOSSIER, dossierDonnees: DONNEES, racineEchanges: ECHANGES,
        extensionVersion: VERSION, dossierExtension: "C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\fr.aethryon.premiere", posix: false,
      };
    },
    async capacites(): Promise<Capacites> {
      return { glisserVersPremiere: "a-prouver", lectureVideoLocale: true, premiere: true, reseau: false, coffre: "dpapi", choisirDossier: true, afficherDansExplorateur: true };
    },
    async signature() {
      return { etat: "non-signee" as const, modeDebogage: false, detail: "Maquette : aucune signature." };
    },
    http: serveur,
    async telecharger(r: RequeteTelechargement, suivi: SuiviOctets): Promise<ResultatTelechargement> {
      const total = r.tailleAttendue || 4_812_345;
      for (let i = 1; i <= 8; i++) {
        await attendre(180);
        suivi(Math.round((total * i) / 8), total);
      }
      let chemin = joindre(r.dossier, r.nomSouhaite.replace(/[<>:"/\\|?*]/g, " "));
      for (let n = 2; fs.has(normal(chemin)); n++) chemin = joindre(r.dossier, r.nomSouhaite.replace(/(\.[a-z0-9]+)$/, ` (${n})$1`));
      fs.set(normal(chemin), { nom: chemin.split("\\").pop(), taille: total, modifie: Date.now(), ressource: /\.mp3$/.test(chemin) ? null : MEDIAS + "coucher.webm" });
      return { chemin, taille: total };
    },
    fichiers: {
      existe: async (c) => fs.has(normal(c)),
      async lister(dossier) {
        const d = normal(dossier) + "\\";
        const sortie: EntreeDossier[] = [];
        let trouve = false;
        for (const [c, f] of fs) {
          if (!c.startsWith(d)) continue;
          trouve = true;
          const reste = c.slice(d.length);
          if (reste.includes("\\") || f.texte !== undefined) continue;
          sortie.push({ nom: f.nom || reste, taille: f.taille, modifie: f.modifie, fichier: true });
        }
        return trouve || normal(dossier) === normal(DOSSIER) ? sortie : null;
      },
      async lireTexte(c) {
        if (normal(c) === normal(joindre(ECHANGES, "etat", "desktop.json"))) return battementDesktop();
        const f = fs.get(normal(c));
        return f?.texte ?? null;
      },
      async ecrireTexte(c, t) {
        fs.set(normal(c), { taille: t.length, modifie: Date.now(), ressource: null, texte: t });
      },
      async ecrireBase64(c, b) {
        fs.set(normal(c), { nom: c.split("\\").pop(), taille: Math.round((b.length * 3) / 4), modifie: Date.now(), ressource: `data:${/\.mp4$/i.test(c) ? "video/mp4" : "image/jpeg"};base64,${b}`, base64: b });
      },
      async creerDossier() {},
      async supprimerFichierInterne(c) {
        fs.delete(normal(c));
      },
      async renommer(a, b) {
        const f = fs.get(normal(a));
        if (!f) throw new Error("ENOENT");
        fs.delete(normal(a));
        fs.set(normal(b), f);
      },
      async testerEcriture() {
        return { ok: true };
      },
      joindre,
      urlLocale(c) {
        const mini = miniaturesIndex.get(normal(c));
        if (mini) return mini;
        const f = fs.get(normal(c));
        if (f?.ressource) return f.ressource;
        // Fichiers dont seul le nom est simulé (sons) : aucune ressource lisible.
        return MEDIAS + (/\.(mp4|webm|mov)$/i.test(c) ? "coucher.webm" : "inexistant");
      },
      async espaceLibre() {
        return 128_849_018_880;
      },
    },
    premiere: {
      async projet() {
        await attendre(40);
        return projet;
      },
      async importer(chemins: string[], mode: ModeChutier): Promise<BilanImport> {
        await attendre(450);
        if (!projet) return { ok: false, chutier: null, projet: null, resultats: chemins.map((c) => ({ chemin: c, ok: false, code: "aucunProjet" })) };
        const chutier = mode === "racine" ? "Racine du projet" : mode === "selection" ? projet.chutierSelectionne || "AETHRYON" : "AETHRYON";
        const resultats = chemins.map((c) => {
          if (!fs.has(normal(c))) return { chemin: c, ok: false, code: "introuvable" as const };
          if (dansProjet.has(normal(c))) return { chemin: c, ok: true, deja: true };
          if (/\.(webm|mkv)$/i.test(c)) return { chemin: c, ok: false, code: "absentApres" as const };
          dansProjet.add(normal(c));
          return { chemin: c, ok: true };
        });
        return { ok: resultats.every((r) => r.ok), chutier, projet: projet.nom, resultats };
      },
      presentsDansProjet: async (chemins) => chemins.filter((c) => dansProjet.has(normal(c))),
      presentsDansSequence: async (chemins) => chemins.filter((c) => dansSequence.has(normal(c))),
      async insererTeteLecture(c) {
        await attendre(300);
        if (!projet) return { ok: false, message: "Aucun projet ouvert." };
        dansProjet.add(normal(c));
        dansSequence.add(normal(c));
        return { ok: true, message: "Inséré à 4,13 s dans « Séquence 01 »." };
      },
      async ouvrirMoniteurSource() {
        return { ok: true };
      },
      async essaiImport() {
        await attendre(500);
        return projet ? { ok: true, importe: true, nettoye: true, chutierTemporaire: "AETHRYON · diagnostic", dureeMs: 412 } : { ok: false, message: "Aucun projet ouvert." };
      },
    },
    coffre: {
      lire: async () => cle,
      async ecrire(c) {
        cle = c;
        protection = "dpapi";
        return "dpapi";
      },
      async effacer() {
        cle = null;
        protection = null;
      },
      protection: async () => protection,
    },
    async ouvrirUrl(url) {
      // Maquette : on n'ouvre rien, on le note pour les essais.
      (window as unknown as { __urlsOuvertes?: string[] }).__urlsOuvertes = [...((window as unknown as { __urlsOuvertes?: string[] }).__urlsOuvertes || []), url];
    },
    afficherDansExplorateur: async () => ({ ok: true }),
    choisirDossier: async () => "D:\\Rushes\\AETHRYON",
    copierTexte: async (t) => {
      (window as unknown as { __copie?: string }).__copie = t;
      return true;
    },
    preparerGlisser: (dt, chemins) => poserFormatsGlisser(dt, chemins, (c) => "file:///" + c.replace(/\\/g, "/")),
    surVisibilite: () => () => {},
    definirMenu: () => {},
    touchesVoulues: () => {},
    journaliser: () => {},
    simulerDepotProjet(chemin: string) {
      dansProjet.add(normal(chemin));
    },
  };
  return hote;
}
