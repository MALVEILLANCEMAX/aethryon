// Pages juridiques écrites en Markdown (src/legal/*.md, importés « ?raw ») : UNE source pour la page publiée et pour sa
// version texte (dist/legal/cgv.txt, scripts/prerender.mjs), que le serveur joint à la confirmation de commande. Sous-
// ensemble STRICT, rien d'autre n'est accepté (une construction échoue plutôt que de publier un texte mal lu) :
// titres #, ##, ###, paragraphes, listes « - » et « 1. », encadrés « > », tableaux « | », séparateur « --- », et en ligne
// **gras**, *italique*, [texte](adresse) et champs {{cle}} (lib/legal.tsx : la valeur, ou « À compléter », refusé à la
// construction de production). Espaces insécables françaises posées ici, jamais à la main.
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { isLegalKey, Legal, legalText } from "../lib/legal.tsx";

export type Block =
  | { t: "h1" | "h2" | "h3"; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "table"; head: string[] | null; rows: string[][] }
  | { t: "hr" };

/** Identifiant d'ancre stable : « 8. Droit de rétractation (14 jours) » → « article-8 » ; « Annexe B — … » → « annexe-b ». */
export function anchor(text: string): string {
  const art = /^(\d+)\.\s/.exec(text);
  if (art) return `article-${art[1]}`;
  const annex = /^Annexe ([A-Z])\b/.exec(text);
  if (annex) return `annexe-${annex[1]!.toLowerCase()}`;
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 6).join("-");
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** Lecture du Markdown (sous-ensemble ci-dessus). Une ligne inconnue (HTML, code, image) fait échouer la construction. */
export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: "p", text: para.join(" ") }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*$/.test(line)) { flush(); continue; }
    if (/^\s*(<|```|!\[)/.test(line)) throw new Error(`legal : construction non prise en charge, ligne ${i + 1} : ${line.slice(0, 60)}`);
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) { flush(); const text = h[2]!.trim(); out.push({ t: (["h1", "h2", "h3"] as const)[h[1]!.length - 1]!, text, id: anchor(text) }); continue; }
    if (/^---\s*$/.test(line)) { flush(); out.push({ t: "hr" }); continue; }
    if (line.startsWith(">")) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) { inner.push(lines[i]!.replace(/^> ?/, "")); i++; }
      i--;
      out.push({ t: "quote", blocks: parse(inner.join("\n")) });
      continue;
    }
    if (line.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) { rows.push(cells(lines[i]!)); i++; }
      i--;
      if (rows.length < 2 || !rows[1]!.every((c) => /^:?-{3,}:?$/.test(c))) throw new Error(`legal : tableau sans ligne de séparation (ligne ${i + 1})`);
      const head = rows[0]!.every((c) => c === "") ? null : rows[0]!;
      out.push({ t: "table", head, rows: rows.slice(2) });
      continue;
    }
    const li = /^(- |\d+\. )(.*)$/.exec(line);
    if (li) {
      flush();
      const kind = li[1] === "- " ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length) {
        const m = kind === "ul" ? /^- (.*)$/.exec(lines[i]!) : /^\d+\. (.*)$/.exec(lines[i]!);
        if (m) { items.push(m[1]!.trim()); i++; continue; }
        if (/^ {2,}\S/.test(lines[i]!) && items.length) { items[items.length - 1] += ` ${lines[i]!.trim()}`; i++; continue; }
        break;
      }
      i--;
      out.push({ t: kind, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** Typographie française : espace insécable avant « : ; ! ? » et à l'intérieur des guillemets « ». */
export function typo(s: string): string {
  return s
    .replace(/ ([:;!?»])/g, " $1")
    .replace(/« /g, "« ")
    .replace(/([0-9]) (€|%)/g, "$1 $2");
}

// Jetons en ligne. Italique : ouvre sur une lettre ou « et ferme après un caractère visible, pour ne jamais prendre les
// « (*) » du formulaire type de rétractation. split() avec un groupe capturant : les jetons sont aux indices impairs.
const TOKEN = /(\*\*[^*]+\*\*|\*[A-Za-zÀ-ÖØ-öø-ÿ«][^*]*?[^\s*(]\*|\[[^\]]+\]\([^)\s]+\)|\{\{[a-zA-Z]+\}\})/g;
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

function field(name: string): string {
  if (!isLegalKey(name)) throw new Error(`legal : champ inconnu {{${name}}}`);
  return name;
}

/** Texte en ligne → éléments React (gras, italique, liens internes ou externes, champs légaux). */
export function inline(text: string, key = "i"): ReactNode[] {
  return text.split(TOKEN).map((part, n) => {
    const k = `${key}-${n}`;
    if (n % 2 === 0) return part ? <Fragment key={k}>{typo(part)}</Fragment> : null;
    if (part.startsWith("**")) return <strong key={k}>{inline(part.slice(2, -2), k)}</strong>;
    if (part.startsWith("{{") && part.endsWith("}}")) {
      const f = field(part.slice(2, -2));
      return <Legal key={k} k={f as Parameters<typeof Legal>[0]["k"]} />;
    }
    const a = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (a) {
      const [, label, href] = a;
      if (href!.startsWith("/")) return <Link key={k} to={href!} className={link}>{inline(label!, k)}</Link>;
      // Adresse d'un autre site : écrite en clair, jamais en lien (scripts/check-dist.mjs : aucune ressource externe).
      const bare = href!.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return <Fragment key={k}>{inline(label!, k)}{label === bare || label === href ? null : <> ({bare})</>}</Fragment>;
    }
    return <em key={k}>{inline(part.slice(1, -1), k)}</em>;
  });
}

/** Titres de niveau 2 : le sommaire de la page. */
export type Heading = Extract<Block, { id: string }>;
export const outline = (blocks: Block[]) => blocks.filter((b): b is Heading => b.t === "h2");

function BlockView({ b, k }: { b: Block; k: string }) {
  switch (b.t) {
    case "h1": return null; // le titre de la page est posé par la page elle-même
    case "h2":
      return (
        <h2 id={b.id} className="scroll-mt-28 border-t border-line pt-9 font-display text-[clamp(1.35rem,1.2rem+0.6vw,1.7rem)] leading-tight text-ink">
          {inline(b.text, k)}
        </h2>
      );
    case "h3": return <h3 id={b.id} className="scroll-mt-28 pt-2 text-corps font-semibold text-ink">{inline(b.text, k)}</h3>;
    case "p": return <p>{inline(b.text, k)}</p>;
    case "ul": return <ul className="list-disc space-y-2 pl-5 marker:text-gold">{b.items.map((it, n) => <li key={n}>{inline(it, `${k}-${n}`)}</li>)}</ul>;
    case "ol": return <ol className="list-decimal space-y-2 pl-5 marker:text-gold-text">{b.items.map((it, n) => <li key={n}>{inline(it, `${k}-${n}`)}</li>)}</ol>;
    case "quote":
      return (
        <div className="space-y-3 rounded-card border-2 border-gold/70 bg-surface px-5 py-4 text-ui leading-[1.65] text-ink sm:px-6" data-legal-encadre="">
          {b.blocks.map((x, n) => <BlockView key={n} b={x} k={`${k}-${n}`} />)}
        </div>
      );
    case "table":
      // Sur téléphone, pas de défilement horizontal : chaque ligne s'empile, chaque cellule précédée de son intitulé
      // (data-label, lu aussi par les lecteurs d'écran) ; sur un écran plus large, un tableau classique.
      return (
        <table className="w-full border-collapse text-left text-ui leading-[1.55] max-sm:block">
          {b.head && (
            <thead className="max-sm:sr-only">
              <tr>{b.head.map((c, n) => <th key={n} scope="col" className="border-b border-line px-3 py-2 align-bottom font-semibold text-ink">{inline(c, `${k}-h${n}`)}</th>)}</tr>
            </thead>
          )}
          <tbody className="max-sm:block">
            {b.rows.map((r, rn) => (
              <tr key={rn} className="border-b border-line/70 align-top max-sm:block max-sm:py-2.5">
                {r.map((c, n) => n === 0
                  ? <th key={n} scope="row" className="px-3 py-2 font-medium text-ink max-sm:block max-sm:p-0">{inline(c, `${k}-${rn}-${n}`)}</th>
                  : <td key={n} data-label={b.head?.[n] ? `${b.head[n]!.replace(/\*\*/g, "")}\u00a0: ` : undefined}
                      className="px-3 py-2 max-sm:block max-sm:px-0 max-sm:pb-0 max-sm:pt-1 max-sm:before:font-medium max-sm:before:text-ink max-sm:before:content-[attr(data-label)]">
                      {inline(c, `${k}-${rn}-${n}`)}
                    </td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "hr": return null;
  }
}

/** Corps d'une page juridique (sans le titre h1). */
export function LegalBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4 text-corps leading-[1.7] text-ink-soft [overflow-wrap:break-word] [&_strong]:font-semibold [&_strong]:text-ink">
      {blocks.map((b, n) => <BlockView key={n} b={b} k={`b${n}`} />)}
    </div>
  );
}

// ---- version texte (pièce jointe de la confirmation de commande) --------------------------------------------------

/** Texte en ligne → texte brut : champs remplis (ou « À compléter : … »), liens internes complétés par l'origine. */
export function inlineText(text: string, origin: string): string {
  return typo(text.split(TOKEN).map((part, n) => {
    if (n % 2 === 0) return part;
    if (part.startsWith("**")) return inlineText(part.slice(2, -2), origin);
    if (part.startsWith("{{") && part.endsWith("}}")) return legalText(field(part.slice(2, -2)) as Parameters<typeof legalText>[0]);
    const a = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (a) {
      const label = inlineText(a[1]!, origin);
      const href = a[2]!.startsWith("/") ? `${origin}${a[2]}` : a[2]!;
      const bare = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return label === href || label === bare ? label : `${label} (${href})`;
    }
    return inlineText(part.slice(1, -1), origin);
  }).join(""));
}

/** Document entier en texte brut, lisible dans n'importe quelle messagerie (UTF-8, lignes LF). */
export function toText(blocks: Block[], origin: string, indent = ""): string {
  const out: string[] = [];
  const t = (s: string) => inlineText(s, origin);
  for (const b of blocks) {
    if (b.t === "h1") out.push(`${indent}${t(b.text).toUpperCase()}`, "");
    else if (b.t === "h2") out.push("", `${indent}${t(b.text).toUpperCase()}`, "");
    else if (b.t === "h3") out.push(`${indent}${t(b.text)}`, "");
    else if (b.t === "p") out.push(`${indent}${t(b.text)}`, "");
    else if (b.t === "ul") out.push(...b.items.map((x) => `${indent}- ${t(x)}`), "");
    else if (b.t === "ol") out.push(...b.items.map((x, n) => `${indent}${n + 1}. ${t(x)}`), "");
    else if (b.t === "quote") out.push(toText(b.blocks, origin, `${indent}    `).replace(/\n+$/, ""), "");
    else if (b.t === "table") {
      for (const r of b.rows) {
        if (!b.head) out.push(`${indent}${r.map(t).join(" : ")}`);
        else {
          const first = t(r[0]!);
          const rest = r.slice(1).map((c, n) => `${t(b.head![n + 1] ?? "")} : ${t(c)}`).join(" ; ");
          out.push(`${indent}- ${first ? `${first} — ` : ""}${rest}`);
        }
      }
      out.push("");
    }
  }
  // Jamais trim() : il retirerait le retrait de la première ligne d'un encadré.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
}
