// La clé personnelle : stockée protégée (DPAPI sous Windows, sinon fichier du profil en 0600 / ACL), relue,
// effacée ; JAMAIS dans un journal, une ligne de commande, un message d'erreur ni la console.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { creerServicesNoeud } from "../../src/noeud/services";
import { creerJournal, declarerSecret, masquer, oublierSecret } from "../../src/lib/journal";
import { creerClient } from "../../src/api/client";
import { dossierTemporaire, hotePourClient, requireNode, services } from "./outils";

const CLE = "ytc_SecretTresPrive0123456789";
const STOCKEE = { cle: CLE, expireLe: "2026-11-17T10:00:00.000Z", compte: { email: "élodie@exemple.fr", nom: "Élodie" }, enregistreeLe: "2026-10-18T10:00:00.000Z" };

let sorties: string[] = [];
beforeEach(() => {
  sorties = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void sorties.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("coffre de la clé (repli fichier du profil, hors Windows)", () => {
  it("écrit en 0600, relit, efface ; la clé n'apparaît dans aucun journal", async () => {
    const d = dossierTemporaire();
    const journal: string[] = [];
    const s = services(d, journal);
    expect(await s.coffre.ecrire(STOCKEE)).toBe("acl");
    const f = join(d, "cle.json");
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readdirSync(d).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    // Nouvelle instance : relecture depuis le disque.
    const s2 = services(d, journal);
    expect(await s2.coffre.lire()).toEqual(STOCKEE);
    expect(await s2.coffre.protection()).toBe("acl");
    await s2.coffre.effacer();
    expect(await services(d).coffre.lire()).toBeNull();
    expect(readdirSync(d)).toEqual([]);
    expect(journal.join("\n")).not.toContain(CLE);
    expect(journal.join("\n")).toMatch(/clé enregistrée/);
    expect(sorties.join("\n")).not.toContain(CLE);
  });
});

describe("coffre de la clé sous Windows (DPAPI par PowerShell, simulé)", () => {
  it("la clé passe par l'entrée standard, jamais dans les arguments ; repli ACL si PowerShell échoue", async () => {
    const appels: { exe: string; args: string[]; entree: string }[] = [];
    let echec = false;
    const fauxChildProcess = {
      execFile(exe: string, args: string[], _o: unknown, rappel: (e: unknown, out: string) => void) {
        const appel = { exe, args, entree: "" };
        appels.push(appel);
        return {
          stdin: {
            on() {},
            end(t: string) {
              appel.entree = t;
              setTimeout(() => {
                if (echec) return rappel(Object.assign(new Error("x"), { code: 1 }), "");
                const script = Buffer.from(args[args.length - 1]!, "base64").toString("utf16le");
                // « DPAPI » simulée : renversement réversible du base64 reçu.
                const entree = t.trim();
                if (script.includes("::Unprotect(")) rappel(null, Buffer.from(Buffer.from(entree, "base64").toString("latin1").split("").reverse().join(""), "latin1").toString("base64"));
                else rappel(null, Buffer.from(Buffer.from(entree, "base64").toString("latin1").split("").reverse().join(""), "latin1").toString("base64") + "PADDINGPADDINGPADDINGPADDINGPADDINGPADDING".slice(0, 0));
              }, 1);
            },
          },
        };
      },
    };
    // Windows simulé : plateforme win32, mais chemins POSIX du banc (path.win32 remplacé par path.posix).
    const req = (m: string) => (m === "child_process" ? fauxChildProcess : m === "os" ? { ...requireNode("os"), platform: () => "win32" } : m === "path" ? { ...requireNode("path"), win32: requireNode("path").posix } : requireNode(m));
    const d = dossierTemporaire();
    const journal: string[] = [];
    const s = creerServicesNoeud(req, { dossierDonnees: d, dossiersInternes: () => [d], journal: (n, m) => journal.push(m) });
    const STOCKEE_LONGUE = { ...STOCKEE, enregistreeLe: STOCKEE.enregistreeLe + "     " };
    expect(await s.coffre.ecrire(STOCKEE_LONGUE)).toBe("dpapi");
    expect(appels[0]!.exe).toBe("powershell.exe");
    expect(appels[0]!.args.join(" ")).not.toContain(CLE);
    expect(Buffer.from(appels[0]!.args[appels[0]!.args.length - 1]!, "base64").toString("utf16le")).toContain("ProtectedData]::Protect(");
    expect(appels[0]!.entree).not.toContain(CLE); // base64 de la charge, pas la clé en clair
    const blob = readFileSync(join(d, "cle.dpapi"), "utf8");
    expect(blob).not.toContain(CLE);
    const s2 = creerServicesNoeud(req, { dossierDonnees: d, dossiersInternes: () => [d] });
    expect((await s2.coffre.lire())?.cle).toBe(CLE);
    // PowerShell indisponible : repli fichier du profil (+ icacls), toujours sans fuite.
    echec = true;
    const d2 = dossierTemporaire();
    const s3 = creerServicesNoeud(req, { dossierDonnees: d2, dossiersInternes: () => [d2], journal: (n, m) => journal.push(m) });
    expect(await s3.coffre.ecrire(STOCKEE)).toBe("acl");
    expect(journal.join("\n")).toMatch(/DPAPI indisponible/);
    expect(journal.join("\n")).not.toContain(CLE);
    expect(appels.every((a) => !a.args.join(" ").includes(CLE))).toBe(true);
  });
});

describe("journal : masquage des secrets", () => {
  it("masque clés ytc_, Bearer, champs JSON sensibles et valeurs déclarées", () => {
    const j = creerJournal();
    declarerSecret("codeappareil-xyz-0123456789");
    j.ecrire("info", `appel avec Authorization: Bearer ${CLE}`);
    j.ecrire("erreur", new Error(`échec pour ${CLE}`));
    j.ecrire("info", { cle: CLE, codeAppareil: "codeappareil-xyz-0123456789", autre: 1 });
    j.ecrire("info", '{"token":"abc.def.ghi","jeton":"zzz"}');
    j.ecrire("info", "code saisi codeappareil-xyz-0123456789 fin");
    const tout = j.lignes().map((l) => l.message).join("\n");
    expect(tout).not.toContain(CLE);
    expect(tout).not.toContain("codeappareil-xyz");
    expect(tout).not.toContain("abc.def.ghi");
    expect(tout).toContain("[masqué]");
    oublierSecret("codeappareil-xyz-0123456789");
    expect(masquer("rien de secret")).toBe("rien de secret");
  });
  it("une erreur réseau du client ne contient jamais la clé", async () => {
    const c = creerClient(hotePourClient(), { compte: "http://127.0.0.1:9", api: "http://127.0.0.1:9/media" }, () => CLE);
    const e = (await c.apercu("https://youtu.be/dQw4w9WgXcQ").catch((x: Error) => x)) as Error;
    expect(String(e.message) + JSON.stringify(e)).not.toContain(CLE);
    expect(sorties.join("\n")).not.toContain(CLE);
  });
});
