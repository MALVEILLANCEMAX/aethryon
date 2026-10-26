// Fournisseur compatible S3 : Cloudflare R2 (région « auto », point d'accès https://<compte>.r2.cloudflarestorage.com,
// ou https://<compte>.eu.r2.cloudflarestorage.com pour un seau en juridiction UE), Scaleway (https://s3.fr-par.scw.cloud,
// région « fr-par »), MinIO. Requêtes signées SigV4 (./sigv4.ts), adresses « par chemin » (/<seau>/<clé>) par défaut.
// Les identifiants restent dans ce processus : le navigateur et ytapi ne reçoivent que des URL signées à durée limitée.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import { encodeAws, NON_SIGNE, presigner, signerEnTetes, VIDE, type Identifiants } from "./sigv4.ts";
import { pieceJointe, verifierCle, type Objet, type Stockage } from "./stockage.ts";

export interface S3Config extends Identifiants {
  /** Point d'accès sans le seau, ex. « https://s3.fr-par.scw.cloud ». */
  endpoint: string;
  seau: string;
  /** « chemin » (défaut) : https://hôte/<seau>/<clé> ; « virtuel » : https://<seau>.hôte/<clé>. */
  style?: "chemin" | "virtuel";
  /** Délai d'une requête (ms). */
  delaiMs?: number;
  /** Pour les essais : horloge. */
  maintenant?: () => Date;
}

