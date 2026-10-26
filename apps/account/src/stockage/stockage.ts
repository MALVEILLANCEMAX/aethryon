// Stockage des fichiers que l'utilisateur garde (docs/STOCKAGE.md) : une interface, plusieurs fournisseurs — disque du
// VPS (« local ») ou service compatible S3 (Cloudflare R2, Scaleway, MinIO…). Changer de fournisseur = changer la
// configuration ; le reste du code ne voit que cette interface. Aucune route ni tâche ne l'utilise encore : la
// conservation de fichiers attend la décision du propriétaire (coûts, quotas, conditions).
import type { Readable } from "node:stream";

export interface Objet {
  cle: string;
  tailleOctets: number;
  etag: string | null;
  modifieLe: Date | null;
}

export interface Stockage {
  readonly fournisseur: "local" | "s3";
  /**
   * URL de dépôt signée, à durée limitée, pour un envoi direct (ytapi pousse un export sans connaître les
   * identifiants) : la taille et le type sont FIXÉS par la signature (un autre fichier serait refusé).
   */
  urlDepot(cle: string, o: { tailleOctets: number; typeContenu: string; nomFichier?: string; expireDansS: number }): Promise<{ url: string; methode: "PUT"; entetes: Record<string, string> }>;
  /** Dépôt depuis ce processus (octets ou flux), taille exacte exigée. `nomFichier` : gardé avec l'objet (pièce jointe). */
  deposer(cle: string, source: Uint8Array | Readable, o: { tailleOctets: number; typeContenu: string; nomFichier?: string }): Promise<Objet>;
  /** URL de téléchargement privée, signée, à durée limitée, servie en pièce jointe sous ce nom. */
  urlTelechargement(cle: string, o: { nomFichier: string; typeContenu?: string; expireDansS: number }): Promise<string>;
  infos(cle: string): Promise<Objet | null>;
  /** Sans erreur si l'objet n'existe plus. */
  supprimer(cle: string): Promise<void>;
  /** Tous les objets d'un préfixe (pages successives) : rapprochement base ↔ stockage, nettoyage des orphelins. */
  lister(prefixe: string): AsyncGenerator<Objet>;
}

/**
 * Clés acceptées : segments de lettres, chiffres, « - _ . » séparés par « / », sans « .. », 512 caractères au plus
 * (ex. « u/<compte>/f/<id>.mp4 »). Refuse tout ce qui pourrait sortir du dossier (disque) ou tromper un service.
 */
export function cleValide(cle: string): boolean {
  if (cle.length < 1 || cle.length > 512 || cle.startsWith("/") || cle.endsWith("/")) return false;
  return cle.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== ".." && /^[A-Za-z0-9._-]+$/.test(seg));
}

export function verifierCle(cle: string): void {
  if (!cleValide(cle)) throw new Error(`clé de stockage invalide : ${JSON.stringify(cle.slice(0, 80))}`);
}

/** Content-Disposition d'une pièce jointe (RFC 6266 / 5987) : nom ASCII de repli + nom UTF-8 exact. */
export function pieceJointe(nom: string): string {
  const propre = nom.replace(/[\r\n"\\]/g, "_").slice(0, 200) || "fichier";
  const ascii = propre.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_"); // « été » → « ete »
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(propre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
