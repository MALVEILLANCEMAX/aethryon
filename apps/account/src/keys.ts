// Jetons API personnels. Le plugin Better Auth génère et hache les clés (SHA-256) ; ce module ajoute
// le plafond par utilisateur, la révocation datée, la rotation et la présentation (jamais le secret).
// Trois types de clés (ytc_key_meta.kind) : « shortcut » (raccourci iPhone, créées depuis « Mes jetons »,
// plafond MAX_KEYS_PER_USER), « extension » (extension navigateur, émises par l'échange PKCE de
// docs/EXTENSION.md §7 : 30 jours (correction S1 de docs/PLAN-EXTENSION.md), au plus MAX_EXTENSION_KEYS actives, hors du
// plafond du raccourci, jamais renommées) et
// « discord » (clés de 15 min émises pour le bot Discord d'un compte lié, docs/DISCORD-BOT.md §17 : au plus
// MAX_DISCORD_KEYS actives, jamais listées dans « Mes jetons », effacées au retour arrière de la migration 005) et
// « outils » (clés de 15 min émises pour un compte connecté au site : account les garde en mémoire pour relayer à ytapi
// les demandes d'AETHRYON Tools, docs/OUTILS.md ; jamais remises au navigateur, jamais listées, effacées au retour arrière
// de la migration 010) et
// « premiere » (panneau AETHRYON pour Premiere Pro, émises après la page d'accord /premiere/connecter,
// premiere.ts : 30 jours, au plus MAX_PREMIERE_KEYS actives, mêmes droits et même quota qu'une clé d'extension,
// listées à part dans « Mes jetons », jamais renommées ni régénérées, effacées au retour arrière de la migration 012) et
// « desktop » (AETHRYON Desktop, émises après la page d'accord /desktop/connecter, desktop.ts : 30 jours, au plus
// MAX_DESKTOP_KEYS actives, gardées par le cœur Rust du Desktop (DPAPI), mêmes droits qu'une clé d'appareil et, pour
// l'administrateur, AETHRYON Cloud ; listées à part dans « Mes jetons », jamais renommées ni régénérées, effacées au retour
// arrière de la migration 014).
import { defaultKeyHasher } from "@better-auth/api-key";
import type { Auth } from "./auth.ts";
import { writeTx, type DB } from "./db.ts";
import { nowIso } from "./time.ts";

export type KeyStatus = "active" | "revoked" | "expired";
export type KeyKind = "shortcut" | "extension" | "discord" | "outils" | "premiere" | "desktop";
export type RevokeReason = "user" | "rotation" | "admin" | "account_deleted" | "replay" | "unlink" | "released";

const NB = "\u00a0"; // espace insécable (typographie française)

/** Clés d'extension actives par compte (docs/EXTENSION.md §7). */
export const MAX_EXTENSION_KEYS = 3;
/** Durée de validité d'une clé d'extension, en jours (S1 : 30 jours, docs/PLAN-EXTENSION.md §3). */
export const EXTENSION_KEY_DAYS = 30;
export const TOO_MANY_EXTENSIONS_TEXT =
  `Tu as déjà ${MAX_EXTENSION_KEYS} extensions connectées à ton compte${NB}: révoque un appareil dans «${NB}Mes jetons${NB}», puis reconnecte l'extension.`;

/** Panneaux Premiere connectés (clés « premiere » actives) par compte. */
export const MAX_PREMIERE_KEYS = 3;
/** Durée de validité d'une clé « premiere », en jours (V2-CONNEXION.md, point 5). */
export const PREMIERE_KEY_DAYS = 30;
export const TOO_MANY_PREMIERE_TEXT =
  `Tu as déjà ${MAX_PREMIERE_KEYS} ordinateurs connectés à AETHRYON pour Premiere Pro${NB}: révoque-en un dans «${NB}Mes jetons${NB}», puis reconnecte Premiere Pro.`;

