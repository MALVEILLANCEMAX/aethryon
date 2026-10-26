// Envoi d'e-mails transactionnels (inscription par e-mail, mot de passe oublié) par un relais SMTP authentifié
// (production : relais Brevo, port 587). Client minimal sans dépendance : STARTTLS OBLIGATOIRE avec vérification du
// certificat (le mot de passe ne part jamais en clair), AUTH PLAIN, un destinataire par message, 15 s au plus.
// Seule exception : un faux serveur local de test (hôte localhost, 127.0.0.1 ou nom sans point) peut être joint sans
// TLS (`insecureLocal`). Rien n'est journalisé du contenu, ni le mot de passe, ni l'adresse du destinataire.
import { randomBytes, randomUUID } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  password: string;   // SMTP_PASSWORD_FILE, jamais journalisé
  from: string;       // « AETHRYON <noreply@example.com> »
  insecureLocal: boolean;
  /** Plafond d'e-mails par 24 h glissantes, tous destinataires (relais partagé : son quota ne doit jamais s'épuiser). */
  dailyMax: number;
}

/** Image jointe EN LIGNE (référencée par « cid: » dans le HTML) : affichée sans aucune requête vers un serveur, donc
 *  sans traceur d'ouverture. */
export interface InlineImage { cid: string; filename: string; contentType: "image/png"; content: Buffer }
/** Pièce jointe (par exemple les CGV en texte, support durable de la confirmation du contrat). */
export interface Attachment { filename: string; contentType: "text/plain; charset=utf-8"; content: Buffer }
export interface Mail { to: string; subject: string; text: string; html: string; inline?: InlineImage[]; attachments?: Attachment[] }
export interface Mailer { send(m: Mail): Promise<void> }

export class MailError extends Error {}

