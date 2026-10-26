// Fournisseur « disque du VPS » : un dossier de ce serveur. Les URL de téléchargement et de dépôt sont signées par
// HMAC (clé, échéance, nom, taille) et devront être servies par une route d'account (`verifierLien`) : aucun fichier
// n'est lisible sans une URL valide et non expirée. Écriture atomique (fichier temporaire puis renommage).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { EXPIRATION_MAX_S } from "./sigv4.ts";
import { verifierCle, type Objet, type Stockage } from "./stockage.ts";

export interface LocalConfig {
  dossier: string;
  /** Secret HMAC des liens (32 octets au moins, lu dans un fichier). */
  secret: string;
  /** Adresse publique de la route qui servira les fichiers, ex. « https://raccourci.malvu.fr/api/stockage ». */
  base: string;
  maintenant?: () => Date;
}

type Usage = "get" | "put";

export class LocalStockage implements Stockage {
  readonly fournisseur = "local" as const;
  private readonly cfg: LocalConfig;
  constructor(cfg: LocalConfig) {
    if (Buffer.byteLength(cfg.secret) < 32) throw new Error("stockage local : secret de 32 octets au moins");
    this.cfg = cfg;
  }

  private now(): number { return Math.floor((this.cfg.maintenant?.() ?? new Date()).getTime() / 1000); }

  private chemin(cle: string): string {
    verifierCle(cle);
    const p = join(this.cfg.dossier, ...cle.split("/"));
    if (relative(this.cfg.dossier, p).startsWith("..")) throw new Error("stockage local : chemin hors du dossier");
    return p;
  }

  private signer(usage: Usage, cle: string, exp: number, extra: string): string {
    return createHmac("sha256", this.cfg.secret).update(`${usage}\n${cle}\n${exp}\n${extra}`).digest("base64url");
  }

  private lien(usage: Usage, cle: string, expireDansS: number, extra: string, param: Record<string, string>): string {
    const exp = this.now() + Math.max(1, Math.min(EXPIRATION_MAX_S, Math.floor(expireDansS)));
    const q = new URLSearchParams({ ...param, e: String(exp), s: this.signer(usage, cle, exp, extra) });
    return `${this.cfg.base}/${usage === "get" ? "f" : "depot"}/${cle.split("/").map(encodeURIComponent).join("/")}?${q}`;
  }

  /**
   * Vérification d'un lien reçu par la route : null s'il est faux ou expiré ; sinon ce qu'il autorise (nom du
   * fichier à servir, ou taille et type exacts d'un dépôt).
   */
  verifierLien(usage: Usage, cle: string, q: URLSearchParams): { nomFichier?: string; tailleOctets?: number; typeContenu?: string } | null {
    try { verifierCle(cle); } catch { return null; }
    const exp = Number(q.get("e"));
    if (!Number.isInteger(exp) || exp < this.now()) return null;
    const extra = usage === "get" ? q.get("n") ?? "" : `${q.get("t") ?? ""}\n${q.get("c") ?? ""}`;
    const attendu = Buffer.from(this.signer(usage, cle, exp, extra));
    const recu = Buffer.from(q.get("s") ?? "");
    if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return null;
    return usage === "get" ? { nomFichier: q.get("n") ?? "fichier" } : { tailleOctets: Number(q.get("t")), typeContenu: q.get("c") ?? "" };
  }

  async urlDepot(cle: string, o: { tailleOctets: number; typeContenu: string; nomFichier?: string; expireDansS: number }) {
    this.chemin(cle);
    const t = String(o.tailleOctets);
    return { url: this.lien("put", cle, o.expireDansS, `${t}\n${o.typeContenu}`, { t, c: o.typeContenu }), methode: "PUT" as const,
             entetes: { "content-length": t, "content-type": o.typeContenu } };
  }

  // Disque : le nom de fichier voyage dans le lien de téléchargement signé (rien à garder avec le fichier).
  async deposer(cle: string, source: Uint8Array | Readable, o: { tailleOctets: number; typeContenu: string; nomFichier?: string }): Promise<Objet> {
    const p = this.chemin(cle);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(6).toString("hex")}.partiel`;
    let ecrit = 0;
    const flux = source instanceof Uint8Array ? Readable.from([source]) : source;
    try {
      await pipeline(flux, async function* (src) {
        for await (const c of src) {
          ecrit += (c as Buffer).length;
          if (ecrit > o.tailleOctets) throw new Error("stockage local : fichier plus grand qu'annoncé");
          yield c;
        }
      }, createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
      if (ecrit !== o.tailleOctets) throw new Error("stockage local : taille annoncée ≠ taille réelle");
      await rename(tmp, p);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    const s = await stat(p);
    return { cle, tailleOctets: s.size, etag: null, modifieLe: s.mtime };
  }

  async urlTelechargement(cle: string, o: { nomFichier: string; typeContenu?: string; expireDansS: number }): Promise<string> {
    this.chemin(cle);
    return this.lien("get", cle, o.expireDansS, o.nomFichier, { n: o.nomFichier });
  }

  async infos(cle: string): Promise<Objet | null> {
    try {
      const s = await stat(this.chemin(cle));
      return s.isFile() ? { cle, tailleOctets: s.size, etag: null, modifieLe: s.mtime } : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async supprimer(cle: string): Promise<void> {
    await rm(this.chemin(cle), { force: true });
  }

  async *lister(prefixe: string): AsyncGenerator<Objet> {
    const racine = this.cfg.dossier;
    async function* parcourir(dossier: string): AsyncGenerator<string> {
      let entrees;
      try { entrees = await readdir(dossier, { withFileTypes: true }); } catch { return; }
      for (const e of entrees.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = join(dossier, e.name);
        if (e.isDirectory()) yield* parcourir(p);
        else if (e.isFile() && !e.name.endsWith(".partiel")) yield p;
      }
    }
    for await (const p of parcourir(racine)) {
      const cle = relative(racine, p).split(sep).join("/");
      if (!cle.startsWith(prefixe)) continue;
      const s = await stat(p);
      yield { cle, tailleOctets: s.size, etag: null, modifieLe: s.mtime };
    }
  }
}
