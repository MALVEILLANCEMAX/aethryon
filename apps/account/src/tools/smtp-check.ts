// Contrôle du relais SMTP de production SANS envoyer d'e-mail : connexion, STARTTLS (certificat vérifié),
// authentification, QUIT. N'affiche jamais le mot de passe ; seulement l'hôte, le port et le résultat.
//   docker exec ytc-account node dist/tools/smtp-check.js
import { loadConfig } from "../config.ts";
import { SmtpMailer } from "../mailer.ts";

const cfg = loadConfig();
if (!cfg.mail) {
  console.log("relais SMTP : non configuré (SMTP_USER ou SMTP_PASSWORD_FILE absent) — inscription par e-mail fermée");
  process.exit(3);
}
try {
  await new SmtpMailer(cfg.mail).verify();
  console.log(`relais SMTP ${cfg.mail.host}:${cfg.mail.port} : connexion, STARTTLS et authentification OK (aucun e-mail envoyé)`);
} catch (e) {
  console.log(`relais SMTP ${cfg.mail.host}:${cfg.mail.port} : ÉCHEC — ${e instanceof Error ? e.message : "?"}`);
  process.exit(1);
}
