// Types de scripts/xml-bien-forme.mjs.
/** null si le texte est du XML 1.0 bien formé, sinon « ligne:colonne : motif ». */
export function verifierXml(texte: string): string | null;
/** Contre-épreuve par expat (Python) : null (bien formé), un message d'erreur, ou "absent" (python3 introuvable). */
export function contreEpreuveExpat(chemin: string): string | null;