/** Ordinateurs AETHRYON Desktop reliés (clés « desktop » actives) par compte. */
export const MAX_DESKTOP_KEYS = 3;
/** Durée de validité d'une clé « desktop », en jours (comme le panneau Premiere ; le Desktop se relie ensuite). */
export const DESKTOP_KEY_DAYS = 30;
export const TOO_MANY_DESKTOP_TEXT =
  `Tu as déjà ${MAX_DESKTOP_KEYS} ordinateurs reliés à AETHRYON Desktop${NB}: déconnecte-en un dans «${NB}Mes jetons${NB}», puis relie ce Desktop.`;

/** Clés « discord » actives (conversion en cours) par compte : au-delà, refus « too_many_sessions ». */
export const MAX_DISCORD_KEYS = 3;
/** Durée de validité d'une clé « discord » (15 min = durée d'un jeton d'interaction Discord). */
export const DISCORD_KEY_TTL_S = 15 * 60;
export const TOO_MANY_DISCORD_TEXT = `Trop de conversions en cours depuis Discord${NB}: attends qu'elles se terminent.`;

/** Clés « outils » actives par compte (AETHRYON Tools) : au-delà, les plus anciennes sont rendues (« released »). */
export const MAX_TOOLS_KEYS = 2;
/** Durée de validité d'une clé « outils ». */
export const TOOLS_KEY_TTL_S = 15 * 60;

/** Nom de la clé : « Extension Chrome · <appareil> », borné à 40 caractères (limite du plugin). */
export function extensionKeyName(deviceLabel: string): string {
  const chars = Array.from(`Extension Chrome · ${deviceLabel}`);
  return chars.length <= 40 ? chars.join("") : `${chars.slice(0, 39).join("").trimEnd()}…`;
}

/** Nom de la clé : « Premiere Pro · <ordinateur> », borné à 40 caractères (limite du plugin). */
export function premiereKeyName(deviceLabel: string): string {
  const chars = Array.from(`Premiere Pro · ${deviceLabel}`);
  return chars.length <= 40 ? chars.join("") : `${chars.slice(0, 39).join("").trimEnd()}…`;
}

/** Nom de la clé : « AETHRYON Desktop · <ordinateur> », borné à 40 caractères (limite du plugin). */
export function desktopKeyName(deviceLabel: string): string {
  const chars = Array.from(`AETHRYON Desktop · ${deviceLabel}`);
  return chars.length <= 40 ? chars.join("") : `${chars.slice(0, 39).join("").trimEnd()}…`;
}

const KINDS: ReadonlySet<string> = new Set(["shortcut", "extension", "discord", "outils", "premiere", "desktop"]);
/** Types dont la clé est liée à un appareil (nom d'appareil affiché et gardé). */
const DEVICE_KINDS: ReadonlySet<string> = new Set(["extension", "premiere", "desktop"]);

export interface KeyView {
  id: string;
  name: string;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: KeyStatus;
  kind: KeyKind;
  deviceLabel: string | null; // appareil lié (clés d'extension et du panneau Premiere seulement)
}

export class KeyError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

interface Row {
  id: string;
  name: string | null;
  start: string | null;
  referenceId: string;
  enabled: number | null;
  expiresAt: string | number | null;
  createdAt: string | number;
  lastRequest: string | number | null;
  revoked_at: string | null;
  kind: string | null;
  device_label: string | null;
}

