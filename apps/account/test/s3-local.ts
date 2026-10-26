// Stockage S3 LOCAL pour les essais d'AETHRYON Cloud : moto en mode serveur (PyPI, 127.0.0.1, seau versionné) pour la
// sémantique S3 (versions, marqueurs de suppression, ListObjectVersions, métadonnées), derrière cette passerelle qui fait
// ce que moto ne fait pas et qu'un vrai fournisseur fait : vérification de CHAQUE signature SigV4 (URL présignée ou
// en-tête Authorization, recalculée avec src/stockage/sigv4.ts, conforme aux exemples publiés par AWS), de l'échéance des
// URL présignées, de l'empreinte Content-MD5 (BadDigest) et de la longueur reçue. Elle sait aussi simuler une panne du
// fournisseur (503 sur tout) pour les essais de nouvelle tentative. Rien n'écoute ailleurs que sur 127.0.0.1.
import { createHash } from "node:crypto";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { presigner, signerEnTetes } from "../src/stockage/sigv4.ts";

export interface S3Local {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Refus prononcés par la passerelle (code S3), dans l'ordre. */
  refus: string[];
  /** Panne simulée : chaque requête reçoit 503 SlowDown tant que c'est vrai. */
  panne: { value: boolean };
  close(): Promise<void>;
}

function depuisAmzDate(s: string): Date {
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
}

const lire = (req: IncomingMessage) => new Promise<Buffer>((ok, ko) => {
  const m: Buffer[] = [];
  req.on("data", (c: Buffer) => m.push(c));
  req.on("end", () => ok(Buffer.concat(m)));
  req.on("error", ko);
});

export async function s3Local(motoUrl: string, id: { accessKeyId: string; secretAccessKey: string; region?: string }): Promise<S3Local> {
  const region = id.region ?? "us-east-1";
  const ident = { accessKeyId: id.accessKeyId, secretAccessKey: id.secretAccessKey, region };
  const moto = new URL(motoUrl);
  const refus: string[] = [];
  const panne = { value: false };
  const server: Server = createServer(async (req, res) => {
    const non = (code: number, raison: string) => {
      refus.push(raison);
      res.writeHead(code, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${raison}</Code><Message>${raison}</Message></Error>`);
    };
    let body: Buffer;
    try { body = await lire(req); } catch { return; }
    if (panne.value) return non(503, "SlowDown");
    const brut = req.url ?? "/";
    const i = brut.indexOf("?");
    const path = i < 0 ? brut : brut.slice(0, i);
    const params = new URLSearchParams(i < 0 ? "" : brut.slice(i + 1));
    const query: Record<string, string> = {};
    for (const [k, v] of params) query[k] = v;
    if (query["X-Amz-Signature"]) {
      const date = depuisAmzDate(query["X-Amz-Date"] ?? "");
      const expire = Number(query["X-Amz-Expires"]);
      if (!Number.isFinite(date.getTime()) || !(expire > 0)) return non(403, "AuthorizationQueryParametersError");
      if (Date.now() > date.getTime() + expire * 1000) return non(403, "AccessDenied");
      if (!String(query["X-Amz-Credential"] ?? "").startsWith(`${ident.accessKeyId}/`)) return non(403, "InvalidAccessKeyId");
      const noms = String(query["X-Amz-SignedHeaders"] ?? "").split(";");
      const signes = Object.fromEntries(noms.map((n) => [n, String(req.headers[n] ?? "")]));
      // Paramètres de signature recalculés par presigner() ; les autres (x-id, X-Amz-Content-Sha256…) sont signés tels quels.
      const STD = new Set(["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"]);
      const autres = Object.fromEntries(Object.entries(query).filter(([k]) => !STD.has(k)));
      const attendu = presigner({ method: req.method!, path, query: autres, entetesSignes: signes }, ident, date, expire);
      if (!attendu.endsWith(`X-Amz-Signature=${query["X-Amz-Signature"]}`)) return non(403, "SignatureDoesNotMatch");
    } else {
      const auth = String(req.headers.authorization ?? "");
      const m = /Credential=([^/]+)\/[^,]+, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})/.exec(auth);
      if (!m) return non(403, "AccessDenied");
      if (m[1] !== ident.accessKeyId) return non(403, "InvalidAccessKeyId");
      const noms = m[2]!.split(";").filter((n) => n !== "x-amz-date" && n !== "x-amz-content-sha256");
      const h = Object.fromEntries(noms.map((n) => [n, String(req.headers[n] ?? "")]));
      const recalc = signerEnTetes({ method: req.method!, path, query, headers: h, payloadHash: String(req.headers["x-amz-content-sha256"]) }, ident, depuisAmzDate(String(req.headers["x-amz-date"])));
      if (!recalc.authorization!.endsWith(`Signature=${m[3]}`)) return non(403, "SignatureDoesNotMatch");
    }
    if (req.headers["content-length"] !== undefined && Number(req.headers["content-length"]) !== body.length) return non(400, "IncompleteBody");
    const md5 = req.headers["content-md5"];
    if (md5 !== undefined && createHash("md5").update(body).digest("base64") !== md5) return non(400, "BadDigest");
    // Requête valide : transmise à moto telle quelle (même méthode, même chemin, mêmes en-têtes, même corps).
    const headers = { ...req.headers, host: moto.host, "content-length": String(body.length) };
    delete headers["transfer-encoding"];
    const fwd = request({ host: moto.hostname, port: moto.port, method: req.method, path: brut, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    fwd.on("error", () => non(502, "BadGateway"));
    fwd.end(body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return {
    endpoint: `http://127.0.0.1:${port}`, region, accessKeyId: id.accessKeyId, secretAccessKey: id.secretAccessKey, refus, panne,
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
