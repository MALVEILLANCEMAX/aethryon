// Faux stockage EN MÉMOIRE pour les essais d'AETHRYON Cloud quand aucun S3 local n'est lancé (CLOUD_TEST_MOTO_URL absent) :
// même contrat que S3CloudStore, avec les versions et les marqueurs d'un seau versionné (B2), les URL signées
// (échéance, taille, MD5 et empreinte fixés à la signature) et une panne simulée.
import { createHash, randomBytes } from "node:crypto";
import { StockageErreur, type CloudStore, type EnvoiSigne, type Tete, type Version } from "../src/cloud/stockage.ts";

interface V { versionId: string; body: Buffer | null; type: string; sha256: string | null; md5hex: string | null; at: Date; marqueur: boolean }
interface Signe { cle: string; methode: "PUT" | "GET"; expire: number; taille?: number; md5?: string; sha256?: string; type?: string; disposition?: string }

export class FakeCloudStore implements CloudStore {
  objets = new Map<string, V[]>(); // versions, la plus récente en dernier
  signes = new Map<string, Signe>();
  panne = false;
  now: () => number = Date.now;
  private ko(): void { if (this.panne) throw new StockageErreur("indisponible", "ServiceUnavailable", 503); }

  async signerEnvoi(cle: string, o: { taille: number; type: string; md5: string; sha256: string; disposition: string; expireDansS: number }): Promise<EnvoiSigne> {
    const t = randomBytes(12).toString("hex");
    this.signes.set(t, { cle, methode: "PUT", expire: this.now() + o.expireDansS * 1000, taille: o.taille, md5: o.md5, sha256: o.sha256, type: o.type, disposition: o.disposition });
    return { url: `memoire://seau/${cle}?jeton=${t}`, methode: "PUT", entetes: { "content-length": String(o.taille), "content-type": o.type, "content-md5": o.md5, "content-disposition": o.disposition, "x-amz-meta-sha256": o.sha256 }, expireLe: new Date(this.now() + o.expireDansS * 1000).toISOString() };
  }

  async signerLecture(cle: string, o: { disposition: string; type: string; expireDansS: number }) {
    const t = randomBytes(12).toString("hex");
    this.signes.set(t, { cle, methode: "GET", expire: this.now() + o.expireDansS * 1000, disposition: o.disposition, type: o.type });
    return { url: `memoire://seau/${cle}?jeton=${t}`, expireLe: new Date(this.now() + o.expireDansS * 1000).toISOString() };
  }

  /** Client simulé : PUT sur une URL signée (statut HTTP que rendrait le fournisseur). */
  put(url: string, body: Buffer, entetes: Record<string, string>): number {
    if (this.panne) return 503;
    const s = this.signes.get(new URL(url).searchParams.get("jeton") ?? "");
    if (!s || s.methode !== "PUT") return 403;
    if (this.now() > s.expire) return 403;
    if (Number(entetes["content-length"]) !== s.taille || entetes["content-md5"] !== s.md5 || entetes["x-amz-meta-sha256"] !== s.sha256) return 403;
    if (body.length !== s.taille) return 400;
    if (createHash("md5").update(body).digest("base64") !== s.md5) return 400;
    this.ajouter(s.cle, body, s.type!, s.sha256!);
    return 200;
  }

  /** Client simulé : GET sur une URL signée. */
  get(url: string): { status: number; body?: Buffer; disposition?: string } {
    if (this.panne) return { status: 503 };
    const s = this.signes.get(new URL(url).searchParams.get("jeton") ?? "");
    if (!s || s.methode !== "GET" || this.now() > s.expire) return { status: 403 };
    const v = this.courante(s.cle);
    return v ? { status: 200, body: v.body!, disposition: s.disposition } : { status: 404 };
  }

  ajouter(cle: string, body: Buffer, type = "video/mp4", sha256: string | null = createHash("sha256").update(body).digest("hex")): void {
    const l = this.objets.get(cle) ?? [];
    l.push({ versionId: randomBytes(8).toString("hex"), body, type, sha256, md5hex: createHash("md5").update(body).digest("hex"), at: new Date(this.now()), marqueur: false });
    this.objets.set(cle, l);
  }

  /** DeleteObject SANS VersionId sur un seau versionné : un marqueur (« hide marker » B2), les octets restent. */
  masquer(cle: string): void {
    const l = this.objets.get(cle) ?? [];
    l.push({ versionId: randomBytes(8).toString("hex"), body: null, type: "", sha256: null, md5hex: null, at: new Date(this.now()), marqueur: true });
    this.objets.set(cle, l);
  }

  private courante(cle: string): V | null {
    const l = this.objets.get(cle);
    const v = l?.[l.length - 1];
    return v && !v.marqueur ? v : null;
  }

  async tete(cle: string): Promise<Tete | null> {
    this.ko();
    const v = this.courante(cle);
    return v ? { taille: v.body!.length, etag: v.md5hex, sha256: v.sha256, versionId: v.versionId, type: v.type } : null;
  }

  async versions(cle: string): Promise<Version[]> {
    const out: Version[] = [];
    for await (const v of this.toutesVersions(cle)) if (v.cle === cle) out.push(v);
    return out;
  }

  async *toutesVersions(prefixe: string): AsyncGenerator<Version> {
    this.ko();
    for (const [cle, l] of [...this.objets].sort(([a], [b]) => a.localeCompare(b))) {
      if (!cle.startsWith(prefixe)) continue;
      for (let i = 0; i < l.length; i++) {
        const v = l[i]!;
        yield { cle, versionId: v.versionId, taille: v.body?.length ?? 0, marqueur: v.marqueur, courante: i === l.length - 1, modifieLe: v.at };
      }
    }
  }

  async supprimerVersions(liste: Version[]): Promise<number> {
    this.ko();
    for (const v of liste) {
      const l = (this.objets.get(v.cle) ?? []).filter((x) => x.versionId !== v.versionId);
      if (l.length) this.objets.set(v.cle, l); else this.objets.delete(v.cle);
    }
    return liste.length;
  }

  async supprimerToutesVersions(cle: string) {
    const avant = await this.versions(cle);
    const octets = avant.reduce((a, v) => a + v.taille, 0);
    await this.supprimerVersions(avant);
    return { supprimees: avant.length, octets, restantes: (await this.versions(cle)).length };
  }

  async annulerMultipartiesAnciennes(): Promise<number> { this.ko(); return 0; }

  /** Octets réellement présents (toutes versions). */
  octets(): number { let n = 0; for (const l of this.objets.values()) for (const v of l) n += v.body?.length ?? 0; return n; }
  nbVersions(): number { let n = 0; for (const l of this.objets.values()) n += l.length; return n; }
}