/** Adresse seule d'un en-tête « Nom <adresse> ». */
const addrOf = (s: string) => /<([^>]+)>/.exec(s)?.[1] ?? s.trim();
/** En-tête encodé (RFC 2047) s'il contient autre chose que de l'ASCII imprimable. */
const enc = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const fromHeader = (s: string) => {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(s);
  return m && m[1] ? `${enc(m[1])} <${m[2]}>` : s;
};
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
/** Une adresse e-mail sûre pour SMTP (aucun retour à la ligne, aucun chevron, une seule @). */
export const SAFE_ADDRESS = /^[^\s<>@,;:"\\()[\]]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

const b64Bytes = (b: Buffer) => b.toString("base64").replace(/.{1,76}/g, "$&\r\n");

/** Message MIME complet (texte et HTML, images en ligne éventuelles), lignes CRLF, sans point seul en début de ligne
 *  (base64 n'en produit pas). Avec images : multipart/alternative [ texte, multipart/related [ HTML, images ] ].
 *  Avec pièces jointes : multipart/mixed [ ce corps, pièces jointes ]. */
export function buildMessage(from: string, m: Mail, now = new Date()): string {
  const boundary = `ae-${randomBytes(12).toString("hex")}`;
  const domain = addrOf(from).split("@")[1] ?? "localhost";
  const htmlPart = m.inline?.length
    ? (() => {
        const rel = `ae-rel-${randomBytes(12).toString("hex")}`;
        return [
          `Content-Type: multipart/related; boundary="${rel}"`,
          "",
          `--${rel}`,
          "Content-Type: text/html; charset=utf-8",
          "Content-Transfer-Encoding: base64",
          "",
          b64(m.html),
          ...m.inline.flatMap((img) => [
            `--${rel}`,
            `Content-Type: ${img.contentType}; name="${img.filename}"`,
            "Content-Transfer-Encoding: base64",
            `Content-ID: <${img.cid}>`,
            `Content-Disposition: inline; filename="${img.filename}"`,
            "",
            b64Bytes(img.content),
          ]),
          `--${rel}--`,
        ];
      })()
    : ["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(m.html)];
  const body = [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.text),
    `--${boundary}`,
    ...htmlPart,
    `--${boundary}--`,
  ];
  const mixed = `ae-mix-${randomBytes(12).toString("hex")}`;
  // Nom de fichier : ASCII sûr seulement (aucun guillemet ni retour à la ligne dans l'en-tête).
  const safeName = (f: string) => f.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "piece-jointe.txt";
  const content = m.attachments?.length
    ? [
        `Content-Type: multipart/mixed; boundary="${mixed}"`,
        "",
        `--${mixed}`,
        ...body,
        ...m.attachments.flatMap((a) => [
          `--${mixed}`,
          `Content-Type: ${a.contentType}; name="${safeName(a.filename)}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${safeName(a.filename)}"`,
          "",
          b64Bytes(a.content),
        ]),
        `--${mixed}--`,
      ]
    : body;
  return [
    `From: ${fromHeader(from)}`,
    `To: <${m.to}>`,
    `Subject: ${enc(m.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    // Forme courante (UUID) : un identifiant tout en hexadécimal compte comme « suspect » pour SpamAssassin.
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    ...content,
    "",
  ].join("\r\n");
}

/** Conversation SMTP : lit les réponses (multi-lignes « 250-… » puis « 250 … ») et vérifie leur code. */
class Conversation {
  private buf = "";
  private waiters: ((line: string | Error) => void)[] = [];
  private lines: string[] = [];
  sock: Socket | TLSSocket;
  constructor(sock: Socket | TLSSocket) { this.sock = sock; this.attach(sock); }
  attach(sock: Socket | TLSSocket) {
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\r\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        const w = this.waiters.shift();
        if (w) w(line); else this.lines.push(line);
      }
    });
    sock.on("error", (e) => { for (const w of this.waiters.splice(0)) w(e); });
    sock.on("close", () => { for (const w of this.waiters.splice(0)) w(new MailError("connexion SMTP fermée")); });
  }
  private line(): Promise<string> {
    const l = this.lines.shift();
    if (l !== undefined) return Promise.resolve(l);
    return new Promise((res, rej) => this.waiters.push((x) => (x instanceof Error ? rej(x) : res(x))));
  }
  /** Réponse complète ; `want` : premier chiffre attendu (2 : succès, 3 : suite attendue). */
  async reply(want: 2 | 3, step: string): Promise<string[]> {
    const out: string[] = [];
    for (;;) {
      const l = await this.line();
      out.push(l);
      if (!/^\d{3}-/.test(l)) break;
    }
    const code = out[out.length - 1]!.slice(0, 3);
    if (code[0] !== String(want)) throw new MailError(`SMTP ${step} : ${code}`);
    return out;
  }
  write(s: string) { this.sock.write(s); }
}

export class SmtpMailer implements Mailer {
  private cfg: MailConfig;
  private timeoutMs: number;
  constructor(cfg: MailConfig, timeoutMs = 15_000) { this.cfg = cfg; this.timeoutMs = timeoutMs; }

  async send(m: Mail): Promise<void> {
    if (!SAFE_ADDRESS.test(m.to)) throw new MailError("adresse du destinataire invalide");
    return this.talk(m);
  }

  /** Contrôle du relais SANS rien envoyer : connexion, STARTTLS, authentification, puis QUIT (outil smtp-check). */
  async verify(): Promise<void> { return this.talk(null); }

  private async talk(m: Mail | null): Promise<void> {
    const { host, port, user, password, from, insecureLocal } = this.cfg;
    const sock = netConnect({ host, port });
    sock.setTimeout(this.timeoutMs, () => sock.destroy(new MailError("SMTP : délai dépassé")));
    const c = new Conversation(sock);
    try {
      await new Promise<void>((res, rej) => { sock.once("connect", () => res()); sock.once("error", rej); });
      await c.reply(2, "accueil");
      const ehlo = async () => { c.write(`EHLO ${addrOf(from).split("@")[1] ?? "localhost"}\r\n`); return c.reply(2, "EHLO"); };
      const caps = await ehlo();
      if (caps.some((l) => /^250[ -]STARTTLS\b/i.test(l))) {
        c.write("STARTTLS\r\n");
        await c.reply(2, "STARTTLS");
        sock.removeAllListeners("data");
        const tls = tlsConnect({ socket: sock, servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" });
        await new Promise<void>((res, rej) => { tls.once("secureConnect", () => res()); tls.once("error", rej); });
        c.attach(tls);
        await ehlo();
      } else if (!insecureLocal) {
        throw new MailError("SMTP : STARTTLS indisponible, envoi refusé (le mot de passe ne part jamais en clair)");
      }
      c.write(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`, "utf8").toString("base64")}\r\n`);
      await c.reply(2, "AUTH");
      if (!m) {
        c.write("QUIT\r\n");
        await c.reply(2, "QUIT").catch(() => undefined);
        c.sock.end();
        return;
      }
      c.write(`MAIL FROM:<${addrOf(from)}>\r\n`);
      await c.reply(2, "MAIL FROM");
      c.write(`RCPT TO:<${m.to}>\r\n`);
      await c.reply(2, "RCPT TO");
      c.write("DATA\r\n");
      await c.reply(3, "DATA");
      c.write(`${buildMessage(from, m)}\r\n.\r\n`);
      await c.reply(2, "envoi");
      // Message accepté : un QUIT poli (sa réponse n'importe plus), puis fermeture.
      c.write("QUIT\r\n");
      await c.reply(2, "QUIT").catch(() => undefined);
      c.sock.end();
    } catch (e) {
      c.sock.destroy();
      sock.destroy();
      throw e;
    }
  }
}
