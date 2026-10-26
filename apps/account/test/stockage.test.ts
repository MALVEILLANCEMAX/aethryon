// Abstraction de stockage (docs/STOCKAGE.md) : signature SigV4 prouvée sur les exemples publiés par AWS, puis le MÊME
// contrat joué sur les deux fournisseurs — disque (dossier temporaire) et S3 (faux service local qui vérifie chaque
// signature et chaque échéance, comme R2 ou Scaleway). Aucun service payant, aucun réseau extérieur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { creerStockage, cleValide, pieceJointe, LocalStockage, type Stockage } from "../src/stockage/index.ts";
import { encodeAws, presigner, sha256, signerEnTetes, VIDE } from "../src/stockage/sigv4.ts";

// ---- 1. SigV4 : exemples officiels d'AWS (documentation « Signature Version 4 », seau examplebucket) -------------
const AWS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const JOUR_AWS = new Date("2013-05-24T00:00:00Z");
const HOTE_AWS = "examplebucket.s3.amazonaws.com";
const sigDe = (h: Record<string, string>) => /Signature=([0-9a-f]{64})/.exec(h.authorization ?? "")?.[1];

test("SigV4 : en-tête Authorization identique aux exemples d'AWS (GET avec plage, PUT, liste, sous-ressource)", () => {
  assert.equal(sigDe(signerEnTetes({ method: "GET", path: "/test.txt", query: {}, headers: { host: HOTE_AWS, range: "bytes=0-9" }, payloadHash: VIDE }, AWS, JOUR_AWS)),
    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.equal(sigDe(signerEnTetes({ method: "PUT", path: `/${encodeAws("test$file.text", true)}`, query: {},
    headers: { host: HOTE_AWS, date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    payloadHash: sha256("Welcome to Amazon S3.") }, AWS, JOUR_AWS)), "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  assert.equal(sigDe(signerEnTetes({ method: "GET", path: "/", query: { "max-keys": "2", prefix: "J" }, headers: { host: HOTE_AWS }, payloadHash: VIDE }, AWS, JOUR_AWS)),
    "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  assert.equal(sigDe(signerEnTetes({ method: "GET", path: "/", query: { lifecycle: "" }, headers: { host: HOTE_AWS }, payloadHash: VIDE }, AWS, JOUR_AWS)),
    "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
});

test("SigV4 : URL présignée identique à l'exemple d'AWS ; encodage des clés et noms de fichiers", () => {
  const qs = presigner({ method: "GET", path: "/test.txt", entetesSignes: { host: HOTE_AWS } }, AWS, JOUR_AWS, 86_400);
  assert.equal(qs, "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"
    + "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host"
    + "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  assert.equal(encodeAws("a b/é~", true), "a%20b/%C3%A9~");
  assert.equal(encodeAws("a/b"), "a%2Fb");
  assert.equal(pieceJointe("Café « montage ».mp4"), "attachment; filename=\"Cafe _ montage _.mp4\"; filename*=UTF-8''Caf%C3%A9%20%C2%AB%20montage%20%C2%BB.mp4");
  for (const k of ["u/abc/f/x.mp4", "a", "a-b_c.d/e"]) assert.ok(cleValide(k), k);
  for (const k of ["", "/a", "a/", "a//b", "../a", "a/../b", "a/./b", "a b", "é", "a\\b", "x".repeat(513)]) assert.ok(!cleValide(k), k);
});

// ---- 2. Faux service S3 : stocke en mémoire, vérifie chaque signature (en-tête ou URL) et chaque échéance ---------
interface FauxS3 { server: Server; endpoint: string; objets: Map<string, { body: Buffer; type: string; disposition: string | null }>; refus: string[]; pageMax: number }

function depuisAmzDate(s: string): Date {
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
}

async function fauxS3(seau: string, id: typeof AWS, horloge: () => Date): Promise<FauxS3> {
  const objets = new Map<string, { body: Buffer; type: string; disposition: string | null }>();
  const refus: string[] = [];
  const etat: FauxS3 = { server: null as unknown as Server, endpoint: "", objets, refus, pageMax: 2 };
  const lire = (req: IncomingMessage) => new Promise<Buffer>((ok) => { const m: Buffer[] = []; req.on("data", (c: Buffer) => m.push(c)); req.on("end", () => ok(Buffer.concat(m))); });
  const server = createServer(async (req, res) => {
    const brut = req.url ?? "/";
    const [path, qs = ""] = brut.split("?") as [string, string?];
    const params = new URLSearchParams(qs);
    const query: Record<string, string> = {};
    for (const [k, v] of params) query[k] = v;
    const non = (code: number, raison: string) => { refus.push(raison); res.writeHead(code, { "content-type": "application/xml" }); res.end(`<Error><Code>${raison}</Code></Error>`); };
    // Vérification de la signature (recalculée à partir de la requête reçue).
    if (query["X-Amz-Signature"]) {
      const date = depuisAmzDate(query["X-Amz-Date"]!);
      const expire = Number(query["X-Amz-Expires"]);
      if (horloge().getTime() > date.getTime() + expire * 1000) return non(403, "AccessDenied:expired");
      const noms = query["X-Amz-SignedHeaders"]!.split(";");
      const signes = Object.fromEntries(noms.map((n) => [n, String(req.headers[n] ?? "")]));
      const autres = Object.fromEntries(Object.entries(query).filter(([k]) => !k.startsWith("X-Amz-")));
      const attendu = presigner({ method: req.method!, path, query: autres, entetesSignes: signes }, id, date, expire);
      if (!attendu.endsWith(`X-Amz-Signature=${query["X-Amz-Signature"]}`)) return non(403, "SignatureDoesNotMatch");
    } else {
      const auth = String(req.headers.authorization ?? "");
      const m = /SignedHeaders=([^,]+), Signature=([0-9a-f]{64})/.exec(auth);
      if (!m) return non(403, "AccessDenied");
      const noms = m[1]!.split(";").filter((n) => n !== "x-amz-date" && n !== "x-amz-content-sha256");
      const h = Object.fromEntries(noms.map((n) => [n, String(req.headers[n] ?? "")]));
      const recalc = signerEnTetes({ method: req.method!, path, query, headers: h, payloadHash: String(req.headers["x-amz-content-sha256"]) }, id, depuisAmzDate(String(req.headers["x-amz-date"])));
      if (sigDe(recalc) !== m[2]) return non(403, "SignatureDoesNotMatch");
    }
    const prefixeSeau = `/${seau}`;
    if (!path.startsWith(prefixeSeau)) return non(404, "NoSuchBucket");
    const cle = decodeURIComponent(path.slice(prefixeSeau.length + 1));
    if (req.method === "PUT") {
      const body = await lire(req);
      if (body.length !== Number(req.headers["content-length"])) return non(400, "IncompleteBody");
      objets.set(cle, { body, type: String(req.headers["content-type"] ?? "application/octet-stream"), disposition: req.headers["content-disposition"] ? String(req.headers["content-disposition"]) : null });
      res.writeHead(200, { etag: `"${sha256(body).slice(0, 32)}"` }); return res.end();
    }
    if (req.method === "GET" && cle === "" && query["list-type"] === "2") {
      const tous = [...objets.keys()].filter((k) => k.startsWith(query.prefix ?? "")).sort();
      const debut = query["continuation-token"] ? tous.indexOf(query["continuation-token"]) : 0;
      const page = tous.slice(debut, debut + etat.pageMax);
      const suite = tous[debut + etat.pageMax];
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<ListBucketResult><IsTruncated>${suite ? "true" : "false"}</IsTruncated>${suite ? `<NextContinuationToken>${suite}</NextContinuationToken>` : ""}`
        + page.map((k) => `<Contents><Key>${k}</Key><Size>${objets.get(k)!.body.length}</Size><ETag>&quot;e&quot;</ETag><LastModified>2026-10-15T12:00:00.000Z</LastModified></Contents>`).join("")
        + "</ListBucketResult>");
    }
    const o = objets.get(cle);
    if (req.method === "DELETE") { objets.delete(cle); res.writeHead(204); return res.end(); }
    if (!o) return non(404, "NoSuchKey");
    const entetes: Record<string, string> = { "content-length": String(o.body.length), "content-type": query["response-content-type"] ?? o.type, "last-modified": new Date("2026-10-15T12:00:00Z").toUTCString() };
    const disposition = query["response-content-disposition"] ?? o.disposition;
    if (disposition) entetes["content-disposition"] = disposition;
    res.writeHead(200, entetes);
    res.end(req.method === "HEAD" ? undefined : o.body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  etat.server = server;
  etat.endpoint = `http://127.0.0.1:${port}`;
  return etat;
}

// ---- 3. Contrat commun aux fournisseurs ------------------------------------------------------------------------
let maintenant = new Date("2026-10-15T12:00:00Z");
const horloge = () => maintenant;

async function contrat(nom: string, s: Stockage, telecharger: (url: string) => Promise<{ status: number; body: Buffer; disposition: string | null }>,
                       deposerParUrl: (url: string, entetes: Record<string, string>, corps: Buffer) => Promise<number>) {
  const contenu = Buffer.from("AETHRYON — fichier gardé ".repeat(200));
  // Dépôt depuis le serveur (flux), puis infos.
  const o = await s.deposer("u/lina/f/aa11.mp4", Readable.from([contenu.subarray(0, 1000), contenu.subarray(1000)]), { tailleOctets: contenu.length, typeContenu: "video/mp4" });
  assert.equal(o.tailleOctets, contenu.length, nom);
  assert.equal((await s.infos("u/lina/f/aa11.mp4"))?.tailleOctets, contenu.length, nom);
  assert.equal(await s.infos("u/lina/f/absent.mp4"), null, nom);
  // Taille annoncée fausse : refus, rien d'écrit.
  await assert.rejects(s.deposer("u/lina/f/faux.mp4", new Uint8Array(10), { tailleOctets: 11, typeContenu: "video/mp4" }), nom);
  assert.equal(await s.infos("u/lina/f/faux.mp4"), null, nom);
  // Téléchargement privé : URL signée, pièce jointe nommée ; expirée, refusée.
  const url = await s.urlTelechargement("u/lina/f/aa11.mp4", { nomFichier: "Montage d'été.mp4", typeContenu: "video/mp4", expireDansS: 300 });
  const t = await telecharger(url);
  assert.equal(t.status, 200, nom);
  assert.deepEqual(t.body, contenu, nom);
  assert.match(t.disposition ?? "", /^attachment; filename="Montage d'ete\.mp4"; filename\*=UTF-8''Montage%20d%27%C3%A9t%C3%A9\.mp4$/, nom);
  maintenant = new Date(maintenant.getTime() + 301_000);
  assert.equal((await telecharger(url)).status, 403, `${nom} : URL expirée`);
  // Dépôt direct par URL signée (ytapi) : taille fixée par la signature.
  const autre = Buffer.from("x".repeat(4096));
  const d = await s.urlDepot("u/lina/f/bb22.gif", { tailleOctets: autre.length, typeContenu: "image/gif", nomFichier: "Boucle.gif", expireDansS: 600 });
  assert.equal(await deposerParUrl(d.url, d.entetes, Buffer.from("y".repeat(4095))), 403, `${nom} : autre taille refusée`);
  assert.equal(await deposerParUrl(d.url, d.entetes, autre), 200, nom);
  assert.equal((await s.infos("u/lina/f/bb22.gif"))?.tailleOctets, 4096, nom);
  // Liste (pages successives) et suppression idempotente.
  await s.deposer("u/lina/f/cc33.mp3", new Uint8Array(5), { tailleOctets: 5, typeContenu: "audio/mpeg" });
  await s.deposer("u/autre/f/dd44.mp4", new Uint8Array(3), { tailleOctets: 3, typeContenu: "video/mp4" });
  const liste = [];
  for await (const x of s.lister("u/lina/")) liste.push(`${x.cle}:${x.tailleOctets}`);
  assert.deepEqual(liste.sort(), [`u/lina/f/aa11.mp4:${contenu.length}`, "u/lina/f/bb22.gif:4096", "u/lina/f/cc33.mp3:5"], nom);
  await s.supprimer("u/lina/f/aa11.mp4");
  await s.supprimer("u/lina/f/aa11.mp4");
  assert.equal(await s.infos("u/lina/f/aa11.mp4"), null, nom);
  // Clés dangereuses : refusées partout.
  await assert.rejects(s.deposer("../hors.mp4", new Uint8Array(1), { tailleOctets: 1, typeContenu: "video/mp4" }), nom);
  await assert.rejects(s.urlTelechargement("u/../../etc/passwd", { nomFichier: "x", expireDansS: 60 }), nom);
}

test("stockage S3 (faux service qui vérifie les signatures) : dépôt, infos, URL signées, expiration, taille fixée, liste paginée, suppression", async () => {
  maintenant = new Date("2026-10-15T12:00:00Z");
  const id = { accessKeyId: "AKIDTEST", secretAccessKey: "secret-de-test-0123456789", region: "auto" };
  const f = await fauxS3("aethryon-essai", id, horloge);
  try {
    const s = creerStockage({ fournisseur: "s3", endpoint: f.endpoint, seau: "aethryon-essai", ...id, maintenant: horloge });
    await contrat("s3", s, async (url) => {
      const r = await fetch(url);
      return { status: r.status, body: Buffer.from(await r.arrayBuffer()), disposition: r.headers.get("content-disposition") };
    }, async (url, entetes, corps) => {
      const { "content-length": _l, ...autres } = entetes;
      return (await fetch(url, { method: "PUT", headers: autres, body: corps })).status;
    });
    // Mauvais secret : toute requête est refusée par le service.
    const intrus = creerStockage({ fournisseur: "s3", endpoint: f.endpoint, seau: "aethryon-essai", ...id, secretAccessKey: "autre", maintenant: horloge });
    await assert.rejects(intrus.infos("u/lina/f/bb22.gif"), /403/);
    assert.ok(f.refus.includes("SignatureDoesNotMatch"));
  } finally {
    f.server.close();
  }
});

test("stockage disque du VPS : même contrat ; liens HMAC (faux, expiré ou d'une autre taille : refusés)", async () => {
  maintenant = new Date("2026-10-15T12:00:00Z");
  const dossier = await mkdtemp(join(tmpdir(), "stockage-"));
  try {
    const s = creerStockage({ fournisseur: "local", dossier, secret: "s".repeat(40), base: "https://exemple.test/api/stockage", maintenant: horloge }) as LocalStockage;
    // La route d'account est simulée : elle vérifie le lien puis sert (ou écrit) le fichier.
    const route = (url: string) => {
      const u = new URL(url);
      const [, , , usage, ...cle] = u.pathname.split("/");
      return { usage: usage === "f" ? "get" as const : "put" as const, cle: cle.map(decodeURIComponent).join("/"), q: u.searchParams };
    };
    await contrat("local", s, async (url) => {
      const r = route(url);
      const ok = s.verifierLien("get", r.cle, r.q);
      if (!ok) return { status: 403, body: Buffer.alloc(0), disposition: null };
      const { readFile } = await import("node:fs/promises");
      return { status: 200, body: await readFile(join(dossier, ...r.cle.split("/"))), disposition: pieceJointe(ok.nomFichier!) };
    }, async (url, _entetes, corps) => {
      const r = route(url);
      const ok = s.verifierLien("put", r.cle, r.q);
      if (!ok || ok.tailleOctets !== corps.length) return 403;
      await s.deposer(r.cle, corps, { tailleOctets: corps.length, typeContenu: ok.typeContenu! });
      return 200;
    });
    // Lien falsifié (autre fichier, même signature) : refusé.
    const url = new URL(await s.urlTelechargement("u/lina/f/bb22.gif", { nomFichier: "a.gif", expireDansS: 60 }));
    assert.ok(s.verifierLien("get", "u/lina/f/bb22.gif", url.searchParams));
    assert.equal(s.verifierLien("get", "u/lina/f/cc33.mp3", url.searchParams), null);
    url.searchParams.set("n", "autre.gif");
    assert.equal(s.verifierLien("get", "u/lina/f/bb22.gif", url.searchParams), null);
    assert.throws(() => new LocalStockage({ dossier, secret: "court", base: "https://x.test" }));
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});