interface Reponse { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

export class S3Stockage implements Stockage {
  readonly fournisseur = "s3" as const;
  private readonly base: URL;
  private readonly cfg: S3Config;
  constructor(cfg: S3Config) {
    this.cfg = cfg;
    this.base = new URL(cfg.endpoint);
    if (this.base.protocol !== "https:" && this.base.protocol !== "http:") throw new Error("S3 : point d'accès http(s) attendu");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.seau)) throw new Error("S3 : nom de seau invalide");
  }

  private now(): Date { return this.cfg.maintenant?.() ?? new Date(); }

  /** Hôte et chemin encodé d'une clé (ou du seau seul). */
  private adresse(cle: string | null): { host: string; path: string; origin: string } {
    const enc = cle === null ? "" : encodeAws(cle, true);
    if (this.cfg.style === "virtuel") {
      const host = `${this.cfg.seau}.${this.base.host}`;
      return { host, path: `/${enc}`, origin: `${this.base.protocol}//${host}` };
    }
    return { host: this.base.host, path: `/${this.cfg.seau}${cle === null ? "" : `/${enc}`}`, origin: `${this.base.protocol}//${this.base.host}` };
  }

  private envoyer(method: string, cle: string | null, o: { query?: Record<string, string>; headers?: Record<string, string>; corps?: Uint8Array | Readable; payloadHash?: string } = {}): Promise<Reponse> {
    const { host, path, origin } = this.adresse(cle);
    const query = o.query ?? {};
    const signes = signerEnTetes({ method, path, query, headers: { host, ...(o.headers ?? {}) }, payloadHash: o.payloadHash ?? VIDE }, this.cfg, this.now());
    const qs = Object.keys(query).length ? `?${Object.entries(query).map(([k, v]) => `${encodeAws(k)}=${encodeAws(v)}`).join("&")}` : "";
    const url = new URL(`${origin}${path}${qs}`);
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest);
    return new Promise((resolve, reject) => {
      const r = req(url, { method, headers: signes, timeout: this.cfg.delaiMs ?? 30_000 }, (res) => {
        const morceaux: Buffer[] = [];
        let taille = 0;
        res.on("data", (c: Buffer) => { taille += c.length; if (taille <= 4 * 1024 * 1024) morceaux.push(c); }); // réponses courtes (XML, erreurs)
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(morceaux) }));
        res.on("error", reject);
      });
      r.on("timeout", () => r.destroy(new Error("S3 : délai dépassé")));
      r.on("error", reject);
      if (!o.corps) r.end();
      else if (o.corps instanceof Uint8Array) r.end(o.corps);
      else o.corps.on("error", (e) => r.destroy(e)).pipe(r);
    });
  }

  private erreur(r: Reponse, quoi: string): Error {
    const code = /<Code>([^<]{1,80})<\/Code>/.exec(r.body.toString("utf8"))?.[1] ?? "";
    return new Error(`S3 : ${quoi} → ${r.status}${code ? ` ${code}` : ""}`);
  }

  // Le nom de fichier est aussi gardé AVEC l'objet (Content-Disposition au dépôt) : la surcharge à la lecture
  // (response-content-disposition) n'est pas confirmée par la documentation de R2. Après un dépôt direct, la taille est
  // à revérifier côté serveur (infos) : la signature de content-length reste à prouver sur un vrai seau.
  async urlDepot(cle: string, o: { tailleOctets: number; typeContenu: string; nomFichier?: string; expireDansS: number }) {
    verifierCle(cle);
    const { host, path, origin } = this.adresse(cle);
    const entetes: Record<string, string> = { "content-length": String(o.tailleOctets), "content-type": o.typeContenu };
    if (o.nomFichier) entetes["content-disposition"] = pieceJointe(o.nomFichier);
    const qs = presigner({ method: "PUT", path, entetesSignes: { host, ...entetes } }, this.cfg, this.now(), o.expireDansS);
    return { url: `${origin}${path}?${qs}`, methode: "PUT" as const, entetes };
  }

  async deposer(cle: string, source: Uint8Array | Readable, o: { tailleOctets: number; typeContenu: string; nomFichier?: string }): Promise<Objet> {
    verifierCle(cle);
    if (source instanceof Uint8Array && source.byteLength !== o.tailleOctets) throw new Error("S3 : taille annoncée ≠ taille réelle");
    const r = await this.envoyer("PUT", cle, {
      headers: { "content-length": String(o.tailleOctets), "content-type": o.typeContenu, ...(o.nomFichier ? { "content-disposition": pieceJointe(o.nomFichier) } : {}) },
      corps: source, payloadHash: NON_SIGNE,
    });
    if (r.status !== 200) throw this.erreur(r, "dépôt");
    const etag = typeof r.headers.etag === "string" ? r.headers.etag.replace(/"/g, "") : null;
    return { cle, tailleOctets: o.tailleOctets, etag, modifieLe: this.now() };
  }

  async urlTelechargement(cle: string, o: { nomFichier: string; typeContenu?: string; expireDansS: number }): Promise<string> {
    verifierCle(cle);
    const { host, path, origin } = this.adresse(cle);
    const query: Record<string, string> = { "response-content-disposition": pieceJointe(o.nomFichier) };
    if (o.typeContenu) query["response-content-type"] = o.typeContenu;
    const qs = presigner({ method: "GET", path, query, entetesSignes: { host } }, this.cfg, this.now(), o.expireDansS);
    return `${origin}${path}?${qs}`;
  }

  async infos(cle: string): Promise<Objet | null> {
    verifierCle(cle);
    const r = await this.envoyer("HEAD", cle);
    if (r.status === 404) return null;
    if (r.status !== 200) throw this.erreur(r, "infos");
    const lm = typeof r.headers["last-modified"] === "string" ? new Date(r.headers["last-modified"]) : null;
    return {
      cle, tailleOctets: Number(r.headers["content-length"] ?? 0),
      etag: typeof r.headers.etag === "string" ? r.headers.etag.replace(/"/g, "") : null,
      modifieLe: lm && Number.isFinite(lm.getTime()) ? lm : null,
    };
  }

  async supprimer(cle: string): Promise<void> {
    verifierCle(cle);
    const r = await this.envoyer("DELETE", cle);
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw this.erreur(r, "suppression");
  }

  async *lister(prefixe: string): AsyncGenerator<Objet> {
    let suite: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const query: Record<string, string> = { "list-type": "2", prefix: prefixe, "max-keys": "1000" };
      if (suite) query["continuation-token"] = suite;
      const r = await this.envoyer("GET", null, { query });
      if (r.status !== 200) throw this.erreur(r, "liste");
      const xml = r.body.toString("utf8");
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const bloc = m[1]!;
        const champ = (n: string) => new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(bloc)?.[1] ?? null;
        const cle = decodeXml(champ("Key") ?? "");
        const lm = champ("LastModified");
        yield { cle, tailleOctets: Number(champ("Size") ?? 0), etag: (champ("ETag") ?? "").replace(/&quot;|"/g, "") || null, modifieLe: lm ? new Date(lm) : null };
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) return;
      suite = decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "");
      if (!suite) return;
    }
  }
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
