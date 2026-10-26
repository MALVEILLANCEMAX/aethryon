// Relais TLS de DÉMONSTRATION (127.0.0.1:18199) : fait passer la pile jetable ytc2-dx pour la production auprès du
// navigateur de test, qui résout raccourci.malvu.fr et api.malvu.fr vers ce relais (--host-resolver-rules) et
// accepte son certificat de test (--ignore-certificate-errors). Rien ne sort de la machine :
//   raccourci.malvu.fr/*       → site de la pile (127.0.0.1:18190)
//   api.malvu.fr/media/*       → ytapi à faux worker (127.0.0.1:18191), préfixe /media retiré comme Traefik
// États de démonstration pilotés par mode.json (relu à chaque requête) : {"apiDown":503|"close"|false,
// "siteApiDown":503|false, "latest":{...}|null}. Journal : méthode, hôte, chemin SANS paramètres, statut.
import { createServer } from "node:https";
import { request } from "node:http";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// État (certificat de test, journal, mode.json) HORS du dépôt.
const L = process.env.DX_STATE ?? "/tmp/aethryon-dx";
mkdirSync(L, { recursive: true });
const key = join(L, "proxy-key.pem"), cert = join(L, "proxy-cert.pem");
if (!existsSync(cert)) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2",
    "-subj", "/CN=raccourci.malvu.fr", "-addext", "subjectAltName=DNS:raccourci.malvu.fr,DNS:api.malvu.fr"], { stdio: "ignore" });
}
const mode = () => { try { return JSON.parse(readFileSync(join(L, "mode.json"), "utf8")); } catch { return {}; } };
const log = (line) => appendFileSync(join(L, "proxy.log"), `${new Date().toISOString()} ${line}\n`);

function forward(req, res, port, path, host) {
  const headers = { ...req.headers, host, "x-forwarded-proto": "https", "x-forwarded-host": host, "x-forwarded-for": "127.0.0.1" };
  const up = request({ host: "127.0.0.1", port, method: req.method, path, headers }, (r) => {
    log(`${req.method} ${host}${req.url.split("?")[0]} → ${r.statusCode}`);
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { log(`${req.method} ${host}${req.url.split("?")[0]} → 502`); if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}

createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  const m = mode();
  const path = req.url ?? "/";
  if (host === "raccourci.malvu.fr") {
    if (m.latest && path.split("?")[0] === "/downloads/extension/latest.json") {
      log(`GET ${host}/downloads/extension/latest.json → 200 (latest.json de TEST ${m.latest.version})`);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(m.latest));
    }
    if (m.siteApiDown && path.startsWith("/api/extension/")) {
      log(`${req.method} ${host}${path.split("?")[0]} → ${m.siteApiDown} (panne simulée)`);
      res.writeHead(m.siteApiDown, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unavailable" }));
    }
    return forward(req, res, 18190, path, host);
  }
  if (host === "api.malvu.fr" && (path === "/media" || path.startsWith("/media/") || path.startsWith("/media?"))) {
    if (m.apiDown === "close") { log(`${req.method} ${host}${path.split("?")[0]} → connexion coupée (panne simulée)`); return req.socket.destroy(); }
    if (m.apiDown) { log(`${req.method} ${host}${path.split("?")[0]} → ${m.apiDown} (panne simulée)`); res.writeHead(m.apiDown); return res.end(); }
    return forward(req, res, 18191, path.slice("/media".length) || "/", host);
  }
  log(`${req.method} ${host}${path.split("?")[0]} → 404 (hôte non relayé)`);
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("hors démonstration");
}).listen(18199, "127.0.0.1", () => log("relais prêt sur 127.0.0.1:18199"));
