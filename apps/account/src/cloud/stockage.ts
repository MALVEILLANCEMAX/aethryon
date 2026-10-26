// AETHRYON Cloud : accès au stockage objet compatible S3 par le SDK officiel AWS v3 (@aws-sdk/client-s3).
// Backblaze B2 (https://s3.<région>.backblazeb2.com, signature v4 seulement), Cloudflare R2, MinIO… : seul `CloudConfig`
// change. Les identifiants ne quittent jamais ce processus : ytapi, l'extension, le Desktop et le navigateur ne reçoivent
// que des URL signées à durée limitée. Rien ici n'écrit dans le journal : les appelants journalisent des codes (jamais
// d'URL signée, de clé d'accès ni de nom de fichier).
import {
  AbortMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListMultipartUploadsCommand,
  ListObjectsV2Command, ListObjectVersionsCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CloudConfig } from "../config.ts";

/** Une version d'objet (ou un marqueur de suppression / « hide marker » B2) telle que listée par le fournisseur. */
export interface Version {
  cle: string;
  versionId: string | null;
  taille: number;
  marqueur: boolean;   // marqueur de suppression : ne contient aucun octet, mais masque l'objet
  courante: boolean;
  modifieLe: Date | null;
}

export interface Tete { taille: number; etag: string | null; sha256: string | null; versionId: string | null; type: string | null }

export interface EnvoiSigne { url: string; methode: "PUT"; entetes: Record<string, string>; expireLe: string }

/** Erreur du fournisseur, classée : « indisponible » se réessaie (réseau, 5xx, limitation), « refus » non. */
export class StockageErreur extends Error {
  readonly nature: "indisponible" | "refus";
  readonly statut: number | null;
  readonly code: string;
  constructor(nature: "indisponible" | "refus", code: string, statut: number | null) {
    super(`stockage ${nature} (${code}${statut ? ` ${statut}` : ""})`);
    this.nature = nature; this.code = code; this.statut = statut;
  }
}

/** Interface utilisée par le service (un faux en mémoire la remplace dans les essais unitaires). */
export interface CloudStore {
  signerEnvoi(cle: string, o: { taille: number; type: string; md5: string; sha256: string; disposition: string; expireDansS: number }): Promise<EnvoiSigne>;
  signerLecture(cle: string, o: { disposition: string; type: string; expireDansS: number }): Promise<{ url: string; expireLe: string }>;
  tete(cle: string): Promise<Tete | null>;
  /** Toutes les versions et tous les marqueurs d'une clé exacte. */
  versions(cle: string): Promise<Version[]>;
  /** Toutes les versions (et marqueurs) sous un préfixe, page après page. */
  toutesVersions(prefixe: string): AsyncGenerator<Version>;
  /** Supprime DÉFINITIVEMENT chaque version et chaque marqueur de la clé, puis relit : `restantes` doit valoir 0. */
  supprimerToutesVersions(cle: string): Promise<{ supprimees: number; octets: number; restantes: number }>;
  /** Supprime des versions précises (anciennes versions d'un objet gardé). */
  supprimerVersions(liste: Version[]): Promise<number>;
  /** Envois multiparties entamés et jamais terminés (aucun n'est créé par AETHRYON, filet de sécurité). */
  annulerMultipartiesAnciennes(prefixe: string, avant: Date): Promise<number>;
}

