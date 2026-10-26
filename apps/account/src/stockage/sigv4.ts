// Signature AWS « Signature Version 4 » de l'API S3 (Cloudflare R2, Scaleway, MinIO…), sans dépendance : en-tête
// Authorization et URL présignée. Vérifiée sur les exemples publiés par AWS (test/stockage.test.ts) : un écart d'un
// octet dans la requête canonique change la signature, les exemples suffisent donc à prouver l'algorithme.
import { createHash, createHmac } from "node:crypto";

export interface Identifiants {
  accessKeyId: string;
  secretAccessKey: string;
  /** « auto » pour R2, « fr-par » pour Scaleway Paris, « us-east-1 » pour MinIO par défaut. */
  region: string;
}

/** Empreinte SHA-256 (hexadécimal) ; celle d'un corps vide sert aux requêtes sans contenu. */
export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
export const VIDE = sha256("");
export const NON_SIGNE = "UNSIGNED-PAYLOAD";
/** Durée maximale d'une URL présignée SigV4 (7 jours). */
export const EXPIRATION_MAX_S = 604_800;

const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** Encodage d'AWS (RFC 3986) : seuls A-Z, a-z, 0-9, « - _ . ~ » restent tels quels ; « / » aussi dans un chemin. */
export function encodeAws(s: string, chemin = false): string {
  let out = "";
  for (const octet of Buffer.from(s, "utf8")) {
    const ch = String.fromCharCode(octet);
    if ((octet < 0x80 && /[A-Za-z0-9\-_.~]/.test(ch)) || (chemin && ch === "/")) out += ch;
    else out += `%${octet.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** « 20130524T000000Z » et « 20130524 ». */
export function horodatage(d: Date): { amzDate: string; jour: string } {
  const amzDate = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, jour: amzDate.slice(0, 8) };
}

const ordre = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Chaîne de requête canonique : clés et valeurs encodées, triées par clé (puis valeur). */
export function requeteCanonique(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([k, v]) => [encodeAws(k), encodeAws(v)] as const)
    .sort(([a, x], [b, y]) => ordre(a, b) || ordre(x, y))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

interface Requete {
  method: string;
  /** Chemin DÉJÀ encodé (encodeAws(…, true)). */
  path: string;
  query: Record<string, string>;
  /** Doit contenir « host ». */
  headers: Record<string, string>;
  payloadHash: string;
}

function canonique(r: Requete): { creq: string; signes: string } {
  const h = Object.entries(r.headers)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => ordre(a, b));
  const signes = h.map(([k]) => k).join(";");
  const creq = [r.method, r.path, requeteCanonique(r.query), h.map(([k, v]) => `${k}:${v}\n`).join(""), signes, r.payloadHash].join("\n");
  return { creq, signes };
}

function signature(id: Identifiants, jour: string, amzDate: string, creq: string): { portee: string; sig: string } {
  const portee = `${jour}/${id.region}/s3/aws4_request`;
  const aSigner = ["AWS4-HMAC-SHA256", amzDate, portee, sha256(creq)].join("\n");
  const cle = hmac(hmac(hmac(hmac(`AWS4${id.secretAccessKey}`, jour), id.region), "s3"), "aws4_request");
  return { portee, sig: createHmac("sha256", cle).update(aSigner).digest("hex") };
}

/**
 * En-têtes signés d'une requête (Authorization, x-amz-date, x-amz-content-sha256 ajoutés). `headers` doit contenir
 * « host » et tout en-tête que le serveur doit voir inchangé (content-length, content-type, range…).
 */
export function signerEnTetes(r: Requete, id: Identifiants, date: Date): Record<string, string> {
  const { amzDate, jour } = horodatage(date);
  const headers = { ...r.headers, "x-amz-content-sha256": r.payloadHash, "x-amz-date": amzDate };
  const { creq, signes } = canonique({ ...r, headers });
  const { portee, sig } = signature(id, jour, amzDate, creq);
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${id.accessKeyId}/${portee}, SignedHeaders=${signes}, Signature=${sig}` };
}

/**
 * Chaîne de requête d'une URL présignée (paramètres X-Amz-* et signature). `entetesSignes` : en-têtes que
 * l'utilisateur de l'URL devra envoyer à l'identique (au moins « host » ; « content-length » fixe la taille d'un dépôt).
 */
export function presigner(r: { method: string; path: string; query?: Record<string, string>; entetesSignes: Record<string, string> },
                          id: Identifiants, date: Date, expireDansS: number): string {
  const { amzDate, jour } = horodatage(date);
  const portee = `${jour}/${id.region}/s3/aws4_request`;
  const noms = Object.keys(r.entetesSignes).map((k) => k.toLowerCase()).sort(ordre).join(";");
  const query: Record<string, string> = {
    ...(r.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${id.accessKeyId}/${portee}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(EXPIRATION_MAX_S, Math.floor(expireDansS)))),
    "X-Amz-SignedHeaders": noms,
  };
  const { creq } = canonique({ method: r.method, path: r.path, query, headers: r.entetesSignes, payloadHash: NON_SIGNE });
  const { sig } = signature(id, jour, amzDate, creq);
  return `${requeteCanonique(query)}&X-Amz-Signature=${sig}`;
}
