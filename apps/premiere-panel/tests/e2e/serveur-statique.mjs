// Petit serveur statique des essais (127.0.0.1 seulement) : la construction maquette/banc + les médias de maquette.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".webm": "video/webm", ".mp4": "video/mp4", ".json": "application/json" };

export function servir(racines, port = 0) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      let chemin = decodeURIComponent(u.pathname);
      if (chemin.endsWith("/")) chemin += "index.html";
      for (const [prefixe, dossier] of racines) {
        if (!chemin.startsWith(prefixe)) continue;
        const f = normalize(join(dossier, chemin.slice(prefixe.length)));
        if (!f.startsWith(resolve(dossier))) break;
        try {
          const st = statSync(f);
          if (!st.isFile()) continue;
          const type = TYPES[extname(f)] || "application/octet-stream";
          const plage = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
          if (plage) {
            const debut = plage[1] ? Number(plage[1]) : 0;
            const fin = plage[2] ? Number(plage[2]) : st.size - 1;
            res.writeHead(206, { "content-type": type, "content-range": `bytes ${debut}-${fin}/${st.size}`, "accept-ranges": "bytes", "content-length": fin - debut + 1 });
            createReadStream(f, { start: debut, end: fin }).pipe(res);
          } else {
            res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes" });
            createReadStream(f).pipe(res);
          }
          return;
        } catch {
          continue;
        }
      }
      res.writeHead(404);
      res.end();
    });
    s.listen(port, "127.0.0.1", () => ok(s));
  });
}
