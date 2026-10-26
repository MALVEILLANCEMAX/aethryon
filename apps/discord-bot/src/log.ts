// Journal JSON (une ligne par événement) SANS donnée personnelle : jamais d'identifiant d'utilisateur, de
// serveur ou de salon, jamais de lien ni de texte saisi, et le token (ou tout ce qui y ressemble) masqué.
const secrets = new Set<string>();
const TOKENISH = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}/g;
// Défense en profondeur (rien de tel n'est journalisé volontairement) : clés ytc_ et jetons de lien de téléchargement.
const YTC_KEY = /ytc_[A-Za-z0-9]{8,}/g;
const DOWNLOAD_TOKEN = /jeton=[A-Za-z0-9_-]+/g;

/** Déclare une valeur à masquer partout dans les journaux (le token, dès sa lecture). */
export function addSecret(value: string) {
  if (value) secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[secret]");
  return out.replace(TOKENISH, "[secret]").replace(YTC_KEY, "[secret]").replace(DOWNLOAD_TOKEN, "jeton=[secret]");
}

type Level = "info" | "warn" | "error";
export function log(level: Level, msg: string, data: Record<string, string | number | boolean | null> = {}) {
  const line = redact(JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }));
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}
