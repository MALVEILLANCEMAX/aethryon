// FAUX relais SMTP (tests de bout en bout seulement ; rien ne part sur Internet) : accepte AUTH PLAIN avec le mot de
// passe donné, reçoit les messages, les décode (en-têtes, parties base64) et les ajoute en JSON, un par ligne, à un
// fichier que le test lit (docker exec … cat). Sans TLS : account ne l'accepte qu'avec SMTP_INSECURE_LOCAL=1 sur un
// hôte sans point (src/config.ts).
//   node fake-smtp.ts --port 2525 --host 0.0.0.0 --password-file <fichier> --out /tmp/mails.jsonl
import { appendFileSync, readFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1]! : d!; };
const port = Number(arg("port", "2525"));
const password = readFileSync(arg("password-file"), "utf8").trim();
const out = arg("out", "/tmp/mails.jsonl");

/** Corps MIME → { to, subject, text, html } (parties base64 de buildMessage, src/mailer.ts). */
function decode(raw: string, to: string) {
  const [head = "", ...rest] = raw.split("\r\n\r\n");
  const subjectRaw = /^Subject: (.*)$/m.exec(head)?.[1] ?? "";
  const subject = subjectRaw.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, "base64").toString("utf8"));
  const body = rest.join("\r\n\r\n");
  const part = (type: string) => {
    const m = new RegExp(`Content-Type: ${type}; charset=utf-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)`).exec(body);
    return m ? Buffer.from(m[1]!.replace(/\r\n/g, ""), "base64").toString("utf8") : "";
  };
  return { to, from: /^From: (.*)$/m.exec(head)?.[1] ?? "", subject, text: part("text/plain"), html: part("text/html"), at: new Date().toISOString() };
}

createServer((sock: Socket) => {
  sock.setEncoding("utf8");
  let buf = "", inData = false, data: string[] = [], authed = false, rcpt = "";
  sock.write("220 faux-smtp ESMTP\r\n");
  sock.on("data", (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          appendFileSync(out, JSON.stringify(decode(data.join("\r\n"), rcpt)) + "\n");
          data = [];
          sock.write("250 2.0.0 reçu\r\n");
        } else data.push(line.startsWith("..") ? line.slice(1) : line);
        continue;
      }
      if (/^EHLO /i.test(line)) sock.write("250-faux-smtp\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH PLAIN /i.test(line)) {
        const [, , pw] = Buffer.from(line.slice(11), "base64").toString("utf8").split("\0");
        authed = pw === password;
        sock.write(authed ? "235 2.7.0 ok\r\n" : "535 5.7.8 refusé\r\n");
      } else if (/^MAIL FROM:/i.test(line)) sock.write(authed ? "250 ok\r\n" : "530 authentification requise\r\n");
      else if (/^RCPT TO:<([^>]+)>$/i.test(line)) { rcpt = /<([^>]+)>/.exec(line)![1]!; sock.write("250 ok\r\n"); }
      else if (/^DATA$/i.test(line)) { inData = true; sock.write("354 fin par une ligne « . »\r\n"); }
      else if (/^QUIT$/i.test(line)) sock.end("221 au revoir\r\n");
      else sock.write("502 commande inconnue\r\n");
    }
  });
  sock.on("error", () => undefined);
}).listen(port, arg("host", "127.0.0.1"));