const toIso = (v: string | number | null | undefined): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(typeof v === "number" ? v : /^\d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function statusOf(r: Pick<Row, "revoked_at" | "enabled" | "expiresAt">, now = Date.now()): KeyStatus {
  if (r.revoked_at || r.enabled === 0) return "revoked";
  const exp = toIso(r.expiresAt);
  if (exp && Date.parse(exp) <= now) return "expired";
  return "active";
}

function view(r: Row): KeyView {
  return {
    id: r.id,
    name: r.name ?? "",
    start: r.start ?? "ytc_",
    createdAt: toIso(r.createdAt) ?? nowIso(),
    lastUsedAt: toIso(r.lastRequest),
    expiresAt: toIso(r.expiresAt),
    revokedAt: r.revoked_at,
    status: statusOf(r),
    kind: r.kind && KINDS.has(r.kind) ? r.kind as KeyKind : "shortcut",
    deviceLabel: r.kind && DEVICE_KINDS.has(r.kind) ? r.device_label ?? null : null,
  };
}

const SELECT =
  'SELECT k.id, k.name, k.start, k.referenceId, k.enabled, k.expiresAt, k.createdAt, k.lastRequest, m.revoked_at, m.kind, m.device_label ' +
  "FROM apikey k LEFT JOIN ytc_key_meta m ON m.key_id = k.id";

/** Nom de jeton : 1 à 40 caractères, sans caractères de contrôle. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new KeyError(400, "invalid_name", "Donne un nom à ton jeton (1 à 40 caractères).");
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new KeyError(400, "invalid_name", "Donne un nom à ton jeton (1 à 40 caractères).");
  }
  return name;
}

export class KeyService {
  // Verrou par utilisateur : sérialise création / rotation pour que le plafond ne soit jamais dépassé.
  private locks = new Map<string, Promise<unknown>>();

  private db: DB;
  private auth: Auth;
  private maxKeys: number;
  constructor(db: DB, auth: Auth, maxKeys: number) { this.db = db; this.auth = auth; this.maxKeys = maxKeys; }

  private async withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chain = prev.then(() => mine);
    this.locks.set(userId, chain);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(userId) === chain) this.locks.delete(userId);
    }
  }

  /**
   * Clés d'un compte (50 plus récentes). Les clés « discord » (une par conversion, 15 min) ne sont pas des
   * jetons gérés par l'utilisateur : absentes de « Mes jetons », présentes seulement dans l'export.
   */
  list(userId: string, opts: { includeDiscord?: boolean } = {}): KeyView[] {
    const filter = opts.includeDiscord ? "" : " AND COALESCE(m.kind, 'shortcut') NOT IN ('discord', 'outils')";
    const rows = this.db.prepare(`${SELECT} WHERE k.referenceId = ?${filter} ORDER BY k.createdAt DESC LIMIT 50`).all(userId) as unknown as Row[];
    return rows.map(view);
  }

  get(userId: string, keyId: string): KeyView {
    const r = this.db.prepare(`${SELECT} WHERE k.id = ? AND k.referenceId = ?`).get(keyId, userId) as unknown as Row | undefined;
    if (!r) throw new KeyError(404, "key_not_found", "Jeton introuvable.");
    return view(r);
  }

  /** Clés actives d'un type (par défaut celles du raccourci : seules comptées dans MAX_KEYS_PER_USER). */
  activeCount(userId: string, kind: KeyKind = "shortcut"): number {
    const now = new Date().toISOString();
    const r = this.db.prepare(
      "SELECT count(*) AS n FROM apikey k LEFT JOIN ytc_key_meta m ON m.key_id = k.id " +
      "WHERE k.referenceId = ? AND (k.enabled IS NULL OR k.enabled <> 0) AND m.revoked_at IS NULL AND (k.expiresAt IS NULL OR k.expiresAt > ?) " +
      "AND COALESCE(m.kind, 'shortcut') = ?",
    ).get(userId, now, kind) as { n: number };
    return Number(r.n);
  }

  private async createRaw(userId: string, name: string, expiresInDays: number | null): Promise<{ id: string; secret: string }> {
    const created = (await this.auth.api.createApiKey({
      body: { userId, name, ...(expiresInDays ? { expiresIn: expiresInDays * 86_400 } : {}) },
    })) as { id: string; key: string };
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES (?, ?, ?, 'shortcut')").run(created.id, userId, nowIso());
    });
    return { id: created.id, secret: created.key };
  }

  /** Supprime une clé brute jamais remise à personne (enregistrement refusé ou échoué). */
  private async dropRaw(keyId: string): Promise<void> {
    await writeTx(this.db, () => {
      this.db.prepare("DELETE FROM apikey WHERE id = ?").run(keyId);
      this.db.prepare("DELETE FROM ytc_key_meta WHERE key_id = ?").run(keyId);
    });
  }

  /**
   * Clé d'extension (docs/EXTENSION.md §7) : type « extension », nom « Extension Chrome · <appareil> »,
   * 30 jours (S1), hors du plafond du raccourci, au plus MAX_EXTENSION_KEYS actives (409 au-delà).
   * `claim(keyId)` s'exécute DANS la transaction qui enregistre la clé (méta « extension ») : il marque
   * le code d'autorisation utilisé et lie la clé au code, ou refuse (false, code déjà utilisé ou expiré).
   * Refus ou échec : la clé brute créée juste avant par le plugin (secret jamais remis) est supprimée.
   * Retour null = refus de `claim`.
   */
  async createExtensionKey(userId: string, deviceLabel: string, claim: (keyId: string) => boolean): Promise<{ key: KeyView; secret: string } | null> {
    return this.createDeviceKey("extension", userId, deviceLabel, claim);
  }

  /**
   * Clé du panneau AETHRYON pour Premiere Pro (premiere.ts) : type « premiere », nom « Premiere Pro · <ordinateur> »,
   * 30 jours, hors du plafond du raccourci, au plus MAX_PREMIERE_KEYS actives (409 au-delà). `claim(keyId)` s'exécute
   * DANS la transaction qui enregistre la clé : il marque la demande d'appairage « clé remise » (usage unique) ou refuse.
   * Mêmes garanties que createExtensionKey (clé brute supprimée si refus ou échec ; null = refus de `claim`).
   */
  async createPremiereKey(userId: string, deviceLabel: string, claim: (keyId: string) => boolean): Promise<{ key: KeyView; secret: string } | null> {
    return this.createDeviceKey("premiere", userId, deviceLabel, claim);
  }

  /**
   * Clé « desktop » (AETHRYON Desktop relié par la page d'accord /desktop/connecter, desktop.ts) : 30 jours, au plus
   * MAX_DESKTOP_KEYS actives (409 au-delà). Mêmes garanties que createPremiereKey (`claim` dans la transaction).
   */
  async createDesktopKey(userId: string, deviceLabel: string, claim: (keyId: string) => boolean): Promise<{ key: KeyView; secret: string } | null> {
    return this.createDeviceKey("desktop", userId, deviceLabel, claim);
  }

  private async createDeviceKey(kind: "extension" | "premiere" | "desktop", userId: string, deviceLabel: string, claim: (keyId: string) => boolean): Promise<{ key: KeyView; secret: string } | null> {
    const spec = {
      extension: { max: MAX_EXTENSION_KEYS, days: EXTENSION_KEY_DAYS, name: extensionKeyName, refus: () => new KeyError(409, "too_many_extensions", TOO_MANY_EXTENSIONS_TEXT) },
      premiere: { max: MAX_PREMIERE_KEYS, days: PREMIERE_KEY_DAYS, name: premiereKeyName, refus: () => new KeyError(409, "too_many_premiere", TOO_MANY_PREMIERE_TEXT) },
      desktop: { max: MAX_DESKTOP_KEYS, days: DESKTOP_KEY_DAYS, name: desktopKeyName, refus: () => new KeyError(409, "too_many_desktop", TOO_MANY_DESKTOP_TEXT) },
    }[kind];
    return this.withLock(userId, async () => {
      if (this.activeCount(userId, kind) >= spec.max) throw spec.refus();
      const created = (await this.auth.api.createApiKey({
        body: { userId, name: spec.name(deviceLabel), expiresIn: spec.days * 86_400 },
      })) as { id: string; key: string };
      let claimed = false;
      try {
        claimed = await writeTx(this.db, () => {
          if (!claim(created.id)) return false;
          this.db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind, device_label) VALUES (?, ?, ?, ?, ?)")
            .run(created.id, userId, nowIso(), kind, deviceLabel);
          return true;
        });
      } catch (e) {
        await this.dropRaw(created.id).catch(() => undefined);
        throw e;
      }
      if (!claimed) {
        await this.dropRaw(created.id);
        return null;
      }
      return { key: this.get(userId, created.id), secret: created.key };
    });
  }

  /**
   * Clé « discord » de 15 min pour un compte lié (docs/DISCORD-BOT.md §17). `purpose` :
   * - « session » : conversion lancée par le bot ; au plus MAX_DISCORD_KEYS actives (429 au-delà) ;
   * - « download » : relais d'un lien de téléchargement par account ; hors plafond (révoquée dès la réponse de ytapi).
   * Le secret n'est remis qu'à l'appelant (jamais stocké ; seule l'empreinte reste en base).
   */
  async createDiscordKey(userId: string, purpose: "session" | "download"): Promise<{ key: KeyView; secret: string }> {
    return this.withLock(userId, async () => {
      if (purpose === "session" && this.activeCount(userId, "discord") >= MAX_DISCORD_KEYS) {
        throw new KeyError(429, "too_many_sessions", TOO_MANY_DISCORD_TEXT);
      }
      const created = (await this.auth.api.createApiKey({
        body: { userId, name: purpose === "session" ? "Discord · conversion" : "Discord · téléchargement", expiresIn: DISCORD_KEY_TTL_S },
      })) as { id: string; key: string };
      try {
        await writeTx(this.db, () => {
          this.db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES (?, ?, ?, 'discord')").run(created.id, userId, nowIso());
        });
      } catch (e) {
        await this.dropRaw(created.id).catch(() => undefined);
        throw e;
      }
      return { key: this.get(userId, created.id), secret: created.key };
    });
  }

  /**
   * Clé « outils » de 15 min pour un compte connecté au site (AETHRYON Tools, docs/OUTILS.md) : account la garde en
   * mémoire et relaie à ytapi les demandes de l'éditeur. Au plus MAX_TOOLS_KEYS actives : les plus anciennes sont rendues.
   * Le secret n'est remis qu'à l'appelant (le service des outils), jamais au navigateur ; seule l'empreinte reste en base.
   */
  async createToolsKey(userId: string): Promise<{ key: KeyView; secret: string }> {
    return this.withLock(userId, async () => {
      const now = new Date().toISOString();
      const active = (this.db.prepare(
        "SELECT k.id FROM apikey k JOIN ytc_key_meta m ON m.key_id = k.id WHERE k.referenceId = ? AND m.kind = 'outils' " +
        "AND m.revoked_at IS NULL AND (k.enabled IS NULL OR k.enabled <> 0) AND (k.expiresAt IS NULL OR k.expiresAt > ?) ORDER BY k.createdAt ASC",
      ).all(userId, now) as { id: string }[]).map((r) => r.id);
      const surplus = active.slice(0, Math.max(0, active.length - (MAX_TOOLS_KEYS - 1)));
      if (surplus.length) await writeTx(this.db, () => { for (const id of surplus) this.revokeSync(userId, id, "released"); });
      const created = (await this.auth.api.createApiKey({
        body: { userId, name: "AETHRYON Tools", expiresIn: TOOLS_KEY_TTL_S },
      })) as { id: string; key: string };
      try {
        await writeTx(this.db, () => {
          this.db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES (?, ?, ?, 'outils')").run(created.id, userId, nowIso());
        });
      } catch (e) {
        await this.dropRaw(created.id).catch(() => undefined);
        throw e;
      }
      return { key: this.get(userId, created.id), secret: created.key };
    });
  }

  /** Révoque toutes les clés actives d'un type (déliaison Discord : motif « unlink »). Renvoie leur nombre. */
  async revokeKind(userId: string, kind: KeyKind, reason: RevokeReason): Promise<number> {
    const now = new Date().toISOString();
    const ids = (this.db.prepare(
      "SELECT k.id FROM apikey k JOIN ytc_key_meta m ON m.key_id = k.id " +
      "WHERE k.referenceId = ? AND m.kind = ? AND m.revoked_at IS NULL AND (k.enabled IS NULL OR k.enabled <> 0) AND (k.expiresAt IS NULL OR k.expiresAt > ?)",
    ).all(userId, kind, now) as { id: string }[]).map((r) => r.id);
    if (ids.length) await writeTx(this.db, () => { for (const id of ids) this.revokeSync(userId, id, reason); });
    return ids.length;
  }

  async create(userId: string, rawName: unknown, rawExpires: unknown): Promise<{ key: KeyView; secret: string }> {
    const name = cleanName(rawName);
    let expiresInDays: number | null = null;
    if (rawExpires !== undefined && rawExpires !== null) {
      if (rawExpires !== 30 && rawExpires !== 90 && rawExpires !== 365) {
        throw new KeyError(400, "invalid_expiry", "Durée de validité possible : 30, 90 ou 365 jours, ou sans expiration.");
      }
      expiresInDays = rawExpires;
    }
    return this.withLock(userId, async () => {
      if (this.activeCount(userId) >= this.maxKeys) {
        throw new KeyError(409, "too_many_keys", `Tu as déjà ${this.maxKeys} jetons actifs. Révoque-en un pour en créer un nouveau.`);
      }
      const { id, secret } = await this.createRaw(userId, name, expiresInDays);
      return { key: this.get(userId, id), secret };
    });
  }

  async rename(userId: string, keyId: string, rawName: unknown): Promise<KeyView> {
    const name = cleanName(rawName);
    // S1 : le nom d'une extension connectée est celui de son appareil (affiché au consentement) : il ne change pas.
    if (this.get(userId, keyId).kind !== "shortcut") throw new KeyError(409, "rename_forbidden", `Le nom d'une extension connectée est celui de son appareil${NB}: il ne se modifie pas.`);
    await writeTx(this.db, () => {
      this.db.prepare("UPDATE apikey SET name = ? WHERE id = ? AND referenceId = ?").run(name, keyId, userId);
    });
    return this.get(userId, keyId);
  }

  private revokeSync(userId: string, keyId: string, reason: RevokeReason, replacedBy: string | null = null): void {
    const now = nowIso();
    this.db.prepare("UPDATE apikey SET enabled = 0 WHERE id = ? AND referenceId = ?").run(keyId, userId);
    this.db.prepare(
      "INSERT INTO ytc_key_meta (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(key_id) DO UPDATE SET revoked_at = COALESCE(ytc_key_meta.revoked_at, excluded.revoked_at), " +
      "revoked_reason = COALESCE(ytc_key_meta.revoked_reason, excluded.revoked_reason), replaced_by = COALESCE(excluded.replaced_by, ytc_key_meta.replaced_by)",
    ).run(keyId, userId, now, reason, replacedBy, now);
  }

  async revoke(userId: string, keyId: string, reason: "user" | "admin" | "replay" | "released" | "unlink" = "user"): Promise<KeyView> {
    this.get(userId, keyId);
    await writeTx(this.db, () => this.revokeSync(userId, keyId, reason));
    return this.get(userId, keyId);
  }

  /** Révoque toutes les clés d'un utilisateur (suspension par l'administrateur). */
  async revokeAll(userId: string, reason: "admin" | "account_deleted"): Promise<void> {
    const ids = (this.db.prepare("SELECT id FROM apikey WHERE referenceId = ?").all(userId) as { id: string }[]).map((r) => r.id);
    await writeTx(this.db, () => { for (const id of ids) this.revokeSync(userId, id, reason); });
  }

  /** Nouvelle clé de même nom, l'ancienne révoquée ; si la révocation échoue, la nouvelle est supprimée. */
  async rotate(userId: string, keyId: string): Promise<{ key: KeyView; secret: string; revokedKeyId: string }> {
    return this.withLock(userId, async () => {
      const old = this.get(userId, keyId);
      if (old.status !== "active") throw new KeyError(409, "key_not_active", "Seul un jeton actif peut être régénéré.");
      // Une clé d'extension se renouvelle en reconnectant l'extension (code + PKCE), jamais par rotation :
      // la rotation créerait une clé du raccourci et contournerait son plafond.
      if (old.kind === "extension") {
        throw new KeyError(409, "extension_key", `Une extension connectée ne se régénère pas${NB}: révoque-la, puis reconnecte l'extension depuis le navigateur.`);
      }
      // Même règle pour le panneau Premiere : il se reconnecte par la page d'accord.
      if (old.kind === "premiere") {
        throw new KeyError(409, "premiere_key", `Premiere Pro connecté ne se régénère pas${NB}: révoque l'accès, puis reconnecte Premiere Pro depuis le panneau AETHRYON.`);
      }
      // Et pour AETHRYON Desktop : il se relie depuis Paramètres › Compte.
      if (old.kind === "desktop") {
        throw new KeyError(409, "desktop_key", `AETHRYON Desktop relié ne se régénère pas${NB}: déconnecte-le, puis relie-le depuis Paramètres › Compte du Desktop.`);
      }
      // Même règle pour une clé « discord » ou « outils » (15 min, émise pour un relais d'AETHRYON) : jamais transformée en
      // jeton du raccourci.
      if (old.kind === "discord" || old.kind === "outils") {
        throw new KeyError(409, "discord_key", `Une clé du bot Discord ne se régénère pas${NB}: elle expire d'elle-même au bout de 15 minutes.`);
      }
      const exp = old.expiresAt ? Math.max(1, Math.ceil((Date.parse(old.expiresAt) - Date.parse(old.createdAt)) / 86_400_000)) : null;
      const days = exp === null ? null : ([30, 90, 365].find((d) => d >= exp) ?? 365);
      const { id, secret } = await this.createRaw(userId, old.name || "Mon iPhone", days);
      try {
        await writeTx(this.db, () => this.revokeSync(userId, keyId, "rotation", id));
      } catch (err) {
        await writeTx(this.db, () => {
          this.db.prepare("DELETE FROM apikey WHERE id = ?").run(id);
          this.db.prepare("DELETE FROM ytc_key_meta WHERE key_id = ?").run(id);
        });
        throw err;
      }
      return { key: this.get(userId, id), secret, revokedKeyId: keyId };
    });
  }

  /** Vérifie un secret collé par l'utilisateur, uniquement parmi SES clés. */
  async check(userId: string, secret: unknown): Promise<{ valid: boolean; status: KeyStatus | "unknown"; keyId?: string; name?: string; reason?: string }> {
    if (typeof secret !== "string" || secret.length < 10 || secret.length > 200) return { valid: false, status: "unknown", reason: "format" };
    const hashed = await defaultKeyHasher(secret.trim());
    const r = this.db.prepare(`${SELECT} WHERE k.key = ? AND k.referenceId = ?`).get(hashed, userId) as unknown as Row | undefined;
    if (!r) return { valid: false, status: "unknown", reason: "not_found" };
    const st = statusOf(r);
    return { valid: st === "active", status: st, keyId: r.id, name: r.name ?? "" };
  }

  /** Clé (active ou non) correspondant à un secret, toutes utilisateurs confondus — usage interne. */
  async lookupBySecret(secret: string): Promise<(KeyView & { userId: string }) | null> {
    const hashed = await defaultKeyHasher(secret);
    const r = this.db.prepare(`${SELECT} WHERE k.key = ?`).get(hashed) as unknown as Row | undefined;
    return r ? { ...view(r), userId: r.referenceId } : null;
  }

}
