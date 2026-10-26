// SHA-1 en JavaScript pur (identifiant du contrat d'échange : sha1 hex du chemin normalisé, §3). Repris du panneau
// bêta 2 (bibliotheque.js) pour donner exactement les mêmes identifiants qu'AETHRYON Desktop. Pas de sécurité ici :
// c'est une clé de déduplication, jamais une empreinte de secret.

function utf8(texte: string): number[] {
  const o: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    let c = texte.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {
      const d = texte.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) o.push(c);
    else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return o;
}

export function sha1(texte: string): string {
  const m = utf8(texte);
  const l = m.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let b = 0; b < m.length; b += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[b + 4 * i]! << 24) | (m[b + 4 * i + 1]! << 16) | (m[b + 4 * i + 2]! << 8) | m[b + 4 * i + 3]!;
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; }
      else if (i < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = bb ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((v) => ("00000000" + (v >>> 0).toString(16)).slice(-8)).join("");
}
