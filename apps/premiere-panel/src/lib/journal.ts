// Journal local du panneau : jamais de secret. Toute ligne passe par masquer() avant d'être gardée ou écrite :
// clés ytc_…, en-têtes « Bearer … », codes d'appareil et champs JSON sensibles sont remplacés par « [masqué] ».
// Le journal est gardé en mémoire (200 lignes, montrées dans le diagnostic) et confié à l'hôte, qui l'écrit dans
// %LOCALAPPDATA%\AETHRYON\journaux\panneau-AAAA-MM-JJ.log (contrat d'échange §1).

export type Niveau = "info" | "attention" | "erreur";

export interface LigneJournal {
  le: string;
  niveau: Niveau;
  message: string;
}

const MOTIFS: RegExp[] = [
  /\bytc_[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /("?(?:cle|clé|codeAppareil|token|jeton|authorization|secret|password|motDePasse)"?\s*[:=]\s*)("[^"]*"|[^\s,;}]+)/gi,
];

const secretsConnus = new Set<string>();

/** Déclare une valeur secrète précise (la clé reçue, le code d'appareil) : elle sera masquée partout. */
export function declarerSecret(valeur: string | null | undefined): void {
  if (valeur && valeur.length >= 6) secretsConnus.add(valeur);
}

export function oublierSecret(valeur: string | null | undefined): void {
  if (valeur) secretsConnus.delete(valeur);
}

export function masquer(texte: unknown): string {
  let s = typeof texte === "string" ? texte : texte instanceof Error ? `${texte.name}: ${texte.message}` : safeJson(texte);
  for (const v of secretsConnus) s = s.split(v).join("[masqué]");
  s = s.replace(MOTIFS[0]!, "[masqué]").replace(MOTIFS[1]!, "Bearer [masqué]");
  s = s.replace(MOTIFS[2]!, (_m, debut: string) => debut + "[masqué]");
  return s;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export interface Journal {
  ecrire(niveau: Niveau, message: unknown): void;
  lignes(): LigneJournal[];
  surLigne(f: (l: LigneJournal) => void): () => void;
}

export function creerJournal(max = 200): Journal {
  const tampon: LigneJournal[] = [];
  const abonnes = new Set<(l: LigneJournal) => void>();
  return {
    ecrire(niveau, message) {
      const l: LigneJournal = { le: new Date().toISOString(), niveau, message: masquer(message).slice(0, 2000) };
      tampon.push(l);
      if (tampon.length > max) tampon.shift();
      for (const f of abonnes) {
        try {
          f(l);
        } catch {
          /* un abonné défaillant ne bloque pas le journal */
        }
      }
    },
    lignes: () => tampon.slice(),
    surLigne(f) {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
  };
}