const PROVIDER_DOWN = new Set(["TimeoutError", "RequestTimeout", "RequestTimeTooSkewed", "SlowDown", "ServiceUnavailable",
  "InternalError", "ThrottlingException", "Throttling", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

function classer(e: unknown): StockageErreur {
  const x = e as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const statut = x?.$metadata?.httpStatusCode ?? null;
  const code = String(x?.name ?? x?.code ?? "Erreur").slice(0, 60);
  const indisponible = statut === null || statut >= 500 || statut === 429 || statut === 408 || PROVIDER_DOWN.has(code) || PROVIDER_DOWN.has(String(x?.code ?? ""));
  return new StockageErreur(indisponible ? "indisponible" : "refus", code, statut);
}

const absent = (e: unknown): boolean => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x?.$metadata?.httpStatusCode === 404 || x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.name === "NoSuchVersion";
};

export class S3CloudStore implements CloudStore {
  private readonly s3: S3Client;
  private readonly cfg: CloudConfig;
  constructor(cfg: CloudConfig) {
    this.cfg = cfg;
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Contrôles d'intégrité « flexibles » du SDK (CRC32 ajouté d'office depuis 2025) : seulement quand l'opération
      // l'exige. Certains services compatibles S3 les refusent, et une URL présignée ne doit porter que nos en-têtes.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 3, // nouvelles tentatives du SDK (réseau, 5xx, limitation) avant de rendre « indisponible »
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    });
  }

  async signerEnvoi(cle: string, o: { taille: number; type: string; md5: string; sha256: string; disposition: string; expireDansS: number }): Promise<EnvoiSigne> {
    const cmd = new PutObjectCommand({
      Bucket: this.cfg.bucket, Key: cle, ContentLength: o.taille, ContentType: o.type, ContentMD5: o.md5,
      ContentDisposition: o.disposition, Metadata: { sha256: o.sha256 },
    });
    // Tous ces en-têtes sont SIGNÉS : le fournisseur refuse un autre fichier (taille, MD5, type) que celui annoncé, et
    // vérifie lui-même l'empreinte MD5 des octets reçus. Les métadonnées restent des en-têtes (pas de « hoisting »).
    const entetes: Record<string, string> = {
      "content-length": String(o.taille), "content-type": o.type, "content-md5": o.md5,
      "content-disposition": o.disposition, "x-amz-meta-sha256": o.sha256,
    };
    const url = await getSignedUrl(this.s3, cmd, {
      expiresIn: o.expireDansS,
      signableHeaders: new Set(Object.keys(entetes)),
      unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
    });
    return { url, methode: "PUT", entetes, expireLe: new Date(Date.now() + o.expireDansS * 1000).toISOString() };
  }

  async signerLecture(cle: string, o: { disposition: string; type: string; expireDansS: number }) {
    const cmd = new GetObjectCommand({ Bucket: this.cfg.bucket, Key: cle, ResponseContentDisposition: o.disposition, ResponseContentType: o.type });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: o.expireDansS });
    return { url, expireLe: new Date(Date.now() + o.expireDansS * 1000).toISOString() };
  }

  async tete(cle: string): Promise<Tete | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: cle }));
      return {
        taille: Number(r.ContentLength ?? -1), etag: r.ETag ? r.ETag.replace(/"/g, "") : null,
        sha256: r.Metadata?.sha256 ?? null, versionId: r.VersionId ?? null, type: r.ContentType ?? null,
      };
    } catch (e) {
      if (absent(e)) return null;
      throw classer(e);
    }
  }

  async versions(cle: string): Promise<Version[]> {
    const out: Version[] = [];
    for await (const v of this.toutesVersions(cle)) if (v.cle === cle) out.push(v);
    return out;
  }

  async *toutesVersions(prefixe: string): AsyncGenerator<Version> {
    if (!this.cfg.versions) { // seau sans versions (ex. R2) : la liste simple suffit
      let token: string | undefined;
      do {
        let r;
        try { r = await this.s3.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefixe, ContinuationToken: token })); }
        catch (e) { throw classer(e); }
        for (const o of r.Contents ?? []) yield { cle: o.Key!, versionId: null, taille: Number(o.Size ?? 0), marqueur: false, courante: true, modifieLe: o.LastModified ?? null };
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return;
    }
    let keyMarker: string | undefined, versionMarker: string | undefined;
    for (;;) {
      let r;
      try { r = await this.s3.send(new ListObjectVersionsCommand({ Bucket: this.cfg.bucket, Prefix: prefixe, KeyMarker: keyMarker, VersionIdMarker: versionMarker })); }
      catch (e) { throw classer(e); }
      for (const v of r.Versions ?? []) yield { cle: v.Key!, versionId: v.VersionId ?? null, taille: Number(v.Size ?? 0), marqueur: false, courante: !!v.IsLatest, modifieLe: v.LastModified ?? null };
      for (const m of r.DeleteMarkers ?? []) yield { cle: m.Key!, versionId: m.VersionId ?? null, taille: 0, marqueur: true, courante: !!m.IsLatest, modifieLe: m.LastModified ?? null };
      if (!r.IsTruncated) return;
      keyMarker = r.NextKeyMarker; versionMarker = r.NextVersionIdMarker;
    }
  }

  async supprimerVersions(liste: Version[]): Promise<number> {
    let n = 0;
    for (const v of liste) {
      // Avec VersionId : suppression DÉFINITIVE de cette version (ou de ce marqueur). Sans VersionId (seau sans
      // versions) : suppression simple. Jamais de DeleteObject sans VersionId sur un seau versionné : chez B2 il ne ferait
      // que masquer le fichier (« hide marker »), toujours facturé.
      try { await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: v.cle, ...(v.versionId && this.cfg.versions ? { VersionId: v.versionId } : {}) })); }
      catch (e) { if (!absent(e)) throw classer(e); }
      n++;
    }
    return n;
  }

  async supprimerToutesVersions(cle: string) {
    const avant = await this.versions(cle);
    const octets = avant.reduce((a, v) => a + v.taille, 0);
    const supprimees = await this.supprimerVersions(avant);
    const restantes = (await this.versions(cle)).length; // vérification : rien ne doit rester, marqueurs compris
    return { supprimees, octets, restantes };
  }

  async annulerMultipartiesAnciennes(prefixe: string, avant: Date): Promise<number> {
    let r;
    try { r = await this.s3.send(new ListMultipartUploadsCommand({ Bucket: this.cfg.bucket, Prefix: prefixe })); }
    catch (e) {
      const c = classer(e);
      if (c.nature === "refus") return 0; // opération non prise en charge par ce fournisseur : rien à faire
      throw c;
    }
    let n = 0;
    for (const u of r.Uploads ?? []) {
      if (!u.Key || !u.UploadId || (u.Initiated && u.Initiated >= avant)) continue;
      try { await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.cfg.bucket, Key: u.Key, UploadId: u.UploadId })); n++; }
      catch (e) { if (!absent(e)) throw classer(e); }
    }
    return n;
  }
}
