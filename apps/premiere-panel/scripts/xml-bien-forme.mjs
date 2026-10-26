// Contrôle de BONNE FORME XML 1.0, sans dépendance, pour CSXS/manifest.xml (CEP refuse un manifeste mal formé).
// Il couvre ce qu'un manifeste CEP peut contenir : déclaration XML, commentaires, instructions de traitement,
// sections CDATA, éléments imbriqués, attributs entre guillemets, références d'entités prédéfinies ou numériques.
// Il refuse : « -- » dans un commentaire ou un commentaire finissant par « - » (XML 1.0 §2.5), DOCTYPE (inutile ici),
// balises mal imbriquées ou non fermées, attribut en double ou sans guillemets, « < » ou « & » nus, « ]]> » dans le
// texte, caractères de contrôle, plusieurs racines ou du texte hors de la racine.
// verifierXml(texte) renvoie null si le document est bien formé, sinon « ligne:colonne : motif ».
// Contre-épreuve facultative : contreEpreuveExpat(chemin) passe le fichier à l'analyseur expat de Python (s'il existe).

import { spawnSync } from "node:child_process";

const NOM = /^[A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�][A-Za-z0-9_:.\-·À-ÖØ-öø-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]*/;
const ENTITE = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/;
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

export function verifierXml(texte) {
  let i = 0;
  const pile = [];
  let racineVue = false;
  let racineFermee = false;
  const position = (k) => {
    const avant = texte.slice(0, k).split("\n");
    return `${avant.length}:${avant[avant.length - 1].length + 1}`;
  };
  const echec = (k, motif) => `${position(k)} : ${motif}`;

  const m = CONTROLE.exec(texte);
  if (m) return echec(m.index, "caractère de contrôle interdit");
  if (texte.charCodeAt(0) === 0xfeff) i = 1; // marque d'ordre des octets

  if (texte.startsWith("<?xml", i)) {
    const fin = texte.indexOf("?>", i);
    if (fin < 0) return echec(i, "déclaration XML non fermée");
    const decl = texte.slice(i + 5, fin);
    if (!/^\s+version\s*=\s*(["'])1\.[0-9]+\1(\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\3)?(\s+standalone\s*=\s*(["'])(yes|no)\5)?\s*$/.test(decl)) {
      return echec(i, "déclaration XML invalide");
    }
    i = fin + 2;
  } else if (/^\s*<\?xml[\s?]/i.test(texte.slice(i))) {
    return echec(i, "la déclaration XML doit être au tout début du fichier");
  }

  while (i < texte.length) {
    const lt = texte.indexOf("<", i);
    const brut = texte.slice(i, lt < 0 ? texte.length : lt);
    // Texte entre deux balises.
    if (brut.length) {
      if (!pile.length && /\S/.test(brut)) return echec(i, "texte hors de l'élément racine");
      if (brut.includes("]]>")) return echec(i + brut.indexOf("]]>"), "« ]]> » interdit dans le texte");
      for (let k = brut.indexOf("&"); k >= 0; k = brut.indexOf("&", k + 1)) {
        if (!ENTITE.test(brut.slice(k))) return echec(i + k, "« & » nu ou entité inconnue");
      }
    }
    if (lt < 0) break;
    i = lt;
    if (texte.startsWith("<!--", i)) {
      const fin = texte.indexOf("-->", i + 4);
      if (fin < 0) return echec(i, "commentaire non fermé");
      const corps = texte.slice(i + 4, fin);
      const k = corps.indexOf("--");
      if (k >= 0) return echec(i + 4 + k, "« -- » interdit dans un commentaire (XML 1.0 §2.5)");
      if (corps.endsWith("-")) return echec(fin - 1, "un commentaire ne peut pas finir par « - »");
      i = fin + 3;
      continue;
    }
    if (texte.startsWith("<![CDATA[", i)) {
      if (!pile.length) return echec(i, "section CDATA hors de l'élément racine");
      const fin = texte.indexOf("]]>", i + 9);
      if (fin < 0) return echec(i, "section CDATA non fermée");
      i = fin + 3;
      continue;
    }
    if (texte.startsWith("<!", i)) return echec(i, "déclaration « <! » non admise dans un manifeste (DOCTYPE, ENTITY…)");
    if (texte.startsWith("<?", i)) {
      const fin = texte.indexOf("?>", i + 2);
      if (fin < 0) return echec(i, "instruction de traitement non fermée");
      const cible = NOM.exec(texte.slice(i + 2));
      if (!cible || /^xml$/i.test(cible[0])) return echec(i, "instruction de traitement invalide");
      i = fin + 2;
      continue;
    }
    if (texte.startsWith("</", i)) {
      const nom = NOM.exec(texte.slice(i + 2));
      if (!nom) return echec(i, "balise fermante sans nom");
      const apres = i + 2 + nom[0].length;
      const fin = /^\s*>/.exec(texte.slice(apres));
      if (!fin) return echec(apres, "balise fermante mal formée");
      const ouvert = pile.pop();
      if (ouvert !== nom[0]) return echec(i, ouvert ? `« </${nom[0]}> » ferme « <${ouvert}> »` : `« </${nom[0]}> » sans ouverture`);
      if (!pile.length) racineFermee = true;
      i = apres + fin[0].length;
      continue;
    }
    // Balise ouvrante ou vide.
    const nom = NOM.exec(texte.slice(i + 1));
    if (!nom) return echec(i, "« < » nu ou nom d'élément invalide");
    if (!pile.length) {
      if (racineVue) return echec(i, "plusieurs éléments racines");
      racineVue = true;
    }
    let k = i + 1 + nom[0].length;
    const vus = new Set();
    for (;;) {
      const blanc = /^\s*/.exec(texte.slice(k))[0];
      k += blanc.length;
      if (texte.startsWith("/>", k)) {
        k += 2;
        if (!pile.length) racineFermee = true;
        break;
      }
      if (texte[k] === ">") {
        k += 1;
        pile.push(nom[0]);
        break;
      }
      if (k >= texte.length) return echec(i, `balise « <${nom[0]}> » non fermée`);
      if (!blanc.length) return echec(k, "espace attendu avant un attribut");
      const attr = NOM.exec(texte.slice(k));
      if (!attr) return echec(k, "nom d'attribut invalide");
      if (vus.has(attr[0])) return echec(k, `attribut « ${attr[0]} » en double`);
      vus.add(attr[0]);
      k += attr[0].length;
      const egal = /^\s*=\s*/.exec(texte.slice(k));
      if (!egal) return echec(k, `« = » attendu après « ${attr[0]} »`);
      k += egal[0].length;
      const q = texte[k];
      if (q !== '"' && q !== "'") return echec(k, `valeur de « ${attr[0]} » sans guillemets`);
      const fin = texte.indexOf(q, k + 1);
      if (fin < 0) return echec(k, `valeur de « ${attr[0]} » non fermée`);
      const valeur = texte.slice(k + 1, fin);
      if (valeur.includes("<")) return echec(k, `« < » dans la valeur de « ${attr[0]} »`);
      for (let a = valeur.indexOf("&"); a >= 0; a = valeur.indexOf("&", a + 1)) {
        if (!ENTITE.test(valeur.slice(a))) return echec(k + 1 + a, `« & » nu dans la valeur de « ${attr[0]} »`);
      }
      k = fin + 1;
    }
    i = k;
  }
  if (pile.length) return echec(texte.length, `« <${pile[pile.length - 1]}> » jamais fermé`);
  if (!racineVue || !racineFermee) return echec(texte.length, "aucun élément racine");
  return null;
}

/** Contre-épreuve par expat (Python), si python3 est présent : null (bien formé), un message, ou "absent". */
export function contreEpreuveExpat(chemin) {
  const r = spawnSync("python3", ["-I", "-c", "import sys, xml.dom.minidom as m; m.parse(sys.argv[1])", chemin], { encoding: "utf8" });
  if (r.error) return "absent";
  return r.status === 0 ? null : (r.stderr.trim().split("\n").pop() || "refusé par expat");
}
