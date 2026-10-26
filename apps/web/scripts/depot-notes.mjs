// Notes de version du dépôt officiel (page /open-source) : lecture du Markdown des releases GitHub et du CHANGELOG.md
// du dépôt, en blocs simples (titre, puce, paragraphe). Rien n'est inventé : une section sans numéro de version
// (« Unreleased ») est ignorée, un tableau aussi (ses lignes ne sont pas des nouveautés). Utilisé à la construction
// par scripts/github-releases.mjs et par les essais (tests/depot.test.ts).

/** Markdown d'une release ou d'une section de CHANGELOG → blocs { t: "h" | "li" | "p", text }. */
export function blocks(md) {
  const out = [];
  let para = null;
  let item = null;
  const flush = () => {
    if (para) out.push({ t: "p", text: para.join(" ") });
    if (item) out.push({ t: "li", text: item.join(" ") });
    para = item = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    if (/^\s*<!--.*-->\s*$/.test(line) || /^\s*\|/.test(line) || /^\s*(---+|\*\*\*+)\s*$/.test(line) || /^\s*>/.test(line)) { flush(); continue; }
    const h = /^#{2,6}\s+(.+)$/.exec(line);
    if (h) { flush(); out.push({ t: "h", text: h[1].trim() }); continue; }
    const li = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (li) { flush(); item = [li[1].trim()]; continue; }
    if (item && /^\s{2,}\S/.test(raw)) { item.push(line.trim()); continue; }
    if (item) flush();
    (para ??= []).push(line.trim());
  }
  flush();
  return out.filter((b) => b.text.length > 0);
}

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** CHANGELOG.md (format Keep a Changelog : « ## [x.y.z] — date — titre ») → versions publiées, la plus récente d'abord. */
export function parseChangelog(md) {
  const entries = [];
  const parts = md.replace(/\r\n?/g, "\n").split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const head = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = nl < 0 ? "" : part.slice(nl + 1);
    const v = /^\[([^\]]+)\]/.exec(head);
    if (!v || !/^v?\d+\.\d+\.\d+([-+][\w.]+)?$/.test(v[1].trim())) continue; // « Unreleased » et autres : pas une version
    const version = v[1].trim().replace(/^v/, "");
    const rest = head.slice(v[0].length).split(/\s+[—–-]\s+/).map((s) => s.trim()).filter(Boolean);
    const date = rest.find((s) => DATE.test(s))?.match(DATE)?.[1] ?? null;
    const title = rest.filter((s) => !DATE.test(s)).join(" — ") || null;
    entries.push({ version, title, date, prerelease: /-|preview|pré-version|pre-release/i.test(version + " " + (title ?? "")), url: null, blocks: blocks(body) });
  }
  return entries;
}

/** Réponse de l'API publique GET /repos/{owner}/{repo}/releases → versions publiées (brouillons exclus). */
export function parseReleases(list) {
  if (!Array.isArray(list)) throw new Error("réponse inattendue de l'API des releases");
  return list
    .filter((r) => r && !r.draft && typeof r.tag_name === "string")
    .map((r) => {
      const version = r.tag_name.replace(/^v/, "");
      const name = typeof r.name === "string" ? r.name.trim() : "";
      return {
        version,
        title: name && name !== r.tag_name ? name : null,
        date: typeof r.published_at === "string" ? r.published_at.slice(0, 10) : null,
        prerelease: r.prerelease === true,
        url: typeof r.html_url === "string" && r.html_url.startsWith("https://github.com/") ? r.html_url : null,
        blocks: blocks(typeof r.body === "string" ? r.body : ""),
      };
    });
}
