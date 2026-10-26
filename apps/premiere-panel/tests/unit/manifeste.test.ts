// CSXS/manifest.xml doit être du XML bien formé : CEP refuse un manifeste mal formé (un « -- » dans un commentaire
// suffit). Le contrôle de la construction (scripts/xml-bien-forme.mjs) est essayé ici sur le vrai manifeste et sur
// des fautes typiques, et recoupé par expat (Python) quand il est présent.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contreEpreuveExpat, verifierXml } from "../../scripts/xml-bien-forme.mjs";

const RACINE = join(__dirname, "..", "..");
const MANIFESTE = readFileSync(join(RACINE, "cep", "CSXS", "manifest.xml"), "utf8").split("@VERSION@").join("2.0.0");

describe("manifeste CEP bien formé", () => {
  it("le vrai manifeste est bien formé (contrôle intégré et expat)", () => {
    expect(verifierXml(MANIFESTE)).toBeNull();
    const d = mkdtempSync(join(tmpdir(), "manifeste-"));
    writeFileSync(join(d, "manifest.xml"), MANIFESTE);
    expect([null, "absent"]).toContain(contreEpreuveExpat(join(d, "manifest.xml")));
  });
  it("aucun « -- » dans ses commentaires, options CEF interdites absentes", () => {
    for (const m of MANIFESTE.matchAll(/<!--([\s\S]*?)-->/g)) expect(m[1]).not.toContain("--");
    const sansCommentaires = MANIFESTE.replace(/<!--[\s\S]*?-->/g, "");
    expect(sansCommentaires).not.toMatch(/PlayerDebugMode|disable-web-security|mixed-context/);
    expect([...sansCommentaires.matchAll(/<Parameter>([^<]+)<\/Parameter>/g)].map((m) => m[1])).toEqual(["--enable-nodejs", "--allow-file-access-from-files", "--allow-file-access"]);
  });
  it("l'ancien en-tête fautif (« (--enable-nodejs) » dans le commentaire) est refusé, aussi par expat", () => {
    const fautif = MANIFESTE.replace("(enable-nodejs)", "(--enable-nodejs)");
    expect(verifierXml(fautif)).toMatch(/^\d+:\d+ : « -- » interdit dans un commentaire/);
    const d = mkdtempSync(join(tmpdir(), "manifeste-"));
    writeFileSync(join(d, "manifest.xml"), fautif);
    const expat = contreEpreuveExpat(join(d, "manifest.xml"));
    if (expat !== "absent") expect(expat).toBeTruthy();
  });
  it.each([
    ["commentaire finissant par -", '<?xml version="1.0"?><a><!-- x---></a>'],
    ["balises croisées", "<a><b></a></b>"],
    ["balise jamais fermée", "<a><b></b>"],
    ["attribut en double", '<a x="1" x="2"/>'],
    ["attribut sans guillemets", "<a x=1/>"],
    ["& nu", "<a>R&D</a>"],
    ["< nu dans un attribut", '<a x="<"/>'],
    ["deux racines", "<a/><b/>"],
    ["texte hors racine", "<a/>texte"],
    ["déclaration XML pas au début", ' <?xml version="1.0"?><a/>'],
    ["DOCTYPE", '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'],
    ["caractère de contrôle", "<a>\u0001</a>"],
  ])("refuse : %s", (_nom, xml) => {
    expect(verifierXml(xml)).not.toBeNull();
  });
  it("accepte : entités prédéfinies et numériques, CDATA, instruction de traitement, commentaires après la racine", () => {
    expect(verifierXml('<?xml version="1.0" encoding="UTF-8"?>\n<a x="&amp;&#233;&#xE9;"><![CDATA[<brut> & ]]><?pi ok?>&lt;é&gt;</a>\n<!-- fin -->\n')).toBeNull();
  });
});
